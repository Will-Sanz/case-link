import type { ReactNode } from "react";
import { AiModeProvider } from "@/components/providers/ai-mode-provider";
import { FamilyCaseChrome } from "@/components/layout/family-case-chrome";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AiModeProvider>
      <FamilyCaseChrome>{children}</FamilyCaseChrome>
    </AiModeProvider>
  );
}
