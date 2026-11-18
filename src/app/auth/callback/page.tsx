import { Suspense } from "react";
import { AuthCallbackClient } from "@/app/auth/callback/auth-callback-client";
import { ParentRecoveryLocale } from "@/features/parent/parent-locale";
import { explicitParentLocale, parentText } from "@/lib/parent/locale";

export const dynamic = "force-dynamic";

export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<{ ui?: string }> }) {
  const locale = explicitParentLocale((await searchParams).ui);
  return (
    <ParentRecoveryLocale requestedLocale={locale}><main className="flex min-h-[50vh] flex-col items-center justify-center bg-[#f4f6f8] px-4">
      <Suspense
        fallback={<p className="text-sm text-slate-500">{parentText(locale ?? "en", "Loading…")}</p>}
      >
        <AuthCallbackClient />
      </Suspense>
    </main></ParentRecoveryLocale>
  );
}
