import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localServiceApproval, localServiceEnvironment, localServicesSchema, setupLocalServices } from "./parent-local-services";

const now = Date.parse("2026-11-03T20:00:00Z");
const controls = () => ({ enabled: true, approval_reference: "synthetic-local-only",
  approved_until: "2026-11-04T19:00:00Z", model_budget_started_at: "2026-11-03T19:00:00Z", model_call_limit: 12 });
const status = { API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:local-only@127.0.0.1:55322/postgres",
  S3_PROTOCOL_ACCESS_KEY_ID: "synthetic-s3-access-id", S3_PROTOCOL_ACCESS_KEY_SECRET: "synthetic-s3-secret-at-least-20", S3_PROTOCOL_REGION: "local" };
const config = () => ({ projectUrl: status.API_URL, ...localServiceApproval(controls(), 0, now),
  workerDatabaseUrl: "postgresql://caselink_parent_local_worker:synthetic@127.0.0.1:55322/postgres",
  brokerDatabaseUrl: "postgresql://caselink_parent_local_broker:synthetic@127.0.0.1:55322/postgres",
  s3AccessKeyId: status.S3_PROTOCOL_ACCESS_KEY_ID, s3SecretAccessKey: status.S3_PROTOCOL_ACCESS_KEY_SECRET, s3Region: status.S3_PROTOCOL_REGION,
  brokerSecret: "synthetic-broker-secret-with-32-characters" });
const temporary: string[] = [];
const path = () => { const dir = mkdtempSync(join(tmpdir(), "caselink-local-services-test-")); temporary.push(dir); return join(dir, "private.json"); };
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("isolated local private-service configuration", () => {
  it("keeps the model key only in the worker and storage key only in the broker", () => {
    const inherited = { PATH: "/bin", HOME: "/synthetic", TMPDIR: "/tmp", DATABASE_URL: "must-not-inherit", OPENAI_API_KEY: "must-not-inherit", SUPABASE_SERVICE_ROLE_KEY: "must-not-inherit", RESEND_API_KEY: "must-not-inherit", CASELINK_PARENT_CONNECTED_APPROVED: "1" };
    const worker = localServiceEnvironment("worker", config(), "synthetic-openai-key-at-least-20", inherited);
    const broker = localServiceEnvironment("broker", config(), "synthetic-openai-key-at-least-20", inherited);
    expect(worker.OPENAI_API_KEY).toBe("synthetic-openai-key-at-least-20");
    expect(broker.OPENAI_API_KEY).toBeUndefined();
    expect(worker.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY).toBeUndefined();
    expect(broker.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY).toBeUndefined();
    expect(broker.CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID).toBe(status.S3_PROTOCOL_ACCESS_KEY_ID);
    expect(broker.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY).toBe(status.S3_PROTOCOL_ACCESS_KEY_SECRET);
    expect(broker.CASELINK_PARENT_STORAGE_BROKER_S3_REGION).toBe(status.S3_PROTOCOL_REGION);
    expect(worker.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY).toBeUndefined();
    for (const env of [worker, broker]) for (const key of ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "CASELINK_PARENT_CONNECTED_APPROVED"])
      expect(env[key]).toBeUndefined();
    expect(() => localServiceEnvironment("worker", config())).toThrow();
  });
  it.each([
    { projectUrl: "https://hosted.supabase.co" },
    { workerDatabaseUrl: "postgresql://postgres:secret@127.0.0.1:55322/postgres" },
    { workerDatabaseUrl: "postgresql://caselink_parent_local_worker:secret@127.0.0.1:54322/postgres" },
    { brokerDatabaseUrl: "postgresql://caselink_parent_local_broker:secret@remote.invalid:55322/postgres" },
    { workerDatabaseUrl: "postgresql://caselink_parent_local_worker:secret@127.0.0.1:55322/postgres?options=unsafe" },
    { modelCallLimit: 31 },
    { storageKey: "a-legacy-project-key-is-not-accepted" },
    { s3SecretAccessKey: "sb_secret_synthetic-test-key" },
  ])("rejects a widened runtime target or budget: %j", (change) => {
    expect(localServicesSchema.safeParse({ ...config(), ...change }).success).toBe(false);
  });
  it.each([
    { enabled: false }, { approval_reference: "" }, { approved_until: "2026-11-03T19:00:00Z" },
    { approved_until: "2026-11-05T20:00:00Z" }, { model_budget_started_at: "2026-11-03T21:00:00Z" },
    { model_budget_started_at: null }, { model_call_limit: null }, { model_call_limit: 31 },
  ])("requires current approval and an already bounded model window: %j", (change) => {
    expect(() => localServiceApproval({ ...controls(), ...change }, 0, now)).toThrow();
  });
  it("does not replenish an exhausted model budget", () => {
    expect(() => localServiceApproval(controls(), 12, now)).toThrow();
    expect(localServiceApproval(controls(), 11, now).modelCallLimit).toBe(12);
  });
  it("can account for the ten retained test reservations without dropping the finite limit or moving its window", () => {
    const amended = { ...controls(), model_call_limit: 22 };
    const approval = localServiceApproval(amended, 12, now);
    expect(approval).toEqual({ ...localServiceApproval(controls(), 0, now), modelCallLimit: 22 });
    expect(localServicesSchema.parse({ ...config(), ...approval }).modelCallLimit).toBe(22);
    expect(() => localServiceApproval(amended, 22, now)).toThrow();
    expect(() => localServiceApproval({ ...amended, model_call_limit: 31 }, 12, now)).toThrow();
  });
  it("permits a separately approved eight-call follow-through without replenishing retained accounting", () => {
    const approval = localServiceApproval({ ...controls(), model_call_limit: 30 }, 22, now);
    expect(approval.modelBudgetStartedAt).toBe(controls().model_budget_started_at.replace("Z", ".000Z"));
    expect(localServicesSchema.parse({ ...config(), ...approval }).modelCallLimit).toBe(30);
    expect(() => localServiceApproval({ ...controls(), model_call_limit: 30 }, 30, now)).toThrow();
    expect(() => localServiceApproval({ ...controls(), model_call_limit: 22 }, 22, now)).toThrow();
  });
});

