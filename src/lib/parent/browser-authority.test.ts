import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureRequest, fixtureMandate, fixtureNow } from "./test-fixtures";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  rpc: vi.fn(),
  row: vi.fn(),
  household: vi.fn(),
  client: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
import { createBrowserAuthorizer } from "./browser-authority";
const id = fixtureRequest().id;
const publicKey = "sb_publishable_synthetic";
const token = `head.${Buffer.from(JSON.stringify({ exp: fixtureNow.getTime() / 1000 + 3600 })).toString("base64url")}.signature`;
const authorizer = () =>
  createBrowserAuthorizer(
    "https://approved.supabase.co",
    publicKey,
    "2026-10-26T16:00:00Z",
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixtureNow);
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({
    data: {
      user: {
        id: "owner",
        email_confirmed_at: fixtureNow.toISOString(),
        is_anonymous: false,
      },
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.row.mockResolvedValue({
    data: {
      id,
      household_id: fixtureRequest().household_id,
      status: "active",
      version: 1,
      mandate: fixtureMandate({ recipientIds: ["snap-pa"] }),
      needs: ["snap_new"],
      mandate_revoked_at: null,
    },
    error: null,
  });
  mocks.household.mockResolvedValue({ data: { id: "household" }, error: null });
  mocks.client.mockImplementation(() => ({
    auth: { getUser: mocks.user },
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: (columns: string) => {
          mocks.select(table, columns);
          return query;
        },
        eq: () => query,
        maybeSingle: table === "parent_requests" ? mocks.row : mocks.household,
      };
      return query;
    },
  }));
});
afterEach(() => vi.useRealTimers());
it("independently verifies the current identity, active processing, RLS request and explicit household ownership on every call", async () => {
  const authorize = authorizer();
  const grant = await authorize(token, id);
  expect(grant.ownerId).toBe("owner");
  expect(grant.authority.intake).toEqual({ needs: ["snap_new"] });
  expect(mocks.select).toHaveBeenCalledWith(
    "parent_requests",
    "id,household_id,status,version,mandate,mandate_revoked_at,needs:intake->needs",
  );
  await authorize(token, id);
  expect(mocks.user).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "parent_ensure_account");
  expect(mocks.household).toHaveBeenCalledTimes(2);
  expect(mocks.client.mock.calls[0][2].auth.persistSession).toBe(false);
});
it("refuses inactive identities, closed database processing and foreign or hidden requests", async () => {
  const authorize = authorizer();
  mocks.user.mockResolvedValueOnce({
    data: { user: null },
    error: new Error("invalid"),
  });
  await expect(authorize(token, id)).rejects.toThrow("browser_not_authorized");
  mocks.rpc.mockResolvedValueOnce({ error: new Error("closed") });
  await expect(authorize(token, id)).rejects.toThrow("browser_not_authorized");
  mocks.row.mockResolvedValueOnce({ data: null, error: null });
  await expect(authorize(token, id)).rejects.toThrow("browser_not_owned");
  mocks.household.mockResolvedValueOnce({ data: null, error: null });
  await expect(authorize(token, id)).rejects.toThrow("browser_not_owned");
});
it("rejects private service credentials and expired preview or JWT before starting work", async () => {
  expect(() =>
    createBrowserAuthorizer(
      "https://approved.supabase.co",
      "sb_secret_forbidden",
      "2026-10-26T16:00:00Z",
    ),
  ).toThrow("public_key");
  await expect(authorizer()("bad-token", id)).rejects.toThrow(
    "browser_not_authorized",
  );
  vi.setSystemTime(new Date("2026-10-27T16:00:00Z"));
  mocks.user.mockClear();
  await expect(authorizer()(token, id)).rejects.toThrow(
    "browser_not_authorized",
  );
  expect(mocks.user).not.toHaveBeenCalled();
});
