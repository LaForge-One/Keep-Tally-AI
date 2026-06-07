import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useLocation as useWouterLocation } from "wouter";
import {
  ArrowLeft,
  ArrowLeftRight,
  BarChart2,
  Bell,
  Bot,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Package,
  Search,
  Settings,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSelectedLocation, LOCATIONS } from "@/contexts/location-context";
import { useAuth, useCurrentUser } from "@/contexts/auth-context";
import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  warehouse: "Warehouse",
  stocker: "Stocker",
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-red-100 text-red-700",
  warehouse: "bg-blue-100 text-blue-700",
  stocker: "bg-green-100 text-green-700",
};

interface NavItem {
  path: string;
  label: string;
  icon: React.ElementType;
  section?: string;
}

interface SidebarProps {
  nav: NavItem[];
  location: string;
  currentUser: ReturnType<typeof useCurrentUser>;
  userInitials: string;
  onClose: () => void;
  onLogout: () => void;
}

function SidebarNav({
  nav,
  location,
  currentUser,
  userInitials,
  onClose,
  onLogout,
}: SidebarProps) {
  function isActive(path: string) {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  }

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: "#f8fafc", borderRight: "1px solid #d8e2ee" }}
    >
      <div
        className="flex h-14 shrink-0 items-center gap-2.5 px-5"
        style={{ borderBottom: "1px solid #d8e2ee" }}
      >
        <div
          className="grid place-items-center"
          style={{
            width: 28,
            height: 28,
            border: "1px solid #d8e2ee",
            borderRadius: 8,
            background: "#fff",
            boxShadow:
              "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
            color: "#38a4dc",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.15}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m21 8-9-5-9 5 9 5 9-5Z" />
            <path d="M3 8v8l9 5 9-5V8" />
            <path d="M12 13v8" />
          </svg>
        </div>
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: 0,
            color: "#162f57",
          }}
        >
          KeepTally
        </span>
      </div>

      <nav
        className="flex-1 overflow-y-auto"
        style={{ padding: "12px 10px" }}
        aria-label="Primary navigation"
      >
        {nav.map((item) => {
          const active = isActive(item.path);

          return (
            <div key={item.path}>
              {item.section && (
                <div
                  style={{
                    margin: "14px 10px 6px",
                    color: "#94a3b8",
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {item.section}
                </div>
              )}
              <Link
                href={item.path}
                onClick={onClose}
                className="hover:bg-[#eef4fa] hover:text-[#172f56]"
                style={{
                  display: "flex",
                  alignItems: "center",
                  minHeight: 36,
                  gap: 10,
                  padding: "8px 12px",
                  marginBottom: 2,
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: "none",
                  transition: "background 150ms ease, color 150ms ease",
                  ...(active
                    ? { background: "#eaf2fb", color: "#446fa7" }
                    : { color: "#5b6f88" }),
                }}
              >
                <item.icon
                  style={{
                    width: 17,
                    height: 17,
                    flexShrink: 0,
                    strokeWidth: 2.15,
                  }}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      {currentUser && (
        <div style={{ padding: 12, borderTop: "1px solid #d8e2ee" }}>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 text-left"
            style={{
              border: "1px solid #e8eef5",
              borderRadius: 10,
              background: "#fff",
              padding: 10,
              boxShadow:
                "0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08)",
              cursor: "pointer",
              transition: "box-shadow 150ms ease, border-color 150ms ease",
            }}
          >
            <div
              className="grid shrink-0 place-items-center"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: "#dff0fb",
                color: "#28669c",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              {userInitials}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span
                className="truncate"
                style={{ fontSize: 13, fontWeight: 700, color: "#162f57" }}
              >
                {currentUser.displayName}
              </span>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                {ROLE_LABELS[currentUser.role] ?? currentUser.role}
              </span>
            </div>
            <LogOut
              style={{
                width: 14,
                height: 14,
                color: "#cbd5e1",
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [, navigate] = useWouterLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const { selectedLocation, setSelectedLocation } = useSelectedLocation();
  const { logout, hasPermission } = useAuth();
  const currentUser = useCurrentUser();

  const canGoBack = location !== "/";
  const isStoreInventoryPage = location === "/inventory";
  const isWarehousePage = location.startsWith("/warehouse");
  const canUseStoreLocationSelector =
    isStoreInventoryPage &&
    (hasPermission("view_all_locations") ||
      (currentUser?.assignedLocations?.length ?? 0) > 1);
  const storeLocationOptions = useMemo(
    () =>
      LOCATIONS.filter(
        (loc) =>
          hasPermission("view_all_locations") ||
          currentUser?.assignedLocations?.length === 0 ||
          currentUser?.assignedLocations?.includes(loc),
      ),
    [currentUser?.assignedLocations, hasPermission],
  );

  useEffect(() => {
    if (!isStoreInventoryPage && selectedLocation !== null) {
      setSelectedLocation(null);
    }
  }, [isStoreInventoryPage, selectedLocation, setSelectedLocation]);

  const { data: summary } = useQuery({
    queryKey: [
      "dashboard-summary-header",
      isStoreInventoryPage ? selectedLocation : null,
    ],
    queryFn: async () => {
      const scopedLocation = isStoreInventoryPage ? selectedLocation : null;
      const params = scopedLocation
        ? `?location=${encodeURIComponent(scopedLocation)}`
        : "";
      const res = await fetch(`${BASE}/api/dashboard/summary${params}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        belowParCount: number;
        outOfStockCount: number;
      }>;
    },
    staleTime: 60_000,
  });

  const alertCount =
    (summary?.belowParCount ?? 0) + (summary?.outOfStockCount ?? 0);

  const nav: NavItem[] = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    {
      path: "/inventory",
      label: "Store Inventory",
      icon: Package,
      section: "Inventory",
    },
    ...(hasPermission("view_warehouse")
      ? [{ path: "/warehouse", label: "Warehouse Inventory", icon: Warehouse }]
      : []),
    { path: "/restock", label: "Transfers", icon: ArrowLeftRight },
    {
      path: "/orders",
      label: "Pick Lists",
      icon: ClipboardList,
      section: "Field Work",
    },
    { path: "/route-sheets", label: "Route Sheets", icon: Map },
    {
      path: "/agents",
      label: "Agent Insights",
      icon: Bot,
      section: "Intelligence",
    },
    { path: "/history", label: "Reports", icon: BarChart2 },
    ...(currentUser?.role === "admin"
      ? [
          {
            path: "/admin/users",
            label: "Users & Permissions",
            icon: Users,
            section: "Admin",
          },
        ]
      : []),
    {
      path: "/settings",
      label: "Settings",
      icon: Settings,
      section: currentUser?.role !== "admin" ? "Admin" : undefined,
    },
  ];

  const userInitials = currentUser?.displayName
    ? currentUser.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  async function handleLogout() {
    setSidebarOpen(false);
    await logout();
    navigate("/login");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate("/inventory");
    setSidebarOpen(false);
  }

  function handleBack() {
    setSidebarOpen(false);
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/");
  }

  const sidebarProps: SidebarProps = {
    nav,
    location,
    currentUser,
    userInitials,
    onClose: () => setSidebarOpen(false),
    onLogout: handleLogout,
  };

  return (
    <div className="flex min-h-screen" style={{ background: "#f4f7fb" }}>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex">
        <SidebarNav {...sidebarProps} />
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-col transition-transform duration-200 ease-in-out lg:hidden ${
          sidebarOpen ? "flex translate-x-0" : "hidden -translate-x-full"
        }`}
      >
        <div className="absolute right-2 top-3 z-10">
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5"
            style={{ color: "#64748b" }}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SidebarNav {...sidebarProps} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header
          className="sticky top-0 z-20 flex h-14 items-center gap-3 px-4 md:px-6"
          style={{ borderBottom: "1px solid #d8e2ee", background: "#ffffff" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 lg:hidden"
            style={{ color: "#64748b" }}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {canGoBack && (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors hover:bg-slate-100"
              style={{
                border: "1px solid #d8e2ee",
                background: "#fff",
                color: "#334155",
              }}
              aria-label="Go back"
              title="Back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          {canUseStoreLocationSelector && (
            <Select
              value={selectedLocation ?? "__all__"}
              onValueChange={(val) =>
                setSelectedLocation(
                  val === "__all__"
                    ? null
                    : (val as (typeof LOCATIONS)[number]),
                )
              }
            >
              <SelectTrigger
                className="h-8 w-auto min-w-[140px] max-w-[200px] text-sm font-medium"
                style={{ borderColor: "#d8e2ee", background: "#f8fafc" }}
              >
                <Warehouse
                  className="mr-1 h-3.5 w-3.5 shrink-0"
                  style={{ color: "#94a3b8" }}
                />
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                {hasPermission("view_all_locations") && (
                  <SelectItem value="__all__">All Locations</SelectItem>
                )}
                {storeLocationOptions.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isWarehousePage && (
            <div
              className="hidden items-center gap-2 rounded-lg px-3 text-sm font-medium sm:flex"
              style={{
                minHeight: 32,
                border: "1px solid #d8e2ee",
                background: "#f8fafc",
                color: "#334155",
              }}
            >
              <Warehouse className="h-3.5 w-3.5 text-slate-400" />
              Warehouse Inventory
            </div>
          )}

          <div className="flex-1" />

          <form onSubmit={handleSearch} className="hidden sm:block">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: "#94a3b8" }}
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search items, routes, scans..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                aria-label="Search"
                style={{
                  height: 36,
                  width: 240,
                  border: "1px solid #d8e2ee",
                  borderRadius: 8,
                  background: "#f8fafc",
                  padding: "0 12px 0 34px",
                  fontSize: 13,
                  color: "#162f57",
                  outline: "none",
                  fontFamily: "inherit",
                  transition: "border-color 150ms ease",
                }}
              />
            </div>
          </form>

          <button
            className="relative grid place-items-center rounded-lg"
            style={{
              width: 36,
              height: 36,
              border: "1px solid #d8e2ee",
              background: "#fff",
              color: "#64748b",
              transition: "background 150ms ease",
            }}
            onClick={() => navigate("/inventory")}
            aria-label={
              alertCount > 0
                ? `${alertCount} items need attention`
                : "No alerts"
            }
          >
            <Bell className="h-4 w-4" />
            {alertCount > 0 && (
              <span
                className="absolute grid place-items-center border-2 border-white font-black text-white"
                style={{
                  top: -6,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 999,
                  background: "#ef4444",
                  fontSize: 10,
                }}
              >
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>

          {currentUser && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1"
                  style={{ cursor: "pointer", transition: "background 150ms ease" }}
                >
                  <div
                    className="grid shrink-0 place-items-center"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: "#dff0fb",
                      color: "#28669c",
                      fontSize: 11,
                      fontWeight: 900,
                    }}
                  >
                    {userInitials}
                  </div>
                  <div className="hidden flex-col items-start leading-none sm:flex">
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#334155",
                      }}
                    >
                      {currentUser.displayName.split(" ")[0]}
                    </span>
                    <span
                      className={`rounded px-1 text-[10px] font-semibold ${
                        ROLE_BADGE[currentUser.role] ??
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                    </span>
                  </div>
                  <ChevronDown
                    className="hidden h-3 w-3 sm:block"
                    style={{ color: "#94a3b8" }}
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-xs font-semibold text-slate-900">
                    {currentUser.displayName}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    @{currentUser.username}
                  </p>
                  <span
                    className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      ROLE_BADGE[currentUser.role] ??
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                  </span>
                </div>
                <DropdownMenuSeparator />
                {currentUser.role === "admin" && (
                  <DropdownMenuItem onClick={() => navigate("/admin/users")}>
                    <Users className="mr-2 h-4 w-4" /> Manage Users
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-7">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
