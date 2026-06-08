#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
KeepTally Webuzo/nginx access lock helper

Usage:
  ./scripts/vps-lock-access.sh install [--username USER] [--domains dev.keeptally.ai,test.keeptally.ai]
  ./scripts/vps-lock-access.sh disable [--domains dev.keeptally.ai,test.keeptally.ai]
  ./scripts/vps-lock-access.sh status [--domains dev.keeptally.ai,test.keeptally.ai]

What it does:
  - Creates an htpasswd-compatible password file on the VPS.
  - Adds nginx Basic Auth to Webuzo custom domain snippets for KeepTally dev/test.
  - Tests nginx config and restarts nginx if installation/disable succeeds.
  - Does not store the plaintext password in the repo or on disk.

Defaults:
  username: keeptally
  domains:  dev.keeptally.ai,test.keeptally.ai
  auth file: /etc/nginx/keeptally-basic-auth.htpasswd
  custom domain dir: /var/webuzo-data/nginx/custom/domains

Environment overrides:
  KEEPTALLY_LOCK_USERNAME
  KEEPTALLY_LOCK_DOMAINS
  KEEPTALLY_LOCK_AUTH_FILE
  WEBUZO_NGINX_CUSTOM_DOMAIN_DIR
  WEBUZO_NGINX_VHOST_FILE
  WEBUZO_NGINX_BIN

Examples:
  ./scripts/vps-lock-access.sh install --username marsel
  KEEPTALLY_LOCK_DOMAINS=dev.keeptally.ai ./scripts/vps-lock-access.sh status
  ./scripts/vps-lock-access.sh disable
USAGE
}

ACTION="${1:-}"
if [[ $# -gt 0 ]]; then shift; fi

USERNAME="${KEEPTALLY_LOCK_USERNAME:-keeptally}"
DOMAINS_CSV="${KEEPTALLY_LOCK_DOMAINS:-dev.keeptally.ai,test.keeptally.ai}"
AUTH_FILE="${KEEPTALLY_LOCK_AUTH_FILE:-/etc/nginx/keeptally-basic-auth.htpasswd}"
CUSTOM_DOMAIN_DIR="${WEBUZO_NGINX_CUSTOM_DOMAIN_DIR:-/var/webuzo-data/nginx/custom/domains}"
VHOST_FILE="${WEBUZO_NGINX_VHOST_FILE:-/usr/local/apps/nginx/etc/conf.d/webuzoVH.conf}"
NGINX_BIN="${WEBUZO_NGINX_BIN:-nginx}"
MARKER_BEGIN="# BEGIN KEEPTALLY BASIC AUTH"
MARKER_END="# END KEEPTALLY BASIC AUTH"
LOCATION_MARKER_BEGIN="# BEGIN KEEPTALLY BASIC AUTH LOCATION"
LOCATION_MARKER_END="# END KEEPTALLY BASIC AUTH LOCATION"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username)
      USERNAME="${2:-}"
      shift 2
      ;;
    --domains)
      DOMAINS_CSV="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$ACTION" || "$ACTION" == "--help" || "$ACTION" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$ACTION" != "install" && "$ACTION" != "disable" && "$ACTION" != "status" ]]; then
  echo "Unknown action: $ACTION" >&2
  usage
  exit 2
fi

if [[ -z "$USERNAME" ]]; then
  echo "Username cannot be empty." >&2
  exit 2
fi

IFS=',' read -r -a DOMAINS <<< "$DOMAINS_CSV"

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run this on the VPS as root. Webuzo nginx snippets and auth files need root access." >&2
    exit 1
  fi
}

openssl_bin() {
  if command -v openssl >/dev/null 2>&1; then
    command -v openssl
    return
  fi
  if [[ -x /usr/local/apps/openssl-30/bin/openssl ]]; then
    echo /usr/local/apps/openssl-30/bin/openssl
    return
  fi
  echo "openssl was not found. Install openssl or set PATH to Webuzo's openssl binary." >&2
  exit 1
}

domain_file() {
  local domain="$1"
  echo "$CUSTOM_DOMAIN_DIR/$domain.conf"
}

backup_file() {
  local file="$1"
  local stamp
  stamp="$(date +%Y%m%d%H%M%S)"
  cp "$file" "$file.bak.$stamp"
}

strip_managed_block() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

strip_active_vhost_blocks() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v begin="$LOCATION_MARKER_BEGIN" -v end="$LOCATION_MARKER_END" '
    index($0, begin) == 1 { skip = 1; next }
    index($0, end) == 1 { skip = 0; next }
    skip != 1 { print }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

write_auth_file() {
  local password confirm hash openssl_path auth_dir
  auth_dir="$(dirname "$AUTH_FILE")"
  mkdir -p "$auth_dir"

  read -r -s -p "New Webuzo/nginx gate password for '$USERNAME': " password
  echo
  read -r -s -p "Confirm password: " confirm
  echo

  if [[ -z "$password" ]]; then
    echo "Password cannot be empty." >&2
    exit 2
  fi
  if [[ "$password" != "$confirm" ]]; then
    echo "Passwords do not match." >&2
    exit 2
  fi

  openssl_path="$(openssl_bin)"
  hash="$("$openssl_path" passwd -apr1 "$password")"
  umask 077
  printf '%s:%s\n' "$USERNAME" "$hash" > "$AUTH_FILE"
  chown root:root "$AUTH_FILE" 2>/dev/null || true
  chmod 640 "$AUTH_FILE"
}

