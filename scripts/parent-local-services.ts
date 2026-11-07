import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse } from "dotenv";
import { Client, escapeLiteral } from "pg";
import { z } from "zod";
import { once as eventOnce } from "node:events";
import type { WorkerDatabase } from "../src/lib/parent/worker-runtime";
import { s3StorageCredentialsSchema } from "../src/lib/parent/storage-s3";
import { parseSnapPrivateServices, readSnapPrivateServices, snapPrivateChildEnvironment, snapSenderWorkerEnvironment,
  type SnapPrivateService, type SnapPrivateServicesConfig } from "./parent-snap-services";

const root = process.cwd();
const runtime = resolve(root, "tmp/parent-runtime");
const configPath = resolve(runtime, "local-services-private.json");
const brokerOrigin = "http://127.0.0.1:3310";
// Eight bounded follow-through calls may be added to the 22 retained reservations; accounting never resets.
const maxLocalModelReservations = 30;
const roles = {
  worker: "caselink_parent_local_worker",
  broker: "caselink_parent_local_broker",
} as const;
const approvalQuery = `select to_jsonb(c) controls,
  greatest((select count(*) from parent_private.model_call_reservations where created_at>=c.model_budget_started_at),
    (select count(*) from parent_private.ai_calls where created_at>=c.model_budget_started_at)+
    (select count(*) from parent_private.assistant_calls where created_at>=c.model_budget_started_at))::integer used
  from parent_private.processing_controls c where singleton for update`;

function localDatabaseUrl(value: string, user: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === "127.0.0.1" && url.port === "55322" &&
      url.pathname === "/postgres" && !url.search && !url.hash &&
      url.username === user && Boolean(url.password);
  } catch {
    return false;
  }
}

const statusSchema = z.object({
  API_URL: z.literal("http://127.0.0.1:55321"),
  DB_URL: z.string().refine((value) => localDatabaseUrl(value, "postgres")),
  S3_PROTOCOL_ACCESS_KEY_ID: s3StorageCredentialsSchema.shape.s3AccessKeyId,
  S3_PROTOCOL_ACCESS_KEY_SECRET: s3StorageCredentialsSchema.shape.s3SecretAccessKey,
  S3_PROTOCOL_REGION: s3StorageCredentialsSchema.shape.s3Region,
});

export const localServicesSchema = z.object({
  projectUrl: z.literal("http://127.0.0.1:55321"),
  approvedUntil: z.iso.datetime({ offset: true }),
  modelBudgetStartedAt: z.iso.datetime({ offset: true }),
  modelCallLimit: z.number().int().min(1).max(maxLocalModelReservations),
  workerDatabaseUrl: z.string().refine((value) => localDatabaseUrl(value, roles.worker)),
  brokerDatabaseUrl: z.string().refine((value) => localDatabaseUrl(value, roles.broker)),
  ...s3StorageCredentialsSchema.shape,
  brokerSecret: z.string().min(32),
}).strict();
type LocalServices = z.infer<typeof localServicesSchema>;

export function localServiceApproval(value: unknown, used: unknown, now = Date.now()) {
  const controls = z.object({
    enabled: z.literal(true),
    approval_reference: z.string().trim().min(1),
    approved_until: z.iso.datetime({ offset: true }),
    model_budget_started_at: z.iso.datetime({ offset: true }),
    model_call_limit: z.number().int().min(1).max(maxLocalModelReservations),
  }).parse(value);
  const calls = z.number().int().nonnegative().parse(used);
  const remaining = Date.parse(controls.approved_until) - now;
  if (remaining <= 0 || remaining > 25 * 60 * 60 * 1000 ||
    Date.parse(controls.model_budget_started_at) > now ||
    calls >= controls.model_call_limit)
    throw new Error("A current local approval and unspent bounded model budget are required.");
  return {
    approvedUntil: new Date(controls.approved_until).toISOString(),
    modelBudgetStartedAt: new Date(controls.model_budget_started_at).toISOString(),
    modelCallLimit: controls.model_call_limit,
  };
}

