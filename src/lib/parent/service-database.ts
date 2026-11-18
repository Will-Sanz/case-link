import { Client } from "pg";
import { z } from "zod";
import { connectedParentServiceAllowed } from "./connected-service";
import { hostedParentServiceAllowed } from "./hosted-service";
import { canonicalProjectOrigin, isLoopbackHost, parentProjectIsolationIssues } from "./project-origin";

type Service = "worker" | "storage_broker";
const roles = { worker: "parent_worker", storage_broker: "parent_storage_broker" } as const;
const unavailable = () => new Error("The private parent service database is unavailable.");
const privileged = ["postgres", "service_role", "supabase_admin", "authenticator", ...Object.values(roles)];
export const parentServiceDatabaseTimeouts = { connectionTimeoutMillis: 3000, query_timeout: 18000, statement_timeout: 15000 } as const;

/** Only the reviewed local, connected and time-bounded hosted launch modes may create a client. */
export function validateParentServiceDatabaseTarget(env: Record<string, string | undefined>, service: Service) {
  try {
    const prefix = `CASELINK_PARENT_${service.toUpperCase()}`;
    const connectionString = env[`${prefix}_DATABASE_URL`];
    const projectUrl = canonicalProjectOrigin(env[`${prefix}_SUPABASE_URL`]);
    const rawBroker = env.CASELINK_PARENT_STORAGE_BROKER_ORIGIN ?? (service === "storage_broker" ? "http://127.0.0.1:3310" : undefined);
    const brokerOrigin = canonicalProjectOrigin(rawBroker);
    if (!connectionString || !projectUrl || !rawBroker || !brokerOrigin) throw unavailable();
    const database = new URL(connectionString), project = new URL(projectUrl), login = decodeURIComponent(database.username);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !/^[a-z][a-z0-9_]{0,62}$/.test(login) || privileged.includes(login)
      || !database.password || database.pathname !== "/postgres" || database.hash
      || [...database.searchParams.keys()].some(key => !["sslmode", "sslrootcert"].includes(key) || database.searchParams.getAll(key).length !== 1)
      || parentProjectIsolationIssues({ projectUrl, schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
        parentProductionUrl: env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ?? env.CASELINK_PRODUCTION_SUPABASE_URL,
        environment: env.CASELINK_ENVIRONMENT ?? "production", accountMode: env.CASELINK_PARENT_ACCOUNT_MODE }).length) throw unavailable();
    const local = [database.hostname, project.hostname, new URL(brokerOrigin).hostname].every(isLoopbackHost);
    if (local) {
      if ((database.port !== "55322" || project.port !== "55321")
        && !(env.CASELINK_PARENT_ACCOUNT_MODE === "existing" && database.port === "54322" && project.port === "54321")) throw unavailable();
      if (database.search !== "" && database.search !== "?sslmode=disable") throw unavailable();
    } else if (env[`${prefix}_APPROVED`] !== "1"
      || (!connectedParentServiceAllowed(env, connectionString, projectUrl, rawBroker)
        && !hostedParentServiceAllowed(env, connectionString, projectUrl, rawBroker))) throw unavailable();
    return { connectionString, projectUrl, brokerOrigin, login, role: roles[service], local };
  } catch { throw unavailable(); }
}

const principalSchema = z.object({ login: z.string(), role: z.string(), rolcanlogin: z.literal(true),
  rolinherit: z.literal(false), rolsuper: z.literal(false), rolbypassrls: z.literal(false), rolcreaterole: z.literal(false),
  rolcreatedb: z.literal(false), rolreplication: z.literal(false), member: z.literal(true), can_set: z.literal(true),
  admin_option: z.literal(false), broader_membership: z.literal(false), group_membership: z.literal(false),
  group_login: z.literal(false), group_inherit: z.literal(false), group_super: z.literal(false), group_bypassrls: z.literal(false),
  group_createrole: z.literal(false), group_createdb: z.literal(false), group_replication: z.literal(false),
}).strict();

/** Shared only by the durable worker and its Storage-only broker; errors never trigger a query retry. */
export function createParentServiceDatabase(target: ReturnType<typeof validateParentServiceDatabaseTarget>) {
  const client = new Client({ connectionString: target.connectionString,
    application_name: `caselink-${target.role.replaceAll("_", "-")}`, ...parentServiceDatabaseTimeouts });
  const controller = new AbortController();
  let closed = false, rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true; controller.abort(); rejectStop(unavailable());
    client.connection.stream.destroy();
    try { void client.end().catch(() => {}); } catch {}
  };
  const run = async <T>(action: () => Promise<T>, timeout: number) => {
    if (closed) throw unavailable();
    const timer = setTimeout(close, timeout);
    try {
      const result = await Promise.race([action(), stopped]);
      if (closed) throw unavailable();
      return result;
    } catch { close(); throw unavailable(); }
    finally { clearTimeout(timer); }
  };
  const query = (sql: string, values?: unknown[]) => run(() => client.query(sql, values), parentServiceDatabaseTimeouts.query_timeout);
  client.on("error", close);
  return {
    database: { query }, close, stopped, signal: controller.signal,
    async connect() {
      try {
        await run(() => client.connect(), parentServiceDatabaseTimeouts.connectionTimeoutMillis);
        const reply = await query(`select session_user::text login,current_user::text role,
          r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
          pg_has_role(session_user,g.oid,'MEMBER') member,pg_has_role(session_user,g.oid,'SET') can_set,
          exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid=g.oid and m.admin_option) admin_option,
          exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid<>g.oid) broader_membership,
          exists(select 1 from pg_auth_members m where m.member=g.oid) group_membership,
          g.rolcanlogin group_login,g.rolinherit group_inherit,g.rolsuper group_super,g.rolbypassrls group_bypassrls,
          g.rolcreaterole group_createrole,g.rolcreatedb group_createdb,g.rolreplication group_replication
          from pg_roles r cross join pg_roles g where r.rolname=session_user and g.rolname='${target.role}'`);
        if (reply.rows.length !== 1) throw unavailable();
        const principal = principalSchema.parse(reply.rows[0]);
        if (principal.login !== target.login || principal.role !== target.login) throw unavailable();
        await query(`set role ${target.role}`);
        const active = await query("select current_user::text role,session_user::text login");
        if (active.rows.length !== 1 || active.rows[0].role !== target.role || active.rows[0].login !== target.login) throw unavailable();
      } catch { close(); throw unavailable(); }
    },
  };
}
