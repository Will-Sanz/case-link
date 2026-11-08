import { createHash } from "node:crypto";
import { Client, type QueryResult } from "pg";
import { z } from "zod";
import { openSnapFinalPacket, sealSnapFinalPacket, snapFinalPacketAad, snapFinalPacketBindingSchema, type SnapFinalPacketBinding } from "./snap-final-packet";
import { snapFinalizerIntentSchema, type SnapFinalizerIntent } from "./snap-packet-contract";
import { snapCaptureContextSchema } from "./snap-capture-context";
import { snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { renderSnapDirectCompletion, SNAP_DIRECT_COMPLETION_VERSION } from "./snap-direct-completion";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
export { snapFinalizerIntentSchema, type SnapFinalizerIntent } from "./snap-packet-contract";

export const SNAP_FINALIZER_ERROR = "The protected SNAP packet could not be verified or stored.";
export type SnapFinalizerOptions = { connectionString: string; deadline: Date; signal?: AbortSignal };
export type SnapFinalizerResult = { state: "stored"; binding: SnapFinalPacketBinding } | { state: "commit_unknown"; intent: SnapFinalizerIntent };
const timestamp = snapFinalPacketBindingSchema.shape.expiresAt;
const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const directContextReply = z.object({ intent: snapFinalizerIntentSchema, context: snapCaptureContextSchema,
  snapshot: snapApplicationSnapshotSchema, preparedAt: timestamp, state: z.enum(["authorized", "stored"]) }).strict();
const constructionSchema = z.object({
  verificationId: uuid, packetId: uuid, snapshotId: uuid, snapshotHash: hash, contentSha256: hash,
  validatorVersion: z.literal(SNAP_DIRECT_COMPLETION_VERSION), source: snapCaptureContextSchema.shape.source,
  requiredPersonalActs: z.tuple([z.literal(SNAP_PARENT_CERTIFICATION_ACTS[0]), z.literal(SNAP_PARENT_CERTIFICATION_ACTS[1])]),
  verifiedAt: timestamp, expiresAt: timestamp,
}).strict();
export type SnapDirectConstruction = z.infer<typeof constructionSchema>;
export type SnapDirectFinalizerResult = { state: "stored"; binding: SnapFinalPacketBinding; construction: SnapDirectConstruction }
  | { state: "commit_unknown"; intent: SnapFinalizerIntent };

const principalSchema = z.object({
  rolname: z.string(), rolcanlogin: z.literal(true), rolinherit: z.literal(false), rolsuper: z.literal(false), rolbypassrls: z.literal(false),
  rolcreaterole: z.literal(false), rolcreatedb: z.literal(false), rolreplication: z.literal(false), current_role: z.string(),
  member: z.literal(true), can_set: z.literal(true), admin_option: z.literal(false), broader_membership: z.literal(false), group_membership: z.literal(false),
  group_login: z.literal(false), group_inherit: z.literal(false), group_super: z.literal(false), group_bypassrls: z.literal(false),
  group_createrole: z.literal(false), group_createdb: z.literal(false), group_replication: z.literal(false),
}).strict();
const principalSql = `select r.rolname,r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,current_user::text current_role,
  pg_has_role(session_user,g.oid,'MEMBER') member,pg_has_role(session_user,g.oid,'SET') can_set,
  exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid=g.oid and m.admin_option) admin_option,
  exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid<>g.oid) broader_membership,
  exists(select 1 from pg_auth_members m where m.member=g.oid) group_membership,
  g.rolcanlogin group_login,g.rolinherit group_inherit,g.rolsuper group_super,g.rolbypassrls group_bypassrls,g.rolcreaterole group_createrole,g.rolcreatedb group_createdb,g.rolreplication group_replication
  from pg_roles r cross join pg_roles g where r.rolname=session_user and g.rolname='parent_snap_finalizer'`;

export function validateSnapFinalizerConnection(value: string) {
  const url = new URL(value), local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password || url.pathname !== "/postgres" || url.hash
    || [...url.searchParams.keys()].some(key => !["sslmode", "sslrootcert"].includes(key) || url.searchParams.getAll(key).length !== 1)
    || (local ? url.port !== "55322" || (url.search && url.search !== "?sslmode=disable")
      : !/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname) || !["", "5432"].includes(url.port) || url.searchParams.get("sslmode") !== "verify-full")) throw new Error(SNAP_FINALIZER_ERROR);
  const login = decodeURIComponent(url.username);
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(login) || ["postgres", "service_role", "supabase_admin", "authenticator", "parent_snap_finalizer"].includes(login)) throw new Error(SNAP_FINALIZER_ERROR);
  return { login, local };
}
function onlyRow(result: QueryResult<Record<string, unknown>>) {
  if (result.rows.length !== 1) throw new Error(SNAP_FINALIZER_ERROR);
  return result.rows[0];
}
type Session = { query(text: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  run<T>(start: () => Promise<T>): Promise<T>; check(): void; rollback(): Promise<void> };
async function withFinalizer<T>(options: SnapFinalizerOptions, action: (session: Session) => Promise<T>): Promise<T> {
  const until = options.deadline instanceof Date ? options.deadline.getTime() : NaN, remaining = until - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 30_000 || options.signal?.aborted) throw new Error(SNAP_FINALIZER_ERROR);
  const target = validateSnapFinalizerConnection(options.connectionString);
  const client = new Client({ connectionString: options.connectionString, ssl: target.local ? false : { rejectUnauthorized: true },
    application_name: "caselink-snap-finalizer", connectionTimeoutMillis: Math.min(3_000, remaining), query_timeout: Math.min(5_000, remaining),
    statement_timeout: Math.min(5_000, remaining), options: `-c lock_timeout=${Math.min(2_000, remaining)} -c idle_in_transaction_session_timeout=${Math.min(10_000, remaining)}` });
  let stopped = false, closed = false, rejectStop!: (error: Error) => void;
  const close = () => {
    if (closed) return; closed = true;
    // This one-operation connection is never pooled; destroying it also rolls back an interrupted transaction.
    client.connection.stream.destroy();
    try { void client.end().catch(() => {}); } catch {}
  };
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  void stop.catch(() => {});
  const abort = () => { if (stopped) return; stopped = true; rejectStop(new Error(SNAP_FINALIZER_ERROR)); close(); };
  const check = () => { if (stopped || options.signal?.aborted || Date.now() >= until) throw new Error(SNAP_FINALIZER_ERROR); };
  const run = <V>(start: () => Promise<V>) => { check(); return Promise.race([start(), stop]); };
  const query: Session["query"] = (text, values) => run(() => client.query<Record<string, unknown>>(text, values));
  client.on("error", abort);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, remaining);
  try {
    await run(() => client.connect());
    const principal = principalSchema.parse(onlyRow(await query(principalSql)));
    if (principal.rolname !== target.login || principal.current_role !== target.login) throw new Error(SNAP_FINALIZER_ERROR);
    await query("set role parent_snap_finalizer");
    z.object({ role: z.literal("parent_snap_finalizer"), principal: z.literal(target.login) }).strict().parse(onlyRow(await query("select current_user::text role,session_user::text principal")));
    return await action({ query, run, check, async rollback() { try { await query("rollback"); } catch {} } });
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    close();
  }
}

