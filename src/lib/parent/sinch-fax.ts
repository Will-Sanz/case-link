import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { finished } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { z } from "zod";

// https://developers.sinch.com/docs/fax/api-reference/fax/faxes documents this no-charge emulator.
export const SINCH_FAX_EMULATOR_NUMBER = "+19898989898";
export const SINCH_FAX_ERROR = "The synthetic fax operation could not be verified.";
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const timestamp = z.iso.datetime({ offset: true });
const pageCount = z.number().int().min(1).max(25);

async function inspectPdfPages(bytes: Uint8Array): Promise<number> {
  // pdf-lib can log document values before throwing. Keep every parser diagnostic off the application streams.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { PDFDocument } = require(workerData.modulePath);
    (async () => {
      try {
        const pdf = await PDFDocument.load(workerData.bytes, { updateMetadata: false, throwOnInvalidObject: true, capNumbers: true });
        parentPort.postMessage(pdf.getPageCount());
      } catch { parentPort.postMessage(null); }
    })();
  `, { eval: true, workerData: { bytes, modulePath: createRequire(import.meta.url).resolve("pdf-lib") },
    stdout: true, stderr: true, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
  let result: unknown, messages = 0, diagnostic = false, failed = false;
  worker.stdout.on("data", () => { diagnostic = true; });
  worker.stderr.on("data", () => { diagnostic = true; });
  worker.on("message", value => { result = value; messages++; });
  worker.on("error", () => { failed = true; });
  const exited = new Promise<number>(resolve => { worker.once("exit", resolve); });
  const stop = () => { failed = true; void worker.terminate(); };
  const timer = setTimeout(stop, 5000);
  try {
    const [code] = await Promise.all([exited, finished(worker.stdout), finished(worker.stderr)]);
    if (code !== 0 || failed || diagnostic || messages !== 1) throw new Error(SINCH_FAX_ERROR);
    return pageCount.parse(result);
  } finally {
    clearTimeout(timer); void worker.terminate();
  }
}

export const sinchFaxEmulationOperationSchema = z.object({
  projectId: identifier,
  serviceId: identifier,
  from: phone,
  to: z.literal(SINCH_FAX_EMULATOR_NUMBER),
  operationRef: hash,
  contentSha256: hash,
  pageCount,
  attemptedAt: timestamp,
}).strict();
export type SinchFaxEmulationOperation = Readonly<z.infer<typeof sinchFaxEmulationOperationSchema>>;
export type SinchFaxEmulationEvidence = {
  kind: "sinch_fax_emulation";
  state: "pending" | "completed" | "unknown";
  operation: SinchFaxEmulationOperation;
  faxId?: string;
  completedAt?: string;
};
const faxSchema = z.object({
  id: identifier,
  projectId: identifier,
  serviceId: identifier,
  from: phone,
  to: z.literal(SINCH_FAX_EMULATOR_NUMBER),
  direction: z.literal("OUTBOUND"),
  status: z.enum(["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILURE"]),
  createTime: timestamp,
  completedTime: timestamp.optional(),
  numberOfPages: z.number().int().nonnegative().optional(),
  pagesSentSuccessfully: z.number().int().nonnegative().optional(),
  maxRetries: z.literal(0),
  // Sinch may omit this read-only count; absence is not an observed zero.
  retryCount: z.literal(0).optional(),
  labels: z.object({ operationRef: hash, sourceSha256: hash, pageCount: z.string().regex(/^[1-9][0-9]?$/) }),
  contentUrl: z.unknown().optional(),
  callbackUrl: z.unknown().optional(),
  coverPageId: z.unknown().optional(),
  errorType: z.unknown().optional(),
  errorCode: z.unknown().optional(),
  errorMessage: z.unknown().optional(),
});

/** Emulator only. This is neither real delivery evidence nor an agency submission transport. */
export function createSinchFaxEmulator(input: {
  projectId: string;
  serviceId: string;
  fromNumber: string;
  accessKey: string;
  secretKey: string;
  fetcher?: typeof fetch;
}) {
  const { fetcher = fetch, ...rawConfig } = input;
  const checked = z.object({
    projectId: identifier,
    serviceId: identifier,
    fromNumber: phone,
    accessKey: z.string().min(1).max(256).regex(/^[^:\s]+$/),
    secretKey: z.string().min(1).max(256).regex(/^\S+$/),
  }).strict().safeParse(rawConfig);
  if (!checked.success || typeof fetcher !== "function") throw new Error(SINCH_FAX_ERROR);
  const config = checked.data;
  const base = `https://fax.api.sinch.com/v3/projects/${config.projectId}/faxes`;
  const authorization = `Basic ${Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64")}`;
  const attempted = new Map<string, SinchFaxEmulationOperation>();

  async function request(url: string, method: "GET" | "POST", body?: FormData, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const response = await fetcher(url, {
      method, body, redirect: "manual", cache: "no-store",
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== "https://fax.api.sinch.com") || !response.body)
      throw new Error(SINCH_FAX_ERROR);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) throw new Error(SINCH_FAX_ERROR);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  function checkedOperation(value: SinchFaxEmulationOperation) {
    const parsed = sinchFaxEmulationOperationSchema.safeParse(value);
    if (!parsed.success || parsed.data.projectId !== config.projectId || parsed.data.serviceId !== config.serviceId || parsed.data.from !== config.fromNumber)
      throw new Error(SINCH_FAX_ERROR);
    return parsed.data;
  }
  function evidence(operation: SinchFaxEmulationOperation, state: SinchFaxEmulationEvidence["state"] = "unknown", faxId?: string, completedAt?: string): SinchFaxEmulationEvidence {
    return { kind: "sinch_fax_emulation", state, operation, ...(faxId ? { faxId } : {}), ...(completedAt ? { completedAt } : {}) };
  }
  function classify(operation: SinchFaxEmulationOperation, value: unknown, expectedId?: string): SinchFaxEmulationEvidence {
    const parsed = faxSchema.safeParse(value);
    if (!parsed.success) return evidence(operation);
    const fax = parsed.data;
    const created = Date.parse(fax.createTime), attemptedAt = Date.parse(operation.attemptedAt);
    if ((expectedId && fax.id !== expectedId) || fax.projectId !== operation.projectId || fax.serviceId !== operation.serviceId || fax.from !== operation.from
      || fax.labels.operationRef !== operation.operationRef || fax.labels.sourceSha256 !== operation.contentSha256 || fax.labels.pageCount !== String(operation.pageCount)
      || created < attemptedAt - 60_000 || created > attemptedAt + 30_000 || created > Date.now() + 60_000
      || fax.contentUrl || fax.callbackUrl || fax.coverPageId || fax.errorType || fax.errorCode || fax.errorMessage)
      return evidence(operation);
    if (fax.status === "QUEUED" || fax.status === "IN_PROGRESS") {
      if ((fax.numberOfPages !== undefined && fax.numberOfPages !== operation.pageCount)
        || (fax.pagesSentSuccessfully ?? 0) > operation.pageCount || fax.completedTime) return evidence(operation);
      return evidence(operation, "pending", fax.id);
    }
    const completed = Date.parse(fax.completedTime ?? "");
    if (fax.status !== "COMPLETED" || fax.numberOfPages !== operation.pageCount || fax.pagesSentSuccessfully !== operation.pageCount
      || !Number.isFinite(completed) || completed < created || completed > Date.now() + 60_000) return evidence(operation, "unknown", fax.id);
    return evidence(operation, "completed", fax.id, fax.completedTime);
  }

  return {
    async sendSyntheticTest(value: { bytes: Uint8Array; contentSha256: string; pageCount: number; idempotencyKey: string }, signal?: AbortSignal,
      beforeSend?: (operation: SinchFaxEmulationOperation) => Promise<void>): Promise<SinchFaxEmulationEvidence> {
      const parsed = z.object({ bytes: z.instanceof(Uint8Array), contentSha256: hash, pageCount: sinchFaxEmulationOperationSchema.shape.pageCount, idempotencyKey: z.string().min(1).max(500) }).strict().safeParse(value);
      if (!parsed.success || !parsed.data.bytes.length || parsed.data.bytes.length > MAX_PDF_BYTES) throw new Error(SINCH_FAX_ERROR);
      const payload = parsed.data;
      const bytes = Uint8Array.from(payload.bytes);
      try {
        if (sha256(bytes) !== payload.contentSha256 || !Buffer.from(bytes.subarray(0, 8)).toString().startsWith("%PDF-")
          || await inspectPdfPages(bytes) !== payload.pageCount) throw new Error(SINCH_FAX_ERROR);
      } catch { throw new Error(SINCH_FAX_ERROR); }
      const operationRef = sha256(payload.idempotencyKey);
      const previous = attempted.get(operationRef);
      if (previous) {
        if (previous.contentSha256 !== payload.contentSha256 || previous.pageCount !== payload.pageCount) throw new Error(SINCH_FAX_ERROR);
        return evidence(previous);
      }
      const operation = Object.freeze({ projectId: config.projectId, serviceId: config.serviceId, from: config.fromNumber,
        to: SINCH_FAX_EMULATOR_NUMBER, operationRef, contentSha256: payload.contentSha256, pageCount: payload.pageCount, attemptedAt: new Date().toISOString() });
      const form = new FormData();
      // The source label binds our checked upload; it is not a provider hash of the rendered fax.
      for (const [key, data] of Object.entries({ to: operation.to, from: operation.from, serviceId: operation.serviceId, maxRetries: "0", resolution: "FINE",
        "labels[operationRef]": operation.operationRef, "labels[sourceSha256]": operation.contentSha256, "labels[pageCount]": String(operation.pageCount) })) form.append(key, data);
      form.append("file", new Blob([bytes], { type: "application/pdf" }), "document.pdf");
      // The caller must persist a send intent across restarts; labels do not provide provider idempotency.
      attempted.set(operationRef, operation);
      try {
        await beforeSend?.(operation);
        const result = classify(operation, await request(base, "POST", form, signal));
        return result.state === "completed" ? evidence(operation, "pending", result.faxId) : result;
      } catch { return evidence(operation); }
    },
    async inspect(value: SinchFaxEmulationOperation, faxId: string, signal?: AbortSignal): Promise<SinchFaxEmulationEvidence> {
      const operation = checkedOperation(value);
      if (!identifier.safeParse(faxId).success) throw new Error(SINCH_FAX_ERROR);
      try { return classify(operation, await request(`${base}/${faxId}`, "GET", undefined, signal), faxId); }
      catch { return evidence(operation); }
    },
    async reconcile(value: SinchFaxEmulationOperation, window: { fromTime: string; toTime: string }, signal?: AbortSignal): Promise<SinchFaxEmulationEvidence> {
      const operation = checkedOperation(value);
      const times = z.object({ fromTime: timestamp, toTime: timestamp }).strict().safeParse(window);
      if (!times.success) throw new Error(SINCH_FAX_ERROR);
      const from = Date.parse(window.fromTime), to = Date.parse(window.toTime), attemptedAt = Date.parse(operation.attemptedAt);
      if (from > attemptedAt || to < attemptedAt || to <= from || to - from > 3_600_000) throw new Error(SINCH_FAX_ERROR);
      const query = new URLSearchParams({ serviceId: operation.serviceId, direction: "OUTBOUND", to: operation.to, from: operation.from,
        "createTime>": window.fromTime, "createTime<": window.toTime, pageSize: "100" });
      try {
        const list = z.object({ faxes: z.array(z.unknown()).max(100), page: z.number().int().min(0).max(1), totalPages: z.number().int().min(0).max(1),
          pageSize: z.number().int().min(1).max(100), totalItems: z.number().int().min(0).max(100) }).parse(await request(`${base}?${query}`, "GET", undefined, signal));
        if (list.faxes.length !== list.totalItems || list.totalItems > list.pageSize || (list.totalItems > 0 && list.totalPages !== 1)) return evidence(operation);
        const matches = list.faxes.filter(fax => z.object({ labels: z.object({ operationRef: z.literal(operation.operationRef) }) }).safeParse(fax).success);
        if (matches.length !== 1) return evidence(operation);
        const fax = faxSchema.safeParse(matches[0]);
        if (!fax.success || Date.parse(fax.data.createTime) < from || Date.parse(fax.data.createTime) > to) return evidence(operation);
        return classify(operation, fax.data);
      } catch { return evidence(operation); }
    },
  };
}
