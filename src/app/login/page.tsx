import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "@/features/auth/login-form";
import { getSessionUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const next =
    typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "";
  const signupHref =
    next !== "" ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <AuthShell
      title="CaseLink"
      subtitle="Sign in to manage families and community resources."
    >
      <h2 className="text-base font-semibold text-slate-900">Case manager login</h2>
      <div className="mt-5">
        <Suspense
          fallback={<p className="text-sm text-slate-500">Loading…</p>}
        >
          <LoginForm />
        </Suspense>
      </div>
      <p className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
        New case manager?{" "}
        <Link
          href={signupHref}
          className="font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
        >
          Create an account
        </Link>
      </p>
      <p className="mt-4 text-center text-xs text-slate-500">
        <Link href="/" className="font-medium text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline">
          Home
        </Link>
        {" · "}
        <Link
          href="/about"
          className="font-medium text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline"
        >
          About CaseLink
        </Link>
      </p>
    </AuthShell>
  );
}