function decoded(value: unknown, expectedBytes: number) {
  if (typeof value !== "string" || value.length > Math.ceil(expectedBytes / 3) * 4 + Math.ceil(expectedBytes / 57) || !/^[A-Za-z0-9+/=\n]+$/.test(value)) throw new Error(SNAP_FINALIZER_ERROR);
  const compact = value.replaceAll("\n", ""), bytes = Buffer.from(compact, "base64");
  if (bytes.length !== expectedBytes || bytes.toString("base64") !== compact) { bytes.fill(0); throw new Error(SNAP_FINALIZER_ERROR); }
  return bytes;
}
function validateBinding(value: unknown, intent: SnapFinalizerIntent, session: Session) {
  session.check();
  const binding = snapFinalPacketBindingSchema.parse(value);
  if (Object.keys(intent).some(key => binding[key as keyof SnapFinalizerIntent] !== intent[key as keyof SnapFinalizerIntent]) || Date.parse(binding.expiresAt) <= Date.now()) throw new Error(SNAP_FINALIZER_ERROR);
  return binding;
}
const beginReply = z.object({ binding: z.unknown(), aad: z.unknown(), keyBase64: z.unknown() }).strict();
const readReply = beginReply.extend({ iv: z.unknown(), tag: z.unknown(), ciphertext: z.unknown() }).strict();
function validateAad(value: unknown, binding: SnapFinalPacketBinding) {
  const expected = Buffer.from(snapFinalPacketAad(binding)), actual = decoded(value, expected.length);
  if (!expected.equals(actual)) throw new Error(SNAP_FINALIZER_ERROR);
}

