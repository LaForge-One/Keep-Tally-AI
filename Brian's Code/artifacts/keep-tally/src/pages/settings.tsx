import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import {
  type DateFormatPreference,
  type ProfileTheme,
  type TimeFormatPreference,
  useDisplayPreferences,
} from "@/contexts/display-preferences-context";
import { useLocation as useWouterLocation } from "wouter";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Database,
  Download,
  FileSpreadsheet,
  Info,
  Mail,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  TrendingDown,
  Upload,
  Users,
  Warehouse,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SETTING_SECTIONS = [
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure low-stock alerts and daily summary emails.",
    status: "Designed",
  },
  {
    icon: Database,
    title: "Data & Exports",
    description: "Download operational CSVs and open import workflows.",
    status: "Available",
  },
  {
    icon: ShieldCheck,
    title: "Security",
    description: "Session timeouts, password policies, and login history.",
    status: "Coming soon",
  },
  {
    icon: Users,
    title: "Users & Permissions",
    description: "Manage account roles, locations, and feature access from the sidebar.",
    status: "Available",
  },
];

const DATE_FORMAT_LABELS: Record<DateFormatPreference, string> = {
  mdy: "June 7, 2026",
  iso: "2026-06-07",
  long: "Sunday, June 7, 2026",
};

const TIME_FORMAT_LABELS: Record<TimeFormatPreference, string> = {
  "12h": "3:45 PM",
  "24h": "15:45",
};

const THEME_LABELS: Record<ProfileTheme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

type ExportAction = {
  title: string;
  description: string;
  href: string;
  permission: "edit_store_inventory" | "view_warehouse";
  icon: typeof FileSpreadsheet;
};

const EXPORT_ACTIONS: ExportAction[] = [
  {
    title: "Restock List CSV",
    description: "Store items below minimum with recommended units needed.",
    href: `${BASE}/api/restock.csv`,
    permission: "edit_store_inventory",
    icon: ClipboardList,
  },
  {
    title: "Warehouse Inventory CSV",
    description: "Full warehouse item catalogue with quantity and par fields.",
    href: `${BASE}/api/warehouse/export/csv`,
    permission: "view_warehouse",
    icon: Warehouse,
  },
  {
    title: "Warehouse Reorder CSV",
    description: "Warehouse items below par or at reorder point.",
    href: `${BASE}/api/warehouse/reorder/csv`,
    permission: "view_warehouse",
    icon: FileSpreadsheet,
  },
  {
    title: "Purchase History CSV",
    description: "Warehouse receiving records and purchase cost history.",
    href: `${BASE}/api/warehouse/purchases/export`,
    permission: "view_warehouse",
    icon: Download,
  },
];

