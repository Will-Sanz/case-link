import { Client, type QueryResult } from "pg";
import { z } from "zod";
import { openUtilityProtectedInput, sealUtilityProtectedInput, utilityProtectedContentDigest, utilityProtectedAccountFingerprint, UTILITY_PROTECTED_INPUT_ERROR } from "./utility-protected-input";
import { utilityProtectedBindingSchema, utilityProtectedInputAad, utilityProtectedInputReferenceSchema, utilityProtectedScalarSchema, utilityProtectedScopeSchema, type UtilityProtectedBinding, type UtilityProtectedScope } from "./utility-protected-input-contract";
import { utilityIncomeProofProjectionSchema, type UtilityIncomeProofProjection } from "./utility-income-proof";

export type UtilityProtectedOptions = { connectionString: string; deadline: Date; signal?: AbortSignal;
  job?: { jobId: string; leaseToken: string; requestId: string; requestVersion: number } };
const unavailable = () => new Error(UTILITY_PROTECTED_INPUT_ERROR);
const uuid = z.uuid(), timestamp = z.iso.datetime({ offset: true });
export const utilityProtectedContextSchema = z.object({ ownerId: uuid, householdId: uuid, accountAuthority: z.enum(["self", "authorized_caregiver"]), grantExpiresAt: timestamp,
  requestId: uuid, requestVersion: z.number().int().positive(),
  programId: z.enum(["peco-cap", "pgw-crp", "pwd-tap"]), need: z.enum(["electricity", "gas", "water"]),
  mandate: z.record(z.string(), z.unknown()), snapshot: z.object({ id: uuid, request_id: uuid, revision: z.number().int().positive(),
    details: z.record(z.string(), z.unknown()), source: z.record(z.string(), z.unknown()), consent_evidence: z.record(z.string(), z.unknown()),
  }).passthrough(), sourceExpiresAt: timestamp, approvalExpiresAt: timestamp,
}).passthrough();
export type UtilityProtectedApplicationContext = z.infer<typeof utilityProtectedContextSchema>;
type Session = { query(sql: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>; check(): void; job?: NonNullable<UtilityProtectedOptions["job"]> };
export type UtilityProtectedDatabaseSession = Session;
function row(reply: QueryResult<Record<string, unknown>>): unknown { if (reply.rows.length !== 1) throw unavailable(); return reply.rows[0].value; }

export function validateUtilityProtectedConnection(value: string) {
  try {
    const url = new URL(value), local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), login = decodeURIComponent(url.username);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^[a-z][a-z0-9_]{0,62}$/.test(login) ||
      ["postgres", "service_role", "supabase_admin", "authenticator", "parent_utility_protected"].includes(login) || !url.password || url.pathname !== "/postgres" || url.hash ||
      [...url.searchParams.keys()].some(key => !["sslmode", "sslrootcert"].includes(key) || url.searchParams.getAll(key).length !== 1) ||
      (local ? url.port !== "55322" || (url.search && url.search !== "?sslmode=disable") :
        !/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname) || !["", "5432"].includes(url.port) || url.searchParams.get("sslmode") !== "verify-full")) throw unavailable();
    return { login, local };
  } catch { throw unavailable(); }
}
const principalSchema = z.object({ login: z.string(), role: z.string(), safe: z.literal(true) }).strict();
const principalSql = `select session_user::text login,current_user::text role,
  (not r.rolinherit and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
    and not g.rolcanlogin and not g.rolinherit and not g.rolsuper and not g.rolbypassrls and not g.rolcreaterole and not g.rolcreatedb and not g.rolreplication
    and pg_has_role(session_user,g.oid,'MEMBER') and pg_has_role(session_user,g.oid,'SET')
    and not exists(select 1 from pg_auth_members m where (m.member=r.oid and (m.roleid<>g.oid or m.admin_option)) or m.member=g.oid)) safe
  from pg_roles r cross join pg_roles g where r.rolname=session_user and g.rolname='parent_utility_protected'`;