/** Persist the metadata-only intent first. This never generates an intent or stores plaintext/a key. */
export async function stageSnapFinalPacket(input: unknown, bytes: Uint8Array, options: SnapFinalizerOptions): Promise<SnapFinalizerResult> {
  let copy: Buffer | undefined, key: Buffer | undefined;
  try {
    const intent = snapFinalizerIntentSchema.parse(input);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== intent.byteLength) throw new Error(SNAP_FINALIZER_ERROR);
    copy = Buffer.from(bytes);
    if (createHash("sha256").update(copy).digest("hex") !== intent.contentSha256) throw new Error(SNAP_FINALIZER_ERROR);
    return await withFinalizer<SnapFinalizerResult>(options, async session => {
      let transaction = false, commitDispatched = false;
      try {
        await session.query("begin"); transaction = true;
        const reply = beginReply.parse(onlyRow(await session.query("select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8) value",
          [intent.authorizationId,intent.requestId,intent.requestVersion,intent.snapshotId,intent.snapshotHash,intent.contentSha256,intent.byteLength,intent.packetId])).value);
        const binding = validateBinding(reply.binding, intent, session); validateAad(reply.aad, binding); key = decoded(reply.keyBase64, 32);
        const packet = sealSnapFinalPacket(copy!, key, binding, new Date());
        const sealed = validateBinding(onlyRow(await session.query("select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,$5,$6,$7) value",
          [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId,packet.iv,packet.tag,packet.ciphertext])).value, intent, session);
        if (JSON.stringify(sealed) !== JSON.stringify(binding)) throw new Error(SNAP_FINALIZER_ERROR);
        session.check(); commitDispatched = true;
        await session.query("commit"); transaction = false;
        return { state: "stored", binding };
      } catch {
        if (commitDispatched) return { state: "commit_unknown", intent };
        if (transaction) await session.rollback();
        throw new Error(SNAP_FINALIZER_ERROR);
      }
    });
  } catch { throw new Error(SNAP_FINALIZER_ERROR); }
  finally { key?.fill(0); copy?.fill(0); }
}

async function readPacketInSession(intent: SnapFinalizerIntent, session: Session) {
    let key: Buffer | undefined, bytes: Uint8Array | undefined;
    try {
      const reply = readReply.parse(onlyRow(await session.query("select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6) value",
        [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId,intent.snapshotId,intent.snapshotHash])).value);
      const binding = validateBinding(reply.binding, intent, session); validateAad(reply.aad, binding); key = decoded(reply.keyBase64, 32);
      bytes = openSnapFinalPacket({ binding, iv: decoded(reply.iv, 12), tag: decoded(reply.tag, 16), ciphertext: decoded(reply.ciphertext, binding.byteLength) }, key, new Date());
      session.check(); if (Date.parse(binding.expiresAt) <= Date.now()) throw new Error(SNAP_FINALIZER_ERROR);
      return { binding, bytes };
    } catch { bytes?.fill(0); throw new Error(SNAP_FINALIZER_ERROR); }
    finally { key?.fill(0); }
}
async function readPacket(intent: SnapFinalizerIntent, options: SnapFinalizerOptions) {
  return withFinalizer(options, session => readPacketInSession(intent, session));
}
/** After an unknown COMMIT/restart, read only. Never begin, reseal, resend or infer absence from a denied read. */
export async function reconcileSnapFinalPacket(input: unknown, options: SnapFinalizerOptions): Promise<SnapFinalizerResult> {
  let intent: SnapFinalizerIntent;
  try { intent = snapFinalizerIntentSchema.parse(input); } catch { throw new Error(SNAP_FINALIZER_ERROR); }
  try {
    const { binding, bytes } = await readPacket(intent, options); bytes.fill(0);
    return { state: "stored", binding };
  } catch { return { state: "commit_unknown", intent }; }
}

