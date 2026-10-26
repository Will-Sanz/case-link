import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  canonicalProjectOrigin,
  parentProjectIsolationIssues,
} from "../src/lib/parent/project-origin";

async function main() {
  const env = process.env;
  const connectionString = env.CASELINK_PARENT_RETENTION_DATABASE_URL;
  const projectUrl = env.CASELINK_PARENT_RETENTION_SUPABASE_URL;
  const storageKey = env.CASELINK_PARENT_RETENTION_STORAGE_KEY;
  if (!connectionString || !projectUrl || !storageKey)
    throw new Error(
      "Set the isolated retention database, parent project URL and protected storage/Auth credential.",
    );
  const canonicalProject = canonicalProjectOrigin(projectUrl);
  if (!canonicalProject)
    throw new Error("The retention project must be a canonical safe origin.");
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
      .max(100),
    artifacts: z
      .array(
        z.object({
          id: z.uuid(),
          objectPath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/),
        }),
      )
      .max(100)
      .default([]),
    accountIds: z.array(z.uuid()).max(100),
    requestIds: z.array(z.uuid()).max(100),
  });
  const db = new Client({
    connectionString,
    application_name: "caselink-parent-retention",
    statement_timeout: 15000,
  });
  const supabase = createClient(canonicalProject, storageKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await db.connect();
  try {
    const principal = (
      await db.query(`select r.rolname,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,
    pg_has_role(session_user,'parent_retention_worker','MEMBER') member,
    exists(select 1 from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid and g.rolname<>'parent_retention_worker') broader_membership
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
        "Use a dedicated NOINHERIT login granted only the parent_retention_worker role.",
      );
    await db.query("set role parent_retention_worker");
    if (
      (await db.query("select current_user as name")).rows[0].name !==
      "parent_retention_worker"
    )
      throw new Error("Could not enter the restricted retention role.");
    let removedDocuments = 0,
      removedAccounts = 0;
    for (let count = 0; count < 10; count++) {
      const result = await db.query(
        "select parent_private.parent_claim_cleanup(100) batch",
      );
      if (!result.rows[0]?.batch) break;
      const batch = batchSchema.parse(result.rows[0].batch);
      const documents: string[] = [],
        artifacts: string[] = [],
        accounts = batch.accountIds;
      for (const doc of batch.documents) {
        const { data, error } = await supabase.storage
          .from("parent-documents")
          .remove([doc.objectPath]);
        if (error || !data)
          throw new Error(
            "A private object could not be erased. Its lease will expire for a safe retry.",
          );
        documents.push(doc.id);
      }
      for (const artifact of batch.artifacts) {
        const { data, error } = await supabase.storage
          .from("parent-form-artifacts")
          .remove([artifact.objectPath]);
        if (error || !data)
          throw new Error(
            "A private form could not be erased. Its lease remains available for retry.",
          );
        artifacts.push(artifact.id);
      }
      // Parent erasure must not delete a shared Auth identity or cascade school records.
      await db.query(
        "select parent_private.parent_finish_cleanup($1,$2,$3,$4,$5)",
        [batch.batchId, batch.leaseToken, documents, accounts, artifacts],
      );
      removedDocuments += documents.length + artifacts.length;
      removedAccounts += accounts.length;
    }
    process.stdout.write(
      `Retention completed: ${removedDocuments} private objects and ${removedAccounts} parent memberships erased.\n`,
    );
  } finally {
    await db.end();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Parent retention failed. Pending erasures remain eligible for safe retry; inspect the protected runtime.\n",
  );
  process.exitCode = 1;
});