/** Separate short-lived utility-only connection. No pool or parent JWT is retained. */
async function withUtility<T>(options: UtilityProtectedOptions, action: (session: Session) => Promise<T>): Promise<T> {
  const job = options.job ? privateJobSchema.parse(structuredClone(options.job)) : undefined;
  const until = options.deadline instanceof Date ? options.deadline.getTime() : NaN, remaining = until - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 30_000 || options.signal?.aborted) throw unavailable();
  const target = validateUtilityProtectedConnection(options.connectionString);
  const client = new Client({ connectionString: options.connectionString, ssl: target.local ? false : { rejectUnauthorized: true },
    application_name: "caselink-utility-protected", connectionTimeoutMillis: Math.min(3000, remaining), query_timeout: Math.min(5000, remaining),
    statement_timeout: Math.min(5000, remaining), options: `-c lock_timeout=${Math.min(2000, remaining)} -c idle_in_transaction_session_timeout=${Math.min(10000, remaining)}` });
  let stopped = false, closed = false, rejectStop!: (error: Error) => void;
  const close = () => { if (closed) return; closed = true; client.connection.stream.destroy(); try { void client.end().catch(() => {}); } catch {} };
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; }); void stop.catch(() => {});
  const abort = () => { if (stopped) return; stopped = true; rejectStop(unavailable()); close(); };
  const check = () => { if (stopped || options.signal?.aborted || Date.now() >= until) throw unavailable(); };
  const run = <V>(start: () => Promise<V>) => { check(); return Promise.race([start(), stop]); };
  const query: Session["query"] = async (sql, values) => { const value = await run(() => client.query<Record<string, unknown>>(sql, values)); check(); return value; };
  client.on("error", abort); options.signal?.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, remaining);
  try {
    await run(() => client.connect());
    const result = await query(principalSql); if (result.rows.length !== 1) throw unavailable();
    const principal = principalSchema.parse(result.rows[0]); if (principal.login !== target.login || principal.role !== target.login) throw unavailable();
    await query("set role parent_utility_protected");
    const role = await query("select current_user::text role,session_user::text login");
    if (role.rows.length !== 1 || role.rows[0].role !== "parent_utility_protected" || role.rows[0].login !== target.login) throw unavailable();
    return await action({ query, check, job });
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); close(); }
}
// Shared only by the two actual isolated utility clients (captured inputs and prepared artifacts).
export { withUtility as withUtilityProtectedDatabase };
const privateJobSchema = z.object({ jobId: uuid, leaseToken: uuid, requestId: uuid, requestVersion: z.number().int().positive() }).strict();
async function checkPrivateJob(session: Session, inputId?: string) {
  const job = session.job; if (!job) return;
  await session.query(inputId ? "select parent_private.parent_check_utility_input_job($1,$2,$3,$4,$5)" : "select parent_private.parent_check_utility_reuse_job($1,$2,$3,$4)",
    [job.jobId, job.leaseToken, job.requestId, job.requestVersion, ...(inputId ? [inputId] : [])]);
}
async function withJobAuthority<T>(session: Session, action: () => Promise<T>, inputId?: string): Promise<T> {
  if (!session.job) return action();
  let result: T | undefined;
  await session.query("begin");
  try { await checkPrivateJob(session, inputId); result = await action(); await checkPrivateJob(session, inputId); session.check(); await session.query("commit"); return result; }
  catch { if (result instanceof Uint8Array) result.fill(0); try { await session.query("rollback"); } catch {} throw unavailable(); }
}
function checkJobScope(options: UtilityProtectedOptions, scope: UtilityProtectedScope) {
  if (!options.job) return;
  const job = privateJobSchema.parse(structuredClone(options.job));
  if (job.requestId !== scope.requestId || job.requestVersion !== scope.expectedVersion) throw unavailable();
}
function decode(value: unknown, length: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(length / 3) * 4 + Math.ceil(length / 57) || !/^[A-Za-z0-9+/=\n]+$/.test(value)) throw unavailable();
  const compact = value.replaceAll("\n", ""), bytes = Buffer.from(compact, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== compact) { bytes.fill(0); throw unavailable(); } return bytes;
}
export { decode as decodeUtilityProtectedBase64 };
function inputBinding(input: unknown, inputId: string, session: Session): UtilityProtectedBinding {
  session.check(); const binding = utilityProtectedBindingSchema.parse(input);
  if (binding.inputId !== inputId || Date.parse(binding.expiresAt) <= Date.now()) throw unavailable(); return binding;
}
function scopeArguments(scope: UtilityProtectedScope) { return [scope.requestId, scope.expectedVersion, scope.programId, scope.snapshotId, scope.snapshotRevision, scope.snapshotHash]; }
function contextMatches(context: UtilityProtectedApplicationContext, scope: UtilityProtectedScope) {
  if (context.requestId !== scope.requestId || context.requestVersion !== scope.expectedVersion || context.programId !== scope.programId || context.snapshot.id !== scope.snapshotId ||
    context.snapshot.revision !== scope.snapshotRevision || context.snapshot.request_id !== scope.requestId || context.snapshot.consent_evidence.detailsSha256 !== scope.snapshotHash ||
    Date.parse(context.sourceExpiresAt) <= Date.now() || Date.parse(context.approvalExpiresAt) <= Date.now()) throw unavailable();
}
async function currentContext(session: Session, scope: UtilityProtectedScope) {
  const context = utilityProtectedContextSchema.parse(row(await session.query("select parent_private.parent_get_utility_protected_context($1,$2,$3,$4,$5,$6) value", scopeArguments(scope))));
  contextMatches(context, scope); return context;
}
export async function getUtilityProtectedApplicationContext(input: unknown, options: UtilityProtectedOptions): Promise<UtilityProtectedApplicationContext> {
  const scope = utilityProtectedScopeSchema.parse(input); checkJobScope(options, scope);
  return withUtility(options, session => withJobAuthority(session, () => currentContext(session, scope)));
}
export async function listUtilityProtectedInputs(input: unknown, options: UtilityProtectedOptions) {
  const scope = utilityProtectedScopeSchema.parse(input); checkJobScope(options, scope);
  return withUtility(options, session => withJobAuthority(session, async () => {
    const refs = z.array(utilityProtectedInputReferenceSchema).max(256).parse(row(await session.query("select parent_private.parent_list_utility_protected_inputs($1,$2,$3,$4,$5,$6) value", scopeArguments(scope))));
    if (refs.some(ref => ref.requestId !== scope.requestId || ref.requestVersion !== scope.expectedVersion || ref.programId !== scope.programId || ref.snapshotId !== scope.snapshotId ||
      ref.snapshotRevision !== scope.snapshotRevision || ref.snapshotHash !== scope.snapshotHash || ref.state !== "stored" || Date.parse(ref.expiresAt) <= Date.now())) throw unavailable();
    return refs;
  }));
}

