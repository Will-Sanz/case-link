import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { AuthenticationRequiredError, PasswordSetupRequiredError } from "@/lib/auth/session-errors";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceSessionBoundary } from "@/components/layout/workspace-session-boundary";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireAppUserWithClient().catch((error: unknown) => {
    if (error instanceof AuthenticationRequiredError) redirect("/login");
    if (error instanceof PasswordSetupRequiredError) redirect("/reset-password?mode=setup");
    throw error;
  });

  return <WorkspaceSessionBoundary key={user.id} userId={user.id}><AppShell>{children}</AppShell></WorkspaceSessionBoundary>;
}