/** Preserve credentials after an uncertain commit; a later setup reconciles the same two logins. */
export async function setupLocalServices(
  database: WorkerDatabase,
  status: unknown,
  path: string,
  now = Date.now(),
  existing?: LocalServices,
): Promise<LocalServices> {
  const local = statusSchema.parse(status);
  const saved = existing ? localServicesSchema.parse(existing) : undefined;
  let written = false, commitAttempted = false;
  await database.query("begin");
  try {
    const row = (await database.query(approvalQuery)).rows[0];
    const approval = localServiceApproval(row?.controls, row?.used, now);
    if (saved) {
      assert.deepEqual(approval, {
        approvedUntil: saved.approvedUntil,
        modelBudgetStartedAt: saved.modelBudgetStartedAt,
        modelCallLimit: saved.modelCallLimit,
      }, "The saved local approval and model budget must still match.");
      assert.deepEqual([saved.s3AccessKeyId,saved.s3SecretAccessKey,saved.s3Region],
        [local.S3_PROTOCOL_ACCESS_KEY_ID,local.S3_PROTOCOL_ACCESS_KEY_SECRET,local.S3_PROTOCOL_REGION],
        "The saved Storage-only credentials must still match.");
    }
    const urls: Record<string, string> = {};
    const present = await Promise.all((["worker", "broker"] as const).map(async (service) =>
      (await database.query("select 1 from pg_roles where rolname=$1", [roles[service]])).rows.length > 0));
    if ((saved && present[0] !== present[1]) || (!saved && present.some(Boolean)))
      throw new Error("Unexpected local service logins require reconciliation; no existing login was changed.");
    for (const service of ["worker", "broker"] as const) {
      const name = roles[service];
      const url = new URL(saved?.[`${service}DatabaseUrl`] ?? local.DB_URL);
      if (!saved) {
        url.username = name;
        url.password = randomBytes(32).toString("base64url");
      }
      if (!present[0]) {
        await database.query(`create role ${name} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${escapeLiteral(decodeURIComponent(url.password))}`);
        await database.query(`grant parent_${service === "broker" ? "storage_broker" : "worker"} to ${name}`);
      }
      urls[service] = url.href;
    }
    const config = saved ?? localServicesSchema.parse({
      projectUrl: local.API_URL,
      ...approval,
      workerDatabaseUrl: urls.worker,
      brokerDatabaseUrl: urls.broker,
      s3AccessKeyId: local.S3_PROTOCOL_ACCESS_KEY_ID,
      s3SecretAccessKey: local.S3_PROTOCOL_ACCESS_KEY_SECRET,
      s3Region: local.S3_PROTOCOL_REGION,
      brokerSecret: randomBytes(32).toString("base64url"),
    });
    if (!saved) {
      const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
      const file = openSync(temporary, "wx", 0o600);
      try {
        try {
          writeFileSync(file, JSON.stringify(config));
          fsyncSync(file);
        } finally {
          closeSync(file);
        }
        linkSync(temporary, path);
        written = true;
      } finally {
        unlinkSync(temporary);
      }
    }
    commitAttempted = true;
    await database.query("commit");
    return config;
  } catch (error) {
    await database.query("rollback").catch(() => {});
    if (written && !commitAttempted) unlinkSync(path);
    throw error;
  }
}

export async function verifyLocalLogins(config: LocalServices): Promise<void> {
  for (const service of ["worker", "broker"] as const) {
    const group = service === "worker" ? "parent_worker" : "parent_storage_broker";
    const database = new Client({ connectionString: config[`${service}DatabaseUrl`], connectionTimeoutMillis: 3000, statement_timeout: 5000 });
    try {
      await database.connect();
      const role = (await database.query(`select r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
        pg_has_role(session_user,$1,'MEMBER') member,
        exists(select 1 from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid and g.rolname<>$1) broader_membership
        from pg_roles r where r.rolname=session_user`, [group])).rows[0];
      assert.ok(role && role.rolname === roles[service] && role.rolcanlogin && role.member &&
        !role.rolinherit && !role.rolsuper && !role.rolbypassrls && !role.rolcreaterole &&
        !role.rolcreatedb && !role.rolreplication && !role.broader_membership,
      "The saved credential must authenticate as its restricted local service principal.");
      await database.query(`set role ${group}`);
      assert.equal((await database.query("select current_user as name")).rows[0]?.name, group);
    } finally { await database.end(); }
  }
}

