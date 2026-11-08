import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Worker as NodeWorker } from "node:worker_threads";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { transformSync } from "next/dist/build/swc";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSnapDirectCompletionInBrowser, SNAP_DIRECT_COMPLETION_ERROR } from "./snap-direct-completion-browser";
import { renderSnapDirectCompletion, type SnapDirectCompletion, type SnapDirectCompletionContext, type SnapDirectCompletionResult } from "./snap-direct-completion";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { fixtureSnapApplication, fixtureSnapSnapshot } from "./test-fixtures";

const template = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"), now = new Date("2026-11-04T22:00:00.000Z"), preparedAt = new Date("2026-11-04T21:59:00.000Z");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const workerBundle = buildSync({ entryPoints: ["src/lib/parent/snap-direct-completion-worker.ts"], bundle: true, platform: "browser", format: "iife", write: false, metafile: true });
const workerCode = workerBundle.outputFiles[0].text;
// Next's client compiler folds typeof window even for a worker entry.
const browserCompiledWorkerCode = transformSync(workerCode, {
  jsc: { parser: { syntax: "ecmascript" }, target: "es2022", transform: { optimizer: { globals: { typeofs: { window: "object" } } } } },
}).code;
let currentWorkerCode = workerCode;
const workers: FixtureWorker[] = [];
class FixtureWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  thread: NodeWorker; logs = ""; closed: Promise<void>; terminated = false;
  constructor() {
    // Exercise the actual browser bundle; only the transport is adapted to a credential-free test thread.
    this.thread = new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.postMessage=(value,transfer)=>parentPort.postMessage(value,transfer);globalThis.close=()=>parentPort.close();${currentWorkerCode};parentPort.on('message',data=>globalThis.onmessage?.({data}));`,
      { eval: true, stdout: true, stderr: true, env: {}, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    this.closed = new Promise(resolve => this.thread.once("exit", () => resolve())); workers.push(this);
    this.thread.stdout.on("data", bytes => { this.logs += bytes.toString(); }); this.thread.stderr.on("data", bytes => { this.logs += bytes.toString(); });
    this.thread.on("message", data => this.onmessage?.({ data } as MessageEvent));
    this.thread.on("error", () => this.onerror?.({ preventDefault() {} } as ErrorEvent));
  }
  postMessage(value: unknown) { this.thread.postMessage(value); }
  terminate() { this.terminated = true; void this.thread.terminate(); }
}
let fixture: { unsigned: Uint8Array; trusted: SnapDirectCompletionContext; completion: SnapDirectCompletion }, baseline: SnapDirectCompletionResult;
beforeAll(async () => {
  const fields = fixtureSnapApplication(preparedAt), snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt, fields));
  const unsigned = (await renderSnapSigningCopy(template, fields, preparedAt)).bytes!;
  const trusted: SnapDirectCompletionContext = { requestId: snapshot.request_id, snapshot,
    context: { requestVersion: snapshot.request_version, snapshotId: snapshot.id, snapshotHash: "a".repeat(64), source: snapshot.source,
      applyingSubjectIds: fields.household!.filter(person => person.requestingSnap).map(person => person.id) },
    preparedAt: preparedAt.toISOString(), unsignedContentSha256: sha(unsigned) };
  const completion: SnapDirectCompletion = { requestId: trusted.requestId, requestVersion: trusted.context.requestVersion,
    snapshotId: snapshot.id, snapshotHash: trusted.context.snapshotHash, source: snapshot.source, unsignedContentSha256: trusted.unsignedContentSha256,
    signingRoute: "applicant_name_handwriting", identifiers: fields.household!.filter(person => person.requestingSnap).map((person, i) => ({ personId: person.id, kind: "ssn", value: `90000000${i + 1}` })),
    certifications: SNAP_PARENT_CERTIFICATION_ACTS.map((actId, i) => ({ actId, provenance: "caller_reported_fresh_parent_drawing",
      startedAt: `2026-11-04T21:59:${i ? "30" : "10"}.000Z`, completedAt: `2026-11-04T21:59:${i ? "40" : "20"}.000Z`, date: "2026-11-04",
      strokes: [[{ x: 0.05, y: 0.2 }, { x: 0.35, y: 0.65 }, { x: 0.7, y: 0.35 }, { x: 0.95, y: 0.8 }]],
    })) };
  fixture = { unsigned, trusted, completion }; baseline = await renderSnapDirectCompletion(template, trusted, completion, now);
  expect(baseline.bytes).not.toBeNull();
});
beforeEach(() => { workers.length = 0; currentWorkerCode = workerCode; vi.stubGlobal("Worker", FixtureWorker); });
afterEach(async () => {
  for (const worker of workers) worker.terminate();
  await Promise.all(workers.map(worker => worker.closed));
  expect(workers.every(worker => !worker.logs)).toBe(true);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const input = () => structuredClone(fixture);
const run = (value = input(), signal?: AbortSignal) => completeSnapDirectCompletionInBrowser(value.unsigned, value.trusted, value.completion, new Date(now), { signal });

describe("closed direct completion browser worker", () => {
  it("retains the real worker handler after Next's browser typeof-window optimization", async () => {
    currentWorkerCode = browserCompiledWorkerCode;
    expect(await run()).toEqual(baseline);
  }, 15000);
  it("does not install a handler or suppress diagnostics in the main browser context", () => {
    const postMessage = vi.fn(), originalHandler = vi.fn();
    const console = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const originalConsole = { ...console }, context = { document: {}, postMessage, onmessage: originalHandler, console };
    runInNewContext(browserCompiledWorkerCode, context);
    expect(context.onmessage).toBe(originalHandler);
    expect(console).toEqual(originalConsole);
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("bundles the wrapper and actual worker for browsers without Node or server rendering imports", () => {
    const wrapper = buildSync({ entryPoints: ["src/lib/parent/snap-direct-completion-browser.ts"], bundle: true, platform: "browser", format: "esm", write: false, metafile: true });
    for (const bundle of [wrapper, workerBundle]) {
      expect(bundle.outputFiles[0].text).not.toMatch(/node:crypto|node:fs|node:child_process/);
      for (const file of ["src/lib/parent/snap-draft.ts", "src/lib/parent/snap-signing-copy.ts", "src/lib/parent/snap-direct-completion.ts"])
        expect(Object.keys(bundle.metafile!.inputs)).not.toContain(file);
      expect(Object.keys(bundle.metafile!.inputs)).toContain("data/verified-forms/snap-pa600fs-2019.json");
    }
  });
  it("returns exact server bytes through the actual bundled worker, with closed readiness", async () => {
    const value = input(), before = structuredClone(value), result = await run(value);
    expect(result).toEqual(baseline); expect(value).toEqual(before); expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(true);
  });
  it("preserves explicit identifier deferral and exact server bytes through the real browser bundle", async () => {
    const value = input(), personId = value.completion.identifiers[0].personId;
    value.completion.identifiers[0] = { personId, kind: "provide_to_agency_later" };
    const server = await renderSnapDirectCompletion(template, value.trusted, value.completion, now), result = await run(value);
    expect(result).toEqual(server); expect(result.readiness).toMatchObject({ filingReadiness: "initial_filing_identifiers_outstanding", outstandingIdentifierSubjectIds: [personId], submissionReady: false });
  });
  it("copies bytes, scope, private inputs and the entry clock before its first await", async () => {
    const value = input(), clock = new Date(now), pending = completeSnapDirectCompletionInBrowser(value.unsigned, value.trusted, value.completion, clock);
    value.unsigned.fill(0); value.trusted.snapshot.details.screening!.lowCashAndIncome = true;
    value.completion.certifications[0].strokes[0][0].x = 0.99;
    value.completion.identifiers[0] = { personId: value.completion.identifiers[0].personId, kind: "ssn", value: "900000009" };
    Reflect.set(value.trusted.snapshot.source, "templateSha256", "f".repeat(64)); clock.setTime(0);
    expect(await pending).toEqual(baseline);
  });
  it("preserves fixed input dispositions before starting a worker", async () => {
    const value = input(); value.completion.requestVersion++;
    expect(await run(value)).toMatchObject({ bytes: null, readiness: { reason: "scope_changed", submissionReady: false } });
    expect(workers).toHaveLength(0);
  });
  it("honors an already aborted signal without creating a worker", async () => {
    await expect(run(input(), AbortSignal.abort())).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR); expect(workers).toHaveLength(0);
  });
  it.each([0, 10485761])("rejects a %i-byte unsigned input before starting a worker", async size => {
    await expect(run({ ...input(), unsigned: new Uint8Array(size) })).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR); expect(workers).toHaveLength(0);
  });
  it("terminates a stuck worker at its mandatory deadline without a caller signal", async () => {
    vi.useFakeTimers(); let terminated = false;
    class StuckWorker { onmessage = null; onerror = null; onmessageerror = null; postMessage() {} terminate() { terminated = true; } }
    vi.stubGlobal("Worker", StuckWorker);
    const rejection = expect(run()).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR);
    await vi.advanceTimersByTimeAsync(10001); await rejection; expect(terminated).toBe(true);
  });
  it("terminates on abort and wipes late replies, including detached buffers", async () => {
    let reply!: (event: MessageEvent) => void, terminated = false;
    class LateWorker {
      onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; onmessageerror = null;
      postMessage() { reply = this.onmessage!; } terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", LateWorker);
    const controller = new AbortController(), rejection = expect(run(input(), controller.signal)).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR);
    controller.abort(); await rejection; expect(terminated).toBe(true);
    const late = structuredClone(baseline); await reply({ data: { ok: true, result: late } } as MessageEvent);
    expect(late.bytes?.every(byte => byte === 0)).toBe(true);
    const detached = new Uint8Array([1, 2]); structuredClone(detached, { transfer: [detached.buffer] });
    await expect(reply({ data: { ok: true, result: { ...baseline, bytes: detached } } } as MessageEvent)).resolves.toBeUndefined();
  });
  it.each(["failure", "extra", "scope", "length", "hash", "ready", "deferral", "initial_filing"])("rejects a %s worker reply without leaking private content", async kind => {
    const result = structuredClone(baseline);
    if (!result.bytes) throw new Error("synthetic fixture missing");
    if (kind === "scope") result.readiness.requestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    if (kind === "length") result.byteLength++;
    if (kind === "hash") result.contentSha256 = "f".repeat(64);
    if (kind === "ready") Reflect.set(result.readiness, "submissionReady", true);
    if (kind === "deferral") { result.readiness.outstandingIdentifierSubjectIds = [fixture.trusted.context.applyingSubjectIds[0]]; result.readiness.filingReadiness = "initial_filing_identifiers_outstanding"; }
    if (kind === "initial_filing") result.readiness.filingReadiness = "initial_filing_identifiers_outstanding";
    const data = kind === "failure" ? { ok: false } : { ok: true, result, ...(kind === "extra" ? { private: "PRIVATE_INPUT_CANARY" } : {}) };
    class ReplyWorker {
      onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; onmessageerror = null;
      postMessage() { queueMicrotask(() => this.onmessage?.({ data } as MessageEvent)); } terminate() {}
    }
    vi.stubGlobal("Worker", ReplyWorker);
    await expect(run()).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR);
    if (kind !== "failure") expect(result.bytes.every(byte => byte === 0)).toBe(true);
  });
  it("accepts only the first worker reply while its digest is pending and wipes the duplicate", async () => {
    const first = structuredClone(baseline), second = structuredClone(baseline);
    if (!second.bytes) throw new Error("synthetic fixture missing");
    second.bytes[100] ^= 1; second.contentSha256 = sha(second.bytes);
    class DuplicateWorker {
      onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; onmessageerror = null;
      postMessage() {
        const reply = this.onmessage!;
        queueMicrotask(() => { reply({ data: { ok: true, result: first } } as MessageEvent); reply({ data: { ok: true, result: second } } as MessageEvent); });
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", DuplicateWorker);
    expect(await run()).toEqual(baseline); expect(second.bytes.every(byte => byte === 0)).toBe(true);
  });
  it.each(["error", "messageerror", "clone"])("contains a worker %s failure and terminates it", async kind => {
    let terminated = false, prevented = false;
    class BrokenWorker {
      onmessage = null; onerror: ((event: ErrorEvent) => void) | null = null; onmessageerror: (() => void) | null = null;
      postMessage() {
        if (kind === "clone") throw new Error("PRIVATE_INPUT_CANARY");
        queueMicrotask(() => kind === "error" ? this.onerror?.({ preventDefault() { prevented = true; } } as ErrorEvent) : this.onmessageerror?.());
      }
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", BrokenWorker);
    await expect(run()).rejects.toThrow(SNAP_DIRECT_COMPLETION_ERROR); expect(terminated).toBe(true);
    if (kind === "error") expect(prevented).toBe(true);
  });
  it("contains actual pdf-lib numeric diagnostics while a concurrent good worker succeeds", async () => {
    const value = input(), document = await PDFDocument.load(value.unsigned), secret = "987654321".repeat(20);
    document.catalog.set(PDFName.of("Probe"), PDFNumber.of(1));
    const source = Buffer.from(await document.save({ useObjectStreams: false }));
    value.unsigned = new Uint8Array(Buffer.from(source.toString("latin1").replace("/Probe 1", `/Probe ${secret}`), "latin1"));
    expect(Buffer.from(value.unsigned).includes(Buffer.from(secret))).toBe(true);
    value.trusted.unsignedContentSha256 = value.completion.unsignedContentSha256 = sha(value.unsigned);
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map(spy => spy.mockImplementation(() => {}));
    const results = await Promise.allSettled([run(value), run()]);
    expect(results.map(result => result.status === "fulfilled" ? { status: result.status, reason: result.value.readiness.reason } : { status: result.status }))
      .toEqual([{ status: "rejected" }, { status: "fulfilled", reason: null }]);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe(SNAP_DIRECT_COMPLETION_ERROR);
    expect((results[1] as PromiseFulfilledResult<SnapDirectCompletionResult>).value).toEqual(baseline);
    expect(workers).toHaveLength(2); for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
