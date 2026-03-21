import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/login-form";
import { getSessionUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

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
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-100 px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900">CaseLink</h1>
          <p className="mt-1 text-sm text-slate-600">
            Sign in to manage families and resources.
          </p>
        </div>
        <Card>
          <CardTitle className="text-base">Case manager login</CardTitle>
          <div className="mt-4">
            <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
              <LoginForm />
            </Suspense>
          </div>
          <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
            New case manager?{" "}
            <Link
              href={signupHref}
              className="font-medium text-slate-900 underline-offset-2 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
