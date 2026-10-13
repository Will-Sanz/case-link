/** Isolated, synthetic Auth + Data API tests. This script cannot target a remote project. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { offboardUser } from "./offboard-user-operation";
import { inviteUser } from "./invite-user-operation";
import { recoverMfaUser } from "./recover-mfa-operation";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";

const local = JSON.parse(execFileSync("npx", ["--yes", "supabase@2.111.0", "status", "--output", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
})) as Record<string, string>;
for (const name of ["API_URL", "DB_URL", "MAILPIT_URL"]) {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(local[name]).hostname), "Auth security tests require isolated local services.");
}
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetchWithTimeout } };
const operator = createClient(local.API_URL, local.SERVICE_ROLE_KEY, authOptions);
const db = new Client({ connectionString: local.DB_URL });
const users: string[] = [];
const families: string[] = [];
const mailIds = new Set<string>();

function totp(secret: string, time = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "").toUpperCase()].map((character) => {
    const value = alphabet.indexOf(character);
    assert.ok(value >= 0, "the synthetic factor secret uses base32");
    return value.toString(2).padStart(5, "0");
  }).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082", "test authenticator matches the RFC 6238 SHA-1 vector");
const usedCounters = new Map<string, number>();
async function freshTotp(secret: string) {
  const previous = usedCounters.get(secret);
  if (previous !== undefined && Math.floor(Date.now() / 30000) <= previous) await delay((previous + 1) * 30000 - Date.now() + 50);
  usedCounters.set(secret, Math.floor(Date.now() / 30000));
  return totp(secret);
}

async function deliveredMail(email: string, subject: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetchWithTimeout(`${local.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert.equal(response.status, 200, "the isolated mailbox is available");
    const { messages } = await response.json() as { messages: { ID: string }[] };
    for (const message of messages) {
      if (mailIds.has(message.ID)) continue;
      const detail = await (await fetchWithTimeout(`${local.MAILPIT_URL}/api/v1/message/${message.ID}`)).json() as { HTML: string; Subject: string };
      if (detail.Subject !== subject) continue;
      mailIds.add(message.ID);
      return detail.HTML;
    }
    await delay(100);
  }
  throw new Error("The expected synthetic account email was not delivered.");
}
async function deliveredToken(email: string, type: "invite" | "recovery") {
  const html = await deliveredMail(email, type === "invite" ? "You're invited to CaseLink" : "Reset your password — CaseLink");
  for (const link of html.matchAll(/href="([^"]+)"/g)) {
    const url = new URL(link[1].replaceAll("&amp;", "&"));
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (fragment.get("type") !== type) continue;
    const token = fragment.get("token_hash");
    assert.ok(token, "the delivered email contains a verification token");
    assert.ok(url.search === "", "account links keep credentials out of the HTTP request URL");
    assert.ok(url.origin === "http://127.0.0.1:3000" && url.pathname === "/auth/callback", "the delivered link uses the canonical confirmation screen");
    return token;
  }
  throw new Error("The delivered account email does not use the required confirmation screen.");
}

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
async function invitedStaff(assignedFamilyId: string) {
  const email = `auth-security-${randomUUID()}@example.test`;
  const firstPassword = `${randomUUID()}-Initial!1`;
  const freshPassword = `${randomUUID()}-Fresh!1`;
  const password = `${randomUUID()}-Replacement!1`;
  const invitationInput = { email, role: "case_manager", siteOrigin: "http://127.0.0.1:3000", actorLabel: "Auth test", reason: "Synthetic invitation setup test" };
  const invite = await inviteUser(operator, invitationInput);
  const id = invite.userId;
  users.push(id);
  const firstToken = await deliveredToken(email, "invite");
  assert.equal((await db.query("select count(*)::int as count from public.app_users where id = $1", [id])).rows[0].count, 1, "permissions exist before the delivered invitation is opened");
  await db.query("update auth.users set confirmation_sent_at = now() - interval '16 minutes' where id = $1", [id]);
  assert.ok((await createClient(local.API_URL, local.ANON_KEY, authOptions).auth.verifyOtp({ type: "invite", token_hash: firstToken })).error, "expired invitations cannot establish a session");
  const resent = await inviteUser(operator, invitationInput);
  assert.equal(resent.userId, id, "resending an expired invitation reuses the same account");
  const token = await deliveredToken(email, "invite");
  assert.equal((await operator.rpc("operator_set_family_assignment", { p_family_id: assignedFamilyId, p_target_user_id: id, p_assigned: true, p_actor_label: "Auth test", p_reason: "Synthetic assignment before password setup" })).error, null);
  const client = createClient(local.API_URL, local.ANON_KEY, authOptions);
  const verified = await client.auth.verifyOtp({ type: "invite", token_hash: token });
  assert.equal(verified.error, null, "invitation verification establishes a setup session");
  assert.equal((await client.auth.updateUser({ data: { amr: [{ method: "password" }] } })).error, null);
  assert.equal((await client.rpc("has_password_session")).data, false, "invitation and forged user_metadata cannot impersonate password authentication");
  assert.deepEqual((await client.from("families").select("id").eq("id", assignedFamilyId)).data, [], "invitation sessions cannot read assigned cases before setup");
  assert.ok((await client.rpc("consume_ai_budget", { p_operation: "chat", p_weight: 1 })).error, "invitation sessions cannot skip setup through direct RPCs");
  const weak = await client.auth.updateUser({ password: "lowercasepasswordonly" });
  assert.equal(weak.error?.code, "weak_password", "Auth enforces the displayed password requirements");
  assert.equal((await client.auth.updateUser({ password: firstPassword })).error, null, "initial password can be saved");
  assert.ok((await deliveredMail(email, "Password changed — CaseLink")).includes("password"), "password changes deliver a distinct security notification");
  assert.equal((await client.rpc("has_password_session")).data, false, "setting a password must be followed by password sign-in");
  assert.equal((await client.auth.signOut({ scope: "global" })).error, null);
  const initialLogin = await client.auth.signInWithPassword({ email, password: firstPassword });
  assert.equal(initialLogin.error, null);
  assert.equal((await client.rpc("has_password_session")).data, true);
  assert.equal((await client.from("families").select("id").eq("id", assignedFamilyId)).data?.length, 1);
  const oldToken = initialLogin.data.session!.access_token;
  assert.equal((await inviteUser(operator, invitationInput)).delivery, "none", "an active account's role update sends no unexpected email");
  assert.equal((await inviteUser(operator, { ...invitationInput, resend: true })).delivery, "recovery");
  const recoveryToken = await deliveredToken(email, "recovery");
  const recoveryClient = createClient(local.API_URL, local.ANON_KEY, authOptions);
  assert.equal((await recoveryClient.auth.verifyOtp({ type: "recovery", token_hash: recoveryToken })).error, null, "the delivered link works in a separate browser without the request's verifier");
  assert.equal((await recoveryClient.auth.updateUser({ password: freshPassword })).error, null, "a fresh recovery session changes the password");
  // Age only this synthetic session to exercise Auth's older-session verification path.
  await db.query("update auth.sessions set created_at = now() - interval '25 hours' where user_id = $1", [id]);
  assert.equal((await recoveryClient.auth.updateUser({ password })).error?.code, "reauthentication_needed");
  assert.equal((await recoveryClient.auth.reauthenticate()).error, null);
  const verificationMail = await deliveredMail(email, "Verify your identity — CaseLink");
  const nonce = verificationMail.match(/>(\d{6})<\/span>/)?.[1];
  assert.ok(nonce, "the delivered reauthentication code matches the configured six-digit input");
  const wrongNonce = nonce === "000000" ? "000001" : "000000";
  assert.equal((await recoveryClient.auth.updateUser({ password, nonce: wrongNonce })).error?.code, "reauthentication_not_valid");
  await db.query("update auth.users set reauthentication_sent_at = now() - interval '16 minutes' where id = $1", [id]);
  assert.equal((await recoveryClient.auth.updateUser({ password, nonce })).error?.code, "reauthentication_not_valid", "expired verification codes are rejected");
  assert.equal((await recoveryClient.auth.reauthenticate()).error, null);
  const renewedNonce = (await deliveredMail(email, "Verify your identity — CaseLink")).match(/>(\d{6})<\/span>/)?.[1];
  assert.ok(renewedNonce);
  assert.equal((await recoveryClient.auth.updateUser({ password, nonce: renewedNonce })).error, null, "an older session can complete secure password change using the emailed code");
  assert.equal((await recoveryClient.auth.signOut({ scope: "global" })).error, null);
  const oldAccess = await retainedRequest(oldToken, `families?select=id&id=eq.${assignedFamilyId}`);
  assert.deepEqual(await oldAccess.json(), [], "password-reset completion revokes earlier case access");
  assert.ok((await client.auth.signInWithPassword({ email, password: firstPassword })).error, "the previous password no longer works");
  await db.query("update auth.users set recovery_sent_at = now() - interval '61 seconds' where id = $1", [id]);
  const pkceRequestClient = createClient(local.API_URL, local.ANON_KEY, { ...authOptions, auth: { ...authOptions.auth, flowType: "pkce" } });
  assert.equal((await pkceRequestClient.auth.resetPasswordForEmail(email, { redirectTo: "http://127.0.0.1:3000/auth/callback" })).error, null);
  const pkceToken = await deliveredToken(email, "recovery");
  const separateBrowser = createClient(local.API_URL, local.ANON_KEY, authOptions);
  assert.equal((await separateBrowser.auth.verifyOtp({ type: "recovery", token_hash: pkceToken })).error, null, "a PKCE-initiated request can be recovered in a browser without its verifier using the email token");
  assert.equal((await separateBrowser.auth.signOut({ scope: "global" })).error, null);
  const login = await client.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null, "the replacement password signs in successfully");
  const reused = await createClient(local.API_URL, local.ANON_KEY, authOptions).auth.verifyOtp({ type: "recovery", token_hash: recoveryToken });
  assert.ok(reused.error, "a recovery link cannot be reused");
  return { id, client, email, password, accessToken: login.data.session!.access_token, refreshToken: login.data.session!.refresh_token };
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
  return fetchWithTimeout(`${local.API_URL}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function mfaSecurity(otherFamilyId: string) {
  const account = await staff();
  const owned = await family(account.client);
  assert.equal((await operator.rpc("operator_set_user_role", { p_target_user_id: account.id, p_role: "admin", p_actor_label: "Auth test", p_reason: "Synthetic MFA administrator test", p_action: "user.role_changed" })).error, null);
  assert.equal((await account.client.rpc("has_required_mfa")).data, false);
  assert.deepEqual((await account.client.from("families").select("id")).data, [], "a password-only administrator cannot read even an owned case");
  const enrolled = await account.client.auth.mfa.enroll({ factorType: "totp", issuer: "CaseLink", friendlyName: "Synthetic authenticator" });
  assert.equal(enrolled.error, null);
  const first = enrolled.data!;
  const invalidCode = totp(first.totp.secret) === "000000" ? "000001" : "000000";
  assert.ok((await account.client.auth.mfa.challengeAndVerify({ factorId: first.id, code: invalidCode })).error, "an incorrect authenticator code is rejected");
  const expired = await account.client.auth.mfa.challenge({ factorId: first.id });
  assert.equal(expired.error, null);
  await db.query("update auth.mfa_challenges set created_at = now() - interval '10 minutes' where id = $1", [expired.data!.id]);
  assert.ok((await account.client.auth.mfa.verify({ factorId: first.id, challengeId: expired.data!.id, code: totp(first.totp.secret) })).error, "an expired challenge rejects even a current code");
  const verified = await account.client.auth.mfa.challengeAndVerify({ factorId: first.id, code: await freshTotp(first.totp.secret) });
  assert.equal(verified.error, null, "initial authenticator enrollment verifies successfully");
  assert.equal((await account.client.rpc("is_app_admin")).data, true);
  assert.equal((await account.client.from("families").select("id").eq("id", otherFamilyId)).data?.length, 1);
  assert.deepEqual(await (await retainedRequest(account.accessToken, `families?select=id&id=eq.${otherFamilyId}`)).json(), [], "the earlier AAL1 JWT cannot borrow the session's later MFA verification");
  await deliveredMail(account.email, "Verification method added — CaseLink");
  assert.equal((await account.client.auth.signOut({ scope: "global" })).error, null);
  assert.equal((await account.client.auth.signInWithPassword({ email: account.email, password: account.password })).error, null);
  assert.equal((await account.client.rpc("has_required_mfa")).data, false, "returning password login requires a fresh MFA challenge");
  const returning = await account.client.auth.mfa.challengeAndVerify({ factorId: first.id, code: await freshTotp(first.totp.secret) });
  assert.equal(returning.error, null);
  const elevatedToken = returning.data!.access_token;
  assert.equal((await account.client.auth.mfa.unenroll({ factorId: first.id })).error, null);
  assert.deepEqual(await (await retainedRequest(elevatedToken, `families?select=id&id=eq.${owned}`)).json(), [], "factor removal immediately denies the retained AAL2 token");
  await deliveredMail(account.email, "Verification method removed — CaseLink");
  const second = await account.client.auth.mfa.enroll({ factorType: "totp", issuer: "CaseLink", friendlyName: "Synthetic replacement" });
  assert.equal(second.error, null);
  const secondVerified = await account.client.auth.mfa.challengeAndVerify({ factorId: second.data!.id, code: await freshTotp(second.data!.totp.secret) });
  assert.equal(secondVerified.error, null);
  const beforeRecovery = secondVerified.data!.access_token;
  const ordinaryRecovery = await operator.auth.admin.generateLink({ type: "recovery", email: account.email });
  assert.equal(ordinaryRecovery.error, null);
  const recoveryClient = createClient(local.API_URL, local.ANON_KEY, authOptions);
  assert.equal((await recoveryClient.auth.verifyOtp({ type: "recovery", token_hash: ordinaryRecovery.data.properties.hashed_token })).error, null);
  assert.equal((await recoveryClient.auth.updateUser({ password: `${randomUUID()}-NotAllowed!1` })).error?.code, "insufficient_aal", "email recovery alone cannot bypass the authenticator");
  assert.deepEqual((await recoveryClient.from("families").select("id")).data, []);
  await recoverMfaUser(operator, { targetUserId: account.id, siteOrigin: "http://127.0.0.1:3000", actorLabel: "Auth test", reason: "Synthetic independent identity verification", identityVerified: true });
  assert.deepEqual(await (await retainedRequest(beforeRecovery, `families?select=id&id=eq.${owned}`)).json(), [], "operator recovery revokes earlier verified sessions");
  assert.ok((await account.client.auth.signInWithPassword({ email: account.email, password: account.password })).error, "lost-factor recovery also invalidates the previous password");
  const token = await deliveredToken(account.email, "recovery");
  const recovered = createClient(local.API_URL, local.ANON_KEY, authOptions);
  assert.equal((await recovered.auth.verifyOtp({ type: "recovery", token_hash: token })).error, null);
  const newPassword = `${randomUUID()}-Recovered!1`;
  assert.equal((await recovered.auth.updateUser({ password: newPassword })).error, null);
  assert.equal((await recovered.auth.signOut({ scope: "global" })).error, null);
  assert.equal((await recovered.auth.signInWithPassword({ email: account.email, password: newPassword })).error, null);
  assert.equal((await recovered.rpc("has_required_mfa")).data, false, "recovered administrators must enroll again before reading cases");
  const replacementFactor = await recovered.auth.mfa.enroll({ factorType: "totp", issuer: "CaseLink", friendlyName: "Recovered authenticator" });
  assert.equal(replacementFactor.error, null);
  assert.equal((await recovered.auth.mfa.challengeAndVerify({ factorId: replacementFactor.data!.id, code: await freshTotp(replacementFactor.data!.totp.secret) })).error, null);
  assert.equal((await recovered.rpc("is_app_admin")).data, true);
  assert.equal((await recovered.from("families").select("id").eq("id", owned)).data?.length, 1);
  assert.equal((await db.query("select created_by_id from public.families where id = $1", [owned])).rows[0].created_by_id, account.id, "MFA recovery preserves case ownership");
  const audit = await db.query("select action from public.security_audit_log where target_user_id = $1 and action like 'user.mfa_recovery_%' order by created_at", [account.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["user.mfa_recovery_started", "user.mfa_recovery_ready"]);
  assert.equal((await recovered.auth.signOut({ scope: "global" })).error, null);
}

async function run() {
  await db.connect();
  const publicClient = createClient(local.API_URL, local.ANON_KEY, authOptions);
  const signup = await publicClient.auth.signUp({ email: `blocked-signup-${randomUUID()}@example.test`, password: `${randomUUID()}-Synthetic!1` });
  assert.ok(signup.error, "public signup remains disabled while email login is enabled");
  assert.equal(signup.data.session, null);
  const replacement = await staff();
  const assigned = await family(replacement.client);
  const original = await invitedStaff(assigned);
  const owned = await family(original.client);
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
  await mfaSecurity(assigned);
  console.info("Local Auth security checks passed: invitation/reset/email, MFA setup/challenge/removal/recovery, retained JWT denial, reads/writes, RPCs, reassignment, refresh, and audit.");
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
