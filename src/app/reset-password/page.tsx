import { AuthShell } from "@/components/layout/auth-shell";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { explicitParentLocale, parentText } from "@/lib/parent/locale";
import { readParentLocale } from "@/lib/parent/locale-server";
import { ParentRecoveryLocale } from "@/features/parent/parent-locale";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ mode?: string; ui?: string }> }) {
  const params = await searchParams;
  const isSetup = params.mode === "setup";
  const requestedLocale = explicitParentLocale(params.ui);
  const locale = requestedLocale ?? (process.env.CASELINK_PRODUCT === "parent" ? await readParentLocale() : "en");
  const t = (english: string) => parentText(locale, english);
  return (
    <ParentRecoveryLocale requestedLocale={requestedLocale}><AuthShell
      title="CaseLink"
      subtitle={t("Set a new password to secure your account.")}
    >
      <h2 className="text-base font-semibold text-[var(--public-ink)]">{t(isSetup ? "Set your password" : "Reset password")}</h2>
      <div className="mt-5">
        <ResetPasswordForm />
      </div>
    </AuthShell></ParentRecoveryLocale>
  );
}