export type UtilityProtectedStoreResult = { state: "stored"; reference: z.infer<typeof utilityProtectedInputReferenceSchema> } | { state: "commit_unknown"; inputId: string };
async function writeInput(session: Session, inputId: string, bytes: Uint8Array) {
  let key: Buffer | undefined;
  try {
        const start = z.object({ binding: z.record(z.string(), z.unknown()), keyBase64: z.unknown(), state: z.enum(["pending", "stored"]), iv: z.unknown(), tag: z.unknown(), ciphertext: z.unknown() }).strict()
          .parse(row(await session.query("select parent_private.parent_begin_utility_protected_input($1) value", [inputId])));
        await checkPrivateJob(session, inputId);
        key = decode(start.keyBase64, 32);
        const binding = inputBinding({ ...start.binding, contentDigest: utilityProtectedContentDigest(bytes, key) }, inputId, session);
        if (start.state === "stored") {
          if (start.binding.contentDigest !== binding.contentDigest) throw unavailable();
          const opened = openUtilityProtectedInput({ binding, iv: decode(start.iv, 12), tag: decode(start.tag, 16), ciphertext: decode(start.ciphertext, binding.byteLength) }, key, new Date());
          try { if (!Buffer.from(opened).equals(bytes)) throw unavailable(); } finally { opened.fill(0); }
        } else {
          const sealed = sealUtilityProtectedInput(bytes, key, binding, new Date());
          const saved = inputBinding(row(await session.query("select parent_private.parent_seal_utility_protected_input($1,$2,$3,$4,$5) value", [inputId, binding.contentDigest, sealed.iv, sealed.tag, sealed.ciphertext])), inputId, session);
          if (JSON.stringify(saved) !== JSON.stringify(binding)) throw unavailable();
        }
        if (binding.purpose === "account_access") {
          const scalar = utilityProtectedScalarSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          if (scalar.purpose !== "account_access") throw unavailable();
          const match = z.object({ keyId: uuid, keyBase64: z.unknown(), ownerId: uuid, programId: z.literal("pwd-tap"), expiresAt: timestamp }).strict()
            .parse(row(await session.query("select parent_private.parent_begin_utility_account_match($1) value", [inputId])));
          await checkPrivateJob(session, inputId);
          if (match.ownerId !== binding.ownerId || match.programId !== binding.programId || Date.parse(match.expiresAt) <= Date.now()) throw unavailable();
          const matchKey = decode(match.keyBase64, 32);
          try {
            const fingerprint = utilityProtectedAccountFingerprint(matchKey, binding.ownerId, binding.programId, JSON.stringify([scalar.accessCode, scalar.zip]));
            uuid.parse(row(await session.query("select parent_private.parent_bind_utility_account($1,$2,$3) value", [inputId, match.keyId, fingerprint])));
          } finally { matchKey.fill(0); }
        }
        // SQL rechecks current controls/owner/scope on this final read in the same transaction.
        const check = z.object({ reference: utilityProtectedInputReferenceSchema }).passthrough().parse(row(await session.query("select parent_private.parent_check_utility_protected_input($1,false) value", [inputId])));
    return check.reference;
  } finally { key?.fill(0); }
}

