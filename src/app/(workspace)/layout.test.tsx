import { expect, it, vi } from "vitest";
import WorkspaceLayout from "./layout";
import { AuthenticationRequiredError, PasswordSetupRequiredError, SessionUnavailableError } from "@/lib/auth/session-errors";
const m = vi.hoisted(() => ({ ensure: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: m.ensure }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
it("routes an invitation session to password setup before rendering workspace content", async () => {
  m.ensure.mockRejectedValue(new PasswordSetupRequiredError());
  await expect(WorkspaceLayout({ children: "Sensitive workspace content" })).rejects.toThrow("redirect:/reset-password?mode=setup");
  expect(m.redirect).toHaveBeenCalledWith("/reset-password?mode=setup");
});
it("renders the workspace after the invited user's password session is verified", async () => {
  m.ensure.mockResolvedValue({ user: { id: "invited-staff", role: "admin" } });
  const page = await WorkspaceLayout({ children: "Sensitive workspace content" });
  expect(page.props.userId).toBe("invited-staff");
  expect(page.props.children.props.children).toBe("Sensitive workspace content");
});
it("denies an anonymous request and preserves a service failure for retry", async () => {
  m.ensure.mockRejectedValue(new AuthenticationRequiredError());
  await expect(WorkspaceLayout({ children: "Sensitive workspace content" })).rejects.toThrow("redirect:/login");
  m.ensure.mockRejectedValue(new SessionUnavailableError());
  await expect(WorkspaceLayout({ children: "Sensitive workspace content" })).rejects.toBeInstanceOf(SessionUnavailableError);
});
