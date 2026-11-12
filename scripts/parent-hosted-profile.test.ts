import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOSTED_PROJECT, hostedChildEnvironment, parseHostedProfile, readHostedProfile, stopAtHostedDeadline } from "./parent-hosted-profile";
import { assertNoHostedDotenv, hostedWebFingerprint } from "./parent-hosted-services";
const now = Date.parse("2026-11-07T12:00:00Z");
const base = { enabled: true, approvalReference: "synthetic hosting test", approvedUntil: "2027-01-01T00:00:00Z", publicOrigin: "https://pilot.thecaselink.com", projectOrigin: HOSTED_PROJECT };
const databaseUrl = "postgresql://caselink_fixture:fixture@db.zpfypkizsapvsxeykmdq.supabase.co/postgres?sslmode=verify-full";
const web = { ...base, service: "web", publicKey: "sb_publishable_synthetic", realDataApproved: true };
const worker = { ...base, service: "worker", databaseUrl, brokerSecret: "b".repeat(32), modelKey: "synthetic-model-key", parserImage: "caselink/parser@sha256:" + "a".repeat(64), dockerHost: "unix:///run/user/1005/docker.sock", parserDaemonId: "synthetic-daemon-identity" };
const paths: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function directory() { const path = mkdtempSync(join(tmpdir(), "caselink-hosted-test-")); chmodSync(path, 0o700); paths.push(path); return realpathSync(path); }
describe("hosted single-service profiles", () => {
  it("fails closed without enablement and the separate real-data gate", () => {
    for (const delta of [{ enabled: false }, { enabled: undefined }, { realDataApproved: false }, { realDataApproved: undefined }]) expect(() => parseHostedProfile({ ...web, ...delta }, now)).toThrow();
  });
  it("rejects different production projects, provider secrets in web and expired operating authority", () => {
    for (const delta of [{ projectOrigin: "https://other.supabase.co" }, { OPENAI_API_KEY: "synthetic" }, { approvedUntil: "2026-11-07T12:00:00Z" }]) expect(() => parseHostedProfile({ ...web, ...delta }, now)).toThrow();
  });
  it("requires separate collection permission for the protected finalizer", () => {
    const input = { ...base, service: "review", databaseUrl, publicKey: web.publicKey };
    expect(() => parseHostedProfile(input, now)).toThrow();
    expect(parseHostedProfile({ ...input, collectionApproved: true }, now).service).toBe("review");
  });
  it("requires separate sending permission and excludes finalizer credentials", () => {
    const input = { ...base, service: "sender", databaseUrl, senderSecret: "s".repeat(32), carrier: {
      projectId: "synthetic-project", serviceId: "synthetic-service", fromNumber: "+12155550100", accessKey: "synthetic", secretKey: "synthetic",
      destinations: [{ id: "pa-dhs-snap-philadelphia-fax", version: "2026-11-07", number: "+12155550101", verifiedUntil: base.approvedUntil }] } };
    expect(() => parseHostedProfile(input, now)).toThrow();
    expect(parseHostedProfile({ ...input, sendingApproved: true }, now).service).toBe("sender");
    expect(() => parseHostedProfile({ ...web, finalizerDatabaseUrl: databaseUrl }, now)).toThrow();
  });
  it("separates a single-snapshot emulator profile from live sending permission", () => {
    const emulator = { requestId: "11111111-1111-4111-8111-111111111111", snapshotHash: "a".repeat(64),
      projectId: "test-project", serviceId: "test-service", fromNumber: "+12155550100", accessKey: "test-key", secretKey: "test-secret" };
    const carrier = { projectId: "unconfigured", serviceId: "unconfigured", fromNumber: "+12155550100", accessKey: "unconfigured", secretKey: "unconfigured",
      destinations: [{ id: "unused", version: "v1", number: "+12155550101", verifiedUntil: base.approvedUntil }] };
    const input = { ...base, service: "sender", databaseUrl, senderSecret: "s".repeat(32), sendingApproved: false, carrier, emulator };
    expect(parseHostedProfile(input, now).service).toBe("sender");
    expect(() => parseHostedProfile({ ...input, sendingApproved: true }, now)).toThrow();
    expect(() => parseHostedProfile({ ...input, emulator: { ...emulator, to: "+12155550101" } }, now)).toThrow();
    expect(() => parseHostedProfile({ ...web, emulator }, now)).toThrow();
  });
  it("passes only each role's credentials, never ambient secrets or runtime injection", () => {
    const ambient = { NODE_ENV: "production" as const, PATH: "/usr/bin", OPENAI_API_KEY: "ambient", DATABASE_URL: "ambient", NODE_OPTIONS: "--inspect" };
    const env = hostedChildEnvironment(parseHostedProfile(web, now), ambient);
    expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.DATABASE_URL).toBeUndefined(); expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.CASELINK_PARENT_CONNECTED_APPROVED).toBeUndefined(); expect(env.CASELINK_PARENT_RECOVERY_SITE_URL).toBe("https://www.thecaselink.com");
    const work = hostedChildEnvironment(parseHostedProfile(worker, now), ambient);
    expect(work.OPENAI_API_KEY).toBe(worker.modelKey); expect(work.CASELINK_PARENT_SNAP_SENDER_SECRET).toBeUndefined();
    expect(work.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY).toBeUndefined(); expect(work.NODE_OPTIONS).toBeUndefined();
  });
  it("retention has independent maintenance authority and no storage/model/carrier credentials", () => {
    const env = hostedChildEnvironment(parseHostedProfile({ ...base, service: "retention", databaseUrl, approvedUntil: "2027-02-01T00:00:00Z" }, now), { NODE_ENV: "production" });
    expect(env.CASELINK_PARENT_RETENTION_MODE).toBe("snap-packets"); expect(env.CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL).toBe("2027-02-01T00:00:00Z");
    expect(env.CASELINK_PARENT_RETENTION_STORAGE_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined();
  });
  it("does not permit parser tags or remote Docker daemons", () => {
    expect(() => parseHostedProfile({ ...worker, parserImage: "caselink/parser:latest" }, now)).toThrow();
    expect(() => parseHostedProfile({ ...worker, dockerHost: "tcp://docker.example:2375" }, now)).toThrow();
  });
  it("reads only the service-owned private file and rejects unsafe permissions and symlinks", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const dir = directory(), file = join(dir, "profile.json"); writeFileSync(file, JSON.stringify(web), { mode: 0o600 });
    expect(readHostedProfile(file).service).toBe("web"); chmodSync(file, 0o644); expect(() => readHostedProfile(file)).toThrow(); chmodSync(file, 0o600);
    const link = join(dir, "link.json"); symlinkSync(file, link); expect(() => readHostedProfile(link)).toThrow();
  });
  it("rejects automatic dotenv loading and binds build to public configuration", () => {
    const dir = directory(); assertNoHostedDotenv(dir); writeFileSync(join(dir, ".env.production.local"), "SECRET=synthetic"); expect(() => assertNoHostedDotenv(dir)).toThrow();
    const profile = parseHostedProfile(web, now); const fingerprint = hostedWebFingerprint(profile);
    expect(hostedWebFingerprint(parseHostedProfile({ ...web, publicOrigin: "https://other.thecaselink.com" }, now))).not.toBe(fingerprint);
    expect(hostedWebFingerprint(parseHostedProfile({ ...web, approvedUntil: "2027-02-01T00:00:00Z" }, now))).toBe(fingerprint);
  });
  it("stops at the recorded deadline without timer overflow or daily renewal", () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const stop = vi.fn();
    const cancel = stopAtHostedDeadline(new Date(now + 31 * 86400000).toISOString(), stop);
    vi.advanceTimersByTime(31 * 86400000 - 1); expect(stop).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(stop).toHaveBeenCalledTimes(1); cancel();
  });
  it("cancels expiry checks on shutdown and immediately stops expired authority", () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const stop = vi.fn(); const cancel = stopAtHostedDeadline(new Date(now + 1000).toISOString(), stop); cancel();
    vi.advanceTimersByTime(2000); expect(stop).not.toHaveBeenCalled(); stopAtHostedDeadline(new Date(now).toISOString(), stop); expect(stop).toHaveBeenCalledOnce();
  });
});

