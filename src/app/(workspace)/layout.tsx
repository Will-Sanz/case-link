import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ensureAppUser, getSessionUser } from "@/lib/auth/session";
import { MfaRequiredError, PasswordSetupRequiredError } from "@/lib/auth/session-errors";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const authUser = await getSessionUser();
  if (!authUser) {
    redirect("/login");
  }
  try {
    await ensureAppUser(authUser);
  } catch (error) {
    if (error instanceof PasswordSetupRequiredError) redirect("/reset-password?mode=setup");
    if (error instanceof MfaRequiredError) redirect("/verify-account");
    throw error;
  }

  return <AppShell>{children}</AppShell>;
}
