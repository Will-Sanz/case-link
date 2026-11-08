import { createHash } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { MAX_SNAP_PACKET_BYTES, snapFinalPacketBindingSchema } from "./snap-packet-contract";
import { snapSenderAttemptSchema, snapSenderIntentSchema, snapSenderCarrierId, snapSenderStatus, SNAP_SENDER_ERROR, type SnapSenderAttempt, type SnapSenderIntent } from "./snap-sender-contract";
import { boundedSnapSenderWork } from "./snap-sender-http";

export const snapSenderEnvelopeSchema = z.object({ binding: snapFinalPacketBindingSchema,
  aad: z.string().min(1).max(12000), keyBase64: z.string().min(1).max(64), iv: z.string().min(1).max(32),
  tag: z.string().min(1).max(40), ciphertext: z.string().min(1).max(Math.ceil(MAX_SNAP_PACKET_BYTES * 1.5)),
}).strict();
export type SnapSenderEnvelope = z.infer<typeof snapSenderEnvelopeSchema>;
const reservationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("dispatch_allowed"), attempt: snapSenderAttemptSchema, envelope: snapSenderEnvelopeSchema }).strict(),
  z.object({ state: z.literal("reconcile_only"), attempt: snapSenderAttemptSchema }).strict(),
]);
export type SnapSenderReservation = z.infer<typeof reservationSchema> | { state: "reservation_unknown" };
export type SnapSenderStore = {
  reserve(intent: SnapSenderIntent, signal: AbortSignal): Promise<SnapSenderReservation>;
  resume(intent: SnapSenderIntent, signal: AbortSignal): Promise<SnapSenderReservation>;
  recheck(intent: SnapSenderIntent, signal: AbortSignal): Promise<SnapSenderAttempt>;
  read(intent: SnapSenderIntent, signal: AbortSignal): Promise<SnapSenderAttempt | null>;
  record(intent: SnapSenderIntent, providerId: string | null, status: z.infer<typeof snapSenderStatus>, signal: AbortSignal): Promise<SnapSenderAttempt>;
};

export function validateSnapDeliveryAttempt(intent: SnapSenderIntent, value: unknown) {
  const attempt = snapSenderAttemptSchema.parse(value);
  if (attempt.operationId !== intent.operationId || attempt.packetId !== intent.protectedPacket.packetId
    || attempt.contentSha256 !== intent.protectedPacket.contentSha256
    || attempt.operationRef !== createHash("sha256").update(intent.idempotencyKey).digest("hex")
    || Date.parse(attempt.expiresAt) <= Date.now() || Date.parse(attempt.attemptedAt) > Date.now()
    || (attempt.dispatchAuthorizedAt !== null && (Date.parse(attempt.dispatchAuthorizedAt) < Date.parse(attempt.attemptedAt) || Date.parse(attempt.dispatchAuthorizedAt) > Date.now()))
    || (attempt.providerId === null && attempt.providerStatus !== "UNKNOWN")
    || (attempt.dispatchAuthorizedAt === null && (attempt.providerId !== null || attempt.providerStatus !== "UNKNOWN"))) throw new Error(SNAP_SENDER_ERROR);
  return attempt;
}

