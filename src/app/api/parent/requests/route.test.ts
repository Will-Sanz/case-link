import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({ start: vi.fn(), startSnap: vi.fn(), startWic: vi.fn(), startPeco: vi.fn(), startPgw: vi.fn(), startWater: vi.fn(), get: vi.fn(), list: vi.fn(), getProgress: vi.fn(), listProgress: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/parent/data", () => ({ startSupportRequest: mocks.start, getSupportRequest: mocks.get, listSupportRequests: mocks.list }));
vi.mock("@/lib/parent/snap-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/snap-application-data")>(), startSnapApplication: mocks.startSnap }));
vi.mock("@/lib/parent/wic-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/wic-application-data")>(), startWicApplication: mocks.startWic }));
vi.mock("@/lib/parent/peco-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/peco-application-data")>(), startPecoApplication: mocks.startPeco }));
vi.mock("@/lib/parent/pgw-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/pgw-application-data")>(), startPgwApplication: mocks.startPgw }));
vi.mock("@/lib/parent/water-application-data", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/parent/water-application-data")>(), startWaterApplication: mocks.startWater }));
vi.mock("@/lib/parent/progress-data", () => ({ getSupportProgress: mocks.getProgress, listSupportProgress: mocks.listProgress }));
vi.mock("@/lib/parent/authorization-window", () => ({ getParentAuthorizationWindow: mocks.window }));
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/snap-application-data";
import { WIC_APPLICATION_NOTICE_VERSION } from "@/lib/parent/wic-application-data";
import { PECO_APPLICATION_NOTICE_VERSION } from "@/lib/parent/peco-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION } from "@/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION } from "@/lib/parent/water-application-fields";
import { POST } from "./route";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { familyProfileLeaves, familyProfileSourceSchema } from "@/lib/parent/family-profile";
import { projectFamilyProfileApplication } from "@/lib/parent/family-profile-application";
import { snapApplicationFieldsValueSchema } from "@/lib/parent/snap-application-fields";
const key = "33333333-3333-4333-8333-333333333333";
const legacy = () => ({ intake: fixtureIntake(), mandate: fixtureMandate() });
const snap = () => ({ kind: "snap_application", intake: fixtureIntake({ needs: ["snap_new"] }), mandate: fixtureMandate({ recipientIds: ["snap-pa"] }), details: { zip: "19104", applicant: { firstName: "Maria" } }, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION });
const wic = () => ({ kind: "wic_application", intake: fixtureIntake({ needs: ["wic_new"], householdSize: null, utilityProviders: [] }), mandate: fixtureMandate({ recipientIds: ["wic-pa"], allowedData: ["household"] }), details: { contact: { firstName: "WicPrivateCanary" } }, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true });
const peco = () => ({ kind: "peco_application", intake: fixtureIntake({ needs: ["electricity"], householdSize: null, utilityProviders: ["peco"], shutoffDate: "2026-11-14" }),
  mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"] }),
  details: { accountNumber: "9000000001" }, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true });
function request(value: unknown, origin = "https://caselink.test") {
  return new Request("https://caselink.test/api/parent/requests", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://caselink.test");
  mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION } });
  mocks.start.mockResolvedValue(fixtureRequest().id); mocks.startSnap.mockResolvedValue(fixtureRequest().id); mocks.startWic.mockResolvedValue(fixtureRequest().id);
  mocks.startPeco.mockResolvedValue(fixtureRequest().id); mocks.startPgw.mockResolvedValue(fixtureRequest().id); mocks.startWater.mockResolvedValue(fixtureRequest().id);
  mocks.get.mockResolvedValue(fixtureRequest()); mocks.getProgress.mockResolvedValue(null);
});

