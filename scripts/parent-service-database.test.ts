import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createParentServiceDatabase, parentServiceDatabaseTimeouts, validateParentServiceDatabaseTarget } from "../src/lib/parent/service-database";
import { runParentSupportWorker } from "./parent-support-worker";
import { startParentStorageBroker } from "./parent-storage-broker";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), connect: vi.fn(), query: vi.fn(), end: vi.fn(), destroy: vi.fn(), error: undefined as undefined | (() => void),
  run: vi.fn(), storage: vi.fn(), storageDestroy: vi.fn(), server: vi.fn(), serverClose: vi.fn(), connectionsClose: vi.fn(),
  listen: vi.fn(), listeners: new Map<string, () => void>(), role: "parent_worker",
}));
vi.mock("pg", () => ({ Client: class {
  connection = { stream: { destroy: mocks.destroy } };
  constructor(options: { application_name: string }) {
    mocks.client(options); mocks.role = options.application_name.includes("storage-broker") ? "parent_storage_broker" : "parent_worker";
  }
  connect = mocks.connect; query = mocks.query; end = mocks.end;
  on(_event: string, listener: () => void) { mocks.error = listener; }
} }));
vi.mock("../src/lib/parent/worker-service", () => ({ runParentWorkerService: mocks.run }));
vi.mock("../src/lib/parent/storage-s3", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/parent/storage-s3")>(), createS3Storage: mocks.storage,
}));
vi.mock("node:http", async importOriginal => ({
  ...await importOriginal<typeof import("node:http")>(),
  createServer: (...args: unknown[]) => {
    mocks.server(...args);
    const server = { requestTimeout: 0, headersTimeout: 0, maxRequestsPerSocket: 0,
      once(event: string, listener: () => void) { mocks.listeners.set(event, listener); return server; },
      on(event: string, listener: () => void) { mocks.listeners.set(event, listener); return server; },
      removeListener(event: string, listener: () => void) { if (mocks.listeners.get(event) === listener) mocks.listeners.delete(event); return server; },
      listen(port: number, host: string, callback: () => void) { mocks.listen(port, host); callback(); return server; },
      close: mocks.serverClose, closeAllConnections: mocks.connectionsClose,
    };
    return server;
  },
}));

const project = "https://projectref.supabase.co", login = "caselink_fixture";
const remoteDb = `postgresql://${login}:synthetic@db.projectref.supabase.co/postgres?sslmode=verify-full`;
const shared = { CASELINK_PARENT_STORAGE_BROKER_SECRET: "s".repeat(32), CASELINK_PARENT_STORAGE_BROKER_ORIGIN: "http://127.0.0.1:3310",
  CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID: "synthetic-s3-access", CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: "synthetic-s3-secret-at-least-20",
  CASELINK_PARENT_STORAGE_BROKER_S3_REGION: "local" };
type Service = "worker" | "storage_broker";
function configuration(service: Service, mode: "local" | "connected" | "hosted" = "local") {
  const prefix = `CASELINK_PARENT_${service.toUpperCase()}`;
  const env: Record<string, string | undefined> = { ...shared, CASELINK_ENVIRONMENT: "test",
    [`${prefix}_DATABASE_URL`]: `postgresql://${login}:synthetic@127.0.0.1:55322/postgres`, [`${prefix}_SUPABASE_URL`]: "http://127.0.0.1:55321" };
  if (mode !== "local") Object.assign(env, { [`${prefix}_APPROVED`]: "1", [`${prefix}_DATABASE_URL`]: remoteDb,
    [`${prefix}_SUPABASE_URL`]: project, CASELINK_SCHOOL_SUPABASE_URL: project, CASELINK_PARENT_PRODUCTION_SUPABASE_URL: project,
    CASELINK_PARENT_ACCOUNT_MODE: "existing", CASELINK_ENVIRONMENT: mode === "connected" ? "connected" : "production",
    NEXT_PUBLIC_SITE_URL: mode === "connected" ? "http://127.0.0.1:3200" : "https://pilot.example.com",
    ...(mode === "connected" ? { CASELINK_PARENT_CONNECTED_APPROVED: "1" } : { CASELINK_PARENT_HOSTED_APPROVED: "1",
      CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE: "Synthetic test only", CASELINK_PARENT_HOSTED_APPROVED_UNTIL: "2026-12-01T12:00:00Z" }) });
  return env;
}
function principal() { return { login, role: login, rolcanlogin: true, rolinherit: false, rolsuper: false, rolbypassrls: false,
  rolcreaterole: false, rolcreatedb: false, rolreplication: false, member: true, can_set: true, admin_option: false,
  broader_membership: false, group_membership: false, group_login: false, group_inherit: false, group_super: false,
  group_bypassrls: false, group_createrole: false, group_createdb: false, group_replication: false }; }
