import type { ReactNode } from "react";
import { ParentShell } from "@/features/parent/parent-shell";
import { getParentSession } from "@/lib/parent/auth";
import { isParentConfigured } from "@/lib/parent/config";
export const dynamic = "force-dynamic";
export default async function ParentLayout({
  children,
}: {
  children: ReactNode;
}) {
  let signedIn = false;
  if (isParentConfigured()) {
    try {
      signedIn = Boolean(await getParentSession());
    } catch {
      /* The page's API request presents session recovery without exposing account details. */
    }
  }
  return <ParentShell signedIn={signedIn}>{children}</ParentShell>;
}
