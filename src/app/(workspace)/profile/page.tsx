import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { CaseManagerProfileClient } from "@/features/profile/case-manager-profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  try {
    const { user, supabase } = await requireAppUserWithClient();
    const { data: profile, error } = await supabase
      .from("app_users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      redirect("/families");
    }

    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-8">
        <Suspense fallback={<p className="text-sm text-slate-500">Loading profile…</p>}>
          <CaseManagerProfileClient profile={profile} />
        </Suspense>
      </div>
    );
  } catch {
    redirect("/login");
  }
}
