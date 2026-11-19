import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicSyntheticFaxPdf, runSinchFaxEmulatorProbe, SINCH_PROBE_ERROR } from "./parent-sinch-emulator-probe";
import { SINCH_FAX_EMULATOR_NUMBER, type SinchFaxEmulationOperation } from "../src/lib/parent/sinch-fax";

const config = { projectId: "synthetic-project", serviceId: "synthetic-service", fromNumber: "+12155550101", accessKey: "synthetic-key", secretKey: "SYNTHETIC_PRIVATE_CREDENTIAL" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
type Intent = { operation: SinchFaxEmulationOperation; byteLength: number };
function fax(operation: SinchFaxEmulationOperation, completed = false) {
  return { id: "01HDF5S9P29WC29J578J8EKC1C", projectId: operation.projectId, serviceId: operation.serviceId,
    direction: "OUTBOUND", to: operation.to, from: operation.from, status: completed ? "COMPLETED" : "QUEUED",
    createTime: operation.attemptedAt, maxRetries: 0, retryCount: 0,
    labels: { operationRef: operation.operationRef, sourceSha256: operation.contentSha256, pageCount: String(operation.pageCount) },
    ...(completed ? { numberOfPages: operation.pageCount, pagesSentSuccessfully: operation.pageCount, completedTime: new Date().toISOString() } : {}) };
}
const listed = (faxes: unknown[]) => ({ faxes, page: 0, pageSize: 100, totalPages: 1, totalItems: faxes.length });

describe("durable emulator-only fax probe", () => {
  let directory: string, configPath: string, attempt: string;
  const intent = () => JSON.parse(readFileSync(join(attempt, "intent.json"), "utf8")) as Intent;
  const observations = () => readdirSync(attempt).filter(name => name.startsWith("observation-")).map(name => readFileSync(join(attempt, name), "utf8"));
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "caselink-sinch-probe-test-"));
    configPath = join(directory, "private-config.json"); attempt = join(directory, "one-attempt");
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

  it("produces a deterministic public-only original with exactly 12 pages", async () => {
    const first = await publicSyntheticFaxPdf(), second = await publicSyntheticFaxPdf();
    expect(first).toEqual(second);
    expect((await PDFDocument.load(first)).getPageCount()).toBe(12);
  });

  it("persists exact original bytes and immutable intent before its single POST", async () => {
    const originalConfig = readFileSync(configPath);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, request) => {
      expect(request?.method).toBe("POST");
      const saved = intent(), original = readFileSync(join(attempt, "source.pdf"));
      const form = request?.body as FormData, file = form.get("file") as File;
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(original));
      expect(saved).toMatchObject({ kind: "sinch_fax_emulation_intent", source: "public_synthetic_v1", byteLength: original.length,
        operation: { to: SINCH_FAX_EMULATOR_NUMBER, pageCount: 12, contentSha256: hash(original) } });
      expect(form.get("labels[operationRef]")).toBe(saved.operation.operationRef);
      expect(form.get("labels[sourceSha256]")).toBe(hash(original));
      expect(statSync(join(attempt, "intent.json")).mode & 0o777).toBe(0o600);
      return json(fax(saved.operation));
    });
    expect(await runSinchFaxEmulatorProbe(configPath, attempt, fetcher)).toEqual({ kind: "sinch_fax_emulation_probe", state: "pending" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(statSync(attempt).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(attempt)) expect(statSync(join(attempt, name)).mode & 0o777).toBe(0o600);
    expect(readFileSync(configPath)).toEqual(originalConfig);
    expect(observations()).toHaveLength(1);
    expect(observations().join()).not.toContain(config.secretKey);
  });

  it("retains unknown attempts across fresh clients and only reconciles on every restart", async () => {
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_PROVIDER_DIAGNOSTIC"));
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, failed)).state).toBe("unknown");
    const frozen = readFileSync(join(attempt, "intent.json"));
    const noMatch = vi.fn<typeof fetch>().mockResolvedValue(json(listed([])));
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, noMatch)).state).toBe("unknown");
    const completed = vi.fn<typeof fetch>().mockResolvedValue(json(listed([fax(intent().operation, true)])));
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, completed)).state).toBe("completed");
    expect(failed).toHaveBeenCalledOnce();
    for (const fetcher of [noMatch, completed]) {
      expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
      const url = new URL(fetcher.mock.calls[0][0] as string), operation = intent().operation;
      expect(url.searchParams.get("to")).toBe(SINCH_FAX_EMULATOR_NUMBER);
      expect(url.searchParams.get("serviceId")).toBe(config.serviceId);
      expect(Date.parse(url.searchParams.get("createTime>")!)).toBe(Date.parse(operation.attemptedAt) - 60_000);
      expect(Date.parse(url.searchParams.get("createTime<")!)).toBe(Date.parse(operation.attemptedAt) + 60_000);
    }
    expect(readFileSync(join(attempt, "intent.json"))).toEqual(frozen);
    expect(observations()).toHaveLength(3);
    expect(observations().join()).not.toMatch(/PRIVATE_PROVIDER_DIAGNOSTIC|SYNTHETIC_PRIVATE_CREDENTIAL/);
  });

  it("does not race concurrent invocations into two POSTs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, request) => request?.method === "POST" ? json(fax(intent().operation)) : json(listed([])));
    const results = await Promise.all([runSinchFaxEmulatorProbe(configPath, attempt, fetcher), runSinchFaxEmulatorProbe(configPath, attempt, fetcher)]);
    expect(results.map(result => result.state)).toContain("pending");
    expect(fetcher.mock.calls.filter(([, request]) => request?.method === "POST")).toHaveLength(1);
  });

  it.each(["missing", "partial"])("never POSTs a reserved attempt with a %s intent after a crash", async state => {
    mkdirSync(attempt, { mode: 0o700 });
    if (state === "partial") writeFileSync(join(attempt, "intent.json"), '{"PRIVATE_PARTIAL_WRITE":', { mode: 0o600 });
    const fetcher = vi.fn<typeof fetch>();
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, fetcher)).state).toBe("unknown");
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, fetcher)).state).toBe("unknown");
    expect(fetcher).not.toHaveBeenCalled();
    if (state === "partial") expect(readFileSync(join(attempt, "intent.json"), "utf8")).toBe('{"PRIVATE_PARTIAL_WRITE":');
  });

  it.each(["changed_source", "wrong_destination", "wrong_config", "public_intent", "source_symlink", "intent_symlink", "public_directory"])("does not contact the provider for %s on restart", async kind => {
    await runSinchFaxEmulatorProbe(configPath, attempt, vi.fn<typeof fetch>().mockResolvedValue(json({})));
    if (kind === "changed_source") writeFileSync(join(attempt, "source.pdf"), "PRIVATE_CHANGED_DOCUMENT");
    if (kind === "wrong_destination") {
      const saved = intent(); saved.operation = { ...saved.operation, to: "+12155550102" } as unknown as SinchFaxEmulationOperation;
      writeFileSync(join(attempt, "intent.json"), JSON.stringify(saved));
    }
    if (kind === "wrong_config") writeFileSync(configPath, JSON.stringify({ ...config, serviceId: "other-service" }));
    if (kind === "public_intent") chmodSync(join(attempt, "intent.json"), 0o644);
    if (kind === "public_directory") chmodSync(attempt, 0o755);
    if (kind === "source_symlink" || kind === "intent_symlink") {
      const path = join(attempt, kind === "source_symlink" ? "source.pdf" : "intent.json"); unlinkSync(path); symlinkSync(configPath, path);
    }
    const fetcher = vi.fn<typeof fetch>();
    expect((await runSinchFaxEmulatorProbe(configPath, attempt, fetcher)).state).toBe("unknown");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["public_config", "symlink", "oversized", "malformed", "callback"])("refuses %s configuration with a content-free error before reserving an attempt", async kind => {
    if (kind === "public_config") chmodSync(configPath, 0o644);
    if (kind === "symlink") {
      const target = join(directory, "other-private.json"); writeFileSync(target, JSON.stringify(config), { mode: 0o600 });
      unlinkSync(configPath); symlinkSync(target, configPath);
    }
    if (kind === "oversized") writeFileSync(configPath, "PRIVATE_CONFIG".repeat(2000));
    if (kind === "malformed") writeFileSync(configPath, "PRIVATE_CONFIG_DIAGNOSTIC");
    if (kind === "callback") writeFileSync(configPath, JSON.stringify({ ...config, callbackUrl: "https://example.invalid/private" }));
    const fetcher = vi.fn<typeof fetch>();
    await expect(runSinchFaxEmulatorProbe(configPath, attempt, fetcher)).rejects.toThrow(SINCH_PROBE_ERROR);
    expect(existsSync(attempt)).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });

  it("reaches the actual offline command and prints only its fixed error on invalid arguments", () => {
    try {
      execFileSync(process.execPath, ["--import", "tsx", "scripts/parent-sinch-emulator-probe.ts", "PRIVATE_ARGUMENT_CANARY"], { encoding: "utf8", stdio: "pipe" });
      throw new Error("Expected the command to fail.");
    } catch (error) {
      const result = error as { status: number; stdout: string; stderr: string };
      expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toBe(`${SINCH_PROBE_ERROR}\n`);
      expect(result.stderr).not.toContain("PRIVATE_ARGUMENT_CANARY");
    }
  });

  it("runs an absolute CLI invocation from outside the repository", () => {
    try {
      execFileSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./parent-sinch-emulator-probe.ts", import.meta.url)), "PRIVATE_ARGUMENT_CANARY"],
        { cwd: directory, encoding: "utf8", stdio: "pipe" });
      throw new Error("Expected the command to fail.");
    } catch (error) {
      const result = error as { status: number; stdout: string; stderr: string };
      expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toBe(`${SINCH_PROBE_ERROR}\n`);
    }
  });
});
