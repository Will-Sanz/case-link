import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CaseManagerProfileClient } from "@/features/profile/case-manager-profile-client";
import { fetchCaseManagerProfileForCurrentUser } from "@/lib/services/case-manager-profile";

export default async function ProfilePage() {
  let profile;
  try {
    profile = await fetchCaseManagerProfileForCurrentUser();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "Unauthorized" || msg.toLowerCase().includes("jwt")) {
      redirect("/login");
    }
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profile"
          description="Manage your workspace identity and account."
        />
        <Card className="border-amber-200 bg-amber-50/50 p-6">
          <p className="text-sm font-medium text-amber-900">Could not load profile</p>
          <p className="mt-2 text-sm text-amber-800/90">{msg}</p>
          <p className="mt-4 text-sm text-amber-900/80">
            If this mentions a missing column, apply the latest database migration (see{" "}
            <code className="rounded bg-white/80 px-1 py-0.5 text-xs">supabase/migrations</code>
            ), then refresh.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            Back to Today
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Profile"
        description="Your workspace identity, preferences, and account actions in one place."
      />
      <CaseManagerProfileClient key={profile.updated_at} profile={profile} />
    </div>
  );
}
