import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), require: vi.fn(), identity: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ createParentClient: mocks.client, requireParentSession: mocks.require }));
vi.mock("./account-deletion", () => ({ getParentDeletionStatus: mocks.identity }));
import { clearFamilyProfile, getFamilyProfile, getFamilyProfileSources, saveFamilyProfile } from "./family-profile-data";
import { FAMILY_PROFILE_NOTICE_VERSION } from "./family-profile";
const owner = "00000000-0000-4000-8000-000000000001", key = "00000000-0000-4000-8000-000000000002";
const read = { ownerId: owner, revision: 0, lastMutationKey: null, profile: null, collection: { collectionEnabled: false, noticeVersion: null, expiresAt: null, retentionDays: 45 } };
const write = { expectedOwnerId: owner, expectedRevision: 0, details: { primaryPerson: { id: key, firstName: "Pat" } }, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true };
beforeEach(() => { vi.clearAllMocks(); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); mocks.require.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id: owner } }); mocks.identity.mockResolvedValue({ ownerId: owner, status: "active" }); mocks.rpc.mockResolvedValue({ data: read, error: null }); });
describe("family profile server-only data", () => {
  it("loads exact current owned source references without raw profile values or processing enrollment", async () => {
    const bindings = { fields: [{ applicationPath: "applicant.firstName", profilePaths: ["primaryPerson.firstName"] }] };
    mocks.rpc.mockResolvedValue({ data: bindings, error: null });
    expect(await getFamilyProfileSources(key, 2)).toEqual(bindings);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_get_family_profile_sources", { p_request_id: key, p_expected_version: 2 });
    expect(mocks.require).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { ...bindings, raw: "PRIVATE_CANARY" }, error: null });
    await expect(getFamilyProfileSources(key, 2)).rejects.toThrow("could not load");
  });
  it("loads exact owned data without enrollment when collection is closed", async () => {
    expect(await getFamilyProfile()).toEqual(read); expect(mocks.require).not.toHaveBeenCalled(); expect(mocks.identity).toHaveBeenCalledOnce();
    mocks.rpc.mockResolvedValue({ data: { ...read, ownerId: key }, error: null }); await expect(getFamilyProfile()).rejects.toThrow("could not load");
  });
  it("sends only typed data/current revision and a stable key to the owned RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null }); expect(await saveFamilyProfile(write, key)).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_save_family_profile", { p_expected_owner: owner, p_expected_revision: 0, p_details: write.details, p_notice_version: FAMILY_PROFILE_NOTICE_VERSION, p_consent_accepted: true, p_subject_authority_declared: true, p_confirmed_paths: [], p_idempotency_key: key });
  });
  it("denies an owner swap before clear and sanitizes SQL error details", async () => {
    mocks.identity.mockResolvedValue({ ownerId: key, status: "active" }); await expect(clearFamilyProfile({ expectedOwnerId: owner, expectedRevision: 1 }, key)).rejects.toThrow("unavailable"); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "PRIVATE-CANARY" } }); await expect(saveFamilyProfile(write, key)).rejects.toThrow("This request changed");
  });
});
