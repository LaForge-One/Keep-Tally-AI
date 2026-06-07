import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type DateFormatPreference,
  type ProfileTheme,
  type TimeFormatPreference,
  useDisplayPreferences,
} from "@/contexts/display-preferences-context";
import { Bell, CalendarClock, Database, Info, Moon, Palette, ShieldCheck, Sun, Users } from "lucide-react";

const SETTING_SECTIONS = [
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure low-stock alerts and daily summary emails.",
    status: "Coming soon",
  },
  {
    icon: Database,
    title: "Data & Exports",
    description: "Configure automatic CSV exports and data retention policies.",
    status: "Coming soon",
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

export default function SettingsPage() {
  const {
    profileTheme,
    dateFormat,
    timeFormat,
    setProfileTheme,
    setDateFormat,
    setTimeFormat,
  } = useDisplayPreferences();

  return (
    <Layout>
      <div className="max-w-3xl space-y-5">
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SETTING_SECTIONS.map(({ icon: Icon, title, description, status }) => (
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