export function localServiceEnvironment(
  service: "worker" | "broker",
  value: unknown,
  apiKey?: string,
  system: Record<string, string | undefined> = process.env,
  snap?: SnapPrivateServicesConfig,
): NodeJS.ProcessEnv {
  const config = localServicesSchema.parse(value);
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(["PATH", "HOME", "TMPDIR"].map((key) => [key, system[key]])),
    NODE_ENV: "production",
    CASELINK_PRODUCT: "parent",
    CASELINK_ENVIRONMENT: "test",
    OPENAI_DEBUG: "0",
    OPENAI_PAYLOAD_DEBUG: "0",
  };
  if (service === "worker") {
    if (!apiKey || apiKey.length < 20) throw new Error("A private model credential is required.");
    Object.assign(env, {
      OPENAI_API_KEY: apiKey,
      CASELINK_PARENT_WORKER_DATABASE_URL: config.workerDatabaseUrl,
      CASELINK_PARENT_WORKER_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_STORAGE_BROKER_ORIGIN: brokerOrigin,
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret,
    });
    if (snap) Object.assign(env, snapSenderWorkerEnvironment(parseSnapPrivateServices(snap)));
  } else {
    Object.assign(env, {
      CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL: config.brokerDatabaseUrl,
      CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL: config.projectUrl,
      CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID: config.s3AccessKeyId,
      CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY: config.s3SecretAccessKey,
      CASELINK_PARENT_STORAGE_BROKER_S3_REGION: config.s3Region,
      CASELINK_PARENT_STORAGE_BROKER_ORIGIN: brokerOrigin,
      CASELINK_PARENT_STORAGE_BROKER_SECRET: config.brokerSecret,
    });
  }
  return env;
}

