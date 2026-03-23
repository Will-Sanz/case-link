import type { ReactNode } from "react";
import { FamilyCaseChrome } from "@/components/layout/family-case-chrome";

export function AppShell({ children }: { children: ReactNode }) {
  return <FamilyCaseChrome>{children}</FamilyCaseChrome>;
}
