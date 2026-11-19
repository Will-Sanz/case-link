import { AuthShell } from "@/components/layout/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";
import { redirect } from "next/navigation";
import { getParentConfig } from "@/lib/parent/config";
import { explicitParentLocale, parentRecoveryHref, parentText } from "@/lib/parent/locale";
import { readParentLocale } from "@/lib/parent/locale-server";
import { ParentRecoveryLocale } from "@/features/parent/parent-locale";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ ui?: string }> }) {
  const requestedLocale = explicitParentLocale((await searchParams).ui);
  const locale = requestedLocale ?? (process.env.CASELINK_PRODUCT === "parent" ? await readParentLocale() : "en");
  const t = (english: string) => parentText(locale, english);
  if (
    process.env.CASELINK_PRODUCT === "parent" &&
    process.env.CASELINK_ENVIRONMENT === "connected"
  ) {
    getParentConfig();
    redirect(
      parentRecoveryHref(`${process.env.CASELINK_PARENT_RECOVERY_SITE_URL}/forgot-password`, locale),
    );
  }
  return (
    <ParentRecoveryLocale requestedLocale={requestedLocale}><AuthShell
      title="CaseLink"
      subtitle={t("Get a secure sign-in link if you can't access your password.")}
    >
      <h2 className="text-base font-semibold text-[var(--public-ink)]">
        {t("Forgot password")}
      </h2>
      <div className="mt-5">
        <ForgotPasswordForm />
      </div>
    </AuthShell></ParentRecoveryLocale>
  );
}
