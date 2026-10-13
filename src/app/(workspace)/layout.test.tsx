import { expect, it, vi } from "vitest";
import WorkspaceLayout from "./layout";
import { PasswordSetupRequiredError } from "@/lib/auth/session-errors";
const m = vi.hoisted(() => ({ ensure: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: "invited-staff" }), ensureAppUser: m.ensure }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
it("routes an invitation session to password setup before rendering workspace content", async () => {
  m.ensure.mockRejectedValue(new PasswordSetupRequiredError());
  await expect(WorkspaceLayout({ children: "Sensitive workspace content" })).rejects.toThrow("redirect:/reset-password?mode=setup");
  expect(m.redirect).toHaveBeenCalledWith("/reset-password?mode=setup");
});
