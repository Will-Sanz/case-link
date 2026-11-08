import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ createParentClient: mocks.create }));
import { getParentDeletionStatus, requestAccountDeletion } from "./account-deletion";
const client = { auth: { getUser: mocks.getUser }, rpc: mocks.rpc } as unknown as SupabaseClient;
const user = { id: "11111111-1111-4111-8111-111111111111", email: "synthetic@example.test", email_confirmed_at: "2026-11-07", is_anonymous: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.create.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});
describe("parent deletion data boundary", () => {
  it("verifies live identity and uses only the deletion RPC, without ensuring/enrolling an account", async () => {
    await requestAccountDeletion(user.id);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls).toEqual([["parent_request_deletion"]]);
  });
  it.each(["active", "deletion_requested"])("returns only validated %s metadata from the supplied parent client", async status => {
    mocks.rpc.mockResolvedValue({ data: status, error: null });
    expect(await getParentDeletionStatus(client)).toEqual({ ownerId: user.id, status });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls).toEqual([["parent_get_deletion_status"]]);
  });
  it.each([null, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, id: "fake" }])("denies an absent or unusable live identity before either RPC", async value => {
    mocks.getUser.mockResolvedValue({ data: { user: value }, error: null });
    await expect(requestAccountDeletion(user.id)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    await expect(getParentDeletionStatus(client)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a stale deletion form after another parent signs in, before SQL mutation", async () => {
    await expect(requestAccountDeletion("22222222-2222-4222-8222-222222222222")).rejects.toThrow("parent_deletion_owner_changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not expose provider details or accept an unconfirmed deletion result", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "PRIVATE-CANARY" } });
    await expect(requestAccountDeletion(user.id)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    mocks.rpc.mockResolvedValueOnce({ data: { status: "deleted", raw: "PRIVATE-CANARY" }, error: null });
    await expect(requestAccountDeletion(user.id)).rejects.toThrow("Parent deletion service is not available");
    mocks.rpc.mockResolvedValueOnce({ data: { status: "active" }, error: null });
    await expect(getParentDeletionStatus(client)).rejects.toThrow("Parent deletion service is not available");
  });
});
