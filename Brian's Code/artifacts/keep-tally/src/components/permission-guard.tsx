import type { ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import type { PermissionKey } from "@/contexts/auth-context";

/** Renders children only if the user has the given permission. */
export function PermissionGuard({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return <>{fallback}</>;
  return <>{children}</>;
}

/**
 * Full-page "no permission" wall. Drop this at the top of a page
 * that the user isn't allowed to access.
 */
export function NoPermissionPage({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-6">
      <ShieldOff className="w-12 h-12 text-muted-foreground/50" />
      <p className="text-lg font-semibold">Access Restricted</p>
      <p className="text-sm text-muted-foreground max-w-xs">
        {message ?? "You do not have permission to perform this action."}
      </p>
    </div>
  );
}

/**
 * Inline "no permission" note — use in place of a hidden button
 * when you want the user to understand something is locked.
 */
export function NoPermissionInline({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic">
      <ShieldOff className="w-3 h-3" />
      {label ?? "No permission"}
    </span>
  );
}
