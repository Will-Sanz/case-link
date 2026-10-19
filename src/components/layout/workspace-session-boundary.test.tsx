/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";
import { DRAFT_LOGOUT_KEY, DRAFT_PREFIX } from "@/lib/domain/plan/local-action-draft";
const m = vi.hoisted(() => ({ onAuth: vi.fn(), unsubscribe: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: m.onAuth } }) }));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  m.onAuth.mockReturnValue({ data: { subscription: { unsubscribe: m.unsubscribe } } });
});
function mount() {
  render(<WorkspaceSessionBoundary userId="current"><span>Current case</span></WorkspaceSessionBoundary>);
  return m.onAuth.mock.calls.at(-1)![0];
}
it("keeps the current account's workspace on ordinary token renewal", () => {
  const notify = mount();
  act(() => notify("TOKEN_REFRESHED", { user: { id: "current" } }));
  expect(screen.getByText("Current case")).toBeTruthy();
  expect(m.router.replace).not.toHaveBeenCalled();
});
it("hides case content when another account signs in and clears drafts", () => {
  const notify = mount();
  sessionStorage.setItem(`${DRAFT_PREFIX}old`, "raw case edit");
  act(() => notify("SIGNED_IN", { user: { id: "other" } }));
  expect(screen.queryByText("Current case")).toBeNull();
  expect(sessionStorage.length).toBe(0);
  expect(m.router.replace).toHaveBeenCalledWith("/login");
});
it("preserves a draft on automatic session expiration for the same account to recover", () => {
  const notify = mount();
  sessionStorage.setItem(`${DRAFT_PREFIX}old`, "recovery is retained until validated on next read");
  act(() => notify("SIGNED_OUT", null));
  expect(screen.queryByText("Current case")).toBeNull();
  expect(sessionStorage.length).toBe(1);
});
it("hides the current case after explicit logout in another tab", () => {
  mount();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: DRAFT_LOGOUT_KEY })));
  expect(screen.queryByText("Current case")).toBeNull();
  expect(m.router.replace).toHaveBeenCalledWith("/login");
});
