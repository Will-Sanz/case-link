import { Client } from "pg";
import {
  canonicalProjectOrigin,
  isLoopbackHost,
  parentProjectIsolationIssues,
} from "../src/lib/parent/project-origin";
import { runParentWorkerService } from "../src/lib/parent/worker-service";
import { connectedParentServiceAllowed } from "../src/lib/parent/connected-service";

async function main() {
  const env = process.env;
  const connectionString = env.CASELINK_PARENT_WORKER_DATABASE_URL;
  const supabaseOrigin = canonicalProjectOrigin(
    env.CASELINK_PARENT_WORKER_SUPABASE_URL,
  );
  const brokerOrigin = canonicalProjectOrigin(
    env.CASELINK_PARENT_STORAGE_BROKER_ORIGIN,
  );
  const brokerSecret = env.CASELINK_PARENT_STORAGE_BROKER_SECRET;
  if (
    !connectionString ||
    !supabaseOrigin ||
    !brokerOrigin ||
    !brokerSecret ||
    brokerSecret.length < 32
  )
    throw new Error(
      "A scoped worker database, isolated parent origin and storage broker are required.",
    );
  const target = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    parentProjectIsolationIssues({
      projectUrl: supabaseOrigin,
      schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
      parentProductionUrl:
        env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ??
        env.CASELINK_PRODUCTION_SUPABASE_URL,
      environment: env.CASELINK_ENVIRONMENT ?? "production",
      accountMode: env.CASELINK_PARENT_ACCOUNT_MODE,
    }).length
  )
    throw new Error("The worker requires a verified isolated parent project.");
  const local =
    isLoopbackHost(target.hostname) &&
    isLoopbackHost(new URL(supabaseOrigin).hostname) &&
    isLoopbackHost(new URL(brokerOrigin).hostname);
  const connected = connectedParentServiceAllowed(
    env,
    connectionString,
    supabaseOrigin,
    brokerOrigin,
  );
  if (
    local &&
    target.port !==
      (new URL(supabaseOrigin).port === "54321" ? "54322" : "55322")
  )
    throw new Error("Use the isolated local parent database.");
  if (
    !local &&
    (env.CASELINK_PARENT_WORKER_APPROVED !== "1" ||
      (!connected && !brokerOrigin.startsWith("https:")))
  )
    throw new Error(
      "Remote worker execution requires approved isolated HTTPS services.",
    );
  const database = new Client({
    connectionString,
    application_name: "caselink-parent-worker",
    statement_timeout: 15000,
  });
  await database.connect();
  try {
    const principal = (
      await database.query(`select r.rolname,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,
      pg_has_role(session_user,'parent_worker','MEMBER') member,
      exists(select 1 from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid and g.rolname<>'parent_worker') broader_membership
      from pg_roles r where r.rolname=session_user`)
    ).rows[0];
    if (
      !principal ||
      !principal.member ||
      principal.rolinherit ||
      principal.rolsuper ||
      principal.rolbypassrls ||
      principal.rolcreaterole ||
      principal.broader_membership ||
      ["postgres", "service_role", "supabase_admin", "authenticator"].includes(
        principal.rolname,
      )
    )
      throw new Error(
        "Use a dedicated NOINHERIT login granted only parent_worker.",
      );
    await database.query("set role parent_worker");
    if (
      (await database.query("select current_user as name")).rows[0].name !==
      "parent_worker"
    )
      throw new Error("The restricted worker role is unavailable.");
    const stop = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => stop.abort());
    await runParentWorkerService({
      database,
      apiKey: env.OPENAI_API_KEY,
      brokerOrigin,
      brokerSecret,
      supabaseOrigin,
      watch: process.argv.includes("--watch"),
      signal: stop.signal,
      notifications:
        env.CASELINK_PARENT_NOTIFICATIONS_APPROVED === "1" &&
        env.RESEND_API_KEY &&
        env.CASELINK_PARENT_EMAIL_FROM &&
        env.NEXT_PUBLIC_SITE_URL
          ? {
              apiKey: env.RESEND_API_KEY,
              from: env.CASELINK_PARENT_EMAIL_FROM,
              siteOrigin: env.NEXT_PUBLIC_SITE_URL,
              approved: true,
            }
          : undefined,
    });
    process.stdout.write(
      "The private support and assistant worker stopped. Only recorded receipts establish external delivery.\n",
    );
  } finally {
    await database.end();
  }
}
void main().catch(() => {
  process.stderr.write(
    "The isolated parent worker could not run. Inspect its protected configuration and current authority.\n",
  );
  process.exitCode = 1;
});
