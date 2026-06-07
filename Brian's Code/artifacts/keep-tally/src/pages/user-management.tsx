import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/auth-context";
import { LOCATIONS } from "@/contexts/location-context";
import { useLocation } from "wouter";
import {
  UserPlus,
  Pencil,
  KeyRound,
  UserX,
  UserCheck,
  ShieldCheck,
  Users,
  ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  warehouse: "Warehouse User",
  stocker: "Stocker",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warehouse: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  stocker: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

type User = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  assignedLocations: string[];
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

type Permissions = Record<string, Record<string, boolean>>;

const PERMISSION_LABELS: Record<string, string> = {
  manage_users: "Manage Users",
  delete_items: "Delete Items",
  edit_settings: "Edit Settings",
  view_costs: "View Cost & Pricing Data",
  view_all_reports: "View Company-Wide Reports",
  edit_warehouse: "Edit Warehouse Inventory",
  receive_purchases: "Receive Purchases",
  transfer_inventory: "Transfer Inventory to Stores",
  view_warehouse: "View Warehouse",
  edit_store_inventory: "Edit Store Inventory",
  scan_barcodes: "Scan Barcodes",
  use_voice_mode: "Use Tally Mode",
  mark_adjustments: "Mark Theft / Spoilage / Adjustments",
  view_all_locations: "View All Locations",
};

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${url}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export default function UserManagementPage() {
  const currentUser = useCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  // Add user form state
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "stocker",
    assignedLocations: [] as string[],
  });

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: User[] }>({
    queryKey: ["users"],
    queryFn: () => apiFetch("/api/users"),
  });

  const { data: permsData, isLoading: permsLoading } = useQuery<{
    permissions: Permissions;
    permissionKeys: string[];
  }>({
    queryKey: ["permissions"],
    queryFn: () => apiFetch("/api/permissions"),
  });

  const addMutation = useMutation({
    mutationFn: (data: typeof form) => apiFetch("/api/users", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setAddOpen(false);
      setForm({ username: "", displayName: "", password: "", role: "stocker", assignedLocations: [] });
      toast({ title: "User created", description: "They will be prompted to change their password on first login." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; displayName?: string; role?: string; assignedLocations?: string[]; active?: boolean }) =>
      apiFetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditUser(null);
      toast({ title: "User updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      apiFetch(`/api/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setResetUser(null);
      setNewPassword("");
      toast({ title: "Password reset", description: "User will be prompted to change it on next login." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const permMutation = useMutation({
    mutationFn: ({ role, key, enabled }: { role: string; key: string; enabled: boolean }) =>
      apiFetch(`/api/permissions/${role}/${key}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!currentUser || currentUser.role !== "admin") {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <ShieldCheck className="w-12 h-12 text-muted-foreground" />
          <p className="text-lg font-semibold">Admin Access Required</p>
          <Button variant="outline" onClick={() => setLocation("/")}>Go to Dashboard</Button>
        </div>
      </Layout>
    );
  }

  const users = usersData?.users ?? [];
  const permissions = permsData?.permissions ?? {};
  const permissionKeys = permsData?.permissionKeys ?? [];

  function toggleLocation(loc: string, currentLocs: string[], setLocs: (l: string[]) => void) {
    if (currentLocs.includes(loc)) {
      setLocs(currentLocs.filter((l) => l !== loc));
    } else {
      setLocs([...currentLocs, loc]);
    }
  }

  return (
    <Layout>
      <div className="flex flex-col gap-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6" /> User Management
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage team members and their access</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <UserPlus className="w-4 h-4" /> Add User
          </Button>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="w-full">
            <TabsTrigger value="users" className="flex-1">Users ({users.length})</TabsTrigger>
            <TabsTrigger value="permissions" className="flex-1">Role Permissions</TabsTrigger>
          </TabsList>

          {/* ── USERS TAB ── */}
          <TabsContent value="users" className="mt-4 flex flex-col gap-3">
            {usersLoading && <p className="text-muted-foreground text-sm">Loading users…</p>}
            {users.map((user) => (
              <Card key={user.id} className={`transition-opacity ${!user.active ? "opacity-60" : ""}`}>
                <CardContent className="flex items-start gap-3 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{user.displayName}</span>
                      <span className="text-xs text-muted-foreground">@{user.username}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[user.role] ?? ""}`}>
                        {ROLE_LABELS[user.role] ?? user.role}
                      </span>
                      {!user.active && <Badge variant="secondary">Inactive</Badge>}
                      {user.mustChangePassword && <Badge variant="outline" className="text-amber-600 border-amber-400">Password Reset</Badge>}
                      {user.id === currentUser.id && <Badge variant="outline" className="text-blue-600 border-blue-400">You</Badge>}
                    </div>
                    {user.assignedLocations.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Locations: {user.assignedLocations.join(", ")}
                      </p>
                    )}
                    {user.assignedLocations.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">All locations</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => setEditUser(user)} title="Edit user">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { setResetUser(user); setNewPassword(""); }} title="Reset password">
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    {user.id !== currentUser.id && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => editMutation.mutate({ id: user.id, active: !user.active })}
                        title={user.active ? "Deactivate user" : "Activate user"}
                      >
                        {user.active ? <UserX className="w-4 h-4 text-destructive" /> : <UserCheck className="w-4 h-4 text-green-600" />}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ── PERMISSIONS TAB ── */}
          <TabsContent value="permissions" className="mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              Toggle what each role can access. Admin always has full access.
            </p>
            {permsLoading && <p className="text-muted-foreground text-sm">Loading permissions…</p>}
            <div className="flex flex-col gap-4">
              {["warehouse", "stocker"].map((role) => (
                <Card key={role}>
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role]}`}>
                        {ROLE_LABELS[role]}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {permissionKeys.map((key) => (
                      <div key={key} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{PERMISSION_LABELS[key] ?? key}</span>
                        <Switch
                          checked={permissions[role]?.[key] ?? false}
                          onCheckedChange={(enabled) => permMutation.mutate({ role, key, enabled })}
                          disabled={permMutation.isPending}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Add User Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); addMutation.mutate(form); }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Display Name</Label>
              <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="Full name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))} placeholder="Lowercase, no spaces" autoCapitalize="none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Temporary Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="warehouse">Warehouse User</SelectItem>
                  <SelectItem value="stocker">Stocker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Assigned Locations <span className="text-muted-foreground font-normal">(leave empty = all)</span></Label>
              <div className="flex flex-wrap gap-2">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocation(loc, form.assignedLocations, (l) => setForm((f) => ({ ...f, assignedLocations: l })))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      form.assignedLocations.includes(loc)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={addMutation.isPending || !form.username || !form.displayName || !form.password}>
                {addMutation.isPending ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ── */}
      {editUser && (
        <Dialog open onOpenChange={() => setEditUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit {editUser.displayName}</DialogTitle>
            </DialogHeader>
            <EditUserForm
              user={editUser}
              onSave={(data) => editMutation.mutate({ id: editUser.id, ...data })}
              onCancel={() => setEditUser(null)}
              isPending={editMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ── Reset Password Dialog ── */}
      {resetUser && (
        <Dialog open onOpenChange={() => setResetUser(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Reset Password — {resetUser.displayName}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); resetMutation.mutate({ id: resetUser.id, newPassword }); }}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1.5">
                <Label>New Temporary Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
              </div>
              <p className="text-xs text-muted-foreground">The user will be prompted to change this on their next login.</p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetUser(null)}>Cancel</Button>
                <Button type="submit" disabled={resetMutation.isPending || newPassword.length < 6}>
                  {resetMutation.isPending ? "Resetting…" : "Reset Password"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Layout>
  );
}

function EditUserForm({
  user,
  onSave,
  onCancel,
  isPending,
}: {
  user: User;
  onSave: (data: { displayName: string; role: string; assignedLocations: string[] }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState(user.role);
  const [assignedLocations, setAssignedLocations] = useState<string[]>(user.assignedLocations);

  function toggleLocation(loc: string) {
    setAssignedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave({ displayName, role, assignedLocations }); }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label>Display Name</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Role</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="warehouse">Warehouse User</SelectItem>
            <SelectItem value="stocker">Stocker</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Assigned Locations <span className="text-muted-foreground font-normal">(empty = all)</span></Label>
        <div className="flex flex-wrap gap-2">
          {LOCATIONS.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => toggleLocation(loc)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                assignedLocations.includes(loc)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {loc}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter className="mt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={isPending || !displayName}>
          {isPending ? "Saving…" : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
