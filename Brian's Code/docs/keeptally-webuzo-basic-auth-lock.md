# KeepTally Webuzo Basic Auth Lock

Date: 2026-06-08

## Purpose

Use this when the KeepTally dev and test environments need a VPS-side password gate in front of the app.

This is separate from:

- Cloudflare Access email gates.
- KeepTally application login.
- Webuzo panel login.

The script adds nginx Basic Auth to the Webuzo custom domain snippets for:

- `dev.keeptally.ai`
- `test.keeptally.ai`

It also injects the same Basic Auth block into the active Webuzo generated proxy
`location /` for each domain. This is necessary because Webuzo places the custom
domain include outside the proxy location that serves the KeepTally app.

The active proxy-location block also clears the upstream `Authorization` header.
That prevents the browser's Basic Auth header from being forwarded into the
KeepTally app, where it can conflict with the app's cookie/JWT authentication.

## Install

Run on the VPS as root:

```bash
cd "/root/Keep-Tally-AI/Brian's Code"
git pull --ff-only origin main

./scripts/vps-lock-access.sh install --username keeptally
```

The script prompts for a password twice. The plaintext password is not saved. Only the nginx htpasswd hash is written to:

```text
/etc/nginx/keeptally-basic-auth.htpasswd
```

## Status

```bash
cd "/root/Keep-Tally-AI/Brian's Code"
./scripts/vps-lock-access.sh status
```

## Disable

```bash
cd "/root/Keep-Tally-AI/Brian's Code"
./scripts/vps-lock-access.sh disable
```

## Lock One Environment Only

Dev only:

```bash
KEEPTALLY_LOCK_DOMAINS=dev.keeptally.ai ./scripts/vps-lock-access.sh install --username keeptally
```

Test only:

```bash
KEEPTALLY_LOCK_DOMAINS=test.keeptally.ai ./scripts/vps-lock-access.sh install --username keeptally
```

## Verification

From your workstation or VPS:

```bash
curl -I https://dev.keeptally.ai
curl -I https://test.keeptally.ai
```

Expected before credentials:

```text
HTTP/2 401
www-authenticate: Basic realm="KeepTally restricted access"
```

Expected with credentials:

```bash
curl -I -u keeptally:'PASSWORD_HERE' https://dev.keeptally.ai/api/healthz
curl -I -u keeptally:'PASSWORD_HERE' https://test.keeptally.ai/api/healthz
```

The authenticated request should reach the app or the next outer gate, such as Cloudflare Access.

## Notes

- The script writes a managed block into each Webuzo custom domain file:
  `/var/webuzo-data/nginx/custom/domains/<domain>.conf`
- The script writes a managed location-level block into:
  `/usr/local/apps/nginx/etc/conf.d/webuzoVH.conf`
- It backs up every modified snippet with a timestamped `.bak.<timestamp>` suffix.
- Webuzo may regenerate `webuzoVH.conf`; rerun the install command if the password
  gate disappears after a Webuzo domain/proxy change.
- It runs `nginx -t` before restarting nginx.
- Do not commit or paste the password into repo files, shell history, or docs.
