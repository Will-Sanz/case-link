import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSinchFaxEmulator, SINCH_FAX_EMULATOR_NUMBER, SINCH_FAX_ERROR, type SinchFaxEmulationOperation } from "./sinch-fax";

const now = "2026-11-04T17:00:00.000Z";
const faxId = "01HDF5S9P29WC29J578J8EKC1C";
const key = "private-request-context-never-sent";
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const config = { projectId: "synthetic-project", serviceId: "synthetic-service", fromNumber: "+12155550101", accessKey: "synthetic-key", secretKey: "synthetic-secret" };
const pdf = await PDFDocument.create();
pdf.addPage(); pdf.addPage();
const bytes = await pdf.save();
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const input = () => ({ bytes, contentSha256: sha256(bytes), pageCount: 2, idempotencyKey: key });
function operation(): SinchFaxEmulationOperation {
  return { projectId: config.projectId, serviceId: config.serviceId, from: config.fromNumber, to: SINCH_FAX_EMULATOR_NUMBER,
    operationRef: sha256(key), contentSha256: sha256(bytes), pageCount: 2, attemptedAt: now };
}
function fax(overrides: Record<string, unknown> = {}) {
  const op = operation();
  return { id: faxId, projectId: op.projectId, serviceId: op.serviceId, from: op.from, to: op.to, direction: "OUTBOUND", status: "QUEUED",
    createTime: now, maxRetries: 0, retryCount: 0, labels: { operationRef: op.operationRef, sourceSha256: op.contentSha256, pageCount: "2" }, ...overrides };
}
const completed = (overrides: Record<string, unknown> = {}) => fax({ status: "COMPLETED", numberOfPages: 2, pagesSentSuccessfully: 2, completedTime: now, ...overrides });
const window = { fromTime: "2026-11-04T16:59:00.000Z", toTime: "2026-11-04T17:01:00.000Z" };
const list = (faxes: unknown[], overrides: Record<string, unknown> = {}) => ({ faxes, page: 0, totalPages: 1, pageSize: 100, totalItems: faxes.length, ...overrides });
const numericCanary = "123456789012345678901234567890";
function unsupportedPdf(kind: "large_number" | "invalid_object" | "zero_object") {
  return new TextEncoder().encode(`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R ${kind === "large_number" ? `/Probe ${numericCanary}` : ""} >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>
endobj
${kind === "invalid_object" ? "4 0 obj\n@PRIVATE_PDF_CANARY\nendobj" : ""}
${kind === "zero_object" ? "0 0 obj\n<< /Probe (PRIVATE_PDF_CANARY) >>\nendobj" : ""}
trailer
<< /Root 1 0 R /Size 5 >>
%%EOF`);
}

