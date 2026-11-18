import type { Metadata } from "next";
import { ParentIntake } from "@/features/parent/intake";
import { canonicalProjectOrigin } from "@/lib/parent/project-origin";
import { parentEmailCodeEnabled } from "@/lib/parent/configuration";
import { readParentLocale } from "@/lib/parent/locale-server";
import { parentText } from "@/lib/parent/locale";
export async function generateMetadata(): Promise<Metadata> { return { title: parentText(await readParentLocale(), "Get support") }; }
export default async function GetSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const { need } = await searchParams;
  const existing = process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing";
  const recovery = canonicalProjectOrigin(process.env.CASELINK_PARENT_RECOVERY_SITE_URL);
  return <ParentIntake initialNeed={need ?? "food"} signInOptions={{ existingAccountRecovery: existing,
    recoveryHref: existing && recovery?.startsWith("https://") ? `${recovery}/forgot-password` : undefined,
    emailCodeAvailable: parentEmailCodeEnabled(process.env) }}/>;
}
