import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { createSnapSenderStore } from "./snap-sender-store";
import { SNAP_SENDER_ERROR, type SnapSenderAttempt, type SnapSenderIntent } from "./snap-sender-contract";

type Plan = { principal?: Record<string, unknown>; entered?: unknown; reserve?: unknown; resume?: unknown; read?: unknown; recheck?: unknown; record?: unknown; errorAt?: string; pendingCommit?: Promise<unknown>; hangAt?: string };
type State = { plan: Plan; calls: { sql: string; values?: unknown[] }[]; destroyed: number; config: unknown };
const mocked = vi.hoisted(() => ({ plans: [] as Plan[], clients: [] as State[] }));
vi.mock("pg", () => ({ Client: class {
  state: State;
  constructor(config: unknown) { this.state = { plan: mocked.plans.shift() ?? {}, calls: [], destroyed: 0, config }; mocked.clients.push(this.state); }
  get connection() { return { stream: { destroy: () => { this.state.destroyed++; } } }; }
  on() { return this; }
  connect() { return this.state.plan.hangAt === "connect" ? new Promise<void>(() => {}) : Promise.resolve(); }
  end() { return Promise.resolve(); }
  query(sql: string, values?: unknown[]) {
    const s = this.state, p = s.plan; s.calls.push({ sql, values });
    const kind = sql.includes("from pg_roles") ? "principal" : sql.startsWith("select current_user") ? "entered" : sql.includes("parent_reserve") ? "reserve"
      : sql.includes("parent_resume") ? "resume" : sql.includes("parent_recheck") ? "recheck" : sql.includes("parent_read") ? "read" : sql.includes("parent_record") ? "record" : sql;
    if (p.errorAt === kind) return Promise.reject(new Error("PRIVATE_DATABASE_PASSWORD_CANARY"));
    if (p.hangAt === kind) return new Promise(() => {});
    if (kind === "principal") return Promise.resolve({ rows: [p.principal ?? principal()] });
    if (kind === "entered") return Promise.resolve({ rows: [p.entered ?? { role: "parent_snap_sender", principal: "sender_fixture" }] });
    if (kind === "reserve" || kind === "resume") return Promise.resolve({ rows: [{ value: p[kind] ?? { state: "dispatch_allowed", attempt: attempt(), envelope: envelope() } }] });
    if (kind === "read") return Promise.resolve({ rows: [{ value: p.read === null ? null : p.read ?? attempt() }] });
    if (kind === "recheck" || kind === "record") return Promise.resolve({ rows: [{ value: p[kind] ?? attempt() }] });
    if (kind === "commit" && p.pendingCommit) return p.pendingCommit;
    return Promise.resolve({ rows: [] });
  }
} }));

const now = "2026-11-07T18:20:00.000Z", id = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const connectionString = "postgresql://sender_fixture:PRIVATE_PASSWORD@127.0.0.1:55322/postgres";
const intent = (): SnapSenderIntent => ({ jobId: id, leaseToken: id, operationId: id, requestId: id, requestVersion: 2,
  idempotencyKey: `snap-final:${id}`, packetHash: hash, protectedPacket: { packetId: id, authorizationId: id, snapshotId: id,
    snapshotHash: hash, contentSha256: hash, byteLength: 1, verificationId: id } });
function attempt(): SnapSenderAttempt { return { operationId: id, packetId: id, contentSha256: hash, operationRef: createHash("sha256").update(intent().idempotencyKey).digest("hex"),
  attemptedAt: now, dispatchAuthorizedAt: null, expiresAt: "2026-11-07T18:25:00.000Z", projectId: "project", serviceId: "service", from: "+12155550101", to: "+12155550102",
  destinationId: "office", destinationVersion: "v1", pageCount: 12, providerId: null, providerStatus: "UNKNOWN" }; }
function envelope() { return { binding: { format: "caselink-snap-final-packet-v1", packetId: id, ownerId: id, requestId: id, requestVersion: 2,
  recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", authorizationId: id, policyVersion: "fixture-policy", retentionPolicyVersion: "fixture-retention",
  templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256,
  snapshotId: id, snapshotHash: hash, contentSha256: hash, byteLength: 1, expiresAt: "2026-11-07T18:25:00.000Z" },
  aad: "YQ==", keyBase64: "YQ==", iv: "YQ==", tag: "YQ==", ciphertext: "YQ==" }; }
