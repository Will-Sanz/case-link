import { expect, it, vi } from "vitest";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { updateFamilyMeta } from "./families";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

it("returns a recoverable session failure and refreshes the actual profile path after saving", async () => {
  const familyId = "20000000-0000-4000-8000-000000000002";
  mocks.auth.mockRejectedValueOnce(new AuthenticationRequiredError());
  expect(await updateFamilyMeta({ familyId, summary: "Agreed next step" })).toEqual({ ok: false, error: "Sign in to continue." });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  expect(await updateFamilyMeta({ familyId, summary: "Agreed next step" })).toEqual({ ok: true });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/families/${familyId}/profile`);
  expect(mocks.revalidate).toHaveBeenCalledWith(`/families/${familyId}/overview`);
});