/** Only the isolated protected-review service may receive these bytes; the ordinary worker receives metadata. */
export async function openSnapFinalPacketForIsolatedReview(input: unknown, options: SnapFinalizerOptions): Promise<{ binding: SnapFinalPacketBinding; bytes: Uint8Array }> {
  try { return await readPacket(snapFinalizerIntentSchema.parse(input), options); }
  catch { throw new Error(SNAP_FINALIZER_ERROR); }
}

function validateConstruction(value: unknown, intent: SnapFinalizerIntent, binding: SnapFinalPacketBinding, session: Session) {
  session.check();
  const construction = constructionSchema.parse(value);
  if (construction.packetId !== intent.packetId || construction.snapshotId !== intent.snapshotId || construction.snapshotHash !== intent.snapshotHash
    || construction.contentSha256 !== intent.contentSha256 || Date.parse(construction.verifiedAt) > Date.now()
    || Date.parse(construction.expiresAt) <= Date.now() || Date.parse(construction.expiresAt) <= Date.parse(construction.verifiedAt)
    || Date.parse(construction.expiresAt) > Date.parse(binding.expiresAt)) throw new Error(SNAP_FINALIZER_ERROR);
  return construction;
}
async function readConstruction(intent: SnapFinalizerIntent, binding: SnapFinalPacketBinding, session: Session) {
  return validateConstruction(onlyRow(await session.query("select parent_private.parent_read_snap_direct_construction($1,$2,$3,$4) value",
    [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId])).value, intent, binding, session);
}

async function directOperation(intent: SnapFinalizerIntent, construction: SnapDirectConstruction, session: Session, fresh = false) {
  const command = fresh ? "parent_finish_snap_direct_completion" : "parent_read_snap_direct_operation";
  uuid.parse(onlyRow(await session.query(`select parent_private.${command}($1,$2,$3,$4,$5) value`,
    [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId,construction.verificationId])).value);
  session.check();
}

async function directContext(intent: SnapFinalizerIntent, session: Session) {
  const context = directContextReply.parse(onlyRow(await session.query("select parent_private.parent_get_snap_direct_context($1,$2,$3,$4,$5,$6,$7,$8) value",
    [intent.authorizationId,intent.requestId,intent.requestVersion,intent.snapshotId,intent.snapshotHash,intent.contentSha256,intent.byteLength,intent.packetId])).value);
  const preparedAt = new Date(context.snapshot.created_at);
  if (Object.entries(intent).some(([name, value]) => context.intent[name as keyof SnapFinalizerIntent] !== value)
    || context.context.requestVersion !== intent.requestVersion || context.context.snapshotId !== intent.snapshotId || context.context.snapshotHash !== intent.snapshotHash
    || context.snapshot.request_id.toLowerCase() !== intent.requestId || context.snapshot.id.toLowerCase() !== intent.snapshotId
    || !Number.isFinite(preparedAt.getTime()) || context.preparedAt !== preparedAt.toISOString() || preparedAt.getTime() > Date.now()) throw new Error(SNAP_FINALIZER_ERROR);
  return context;
}

