import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { SignUpForm } from "@/features/auth/sign-up-form";
import { getSessionUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignUpPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (user) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const next =
    typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "";
  const loginHref =
    next !== "" ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-100 px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900">CaseLink</h1>
          <p className="mt-1 text-sm text-slate-600">
            Create a case manager account.
          </p>
        </div>
        <Card>
          <CardTitle className="text-base">Sign up</CardTitle>
          <div className="mt-4">
            <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
              <SignUpForm />
            </Suspense>
          </div>
          <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link
              href={loginHref}
              className="font-medium text-slate-900 underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
