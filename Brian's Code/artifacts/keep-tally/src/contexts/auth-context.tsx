import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type UserRole = "admin" | "warehouse" | "stocker";
export type PermissionKey =
  | "manage_users"
  | "delete_items"
  | "edit_settings"
  | "view_costs"
  | "view_all_reports"
  | "edit_warehouse"
  | "receive_purchases"
  | "transfer_inventory"
  | "view_warehouse"
  | "edit_store_inventory"
  | "scan_barcodes"
  | "use_voice_mode"
  | "mark_adjustments"
  | "view_all_locations";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  assignedLocations: string[];
  permissions: PermissionKey[];
  mustChangePassword?: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser };

type AuthContextValue = {
  authState: AuthState;
  login: (username: string, password: string) => Promise<{ mustChangePassword?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (key: PermissionKey) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAuthState({ status: "authenticated", user: data.user });
      } else {
        setAuthState({ status: "unauthenticated" });
      }
    } catch {
      setAuthState({ status: "unauthenticated" });
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Login failed");
    }
    const data = await res.json();
    setAuthState({ status: "authenticated", user: data.user });
    return { mustChangePassword: data.user.mustChangePassword };
  }, []);

  const logout = useCallback(async () => {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    setAuthState({ status: "unauthenticated" });
  }, []);

  const hasPermission = useCallback(
    (key: PermissionKey): boolean => {
      if (authState.status !== "authenticated") return false;
      return authState.user.permissions.includes(key);
    },
    [authState],
  );

  return (
    <AuthContext.Provider value={{ authState, login, logout, refreshUser, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useCurrentUser(): AuthUser | null {
  const { authState } = useAuth();
  return authState.status === "authenticated" ? authState.user : null;
}
