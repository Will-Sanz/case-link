/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthCallbackClient } from "./auth-callback-client";

const m = vi.hoisted(() => ({ exchange: vi.fn(), factory: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: m.factory }));
const session = { user: { id: "staff-a" } };
beforeEach(() => {
  window.history.replaceState(null, "", "/auth/callback?code=synthetic-code&next=/profile");
  m.factory.mockImplementation(() => {
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    return { auth: { exchangeCodeForSession: m.exchange, getSession: async () => ({ data: { session } }), getUser: async () => ({ data: { user: session.user } }) } };
  });
});
it("exchanges a one-time code only once in Strict Mode", async () => {
  m.exchange.mockResolvedValue({ data: { session } });
  render(<StrictMode><AuthCallbackClient /></StrictMode>);
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/profile"));
  expect(m.exchange).toHaveBeenCalledTimes(1);
  expect(m.router.replace).toHaveBeenCalledTimes(1);
});
it("shares an in-flight exchange across a real remount and ignores the unmounted screen", async () => {
  let finish!: (value: unknown) => void;
  m.exchange.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = render(<AuthCallbackClient />);
  first.unmount();
  render(<AuthCallbackClient />);
  await act(async () => { finish({ data: { session } }); });
  await waitFor(() => expect(m.router.replace).toHaveBeenCalledWith("/profile"));
  expect(m.exchange).toHaveBeenCalledTimes(1);
  expect(m.router.replace).toHaveBeenCalledTimes(1);
});
