import { createHash } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { fixtureSnapApplication } from "./test-fixtures";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), open: vi.fn(), stage: vi.fn(), reconcile: vi.fn(), direct: vi.fn(), reconcileDirect: vi.fn() }));
vi.mock("@supabase/ssr", async original => ({ ...await original<typeof import("@supabase/ssr")>(), createServerClient: mocks.create }));
vi.mock("./snap-finalizer-client", async original => ({ ...await original<typeof import("./snap-finalizer-client")>(), openSnapFinalPacketForIsolatedReview: mocks.open, stageSnapFinalPacket: mocks.stage, reconcileSnapFinalPacket: mocks.reconcile,
  finalizeSnapDirectCompletion: mocks.direct, reconcileSnapDirectCompletion: mocks.reconcileDirect }));
import { createSnapProtectedReviewHandler, createSnapProtectedReviewServer } from "./snap-protected-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), requestId = id(2), packetId = id(3), canary = "PRIVATE_REVIEW_CANARY";
const copy = await renderSnapSigningCopy(readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"), fixtureSnapApplication(new Date("2026-11-04T17:00:00Z")), new Date("2026-11-04T17:00:00Z"));
if (!copy.bytes) throw new Error("The synthetic official signing copy must exist.");
const bytes = copy.bytes, hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const config = { publicOrigin: "http://127.0.0.1:3200", supabaseOrigin: "http://127.0.0.1:55321", supabasePublicKey: "sb_publishable_synthetic",
  finalizerDatabaseUrl: "postgresql://caselink_finalizer_synthetic:synthetic-local-secret@127.0.0.1:55322/postgres" };
const hostedConfig = { ...config, mode: "hosted", publicOrigin: "https://pilot.example.invalid", supabaseOrigin: "https://syntheticproject.supabase.co",
  finalizerDatabaseUrl: "postgresql://caselink_finalizer_synthetic:synthetic-secret@db.syntheticproject.supabase.co:5432/postgres?sslmode=verify-full" };
const path = `/protected/snap/requests/${requestId}/packets/${packetId}?expectedVersion=2`;
let metadata: { intent: Record<string, string | number>; authorizationExpiresAt: string; subjectIds: string[]; authorityDeclaration: string; consentedAt: string; state: string; [key: string]: unknown }, opened: Uint8Array;
const servers: Server[] = [];
function request(options: { path?: string; method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
  return new Request(config.publicOrigin + (options.path ?? path), { method: options.method ?? "GET", signal: options.signal,
    headers: { Host: new URL(config.publicOrigin).host, Cookie: "caselink-parent-auth=synthetic-cookie", ...options.headers } });
}
beforeEach(() => {
  vi.clearAllMocks();
  metadata = { intent: { format: "caselink-snap-final-packet-v1", packetId, ownerId: owner, requestId, requestVersion: 2, recipient: "snap-pa", need: "snap_new",
    purpose: "snap_final_application_packet", authorizationId: id(4), policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention",
    templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256,
    snapshotId: id(5), snapshotHash: "a".repeat(64), contentSha256: hash(bytes), byteLength: bytes.length },
    authorizationExpiresAt: new Date(Date.now() + 120000).toISOString(), subjectIds: [id(6)], authorityDeclaration: "parent_declared_household_data_authority", consentedAt: new Date(Date.now() - 1000).toISOString(), state: "stored" };
  opened = Uint8Array.from(bytes);
  mocks.create.mockReturnValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner, email: "synthetic@example.invalid", email_confirmed_at: "2026-11-04", is_anonymous: false } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "parent_ensure_account" ? id(7) : structuredClone(metadata), error: null }));
  mocks.open.mockImplementation(async () => ({ binding: { ...structuredClone(metadata.intent), expiresAt: new Date(Date.now() + 60000).toISOString() }, bytes: opened }));
  mocks.stage.mockImplementation(async () => ({ state: "stored", binding: { ...structuredClone(metadata.intent), expiresAt: new Date(Date.now() + 60000).toISOString() } }));
  mocks.reconcile.mockImplementation(async () => ({ state: "stored", binding: { ...structuredClone(metadata.intent), expiresAt: new Date(Date.now() + 60000).toISOString() } }));
  mocks.direct.mockImplementation(async () => ({ state: "stored", binding: { ...structuredClone(metadata.intent), expiresAt: new Date(Date.now() + 60000).toISOString() } }));
  mocks.reconcileDirect.mockImplementation(async () => ({ state: "stored", binding: { ...structuredClone(metadata.intent), expiresAt: new Date(Date.now() + 60000).toISOString() } }));
});
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