/** Regenerate from DB-owned facts; only encrypted bytes and construction metadata enter SQL, never private entries. */
export async function finalizeSnapDirectCompletion(input: unknown, completionInput: unknown, template: Uint8Array, options: SnapFinalizerOptions): Promise<SnapDirectFinalizerResult> {
  let source: Uint8Array | undefined, bytes: Uint8Array | undefined, key: Buffer | undefined, discard = false;
  try {
    const intent = snapFinalizerIntentSchema.parse(input), completion = structuredClone(completionInput);
    if (!(template instanceof Uint8Array) || template.length !== SNAP_DRAFT_CONTRACT.byteLength) throw new Error(SNAP_FINALIZER_ERROR);
    source = Uint8Array.from(template);
    return await withFinalizer<SnapDirectFinalizerResult>(options, async session => {
      let transaction = false, commitDispatched = false;
      try {
        await session.query("begin"); transaction = true;
        const context = await directContext(intent, session);
        // The expected unsigned hash is a claim; the server renderer independently regenerates and compares it.
        const expected = z.object({ unsignedContentSha256: hash }).passthrough().parse(completion).unsignedContentSha256;
        const rendering = renderSnapDirectCompletion(source!, { requestId: intent.requestId, context: context.context, snapshot: context.snapshot,
          preparedAt: context.preparedAt, unsignedContentSha256: expected }, completion, new Date()).then(result => {
          if (discard) result.bytes?.fill(0); else bytes = result.bytes ?? undefined;
          return result;
        });
        const rendered = await session.run(() => rendering); session.check();
        if (!rendered.bytes || rendered.contentSha256 !== intent.contentSha256 || rendered.byteLength !== intent.byteLength
          || rendered.bytes.length !== intent.byteLength || createHash("sha256").update(rendered.bytes).digest("hex") !== intent.contentSha256) throw new Error(SNAP_FINALIZER_ERROR);
        if (context.state === "stored") {
          const opened = await readPacketInSession(intent, session);
          try {
            const construction = await readConstruction(intent, opened.binding, session);
            await directOperation(intent, construction, session);
            await session.rollback(); transaction = false; session.check();
            return { state: "stored", binding: opened.binding, construction };
          } finally { opened.bytes.fill(0); }
        }
        const reply = beginReply.parse(onlyRow(await session.query("select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8) value",
          [intent.authorizationId,intent.requestId,intent.requestVersion,intent.snapshotId,intent.snapshotHash,intent.contentSha256,intent.byteLength,intent.packetId])).value);
        const binding = validateBinding(reply.binding, intent, session); validateAad(reply.aad, binding); key = decoded(reply.keyBase64, 32);
        const packet = sealSnapFinalPacket(rendered.bytes, key, binding, new Date());
        const sealed = validateBinding(onlyRow(await session.query("select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,$5,$6,$7) value",
          [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId,packet.iv,packet.tag,packet.ciphertext])).value, intent, session);
        if (JSON.stringify(sealed) !== JSON.stringify(binding)) throw new Error(SNAP_FINALIZER_ERROR);
        const construction = validateConstruction(onlyRow(await session.query("select parent_private.parent_record_snap_direct_construction($1,$2,$3,$4) value",
          [intent.packetId,intent.requestId,intent.requestVersion,intent.authorizationId])).value, intent, binding, session);
        await directOperation(intent, construction, session, true);
        session.check(); commitDispatched = true;
        await session.query("commit"); transaction = false;
        return { state: "stored", binding, construction };
      } catch {
        if (commitDispatched) return { state: "commit_unknown", intent };
        if (transaction) await session.rollback();
        throw new Error(SNAP_FINALIZER_ERROR);
      }
    });
  } catch { throw new Error(SNAP_FINALIZER_ERROR); }
  finally { discard = true; source?.fill(0); bytes?.fill(0); key?.fill(0); }
}

/** Unknown COMMIT recovery proves both authenticated packet bytes and immutable construction evidence; it never repairs or reseals. */
export async function reconcileSnapDirectCompletion(input: unknown, options: SnapFinalizerOptions): Promise<SnapDirectFinalizerResult> {
  let intent: SnapFinalizerIntent;
  try { intent = snapFinalizerIntentSchema.parse(input); } catch { throw new Error(SNAP_FINALIZER_ERROR); }
  try {
    return await withFinalizer(options, async session => {
      await directContext(intent, session);
      const { binding, bytes } = await readPacketInSession(intent, session);
      try {
        const construction = await readConstruction(intent, binding, session);
        await directOperation(intent, construction, session);
        return { state: "stored" as const, binding, construction };
      } finally { bytes.fill(0); }
    });
  } catch { return { state: "commit_unknown", intent }; }
}