/** Authorization is recorded separately before upload. Exact retry reconciles the stored ciphertext rather than resealing. */
export async function storeUtilityProtectedInput(inputId: string, bytes: Uint8Array, options: UtilityProtectedOptions): Promise<UtilityProtectedStoreResult> {
  uuid.parse(inputId); if (options.job || !(bytes instanceof Uint8Array)) throw unavailable();
  const copy = Buffer.from(bytes);
  try {
    return await withUtility(options, async session => {
      let commitDispatched = false;
      try {
        await session.query("begin");
        const reference = await writeInput(session, inputId, copy);
        session.check(); commitDispatched = true; await session.query("commit"); return { state: "stored", reference };
      } catch {
        if (commitDispatched) return { state: "commit_unknown", inputId };
        try { await session.query("rollback"); } catch {} throw unavailable();
      }
    });
  } finally { copy.fill(0); }
}

async function readInSession(inputId: string, processing: boolean, session: Session) {
  const reply = z.object({ binding: z.unknown(), keyBase64: z.unknown(), aad: z.unknown(), iv: z.unknown(), tag: z.unknown(), ciphertext: z.unknown() }).strict()
    .parse(row(await session.query("select parent_private.parent_read_utility_protected_input($1,$2) value", [inputId, processing])));
  await checkPrivateJob(session, inputId);
  return openReply(inputId, reply, session);
}
function openReply(inputId: string, reply: { binding: unknown; keyBase64: unknown; aad: unknown; iv: unknown; tag: unknown; ciphertext: unknown }, session: Session) {
  const binding = inputBinding(reply.binding, inputId, session), key = decode(reply.keyBase64, 32);
  try {
    const aad = Buffer.from(utilityProtectedInputAad(binding)); if (!decode(reply.aad, aad.length).equals(aad)) throw unavailable();
    return { binding, bytes: openUtilityProtectedInput({ binding, iv: decode(reply.iv, 12), tag: decode(reply.tag, 16), ciphertext: decode(reply.ciphertext, binding.byteLength) }, key, new Date()) };
  } finally { key.fill(0); }
}