describe("closed isolated canonical PDF review", () => {
  it("verifies existing parent Auth/account and exact metadata before decrypting an actual synthetic signing copy", async () => {
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBe(200); expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(mocks.getUser).toHaveBeenCalledOnce(); expect(mocks.rpc).toHaveBeenNthCalledWith(1, "parent_ensure_account");
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "parent_get_snap_final_packet_authorization", { p_request_id: requestId, p_packet_id: packetId, p_expected_version: 2 });
    expect(mocks.open).toHaveBeenCalledWith(metadata.intent, expect.objectContaining({ connectionString: config.finalizerDatabaseUrl, deadline: expect.any(Date), signal: expect.any(AbortSignal) }));
    expect(opened.every(value => value === 0)).toBe(true);
    expect(result.headers.get("content-type")).toBe("application/pdf");
    expect(result.headers.get("content-disposition")).toBe('inline; filename="caselink-snap-application.pdf"');
    expect(result.headers.get("content-length")).toBe(String(bytes.length));
    expect(result.headers.get("cache-control")).toBe("private, no-store"); expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("x-frame-options")).toBe("SAMEORIGIN"); expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify([...result.headers])).not.toContain(owner);
    expect(mocks.rpc.mock.calls.map(call => call[0])).not.toEqual(expect.arrayContaining(["parent_authorize_snap_submission", "parent_record_personal_act"]));
  });
  it("reuses parent cookie parsing/rotation without a second login or public response cache", async () => {
    mocks.create.mockImplementation((_url, _key, options) => {
      expect(options.cookies.getAll()).toEqual([{ name: "caselink-parent-auth", value: "synthetic-cookie" }]);
      expect(options.cookieOptions).toEqual({ name: "caselink-parent-auth", httpOnly: true, sameSite: "lax", secure: false, path: "/" });
      options.cookies.setAll([{ name: "caselink-parent-auth.0", value: "synthetic-rotation-0", options: { maxAge: 100, httpOnly: false } },
        { name: "caselink-parent-auth.1", value: "synthetic-rotation-1", options: { maxAge: 100 } }]);
      return { auth: { getUser: mocks.getUser }, rpc: mocks.rpc };
    });
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBe(200); expect(result.headers.getSetCookie()).toHaveLength(2);
    for (const cookie of result.headers.getSetCookie()) { expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Path=/"); expect(cookie).not.toContain("Domain="); }
  });
  it.each(["owner", "request", "packet", "version", "source", "expired", "future", "extra", "not_stored"])("denies changed %s metadata before private read", async kind => {
    if (kind === "owner") metadata.intent.ownerId = id(10);
    if (kind === "request") metadata.intent.requestId = id(10);
    if (kind === "packet") metadata.intent.packetId = id(10);
    if (kind === "version") metadata.intent.requestVersion = 3;
    if (kind === "source") metadata.intent.templateSha256 = "f".repeat(64);
    if (kind === "expired") metadata.authorizationExpiresAt = new Date(0).toISOString();
    if (kind === "future") metadata.consentedAt = new Date(Date.now() + 10000).toISOString();
    if (kind === "extra") metadata.rawIdentifier = canary;
    if (kind === "not_stored") metadata.state = "authorized";
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBeGreaterThanOrEqual(400); expect(await result.text()).not.toContain(canary); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["absent", "anonymous", "unverified", "auth_denied", "account_denied", "account_unavailable", "auth_unavailable"])("enforces existing %s session behavior before metadata", async kind => {
    const user = { id: owner, email: "synthetic@example.invalid", email_confirmed_at: kind === "unverified" ? null : "2026-11-04", is_anonymous: kind === "anonymous" };
    mocks.getUser.mockResolvedValue({ data: { user: kind === "absent" ? null : user }, error: kind.startsWith("auth_") ? { status: kind === "auth_denied" ? 401 : 503, message: canary } : null });
    if (kind.startsWith("account_")) mocks.rpc.mockResolvedValue({ data: null, error: { code: kind === "account_denied" ? "42501" : "XX000", message: canary } });
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBe(kind.endsWith("unavailable") ? 503 : 401); expect(await result.text()).not.toContain(canary);
    expect(mocks.rpc.mock.calls.every(call => call[0] === "parent_ensure_account")).toBe(true); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["hash", "size", "binding", "expired", "too_late", "structure", "private_error"])("contains %s private-read failure and erases returned bytes", async kind => {
    if (kind === "private_error") mocks.open.mockRejectedValue(new Error(canary));
    else mocks.open.mockImplementation(async () => ({ binding: { ...metadata.intent,
      ...(kind === "binding" ? { packetId: id(10) } : {}),
      expiresAt: new Date(kind === "expired" ? 0 : Date.now() + (kind === "too_late" ? 180000 : 60000)).toISOString() },
      bytes: kind === "size" ? (opened = opened.subarray(0, -1)) : (kind === "hash" ? (opened[100] ^= 1, opened) : opened) }));
    if (kind === "structure") { opened = new TextEncoder().encode("%PDF-SYNTHETIC-INVALID-STRUCTURE"); metadata.intent.contentSha256 = hash(opened); metadata.intent.byteLength = opened.length; }
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBeGreaterThanOrEqual(400); expect(await result.text()).not.toContain(canary);
    if (kind !== "private_error") expect(opened.every(value => value === 0)).toBe(true);
  });
  it("never exposes metadata/provider/parser exception details in errors or logs", async () => {
    const warn = vi.spyOn(console, "warn"), log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    mocks.rpc.mockImplementation(async name => name === "parent_ensure_account" ? { data: id(7), error: null } : { data: null, error: { code: "XX000", message: canary } });
    const result = await createSnapProtectedReviewHandler(config)(request());
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(canary);
    expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it.each(["foreign_origin", "foreign_host", "cross_site", "same_site", "bearer", "body", "malformed_length", "transfer", "header_limit", "duplicate_query", "extra_query", "unknown_path", "version_overflow", "method"])("rejects unsafe %s request before Auth", async kind => {
    const value: Parameters<typeof request>[0] = {};
    if (kind === "foreign_origin") value.headers = { Origin: "https://untrusted.example" };
    if (kind === "foreign_host") value.headers = { Host: "untrusted.example" };
    if (kind === "cross_site") value.headers = { "Sec-Fetch-Site": "cross-site" };
    if (kind === "same_site") value.headers = { "Sec-Fetch-Site": "same-site" };
    if (kind === "bearer") value.headers = { Authorization: `Bearer ${canary}` };
    if (kind === "body") value.headers = { "Content-Length": "1" };
    if (kind === "malformed_length") value.headers = { "Content-Length": "+0" };
    if (kind === "transfer") value.headers = { "Transfer-Encoding": "chunked" };
    if (kind === "header_limit") value.headers = { Cookie: "x".repeat(16385) };
    if (kind === "duplicate_query") value.path = path + "&expectedVersion=2";
    if (kind === "extra_query") value.path = path + "&private=" + canary;
    if (kind === "unknown_path") value.path = "/protected/snap/upload";
    if (kind === "version_overflow") value.path = path.replace("=2", "=2147483648");
    if (kind === "method") value.method = "PUT";
    const result = await createSnapProtectedReviewHandler(config)(request(value));
    expect(result.status).toBe(kind === "method" ? 405 : 400); expect(await result.text()).not.toContain(canary); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("cancels before Auth and propagates disconnect cancellation into isolated reads", async () => {
    const controller = new AbortController(); controller.abort(canary);
    expect((await createSnapProtectedReviewHandler(config)(request({ signal: controller.signal }))).status).toBe(503); expect(mocks.create).not.toHaveBeenCalled();
    const active = new AbortController();
    mocks.open.mockImplementation((_intent, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error(canary)), { once: true })));
    const pending = createSnapProtectedReviewHandler(config)(request({ signal: active.signal }));
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce()); active.abort(canary);
    expect((await pending).status).toBe(503);
  });
  it.each(["public_key", "private_key", "school_project", "hosted_project", "foreign_site", "database_target", "database_role", "database_options", "extra_secret"])("rejects unsafe %s configuration without echoing it", kind => {
    const value: Record<string, unknown> = { ...config };
    if (kind === "public_key") value.supabasePublicKey = "";
    if (kind === "private_key") value.supabasePublicKey = "sb_secret_synthetic-test-key";
    if (kind === "school_project") value.supabaseOrigin = "http://127.0.0.1:54321";
    if (kind === "hosted_project") value.supabaseOrigin = "https://school.supabase.co";
    if (kind === "foreign_site") value.publicOrigin = "https://www.thecaselink.com";
    if (kind === "database_target") value.finalizerDatabaseUrl = config.finalizerDatabaseUrl.replace("55322", "54322");
    if (kind === "database_role") value.finalizerDatabaseUrl = "postgresql://postgres:PRIVATE_REVIEW_CANARY@127.0.0.1:55322/postgres";
    if (kind === "database_options") value.finalizerDatabaseUrl = config.finalizerDatabaseUrl + "?options=-c%20role%3Dpostgres";
    if (kind === "extra_secret") value.OPENAI_API_KEY = canary;
    expect(() => createSnapProtectedReviewHandler(value)).toThrow("The protected review service is not configured."); expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("explicit hosted protected review configuration", () => {
  it("uses the paired hosted project and forces secure host-only parent cookies even on denied requests", async () => {
    mocks.create.mockImplementation((url, _key, options) => {
      expect(url).toBe(hostedConfig.supabaseOrigin); expect(options.cookieOptions.secure).toBe(true);
      options.cookies.setAll([{ name: "caselink-parent-auth.0", value: "synthetic-rotation", options: { secure: false, domain: "untrusted.invalid", httpOnly: false } }]);
      return { auth: { getUser: mocks.getUser }, rpc: mocks.rpc };
    });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await createSnapProtectedReviewHandler(hostedConfig)(new Request(hostedConfig.publicOrigin + path, {
      headers: { Host: new URL(hostedConfig.publicOrigin).host, Cookie: "caselink-parent-auth=synthetic-cookie" },
    }));
    expect(result.status).toBe(401);
    const cookie = result.headers.getSetCookie()[0];
    expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/"); expect(cookie).not.toContain("Domain="); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["mode", "local_mode", "http_site", "site_path", "site_credentials", "loopback", "loopback_domain", "ip_site", "api_http", "api_path", "api_credentials", "other_project", "local_database", "tls_required", "duplicate_tls", "database_options", "admin_role", "pooler_port"])(
    "rejects hosted %s configuration before Auth or database access", kind => {
      const value: Record<string, unknown> = { ...hostedConfig };
      if (kind === "mode") delete value.mode;
      if (kind === "local_mode") value.mode = "local";
      if (kind === "http_site") value.publicOrigin = "http://pilot.example.invalid";
      if (kind === "site_path") value.publicOrigin = hostedConfig.publicOrigin + "/private";
      if (kind === "site_credentials") value.publicOrigin = "https://private@pilot.example.invalid";
      if (kind === "loopback") value.publicOrigin = "https://127.0.0.1";
      if (kind === "loopback_domain") value.publicOrigin = "https://pilot.localhost";
      if (kind === "ip_site") value.publicOrigin = "https://192.0.2.1";
      if (kind === "api_http") value.supabaseOrigin = hostedConfig.supabaseOrigin.replace("https:", "http:");
      if (kind === "api_path") value.supabaseOrigin = hostedConfig.supabaseOrigin + "/auth/v1";
      if (kind === "api_credentials") value.supabaseOrigin = "https://private@syntheticproject.supabase.co";
      if (kind === "other_project") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl.replace("db.syntheticproject", "db.otherproject");
      if (kind === "local_database") value.finalizerDatabaseUrl = config.finalizerDatabaseUrl;
      if (kind === "tls_required") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl.replace("verify-full", "require");
      if (kind === "duplicate_tls") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl + "&sslmode=disable";
      if (kind === "database_options") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl + "&options=-c%20role%3Dpostgres";
      if (kind === "admin_role") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl.replace("caselink_finalizer_synthetic", "postgres");
      if (kind === "pooler_port") value.finalizerDatabaseUrl = hostedConfig.finalizerDatabaseUrl.replace(":5432", ":6543");
      expect(() => createSnapProtectedReviewHandler(value)).toThrow("The protected review service is not configured.");
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
    });
  it.each(["wrong_host", "wrong_origin", "forwarded", "x-forwarded-host", "x-forwarded-proto"])("rejects hosted %s before Auth", async kind => {
    const headers: Record<string, string> = { Host: new URL(hostedConfig.publicOrigin).host };
    if (kind === "wrong_host") headers.Host = "untrusted.invalid";
    else if (kind === "wrong_origin") headers.Origin = "https://untrusted.invalid";
    else headers[kind] = "untrusted.invalid";
    const result = await createSnapProtectedReviewHandler(hostedConfig)(new Request(hostedConfig.publicOrigin + path, { headers }));
    expect(result.status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("closed isolated canonical PDF upload", () => {
  function upload(body: BodyInit = Uint8Array.from(bytes), headers: Record<string, string> = {}, signal?: AbortSignal) {
    const init: RequestInit & { duplex?: "half" } = { method: "POST", body, signal, headers: {
      Host: new URL(config.publicOrigin).host, Origin: config.publicOrigin, Cookie: "caselink-parent-auth=synthetic-cookie",
      "Content-Type": "application/pdf", "Content-Length": String(metadata.intent.byteLength), ...headers,
    }, ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}) };
    return new Request(config.publicOrigin + path, init);
  }
  it("authorizes before reading and stages exact synthetic bytes once, without certifying completion", async () => {
    metadata.state = "authorized";
    let captured: Uint8Array | undefined;
    mocks.stage.mockImplementation(async (intent, value, options) => {
      expect(intent).toEqual(metadata.intent); expect(hash(value)).toBe(metadata.intent.contentSha256);
      expect(mocks.getUser).toHaveBeenCalledOnce(); expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenNthCalledWith(2, "parent_get_snap_final_packet_authorization", {
        p_request_id: requestId, p_packet_id: packetId, p_expected_version: 2,
      });
      expect(options).toEqual(expect.objectContaining({ deadline: expect.any(Date), signal: expect.any(AbortSignal) }));
      captured = value;
      return { state: "stored", binding: { ...intent, expiresAt: new Date(Date.now() + 60000).toISOString() } };
    });
    const result = await createSnapProtectedReviewHandler(config)(upload());
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ state: "stored", packetId });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.stage).toHaveBeenCalledOnce(); expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
    expect(captured?.every(value => value === 0)).toBe(true);
    expect(mocks.rpc.mock.calls.some(([name]) => /submission|personal_act/.test(name))).toBe(false);
  });
  it("reconciles an already stored identical POST read-only without resealing", async () => {
    const result = await createSnapProtectedReviewHandler(config)(upload());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: "stored", packetId });
    expect(mocks.reconcile).toHaveBeenCalledOnce(); expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("returns uncertain storage without staging again or inferring absence", async () => {
    metadata.state = "authorized"; mocks.stage.mockResolvedValue({ state: "commit_unknown", intent: metadata.intent });
    const result = await createSnapProtectedReviewHandler(config)(upload());
    expect(result.status).toBe(202); expect(await result.json()).toEqual({ state: "storage_unconfirmed", packetId });
    expect(mocks.stage).toHaveBeenCalledOnce(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each([true, false])("contains a staging exception and only reconciles (stored=%s)", async stored => {
    metadata.state = "authorized"; mocks.stage.mockRejectedValue(new Error(canary));
    if (!stored) mocks.reconcile.mockResolvedValue({ state: "commit_unknown", intent: metadata.intent });
    const result = await createSnapProtectedReviewHandler(config)(upload());
    expect(result.status).toBe(stored ? 200 : 202);
    expect(await result.json()).toEqual({ state: stored ? "stored" : "storage_unconfirmed", packetId });
    expect(mocks.stage).toHaveBeenCalledOnce(); expect(mocks.reconcile).toHaveBeenCalledOnce();
  });
  it.each(["missing_origin", "foreign_origin", "cross_site", "missing_length", "zero", "negative", "malformed", "too_large", "media_type", "encoding", "transfer"])("denies %s upload before Auth/body access", async kind => {
    const value = upload();
    if (kind === "missing_origin") value.headers.delete("origin");
    if (kind === "foreign_origin") value.headers.set("origin", "https://untrusted.example");
    if (kind === "cross_site") value.headers.set("sec-fetch-site", "cross-site");
    if (kind === "missing_length") value.headers.delete("content-length");
    if (kind === "zero") value.headers.set("content-length", "0");
    if (kind === "negative") value.headers.set("content-length", "-1");
    if (kind === "malformed") value.headers.set("content-length", "+12");
    if (kind === "too_large") value.headers.set("content-length", String(10 * 1024 * 1024 + 1));
    if (kind === "media_type") value.headers.set("content-type", "application/json");
    if (kind === "encoding") value.headers.set("content-encoding", "gzip");
    if (kind === "transfer") value.headers.set("transfer-encoding", "chunked");
    const result = await createSnapProtectedReviewHandler(config)(value);
    expect(result.status).toBe(400); expect(value.bodyUsed).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(["signed_out", "owner", "changed_permission", "declared_size"])("rejects %s before consuming private bytes", async kind => {
    if (kind === "signed_out") mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "owner") metadata.intent.ownerId = id(20);
    if (kind === "changed_permission") mocks.rpc.mockImplementation(async name => name === "parent_ensure_account" ? { data: id(7), error: null } : { data: null, error: { code: "42501", message: canary } });
    const value = upload(undefined, kind === "declared_size" ? { "Content-Length": "1" } : {});
    const result = await createSnapProtectedReviewHandler(config)(value);
    expect(result.status).toBeGreaterThanOrEqual(400); expect(value.bodyUsed).toBe(false);
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(["short", "long", "hash", "structure"])("rejects actual %s bytes without storing or leaking them", async kind => {
    metadata.state = "authorized";
    let body = Uint8Array.from(bytes);
    if (kind === "short") body = body.slice(0, -1);
    if (kind === "long") { const longer = new Uint8Array(body.length + 1); longer.set(body); body = longer; }
    if (kind === "hash") body[100] ^= 1;
    if (kind === "structure") { body = new TextEncoder().encode("%PDF-" + canary); metadata.intent.byteLength = body.length; metadata.intent.contentSha256 = hash(body); }
    const result = await createSnapProtectedReviewHandler(config)(upload(body));
    expect(result.status).toBeGreaterThanOrEqual(400); expect(await result.text()).not.toContain(canary);
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("cancels a stalled upload and zeroes received chunks without storing", async () => {
    metadata.state = "authorized";
    const received = Uint8Array.from(bytes.subarray(0, 100)), controller = new AbortController();
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<void>(resolve => { cancel = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(received); }, cancel() { cancel?.(); } });
    const pending = createSnapProtectedReviewHandler(config)(upload(body, {}, controller.signal));
    await vi.waitFor(() => expect(received.every(value => value === 0)).toBe(true)); controller.abort();
    expect((await pending).status).toBe(503); await cancelled;
    expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});

describe("closed isolated direct construction channel (synthetic finalizer replies)", () => {
  const directPath = path.replace("?", "/direct-completion?");
  const syntheticInput = { identifiers: [{ personId: id(6), kind: "ssn", value: "000000000" }], privateCanary: canary };
  function completion(body: BodyInit = JSON.stringify(syntheticInput), headers: Record<string, string> = {}, signal?: AbortSignal) {
    return new Request(config.publicOrigin + directPath, { method: "POST", body, signal,
      ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
      headers: { Host: new URL(config.publicOrigin).host, Origin: config.publicOrigin, Cookie: "caselink-parent-auth=synthetic-cookie",
        "Content-Type": "application/json", "Content-Length": String(typeof body === "string" ? Buffer.byteLength(body) : JSON.stringify(syntheticInput).length), ...headers } });
  }
  it("rejects identifier entry in the exact controlled test before invoking the finalizer", async () => {
    metadata.state = "authorized";
    const controlledTest = { requestId, snapshotHash: String(metadata.intent.snapshotHash) };
    const body = JSON.stringify({ ...syntheticInput, requestId, snapshotHash: controlledTest.snapshotHash });
    const result = await createSnapProtectedReviewHandler({ ...config, controlledTest })(completion(body));
    expect(result.status).toBe(400); expect(mocks.direct).not.toHaveBeenCalled();
  });
  it("limits controlled uploads to the approved snapshot and excludes legacy PDF uploads", async () => {
    metadata.state = "authorized";
    const controlledTest = { requestId, snapshotHash: "f".repeat(64) };
    expect((await createSnapProtectedReviewHandler({ ...config, controlledTest })(completion())).status).toBe(403);
    expect(mocks.direct).not.toHaveBeenCalled();
  });
  it("allows only deferred identifier metadata in a controlled upload", async () => {
    metadata.state = "authorized";
    const controlledTest = { requestId, snapshotHash: String(metadata.intent.snapshotHash) };
    const body = JSON.stringify({ requestId, snapshotHash: controlledTest.snapshotHash,
      identifiers: [{ personId: id(6), kind: "provide_to_agency_later" }] });
    mocks.direct.mockImplementation(async intent => ({ state: "stored", binding: { ...intent, expiresAt: new Date(Date.now() + 60000).toISOString() } }));
    const result = await createSnapProtectedReviewHandler({ ...config, controlledTest })(completion(body));
    expect(result.status).toBe(201); expect(mocks.direct).toHaveBeenCalledOnce();
  });
  it("checks current owned authority before reading JSON and supplies only the pinned public template to the isolated finalizer", async () => {
    metadata.state = "authorized";
    const raw = Buffer.from(JSON.stringify(syntheticInput));
    let template: Uint8Array | undefined;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(raw); controller.close(); } });
    mocks.direct.mockImplementation(async (intent, input, value, options) => {
      expect(intent).toEqual(metadata.intent); expect(input).toEqual(syntheticInput);
      expect(mocks.getUser).toHaveBeenCalledOnce(); expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(mocks.rpc).toHaveBeenNthCalledWith(2, "parent_get_snap_direct_packet_authorization", {
        p_request_id: requestId, p_packet_id: packetId, p_expected_version: 2,
      });
      expect(value.byteLength).toBe(SNAP_DRAFT_CONTRACT.byteLength); expect(hash(value)).toBe(SNAP_DRAFT_CONTRACT.sha256);
      expect(options).toEqual(expect.objectContaining({ deadline: expect.any(Date), signal: expect.any(AbortSignal) }));
      template = value;
      return { state: "stored", binding: { ...intent, expiresAt: new Date(Date.now() + 60000).toISOString() } };
    });
    const result = await createSnapProtectedReviewHandler(config)(completion(stream));
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ state: "stored", packetId });
    expect(raw.every(value => value === 0)).toBe(true); expect(template?.every(value => value === 0)).toBe(true);
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.reconcileDirect).not.toHaveBeenCalled(); expect(mocks.rpc.mock.calls.some(([name]) => /submission|personal_act/.test(name))).toBe(false);
  });
  it("uses the same exact construction validation for an already stored POST", async () => {
    const result = await createSnapProtectedReviewHandler(config)(completion());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: "stored", packetId });
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.reconcileDirect).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("keeps an uncertain construction unconfirmed and recovers only with a later read-only request", async () => {
    metadata.state = "authorized"; mocks.direct.mockResolvedValue({ state: "commit_unknown", intent: metadata.intent });
    const handler = createSnapProtectedReviewHandler(config), uncertain = await handler(completion());
    expect(uncertain.status).toBe(202); expect(await uncertain.json()).toEqual({ state: "storage_unconfirmed", packetId });
    expect(mocks.reconcileDirect).not.toHaveBeenCalled();
    const recovered = await handler(request({ path: directPath }));
    expect(recovered.status).toBe(200); expect(await recovered.json()).toEqual({ state: "stored", packetId });
    expect(mocks.reconcileDirect).toHaveBeenCalledOnce(); expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("does not infer absence or construct again when read-only recovery cannot verify both records", async () => {
    mocks.reconcileDirect.mockResolvedValue({ state: "commit_unknown", intent: metadata.intent });
    const result = await createSnapProtectedReviewHandler(config)(request({ path: directPath }));
    expect(result.status).toBe(202); expect(await result.json()).toEqual({ state: "storage_unconfirmed", packetId });
    expect(mocks.direct).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["POST", "GET"])("requires linked acquisition metadata before direct %s consumes private input or decrypts", async method => {
    mocks.rpc.mockImplementation(async name => {
      if (name === "parent_ensure_account") return { data: id(7), error: null };
      if (name === "parent_get_snap_final_packet_authorization") return { data: structuredClone(metadata), error: null };
      return { data: null, error: { code: "42501", message: canary } };
    });
    const value = method === "POST" ? completion() : request({ path: directPath });
    const result = await createSnapProtectedReviewHandler(config)(value);
    expect(result.status).toBe(403); expect(value.bodyUsed).toBe(false); expect(await result.text()).not.toContain(canary);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "parent_get_snap_direct_packet_authorization", {
      p_request_id: requestId, p_packet_id: packetId, p_expected_version: 2,
    });
    expect(mocks.direct).not.toHaveBeenCalled(); expect(mocks.reconcileDirect).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it.each(["missing_origin", "foreign_origin", "cross_site", "missing_length", "zero", "malformed_length", "large", "pdf", "encoding", "transfer"])("rejects %s before Auth or JSON body access", async kind => {
    const value = completion();
    if (kind === "missing_origin") value.headers.delete("origin");
    if (kind === "foreign_origin") value.headers.set("origin", "https://untrusted.example");
    if (kind === "cross_site") value.headers.set("sec-fetch-site", "cross-site");
    if (kind === "missing_length") value.headers.delete("content-length");
    if (kind === "zero") value.headers.set("content-length", "0");
    if (kind === "malformed_length") value.headers.set("content-length", "+12");
    if (kind === "large") value.headers.set("content-length", String(256 * 1024 + 1));
    if (kind === "pdf") value.headers.set("content-type", "application/pdf");
    if (kind === "encoding") value.headers.set("content-encoding", "gzip");
    if (kind === "transfer") value.headers.set("transfer-encoding", "chunked");
    expect((await createSnapProtectedReviewHandler(config)(value)).status).toBe(400);
    expect(value.bodyUsed).toBe(false); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.direct).not.toHaveBeenCalled();
  });
  it.each(["signed_out", "owner", "changed_permission", "expired"])("rejects %s authority before JSON body access", async kind => {
    if (kind === "signed_out") mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (kind === "owner") metadata.intent.ownerId = id(20);
    if (kind === "changed_permission") mocks.rpc.mockImplementation(async name => name === "parent_ensure_account" ? { data: id(7), error: null } : { data: null, error: { code: "42501" } });
    if (kind === "expired") metadata.authorizationExpiresAt = new Date(0).toISOString();
    const value = completion(), result = await createSnapProtectedReviewHandler(config)(value);
    expect(result.status).toBeGreaterThanOrEqual(400); expect(value.bodyUsed).toBe(false); expect(mocks.direct).not.toHaveBeenCalled();
  });
  it.each(["malformed_json", "invalid_utf8", "short", "long"])("rejects %s without invoking construction or echoing private input", async kind => {
    let body: BodyInit = kind === "malformed_json" ? "{" + canary : JSON.stringify(syntheticInput);
    if (kind === "invalid_utf8") body = Uint8Array.from([0xff]);
    const headers: Record<string, string> = kind === "short" ? { "Content-Length": "1" } : kind === "long" ? { "Content-Length": "262144" } : {};
    const value = completion(body, kind === "invalid_utf8" ? { "Content-Length": "1" } : headers);
    const result = await createSnapProtectedReviewHandler(config)(value);
    expect(result.status).toBe(400); expect(await result.text()).not.toContain(canary); expect(mocks.direct).not.toHaveBeenCalled();
  });
  it("contains a completion rejection without acknowledging a previously stored packet or retrying", async () => {
    mocks.direct.mockRejectedValue(new Error(canary));
    const result = await createSnapProtectedReviewHandler(config)(completion());
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(canary);
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.reconcileDirect).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("cancels a stalled JSON body and clears received chunks", async () => {
    const raw = Buffer.from("{"), controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(raw); }, cancel() { cancelled = true; } });
    const pending = createSnapProtectedReviewHandler(config)(completion(body, { "Content-Length": "100" }, controller.signal));
    await vi.waitFor(() => expect(raw[0]).toBe(0)); controller.abort();
    expect((await pending).status).toBe(503); expect(cancelled).toBe(true); expect(mocks.direct).not.toHaveBeenCalled();
  });
  it("finishes a complete authorized upload after navigation without extending its original deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    metadata.state = "authorized";
    const disconnected = new AbortController(), startedAt = Date.now();
    let template: Uint8Array | undefined;
    mocks.direct.mockImplementation(async (intent, _input, value, options) => {
      template = value;
      disconnected.abort();
      expect(options.signal.aborted).toBe(false);
      expect(options.deadline.getTime()).toBe(startedAt + 25000);
      return { state: "stored", binding: { ...intent, expiresAt: metadata.authorizationExpiresAt } };
    });
    const result = await createSnapProtectedReviewHandler(config)(completion(undefined, {}, disconnected.signal));
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ state: "stored", packetId });
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(template?.every(value => value === 0)).toBe(true);
    expect(mocks.reconcileDirect).not.toHaveBeenCalled();
  });
  it("still stops at the original server deadline after a complete upload and disconnection", async () => {
    const elapsed = new AbortController(), disconnected = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(elapsed.signal);
    let template: Uint8Array | undefined;
    mocks.direct.mockImplementation(async (_intent, _input, value, options) => {
      template = value; disconnected.abort(); expect(options.signal.aborted).toBe(false);
      elapsed.abort(); expect(options.signal.aborted).toBe(true); options.signal.throwIfAborted();
    });
    const result = await createSnapProtectedReviewHandler(config)(completion(undefined, {}, disconnected.signal));
    expect(result.status).toBe(503); expect(template?.every(value => value === 0)).toBe(true);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(25000); expect(mocks.reconcileDirect).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.env.CASELINK_PARENT_TEST_NATIVE_HTTP !== "1")("native isolated review HTTP server (synthetic Auth/metadata; no database/provider)", () => {
  async function send(rawPath = path, headers: Record<string, string> = {}, body?: Uint8Array, settings = config) {
    const server = createSnapProtectedReviewServer(settings); servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing test listener.");
    return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
      const client = httpRequest({ hostname: "127.0.0.1", port: address.port, path: rawPath, method: body ? "POST" : "GET", headers: { Host: new URL(settings.publicOrigin).host, ...headers }, agent: false }, response => {
        const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(Buffer.from(chunk))); response.once("error", reject);
        response.once("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
      }); client.once("error", reject); client.end(body);
    });
  }
  it("reconstructs hosted HTTPS from configuration behind a loopback listener and rejects forwarded overrides", async () => {
    mocks.create.mockImplementation((url, _key, options) => {
      expect(url).toBe(hostedConfig.supabaseOrigin);
      options.cookies.setAll([{ name: "caselink-parent-auth", value: "synthetic", options: {} }]);
      return { auth: { getUser: mocks.getUser }, rpc: mocks.rpc };
    });
    const result = await send(path, {}, undefined, hostedConfig);
    expect(result.status).toBe(200); expect(result.body).toEqual(Buffer.from(bytes));
    expect((result.headers["set-cookie"] as string[])[0]).toContain("Secure");
    expect(mocks.open).toHaveBeenCalledWith(metadata.intent, expect.objectContaining({ connectionString: hostedConfig.finalizerDatabaseUrl }));
    mocks.create.mockClear();
    expect((await send(path, { "X-Forwarded-Proto": "https" }, undefined, hostedConfig)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("serves exact PDF bytes and multiple rotated cookies through a native listener", async () => {
    mocks.create.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([{ name: "caselink-parent-auth.0", value: "synthetic0", options: {} }, { name: "caselink-parent-auth.1", value: "synthetic1", options: {} }]);
      return { auth: { getUser: mocks.getUser }, rpc: mocks.rpc };
    });
    const result = await send(); expect(result.status).toBe(200); expect(result.body).toEqual(Buffer.from(bytes)); expect(result.headers["set-cookie"]).toHaveLength(2);
  });
  it("rejects the original ambiguous raw path before URL normalization or Auth", async () => {
    expect((await send("/x/../" + path.slice(1))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("independently rejects a foreign Host without relying on the frontdoor", async () => {
    expect((await send(path, { Host: "untrusted.example" })).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("streams exact bounded upload bytes through the native listener and only acknowledges storage", async () => {
    metadata.state = "authorized";
    const result = await send(path, { Origin: config.publicOrigin, "Content-Type": "application/pdf", "Content-Length": String(bytes.length) }, Uint8Array.from(bytes));
    expect(result.status).toBe(201); expect(JSON.parse(result.body.toString())).toEqual({ state: "stored", packetId });
    expect(mocks.stage).toHaveBeenCalledOnce(); expect(mocks.stage.mock.calls[0][1].every((value: number) => value === 0)).toBe(true);
  });
  it("rejects changed bytes on a stored HTTP replay without changing the canonical packet", async () => {
    const changed = Uint8Array.from(bytes); changed[100] ^= 1;
    const result = await send(path, { Origin: config.publicOrigin, "Content-Type": "application/pdf", "Content-Length": String(changed.length) }, changed);
    expect(result.status).toBe(400); expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("streams bounded JSON only through the distinct protected construction path", async () => {
    metadata.state = "authorized";
    const body = Buffer.from(JSON.stringify({ syntheticConstruction: canary }));
    const result = await send(path.replace("?", "/direct-completion?"), { Origin: config.publicOrigin,
      "Content-Type": "application/json", "Content-Length": String(body.length) }, body);
    expect(result.status).toBe(201); expect(JSON.parse(result.body.toString())).toEqual({ state: "stored", packetId });
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.stage).not.toHaveBeenCalled(); expect(mocks.reconcileDirect).not.toHaveBeenCalled();
  });
  it("reconciles construction through a native GET without consuming or constructing a body", async () => {
    const result = await send(path.replace("?", "/direct-completion?"));
    expect(result.status).toBe(200); expect(JSON.parse(result.body.toString())).toEqual({ state: "stored", packetId });
    expect(mocks.reconcileDirect).toHaveBeenCalledOnce(); expect(mocks.direct).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("continues bounded construction after a real socket closes following full JSON receipt", async () => {
    const entered = Promise.withResolvers<AbortSignal>(), release = Promise.withResolvers<void>(), completed = Promise.withResolvers<void>(), serverClosed = Promise.withResolvers<void>();
    let template: Uint8Array | undefined;
    mocks.direct.mockImplementation(async (intent, _input, value, options) => {
      template = value; entered.resolve(options.signal);
      await release.promise;
      try {
        options.signal.throwIfAborted();
        return { state: "stored", binding: { ...intent, expiresAt: metadata.authorizationExpiresAt } };
      } finally { completed.resolve(); }
    });
    const server = createSnapProtectedReviewServer(config); servers.push(server);
    server.once("connection", socket => socket.once("close", () => serverClosed.resolve()));
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing test listener.");
    const body = Buffer.from(JSON.stringify({ syntheticConstruction: canary }));
    const client = httpRequest({ hostname: "127.0.0.1", port: address.port, path: path.replace("?", "/direct-completion?"), method: "POST", agent: false,
      headers: { Host: new URL(config.publicOrigin).host, Origin: config.publicOrigin, "Content-Type": "application/json", "Content-Length": String(body.length) } });
    client.on("error", () => {});
    const closed = new Promise<void>(resolve => client.once("close", resolve));
    client.end(body);
    const workSignal = await entered.promise;
    client.destroy(); await closed; await serverClosed.promise;
    // Let the server observe the disconnect before the held synthetic finalizer continues.
    await new Promise<void>(resolve => setImmediate(resolve));
    try { expect(workSignal.aborted).toBe(false); } finally { release.resolve(); }
    await completed.promise;
    await vi.waitFor(() => expect(template?.every(value => value === 0)).toBe(true));
    expect(mocks.direct).toHaveBeenCalledOnce(); expect(mocks.reconcileDirect).not.toHaveBeenCalled();
  });
});
