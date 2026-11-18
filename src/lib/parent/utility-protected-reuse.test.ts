import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { utilityProtectedInputReferenceSchema, type UtilityProtectedInputReference } from "./utility-protected-input-contract";
const privateClient = vi.hoisted(() => ({ database: vi.fn(), query: vi.fn(), rebind: vi.fn(), list: vi.fn(), validate: vi.fn() }));
vi.mock("./utility-protected-client", () => ({ withUtilityProtectedDatabase: privateClient.database, rebindUtilityProtectedInput: privateClient.rebind, listUtilityProtectedInputs: privateClient.list }));
vi.mock("./utility-protected-preparation", () => ({ validateStoredUtilityIncomeProof: privateClient.validate }));
import { reuseUtilityProtectedInputs } from "./utility-protected-reuse";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { requestId: id(1), expectedVersion: 3, programId: "peco-cap", snapshotId: id(2), snapshotRevision: 1, snapshotHash: "a".repeat(64) };
const job = { jobId: id(3), leaseToken: id(4), scope, inputSetHash: "b".repeat(64) };
const options = () => ({ connectionString: "mock-private-session", deadline: new Date("2026-11-13T22:31:20Z") });
let candidates: { reference: UtilityProtectedInputReference; originAuthorizationId: string }[], latestHash: string;
function reference() {
  return utilityProtectedInputReferenceSchema.parse({ inputId: id(5), authorizationId: id(6), ownerId: id(7), requestId: scope.requestId, requestVersion: 2, programId: "peco-cap", snapshotId: scope.snapshotId,
    snapshotRevision: 1, snapshotHash: scope.snapshotHash, purpose: "income_proof", targets: [{ subjectId: id(8), sourceId: id(9), field: "income" }], state: "superseded",
    consentedAt: "2026-11-13T22:00:00Z", expiresAt: "2026-11-13T22:35:00Z", accountReference: null, validation: null });
}
function stored(old: UtilityProtectedInputReference, inputId: string): UtilityProtectedInputReference {
  return { ...old, inputId, authorizationId: id(10), requestVersion: scope.expectedVersion, state: "stored" };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T22:31:00Z"));
  candidates = [{ reference: reference(), originAuthorizationId: id(11) }]; latestHash = job.inputSetHash;
  privateClient.database.mockImplementation(async (_options, action) => action({ query: privateClient.query, check() {} }));
  privateClient.query.mockImplementation(async (sql: string) => ({ rows: [{ value: sql.includes("reuse_candidates") ? structuredClone(candidates) : { ...job, inputSetHash: latestHash } }] }));
  privateClient.rebind.mockImplementation(async (oldId: string, newId: string) => {
    const old = candidates.find(candidate => candidate.reference.inputId === oldId)!.reference;
    candidates = candidates.filter(candidate => candidate.reference.inputId !== oldId); latestHash = "c".repeat(64);
    return { state: "stored", reference: stored(old, newId) };
  });
});
afterEach(() => vi.useRealTimers());
describe("routine protected reuse under a current durable job", () => {
  it("reuses and revalidates a fresh original without a browser, credential retention, changed expiry or family approval", async () => {
    const original = reference(), result = await reuseUtilityProtectedInputs(job, options());
    expect(result.inputSetHash).toBe("c".repeat(64)); expect(result.scope).toEqual(scope); expect(privateClient.rebind).toHaveBeenCalledOnce();
    expect(privateClient.rebind.mock.calls[0][0]).toBe(original.inputId); expect(privateClient.rebind.mock.calls[0][2]).toEqual(scope); expect(privateClient.rebind.mock.calls[0][3].job).toEqual({ jobId: job.jobId, leaseToken: job.leaseToken, requestId: scope.requestId, requestVersion: scope.expectedVersion });
    expect(privateClient.validate).toHaveBeenCalledWith(privateClient.rebind.mock.calls[0][1], expect.objectContaining({ job: { jobId: job.jobId, leaseToken: job.leaseToken, requestId: scope.requestId, requestVersion: scope.expectedVersion } }));
    expect(JSON.stringify(result)).not.toMatch(/bytes|session|consentAccepted|approval|signature/);
    await reuseUtilityProtectedInputs(job, options()); expect(privateClient.rebind).toHaveBeenCalledOnce();
  });
  it("preserves every original lineage when several income documents concern the same source", async () => {
    candidates.push({ reference: { ...reference(), inputId: id(12), authorizationId: id(13) }, originAuthorizationId: id(14) });
    await reuseUtilityProtectedInputs(job, options()); expect(privateClient.rebind).toHaveBeenCalledTimes(2);
    expect(new Set(privateClient.rebind.mock.calls.map(call => call[1])).size).toBe(2); expect(privateClient.validate).toHaveBeenCalledTimes(2);
  });
  it("reconciles an unknown private commit by reading its exact stable reference before continuing", async () => {
    const original = reference(); let newId = "";
    privateClient.rebind.mockImplementation(async (_old, target) => { newId = target; candidates = []; return { state: "commit_unknown", inputId: target }; });
    privateClient.list.mockImplementation(async () => [stored(original, newId)]);
    await reuseUtilityProtectedInputs(job, options()); expect(privateClient.list).toHaveBeenCalledOnce(); expect(privateClient.rebind).toHaveBeenCalledOnce(); expect(privateClient.validate).toHaveBeenCalledOnce();
  });
  it("does not invent another destination after an unconfirmed copy or extend original retention", async () => {
    privateClient.rebind.mockImplementation(async (_old, target) => ({ state: "commit_unknown", inputId: target })); privateClient.list.mockResolvedValue([]);
    for (let count = 0; count < 2; count++) await expect(reuseUtilityProtectedInputs(job, options())).rejects.toThrow("Previously saved protected information needs a service check.");
    expect(privateClient.rebind.mock.calls[0][1]).toBe(privateClient.rebind.mock.calls[1][1]); expect(privateClient.validate).not.toHaveBeenCalled();
    privateClient.rebind.mockImplementation(async (_old, target) => ({ state: "stored", reference: { ...stored(reference(), target), expiresAt: "2026-11-13T22:36:00Z" } }));
    await expect(reuseUtilityProtectedInputs(job, options())).rejects.toThrow(); expect(privateClient.validate).not.toHaveBeenCalled();
  });
  it("stops when the exact lease or source scope changes rather than rebasing an old job", async () => {
    privateClient.query.mockResolvedValue({ rows: [{ value: { ...job, leaseToken: id(99) } }] });
    await expect(reuseUtilityProtectedInputs(job, options())).rejects.toThrow(); expect(privateClient.rebind).not.toHaveBeenCalled();
  });
  it("does not retype, reinterpret or use an expired or foreign original", async () => {
    for (const change of [{ requestId: id(99) }, { expiresAt: "2026-11-13T22:31:00Z" }, { state: "revoked" }]) {
      candidates = [{ reference: { ...reference(), ...change } as UtilityProtectedInputReference, originAuthorizationId: id(11) }];
      await expect(reuseUtilityProtectedInputs(job, options())).rejects.toThrow();
    }
    expect(privateClient.rebind).not.toHaveBeenCalled(); expect(privateClient.validate).not.toHaveBeenCalled();
  });
});

it("rejects conflicting supplied private job options instead of replacing their authority", async () => {
  await expect(reuseUtilityProtectedInputs(job, { ...options(), job: { jobId: id(99), leaseToken: job.leaseToken, requestId: scope.requestId, requestVersion: scope.expectedVersion } })).rejects.toThrow();
  expect(privateClient.database).not.toHaveBeenCalled();
});
