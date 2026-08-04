import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { CaseManagerProfileClient } from "@/features/profile/case-manager-profile-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function ProfilePage() {
  const auth = await requireAppUserWithClient().catch(() => null);
  if (!auth) {
    redirect("/login");
  }
  const { user, supabase } = auth;
  const { data: profile, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/families");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#173a15] sm:text-4xl">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d705a]">
          Manage how you appear in CaseLink and set a few defaults for your casework.
        </p>
      </header>
      <Suspense fallback={<p className="mt-8 text-sm text-[#5d705a]">Loading settings…</p>}>
        <CaseManagerProfileClient profile={profile} />
      </Suspense>
    </div>
  );
}
