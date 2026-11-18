import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";
import { publicKeyIsSafe } from "./configuration";
import { verifyParentSession } from "./parent-session";
import { inspectDocument } from "./documents";
import { MAX_UTILITY_PROTECTED_INPUT_BYTES, utilityProtectedAuthorizationSchema, utilityProtectedInputReferenceSchema, utilityProtectedScalarSchema, utilityProtectedScopeSchema, utilityProtectedWorkspaceSchema, type UtilityProtectedScope, type UtilityProtectedWorkspace } from "./utility-protected-input-contract";
import { getUtilityProtectedApplicationContext, rebindUtilityProtectedInput, storeUtilityProtectedInput, validateUtilityProtectedConnection, withUtilityProtectedInput, type UtilityProtectedApplicationContext, type UtilityProtectedOptions } from "./utility-protected-client";
import { readUtilityPreparedArtifactForOwner } from "./utility-prepared-artifact-client";

const configSchema = z.object({ publicOrigin: z.string(), supabaseOrigin: z.literal("http://127.0.0.1:55321"),
  supabasePublicKey: z.string().min(1).max(4096).regex(/^[A-Za-z0-9._-]+$/).refine(publicKeyIsSafe), utilityDatabaseUrl: z.string().max(2048),
}).strict();
const metadataSchema = utilityProtectedInputReferenceSchema.extend({ mediaType: z.enum(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"]), byteLength: z.number().int().min(1).max(MAX_UTILITY_PROTECTED_INPUT_BYTES) }).strict();
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const route = new RegExp(`^/protected/utilities/requests/(${uuid})/(inputs(?:/(${uuid})(?:/(original|validate|rebind))?)?|prepare|workspace)\\?expectedVersion=([1-9][0-9]{0,9})$`);
const preparedRoute = new RegExp(`^/protected/utilities/requests/(${uuid})/prepared/(${uuid})\\?expectedVersion=([1-9][0-9]{0,9})$`);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" };
const unavailable = "The protected utility information could not be saved or opened. Check this request and try again.";
export type UtilityProtectedPreparation = (context: UtilityProtectedApplicationContext, options: UtilityProtectedOptions) => Promise<{ bytes: Uint8Array; mediaType: "application/pdf" }>;
export type UtilityProtectedValidation = (inputId: string, options: UtilityProtectedOptions) => Promise<z.infer<typeof utilityProtectedInputReferenceSchema>>;

async function body(request: Request, length: number, signal: AbortSignal) {
  const reader = request.body?.getReader(); if (!reader) throw new Error(); const bytes = new Uint8Array(length); let offset = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const { done, value } = await reader.read(); try {
      signal.throwIfAborted(); if (done) break; if (offset + value.length > length) throw new Error(); bytes.set(value, offset); offset += value.length;
    } finally { value?.fill(0); } }
    if (offset !== length) throw new Error(); return bytes;
  } catch { bytes.fill(0); cancel(); throw new Error(); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** Local TEST DATA path only, behind the existing protected frontdoor. No ordinary upload or provider transport is opened. */
export function createUtilityProtectedHandler(input: unknown, trusted: { prepare?: UtilityProtectedPreparation; validate?: UtilityProtectedValidation;
  workspace?: (workspace: UtilityProtectedWorkspace, route: { requestId: string; expectedVersion: number; nonce: string }) => string } = {}) {
  const config = configSchema.parse(input), origin = new URL(config.publicOrigin), database = validateUtilityProtectedConnection(config.utilityDatabaseUrl);
  if (origin.origin !== config.publicOrigin || origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || Number(origin.port) < 1024 || origin.username || origin.password ||
    !database.local || new URL(config.utilityDatabaseUrl).hostname !== "127.0.0.1" || !/^caselink_[a-z0-9_]{1,54}$/.test(database.login)) throw new Error("The protected utility service is not configured.");
  return async (request: Request): Promise<Response> => {
    const cookies: string[] = [], deadline = new Date(Date.now() + 25000), signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
    const options = { connectionString: config.utilityDatabaseUrl, deadline, signal };
    let bytes: Uint8Array | undefined, prepared: Uint8Array | undefined;
    const response = (value: unknown, status = 200) => {
      const result = value === unavailable ? new Response(unavailable, { status, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } }) : Response.json(value, { status, headers });
      for (const cookie of cookies) result.headers.append("Set-Cookie", cookie); return result;
    };
    try {
      const url = new URL(request.url), match = route.exec(url.pathname + url.search), download = preparedRoute.exec(url.pathname + url.search), length = request.headers.get("content-length"), write = ["POST", "PUT", "DELETE"].includes(request.method);
      const expectedVersion = Number(download?.[3] ?? match?.[5]);
      if ((!match && !download) || expectedVersion > 2147483647 || url.origin !== config.publicOrigin || url.hash || request.headers.get("host") !== origin.host ||
        !["GET", "POST", "PUT", "DELETE"].includes(request.method) || request.headers.has("authorization") || request.headers.has("transfer-encoding") || request.headers.has("content-encoding") ||
        [...request.headers.keys()].some(name => name === "forwarded" || name.startsWith("x-forwarded-")) ||
        (write ? request.headers.get("origin") !== config.publicOrigin || !length || !/^(0|[1-9][0-9]{0,7})$/.test(length) || Number(length) > MAX_UTILITY_PROTECTED_INPUT_BYTES : length !== null && length !== "0") ||
        (request.headers.has("origin") && request.headers.get("origin") !== config.publicOrigin) || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") ||
        [...request.headers].reduce((size, [name, value]) => size + name.length + value.length + 4, 0) > 16384) return response(unavailable, 400);
      const requestId = download?.[1] ?? match![1], inputId = match?.[3], operation = match?.[4];
      const supabase = createServerClient(config.supabaseOrigin, config.supabasePublicKey, {
        cookieOptions: { name: "caselink-parent-auth", httpOnly: true, sameSite: "lax", secure: false, path: "/" },
        global: { fetch: (resource, init) => fetchWithTimeout(resource, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) },
        cookies: { getAll: () => parseCookieHeader(request.headers.get("cookie") ?? "").map(value => ({ name: value.name, value: value.value ?? "" })),
          setAll(values) { for (const value of values) { if (!/^caselink-parent-auth(?:\.[0-9]+)?$/.test(value.name)) throw new Error();
            cookies.push(serializeCookieHeader(value.name, value.value, { ...value.options, domain: undefined, path: "/", httpOnly: true, sameSite: "lax", secure: false })); } },
        },
      });
      const session = await verifyParentSession(supabase); if (!session) return response(unavailable, 401);
      const current = async () => { signal.throwIfAborted(); const check = await verifyParentSession(supabase); if (!check || check.user.id !== session.user.id) throw new Error(); signal.throwIfAborted(); };
      if (download) {
        if (request.method !== "GET") return response(unavailable, 405);
        const owned = async () => {
          await current();
          const result = await supabase.from("parent_requests").select("id,version").eq("id", requestId).maybeSingle();
          if (result.error || result.data?.id !== requestId || result.data.version !== expectedVersion) throw new Error();
          signal.throwIfAborted();
        };
        await owned();
        const result = await readUtilityPreparedArtifactForOwner({ packetId: download[2], ownerId: session.user.id, requestId }, options);
        prepared = result.bytes;
        await owned();
        const file = new Response(Uint8Array.from(prepared), { headers: { ...headers, "X-Frame-Options": "DENY", "Content-Type": "application/pdf", "Content-Length": String(prepared.length),
          "Content-Disposition": 'attachment; filename="caselink-unsigned-utility-application.pdf"' } });
        for (const cookie of cookies) file.headers.append("Set-Cookie", cookie); return file;
      }
      if (match![2] === "workspace") {
        if (request.method !== "GET") return response(unavailable, 405);
        const result = await supabase.rpc("parent_get_utility_protected_workspace", { p_request_id: requestId, p_expected_version: expectedVersion });
        if (result.error) return response(unavailable, 403);
        const workspace = utilityProtectedWorkspaceSchema.parse(result.data);
        if ((workspace.scope && (workspace.scope.requestId !== requestId || workspace.scope.expectedVersion !== expectedVersion)) || workspace.references.some(ref => ref.requestId !== requestId || ref.ownerId !== session.user.id)) return response(unavailable, 403);
        await current();
        if (!trusted.workspace) return response(workspace);
        const nonce = randomBytes(24).toString("base64url"), html = trusted.workspace(workspace, { requestId, expectedVersion, nonce });
        const page = new Response(html, { headers: { ...headers, "X-Frame-Options": "DENY", "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'` } });
        for (const cookie of cookies) page.headers.append("Set-Cookie", cookie); return page;
      }
      const json = async () => { if (request.headers.get("content-type") !== "application/json" || Number(length) < 2 || Number(length) > 65536) throw new Error();
        bytes = await body(request, Number(length), signal); await current(); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); };
      if (match![2] === "prepare") {
        if (request.method !== "POST" || !trusted.prepare) return response(unavailable, 405);
        const scope: UtilityProtectedScope = utilityProtectedScopeSchema.parse(await json());
        if (scope.requestId !== requestId || scope.expectedVersion !== expectedVersion) return response(unavailable, 400);
        const owned = await supabase.from("parent_requests").select("id").eq("id", requestId).maybeSingle(); if (owned.error || !owned.data) return response(unavailable, 403);
        const context = await getUtilityProtectedApplicationContext(scope, options); if (context.ownerId !== session.user.id) return response(unavailable, 403);
        const result = await trusted.prepare(context, options); prepared = result.bytes; signal.throwIfAborted(); await current();
        await getUtilityProtectedApplicationContext(scope, options); signal.throwIfAborted();
        if (result.mediaType !== "application/pdf" || !(prepared instanceof Uint8Array) || !prepared.length || prepared.length > MAX_UTILITY_PROTECTED_INPUT_BYTES) return response(unavailable, 409);
        const resultResponse = new Response(Uint8Array.from(prepared), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Length": String(prepared.length), "Content-Disposition": 'attachment; filename="caselink-unsigned-utility-application.pdf"' } });
        for (const cookie of cookies) resultResponse.headers.append("Set-Cookie", cookie); return resultResponse;
      }
      if (!inputId) {
        if (request.method === "GET") { const result = await supabase.rpc("parent_get_utility_protected_inputs", { p_request_id: requestId });
          if (result.error) return response(unavailable, 403); return response(z.array(utilityProtectedInputReferenceSchema).parse(result.data)); }
        if (request.method !== "POST") return response(unavailable, 405);
        const authorization = utilityProtectedAuthorizationSchema.parse(await json());
        if (authorization.requestId !== requestId || authorization.expectedVersion !== expectedVersion) return response(unavailable, 400);
        const result = await supabase.rpc(authorization.replacesInputId ? "parent_authorize_utility_identifier_replacement" : "parent_authorize_utility_protected_input", { p_request_id: requestId, p_expected_version: expectedVersion, p_program_id: authorization.programId,
          p_snapshot_id: authorization.snapshotId, p_snapshot_revision: authorization.snapshotRevision, p_snapshot_hash: authorization.snapshotHash, p_input_id: authorization.inputId,
          p_purpose: authorization.purpose, p_targets: authorization.targets, p_media_type: authorization.mediaType, p_byte_length: authorization.byteLength,
          p_notice_version: authorization.noticeVersion, p_consent_accepted: true, p_subject_authority_declared: true, p_account_authority_declared: true,
          ...(authorization.replacesInputId ? { p_replaces_input_id: authorization.replacesInputId } : {}) });
        if (result.error) return response(unavailable, result.error.code === "40001" ? 409 : 403);
        const reference = utilityProtectedInputReferenceSchema.parse(result.data); if (reference.ownerId !== session.user.id || reference.requestId !== requestId || reference.inputId !== authorization.inputId || reference.requestVersion !== expectedVersion) return response(unavailable, 403);
        await current(); return response(reference, 201);
      }
      const check = async () => {
        const result = await supabase.rpc("parent_check_utility_protected_input", { p_request_id: requestId, p_input_id: inputId });
        if (result.error) throw new Error(); const checked = metadataSchema.parse(result.data);
        if (checked.ownerId !== session.user.id || checked.requestId !== requestId || checked.inputId !== inputId || checked.requestVersion !== expectedVersion ||
          !["authorized", "stored"].includes(checked.state) || Date.parse(checked.expiresAt) <= Date.now() || Date.parse(checked.consentedAt) > Date.now()) throw new Error(); return checked;
      };
      if (request.method === "DELETE" && !operation) {
        if (length !== "0") return response(unavailable, 400); const result = await supabase.rpc("parent_revoke_utility_protected_input", { p_request_id: requestId, p_input_id: inputId });
        if (result.error) return response(unavailable, 403); return response({ inputId, state: "revoked", requestVersion: z.number().int().positive().parse(result.data) });
      }
      if (operation === "rebind") {
        if (request.method !== "POST") return response(unavailable, 405);
        const input = z.object({ newInputId: z.uuid(), scope: utilityProtectedScopeSchema }).strict().parse(await json());
        if (input.scope.requestId !== requestId || input.scope.expectedVersion !== expectedVersion) return response(unavailable, 400);
        const history = await supabase.rpc("parent_get_utility_protected_inputs", { p_request_id: requestId });
        if (history.error) return response(unavailable, 403);
        const old = z.array(utilityProtectedInputReferenceSchema).parse(history.data).find(ref => ref.inputId === inputId);
        if (!old || old.ownerId !== session.user.id || old.requestId !== requestId || old.programId !== input.scope.programId || !["stored", "superseded"].includes(old.state) || Date.parse(old.expiresAt) <= Date.now()) return response(unavailable, 403);
        const result = await rebindUtilityProtectedInput(inputId, input.newInputId, input.scope, options); await current();
        if (result.state === "commit_unknown") return response({ state: "storage_unconfirmed", inputId: input.newInputId }, 202);
        if (result.reference.ownerId !== session.user.id || result.reference.requestId !== requestId || result.reference.requestVersion !== expectedVersion) return response(unavailable, 403);
        return response(result.reference, 201);
      }
      const metadata = await check();
      if (operation === "validate") {
        if (request.method !== "POST" || length !== "0" || !trusted.validate) return response(unavailable, 405);
        const reference = utilityProtectedInputReferenceSchema.parse(await trusted.validate(inputId, options)); await current(); await check(); return response(reference);
      }
      if (operation === "original") {
        if (request.method !== "GET" || metadata.state !== "stored") return response(unavailable, 409);
        prepared = await withUtilityProtectedInput(inputId, options, async ({ binding, bytes: original }) => {
          if (binding.ownerId !== session.user.id || binding.requestId !== requestId || binding.requestVersion !== expectedVersion || binding.mediaType !== metadata.mediaType) throw new Error(); return Uint8Array.from(original);
        }, false);
        await current(); await check(); signal.throwIfAborted();
        // Download only; an uploaded page is never an instruction or an inline application result.
        const result = new Response(Uint8Array.from(prepared), { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(prepared.length), "Content-Disposition": 'attachment; filename="caselink-private-utility-input"' } });
        for (const cookie of cookies) result.headers.append("Set-Cookie", cookie); return result;
      }
      if (request.method === "GET") { const { mediaType: _, byteLength: __, ...reference } = metadata; void _; void __; return response(reference); }
      if (request.method !== "PUT" || request.headers.get("content-type") !== metadata.mediaType || Number(length) !== metadata.byteLength) return response(unavailable, 400);
      // Consent and current scope are checked before reading any private upload byte.
      bytes = await body(request, metadata.byteLength, signal); await current(); await check();
      if (metadata.mediaType === "application/octet-stream") {
        const scalar = utilityProtectedScalarSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        if (scalar.purpose !== metadata.purpose) return response(unavailable, 400);
      } else { await inspectDocument(bytes, metadata.mediaType); signal.throwIfAborted(); await current(); await check(); }
      const result = await storeUtilityProtectedInput(inputId, bytes, options); await current();
      if (result.state === "commit_unknown") return response({ state: "storage_unconfirmed", inputId }, 202);
      let reference = result.reference;
      if (reference.purpose === "income_proof" && trusted.validate) {
        try { reference = utilityProtectedInputReferenceSchema.parse(await trusted.validate(inputId, options)); }
        catch { /* The file is proved stored; a validation failure must not turn that into an unknown upload. */ }
      }
      await current(); await check(); return response(reference, 201);
    } catch { return response(unavailable, signal.aborted ? 503 : 403); }
    finally { bytes?.fill(0); prepared?.fill(0); }
  };
}