const NOTIFICATION_RULES = [
  {
    title: "Low-stock and out-of-stock alerts",
    description: "Notify assigned users when store inventory falls below minimum or reaches zero.",
    channel: "In-app now; email planned",
    status: "Design ready",
    icon: TrendingDown,
  },
  {
    title: "Daily operations summary",
    description: "Send a daily digest of restock needs, warehouse reorders, overstock, and recent shrinkage-coded events.",
    channel: "Email digest",
    status: "Backend needed",
    icon: Mail,
  },
  {
    title: "Warehouse reorder alerts",
    description: "Notify warehouse users when warehouse inventory falls below min par or reorder point.",
    channel: "In-app and email",
    status: "Backend needed",
    icon: Warehouse,
  },
  {
    title: "Import and data-change notices",
    description: "Confirm completed imports, large quantity changes, and failed import attempts for admins.",
    channel: "In-app first",
    status: "Backend needed",
    icon: Database,
  },
];

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const [, navigate] = useWouterLocation();
  const {
    profileTheme,
    dateFormat,
    timeFormat,
    setProfileTheme,
    setDateFormat,
    setTimeFormat,
  } = useDisplayPreferences();
  const availableExports = EXPORT_ACTIONS.filter((action) => hasPermission(action.permission));
  const canImportSales = hasPermission("edit_store_inventory");
  const canImportWarehouse = hasPermission("edit_warehouse");
  const canManageUsers = hasPermission("manage_users");

  return (
    <Layout>
      <div className="max-w-5xl space-y-5">
        <PageHeader
          title="Settings"
          description="Manage profile display preferences and application configuration"
        />

        <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3 shadow-sm">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Display preferences are available now</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Theme, date, and time selections are saved to this browser profile. Team-wide settings will be added later.
            </p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Palette className="h-4 w-4 text-primary" />
              </div>
              Display
            </CardTitle>
            <CardDescription>
              Customize your profile theme and how dates and times are shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {(["system", "light", "dark"] as ProfileTheme[]).map((theme) => {
                const selected = profileTheme === theme;
                const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Palette;
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => setProfileTheme(theme)}
                    className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-muted/60"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Icon className="h-4 w-4" />
                      {selected && <Badge variant="secondary" className="text-[10px]">Active</Badge>}
                    </div>
                    <p className="mt-2 text-sm font-bold">{THEME_LABELS[theme]}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {theme === "system" ? "Match device" : theme === "light" ? "Bright workspace" : "Low-light workspace"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Date format
                </span>
                <Select value={dateFormat} onValueChange={(value) => setDateFormat(value as DateFormatPreference)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mdy">Month day, year</SelectItem>
                    <SelectItem value="iso">ISO numeric</SelectItem>
                    <SelectItem value="long">Full weekday</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Preview: {DATE_FORMAT_LABELS[dateFormat]}</p>
              </label>

              <label className="space-y-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Time format
                </span>
                <Select value={timeFormat} onValueChange={(value) => setTimeFormat(value as TimeFormatPreference)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12h">12-hour clock</SelectItem>
                    <SelectItem value="24h">24-hour clock</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Preview: {TIME_FORMAT_LABELS[timeFormat]}</p>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Bell className="h-4 w-4 text-primary" />
              </div>
              Notifications
            </CardTitle>
            <CardDescription>
              Review the alert rules planned for low-stock events, warehouse reorders, and daily operations summaries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
              Notification preferences are not active yet. The header already surfaces in-app inventory alert counts; email and scheduled digests need backend preference storage, a mail provider, and a scheduler before they can be enabled.
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {NOTIFICATION_RULES.map(({ title, description, channel, status, icon: Icon }) => (
                <div key={title} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-foreground">{title}</p>
                        <Badge variant="secondary" className="text-[10px]">{status}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{channel}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["1", "Store account-level notification preferences"],
                ["2", "Add send pipeline for email and in-app events"],
                ["3", "Add scheduler for daily digest and threshold checks"],
              ].map(([step, label]) => (
                <div key={step} className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phase {step}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Database className="h-4 w-4 text-primary" />
              </div>
              Data & Exports
            </CardTitle>
            <CardDescription>
              Download available CSV reports or jump into the supported import workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-foreground">Available exports</p>
                  <p className="text-xs text-muted-foreground">Exports respect your current account permissions.</p>
                </div>
                <Badge variant="secondary" className="text-xs font-medium">{availableExports.length} available</Badge>
              </div>

              {availableExports.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No data exports are available for your current role.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {availableExports.map(({ title, description, href, icon: Icon }) => (
                    <a
                      key={title}
                      href={href}
                      download
                      className="group rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                            {title}
                            <Download className="h-3.5 w-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">Sales Import</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Open the Cantaloupe Go sales import workflow to preview and apply store sales deductions.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={!canImportSales}
                      onClick={() => navigate("/import")}
                    >
                      Open Sales Import
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Warehouse className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">Warehouse Import</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Open Warehouse to preview and apply CSV updates for warehouse inventory.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={!canImportWarehouse}
                      onClick={() => navigate("/warehouse")}
                    >
                      Open Warehouse Import
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800">
              Retention policy controls are not yet configurable from Settings. Archive and retention features remain enforced by their module workflows.
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <ShieldCheck className="h-4 w-4 text-primary" />
              </div>
              Admin Governance
            </CardTitle>
            <CardDescription>
              Security controls and role permissions live in the admin Users & Permissions module.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Users", "Create, deactivate, and reset team access."],
                ["Permissions", "Tune warehouse, store, voice, scanner, and report access by role."],
                ["Security", "Use password reset, must-change-password, role scope, and the global inactivity timeout."],
              ].map(([title, description]) => (
                <div key={title} className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-sm font-bold text-foreground">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
            <Button
              className="w-full sm:w-auto"
              disabled={!canManageUsers}
              onClick={() => navigate("/users")}
            >
              Open Admin Module
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SETTING_SECTIONS.filter(({ title }) => title !== "Security" && title !== "Users & Permissions").map(({ icon: Icon, title, description, status }) => (
            <Card key={title} className={`shadow-sm ${status === "Coming soon" ? "opacity-60" : ""}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  {title}
                </CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Badge variant="secondary" className="text-xs font-medium">{status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
