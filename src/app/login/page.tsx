import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { LoginForm } from "@/features/auth/login-form";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  if (
    process.env.CASELINK_PRODUCT === "parent" &&
    process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing"
  ) {
    const { message, error } = await searchParams;
    redirect(
      message === "password-reset-success"
        ? "/sign-in?message=password-reset-success"
        : error === "auth"
          ? "/sign-in?error=auth"
          : "/sign-in",
    );
  }
  const user = await getSessionUser();
  if (user) {
    redirect("/families");
  }

  return (
    <AuthShell
      title="CaseLink"
      subtitle="Sign in to manage family plans and PDF exports."
    >
      <h2 className="text-base font-semibold text-[var(--public-ink)]">
        Case manager login
      </h2>
      <div className="mt-5">
        <Suspense
          fallback={
            <p className="text-sm text-[var(--public-ink-muted)]">Loading…</p>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
      <p className="mt-6 text-center text-xs text-[var(--public-ink-muted)]">
        <Link
          href="/"
          className="font-medium text-[var(--public-accent)] underline-offset-2 hover:text-[var(--public-accent-hover)] hover:underline"
        >
          Home
        </Link>
      </p>
    </AuthShell>
  );
}
