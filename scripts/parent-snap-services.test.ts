import { chmodSync, constants, linkSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSnapPrivateServices, readSnapPrivateServices, snapPrivateChildEnvironment, snapSenderWorkerEnvironment } from "./parent-snap-services";
import { localServiceEnvironment } from "./parent-local-services";

const now = "2026-11-07T18:20:00.000Z";
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, openSync: vi.fn(actual.openSync) };
});
function config() { return { approvalReference: "offline synthetic fixture; not runtime approval", approvedUntil: "2026-11-07T18:21:00.000Z",
  publicOrigin: "http://127.0.0.1:3200", appOrigin: "http://127.0.0.1:3201", reviewOrigin: "http://127.0.0.1:3341", senderOrigin: "http://127.0.0.1:3340",
  supabaseOrigin: "http://127.0.0.1:55321", supabasePublicKey: "sb_publishable_fixture",
  finalizerDatabaseUrl: "postgresql://caselink_finalizer:FINALIZER_PASSWORD_CANARY@127.0.0.1:55322/postgres",
  senderDatabaseUrl: "postgresql://caselink_sender:SENDER_PASSWORD_CANARY@127.0.0.1:55322/postgres", senderSecret: "sender-private-token-".repeat(3),
  carrier: { projectId: "project", serviceId: "service", fromNumber: "+12155550101", accessKey: "carrier-access", secretKey: "CARRIER_SECRET_CANARY",
    destinations: [{ id: "office", version: "fixture-v1", number: "+12155550102", verifiedUntil: "2026-11-07T19:20:00.000Z" }] },
}; }
const paths: string[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("closed private SNAP launcher configuration", () => {
  it("accepts only an explicit bounded local config without provisioning or creating files", () => {
    expect(parseSnapPrivateServices(config())).toEqual(config());
    expect(snapSenderWorkerEnvironment(parseSnapPrivateServices(config()))).toEqual({
      CASELINK_PARENT_SNAP_SENDER_ORIGIN: "http://127.0.0.1:3340", CASELINK_PARENT_SNAP_SENDER_SECRET: config().senderSecret,
    });
  });
  it.each(["expired", "too_long", "hosted", "duplicate_origin", "different_recovery_site", "service_key", "same_login", "encoded_same_login", "broad_database", "emulator", "unknown"])("rejects unsafe %s configuration", kind => {
    const value = config();
    if (kind === "expired") value.approvedUntil = now;
    if (kind === "too_long") value.approvedUntil = "2026-11-09T18:20:00.000Z";
    if (kind === "hosted") value.senderOrigin = "https://outside.invalid";
    if (kind === "duplicate_origin") value.reviewOrigin = value.appOrigin;
    if (kind === "different_recovery_site") value.publicOrigin = "http://127.0.0.1:3420";
    if (kind === "service_key") value.supabasePublicKey = "sb_secret_PRIVATE_CANARY";
    if (kind === "same_login") value.senderDatabaseUrl = value.finalizerDatabaseUrl;
    if (kind === "encoded_same_login") value.senderDatabaseUrl = value.finalizerDatabaseUrl.replace("caselink_finalizer", "%63aselink_finalizer");
    if (kind === "broad_database") value.senderDatabaseUrl = "postgresql://postgres:PRIVATE@127.0.0.1:55322/postgres";
    if (kind === "emulator") value.carrier.destinations[0].number = "+19898989898";
    if (kind === "unknown") Object.assign(value, { activateProvider: true });
    expect(() => parseSnapPrivateServices(value)).toThrow("isolated SNAP services could not run");
  });
  it("gives each private child only its own credentials and keeps the frontdoor secret-free", () => {
    const parent = { PATH: "/usr/bin", HOME: "/fixture", TMPDIR: "/tmp", SUPABASE_SERVICE_ROLE_KEY: "DO_NOT_FORWARD", OPENAI_API_KEY: "DO_NOT_FORWARD", NEXT_PUBLIC_SITE_URL: "DO_NOT_FORWARD" };
    const sender = snapPrivateChildEnvironment("snap-sender", config(), parent), review = snapPrivateChildEnvironment("snap-review", config(), parent), frontdoor = snapPrivateChildEnvironment("snap-frontdoor", config(), parent);
    const senderText = JSON.stringify(sender), reviewText = JSON.stringify(review), frontdoorText = JSON.stringify(frontdoor);
    expect(senderText).toContain("CARRIER_SECRET_CANARY"); expect(senderText).toContain("SENDER_PASSWORD_CANARY"); expect(senderText).not.toContain("FINALIZER_PASSWORD_CANARY");
    expect(reviewText).toContain("FINALIZER_PASSWORD_CANARY"); expect(reviewText).not.toMatch(/CARRIER_SECRET|SENDER_PASSWORD|sender-private-token/);
    expect(frontdoorText).not.toMatch(/PASSWORD_CANARY|CARRIER_SECRET|sender-private-token|sb_publishable/);
    for (const env of [sender, review, frontdoor]) expect(JSON.stringify(env)).not.toContain("DO_NOT_FORWARD");
  });
  it("adds only metadata sender access to the existing worker, leaving the broker untouched", () => {
    const local = { projectUrl: "http://127.0.0.1:55321", approvedUntil: "2026-11-07T18:21:00.000Z", modelBudgetStartedAt: now, modelCallLimit: 12,
      workerDatabaseUrl: "postgresql://caselink_parent_local_worker:worker@127.0.0.1:55322/postgres", brokerDatabaseUrl: "postgresql://caselink_parent_local_broker:broker@127.0.0.1:55322/postgres",
      s3AccessKeyId: "fixture-s3", s3SecretAccessKey: "fixture-s3-secret-at-least-twenty", s3Region: "local", brokerSecret: "broker-secret-".repeat(3) };
    const snap = parseSnapPrivateServices(config());
    const base = localServiceEnvironment("worker", local, "fixture-model-key-at-least-twenty", {});
    expect(base.CASELINK_PARENT_SNAP_SENDER_SECRET).toBeUndefined();
    const worker = localServiceEnvironment("worker", local, "fixture-model-key-at-least-twenty", {}, snap);
    expect(worker.CASELINK_PARENT_SNAP_SENDER_SECRET).toBe(snap.senderSecret);
    expect(JSON.stringify(worker)).not.toMatch(/FINALIZER_PASSWORD|SENDER_PASSWORD|CARRIER_SECRET/);
    expect(localServiceEnvironment("broker", local, undefined, {}, snap)).toEqual(localServiceEnvironment("broker", local, undefined, {}));
  });
});

describe("owner-only private config file", () => {
  function fixture() {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "caselink-snap-config-test-"))); paths.push(directory);
    const file = join(directory, "fixture.json"); writeFileSync(file, JSON.stringify(config()), { mode: 0o600 });
    return { directory, file };
  }
  it("reads an owned0600 file in an owned0700 directory without changing it", () => {
    const { file } = fixture(), before = readFileSync(file);
    expect(readSnapPrivateServices(file)).toEqual(config()); expect(readFileSync(file).equals(before)).toBe(true);
    expect(vi.mocked(openSync).mock.calls.some(([path, flags]) => path === file && flags === (constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK))).toBe(true);
  });
  it.each(["public_file", "public_directory", "hardlink", "symlink", "oversized", "malformed", "missing"])("rejects %s without leaking file contents", kind => {
    const { file, directory } = fixture(); let path = file;
    if (kind === "public_file") chmodSync(file, 0o644);
    if (kind === "public_directory") chmodSync(directory, 0o755);
    if (kind === "hardlink") linkSync(file, join(directory, "copy.json"));
    if (kind === "symlink") { path = join(directory, "link.json"); symlinkSync(file, path); }
    if (kind === "oversized") writeFileSync(file, "PRIVATE_CANARY".repeat(6000));
    if (kind === "malformed") writeFileSync(file, "PRIVATE_CANARY");
    if (kind === "missing") path = join(directory, "absent.json");
    expect(() => readSnapPrivateServices(path)).toThrow("isolated SNAP services could not run");
  });
});
