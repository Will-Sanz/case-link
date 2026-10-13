/** Isolated, synthetic Auth + Data API tests. This script cannot target a remote project. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { offboardUser } from "./offboard-user-operation";

const local = JSON.parse(execFileSync("npx", ["--yes", "supabase@2.111.0", "status", "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string>;
for (const name of ["API_URL", "DB_URL"]) {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(local[name]).hostname), "Auth security tests require isolated local services.");
}
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const operator = createClient(local.API_URL, local.SERVICE_ROLE_KEY, authOptions);
const db = new Client({ connectionString: local.DB_URL });
const users: string[] = [];
const families: string[] = [];

async function staff() {
  const email = `auth-security-${randomUUID()}@example.test`;
  const password = `${randomUUID()}-Synthetic!1`;
  const created = await operator.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null, "synthetic staff account creation succeeds");
  const id = created.data.user!.id;
  users.push(id);
  const provisioned = await operator.rpc("operator_set_user_role", { p_target_user_id: id, p_role: "case_manager", p_actor_label: "Auth test", p_reason: "Synthetic Auth security rehearsal", p_action: "user.invited" });
  assert.equal(provisioned.error, null, "synthetic staff is provisioned through the operator boundary");
  const client = createClient(local.API_URL, local.ANON_KEY, authOptions);
  const login = await client.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null, "synthetic staff can sign in");
  assert.ok(login.data.session);
  return { id, client, email, password, accessToken: login.data.session.access_token, refreshToken: login.data.session.refresh_token };
}
async function family(client: SupabaseClient) {
  const created = await client.rpc("create_family_intake", {
    p_name: "Family synthetic", p_summary: null, p_urgency: "medium", p_household_notes: null,
    p_goals: [], p_barriers: [{ label: "Housing" }], p_members: [], p_initial_case_note: null,
  });
  assert.equal(created.error, null, "synthetic intake succeeds");
  families.push(created.data as string);
  return created.data as string;
}
async function retainedRequest(token: string, path: string, body?: unknown) {
  return fetch(`${local.API_URL}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function run() {
  await db.connect();
  const publicClient = createClient(local.API_URL, local.ANON_KEY, authOptions);
  const signup = await publicClient.auth.signUp({ email: `blocked-signup-${randomUUID()}@example.test`, password: `${randomUUID()}-Synthetic!1` });
  assert.ok(signup.error, "public signup remains disabled while email login is enabled");
  assert.equal(signup.data.session, null);
  const original = await staff();
  const replacement = await staff();
  const owned = await family(original.client);
  const assigned = await family(replacement.client);
  assert.equal((await operator.rpc("operator_set_family_assignment", { p_family_id: assigned, p_target_user_id: original.id, p_assigned: true, p_actor_label: "Auth test", p_reason: "Synthetic assignment before offboarding" })).error, null);
  const before = await retainedRequest(original.accessToken, `families?select=id&id=in.(${owned},${assigned})`);
  assert.equal((await before.json()).length, 2, "retained token initially sees owned and assigned cases");
  assert.ok((await db.query("select id from auth.sessions where user_id = $1", [original.id])).rowCount);

  await offboardUser(operator, { targetUserId: original.id, replacementUserId: replacement.id, actorLabel: "Auth test", reason: "Synthetic staff departure rehearsal" });
  const after = await retainedRequest(original.accessToken, `families?select=id&id=in.(${owned},${assigned})`);
  assert.equal(after.status, 200);
  assert.deepEqual(await after.json(), [], "the same unexpired JWT cannot read either case after offboarding");
  for (const rpc of ["ensure_app_user", "consume_ai_budget"]) {
    const denied = await retainedRequest(original.accessToken, `rpc/${rpc}`, rpc === "ensure_app_user" ? {} : { p_operation: "chat", p_weight: 1 });
    assert.equal(denied.status, 403, `inactive user cannot call ${rpc}`);
  }
  const write = await retainedRequest(original.accessToken, "rpc/add_case_note", { p_family_id: owned, p_body: "Unauthorized note" });
  assert.equal(write.status, 403, "old token cannot write to its former owned case");
  const successor = await replacement.client.from("families").select("id").in("id", [owned, assigned]);
  assert.equal(successor.error, null);
  assert.equal(successor.data!.length, 2, "replacement staff can access both preserved cases");
  const evidence = await db.query("select created_by_id from public.families where id = $1", [owned]);
  assert.equal(evidence.rows[0].created_by_id, original.id, "offboarding preserves original ownership history");
  assert.equal((await db.query("select id from auth.sessions where user_id = $1", [original.id])).rowCount, 0, "all sessions are revoked");
  assert.equal((await db.query("select id from auth.refresh_tokens where user_id = $1", [original.id])).rowCount, 0, "refresh tokens are revoked with their sessions");
  const refresh = await original.client.auth.refreshSession({ refresh_token: original.refreshToken });
  assert.ok(refresh.error, "an offboarded refresh token cannot issue a new session");
  assert.equal(refresh.data.session, null);
  const relogin = await original.client.auth.signInWithPassword({ email: original.email, password: original.password });
  assert.ok(relogin.error, "offboarded credentials cannot start a new login");
  const audit = await db.query("select action, details from public.security_audit_log where target_user_id = $1 and action = 'user.disabled'", [original.id]);
  assert.ok(audit.rowCount);
  assert.equal(audit.rows[0].details.replacement_user_id, replacement.id);
  const retainedReplacementToken = replacement.accessToken;
  assert.equal((await replacement.client.auth.signOut({ scope: "global" })).error, null);
  const signedOutRead = await retainedRequest(retainedReplacementToken, `families?select=id&id=eq.${owned}`);
  assert.equal(signedOutRead.status, 200);
  assert.deepEqual(await signedOutRead.json(), [], "logout invalidates direct reads even while the JWT is unexpired");
  assert.equal((await retainedRequest(retainedReplacementToken, "rpc/consume_ai_budget", { p_operation: "chat", p_weight: 1 })).status, 403);
  console.info("Local Auth security checks passed: retained JWT, reads/writes, RPCs, reassignment, refresh, sign-in, and audit.");
}
run().finally(async () => {
  if (families.length) await db.query("delete from public.families where id = any($1::uuid[])", [families]);
  for (const id of users) await operator.auth.admin.deleteUser(id);
  if (users.length) await db.query("delete from public.security_audit_log where target_user_id = any($1::uuid[])", [users]);
  await db.end();
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local Auth security verification failed.");
  process.exitCode = 1;
});
