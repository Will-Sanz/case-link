import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createS3Storage, s3StorageCredentialsSchema } from "../src/lib/parent/storage-s3";
import { connectedParentServiceAllowed } from "../src/lib/parent/connected-service";
import {
  canonicalProjectOrigin,
  parentProjectIsolationIssues,
} from "../src/lib/parent/project-origin";

async function main() {
  const env = process.env;
  const mode = z.enum(["all", "snap-packets", "ordinary"]).parse(env.CASELINK_PARENT_RETENTION_MODE ?? "all");
  const packetsOnly = mode === "snap-packets", ordinaryOnly = mode === "ordinary";
  const maintained = packetsOnly || ordinaryOnly;
  const connectionString = env.CASELINK_PARENT_RETENTION_DATABASE_URL;
  const projectUrl = env.CASELINK_PARENT_RETENTION_SUPABASE_URL;
  const storageKey = env.CASELINK_PARENT_RETENTION_STORAGE_KEY;
  let maintenanceUntil: number | undefined;
  if (maintained) {
    z.literal("1").parse(env.CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED);
    z.string().trim().min(1).max(500).parse(env.CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVAL_REFERENCE);
    maintenanceUntil = Date.parse(z.iso.datetime({ offset: true }).parse(env.CASELINK_PARENT_RETENTION_MAINTENANCE_APPROVED_UNTIL));
    if (maintenanceUntil <= Date.now() || storageKey !== undefined)
      throw new Error("Maintenance needs current approval and no project API credential.");
  }
  if (!connectionString || !projectUrl || (mode === "all" && !storageKey))
    throw new Error(
      "Set the isolated retention database, parent project URL and protected storage/Auth credential.",
    );
  const canonicalProject = canonicalProjectOrigin(projectUrl);
  if (!canonicalProject)
    throw new Error("The retention project must be a canonical safe origin.");
  if (
    env.CASELINK_ENVIRONMENT === "connected" &&
    !connectedParentServiceAllowed(env, connectionString, canonicalProject)
  )
    throw new Error(
      "Connected retention requires the approved database with verified TLS.",
    );
  const isolation = parentProjectIsolationIssues({
    projectUrl,
    schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
    parentProductionUrl:
      env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ??
      env.CASELINK_PRODUCTION_SUPABASE_URL,
    environment: env.CASELINK_ENVIRONMENT ?? "production",
    accountMode: env.CASELINK_PARENT_ACCOUNT_MODE,
  });
  if (isolation.length)
    throw new Error("Parent retention project isolation is not configured.");
  const dbUrl = new URL(connectionString),
    apiUrl = new URL(canonicalProject);
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname);
  if (
    local &&
    (dbUrl.port !== "55322" || apiUrl.port !== "55321") &&
    !(
      env.CASELINK_PARENT_ACCOUNT_MODE === "existing" &&
      dbUrl.port === "54322" &&
      apiUrl.port === "54321"
    )
  )
    throw new Error(
      "Local retention must use the isolated parent project ports.",
    );
  if (
    !local &&
    (env.CASELINK_PARENT_RETENTION_APPROVED !== "1" ||
      apiUrl.protocol !== "https:")
  )
    throw new Error(
      "Remote retention requires approval and an isolated parent project.",
    );
  if (maintained) {
    const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(canonicalProject)?.[1];
    if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) || !dbUrl.username || !dbUrl.password
      || dbUrl.pathname !== "/postgres" || dbUrl.hash
      || (local ? dbUrl.search !== "" && dbUrl.search !== "?sslmode=disable"
        : !ref || dbUrl.hostname !== `db.${ref}.supabase.co` || !["", "5432"].includes(dbUrl.port)
          || dbUrl.searchParams.getAll("sslmode").length !== 1 || dbUrl.searchParams.get("sslmode") !== "verify-full"
          || [...dbUrl.searchParams.keys()].some(key => !["sslmode", "sslrootcert"].includes(key) || dbUrl.searchParams.getAll(key).length !== 1)))
      throw new Error("Maintenance requires the exact approved database with verified TLS.");
  }
  const s3Credentials = ordinaryOnly ? s3StorageCredentialsSchema.parse({
    s3AccessKeyId: env.CASELINK_PARENT_RETENTION_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY,
    s3Region: env.CASELINK_PARENT_RETENTION_S3_REGION,
  }) : null;
  if (packetsOnly && [env.CASELINK_PARENT_RETENTION_S3_ACCESS_KEY_ID, env.CASELINK_PARENT_RETENTION_S3_SECRET_ACCESS_KEY, env.CASELINK_PARENT_RETENTION_S3_REGION].some(value => value !== undefined))
    throw new Error("Protected packet maintenance cannot receive Storage credentials.");
  const batchSchema = z.object({
    batchId: z.uuid(),
    leaseToken: z.uuid(),
    documents: z
      .array(
        z.object({
          id: z.uuid(),
          objectPath: z
            .string()
            .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
        }),
      )
      .max(ordinaryOnly ? 1 : 100),
    artifacts: z
      .array(
        z.object({
          id: z.uuid(),
          objectPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/),
        }),
      )
      .max(ordinaryOnly ? 1 : 100)
      .default([]),
    accountIds: z.array(z.uuid()).max(ordinaryOnly ? 1 : 100),
    requestIds: z.array(z.uuid()).max(ordinaryOnly ? 1 : 100),
  });
  const db = new Client({
    connectionString,
    application_name: "caselink-parent-retention",
    connectionTimeoutMillis: 3000,
    query_timeout: 18000,
    statement_timeout: 15000,
  });
  const supabase = mode === "all" && storageKey ? createClient(canonicalProject, storageKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;
  const s3 = s3Credentials ? createS3Storage({ projectUrl: canonicalProject, ...s3Credentials }) : null;
  const controller = new AbortController();
  let closed = false, rejectStop!: (error: Error) => void;
  const close = () => {
    if (closed) return; closed = true;
    controller.abort(); s3?.destroy();
    db.connection.stream.destroy();
    try { void db.end().catch(() => {}); } catch {}
  };
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  void stop.catch(() => {});
  const abort = () => { rejectStop(new Error("Parent retention stopped.")); close(); };
  const run = async <T>(action: () => Promise<T>) => {
    if (closed || (maintenanceUntil !== undefined && Date.now() >= maintenanceUntil)) throw new Error("Parent retention stopped.");
    const result = await Promise.race([action(), stop]);
    if (closed || (maintenanceUntil !== undefined && Date.now() >= maintenanceUntil)) throw new Error("Parent retention stopped.");
    return result;
  };
  const query = (text: string, values?: unknown[]) => run(() => db.query(text, values));
  const timer = maintenanceUntil === undefined ? undefined : setTimeout(abort, Math.min(60000, maintenanceUntil - Date.now()));
  db.on("error", abort);
  if (ordinaryOnly) { process.once("SIGTERM", abort); process.once("SIGINT", abort); }
  try {
    await run(() => db.connect());
    const principal = (
      await query(`select r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
    pg_has_role(session_user,g.oid,'MEMBER') member,pg_has_role(session_user,g.oid,'SET') can_set,
    exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid=g.oid and m.admin_option) admin_option,
    exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid<>g.oid) broader_membership,
    exists(select 1 from pg_auth_members m where m.member=g.oid) group_membership,
    g.rolcanlogin group_login,g.rolinherit group_inherit,g.rolsuper group_super,g.rolbypassrls group_bypassrls,
    g.rolcreaterole group_createrole,g.rolcreatedb group_createdb,g.rolreplication group_replication
    from pg_roles r cross join pg_roles g where r.rolname=session_user and g.rolname='parent_retention_worker'`)
    ).rows[0];
    const role = z.object({
      rolname: z.string(), rolcanlogin: z.literal(true), rolinherit: z.literal(false), rolsuper: z.literal(false), rolbypassrls: z.literal(false),
      rolcreaterole: z.literal(false), rolcreatedb: z.literal(false), rolreplication: z.literal(false), member: z.literal(true), can_set: z.literal(true),
      admin_option: z.literal(false), broader_membership: z.literal(false), group_membership: z.literal(false), group_login: z.literal(false),
      group_inherit: z.literal(false), group_super: z.literal(false), group_bypassrls: z.literal(false), group_createrole: z.literal(false),
      group_createdb: z.literal(false), group_replication: z.literal(false),
    }).strict().safeParse(principal);
    if (
      !role.success ||
      ["postgres", "service_role", "supabase_admin", "authenticator"].includes(
        role.data.rolname,
      ) || (dbUrl.username && role.data.rolname !== decodeURIComponent(dbUrl.username))
    )
      throw new Error(
        "Use a dedicated NOINHERIT login granted only the parent_retention_worker role.",
      );
    await query("set role parent_retention_worker");
    if (
      (await query("select current_user as name")).rows[0].name !==
      "parent_retention_worker"
    )
      throw new Error("Could not enter the restricted retention role.");
    let removedDocuments = 0,
      removedAccounts = 0,
      removedPackets = 0;
    for (let count = 0; !ordinaryOnly && count < 10; count++) {
      const result = await query(
        "select parent_private.parent_purge_snap_final_packets(100) removed",
      );
      const removed = z.number().int().min(0).max(100).parse(result.rows[0]?.removed);
      removedPackets += removed;
      if (removed < 100) break;
    }
    if (packetsOnly) {
      process.stdout.write(`Retention completed: ${removedPackets} protected packets erased.\n`);
      return;
    }
    if (!supabase && !s3) throw new Error("Ordinary retention requires its Storage credential.");
    for (let count = 0; count < 10; count++) {
      const result = await query(
        ordinaryOnly ? "select parent_private.parent_claim_cleanup(1) batch" : "select parent_private.parent_claim_cleanup(100) batch",
      );
      if (!result.rows[0]?.batch) break;
      const batch = batchSchema.parse(result.rows[0].batch);
      const documents: string[] = [],
        artifacts: string[] = [],
        accounts = batch.accountIds;
      for (const doc of batch.documents) {
        if (s3) await run(() => s3.remove("parent-documents", doc.objectPath, controller.signal));
        else {
          const { data, error } = await supabase!.storage
            .from("parent-documents")
            .remove([doc.objectPath]);
          if (error || !data)
            throw new Error(
              "A private object could not be erased. Its lease will expire for a safe retry.",
            );
        }
        documents.push(doc.id);
      }
      for (const artifact of batch.artifacts) {
        if (s3) await run(() => s3.remove("parent-form-artifacts", artifact.objectPath, controller.signal));
        else {
          const { data, error } = await supabase!.storage
            .from("parent-form-artifacts")
            .remove([artifact.objectPath]);
          if (error || !data)
            throw new Error(
              "A private form could not be erased. Its lease remains available for retry.",
            );
        }
        artifacts.push(artifact.id);
      }
      // Parent erasure must not delete a shared Auth identity or cascade school records.
      await query(
        "select parent_private.parent_finish_cleanup($1,$2,$3,$4,$5)",
        [batch.batchId, batch.leaseToken, documents, accounts, artifacts],
      );
      removedDocuments += documents.length + artifacts.length;
      removedAccounts += accounts.length;
    }
    process.stdout.write(
      `Retention completed: ${removedPackets} protected packets, ${removedDocuments} private objects and ${removedAccounts} parent memberships erased.\n`,
    );
  } finally {
    if (ordinaryOnly) { process.removeListener("SIGTERM", abort); process.removeListener("SIGINT", abort); }
    clearTimeout(timer); close();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Parent retention failed. Pending erasures remain eligible for safe retry; inspect the protected runtime.\n",
  );
  process.exitCode = 1;
});