const ordinary = { ...base, service: "ordinary-retention", databaseUrl, storage: { s3AccessKeyId: "synthetic-s3-access-id", s3SecretAccessKey: "synthetic-s3-secret-at-least-20", s3Region: "us-east-1" } };
it("isolates ordinary maintenance credentials and authority from every other service", () => {
  const ambient = { NODE_ENV: "production" as const, CASELINK_PARENT_RETENTION_STORAGE_KEY: "ambient", OPENAI_API_KEY: "ambient", CASELINK_PARENT_SNAP_SENDER_SECRET: "ambient", CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY: "ambient" };
  const env = hostedChildEnvironment(parseHostedProfile(ordinary, now), ambient);
  expect(env.CASELINK_PARENT_RETENTION_MODE).toBe("ordinary"); expect(env.CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY).toBe(ordinary.storage.s3SecretAccessKey);
  expect(env.CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL).toBe(base.approvedUntil);
  expect(env.CASELINK_PARENT_RETENTION_STORAGE_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.CASELINK_PARENT_SNAP_SENDER_SECRET).toBeUndefined();
  for (const profile of [web, worker, { ...base, service: "retention", databaseUrl }]) {
    const other = hostedChildEnvironment(parseHostedProfile(profile, now), ambient);
    expect(other.CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY).toBeUndefined();
  }
});
it.each([{ enabled: false }, { approvedUntil: "2000-01-01T00:00:00Z" }, { storage: undefined }, { projectOrigin: "https://other.supabase.co" }, { databaseUrl: databaseUrl.replace("verify-full", "require") }, { storageKey: "SYNTHETIC_API_KEY" }])("ordinary maintenance refuses incomplete or expanded profiles %#", delta => {
  expect(() => parseHostedProfile({ ...ordinary, ...delta }, now)).toThrow();
});
it("ships disabled expired maintenance examples and independent isolated oneshots", () => {
  for (const name of ["retention", "ordinary-retention"]) {
    const read = (file: string) => readFileSync(new URL(`../deploy/parent-vm/${file}`, import.meta.url), "utf8");
    const example = JSON.parse(read(`${name}.example.json`)); expect(example.enabled).toBe(false); expect(Date.parse(example.approvedUntil)).toBeLessThan(now);
    expect(() => parseHostedProfile(example, now)).toThrow();
    const service = read(`caselink-parent-${name}.service`), timer = read(`caselink-parent-${name}.timer`);
    expect(service).toContain(`User=caselink-${name}\n`); expect(service).toContain(`/etc/caselink/${name}/profile.json`);
    for (const value of ["Type=oneshot", "KillMode=control-group", "TimeoutStartSec=120", "TimeoutStopSec=10", "ProtectSystem=strict", "ProtectHome=yes", "ProtectProc=invisible", "PrivateTmp=yes", "NoNewPrivileges=yes", "UMask=0077", "LimitCORE=0", "MemoryMax=256M"]) expect(service).toContain(value);
    expect(service + timer).not.toMatch(/(?:Requires|BindsTo|PartOf)=.*(?:worker|frontdoor|review|sender)/);
    expect(timer).toContain(`Unit=caselink-parent-${name}.service`); expect(timer).toContain("OnUnitInactiveSec=60s");
    expect(service).not.toMatch(/EnvironmentFile=|STORAGE_KEY|OPENAI|SINCH|NODE_OPTIONS/);
  }
});