function principal() { return { rolname: "sender_fixture", current_role: "sender_fixture", rolcanlogin: true, rolinherit: false, rolsuper: false,
  rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, member: true, can_set: true, admin_option: false,
  broader_membership: false, group_membership: false, group_login: false, group_inherit: false, group_super: false, group_bypassrls: false,
  group_createrole: false, group_createdb: false, group_replication: false }; }
const signal = () => new AbortController().signal;
const queries = () => mocked.clients[0].calls.map(call => call.sql);
beforeEach(() => { mocked.plans.length = 0; mocked.clients.length = 0; vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("isolated protected SNAP sender database boundary", () => {
  it("commits a fresh reservation before exposing its private envelope to the isolated sender", async () => {
    const reserved = await createSnapSenderStore({ connectionString }).reserve(intent(), signal());
    expect(reserved.state).toBe("dispatch_allowed");
    expect(queries().slice(-3)).toEqual(["begin", "select parent_private.parent_reserve_snap_delivery($1::jsonb) value", "commit"]);
    expect(mocked.clients[0].destroyed).toBe(1);
  });
  it("does not resolve a reservation before COMMIT acknowledgement", async () => {
    let finish!: (value: unknown) => void;
    mocked.plans.push({ pendingCommit: new Promise(resolve => { finish = resolve; }) });
    let resolved = false;
    const waiting = createSnapSenderStore({ connectionString }).reserve(intent(), signal()).then(value => { resolved = true; return value; });
    await vi.waitFor(() => expect(queries()).toContain("commit")); expect(resolved).toBe(false);
    finish({ rows: [] }); expect((await waiting).state).toBe("dispatch_allowed");
  });
  it("keeps a lost COMMIT acknowledgement unknown without exposing the envelope or re-reserving", async () => {
    mocked.plans.push({ errorAt: "commit" });
    expect(await createSnapSenderStore({ connectionString }).reserve(intent(), signal())).toEqual({ state: "reservation_unknown" });
    expect(queries().filter(sql => sql.includes("parent_reserve"))).toHaveLength(1); expect(queries()).not.toContain("rollback");
  });
  it("rolls back a denied reservation and hides database details", async () => {
    mocked.plans.push({ errorAt: "reserve" });
    await expect(createSnapSenderStore({ connectionString }).reserve(intent(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(queries()).toContain("rollback"); expect(queries()).not.toContain("commit");
  });
  it("uses the explicit same-operation resume RPC and commits before returning its packet", async () => {
    let finish!: (value: unknown) => void;
    mocked.plans.push({ pendingCommit: new Promise(resolve => { finish = resolve; }) });
    let resolved = false;
    const pending = createSnapSenderStore({ connectionString }).resume(intent(), signal()).then(value => { resolved = true; return value; });
    await vi.waitFor(() => expect(queries()).toContain("commit")); expect(resolved).toBe(false);
    expect(queries().slice(-3)).toEqual(["begin", "select parent_private.parent_resume_snap_delivery($1::jsonb) value", "commit"]);
    finish({ rows: [] }); expect(await pending).toMatchObject({ state: "dispatch_allowed", attempt: { dispatchAuthorizedAt: null } });
    expect(mocked.clients[0].calls.some(call => call.sql.includes("parent_reserve"))).toBe(false);
  });
  it("does not expose a resume envelope after an unknown commit or automatically retry the RPC", async () => {
    mocked.plans.push({ errorAt: "commit" });
    expect(await createSnapSenderStore({ connectionString }).resume(intent(), signal())).toEqual({ state: "reservation_unknown" });
    expect(queries().filter(sql => sql.includes("parent_resume"))).toHaveLength(1); expect(queries()).not.toContain("rollback");
  });
  it("does not reopen an already authorized dispatch even if a resume RPC returns an envelope", async () => {
    mocked.plans.push({ resume: { state: "dispatch_allowed", attempt: { ...attempt(), dispatchAuthorizedAt: now }, envelope: envelope() } });
    await expect(createSnapSenderStore({ connectionString }).resume(intent(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(queries()).toContain("rollback"); expect(queries()).not.toContain("commit");
  });
  it("accepts only metadata on replay and historical follow-up reads", async () => {
    mocked.plans.push({ reserve: { state: "reconcile_only", attempt: attempt() } });
    const store = createSnapSenderStore({ connectionString });
    expect(await store.reserve(intent(), signal())).toEqual({ state: "reconcile_only", attempt: attempt() });
    expect(await store.read(intent(), signal())).toEqual(attempt());
    expect(mocked.clients[1].calls.filter(call => call.sql.includes("parent_read"))).toEqual([
      { sql: "select parent_private.parent_read_snap_delivery($1::jsonb) value", values: [JSON.stringify(intent())] },
    ]);
    expect(mocked.clients[1].calls.some(call => /final_packet|reserve/.test(call.sql))).toBe(false);
  });
  it("rechecks and records only the same exact intent through narrow RPCs", async () => {
    const store = createSnapSenderStore({ connectionString });
    expect(await store.recheck(intent(), signal())).toEqual(attempt());
    expect(await store.record(intent(), "carrier-id", "QUEUED", signal())).toEqual(attempt());
    expect(mocked.clients[1].calls.at(-1)).toEqual({ sql: "select parent_private.parent_record_snap_delivery($1::jsonb,$2,$3) value", values: [JSON.stringify(intent()), "carrier-id", "QUEUED"] });
  });
  it.each(["operation", "packet", "content", "reference", "expired", "provider", "future_dispatch", "early_dispatch", "missing_dispatch"])("rejects a changed %s response before commit", async kind => {
    const value = attempt();
    if (kind === "operation") value.operationId = "22222222-2222-4222-8222-222222222222";
    if (kind === "packet") value.packetId = "22222222-2222-4222-8222-222222222222";
    if (kind === "content") value.contentSha256 = "b".repeat(64);
    if (kind === "reference") value.operationRef = "b".repeat(64);
    if (kind === "expired") value.expiresAt = now;
    if (kind === "provider") value.providerStatus = "COMPLETED";
    if (kind === "future_dispatch") value.dispatchAuthorizedAt = "2026-11-07T18:21:00.000Z";
    if (kind === "early_dispatch") value.dispatchAuthorizedAt = "2026-11-07T18:19:00.000Z";
    if (kind === "missing_dispatch") { value.providerId = "carrier-id"; value.providerStatus = "QUEUED"; }
    mocked.plans.push({ reserve: { state: "dispatch_allowed", attempt: value, envelope: envelope() } });
    await expect(createSnapSenderStore({ connectionString }).reserve(intent(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(queries()).toContain("rollback"); expect(queries()).not.toContain("commit");
  });
  it.each(["rolinherit", "rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication", "admin_option", "broader_membership", "group_membership", "group_login", "group_inherit", "group_super", "group_bypassrls", "group_createrole", "group_createdb", "group_replication"])("rejects excessive %s privilege", async field => {
    mocked.plans.push({ principal: { ...principal(), [field]: true } });
    await expect(createSnapSenderStore({ connectionString }).read(intent(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(queries().some(sql => sql.includes("parent_read"))).toBe(false);
  });
  it.each(["postgresql://postgres:password@127.0.0.1:55322/postgres", "postgresql://sender:password@127.0.0.1:54322/postgres", "postgresql://sender:password@outside.invalid/postgres", "postgresql://sender:password@db.project.supabase.co/postgres?sslmode=require"])("rejects unsafe database target %s", value => {
    expect(() => createSnapSenderStore({ connectionString: value })).toThrow(SNAP_SENDER_ERROR); expect(mocked.clients).toHaveLength(0);
  });
  it("closes a cancelled connection without returning a reservation", async () => {
    mocked.plans.push({ hangAt: "reserve" });
    const stop = new AbortController(), pending = createSnapSenderStore({ connectionString }).reserve(intent(), stop.signal);
    const checked = expect(pending).rejects.toThrow(SNAP_SENDER_ERROR);
    await vi.waitFor(() => expect(queries().some(sql => sql.includes("parent_reserve"))).toBe(true)); stop.abort(); await checked;
    expect(mocked.clients[0].destroyed).toBe(1);
  });
  it("rejects a completed result without a provider ID before database access", async () => {
    await expect(createSnapSenderStore({ connectionString }).record(intent(), null, "COMPLETED", signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(mocked.clients).toHaveLength(0);
  });
});
