import { Layout } from "@/components/layout";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, Bell, Palette, Database, ShieldCheck, Users, Info } from "lucide-react";

const SETTING_SECTIONS = [
  {
    icon: Bell,
    title: "Notifications",
    description: "Configure low-stock alerts and daily summary emails.",
    status: "Coming soon",
  },
  {
    icon: Palette,
    title: "Display",
    description: "Customize appearance, date formats, and default views.",
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
];

export default function SettingsPage() {
  return (
    <Layout>
      <div className="space-y-5 max-w-2xl">
        <PageHeader
          title="Settings"
          description="Manage your application preferences and configuration"
        />

        <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3 shadow-sm">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Settings are coming in a future update</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              User management and permissions can be configured under{" "}
              <span className="font-medium text-foreground">Users &amp; Permissions</span> in the sidebar.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SETTING_SECTIONS.map(({ icon: Icon, title, description, status }) => (
            <Card key={title} className="shadow-sm opacity-60">
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
