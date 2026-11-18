import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";
const privateWork = vi.hoisted(() => ({ reuse: vi.fn(), database: vi.fn(), query: vi.fn(), context: vi.fn(), list: vi.fn(), validate: vi.fn(), store: vi.fn(), render: vi.fn() }));
vi.mock("./utility-protected-client", async original => ({ ...await original<typeof import("./utility-protected-client")>(), withUtilityProtectedDatabase: privateWork.database, getUtilityProtectedApplicationContext: privateWork.context, listUtilityProtectedInputs: privateWork.list }));
vi.mock("./utility-protected-reuse", () => ({ reuseUtilityProtectedInputs: privateWork.reuse }));
vi.mock("./utility-protected-preparation", () => ({ validateStoredUtilityIncomeProof: privateWork.validate }));
vi.mock("./utility-prepared-artifact-client", async original => ({ ...await original<typeof import("./utility-prepared-artifact-client")>(), storeUtilityPreparedArtifact: privateWork.store }));
import { createUtilityPreparationHandler } from "./utility-preparation-service";
import { UTILITY_PREPARATION_SOURCE_UNAVAILABLE } from "./utility-preparation-port";
const origin = "http://127.0.0.1:3341", secret = "synthetic-utility-metadata-token-".repeat(2), operation = fixtureUtilityProtectedOperation();
const reference = operation.packet.protectedUtilityPacket;
const job = { jobId: "77777777-7777-4777-8777-777777777777", leaseToken: "88888888-8888-4888-8888-888888888888", scope: { requestId: reference.requestId, expectedVersion: reference.requestVersion, programId: reference.programId,
  snapshotId: reference.snapshotId, snapshotRevision: reference.snapshotRevision, snapshotHash: reference.snapshotHash }, inputSetHash: "e".repeat(64) };
const handler = () => createUtilityPreparationHandler({ origin, secret, utilityDatabaseUrl: "postgresql://caselink_utility_fixture:synthetic-password@127.0.0.1:55322/postgres" }, privateWork.render);
function request(body: unknown = job, patch: Record<string, string> = {}) { const value = JSON.stringify(body); return new Request(`${origin}/utility/prepare`, { method: "POST",
  headers: { Host: "127.0.0.1:3341", Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(value)), ...patch }, body: value }); }
beforeEach(() => {
  vi.clearAllMocks(); privateWork.reuse.mockResolvedValue(job); privateWork.query.mockResolvedValue({ rows: [{ value: null }] });
  privateWork.database.mockImplementation(async (_options, action) => action({ query: privateWork.query })); privateWork.list.mockResolvedValue([]); privateWork.context.mockResolvedValue({ programId: "pwd-tap", privateName: "PRIVATE-CANARY" });
  privateWork.render.mockResolvedValue({ bytes: new TextEncoder().encode("%PDF-PRIVATE-CANARY"), inputs: [], source: {}, expiresAt: reference.expiresAt });
  privateWork.store.mockResolvedValue({ state: "prepared", operation });
});
describe("isolated utility preparation metadata handler", () => {
  it("erases a private PDF that finishes after its request was cancelled", async () => {
    const entered = Promise.withResolvers<void>(), completed = Promise.withResolvers<Awaited<ReturnType<typeof privateWork.render>>>();
    const bytes = new TextEncoder().encode("%PDF-LATE-PRIVATE-CANARY"), controller = new AbortController();
    privateWork.render.mockImplementation(() => { entered.resolve(); return completed.promise; });
    const pending = handler()(new Request(request(), { signal: controller.signal }));
    await entered.promise; controller.abort();
    expect((await pending).status).toBe(503);
    completed.resolve({ bytes, inputs: [], source: {}, expiresAt: reference.expiresAt });
    await completed.promise; await Promise.resolve();
    expect(bytes.every(value => value === 0)).toBe(true);
    expect(privateWork.store).not.toHaveBeenCalled();
  });
  it("resolves current scope privately, retains exact job authority through all reads, and returns only sealed metadata", async () => {
    const output = (await privateWork.render()).bytes; const response = await handler()(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "prepared", operation }); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(output.every((n: number) => n === 0)).toBe(true);
    const options = privateWork.context.mock.calls[0][1]; expect(options.job).toEqual({ jobId: job.jobId, leaseToken: job.leaseToken, requestId: job.scope.requestId, requestVersion: job.scope.expectedVersion });
    expect(privateWork.render.mock.calls.at(-1)![0].options).toBe(options); expect(privateWork.store.mock.calls[0][0]).toEqual(job);
  });
  it("reconciles an already stored preparation before rendering again after an unknown response", async () => {
    privateWork.query.mockResolvedValue({ rows: [{ value: operation }] }); const response = await handler()(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "prepared", operation }); expect(privateWork.render).not.toHaveBeenCalled(); expect(privateWork.store).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ Authorization: "Bearer wrong-private-token" }, { Cookie: "parent-cookie" }, { Origin: origin }, { Host: "outside.invalid" }, { "X-Forwarded-Host": "outside.invalid" }, { "Content-Encoding": "gzip" }, { "Content-Length": "9999" }])("rejects unsafe framing before any private database use: %j", async patch => {
    const response = await handler()(request(job, patch)); expect([400, 401]).toContain(response.status); expect(privateWork.reuse).not.toHaveBeenCalled(); expect(privateWork.database).not.toHaveBeenCalled();
  });
  it("rejects raw fields and foreign canonical metadata without leaking the supplied value", async () => {
    expect((await handler()(request({ ...job, raw: "PRIVATE-CANARY" }))).status).toBe(400);
    const changed = structuredClone(operation); changed.protectedPacketCurrent = false; privateWork.query.mockResolvedValue({ rows: [{ value: changed }] });
    const response = await handler()(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE-CANARY"); expect(privateWork.render).not.toHaveBeenCalled();
  });
  it.each(["source", "answers", "validation"])("keeps missing %s separate from an application or a repeat approval", async issue => {
    if (issue === "source") privateWork.render.mockRejectedValue(new Error(UTILITY_PREPARATION_SOURCE_UNAVAILABLE));
    if (issue === "answers") privateWork.render.mockResolvedValue(null);
    if (issue === "validation") { privateWork.list.mockResolvedValue([{ inputId: reference.inputs[0].inputId, purpose: "income_proof", validation: null }]); privateWork.validate.mockRejectedValue(new Error("PRIVATE-CANARY")); }
    const response = await handler()(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "service_blocked", reason: issue === "source" ? "source_unavailable" : issue === "answers" ? "missing_preparation_answers" : "protected_inputs_unresolved" }); expect(privateWork.store).not.toHaveBeenCalled();
  });
  it("does not claim a dispatched unknown commit is prepared", async () => {
    const result = { state: "commit_unknown", packetId: reference.packetId, operationId: operation.operationId }; privateWork.store.mockResolvedValue(result);
    const response = await handler()(request()); expect(response.status).toBe(202); expect(await response.json()).toEqual(result);
  });
});
