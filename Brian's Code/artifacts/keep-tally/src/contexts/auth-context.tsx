import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_STORAGE_KEY = "keeptally:lastActivityAt";
const ACTIVITY_EVENTS = [
  "click",
  "keydown",
  "mousemove",
  "mousedown",
  "scroll",
  "touchstart",
  "pointerdown",
] as const;

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

  useEffect(() => {
    if (authState.status !== "authenticated") return;

    let lastActivityAt = Date.now();
    let timeoutId: number | undefined;
    let isLoggingOut = false;

    const persistActivity = (value: number) => {
      lastActivityAt = value;
      try {
        window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(value));
      } catch {
        // Local storage can be unavailable in private/restricted modes; the in-memory timer still works.
      }
    };

    const markActive = () => {
      if (document.visibilityState === "hidden") return;
      persistActivity(Date.now());
      scheduleCheck();
    };

    const logoutForInactivity = async () => {
      if (isLoggingOut) return;
      isLoggingOut = true;
      await logout();
    };

    const checkIdle = () => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor >= INACTIVITY_TIMEOUT_MS) {
        void logoutForInactivity();
        return;
      }
      scheduleCheck();
    };

    function scheduleCheck() {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt));
      timeoutId = window.setTimeout(checkIdle, remaining + 250);
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVITY_STORAGE_KEY || !event.newValue) return;
      const nextActivity = Number.parseInt(event.newValue, 10);
      if (!Number.isFinite(nextActivity)) return;
      lastActivityAt = Math.max(lastActivityAt, nextActivity);
      scheduleCheck();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkIdle();
      }
    };

    persistActivity(Date.now());
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, markActive, { passive: true });
    }
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    scheduleCheck();

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markActive);
      }
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authState.status, logout]);

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
