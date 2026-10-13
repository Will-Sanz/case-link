import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { MfaForm } from "@/features/auth/mfa-form";
import { safeInternalPath } from "@/lib/auth/safe-internal-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function VerifyAccountPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; mode?: string | string[] }> }) {
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const account = await supabase.from("app_users").select("role, is_active").eq("id", user.id).maybeSingle();
  if (account.error || !account.data?.is_active) throw new Error("This account is unavailable. Contact your school administrator.");
  return (
    <AuthShell title="Two-step verification" subtitle="Protect your CaseLink account with an authenticator app.">
      <MfaForm key={user.id} required={account.data.role === "admin"} manage={query.mode === "manage"} nextPath={safeInternalPath(typeof query.next === "string" ? query.next : undefined)} />
    </AuthShell>
  );
}