describe("local-only setup transaction", () => {
  const database = (failCommit = false, existingRole = false) => ({ query: vi.fn(async (sql: string) => {
    if (sql.includes("to_jsonb(c)")) return { rows: [{ controls: controls(), used: 0 }] };
    if (sql.includes("pg_roles")) return { rows: existingRole ? [{}] : [] };
    if (sql === "commit" && failCommit) throw new Error("synthetic commit failure");
    return { rows: [] };
  }) });
  it("creates only restricted local logins and an owner-only file, preserving approval and counters", async () => {
    const db = database(), file = path();
    const result = await setupLocalServices(db, status, file, now);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(result);
    expect(readFileSync(file, "utf8")).not.toContain("OPENAI");
    expect(new URL(result.workerDatabaseUrl).username).toBe("caselink_parent_local_worker");
    const queries = db.query.mock.calls.map(([sql]) => sql);
    expect(queries.filter((sql) => sql.startsWith("create role"))).toHaveLength(2);
    expect(queries.filter((sql) => sql.startsWith("create role")).every((sql) => sql.includes("noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls"))).toBe(true);
    expect(queries).toContain("grant parent_worker to caselink_parent_local_worker");
    expect(queries).toContain("grant parent_storage_broker to caselink_parent_local_broker");
    expect(queries.at(-1)).toBe("commit");
    expect(queries.some((sql) => /^update|drop /i.test(sql))).toBe(false);
  });
  it("preserves the only credentials when the commit outcome is unknown", async () => {
    const db = database(true), file = path();
    await expect(setupLocalServices(db, status, file, now)).rejects.toThrow("synthetic commit failure");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(localServicesSchema.safeParse(JSON.parse(readFileSync(file, "utf8"))).success).toBe(true);
    expect(db.query).toHaveBeenLastCalledWith("rollback");
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith("drop role"))).toBe(false);
  });
  it("preserves a pre-existing file and rolls back new role creation", async () => {
    const db = database(), file = path(); writeFileSync(file, "do-not-replace", { mode: 0o600 });
    await expect(setupLocalServices(db, status, file, now)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe("do-not-replace");
    expect(readdirSync(dirname(file))).toEqual(["private.json"]);
    expect(db.query).toHaveBeenLastCalledWith("rollback");
  });
  it("does not change or remove a pre-existing login", async () => {
    const db = database(false, true), file = path();
    await expect(setupLocalServices(db, status, file, now)).rejects.toThrow("require reconciliation");
    expect(db.query.mock.calls.some(([sql]) => /^create role|alter role|drop role/.test(sql))).toBe(false);
    expect(db.query).toHaveBeenLastCalledWith("rollback");
  });
  it("rejects a remote administrative endpoint before any transaction", async () => {
    const db = database();
    await expect(setupLocalServices(db, { ...status, DB_URL: "postgresql://postgres:secret@remote.invalid:55322/postgres" }, path(), now)).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("recreates both rolled-back logins using the saved credentials after an interrupted setup", async () => {
    const db = database(), file = path(), saved = localServicesSchema.parse(config());
    const original = JSON.stringify(saved); writeFileSync(file, original, { mode: 0o600 });
    expect(await setupLocalServices(db, status, file, now, saved)).toEqual(saved);
    expect(readFileSync(file, "utf8")).toBe(original);
    const creates = db.query.mock.calls.map(([sql]) => sql).filter((sql) => sql.startsWith("create role"));
    expect(creates).toHaveLength(2);
    expect(creates.every((sql) => sql.endsWith("password 'synthetic'"))).toBe(true);
  });
  it("rejects changed S3 credentials before creating or replacing a principal", async () => {
    const db = database(), file = path(), saved = localServicesSchema.parse(config());
    await expect(setupLocalServices(db, { ...status, S3_PROTOCOL_ACCESS_KEY_SECRET: "different-s3-secret-at-least-20" }, file, now, saved)).rejects.toThrow("Storage-only");
    expect(db.query.mock.calls.some(([sql]) => /^create role|alter role|drop role/.test(sql))).toBe(false);
    expect(readdirSync(dirname(file))).toEqual([]);
  });
  it("reconciles a committed transaction with a lost acknowledgement without replacing its passwords", async () => {
    let committed = false, loseAcknowledgement = true;
    const db = { query: vi.fn(async (sql: string) => {
      if (sql.includes("to_jsonb(c)")) return { rows: [{ controls: controls(), used: 0 }] };
      if (sql.includes("pg_roles")) return { rows: committed ? [{}] : [] };
      if (sql === "commit") {
        committed = true;
        if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error("lost acknowledgement"); }
      }
      return { rows: [] };
    }) };
    const file = path();
    await expect(setupLocalServices(db, status, file, now)).rejects.toThrow("lost acknowledgement");
    const raw = readFileSync(file, "utf8"), saved = localServicesSchema.parse(JSON.parse(raw));
    expect(committed).toBe(true);
    expect(await setupLocalServices(db, status, file, now, saved)).toEqual(saved);
    expect(readFileSync(file, "utf8")).toBe(raw);
    expect(db.query.mock.calls.filter(([sql]) => sql.startsWith("create role"))).toHaveLength(2);
    expect(db.query.mock.calls.some(([sql]) => /^alter role|drop role/.test(sql))).toBe(false);
  });
  it("rejects a partially present login pair without changing either principal or the saved file", async () => {
    const db = database(), file = path(), saved = localServicesSchema.parse(config());
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_jsonb(c)")) return { rows: [{ controls: controls(), used: 0 }] };
      if (sql.includes("pg_roles")) return { rows: db.query.mock.calls.filter(([text]) => text.includes("pg_roles")).length === 1 ? [{}] : [] };
      return { rows: [] };
    });
    await expect(setupLocalServices(db, status, file, now, saved)).rejects.toThrow("require reconciliation");
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(saved));
    expect(db.query.mock.calls.some(([sql]) => /^create role|alter role|drop role/.test(sql))).toBe(false);
  });
});

it("the real npm CLI reaches its sanitized invalid-command handler under tsx", () => {
  const result = spawnSync("npm", ["run", "parent:local:services", "--", "invalid"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("The isolated local services could not run.");
  expect(result.stderr).not.toMatch(/TypeError|import\.meta|undefined|ERR_INVALID_ARG_TYPE/);
});
