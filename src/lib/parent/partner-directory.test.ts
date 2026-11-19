import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getParentPartnerDirectory } from "./partner-directory";

const partner = {
  legacyResourceId: "c6d9f7ba-1000-485c-91f3-063ecb960945",
  name: "UESF",
  officialUrl: "https://uesfacts.org/check-your-eligibility/",
  programIds: ["uesf-benefits", "uesf-utilities"],
  directoryUpdatedAt: "2026-03-21T00:16:08.004742+00:00",
  sourceCheckedAt: "2026-10-26",
  relationship: "existing_partner",
  execution: "not_connected",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: [partner], error: null });
});
describe("existing partner directory boundary", () => {
  it("uses the parent-scoped directory RPC and distinguishes partnership from execution", async () => {
    expect(await getParentPartnerDirectory()).toEqual([partner]);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_partner_directory");
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getParentPartnerDirectory()).toEqual([]);
  });
  it("does not expose a private directory field, arbitrary recipient URL or transport claim", async () => {
    for (const invalid of [
      { ...partner, primary_contact_email: "private@example.invalid" },
      { ...partner, officialUrl: "https://attacker.invalid/" },
      { ...partner, execution: "connected" },
    ]) {
      mocks.rpc.mockResolvedValue({ data: [invalid], error: null });
      await expect(getParentPartnerDirectory()).rejects.toThrow();
    }
  });
  it("requires a current parent session and hides database details on failure", async () => {
    mocks.session.mockRejectedValue(new Error("authentication required"));
    await expect(getParentPartnerDirectory()).rejects.toThrow("authentication");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private contact canary", code: "42501" },
    });
    await expect(getParentPartnerDirectory()).rejects.toThrow(
      "Partner information is not available right now.",
    );
  });
});