function database(service: Service = "worker") { return createParentServiceDatabase(validateParentServiceDatabaseTarget(configuration(service), service)); }
const launch = (service: Service, env: Record<string, string | undefined>) => service === "worker" ? runParentSupportWorker(env, false) : startParentStorageBroker(env);

beforeEach(() => {
  vi.clearAllMocks(); mocks.listeners.clear(); mocks.error = undefined;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  mocks.connect.mockResolvedValue(undefined); mocks.end.mockResolvedValue(undefined); mocks.run.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("from pg_roles") ? [principal()]
    : sql.includes("current_user::text") ? [{ login, role: mocks.role }] : [] }));
  mocks.storage.mockReturnValue({ destroy: mocks.storageDestroy });
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(["worker", "storage_broker"] as const)("%s direct database boundary", service => {
  const prefix = `CASELINK_PARENT_${service.toUpperCase()}`;
  it.each(["local", "connected", "hosted"] as const)("launches the reviewed %s mode using a restricted role", async mode => {
    const handle = await launch(service, configuration(service, mode));
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining(parentServiceDatabaseTimeouts));
    expect(mocks.query).toHaveBeenCalledWith(`set role parent_${service}`, undefined);
    if (service === "storage_broker") { expect(mocks.listen).toHaveBeenCalledWith(3310, "127.0.0.1"); (handle as { stop(): void }).stop(); }
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("preserves the reviewed existing-account local port pair", async () => {
    const env = configuration(service); env.CASELINK_PARENT_ACCOUNT_MODE = "existing";
    env[`${prefix}_DATABASE_URL`] = env[`${prefix}_DATABASE_URL`]!.replace("55322", "54322");
    env[`${prefix}_SUPABASE_URL`] = "http://127.0.0.1:54321";
    env.CASELINK_SCHOOL_SUPABASE_URL = "http://127.0.0.1:54321";
    const handle = await launch(service, env); if (service === "storage_broker") (handle as { stop(): void }).stop();
    expect(mocks.client).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["wrong database project", remoteDb.replace("db.projectref", "db.other")],
    ["disabled TLS", remoteDb.replace("verify-full", "disable")],
    ["duplicate TLS parameter", `${remoteDb}&sslmode=disable`],
    ["duplicate root certificate", `${remoteDb}&sslrootcert=a&sslrootcert=b`],
    ["role override", `${remoteDb}&options=-crole%3Dpostgres`],
    ["project superuser", remoteDb.replace(login, "postgres")],
    ["wrong protocol", remoteDb.replace("postgresql:", "https:")],
    ["missing password", remoteDb.replace(":synthetic@", "@")],
    ["URL fragment", `${remoteDb}#unreviewed`],
  ])("rejects %s before creating a client, including the former HTTPS fallback", async (_name, url) => {
    for (const brokerOrigin of [shared.CASELINK_PARENT_STORAGE_BROKER_ORIGIN, "https://private-broker.example.com"]) {
      const env = configuration(service, "connected"); env[`${prefix}_DATABASE_URL`] = url; env.CASELINK_PARENT_STORAGE_BROKER_ORIGIN = brokerOrigin;
      await expect(launch(service, env)).rejects.toThrow("database is unavailable");
    }
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled(); expect(mocks.server).not.toHaveBeenCalled();
  });
  it.each([
    { CASELINK_PARENT_CONNECTED_APPROVED: "0" }, { VERCEL: "1" }, { CASELINK_PARENT_ACCOUNT_MODE: "isolated" },
    { CASELINK_SCHOOL_SUPABASE_URL: "https://other.supabase.co" }, { NEXT_PUBLIC_SITE_URL: "https://unexpected.example.com" },
  ])("preserves connected authority and legacy separation: %j", async change => {
    await expect(launch(service, { ...configuration(service, "connected"), ...change })).rejects.toThrow();
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects expired hosted approval and HTTPS broker substitutions", async () => {
    const env = configuration(service, "hosted"); env.CASELINK_PARENT_HOSTED_APPROVED_UNTIL = "2026-11-16T12:00:00Z";
    await expect(launch(service, env)).rejects.toThrow();
    const unreviewed = configuration(service, "hosted"); unreviewed.CASELINK_PARENT_STORAGE_BROKER_ORIGIN = "https://private-broker.example.com";
    await expect(launch(service, unreviewed)).rejects.toThrow(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects an unapproved remote service and local connection overrides", async () => {
    const remote = configuration(service, "connected"); remote[`${prefix}_APPROVED`] = "0";
    await expect(launch(service, remote)).rejects.toThrow();
    const local = configuration(service); local[`${prefix}_DATABASE_URL`] += "?host=db.other.supabase.co";
    await expect(launch(service, local)).rejects.toThrow(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("stops a stalled connect within three seconds and never starts processing", async () => {
    mocks.connect.mockReturnValue(new Promise(() => {}));
    const failure = expect(launch(service, configuration(service))).rejects.toThrow("database is unavailable");
    await vi.advanceTimersByTimeAsync(3000); await failure;
    expect(mocks.destroy).toHaveBeenCalledTimes(1); expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("bounds a stalled principal read before processing or starting Storage", async () => {
    mocks.query.mockReturnValue(new Promise(() => {}));
    const failure = expect(launch(service, configuration(service))).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(18000); await failure;
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  });
});

describe("restricted parent service database lifecycle", () => {
  it.each(["rolinherit", "rolsuper", "rolbypassrls", "rolcreaterole", "rolcreatedb", "rolreplication", "admin_option", "broader_membership", "group_membership",
    "group_login", "group_inherit", "group_super", "group_bypassrls", "group_createrole", "group_createdb", "group_replication"])("rejects excessive %s privilege before role activation", async field => {
    mocks.query.mockResolvedValue({ rows: [{ ...principal(), [field]: true }] });
    const db = database(); await expect(db.connect()).rejects.toThrow();
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it.each(["rolcanlogin", "member", "can_set"])("requires %s", async field => {
    mocks.query.mockResolvedValue({ rows: [{ ...principal(), [field]: false }] });
    await expect(database().connect()).rejects.toThrow(); expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it.each([{ login: "other_login" }, { role: "parent_worker" }])("rejects a changed authenticated principal: %j", async change => {
    mocks.query.mockResolvedValue({ rows: [{ ...principal(), ...change }] }); await expect(database().connect()).rejects.toThrow();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("verifies SET ROLE and exact session identity before processing", async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("from pg_roles") ? [principal()] : [{ login, role: "postgres" }] }));
    await expect(runParentSupportWorker(configuration("worker"), false)).rejects.toThrow();
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("closes an uncertain stalled query without retrying or resetting its work state", async () => {
    const db = database(); await db.connect(); mocks.query.mockClear(); mocks.query.mockReturnValue(new Promise(() => {}));
    const failure = expect(db.database.query("select parent_private.parent_finish_effect($1)", ["synthetic-operation"])).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(18000); await failure;
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.destroy).toHaveBeenCalledTimes(1);
    await expect(db.database.query("select forbidden_retry")).rejects.toThrow(); expect(mocks.query).toHaveBeenCalledTimes(1);
  });
  it("rejects outstanding reads promptly after a connection failure", async () => {
    const db = database(); await db.connect(); mocks.query.mockReturnValue(new Promise(() => {}));
    const failure = expect(db.database.query("select pending_read")).rejects.toThrow();
    mocks.error!(); await failure; expect(db.signal.aborted).toBe(true); expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("finishes worker shutdown even when database end never settles", async () => {
    mocks.end.mockReturnValue(new Promise(() => {}));
    await runParentSupportWorker(configuration("worker"), false);
    expect(mocks.end).toHaveBeenCalledTimes(1); expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts an active worker on shutdown and prevents delayed work from querying again", async () => {
    mocks.run.mockReturnValue(new Promise(() => {})); mocks.end.mockReturnValue(new Promise(() => {}));
    const work = runParentSupportWorker(configuration("worker"), true), failure = expect(work).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    const options = mocks.run.mock.calls[0][0]; process.emit("SIGTERM"); await failure;
    expect(options.signal.aborted).toBe(true); const count = mocks.query.mock.calls.length;
    await expect(options.database.query("select delayed_action")).rejects.toThrow(); expect(mocks.query).toHaveBeenCalledTimes(count);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
  it("force-closes active broker connections without waiting for callbacks or database end", async () => {
    mocks.end.mockReturnValue(new Promise(() => {}));
    const handle = await startParentStorageBroker(configuration("storage_broker")); handle.stop(); handle.stop();
    expect(mocks.serverClose).toHaveBeenCalledTimes(1); expect(mocks.connectionsClose).toHaveBeenCalledTimes(1);
    expect(mocks.storageDestroy).toHaveBeenCalledTimes(1); expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up a broker startup failure before any listener remains", async () => {
    mocks.storage.mockImplementation(() => { throw new Error("synthetic startup failure"); });
    await expect(startParentStorageBroker(configuration("storage_broker"))).rejects.toThrow();
    expect(mocks.destroy).toHaveBeenCalledTimes(1); expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("runs the worker's sanitized invalid-configuration handler outside the checkout", () => {
    const child = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./parent-support-worker.ts", import.meta.url))],
      { cwd: tmpdir(), encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
    expect(child.status).toBe(1); expect(child.stderr).toContain("The isolated parent worker could not run.");
    expect(child.stderr).not.toMatch(/TypeError|import\.meta|undefined|ERR_INVALID_ARG_TYPE/);
  });
});