function readConfig(): LocalServices {
  const path = realpathSync(configPath);
  const info = statSync(path);
  if (!path.startsWith(realpathSync(runtime) + sep) || !info.isFile() ||
    (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.())
    throw new Error("Use the owner-only local runtime file.");
  return localServicesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function readLocalStatus() {
  const cli = process.env.CASELINK_SUPABASE_CLI;
  if (!cli) throw new Error("Set the installed local Supabase CLI path.");
  return statusSchema.parse(JSON.parse(execFileSync(cli, ["status", "--workdir", runtime, "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000,
  })));
}

export async function runLocalServices(config: LocalServices, apiKey: string, snapInput?: SnapPrivateServicesConfig) {
  const snap = snapInput ? parseSnapPrivateServices(snapInput) : undefined;
  if (snap) snap.approvedUntil = new Date(Math.min(Date.parse(config.approvedUntil), Date.parse(snap.approvedUntil))).toISOString();
  const remaining = Math.min(Date.parse(config.approvedUntil), snap ? Date.parse(snap.approvedUntil) : Infinity) - Date.now();
  if (remaining <= 0 || remaining > 25 * 60 * 60 * 1000)
    throw new Error("The local synthetic approval has expired.");
  const children = new Set<ChildProcess>();
  const shutdown = new AbortController();
  let stopping = false, failed = false;
  const stop = () => {
    stopping = true;
    shutdown.abort();
    for (const child of children) child.kill("SIGTERM");
  };
  const start = (service: "worker" | "broker" | SnapPrivateService) => {
    assert.ok(!stopping, "No local service can start after shutdown.");
    const privateService = service !== "worker" && service !== "broker";
    const child = spawn(process.execPath, ["--import", "tsx",
      resolve(root, privateService ? "scripts/parent-snap-services.ts" : `scripts/parent-${service === "worker" ? "support-worker" : "storage-broker"}.ts`),
      ...(privateService ? [service] : service === "worker" ? ["--watch"] : [])], {
      cwd: root, env: privateService ? snapPrivateChildEnvironment(service, snap!) : localServiceEnvironment(service, config, apiKey, process.env, snap),
      stdio: privateService ? ["ignore", "inherit", "inherit", "ipc"] : "inherit",
    });
    children.add(child);
    const done = new Promise<number | null>((finish) => {
      child.once("exit", (code) => {
        children.delete(child);
        if (service !== "worker" && !stopping) { failed = true; stop(); }
        finish(code);
      });
      child.once("error", () => {
        children.delete(child);
        failed = true;
        stop();
        finish(null);
      });
    });
    const startup = privateService ? setTimeout(() => { failed = true; stop(); }, 10000) : undefined;
    const ready = privateService ? eventOnce(child, "message", { signal: shutdown.signal }).then(([message]) => {
      assert.ok(message?.ready === true && message.service === service && !stopping, "The isolated SNAP service did not confirm startup.");
    }).finally(() => clearTimeout(startup)) : Promise.resolve();
    return { done, ready };
  };
  const deadline = setTimeout(stop, remaining);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
  try {
    start("broker");
    let ready = false;
    for (let attempt = 0; attempt < 20 && !stopping; attempt++) {
      try {
        const response = await fetch(`${brokerOrigin}/health`, {
          headers: { authorization: `Bearer ${config.brokerSecret}` },
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && (await response.json()).ready === true;
      } catch { ready = false; }
      if (ready) break;
      await delay(500);
    }
    assert.ok(ready && !stopping, "The local private broker did not become ready before shutdown.");
    if (snap) {
      const sender = start("snap-sender"), review = start("snap-review");
      await Promise.all([sender.ready, review.ready]);
      await start("snap-frontdoor").ready;
    }
    const worker = start("worker");
    process.stdout.write(snap ? "Isolated SNAP personal-step and exact-delivery services are running. Only recorded evidence establishes delivery or agency confirmation.\n"
      : "Isolated synthetic planning and assistant services are running. No partner transport or external notification is enabled.\n");
    const code = await worker.done;
    if (failed || (!stopping && code !== 0)) throw new Error("A local private service stopped.");
  } finally {
    clearTimeout(deadline);
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, stop);
    stop();
  }
}

async function main() {
  const command = process.argv[2] ?? "serve";
  if (command === "setup") {
    const existing = existsSync(configPath) ? readConfig() : undefined;
    const local = readLocalStatus();
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const database = new Client({ connectionString: local.DB_URL, statement_timeout: 10000 });
    await database.connect();
    try {
      const config = await setupLocalServices(database, local, configPath, Date.now(), existing);
      await verifyLocalLogins(config);
    }
    finally { await database.end(); }
    process.stdout.write("The isolated local runtime is configured with restricted logins. Processing approval and model counters were not changed.\n");
  } else if (command === "serve") {
    const config = readConfig(), local = readLocalStatus();
    const preflight = new Client({ connectionString: local.DB_URL, statement_timeout: 10000 });
    await preflight.connect();
    try {
      const row = (await preflight.query(approvalQuery)).rows[0];
      assert.deepEqual(localServiceApproval(row?.controls, row?.used), {
        approvedUntil: config.approvedUntil,
        modelBudgetStartedAt: config.modelBudgetStartedAt,
        modelCallLimit: config.modelCallLimit,
      }, "The recorded local approval and model budget must still match.");
    } finally { await preflight.end(); }
    await verifyLocalLogins(config);
    const apiKey = parse(readFileSync(resolve(root, ".env.local"))).OPENAI_API_KEY;
    const snap = process.env.CASELINK_PARENT_SNAP_PRIVATE_CONFIG ? readSnapPrivateServices(process.env.CASELINK_PARENT_SNAP_PRIVATE_CONFIG) : undefined;
    await runLocalServices(config, apiKey, snap);
  }
  else throw new Error("Use setup or serve for the isolated local services.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, "scripts/parent-local-services.ts"))
  void main().catch(() => {
    process.stderr.write("The isolated local services could not run. Check the private configuration, current local approval and bounded model budget. No credential or family detail is logged here.\n");
    process.exitCode = 1;
  });
