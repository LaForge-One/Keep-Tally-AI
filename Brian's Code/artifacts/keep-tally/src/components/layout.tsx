import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ClipboardList,
  RefreshCw,
  Mic,
  BarChart2,
  Users,
  Settings,
  LogOut,
  ChevronDown,
  Bell,
  Search,
  X,
  Menu,
  Bot,
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
import { useLocation as useWouterLocation } from "wouter";
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
}

interface SidebarProps {
  mainNav: NavItem[];
  bottomNav: NavItem[];
  location: string;
  currentUser: ReturnType<typeof useCurrentUser>;
  userInitials: string;
  onClose: () => void;
  onLogout: () => void;
}

function SidebarNav({
  mainNav,
  bottomNav,
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
    <div className="flex h-full flex-col bg-[#f8fafc] border-r border-slate-200">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center px-5 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-sm border border-slate-200">
            <Package className="h-4 w-4 text-sky-500" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">KeepTally</span>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        {mainNav.map((item) => {
          const active = isActive(item.path);
          const isVoice = item.path === "/voice-check";
          if (isVoice) {
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={onClose}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-bold transition-colors mb-1"
                style={
                  active
                    ? { background: "linear-gradient(135deg, #4f46e5, #6366f1)", color: "white" }
                    : { background: "linear-gradient(135deg, rgba(79,70,229,0.12), rgba(99,102,241,0.12))", color: "#4f46e5" }
                }
              >
                <item.icon className="h-[17px] w-[17px] shrink-0" />
                <span className="truncate">{item.label}</span>
                {!active && <span className="ml-auto text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.2)", color: "#6366f1" }}>PRIMARY</span>}
              </Link>
            );
          }
          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={onClose}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-white text-sky-700 shadow-sm border border-slate-200 border-l-[3px] border-l-sky-500"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <item.icon
                className={`h-[17px] w-[17px] shrink-0 ${
                  active ? "text-sky-600" : "text-slate-400"
                }`}
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}

        {bottomNav.length > 0 && (
          <>
            <div className="py-2 px-1">
              <div className="h-px bg-slate-200" />
            </div>
            {bottomNav.map((item) => {
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={onClose}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white text-sky-700 shadow-sm border border-slate-200 border-l-[3px] border-l-sky-500"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <item.icon
                    className={`h-[17px] w-[17px] shrink-0 ${
                      active ? "text-sky-600" : "text-slate-400"
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User profile mini-card */}
      {currentUser && (
        <div className="p-3 border-t border-slate-200">
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg bg-white p-2.5 shadow-sm border border-slate-100 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer group text-left"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-semibold text-xs">
              {userInitials}
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-sm font-medium text-slate-900 truncate leading-tight">
                {currentUser.displayName}
              </span>
              <span className="text-xs text-slate-500 leading-tight">
                {ROLE_LABELS[currentUser.role] ?? currentUser.role}
              </span>
            </div>
            <LogOut className="h-3.5 w-3.5 text-slate-300 group-hover:text-red-400 transition-colors shrink-0" />
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

  const { selectedLocation, setSelectedLocation } = useSelectedLocation();  const { logout, hasPermission } = useAuth();
  const currentUser = useCurrentUser();

  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary-header", selectedLocation],
    queryFn: async () => {
      const params = selectedLocation
        ? `?location=${encodeURIComponent(selectedLocation)}`
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

  const mainNav: NavItem[] = [
    { path: "/voice-check", label: "Voice Inventory", icon: Mic },
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/inventory", label: "Store Inventory", icon: Package },
    ...(hasPermission("view_warehouse")
      ? [{ path: "/warehouse", label: "Warehouse Inventory", icon: Warehouse }]
      : []),
    { path: "/orders", label: "Pick Lists", icon: ClipboardList },
    { path: "/route-sheets", label: "Route Sheets", icon: ClipboardList },
    { path: "/restock", label: "Transfers", icon: RefreshCw },
    { path: "/agents", label: "Agent Insights", icon: Bot },
    { path: "/history", label: "Reports", icon: BarChart2 },
  ];

  const bottomNav: NavItem[] = [
    ...(currentUser?.role === "admin"
      ? [{ path: "/admin/users", label: "Users & Permissions", icon: Users }]
      : []),
    { path: "/settings", label: "Settings", icon: Settings },
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

  const sidebarProps: SidebarProps = {
    mainNav,
    bottomNav,
    location,
    currentUser,
    userInitials,
    onClose: () => setSidebarOpen(false),
    onLogout: handleLogout,
  };

  return (
    <div className="flex min-h-screen bg-[#fafafa]">
      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-56 flex-col">
        <SidebarNav {...sidebarProps} />
      </aside>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 flex-col lg:hidden transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "flex translate-x-0" : "hidden -translate-x-full"
        }`}
      >
        <div className="absolute right-2 top-3 z-10">
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SidebarNav {...sidebarProps} />
      </aside>

      {/* Main content column */}
      <div className="flex flex-1 flex-col lg:pl-56 min-w-0">
        {/* Top header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          {/* Hamburger (mobile) */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Location selector */}
          {(hasPermission("view_all_locations") ||
            (currentUser?.assignedLocations?.length ?? 0) > 1) && (
            <Select
              value={selectedLocation ?? "__all__"}
              onValueChange={(val) =>
                setSelectedLocation(
                  val === "__all__"
                    ? null
                    : (val as (typeof LOCATIONS)[number])
                )
              }
            >
              <SelectTrigger className="h-8 w-auto min-w-[140px] max-w-[200px] text-sm border-slate-200 bg-white font-medium">
                <Warehouse className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                {hasPermission("view_all_locations") && (
                  <SelectItem value="__all__">All Locations</SelectItem>
                )}
                {LOCATIONS.filter(
                  (loc) =>
                    hasPermission("view_all_locations") ||
                    (currentUser?.assignedLocations?.length === 0) ||
                    currentUser?.assignedLocations?.includes(loc)
                ).map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex-1" />

          {/* Search bar */}
          <form onSubmit={handleSearch} className="hidden sm:block">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search inventory..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="h-8 w-48 md:w-56 rounded-full border border-slate-200 bg-slate-50 pl-8 pr-4 text-sm outline-none transition-all focus:border-sky-400 focus:bg-white focus:ring-1 focus:ring-sky-400 focus:w-64"
              />
            </div>
          </form>

          {/* Notification bell */}
          <button
            className="relative rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            onClick={() => navigate("/inventory")}
            title={
              alertCount > 0
                ? `${alertCount} items need attention`
                : "No alerts"
            }
          >
            <Bell className="h-5 w-5" />
            {alertCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-white">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>

          {/* User menu */}
          {currentUser && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 transition-colors">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700 font-semibold text-xs shrink-0">
                    {userInitials}
                  </div>
                  <div className="hidden sm:flex flex-col items-start leading-none">
                    <span className="text-sm font-medium text-slate-700">
                      {currentUser.displayName.split(" ")[0]}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-1 rounded ${
                        ROLE_BADGE[currentUser.role] ??
                        "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                    </span>
                  </div>
                  <ChevronDown className="h-3 w-3 text-slate-400 hidden sm:block" />
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
                    className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      ROLE_BADGE[currentUser.role] ??
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                  </span>
                </div>
                <DropdownMenuSeparator />
                {currentUser.role === "admin" && (
                  <DropdownMenuItem
                    onClick={() => navigate("/admin/users")}
                  >
                    <Users className="w-4 h-4 mr-2" /> Manage Users
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-7">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

