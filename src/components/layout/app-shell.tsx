import type { ReactNode } from "react";
import { FamilyCaseChrome } from "@/components/layout/family-case-chrome";
import type { UserRole } from "@/types/user-role";

export function AppShell({
  email,
  role,
  children,
}: {
  email: string;
  role: UserRole;
  children: ReactNode;
}) {
  return (
    <FamilyCaseChrome email={email} role={role}>
      {children}
    </FamilyCaseChrome>
  );
}
