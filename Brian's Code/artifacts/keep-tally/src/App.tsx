import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocationProvider } from "@/contexts/location-context";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import HistoryPage from "@/pages/history";
import RestockPage from "@/pages/restock";
import VoiceCheck from "@/pages/voice-check";
import OrdersPage from "@/pages/orders";
import RouteSheetsPage from "@/pages/route-sheets";
import OrderDetailPage from "@/pages/order-detail";
import OrderPrintPage from "@/pages/order-print";
import ImportPage from "@/pages/import";
import ScanPage from "@/pages/scan";
import WarehousePage from "@/pages/warehouse";
import WarehouseDetailPage from "@/pages/warehouse-detail";
import WarehouseVoicePage from "@/pages/warehouse-voice";
import WarehousePurchasesPage from "@/pages/warehouse-purchases-page";
import LoginPage from "@/pages/login";
import ChangePasswordPage from "@/pages/change-password";
import UserManagementPage from "@/pages/user-management";
import SettingsPage from "@/pages/settings";
import AgentInsightsPage from "@/pages/agent-insights";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 3;
      },
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { authState } = useAuth();

  if (authState.status === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (authState.status === "unauthenticated") {
    return <Redirect to="/login" />;
  }

  if (authState.status === "authenticated" && authState.user.mustChangePassword) {
    return <Redirect to="/change-password" />;
  }

  return <Component />;
}

function Router() {
  const { authState } = useAuth();
  const [location] = useLocation();

  // While auth is loading, show a blank page (avoids redirect flash)
  if (authState.status === "loading") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={LoginPage} />
      <Route path="/change-password" component={ChangePasswordPage} />

      {/* Protected routes */}
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={Inventory} />} />
      <Route path="/restock" component={() => <ProtectedRoute component={RestockPage} />} />
      <Route path="/history" component={() => <ProtectedRoute component={HistoryPage} />} />
      <Route path="/agents" component={() => <ProtectedRoute component={AgentInsightsPage} />} />
      <Route path="/voice-check" component={() => <ProtectedRoute component={VoiceCheck} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={OrdersPage} />} />
      <Route path="/route-sheets" component={() => <ProtectedRoute component={RouteSheetsPage} />} />
      <Route path="/orders/:id/print" component={() => <ProtectedRoute component={OrderPrintPage} />} />
      <Route path="/orders/:id" component={() => <ProtectedRoute component={OrderDetailPage} />} />
      <Route path="/import" component={() => <ProtectedRoute component={ImportPage} />} />
      <Route path="/scan" component={() => <ProtectedRoute component={ScanPage} />} />
      <Route path="/warehouse/voice" component={() => <ProtectedRoute component={WarehouseVoicePage} />} />
      <Route path="/warehouse/purchases" component={() => <ProtectedRoute component={WarehousePurchasesPage} />} />      <Route path="/warehouse/:id" component={() => <ProtectedRoute component={WarehouseDetailPage} />} />
      <Route path="/warehouse" component={() => <ProtectedRoute component={WarehousePage} />} />
      <Route path="/admin/users" component={() => <ProtectedRoute component={UserManagementPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LocationProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </LocationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

