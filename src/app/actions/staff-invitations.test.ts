import { expect, it, vi } from "vitest";
import { inviteStaff } from "./staff-invitations";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.auth }));
vi.mock("@/lib/auth/public-site-url", () => ({ getPublicSiteOrigin: async () => "https://caselink.example" }));
function admin() { mocks.auth.mockResolvedValue({ user: { role: "admin" }, supabase: { functions: { invoke: mocks.invoke } } }); }
it("denies callers without administrator authority and rejects injected role options", async () => {
  mocks.auth.mockResolvedValue({ user: { role: "case_manager" } });
  expect(await inviteStaff({ email: "staff@example.test", delivery: "link" })).toMatchObject({ ok: false });
  expect(await inviteStaff({ email: "staff@example.test", delivery: "link", role: "admin" })).toMatchObject({ ok: false }); expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps a generated invitation token only in the canonical URL fragment", async () => {
  admin(); mocks.invoke.mockResolvedValue({ data: { status: "link", tokenHash: "a".repeat(64) }, error: null });
  const result = await inviteStaff({ email: " STAFF@example.test ", delivery: "link" }); expect(result.ok).toBe(true);
  if (!result.ok) return; const url = new URL(result.link!); expect(url.origin).toBe("https://caselink.example"); expect(url.pathname).toBe("/auth/callback"); expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("type")).toBe("invite");
  expect(mocks.invoke).toHaveBeenCalledWith("invite-staff", { body: { email: "staff@example.test", delivery: "link" } });
});
it("keeps email delivery and an existing account distinct and does not expose malformed responses", async () => {
  admin();
  for (const status of ["sent", "existing"]) { mocks.invoke.mockResolvedValue({ data: { status }, error: null }); expect(await inviteStaff({ email: "staff@example.test", delivery: "email" })).toEqual({ ok: true, status }); }
  mocks.invoke.mockResolvedValue({ data: { status: "link", tokenHash: "bad" }, error: null }); expect(await inviteStaff({ email: "staff@example.test", delivery: "link" })).toMatchObject({ ok: false });
});
