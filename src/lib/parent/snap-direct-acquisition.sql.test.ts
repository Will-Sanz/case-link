import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
type Scope = { owner: string; request: string; version: number; snapshot: string; hash: string; subjects: string[] };
type Permission = { state: "permission_needed" | "authorized"; acquisitionId: string | null; consentedAt: string | null; expiresAt: string; subjectIds: string[]; requestVersion: number; snapshotId: string; snapshotHash: string; [key: string]: unknown };
type Packet = { state: string; consentedAt: string; authorizationExpiresAt: string; intent: { packetId: string; authorizationId: string; contentSha256: string; byteLength: number; [key: string]: unknown } };
const policy = "synthetic-policy-1", retention = "synthetic-retention-1", digest = "a".repeat(64);

describe.skipIf(!modulePath)("closed SNAP direct-acquisition authority SQL (logic fixture only)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  async function asRole(role: string, owner: string, sql: string, values: unknown[] = [], method = "otp") {
    await fixture.admin.query("begin");
    try {
      await fixture.admin.query(`set local role ${role}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, sub: owner, session_id: sessions.get(owner), amr: [{ method }] })]);
      const result = await fixture.admin.query(sql, values); await fixture.admin.query("commit"); return result;
    } catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  const parent = (s: Scope, sql: string, values: unknown[] = [], method = "otp") => asRole("authenticated", s.owner, sql, values, method);
  async function setup(details = fixtureSnapApplication(new Date())): Promise<Scope> {
    const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    // Explicit synthetic provider/method authority; this is not a Pennsylvania acceptance decision.
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until,snap_direct_completion_version,snap_direct_completion_evidence_reference)
      values('snap-pa','submit',true,true,true,'synthetic-acquisition-route','synthetic route fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',array['applicant_signature_printed_page_1','rights_certification_printed_page_5'],clock_timestamp()+interval '1 hour','pa600fs-direct-completion-2026-11-05.v1','synthetic method fixture only; not acceptance')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,
        allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until,
        snap_direct_completion_version=excluded.snap_direct_completion_version,snap_direct_completion_evidence_reference=excluded.snap_direct_completion_evidence_reference`);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic acquisition fixture only',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; not an active policy',snap_protected_approved_until=now()+interval '1 day',
      snap_protected_policy_version=$2,snap_protected_retention_policy_version=$3,snap_protected_max_retention_seconds=300`, [SNAP_APPLICATION_NOTICE_VERSION, policy, retention]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const partial = { owner } as Scope;
    const request = (await parent(partial, "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now() + 3600000).toISOString() })), randomUUID()])).rows[0].id as string;
    const snapshot = (await parent(partial, "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    const hash = ((await fixture.admin.query("select parent_private.snap_application_binding($1,$2,$3) value", [request, version, snapshot])).rows[0].value as { snapshotHash: string }).snapshotHash;
    return { owner, request, snapshot, version, hash, subjects: details.household!.filter(p => p.requestingSnap).map(p => p.id).sort() };
  }
  async function get(s: Scope): Promise<Permission> { return (await parent(s, "select public.parent_get_snap_direct_acquisition($1,$2,$3,$4) value", [s.request, s.version, s.snapshot, s.hash])).rows[0].value as Permission; }
  async function authorize(s: Scope, changes: Record<string, unknown> = {}): Promise<Permission> {
    const v = { id: randomUUID(), policy, retention, subjects: s.subjects, declared: true, acceptedExpiresAt: (await get(s)).expiresAt, ...changes };
    return (await parent(s, "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value", [s.request, s.version, s.snapshot, s.hash, v.id, v.policy, v.retention, v.subjects, v.declared, v.acceptedExpiresAt])).rows[0].value as Permission;
  }
  async function packet(s: Scope, acquisition: string | null, changes: Record<string, unknown> = {}): Promise<Packet> {
    const v = { id: randomUUID(), digest, size: 31, ...changes };
    return (await parent(s, "select public.parent_authorize_snap_direct_packet($1,$2,$3,$4,$5,$6,$7,$8) value", [s.request, s.version, s.snapshot, s.hash, v.id, v.digest, v.size, acquisition])).rows[0].value as Packet;
  }
  async function recover(s: Scope, id: string) { return (await parent(s, "select public.parent_get_snap_direct_packet_authorization($1,$2,$3) value", [s.request, id, s.version])).rows[0].value as Packet; }
  const revoke = (s: Scope, id: string | null, method = "otp") => parent(s, "select public.parent_revoke_snap_direct_acquisition($1,$2)", [s.request, id], method);
  async function correction(s: Scope, newSubject = false): Promise<Scope> {
    const details = fixtureSnapApplication(new Date()); details.phone = "215-555-0102";
    if (newSubject) details.household![0].id = randomUUID();
    const snapshot = (await parent(s, "select public.parent_save_snap_application_details($1,$2,$3,$4,$5) id", [s.request, s.version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [s.request])).rows[0].version as number;
    const hash = ((await fixture.admin.query("select parent_private.snap_application_binding($1,$2,$3) value", [s.request, version, snapshot])).rows[0].value as { snapshotHash: string }).snapshotHash;
    return { ...s, snapshot, version, hash, subjects: details.household!.filter(p => p.requestingSnap).map(p => p.id).sort() };
  }
  async function counts(s: Scope) {
    return (await fixture.admin.query(`select (select count(*) from parent_private.snap_final_packet_authorizations where request_id=$1) authorities,
      (select count(*) from parent_private.snap_final_packets where request_id=$1) packets,(select count(*) from public.parent_operations where request_id=$1) operations,
      (select count(*) from parent_private.personal_act_evidence e join public.parent_operations o on o.id=e.operation_id where o.request_id=$1) acts,
      (select count(*) from parent_private.snap_submission_authorizations e join public.parent_operations o on o.id=e.operation_id where o.request_id=$1) submits`, [s.request])).rows[0];
  }
  it("starts disabled with no published protected policy or retention decision", async () => {
    expect((await fixture.admin.query("select snap_protected_enabled,snap_protected_policy_version,snap_protected_retention_policy_version,snap_protected_max_retention_seconds from parent_private.processing_controls")).rows[0]).toEqual({ snap_protected_enabled: false, snap_protected_policy_version: null, snap_protected_retention_policy_version: null, snap_protected_max_retention_seconds: null });
  });
  it("returns permission-needed metadata before acquisition without inventing consent, packet, act or Submit", async () => {
    const s = await setup(), before = await counts(s), value = await get(s);
    expect(value).toMatchObject({ state: "permission_needed", acquisitionId: null, consentedAt: null, authorityDeclaration: null, requestId: s.request, ownerId: s.owner, requestVersion: s.version, snapshotId: s.snapshot, snapshotHash: s.hash, recipient: "snap-pa", purpose: "snap_final_application_packet", subjectIds: s.subjects, policyVersion: policy, retentionPolicyVersion: retention });
    expect(value.fieldScope).toEqual(["applicant_ssn", "applicant_signature_printed_page_1", "applicant_signature_date_printed_page_1", "rights_certification_printed_page_5", "rights_certification_date_printed_page_5"]);
    expect(JSON.stringify(value)).not.toMatch(/Private Canary|dateOfBirth|keyBase64|ciphertext|packetId|income|details|provenance/); expect(await counts(s)).toEqual(before);
  });
  it("records one informed metadata-only permission and replays both original and equivalent new IDs without renewal", async () => {
    const s = await setup(), id = randomUUID(), first = await authorize(s, { id });
    expect(first).toMatchObject({ state: "authorized", acquisitionId: id, authorityDeclaration: "parent_declared_household_data_authority" });
    expect(await get(s)).toEqual(first); expect(await authorize(s, { id })).toEqual(first); expect(await authorize(s)).toEqual(first);
    expect(await counts(s)).toEqual({ authorities: 1, packets: 0, operations: 0, acts: 0, submits: 0 });
    const row = (await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where id=$1", [id])).rows[0].value as Record<string, unknown>;
    expect(row).toMatchObject({ authorization_kind: "direct_entry", acquisition_authorization_id: null, packet_id: null, content_sha256: null, byte_length: null, authorization_session_id: sessions.get(s.owner) });
    expect(row.consented_at).toBe(row.created_at);
  });
  it("binds the original displayed expiry despite time passing before consent, without extending it on replay", async () => {
    const s = await setup(), shown = await get(s), id = randomUUID();
    const value = await authorize(s, { id, acceptedExpiresAt: shown.expiresAt });
    expect(value.expiresAt).toBe(shown.expiresAt);
    expect(await authorize(s, { id, acceptedExpiresAt: new Date(Date.parse(shown.expiresAt) + 60000).toISOString() })).toEqual(value);
    const stored = (await fixture.admin.query("select expires_at from parent_private.snap_final_packet_authorizations where id=$1", [id])).rows[0].expires_at;
    expect(new Date(stored as string).toISOString()).toBe(shown.expiresAt);
  });
  it("honors a shorter exact accepted bound and never rewrites an existing grant to a different expiry", async () => {
    const s = await setup(), acceptedExpiresAt = new Date(Date.now() + 60000).toISOString(), id = randomUUID();
    const value = await authorize(s, { id, acceptedExpiresAt }); expect(value.expiresAt).toBe(acceptedExpiresAt);
    await expect(authorize(s, { id, acceptedExpiresAt: new Date(Date.parse(acceptedExpiresAt) - 1000).toISOString() })).rejects.toMatchObject({ code: "23514" });
    await expect(authorize(s, { acceptedExpiresAt: new Date(Date.parse(acceptedExpiresAt) - 1000).toISOString() })).rejects.toMatchObject({ code: "23514" });
    expect(await get(s)).toEqual(value); expect((await counts(s)).authorities).toBe(1);
  });
  it.each([null, "infinity", "-infinity", "2026-01-01T00:00:00.000Z", "2026-11-05T20:05:00.000001Z"])("rejects expired, unbounded or submillisecond accepted expiry %s without new authority", async acceptedExpiresAt => {
    const s = await setup(); await expect(authorize(s, { acceptedExpiresAt })).rejects.toMatchObject({ code: "23514" }); expect((await counts(s)).authorities).toBe(0);
  });
  it("continues to enforce the server deadline even when the accepted bound is later", async () => {
    const s = await setup(), until = new Date(Date.now() + 60000).toISOString();
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_approved_until=$1", [until]);
    expect((await authorize(s, { acceptedExpiresAt: new Date(Date.now() + 3600000).toISOString() })).expiresAt).toBe(until);
  });
  it("binds final hash only after permission while preserving original consent and expiry on child and replay", async () => {
    const s = await setup(), permission = await authorize(s), id = randomUUID(), value = await packet(s, permission.acquisitionId, { id });
    expect(value).toMatchObject({ state: "authorized", consentedAt: permission.consentedAt, authorizationExpiresAt: permission.expiresAt, intent: { packetId: id, contentSha256: digest, byteLength: 31 } });
    expect(await recover(s, id)).toEqual(value); expect(await packet(s, permission.acquisitionId, { id })).toEqual(value);
    const row = (await fixture.admin.query("select acquisition_authorization_id,authorization_kind from parent_private.snap_final_packet_authorizations where packet_id=$1", [id])).rows[0];
    expect(row).toEqual({ acquisition_authorization_id: permission.acquisitionId, authorization_kind: "packet" });
    expect(await counts(s)).toEqual({ authorities: 2, packets: 0, operations: 0, acts: 0, submits: 0 });
  });
  it("reuses informed permission after an ordinary in-scope fact correction, but binds new immutable current intent", async () => {
    const s = await setup(), permission = await authorize(s), old = await packet(s, permission.acquisitionId), next = await correction(s);
    await expect(get(s)).rejects.toMatchObject({ code: "42501" }); await expect(recover(next, old.intent.packetId)).rejects.toMatchObject({ code: "42501" });
    const current = await get(next); expect(current).toMatchObject({ acquisitionId: permission.acquisitionId, consentedAt: permission.consentedAt, expiresAt: permission.expiresAt, requestVersion: next.version, snapshotId: next.snapshot, snapshotHash: next.hash });
    expect(await authorize(next)).toEqual(current);
    expect(await packet(next, permission.acquisitionId)).toMatchObject({ consentedAt: permission.consentedAt, authorizationExpiresAt: permission.expiresAt, intent: { requestVersion: next.version, snapshotId: next.snapshot, snapshotHash: next.hash } });
  });
  it("requires fresh permission for new applying people instead of silently expanding the old grant", async () => {
    const s = await setup(), permission = await authorize(s), next = await correction(s, true);
    expect(await get(next)).toMatchObject({ state: "permission_needed", acquisitionId: null, subjectIds: next.subjects });
    await expect(packet(next, permission.acquisitionId)).rejects.toMatchObject({ code: "42501" });
    expect((await authorize(next)).acquisitionId).not.toBe(permission.acquisitionId);
  });
  it("does not extend original retention if the configured duration is later increased, and honors a reduced bound", async () => {
    const s = await setup(), permission = await authorize(s);
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=600");
    expect((await get(s)).expiresAt).toBe(permission.expiresAt); expect((await packet(s, permission.acquisitionId)).authorizationExpiresAt).toBe(permission.expiresAt);
    await fixture.admin.query("update parent_private.processing_controls set snap_protected_max_retention_seconds=100");
    await expect(packet(s, permission.acquisitionId)).rejects.toMatchObject({ code: "40001" });
    const next = await correction(s), shorter = await packet(next, permission.acquisitionId);
    expect(Date.parse(shorter.authorizationExpiresAt)).toBeLessThan(Date.parse(permission.expiresAt));
    expect(Date.parse(shorter.authorizationExpiresAt)).toBeLessThanOrEqual(Date.parse(permission.consentedAt!) + 100000);
  });
  it.each([{ declared: false }, { declared: null }, { id: null }, { subjects: [] }, { subjects: null }, { subjects: [null] }, { subjects: [randomUUID()] }, { policy: "unpublished" }, { retention: "unpublished" }])("rejects invalid authority declaration %j", async changes => {
    const s = await setup(); await expect(authorize(s, changes)).rejects.toMatchObject({ code: "23514" }); expect((await counts(s)).authorities).toBe(0);
  });
  it("rejects duplicate subjects and includes only applying people", async () => {
    const d = fixtureSnapApplication(new Date()), nonapplicant = { ...d.household![0], id: randomUUID(), relationship: "OTHER", requestingSnap: false }; delete nonapplicant.citizen; d.household!.push(nonapplicant); d.householdSize = 2;
    const s = await setup(d); await expect(authorize(s, { subjects: [s.subjects[0], s.subjects[0]] })).rejects.toMatchObject({ code: "23514" });
    await expect(authorize(s, { subjects: d.household!.map(p => p.id) })).rejects.toMatchObject({ code: "23514" }); expect((await authorize(s)).subjectIds).toEqual(s.subjects);
  });
  it.each([{ id: null }, { digest: null }, { digest: "bad" }, { size: null }, { size: 0 }, { size: 10485761 }])("rejects invalid derived packet metadata %j", async changes => {
    const s = await setup(), permission = await authorize(s); await expect(packet(s, permission.acquisitionId, changes)).rejects.toMatchObject({ code: "23514" }); expect((await counts(s)).authorities).toBe(1);
  });
  it.each(["digest", "size", "acquisition"])("does not overwrite a child after changed %s replay", async kind => {
    const s = await setup(), permission = await authorize(s), first = await packet(s, permission.acquisitionId), changes = { id: first.intent.packetId, ...(kind === "digest" ? { digest: "b".repeat(64) } : kind === "size" ? { size: 32 } : {}) };
    await expect(packet(s, kind === "acquisition" ? randomUUID() : permission.acquisitionId, changes)).rejects.toMatchObject({ code: kind === "acquisition" ? "42501" : "23514" }); expect(await recover(s, first.intent.packetId)).toEqual(first);
  });
  it("rejects foreign UUID collisions without returning or changing another parent's authority", async () => {
    const s = await setup(), other = await setup(), permission = await authorize(other);
    await expect(authorize(s, { id: permission.acquisitionId })).rejects.toMatchObject({ code: "23514" }); expect(await get(other)).toEqual(permission); expect((await counts(s)).authorities).toBe(0);
    const own = await authorize(s), foreignPacket = await packet(other, permission.acquisitionId);
    await expect(packet(s, own.acquisitionId, { id: foreignPacket.intent.packetId })).rejects.toMatchObject({ code: "23514" }); expect(await recover(other, foreignPacket.intent.packetId)).toEqual(foreignPacket);
  });
  it.each(["processing", "details", "protected", "approval", "protected_approval", "policy", "retention", "duration", "mandate", "cancel", "version", "snapshot", "hash", "session"])("denies new acquisition/read after %s closure or mismatch", async kind => {
    const s = await setup(), permission = await authorize(s); const changed = { ...s };
    const sql: Record<string, string> = { processing: "enabled=false", details: "snap_details_enabled=false", protected: "snap_protected_enabled=false", approval: "approved_until=now()-interval '1 second'", protected_approval: "snap_protected_approved_until=now()-interval '1 second'", policy: "snap_protected_policy_version=null", retention: "snap_protected_retention_policy_version=null", duration: "snap_protected_max_retention_seconds=null" };
    if (sql[kind]) await fixture.admin.query(`update parent_private.processing_controls set ${sql[kind]}`);
    if (kind === "mandate") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [s.request]);
    if (kind === "cancel") await parent(s, "select public.parent_control_request($1,'cancel')", [s.request]);
    if (kind === "version") changed.version++;
    if (kind === "snapshot") changed.snapshot = randomUUID();
    if (kind === "hash") changed.hash = "f".repeat(64);
    if (kind === "session") await fixture.admin.query("delete from auth.sessions where id=$1", [sessions.get(s.owner)]);
    await expect(get(changed)).rejects.toMatchObject({ code: "42501" }); await expect(packet(changed, permission.acquisitionId)).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["citizenship", "representative", "too_many_people", "too_many_incomes"])("does not invent unsupported direct authority for %s", async kind => {
    const d = fixtureSnapApplication(new Date());
    if (kind === "citizenship") d.household![0].citizen = false;
    if (kind === "representative") d.authorizedRepresentative = { name: "Synthetic Representative", phone: "215-555-0101", address: { street: "2 Synthetic Street", city: "Philadelphia", state: "PA", zip: "19104" } };
    if (kind === "too_many_people") { for (let n = 1; n < 9; n++) d.household!.push({ ...d.household![0], id: randomUUID(), relationship: "OTHER" }); d.householdSize = 9; }
    if (kind === "too_many_incomes") d.income = { month: new Date().toISOString().slice(0, 7), hasIncome: true, entries: Array.from({ length: 6 }, () => ({ id: randomUUID(), personId: d.household![0].id, source: "Employment", amount: 1, frequency: "Daily", status: "received" })) };
    const s = await setup(d); await expect(get(s)).rejects.toMatchObject({ code: "42501" });
  });
  it("withdraws after all processing gates close, revoking root and child without restoring authority or facts", async () => {
    const s = await setup(), permission = await authorize(s), child = await packet(s, permission.acquisitionId);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false,approved_until=now()-interval '1 second',snap_details_enabled=false,snap_protected_enabled=false,snap_protected_policy_version=null,snap_protected_retention_policy_version=null");
    const before = await counts(s); await revoke(s, permission.acquisitionId); await revoke(s, permission.acquisitionId);
    expect((await fixture.admin.query("select bool_and(revoked_at is not null) revoked from parent_private.snap_final_packet_authorizations where id=$1 or acquisition_authorization_id=$1", [permission.acquisitionId])).rows[0].revoked).toBe(true);
    expect(await counts(s)).toEqual(before); await expect(get(s)).rejects.toMatchObject({ code: "42501" }); await expect(recover(s, child.intent.packetId)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select enabled,snap_details_enabled,snap_protected_enabled from parent_private.processing_controls")).rows[0]).toEqual({ enabled: false, snap_details_enabled: false, snap_protected_enabled: false });
  });
  it("stops linked packet staging through the existing unchanged finalizer guard after withdrawal", async () => {
    const s = await setup(), permission = await authorize(s), child = await packet(s, permission.acquisitionId); await revoke(s, permission.acquisitionId);
    await expect(asRole("parent_snap_finalizer", s.owner, "select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)", [child.intent.authorizationId, s.request, s.version, s.snapshot, s.hash, digest, 31, child.intent.packetId])).rejects.toMatchObject({ code: "42501" });
    await expect(get(s)).resolves.toMatchObject({ state: "permission_needed" });
  });
  it("does not require a live mandate or uncancelled request merely to withdraw", async () => {
    const s = await setup(), permission = await authorize(s); await parent(s, "select public.parent_control_request($1,'cancel')", [s.request]);
    await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [s.request]);
    await revoke(s, permission.acquisitionId); expect((await fixture.admin.query("select revoked_at is not null revoked from parent_private.snap_final_packet_authorizations where id=$1", [permission.acquisitionId])).rows[0].revoked).toBe(true);
  });
  it.each(["foreign_owner", "missing_session", "foreign_session", "expired_session", "unconfirmed", "anonymous", "banned", "inactive_account", "tombstone"])("denies withdrawal for %s even while processing is closed", async kind => {
    const s = await setup(), permission = await authorize(s), actor = { ...s };
    if (kind === "foreign_owner") actor.owner = (await setup()).owner;
    if (kind === "missing_session") sessions.set(s.owner, randomUUID());
    if (kind === "foreign_session") sessions.set(s.owner, sessions.get((await setup()).owner)!);
    if (kind === "expired_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sessions.get(s.owner)]);
    if (kind === "unconfirmed") await fixture.admin.query("update auth.users set email_confirmed_at=null where id=$1", [s.owner]);
    if (kind === "anonymous") await fixture.admin.query("update auth.users set is_anonymous=true where id=$1", [s.owner]);
    if (kind === "banned") await fixture.admin.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1", [s.owner]);
    if (kind === "inactive_account") await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [s.owner]);
    if (kind === "tombstone") await fixture.admin.query("insert into parent_private.deletion_tombstones(subject_hash) values(encode(sha256(convert_to('parent-account:'||$1::text,'UTF8')),'hex'))", [s.owner]);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    await expect(revoke(actor, permission.acquisitionId)).rejects.toMatchObject({ code: "42501" }); expect((await fixture.admin.query("select revoked_at from parent_private.snap_final_packet_authorizations where id=$1", [permission.acquisitionId])).rows[0].revoked_at).toBeNull();
  });
  it("keeps a signed-out parent's durable permission but requires a fresh live owned session for recovery", async () => {
    const s = await setup(), permission = await authorize(s), oldSession = sessions.get(s.owner)!;
    await fixture.admin.query("delete from auth.sessions where id=$1", [oldSession]); await expect(get(s)).rejects.toMatchObject({ code: "42501" });
    const nextSession = randomUUID(); sessions.set(s.owner, nextSession); await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at) values($1,$2,now(),now())", [nextSession, s.owner]);
    expect(await get(s)).toEqual(permission); expect((await fixture.admin.query("select authorization_session_id from parent_private.snap_final_packet_authorizations where id=$1", [permission.acquisitionId])).rows[0].authorization_session_id).toBe(oldSession);
  });
  it("preserves shared-account password-session protection for withdrawal without depending on cohort approval", async () => {
    const s = await setup(), permission = await authorize(s);
    await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,$2,'case_manager',true)", [s.owner, `${s.owner}@example.invalid`]);
    await fixture.admin.query("update parent_private.processing_controls set enabled=false,existing_accounts_enabled=false,approved_until=now()-interval '1 second'");
    await expect(revoke(s, permission.acquisitionId)).rejects.toMatchObject({ code: "42501" });
    await revoke(s, permission.acquisitionId, "password");
    expect((await fixture.admin.query("select revoked_at is not null revoked from parent_private.snap_final_packet_authorizations where id=$1", [permission.acquisitionId])).rows[0].revoked).toBe(true);
    expect((await fixture.admin.query("select id,is_active from public.app_users where id=$1", [s.owner])).rows[0]).toEqual({ id: s.owner, is_active: true });
  });
  it("does not let an owned withdrawal UUID select a foreign parent's grant or reveal whether it exists", async () => {
    const s = await setup(), other = await setup(), foreign = await authorize(other);
    await revoke(s, foreign.acquisitionId); await revoke(s, randomUUID());
    expect(await get(other)).toEqual(foreign); expect((await counts(s)).authorities).toBe(0);
  });
  it.each(["source", "provenance"])("denies stale or changed %s even with an otherwise valid original grant", async field => {
    const s = await setup(), permission = await authorize(s);
    await fixture.admin.query(`insert into public.parent_snap_application_details(request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key,confirmed_paths)
      select request_id,revision+1,base_version,request_version,details,
        ${field === "provenance" ? "(select jsonb_object_agg(key,value||jsonb_build_object('confirmedAt',now()-interval '46 days','asOf',to_char(now()-interval '46 days','YYYY-MM-DD'))) from jsonb_each(s.provenance))" : "provenance"},
        ${field === "source" ? "'{}'::jsonb" : "source"},notice_version,$2,confirmed_paths from public.parent_snap_application_details s where id=$1`, [s.snapshot, randomUUID()]);
    await expect(get(s)).rejects.toMatchObject({ code: "42501" }); await expect(packet(s, permission.acquisitionId)).rejects.toMatchObject({ code: "42501" });
  });
  it("never treats an expired grant as a fresh permission or renews it by replay", async () => {
    const s = await setup(), permission = await authorize(s), expired = randomUUID();
    await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,
      to_jsonb(a)||jsonb_build_object('id',$2::uuid,'consented_at',now()-interval '2 hours','created_at',now()-interval '2 hours','expires_at',now()-interval '1 hour'))).*
      from parent_private.snap_final_packet_authorizations a where id=$1`, [permission.acquisitionId, expired]);
    await revoke(s, permission.acquisitionId);
    expect(await get(s)).toMatchObject({ state: "permission_needed", acquisitionId: null });
    await expect(authorize(s, { id: expired })).rejects.toMatchObject({ code: "42501" });
    await expect(packet(s, expired)).rejects.toMatchObject({ code: "42501" });
    await expect(authorize(s, { id: permission.acquisitionId })).rejects.toMatchObject({ code: "42501" });
  });
  it("rejects a new packet when the existing bounded per-request write budget is exhausted", async () => {
    const s = await setup(), permission = await authorize(s);
    await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,
      to_jsonb(a)||jsonb_build_object('id',gen_random_uuid()))).* from parent_private.snap_final_packet_authorizations a cross join generate_series(1,19) where a.id=$1`, [permission.acquisitionId]);
    await expect(packet(s, permission.acquisitionId)).rejects.toMatchObject({ code: "23514" }); expect((await counts(s)).authorities).toBe(20);
    expect(await authorize(s, { id: permission.acquisitionId })).toEqual(permission);
  });
  it.each(["anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("does not expose acquisition or withdrawal RPCs to %s", async role => {
    const s = await setup();
    await expect(asRole(role, s.owner, "select public.parent_get_snap_direct_acquisition($1,$2,$3,$4)", [s.request, s.version, s.snapshot, s.hash])).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, s.owner, "select public.parent_revoke_snap_direct_acquisition($1,$2)", [s.request, randomUUID()])).rejects.toMatchObject({ code: "42501" });
  });
  it("does not expose raw private authorities/helper to the parent or repurpose legacy NULL intents", async () => {
    const s = await setup(), permission = await authorize(s);
    await expect(parent(s, "select * from parent_private.snap_final_packet_authorizations")).rejects.toMatchObject({ code: "42501" });
    await expect(parent(s, "select parent_private.snap_direct_acquisition_authority($1,$2,$3,$4,$5)", [permission.acquisitionId, s.request, s.version, s.snapshot, s.hash])).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,
      to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'authorization_kind','packet','authorization_session_id',null,'authority_declaration',null))).* from parent_private.snap_final_packet_authorizations a where id=$1`, [permission.acquisitionId]);
    const legacy = (await fixture.admin.query("select id from parent_private.snap_final_packet_authorizations where request_id=$1 and authorization_kind='packet'", [s.request])).rows[0].id as string;
    await expect(packet(s, legacy)).rejects.toMatchObject({ code: "42501" }); expect(await get(s)).toEqual(permission);
  });
  it.each(["authority_declaration", "authorization_session_id", "authorization_kind"])("rejects a partially NULL %s direct-entry authority", async field => {
    const s = await setup(), permission = await authorize(s);
    await expect(fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||$2::jsonb)).* from parent_private.snap_final_packet_authorizations a where id=$1`, [permission.acquisitionId, JSON.stringify({ id: randomUUID(), [field]: null })])).rejects.toMatchObject({ code: field === "authorization_kind" ? "23502" : "23514" });
  });
  it.each(["authorization_kind", "acquisition_authorization_id"])("does not permit changing immutable %s after consent", async field => {
    const s = await setup(), permission = await authorize(s);
    await expect(fixture.admin.query(`update parent_private.snap_final_packet_authorizations set ${field}=$2 where id=$1`, [permission.acquisitionId, field === "authorization_kind" ? "packet" : randomUUID()])).rejects.toMatchObject({ code: "23514" });
    expect(await get(s)).toEqual(permission);
  });
  it("grants only the five owned public RPCs to authenticated and leaves the private helper unavailable", async () => {
    expect((await fixture.admin.query("select to_regprocedure('public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean)') old")).rows[0].old).toBeNull();
    const functions = ["public.parent_get_snap_direct_acquisition(uuid,integer,uuid,text)", "public.parent_authorize_snap_direct_acquisition(uuid,integer,uuid,text,uuid,text,text,uuid[],boolean,timestamptz)", "public.parent_revoke_snap_direct_acquisition(uuid,uuid)", "public.parent_get_snap_direct_packet_authorization(uuid,uuid,integer)", "public.parent_authorize_snap_direct_packet(uuid,integer,uuid,text,uuid,text,integer,uuid)"];
    for (const fn of functions) for (const role of ["authenticated", "anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"]) {
      expect((await fixture.admin.query("select has_function_privilege($1,$2,'execute') allowed", [role, fn])).rows[0].allowed).toBe(role === "authenticated");
    }
    for (const role of ["authenticated", "anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"]) {
      expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.snap_direct_acquisition_authority(uuid,uuid,integer,uuid,text)','execute') allowed", [role])).rows[0].allowed).toBe(false);
    }
  });
});