install_domain_lock() {
  local domain="$1"
  local file
  file="$(domain_file "$domain")"

  if [[ ! -d "$CUSTOM_DOMAIN_DIR" ]]; then
    echo "Missing Webuzo custom domain directory: $CUSTOM_DOMAIN_DIR" >&2
    exit 1
  fi

  if [[ ! -f "$file" ]]; then
    echo "Creating custom domain snippet: $file"
    touch "$file"
  fi

  backup_file "$file"
  strip_managed_block "$file"
  cat >> "$file" <<EOF
$MARKER_BEGIN
auth_basic "KeepTally restricted access";
auth_basic_user_file $AUTH_FILE;
$MARKER_END
EOF
  echo "Locked: $domain"
}

install_active_vhost_lock() {
  local domain="$1"
  local tmp

  if [[ ! -f "$VHOST_FILE" ]]; then
    echo "Active Webuzo vhost file not found; skipped location-level lock: $VHOST_FILE"
    return
  fi

  tmp="$(mktemp)"
  awk \
    -v domain="$domain" \
    -v auth_file="$AUTH_FILE" \
    -v begin="$LOCATION_MARKER_BEGIN" \
    -v end="$LOCATION_MARKER_END" '
      function brace_delta(line, opens, closes) {
        opens = gsub(/\{/, "{", line)
        closes = gsub(/\}/, "}", line)
        return opens - closes
      }

      /^[[:space:]]*server[[:space:]]*\{/ {
        in_server = 1
        server_depth = 0
        matched_server = 0
        inserted = 0
      }

      in_server && $0 ~ /server_name/ && index($0, domain) > 0 {
        matched_server = 1
      }

      {
        print
        if (in_server && matched_server && inserted == 0 && $0 ~ /^[[:space:]]*location[[:space:]]+\/[[:space:]]*\{/) {
          match($0, /^[[:space:]]*/)
          indent = substr($0, RSTART, RLENGTH) "    "
          print indent begin " " domain
          print indent "auth_basic \"KeepTally restricted access\";"
          print indent "auth_basic_user_file " auth_file ";"
          print indent end " " domain
          inserted = 1
        }
      }

      in_server {
        server_depth += brace_delta($0)
        if (server_depth <= 0) {
          in_server = 0
          matched_server = 0
          inserted = 0
        }
      }
    ' "$VHOST_FILE" > "$tmp"
  cat "$tmp" > "$VHOST_FILE"
  rm -f "$tmp"
  echo "Locked active proxy location: $domain"
}

disable_domain_lock() {
  local domain="$1"
  local file
  file="$(domain_file "$domain")"
  if [[ ! -f "$file" ]]; then
    echo "No custom snippet found for: $domain"
    return
  fi
  backup_file "$file"
  strip_managed_block "$file"
  echo "Unlocked: $domain"
}

disable_active_vhost_locks() {
  if [[ ! -f "$VHOST_FILE" ]]; then
    echo "Active Webuzo vhost file not found; skipped location-level unlock: $VHOST_FILE"
    return
  fi
  backup_file "$VHOST_FILE"
  strip_active_vhost_blocks "$VHOST_FILE"
  echo "Removed active proxy location lock blocks"
}

status_domain_lock() {
  local domain="$1"
  local file
  file="$(domain_file "$domain")"
  if [[ ! -f "$file" ]]; then
    echo "$domain: missing snippet ($file)"
    return
  fi
  if grep -Fq "$MARKER_BEGIN" "$file"; then
    echo "$domain: locked"
  else
    echo "$domain: not locked"
  fi
}

status_active_vhost_lock() {
  local domain="$1"
  if [[ ! -f "$VHOST_FILE" ]]; then
    echo "$domain: active vhost file missing ($VHOST_FILE)"
    return
  fi
  if grep -Fq "$LOCATION_MARKER_BEGIN $domain" "$VHOST_FILE"; then
    echo "$domain: active proxy location locked"
  else
    echo "$domain: active proxy location not locked"
  fi
}

restart_nginx() {
  "$NGINX_BIN" -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart nginx
  else
    service nginx restart
  fi
}

require_root

case "$ACTION" in
  install)
    write_auth_file
    if [[ -f "$VHOST_FILE" ]]; then
      backup_file "$VHOST_FILE"
      strip_active_vhost_blocks "$VHOST_FILE"
    fi
    for domain in "${DOMAINS[@]}"; do
      domain="${domain//[[:space:]]/}"
      [[ -z "$domain" ]] && continue
      install_domain_lock "$domain"
      install_active_vhost_lock "$domain"
    done
    restart_nginx
    echo
    echo "Done. Test from your workstation:"
    echo "  curl -I https://dev.keeptally.ai"
    echo "  curl -I https://test.keeptally.ai"
    echo "Both should return 401 until the browser supplies the username/password."
    ;;
  disable)
    for domain in "${DOMAINS[@]}"; do
      domain="${domain//[[:space:]]/}"
      [[ -z "$domain" ]] && continue
      disable_domain_lock "$domain"
    done
    disable_active_vhost_locks
    restart_nginx
    ;;
  status)
    for domain in "${DOMAINS[@]}"; do
      domain="${domain//[[:space:]]/}"
      [[ -z "$domain" ]] && continue
      status_domain_lock "$domain"
      status_active_vhost_lock "$domain"
    done
    if [[ -f "$AUTH_FILE" ]]; then
      echo "auth file: present ($AUTH_FILE)"
    else
      echo "auth file: missing ($AUTH_FILE)"
    fi
    ;;
esac
