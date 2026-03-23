import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ensureAppUser, getSessionUser } from "@/lib/auth/session";
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
  await ensureAppUser(authUser);

  return <AppShell>{children}</AppShell>;
}
