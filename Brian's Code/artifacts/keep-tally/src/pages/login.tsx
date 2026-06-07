import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  LogIn,
  Package,
  ShieldCheck,
} from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const submittedUsername = String(formData.get("username") ?? "").trim();
    const submittedPassword = String(formData.get("password") ?? "");

    setError(null);
    if (!submittedUsername || !submittedPassword) {
      setError("Enter both username and password.");
      return;
    }

    setLoading(true);
    try {
      const result = await login(submittedUsername, submittedPassword);
      setLocation(result.mustChangePassword ? "/change-password" : "/");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Login failed. Check your credentials and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f4f7fb] p-4">
      <div className="w-full max-w-[380px] overflow-hidden rounded-xl border border-slate-200 bg-card shadow-xl">
        <div className="bg-primary px-7 pb-6 pt-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-primary-foreground shadow-sm">
            <Package className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mb-1 text-lg font-bold tracking-tight text-primary-foreground">
            KeepTally
          </h1>
          <p className="text-xs font-medium text-primary-foreground/70">
            Sign in to your inventory workspace
          </p>
        </div>

        <div className="bg-card px-7 pb-7 pt-6">
          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-3.5"
          >
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="username"
                className="text-[11.5px] font-semibold text-muted-foreground"
              >
                Username
              </Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                  aria-hidden="true"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </span>
                <Input
                  id="username"
                  name="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  placeholder="username"
                  className="pl-8 pr-3 transition-interactive"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="text-[11.5px] font-semibold text-muted-foreground"
                >
                  Password
                </Label>
                <span className="text-[11.5px] font-medium text-muted-foreground/70">
                  Password reset by admin
                </span>
              </div>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                  aria-hidden="true"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <Input
                  id="password"
                  name="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="password"
                  className="pl-8 pr-9 transition-interactive"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((value) => !value)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  aria-pressed={showPass}
                  disabled={loading}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 border-none bg-transparent p-0 text-muted-foreground/55 transition-interactive hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {showPass ? (
                    <EyeOff className="h-[15px] w-[15px]" />
                  ) : (
                    <Eye className="h-[15px] w-[15px]" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-1 w-full gap-2 transition-interactive"
            >
              <LogIn className="h-4 w-4" />
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium text-muted-foreground">
              or
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 transition-interactive"
            disabled
            title="Single sign-on is not configured for this test environment."
          >
            <Building2 className="h-4 w-4" />
            Continue with SSO
          </Button>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
            <span className="mb-0.5 inline-flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 opacity-70" aria-hidden="true" />
              Protected by Reed Cloud Security
            </span>
            <br />
            Test environment access is limited to approved users.
          </p>
        </div>
      </div>
    </div>
  );
}