/** Fresh exact scope, original consent/expiry, and no inherited validation. A proved unknown COMMIT stays unknown. */
export async function rebindUtilityProtectedInput(oldInputId: string, newInputId: string, input: unknown, options: UtilityProtectedOptions): Promise<UtilityProtectedStoreResult> {
  uuid.parse(oldInputId); uuid.parse(newInputId); const scope = utilityProtectedScopeSchema.parse(input);
  checkJobScope(options, scope);
  const sourceJob = options.job;
  const leased = sourceJob ? z.object({ jobId: uuid, leaseToken: uuid }).strict().parse({ jobId: sourceJob.jobId, leaseToken: sourceJob.leaseToken }) : null;
  return withUtility(options, async session => {
    let opened: ReturnType<typeof openReply> | undefined, commitDispatched = false;
    try {
      await session.query("begin");
      const reply = z.object({ targetInputId: uuid, source: z.object({ binding: z.unknown(), keyBase64: z.unknown(), aad: z.unknown(), iv: z.unknown(), tag: z.unknown(), ciphertext: z.unknown() }).strict() }).strict()
        .parse(row(await session.query(leased ? "select parent_private.parent_begin_utility_protected_rebind_for_job($1,$2,$3,$4,$5,$6,$7,$8) value"
          : "select parent_private.parent_begin_utility_protected_rebind($1,$2,$3,$4,$5,$6) value", [...(leased ? [leased.jobId, leased.leaseToken] : []), oldInputId, newInputId, scope.expectedVersion, scope.snapshotId, scope.snapshotRevision, scope.snapshotHash])));
      if (reply.targetInputId !== newInputId) throw unavailable(); await checkPrivateJob(session); opened = openReply(oldInputId, reply.source, session);
      if (opened.binding.requestId !== scope.requestId || opened.binding.programId !== scope.programId) throw unavailable();
      const reference = await writeInput(session, newInputId, opened.bytes);
      if (reference.requestId !== scope.requestId || reference.requestVersion !== scope.expectedVersion || reference.snapshotId !== scope.snapshotId || reference.snapshotHash !== scope.snapshotHash ||
        reference.consentedAt !== opened.binding.consentedAt || Date.parse(reference.expiresAt) > Date.parse(opened.binding.expiresAt) || reference.validation !== null) throw unavailable();
      if (leased) await session.query("select parent_private.parent_check_utility_reuse_job($1,$2,$3,$4)", [leased.jobId, leased.leaseToken, scope.requestId, scope.expectedVersion]);
      session.check(); commitDispatched = true; await session.query("commit"); return { state: "stored", reference };
    } catch {
      if (commitDispatched) return { state: "commit_unknown", inputId: newInputId };
      try { await session.query("rollback"); } catch {} throw unavailable();
    } finally { opened?.bytes.fill(0); }
  });
}
/** The only plaintext port: runs trusted code privately, then rechecks authority after its awaited work. */
export async function withUtilityProtectedInput<T>(inputId: string, options: UtilityProtectedOptions,
  action: (value: { binding: UtilityProtectedBinding; snapshot: UtilityProtectedApplicationContext["snapshot"]; bytes: Uint8Array; signal?: AbortSignal }) => Promise<T>, processing = true): Promise<T> {
  uuid.parse(inputId); if (options.job && !processing) throw unavailable();
  return withUtility(options, session => withJobAuthority(session, async () => {
    const opened = await readInSession(inputId, processing, session);
    try {
      const scope = utilityProtectedScopeSchema.parse({ requestId: opened.binding.requestId, expectedVersion: opened.binding.requestVersion, programId: opened.binding.programId,
        snapshotId: opened.binding.snapshotId, snapshotRevision: opened.binding.snapshotRevision, snapshotHash: opened.binding.snapshotHash });
      const context = processing ? await currentContext(session, scope) : utilityProtectedContextSchema.parse(row(await session.query("select parent_private.parent_check_utility_protected_input($1,false) value", [inputId])));
      await checkPrivateJob(session, inputId);
      const result = await action({ ...opened, snapshot: context.snapshot, signal: options.signal });
      try {
        session.check(); await session.query("select parent_private.parent_check_utility_protected_input($1,$2) value", [inputId, processing]); return result;
      } catch (error) { if (result instanceof Uint8Array) result.fill(0); throw error; }
    } finally { opened.bytes.fill(0); }
  }, inputId));
}

/** Only the isolated deterministic validator calls this; there is no public projection/validated input endpoint. */
export async function recordUtilityProtectedIncomeValidation(inputId: string, projection: UtilityIncomeProofProjection, expiresAt: string, options: UtilityProtectedOptions) {
  uuid.parse(inputId); const checked = utilityIncomeProofProjectionSchema.parse(projection); timestamp.parse(expiresAt);
  return withUtility(options, session => withJobAuthority(session, async () => utilityProtectedInputReferenceSchema.parse(row(await session.query(
    "select parent_private.parent_record_utility_protected_validation($1,$2,$3,$4) value", [inputId, checked.version, JSON.stringify(checked), expiresAt]))), inputId));
}
export async function readUtilityProtectedIncomeValidation(inputId: string, validatorVersion: string, options: UtilityProtectedOptions) {
  uuid.parse(inputId); return withUtility(options, session => withJobAuthority(session, async () => {
    const value = z.object({ projection: utilityIncomeProofProjectionSchema, expiresAt: timestamp, validationId: uuid }).strict().parse(row(await session.query(
      "select parent_private.parent_read_utility_protected_validation($1,$2) value", [inputId, validatorVersion])));
    if (Date.parse(value.expiresAt) <= Date.now()) throw unavailable(); return value;
  }, inputId));
}
