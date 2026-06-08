import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
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

type SettingsSection = "display" | "notifications" | "data" | "admin";

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

type NotificationPreference = {
  id: number;
  eventType: string;
  label: string;
  enabled: boolean;
  channels: string[];
  digestFrequency: "instant" | "daily" | "weekly";
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAt: string;
};

type NotificationEvent = {
  id: number;
  eventType: string;
  severity: string;
  title: string;
  message: string;
  readAt: string | null;
  deliveryStatus: string;
  createdAt: string;
};

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const [, navigate] = useWouterLocation();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<SettingsSection>("display");
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<NotificationEvent[]>([]);
  const [emailProviderConfigured, setEmailProviderConfigured] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsGenerating, setNotificationsGenerating] = useState(false);
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
  const canEditSettings = hasPermission("edit_settings");
  const enabledNotificationCount = useMemo(
    () => notificationPreferences.filter((pref) => pref.enabled).length,
    [notificationPreferences],
  );
  const settingsDashboard = [
    {
      id: "display" as const,
      title: "Display",
      description: "Theme, dates, and time format.",
      badge: THEME_LABELS[profileTheme],
      icon: Palette,
      tone: "bg-sky-50 text-sky-700 border-sky-200",
    },
    {
      id: "notifications" as const,
      title: "Notifications",
      description: "Alerts, digest rules, and event history.",
      badge: `${enabledNotificationCount} active`,
      icon: Bell,
      tone: "bg-cyan-50 text-cyan-700 border-cyan-200",
    },
    {
      id: "data" as const,
      title: "Data & Exports",
      description: "CSV exports and import workflows.",
      badge: `${availableExports.length} exports`,
      icon: Database,
      tone: "bg-blue-50 text-blue-700 border-blue-200",
    },
    {
      id: "admin" as const,
      title: "Admin Governance",
      description: "Users, permissions, and security controls.",
      badge: canManageUsers ? "Available" : "Restricted",
      icon: ShieldCheck,
      tone: "bg-indigo-50 text-indigo-700 border-indigo-200",
    },
  ];

  async function loadNotificationModule() {
    if (!canEditSettings) {
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    try {
      const [settingsRes, eventsRes] = await Promise.all([
        fetch(`${BASE}/api/settings/notifications`, { credentials: "include" }),
        fetch(`${BASE}/api/notifications?limit=5`, { credentials: "include" }),
      ]);
      if (!settingsRes.ok) throw new Error("Failed to load notification preferences");
      const settingsData = await settingsRes.json() as {
        preferences: NotificationPreference[];
        emailProviderConfigured: boolean;
      };
      setNotificationPreferences(settingsData.preferences);
      setEmailProviderConfigured(settingsData.emailProviderConfigured);

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json() as { notifications: NotificationEvent[] };
        setRecentNotifications(eventsData.notifications);
      }
    } catch (err) {
      toast({
        title: "Notifications could not load",
        description: err instanceof Error ? err.message : "Try refreshing the Settings page.",
        variant: "destructive",
      });
    } finally {
      setNotificationsLoading(false);
    }
  }

  useEffect(() => {
    void loadNotificationModule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEditSettings]);

  function patchNotificationPreference(eventType: string, patch: Partial<NotificationPreference>) {
    setNotificationPreferences((current) =>
      current.map((pref) => pref.eventType === eventType ? { ...pref, ...patch } : pref),
    );
  }

  function toggleNotificationChannel(eventType: string, channel: "in_app" | "email", enabled: boolean) {
    setNotificationPreferences((current) =>
      current.map((pref) => {
        if (pref.eventType !== eventType) return pref;
        const channels = new Set(pref.channels);
        if (enabled) channels.add(channel);
        if (!enabled && channels.size > 1) channels.delete(channel);
        return { ...pref, channels: Array.from(channels) };
      }),
    );
  }

  async function saveNotificationPreferences() {
    setNotificationsSaving(true);
    try {
      const res = await fetch(`${BASE}/api/settings/notifications`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: notificationPreferences }),
      });
      if (!res.ok) throw new Error("Failed to save notification preferences");
      const data = await res.json() as { preferences: NotificationPreference[] };
      setNotificationPreferences(data.preferences);
      toast({ title: "Notification preferences saved" });
    } catch (err) {
      toast({
        title: "Notification preferences were not saved",
        description: err instanceof Error ? err.message : "Try again after checking the server logs.",
        variant: "destructive",
      });
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function generateNotifications() {
    setNotificationsGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/notifications/generate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate notification events");
      await loadNotificationModule();
      toast({ title: "Notification events refreshed" });
    } catch (err) {
      toast({
        title: "Notification event generation failed",
        description: err instanceof Error ? err.message : "Try again after checking the server logs.",
        variant: "destructive",
      });
    } finally {
      setNotificationsGenerating(false);
    }
  }

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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {settingsDashboard.map(({ id, title, description, badge, icon: Icon, tone }) => {
            const selected = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md ${
                  selected ? "border-primary ring-2 ring-primary/15" : "border-border"
                }`}
                aria-pressed={selected}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <Badge variant={selected ? "default" : "secondary"} className="text-[10px]">
                    {badge}
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-bold text-foreground">{title}</p>
                <p className="mt-1 min-h-8 text-xs leading-relaxed text-muted-foreground">{description}</p>
              </button>
            );
          })}
        </div>

        {activeSection === "display" && (
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
        )}

        {activeSection === "notifications" && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Bell className="h-4 w-4 text-primary" />
              </div>
              Notifications
            </CardTitle>
            <CardDescription>
              Configure in-app operational alerts, digest preferences, and provider-ready email delivery.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold">Notification preferences are active</p>
                <p className="mt-0.5">
                  In-app events are stored now. Email channels remain provider-ready and will stay pending until a transactional provider is configured.
                </p>
              </div>
              <Badge variant={emailProviderConfigured ? "default" : "secondary"} className="w-fit">
                {emailProviderConfigured ? "Email provider ready" : "Email provider pending"}
              </Badge>
            </div>

            {notificationsLoading ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Loading notification settings...
              </div>
            ) : notificationPreferences.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                Notification settings are only available to users with Settings permission.
              </div>
            ) : (
              <div className="space-y-3">
                {notificationPreferences.map((pref) => {
                  const rule = NOTIFICATION_RULES.find((item) =>
                    item.title.toLowerCase().includes(pref.label.split(" ")[0]?.toLowerCase() ?? ""),
                  );
                  const Icon = rule?.icon ?? Bell;
                  return (
                    <div key={pref.eventType} className="rounded-lg border border-border bg-background p-4">
                      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-bold text-foreground">{pref.label}</p>
                              <Badge variant={pref.enabled ? "default" : "secondary"} className="text-[10px]">
                                {pref.enabled ? "Enabled" : "Disabled"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {rule?.description ?? "Saved notification preference."}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[auto_auto_150px] sm:items-center">
                          <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Switch
                              checked={pref.enabled}
                              onCheckedChange={(checked) => patchNotificationPreference(pref.eventType, { enabled: checked })}
                            />
                            Active
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {(["in_app", "email"] as const).map((channel) => (
                              <Button
                                key={channel}
                                type="button"
                                variant={pref.channels.includes(channel) ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleNotificationChannel(pref.eventType, channel, !pref.channels.includes(channel))}
                              >
                                {channel === "in_app" ? "In-app" : "Email"}
                              </Button>
                            ))}
                          </div>
                          <Select
                            value={pref.digestFrequency}
                            onValueChange={(value) => patchNotificationPreference(pref.eventType, { digestFrequency: value as NotificationPreference["digestFrequency"] })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="instant">Instant</SelectItem>
                              <SelectItem value="daily">Daily</SelectItem>
                              <SelectItem value="weekly">Weekly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-sm font-bold text-foreground">{enabledNotificationCount} active alert rules</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generated event lists remain capped at 50 records for readability.
                </p>
              </div>
              <Button variant="outline" disabled={!canEditSettings || notificationsGenerating} onClick={generateNotifications}>
                {notificationsGenerating ? "Refreshing..." : "Generate Events"}
              </Button>
              <Button disabled={!canEditSettings || notificationsSaving} onClick={saveNotificationPreferences}>
                {notificationsSaving ? "Saving..." : "Save Preferences"}
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-foreground">Recent notification events</p>
                  <p className="text-xs text-muted-foreground">Latest in-app alerts generated for your user.</p>
                </div>
                <Badge variant="secondary">{recentNotifications.length} shown</Badge>
              </div>
              {recentNotifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notification events have been generated for your user yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentNotifications.map((event) => (
                    <div key={event.id} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{event.title}</p>
                        <Badge variant={event.readAt ? "secondary" : "default"} className="text-[10px]">
                          {event.readAt ? "Read" : "Unread"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.message}</p>
                      <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {event.eventType.replace(/_/g, " ")} | {event.deliveryStatus}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["1", "Preference storage and in-app event list", "Complete"],
                ["2", "Admin controls and unread notification UI", "Complete"],
                ["3", "Digest generator with email-ready delivery status", "Complete"],
              ].map(([step, label, status]) => (
                <div key={step} className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Phase {step}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{label}</p>
                  <Badge variant="secondary" className="mt-2 text-[10px]">{status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        )}

        {activeSection === "data" && (
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
        )}

        {activeSection === "admin" && (
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
        )}
      </div>
    </Layout>
  );
}