const principalSchema = z.object({
  rolname: z.string(), current_role: z.string(), rolcanlogin: z.literal(true), rolinherit: z.literal(false),
  rolsuper: z.literal(false), rolbypassrls: z.literal(false), rolcreaterole: z.literal(false), rolcreatedb: z.literal(false), rolreplication: z.literal(false),
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
  from pg_roles r cross join pg_roles g where r.rolname=session_user and g.rolname='parent_snap_sender'`;

function connection(value: string) {
  const url = new URL(value), local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), login = decodeURIComponent(url.username);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password || url.pathname !== "/postgres" || url.hash
    || !/^[a-z][a-z0-9_]{0,62}$/.test(login) || ["postgres", "service_role", "supabase_admin", "authenticator", "parent_snap_sender"].includes(login)
    || [...url.searchParams.keys()].some(key => !["sslmode", "sslrootcert"].includes(key) || url.searchParams.getAll(key).length !== 1)
    || (local ? url.port !== "55322" || (url.search && url.search !== "?sslmode=disable")
      : !/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname) || !["", "5432"].includes(url.port) || url.searchParams.get("sslmode") !== "verify-full")) throw new Error(SNAP_SENDER_ERROR);
  return { local, login };
}

/** Private process only: dedicated one-operation connections never enter a general worker pool. */
export function createSnapSenderStore(options: { connectionString: string }): SnapSenderStore {
  let target: ReturnType<typeof connection>;
  try { target = connection(options.connectionString); } catch { throw new Error(SNAP_SENDER_ERROR); }
  async function session<T>(signal: AbortSignal, action: (query: (sql: string, values?: unknown[]) => Promise<unknown>) => Promise<T>) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
    if (bounded.aborted) throw new Error(SNAP_SENDER_ERROR);
    const client = new Client({ connectionString: options.connectionString, ssl: target.local ? false : { rejectUnauthorized: true },
      application_name: "caselink-snap-sender", connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 5000,
      options: "-c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000" });
    let closed = false;
    const close = () => { if (closed) return; closed = true; client.connection.stream.destroy(); try { void client.end().catch(() => {}); } catch {} };
    const query = async (sql: string, values?: unknown[]) => {
      const result = await boundedSnapSenderWork(bounded, () => client.query<Record<string, unknown>>(sql, values));
      bounded.throwIfAborted();
      if (sql === "begin" || sql === "commit" || sql === "rollback" || sql === "set role parent_snap_sender") return null;
      if (result.rows.length !== 1) throw new Error(SNAP_SENDER_ERROR);
      return Object.hasOwn(result.rows[0], "value") ? result.rows[0].value : result.rows[0];
    };
    bounded.addEventListener("abort", close, { once: true }); client.on("error", close);
    try {
      await boundedSnapSenderWork(bounded, () => client.connect());
      const principal = principalSchema.parse(await query(principalSql));
      if (principal.rolname !== target.login || principal.current_role !== target.login) throw new Error();
      await query("set role parent_snap_sender");
      z.object({ role: z.literal("parent_snap_sender"), principal: z.literal(target.login) }).strict().parse(await query("select current_user::text role,session_user::text principal"));
      return await action(query);
    } catch { throw new Error(SNAP_SENDER_ERROR); }
    finally { bounded.removeEventListener("abort", close); close(); }
  }
  const input = (intent: SnapSenderIntent) => { try { return JSON.stringify(snapSenderIntentSchema.parse(intent)); } catch { throw new Error(SNAP_SENDER_ERROR); } };
  async function reservation(intent: SnapSenderIntent, signal: AbortSignal, resume: boolean): Promise<SnapSenderReservation> {
    const encoded = input(intent);
    return session(signal, async query => {
      let commitDispatched = false;
      try {
        await query("begin");
        const result = reservationSchema.parse(await query(resume ? "select parent_private.parent_resume_snap_delivery($1::jsonb) value" : "select parent_private.parent_reserve_snap_delivery($1::jsonb) value", [encoded]));
        validateSnapDeliveryAttempt(intent, result.attempt);
        if (result.state === "dispatch_allowed" && (result.attempt.dispatchAuthorizedAt !== null || result.attempt.providerId !== null || result.attempt.providerStatus !== "UNKNOWN")) throw new Error();
        commitDispatched = true; await query("commit");
        return result;
      } catch {
        if (commitDispatched) return { state: "reservation_unknown" };
        try { await query("rollback"); } catch {}
        throw new Error(SNAP_SENDER_ERROR);
      }
    });
  }
  return {
    reserve: (intent, signal) => reservation(intent, signal, false),
    resume: (intent, signal) => reservation(intent, signal, true),
    async recheck(intent, signal) {
      const encoded = input(intent);
      return session(signal, async query => validateSnapDeliveryAttempt(intent, await query("select parent_private.parent_recheck_snap_delivery($1::jsonb) value", [encoded])));
    },
    async read(intent, signal) {
      const encoded = input(intent);
      return session(signal, async query => {
        const result = await query("select parent_private.parent_read_snap_delivery($1::jsonb) value", [encoded]);
        return result === null ? null : validateSnapDeliveryAttempt(intent, result);
      });
    },
    async record(intent, providerId, status, signal) {
      const encoded = input(intent), parsedId = snapSenderCarrierId.nullable().safeParse(providerId), parsedState = snapSenderStatus.safeParse(status);
      if (!parsedId.success || !parsedState.success) throw new Error(SNAP_SENDER_ERROR);
      const id = parsedId.data, state = parsedState.data;
      if (id === null && state !== "UNKNOWN") throw new Error(SNAP_SENDER_ERROR);
      return session(signal, async query => validateSnapDeliveryAttempt(intent, await query("select parent_private.parent_record_snap_delivery($1::jsonb,$2,$3) value", [encoded, id, state])));
    },
  };
}