describe("existing request creation and atomic SNAP variant", () => {
  it("accepts actual source-backed SNAP projection for 30 people and 100 income rows beyond 64 KB", async () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const person = (n: number) => ({ id: id(n), firstName: "a".repeat(80), lastName: "b".repeat(80), middleInitial: "AB", dateOfBirth: "1980-01-01", ...(n === 1 ? {} : { relationship: "r".repeat(40) }) });
    const now = new Date(), dates = { confirmedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const profileDetails = { primaryPerson: person(1), members: Array.from({ length: 29 }, (_, index) => person(index + 2)) };
    const projection = projectFamilyProfileApplication({ revision: 2, idempotencyKey: key, details: profileDetails,
      provenance: Object.fromEntries(Object.keys(familyProfileLeaves(profileDetails)).map(path => [path, dates])) }, "snap-pa", { now });
    const projected = snapApplicationFieldsValueSchema.parse(projection.details);
    const details = { ...projected, household: projected.household!.map(person => ({ ...person, requestingSnap: true, citizen: true })),
      income: { month: "2026-11", hasIncome: true, entries: Array.from({ length: 100 }, (_, index) => ({ id: id(index + 101), personId: id(1), source: "a".repeat(100), frequency: "b".repeat(60), amount: 1000000, status: "received", date: "2026-11-01" })) } };
    const familyProfileSource = { expectedOwnerId: key, revision: 2, fields: projection.fields }, value = { ...snap(), details, familyProfileSource };
    expect(Buffer.byteLength(JSON.stringify(details))).toBeLessThan(65536);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(65536);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(131072);
    expect((await POST(request(value))).status).toBe(201);
    expect(mocks.startSnap).toHaveBeenCalledExactlyOnceWith(value.intake, value.mandate, details, value.noticeVersion, key, familyProfileSource);
  });
  it("rejects a structurally valid source envelope above 128 KB before any database boundary", async () => {
    const familyProfileSource = { expectedOwnerId: key, revision: 2, fields: Array.from({ length: 80 }, (_, index) => ({
      applicationPath: `custom.fact${index}`, profilePaths: Array.from({ length: 10 }, (_, part) => `custom.${part}.${"x".repeat(180)}`),
    })) };
    expect(familyProfileSourceSchema.safeParse(familyProfileSource).success).toBe(true);
    const value = { ...snap(), familyProfileSource }; expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(131072);
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.startSnap).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("keeps PECO closed independently and never falls back to ordinary creation", async () => {
    const response = await POST(request({ ...peco(), details: { "123-45-6789": "private" } }));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/123-45-6789|9000000001/);
    expect(mocks.startPeco).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("starts PECO atomically with account and subject authority, preserving ordinary urgency and routing reuse", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", pecoApplication: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION } });
    const value = { ...peco(), reusedZip: { sourceRequestId: key, sourceVersion: 1 } };
    expect((await POST(request(value))).status).toBe(201);
    expect(mocks.startPeco).toHaveBeenCalledWith(value.intake, value.mandate, { details: value.details, noticeVersion: value.noticeVersion,
      subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key, value.reusedZip);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startWic).not.toHaveBeenCalled();
    mocks.startPeco.mockRejectedValueOnce(new Error("parent_reuse_source_changed"));
    expect((await POST(request(value))).status).toBe(412);
    expect((await POST(request({ ...value, accountAuthorityDeclared: false }))).status).toBe(400);
  });
  it("checks reusable routing through the dedicated start boundary and rejects injected freshness", async () => {
    const reusedZip = { sourceRequestId: key, sourceVersion: 2 };
    expect((await POST(request({ ...legacy(), reusedZip }))).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith(legacy().intake, legacy().mandate, key, reusedZip);
    expect((await POST(request({ ...legacy(), reusedZip: { ...reusedZip, confirmedAt: "2026-11-13T00:00:00Z" } }))).status).toBe(400);
  });
  it("separates a proved pre-creation source change from an uncertain creation result", async () => {
    mocks.start.mockRejectedValueOnce(new Error("parent_reuse_source_changed"));
    expect((await POST(request({ ...legacy(), reusedZip: { sourceRequestId: key, sourceVersion: 1 } }))).status).toBe(412);
  });
  it("preserves ordinary request creation", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: false, noticeVersion: null } });
    expect((await POST(request(legacy()))).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith(legacy().intake, legacy().mandate, key);
    expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("blocks a closed initial SNAP form before private schema parsing or request creation", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", expiresAt: "2026-11-24T16:00:00Z", snapApplication: { collectionEnabled: false, noticeVersion: null } });
    const response = await POST(request({ ...snap(), details: { "123-45-6789": true } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "This support request is unavailable, or its permission has changed." });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("keeps malformed JSON generic before identifying the initial flow", async () => {
    const response = await POST(new Request("https://caselink.test/api/parent/requests", { method: "POST", headers: { origin: "https://caselink.test", "content-type": "application/json" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("creates and saves initial SNAP answers through the atomic wrapper only", async () => {
    const value = snap();
    const response = await POST(request(value));
    expect(response.status).toBe(201);
    expect(mocks.startSnap).toHaveBeenCalledWith(value.intake, value.mandate, value.details, value.noticeVersion, key);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, request: fixtureRequest(), progress: null });
  });
  it.each([{ details: { "123-45-6789": "private" } }, { details: { signature: "private" } }, { noticeVersion: "wrong-purpose" }])("rejects malformed private creation without echoing it: %j", async override => {
    const response = await POST(request({ ...snap(), ...override }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(mocks.startSnap).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("keeps closed collection unavailable and never falls back to ordinary creation", async () => {
    mocks.startSnap.mockRejectedValue(new Error("This request is unavailable, or its permission has changed."));
    expect((await POST(request(snap()))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves relevant recipient and same-origin checks before creation", async () => {
    expect((await POST(request({ ...snap(), mandate: fixtureMandate({ recipientIds: ["peco-cap"] }) }))).status).toBe(400);
    expect((await POST(request(snap(), "https://other.test"))).status).toBe(403);
    expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("blocks WIC before private schema parsing when only SNAP is approved", async () => {
    const response = await POST(request({ ...wic(), details: { "123-45-6789": "private" } }));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toMatch(/123-45-6789|WicPrivateCanary/);
    expect(mocks.startWic).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
  });
  it("starts WIC and its private partial answers atomically with an existing routing reference", async () => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", wicApplication: { collectionEnabled: true, noticeVersion: WIC_APPLICATION_NOTICE_VERSION } });
    const value = { ...wic(), reusedZip: { sourceRequestId: key, sourceVersion: 1 } };
    expect((await POST(request(value))).status).toBe(201);
    expect(mocks.startWic).toHaveBeenCalledWith(value.intake, value.mandate, value.details, value.noticeVersion, true, key, value.reusedZip);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled();
    mocks.startWic.mockRejectedValueOnce(new Error("parent_reuse_source_changed"));
    expect((await POST(request(value))).status).toBe(412);
  });
  it.each([{ householdSize: 3 }, { incomeAmount: 100, incomeFrequency: "monthly" }, { utilityProviders: ["peco"] }, { needs: ["wic_continuing"] }])("rejects irrelevant or continuing intake on the initial WIC-private route", async override => {
    mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", wicApplication: { collectionEnabled: true, noticeVersion: WIC_APPLICATION_NOTICE_VERSION } });
    expect((await POST(request({ ...wic(), intake: { ...wic().intake, ...override } }))).status).toBe(400);
    expect(mocks.startWic).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe.each(["SNAP", "WIC"] as const)("source-aware %s request start", programme => {
  const source = () => ({ expectedOwnerId: key, revision: 2, options: {}, fields: [
    { applicationPath: programme === "SNAP" ? "applicant.firstName" : "contact.firstName", profilePaths: ["primaryPerson.firstName"] },
  ] });
  const input = () => ({ ...(programme === "SNAP" ? snap() : wic()), familyProfileSource: source() });
  const start = () => programme === "SNAP" ? mocks.startSnap : mocks.startWic;
  const enable = () => mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", snapApplication: { collectionEnabled: true }, wicApplication: { collectionEnabled: true } });
  it("forwards the complete source under the same start key without returning private source metadata", async () => {
    enable(); const value = input(), response = await POST(request(value));
    expect(response.status).toBe(201);
    if (programme === "SNAP") expect(mocks.startSnap).toHaveBeenCalledExactlyOnceWith(value.intake, value.mandate, value.details, value.noticeVersion, key, value.familyProfileSource);
    else expect(mocks.startWic).toHaveBeenCalledExactlyOnceWith(value.intake, value.mandate, value.details, value.noticeVersion, true, key, undefined, value.familyProfileSource);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, request: fixtureRequest(), progress: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([
    null, { revision: 1, fields: [] }, { expectedOwnerId: "private-owner-canary", revision: 1, fields: [] },
    { expectedOwnerId: key, revision: 1, fields: [{ applicationPath: "<private-path-canary>", profilePaths: ["primaryPerson.firstName"] }] },
    { expectedOwnerId: key, revision: 1, confirmedAt: "2026-11-17T18:00:00Z", fields: [{ applicationPath: "contact.firstName", profilePaths: ["primaryPerson.firstName"] }] },
    { expectedOwnerId: key, revision: 1, fields: [{ applicationPath: "contact.firstName", profilePaths: ["primaryPerson.firstName"], expiresAt: "2026-12-17T18:00:00Z" }] },
  ])("rejects malformed or injected source metadata before any start boundary", async familyProfileSource => {
    enable(); const response = await POST(request({ ...input(), familyProfileSource }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, error: "Check the information and try again." });
    expect(start()).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("returns the known source-change 412 without falling back or fetching a possibly created request", async () => {
    enable(); start().mockRejectedValueOnce(new Error("parent_family_profile_source_changed"));
    const response = await POST(request(input()));
    expect(response.status).toBe(412); expect(await response.text()).not.toContain("parent_family_profile_source_changed");
    expect(start()).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("leaves well-formed foreign-owner and arbitrary mapping rejection to the atomic SQL boundary", async () => {
    enable(); start().mockRejectedValueOnce(new Error("This request is unavailable, or its permission has changed."));
    const familyProfileSource = { ...source(), expectedOwnerId: fixtureRequest().id, fields: [{ applicationPath: "custom.secret", profilePaths: ["custom.secret"] }] };
    const response = await POST(request({ ...input(), familyProfileSource }));
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("custom.secret");
    expect(start()).toHaveBeenCalledTimes(1); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not classify an unknown provider failure as a safe source retry", async () => {
    enable(); vi.spyOn(console, "error").mockImplementation(() => {});
    start().mockRejectedValueOnce(new Error("provider-private-canary parent_family_profile_source_changed"));
    const response = await POST(request(input()));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("provider-private-canary");
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it("keeps authentication before body collection and request creation", async () => {
    mocks.window.mockRejectedValueOnce(new AuthenticationRequiredError());
    const value = request(input()), body = vi.spyOn(value, "body", "get");
    expect((await POST(value)).status).toBe(401);
    expect(body).not.toHaveBeenCalled(); expect(start()).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe.each([
  { kind: "pgw_application", key: "pgwApplication", need: "gas", provider: "pgw", program: "pgw-crp", noticeVersion: PGW_APPLICATION_NOTICE_VERSION, mock: "startPgw" },
  { kind: "water_application", key: "waterApplication", need: "water", provider: "pwd", program: "pwd-tap", noticeVersion: WATER_APPLICATION_NOTICE_VERSION, mock: "startWater" },
] as const)("atomic $kind start", option => {
  const value = () => ({ kind: option.kind, intake: fixtureIntake({ needs: [option.need], utilityProviders: [option.provider], householdSize: null, incomeAmount: null, incomeFrequency: "unknown" }),
    mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [option.program], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"] }),
    details: {}, noticeVersion: option.noticeVersion, subjectAuthorityDeclared: true, accountAuthorityDeclared: true, reusedZip: { sourceRequestId: key, sourceVersion: 1 } });
  const enable = () => mocks.window.mockResolvedValue({ issuedAt: "2026-10-25T16:00:00Z", [option.key]: { collectionEnabled: true, noticeVersion: option.noticeVersion } });
  it("requires its own collection purpose before parsing private answers", async () => {
    const response = await POST(request({ ...value(), details: { "123-45-6789": "private-canary" } }));
    expect(response.status).toBe(403); expect(await response.text()).not.toMatch(/123-45-6789|private-canary/);
    expect(mocks[option.mock]).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("uses the exact programme, declarations and same atomic start key, including a source-changed retry", async () => {
    enable(); const input = value(); expect((await POST(request(input))).status).toBe(201);
    expect(mocks[option.mock]).toHaveBeenCalledWith(input.intake, input.mandate, { details: {}, noticeVersion: option.noticeVersion, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key, input.reusedZip);
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.startSnap).not.toHaveBeenCalled(); expect(mocks.startPeco).not.toHaveBeenCalled();
    mocks[option.mock].mockRejectedValueOnce(new Error("parent_reuse_source_changed")); expect((await POST(request(input))).status).toBe(412);
  });
  it.each([{ accountAuthorityDeclared: false }, { subjectAuthorityDeclared: false }, { noticeVersion: "wrong-purpose" }, { details: { signature: "private-canary" } }])("refuses missing or expanded private authority: %j", async patch => {
    enable(); const response = await POST(request({ ...value(), ...patch })); expect(response.status).toBe(400);
    expect(mocks[option.mock]).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(await response.text()).not.toContain("private-canary");
  });
});