describe("Sinch emulator-only private-byte client", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("uploads the exact PDF privately to only the documented emulator, with opaque labels and zero retries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(fax({ retryCount: undefined })));
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const result = await client.sendSyntheticTest(input());
    expect(result).toEqual({ kind: "sinch_fax_emulation", state: "pending", operation: operation(), faxId });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://fax.api.sinch.com/v3/projects/synthetic-project/faxes");
    expect(options).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store", headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from("synthetic-key:synthetic-secret").toString("base64")}` } });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const form = options?.body as FormData;
    expect(Array.from(form.keys()).sort()).toEqual(["to", "from", "serviceId", "maxRetries", "resolution", "labels[operationRef]", "labels[sourceSha256]", "labels[pageCount]", "file"].sort());
    expect(Object.fromEntries(Array.from(form.entries()).filter(([name]) => name !== "file"))).toEqual({
      to: SINCH_FAX_EMULATOR_NUMBER, from: config.fromNumber, serviceId: config.serviceId, maxRetries: "0", resolution: "FINE",
      "labels[operationRef]": sha256(key), "labels[sourceSha256]": sha256(bytes), "labels[pageCount]": "2",
    });
    const file = form.get("file") as File;
    expect(file.name).toBe("document.pdf"); expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(JSON.stringify(Object.fromEntries(form))).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("freezes supplied bytes and metadata before asynchronous PDF validation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(fax()));
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const value = { ...input(), bytes: Uint8Array.from(bytes) }, original = Uint8Array.from(bytes);
    const pending = client.sendSyntheticTest(value);
    value.bytes.fill(0); value.contentSha256 = "c".repeat(64); value.idempotencyKey = "changed"; value.pageCount = 1;
    expect((await pending).operation).toEqual(operation());
    expect(new Uint8Array(await ((fetcher.mock.calls[0][1]?.body as FormData).get("file") as File).arrayBuffer())).toEqual(original);
  });

  it.each(["altered", "wrong_hash", "wrong_pages", "not_pdf", "broken_pdf", "empty", "oversized", "zero_pages", "extra_destination"])("rejects %s before any provider request", async kind => {
    const value = input();
    if (kind === "altered") value.bytes = Uint8Array.from([...bytes, 32]);
    if (kind === "wrong_hash") value.contentSha256 = "c".repeat(64);
    if (kind === "wrong_pages") value.pageCount = 1;
    if (kind === "not_pdf") { value.bytes = new TextEncoder().encode("private data"); value.contentSha256 = sha256(value.bytes); }
    if (kind === "broken_pdf") { value.bytes = new TextEncoder().encode("%PDF-1.7 private data"); value.contentSha256 = sha256(value.bytes); }
    if (kind === "empty") value.bytes = new Uint8Array();
    if (kind === "oversized") value.bytes = new Uint8Array(20 * 1024 * 1024 + 1);
    if (kind === "zero_pages") value.pageCount = 0;
    if (kind === "extra_destination") Object.assign(value, { to: "+12155550102" });
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest(value)).rejects.toThrow(SINCH_FAX_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["large_number", "invalid_object", "zero_object"] as const)("contains %s parser diagnostics and rejects the PDF before upload", async kind => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const malformed = unsupportedPdf(kind), fetcher = vi.fn<typeof fetch>();
    await expect(createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest({
      ...input(), bytes: malformed, contentSha256: sha256(malformed), pageCount: 1,
    })).rejects.toThrow(SINCH_FAX_ERROR);
    expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify([...stdout.mock.calls, ...stderr.mock.calls])).not.toMatch(new RegExp(`${numericCanary}|PRIVATE_PDF_CANARY`));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("terminates bounded PDF inspection without exposing diagnostics or dispatching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const pending = createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest(input());
    const rejected = expect(pending).rejects.toThrow(SINCH_FAX_ERROR);
    vi.advanceTimersByTime(5000);
    await rejected;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["project_path", "service_path", "multiple_senders", "callback", "credential_newline"])("rejects unsafe %s configuration", kind => {
    const value = { ...config };
    if (kind === "project_path") value.projectId = "other/../../project";
    if (kind === "service_path") value.serviceId = "service?callback=private";
    if (kind === "multiple_senders") value.fromNumber += ",+12155550102";
    if (kind === "callback") Object.assign(value, { callbackUrl: "https://example.invalid/private" });
    if (kind === "credential_newline") value.accessKey += "\r\nprivate";
    expect(() => createSinchFaxEmulator(value)).toThrow(SINCH_FAX_ERROR);
  });

  it("never treats even immediate completed POST data as a completed test", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed()));
    expect((await createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest(input())).state).toBe("pending");
  });

  it("never resends the same operation after timeout or malformed send, and preserves the opaque tag", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private credential or response content"));
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const first = await client.sendSyntheticTest(input());
    expect(first).toEqual({ kind: "sinch_fax_emulation", state: "unknown", operation: operation() });
    expect(await client.sendSyntheticTest(input())).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client.sendSyntheticTest({ ...input(), pageCount: 1 })).rejects.toThrow(SINCH_FAX_ERROR);
    expect(JSON.stringify(first)).not.toMatch(/private credential|synthetic-secret|private-request/);
  });

  it("does not race two calls into duplicate sends", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(fax()));
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const results = await Promise.all([client.sendSyntheticTest(input()), client.sendSyntheticTest(input())]);
    expect(results.map(value => value.state).sort()).toEqual(["pending", "unknown"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("awaits the exact durable intent before dispatching", async () => {
    let finish!: () => void;
    let started!: () => void;
    const saved = new Promise<void>(resolve => { finish = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(fax()));
    const beforeSend = vi.fn(async (value: SinchFaxEmulationOperation) => { expect(value).toEqual(operation()); started(); await saved; });
    const pending = createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest(input(), undefined, beforeSend);
    await ready;
    expect(fetcher).not.toHaveBeenCalled();
    finish();
    expect((await pending).state).toBe("pending"); expect(fetcher).toHaveBeenCalledOnce();
  });

  it("contains a failed or partial durable write and does not POST or retry it", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const beforeSend = vi.fn(async () => { throw new Error("PRIVATE_PARTIAL_FILESYSTEM_WRITE"); });
    const result = await client.sendSyntheticTest(input(), undefined, beforeSend);
    expect(result.state).toBe("unknown"); expect(JSON.stringify(result)).not.toContain("PRIVATE_PARTIAL_FILESYSTEM_WRITE");
    expect((await client.sendSyntheticTest(input())).state).toBe("unknown");
    expect(beforeSend).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not dispatch a cancelled test or subsequently retry it", async () => {
    const fetcher = vi.fn<typeof fetch>(); const client = createSinchFaxEmulator({ ...config, fetcher });
    const controller = new AbortController(); controller.abort("private cancellation detail");
    expect((await client.sendSyntheticTest(input(), controller.signal)).state).toBe("unknown");
    expect((await client.sendSyntheticTest(input())).state).toBe("unknown");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("classifies authenticated full-page completion only as emulator evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed({ retryCount: undefined })));
    const result = await createSinchFaxEmulator({ ...config, fetcher }).inspect(operation(), faxId);
    expect(result).toEqual({ kind: "sinch_fax_emulation", state: "completed", operation: operation(), faxId, completedAt: now });
    expect(fetcher.mock.calls[0][0]).toBe(`https://fax.api.sinch.com/v3/projects/synthetic-project/faxes/${faxId}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
    expect(JSON.stringify(result)).not.toMatch(/agency|receipt|"sent"/);
  });

  it.each(["QUEUED", "IN_PROGRESS"])("keeps %s pending without claiming delivery", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(fax({ status })));
    expect((await createSinchFaxEmulator({ ...config, fetcher }).inspect(operation(), faxId)).state).toBe("pending");
  });

  it.each([
    ["wrong destination", { to: "+12155550102" }], ["multiple destinations", { to: [SINCH_FAX_EMULATOR_NUMBER, "+12155550102"] }],
    ["wrong sender", { from: "+12155550102" }], ["wrong service", { serviceId: "another" }], ["wrong project", { projectId: "another" }],
    ["wrong direction", { direction: "INBOUND" }], ["wrong ID", { id: "another" }],
    ["wrong tag", { labels: { ...fax().labels, operationRef: "c".repeat(64) } }],
    ["wrong source", { labels: { ...fax().labels, sourceSha256: "c".repeat(64) } }],
    ["wrong page label", { labels: { ...fax().labels, pageCount: "3" } }],
    ["partial", { pagesSentSuccessfully: 1 }], ["missing page evidence", { pagesSentSuccessfully: undefined }], ["extra page", { numberOfPages: 3 }],
    ["missing completion time", { completedTime: undefined }], ["completion before creation", { completedTime: "2026-11-04T16:59:00Z" }],
    ["future completion", { completedTime: "2026-11-04T18:00:00Z" }], ["old creation", { createTime: "2026-11-03T17:00:00Z" }],
    ["cancellation", { status: "CANCELLED" }], ["failure", { status: "FAILURE", errorMessage: "private provider detail" }],
    ["missing retry setting", { maxRetries: undefined }], ["retry enabled", { maxRetries: 3 }],
    ["already retried", { retryCount: 1 }], ["negative retry count", { retryCount: -1 }],
    ["fractional retry count", { retryCount: 0.5 }], ["string retry count", { retryCount: "0" }], ["null retry count", { retryCount: null }],
    ["remote content", { contentUrl: "https://example.invalid/document" }], ["callback", { callbackUrl: "https://example.invalid/callback" }],
    ["cover page", { coverPageId: "another" }],
  ])("returns unknown for %s", async (_name, overrides) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed(overrides)));
    const result = await createSinchFaxEmulator({ ...config, fetcher }).inspect(operation(), faxId);
    expect(result.state).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("private provider detail");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reconciles exactly one matching operation from a complete, narrowly bounded result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(list([completed({ retryCount: undefined })])));
    const result = await createSinchFaxEmulator({ ...config, fetcher }).reconcile(operation(), window);
    expect(result.state).toBe("completed");
    const url = new URL(fetcher.mock.calls[0][0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({ serviceId: config.serviceId, direction: "OUTBOUND", to: SINCH_FAX_EMULATOR_NUMBER,
      from: config.fromNumber, "createTime>": window.fromTime, "createTime<": window.toTime, pageSize: "100" });
    expect(url.toString()).not.toContain(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["zero matches", list([])], ["duplicates", list([completed(), completed({ id: "duplicate" })])],
    ["another tag", list([completed({ labels: { ...fax().labels, operationRef: "c".repeat(64) } })])],
    ["incomplete page", list([completed()], { totalItems: 2 })], ["more pages", list([completed()], { totalPages: 2 })],
    ["inconsistent page count", list([completed()], { totalPages: 0 })],
    ["too small page size", list([completed(), completed({ labels: { ...fax().labels, operationRef: "c".repeat(64) } })], { pageSize: 1 })],
    ["missing pagination", { faxes: [completed()] }], ["wrong source", list([completed({ from: "+12155550102" })])],
    ["outside time window", list([completed({ createTime: "2026-11-04T16:58:00Z" })])],
  ])("does not reconcile %s or make another request", async (_name, response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(response));
    expect((await createSinchFaxEmulator({ ...config, fetcher }).reconcile(operation(), window)).state).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { fromTime: "bad", toTime: now },
    { fromTime: "2026-11-04T17:00:01Z", toTime: "2026-11-04T17:01:00Z" },
    { fromTime: "2026-11-04T16:58:00Z", toTime: "2026-11-04T16:59:00Z" },
    { fromTime: "2026-11-04T15:00:00Z", toTime: "2026-11-04T18:00:00Z" },
  ])("rejects an unbounded or unrelated search before GET", async badWindow => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSinchFaxEmulator({ ...config, fetcher }).reconcile(operation(), badWindow)).rejects.toThrow(SINCH_FAX_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects changed operation scope and path injection before GET", async () => {
    const fetcher = vi.fn<typeof fetch>(); const client = createSinchFaxEmulator({ ...config, fetcher });
    await expect(client.inspect({ ...operation(), serviceId: "another" }, faxId)).rejects.toThrow(SINCH_FAX_ERROR);
    await expect(client.inspect(operation(), "../services/private")).rejects.toThrow(SINCH_FAX_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["malformed", "redirect", "unexpected_redirect", "wrong_origin", "missing_body", "unauthorized", "rate_limited", "server_failure"])("contains %s responses without following or resending", async kind => {
    let response = json(fax());
    if (kind === "malformed") response = new Response("private malformed response");
    if (kind === "redirect") response = new Response(null, { status: 302, headers: { Location: "https://example.invalid/private" } });
    if (kind === "unexpected_redirect") Object.defineProperty(response, "redirected", { value: true });
    if (kind === "wrong_origin") Object.defineProperty(response, "url", { value: "https://example.invalid/private" });
    if (kind === "missing_body") response = new Response(null);
    if (kind === "unauthorized") response = new Response("private", { status: 401 });
    if (kind === "rate_limited") response = new Response("private", { status: 429 });
    if (kind === "server_failure") response = new Response("private", { status: 500 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response); const client = createSinchFaxEmulator({ ...config, fetcher });
    expect((await client.sendSyntheticTest(input())).state).toBe("unknown");
    expect((await client.sendSyntheticTest(input())).state).toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancels an oversized response stream and never exposes its content", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    expect((await createSinchFaxEmulator({ ...config, fetcher }).sendSyntheticTest(input())).state).toBe("unknown");
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
});
