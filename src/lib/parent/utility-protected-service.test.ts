import { beforeEach, describe, expect, it, vi } from "vitest";
import { UTILITY_PROTECTED_INPUT_NOTICE_VERSION } from "./utility-protected-input-contract";
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), rpc: vi.fn(), store: vi.fn(), open: vi.fn(), context: vi.fn(), inspect: vi.fn(), prepared: vi.fn(), owned: vi.fn() }));
vi.mock("@supabase/ssr", async original => ({ ...await original<typeof import("@supabase/ssr")>(), createServerClient: mocks.create }));
vi.mock("./utility-protected-client", async original => ({ ...await original<typeof import("./utility-protected-client")>(), storeUtilityProtectedInput: mocks.store, withUtilityProtectedInput: mocks.open, getUtilityProtectedApplicationContext: mocks.context }));
vi.mock("./documents", () => ({ inspectDocument: mocks.inspect }));
vi.mock("./utility-prepared-artifact-client", () => ({ readUtilityPreparedArtifactForOwner: mocks.prepared }));
import { createUtilityProtectedHandler } from "./utility-protected-service";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = { publicOrigin: "http://127.0.0.1:3200", supabaseOrigin: "http://127.0.0.1:55321", supabasePublicKey: "sb_publishable_synthetic",
  utilityDatabaseUrl: "postgresql://caselink_utility_synthetic:synthetic-local-secret@127.0.0.1:55322/postgres" };
let reference: Record<string, unknown>, metadata: Record<string, unknown>;
const path = `/protected/utilities/requests/${id(1)}/inputs/${id(2)}?expectedVersion=2`;
const canary = "%PDF-PRIVATE-UTILITY-RAW-CANARY";
function request(method = "GET", body?: string, target = path, extra: Record<string, string> = {}) {
  return new Request(config.publicOrigin + target, { method, headers: { Host: "127.0.0.1:3200", Cookie: "caselink-parent-auth=synthetic", ...(method === "GET" ? {} : { Origin: config.publicOrigin, "Content-Length": String(body?.length ?? 0), "Content-Type": "application/pdf" }), ...extra }, body: method === "GET" ? undefined : body });
}
beforeEach(() => {
  vi.clearAllMocks(); reference = { inputId: id(2), authorizationId: id(3), ownerId: id(4), requestId: id(1), requestVersion: 2, programId: "peco-cap", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64),
    purpose: "income_proof", targets: [{ subjectId: id(6), sourceId: id(7), field: "income" }], state: "authorized", consentedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), validation: null };
  metadata = { ...reference, mediaType: "application/pdf", byteLength: canary.length };
  mocks.create.mockReturnValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.owned }) }) }) });
  mocks.owned.mockResolvedValue({ data: { id: id(1), version: 2 }, error: null });
  mocks.user.mockResolvedValue({ data: { user: { id: id(4), email: "synthetic@example.invalid", email_confirmed_at: "2026-11-13" } }, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "parent_ensure_account" ? id(4) : name === "parent_get_utility_protected_inputs" ? [reference] : name === "parent_authorize_utility_protected_input" ? reference : metadata, error: null }));
  mocks.store.mockResolvedValue({ state: "stored", reference: { ...reference, state: "stored" } }); mocks.inspect.mockResolvedValue({ mediaType: "application/pdf", pageCount: 1 });
});
describe("isolated local utility HTTP capture (no provider, model or ordinary Storage)", () => {
  it("downloads only the owned prepared PDF through the private listener and erases its temporary copy", async () => {
    const bytes = new TextEncoder().encode(canary); mocks.prepared.mockResolvedValue({ bytes, operation: {} });
    const result = await createUtilityProtectedHandler(config)(request("GET", undefined, `/protected/utilities/requests/${id(1)}/prepared/${id(9)}?expectedVersion=2`));
    expect(result.status).toBe(200); expect(await result.text()).toBe(canary);
    expect(result.headers.get("content-disposition")).toContain("attachment;"); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.prepared).toHaveBeenCalledWith({ packetId: id(9), ownerId: id(4), requestId: id(1) }, expect.not.objectContaining({ job: expect.anything() }));
    expect(mocks.owned).toHaveBeenCalledTimes(2); expect(bytes.every(byte => byte === 0)).toBe(true);
  });
  it.each(["foreign", "version", "after_read", "session_after_read"])("hides prepared bytes after changed %s authority", async kind => {
    const bytes = new TextEncoder().encode(canary);
    if (kind === "foreign") mocks.owned.mockResolvedValue({ data: null, error: null });
    if (kind === "version") mocks.owned.mockResolvedValue({ data: { id: id(1), version: 3 }, error: null });
    mocks.prepared.mockImplementation(async () => {
      if (kind === "after_read") mocks.owned.mockResolvedValue({ data: { id: id(1), version: 3 }, error: null });
      if (kind === "session_after_read") mocks.user.mockResolvedValue({ data: { user: null }, error: null });
      return { bytes, operation: {} };
    });
    const result = await createUtilityProtectedHandler(config)(request("GET", undefined, `/protected/utilities/requests/${id(1)}/prepared/${id(9)}?expectedVersion=2`));
    expect(result.status).toBe(403); expect(await result.text()).not.toContain(canary);
    if (["foreign", "version"].includes(kind)) expect(mocks.prepared).not.toHaveBeenCalled();
    else expect(bytes.every(byte => byte === 0)).toBe(true);
  });
  it("checks cookie account + exact authority before reading bytes, then checks current authority again after inspection/storage", async () => {
    const input = request("PUT", canary), read = vi.spyOn(input, "body", "get");
    mocks.rpc.mockImplementation(async (name: string) => { if (name === "parent_check_utility_protected_input") expect(read).not.toHaveBeenCalled(); return { data: name === "parent_ensure_account" ? id(4) : metadata, error: null }; });
    // Only the first check precedes the read; later checks are deliberately repeated.
    let checks = 0; mocks.rpc.mockImplementation(async (name: string) => { if (name === "parent_check_utility_protected_input" && checks++ === 0) expect(read).not.toHaveBeenCalled(); return { data: name === "parent_ensure_account" ? id(4) : metadata, error: null }; });
    const result = await createUtilityProtectedHandler(config)(input);
    expect(result.status).toBe(201); expect(await result.json()).toMatchObject({ inputId: id(2), state: "stored" });
    expect(checks).toBeGreaterThanOrEqual(4); expect(mocks.inspect).toHaveBeenCalledOnce(); expect(mocks.store).toHaveBeenCalledOnce();
    expect(mocks.user.mock.calls.length).toBeGreaterThanOrEqual(4); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.store.mock.calls[0][1].every((value: number) => value === 0)).toBe(true);
  });
  it.each(["owner", "request", "input", "version", "expired", "extra", "closed"])("denies changed %s authorization before reading private body", async kind => {
    if (kind === "owner") metadata.ownerId = id(8); if (kind === "request") metadata.requestId = id(8); if (kind === "input") metadata.inputId = id(8);
    if (kind === "version") metadata.requestVersion = 3; if (kind === "expired") metadata.expiresAt = new Date(0).toISOString(); if (kind === "extra") metadata.rawIdentifier = canary;
    if (kind === "closed") mocks.rpc.mockImplementation(async name => ({ data: name === "parent_ensure_account" ? id(4) : null, error: name === "parent_ensure_account" ? null : { code: "42501", message: canary } }));
    const input = request("PUT", canary), read = vi.spyOn(input, "body", "get"), result = await createUtilityProtectedHandler(config)(input);
    expect(result.status).toBe(403); expect(await result.text()).not.toContain(canary); expect(read).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("records only exact explicit consent metadata before any raw upload", async () => {
    const authorization = { requestId: id(1), expectedVersion: 2, programId: "peco-cap", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64), inputId: id(2),
      purpose: "income_proof", targets: reference.targets, mediaType: "application/pdf", byteLength: canary.length, noticeVersion: UTILITY_PROTECTED_INPUT_NOTICE_VERSION,
      consentAccepted: true, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    const result = await createUtilityProtectedHandler(config)(request("POST", JSON.stringify(authorization), `/protected/utilities/requests/${id(1)}/inputs?expectedVersion=2`, { "Content-Type": "application/json" }));
    expect(result.status).toBe(201); expect(mocks.rpc).toHaveBeenCalledWith("parent_authorize_utility_protected_input", expect.objectContaining({ p_consent_accepted: true, p_subject_authority_declared: true, p_account_authority_declared: true, p_targets: reference.targets }));
    expect(mocks.store).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(canary);
  });
  it("stops when identity is revoked while the private parser is awaited", async () => {
    mocks.inspect.mockImplementation(async () => { mocks.user.mockResolvedValue({ data: { user: null }, error: null }); return { mediaType: "application/pdf", pageCount: 1 }; });
    const result = await createUtilityProtectedHandler(config)(request("PUT", canary)); expect(result.status).toBe(403); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("stops if exact scope closes while parser is awaited", async () => {
    mocks.inspect.mockImplementation(async () => { mocks.rpc.mockImplementation(async name => ({ data: name === "parent_ensure_account" ? id(4) : null, error: name === "parent_ensure_account" ? null : { code: "42501" } })); return { mediaType: "application/pdf", pageCount: 1 }; });
    expect((await createUtilityProtectedHandler(config)(request("PUT", canary))).status).toBe(403); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("returns an unknown commit without staging again, and reconciles status read-only", async () => {
    mocks.store.mockResolvedValue({ state: "commit_unknown", inputId: id(2) }); const result = await createUtilityProtectedHandler(config)(request("PUT", canary));
    expect(result.status).toBe(202); expect(await result.json()).toEqual({ state: "storage_unconfirmed", inputId: id(2) }); expect(mocks.store).toHaveBeenCalledOnce();
    mocks.store.mockClear(); metadata.state = "stored"; const status = await createUtilityProtectedHandler(config)(request());
    expect(await status.json()).toMatchObject({ state: "stored" }); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("permits owner revocation after purpose closure without requiring raw-read permission", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "parent_ensure_account" ? id(4) : name === "parent_revoke_utility_protected_input" ? 3 : null, error: name === "parent_check_utility_protected_input" ? { code: "42501" } : null }));
    const result = await createUtilityProtectedHandler(config)(request("DELETE")); expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_revoke_utility_protected_input", { p_request_id: id(1), p_input_id: id(2) });
    expect(mocks.rpc.mock.calls.map(call => call[0])).not.toContain("parent_check_utility_protected_input");
  });
  it("downloads an owned original only after fresh checks and clears the temporary private copy", async () => {
    metadata.state = "stored"; const original = new TextEncoder().encode(canary);
    mocks.open.mockImplementation(async (_id, _options, action) => action({ binding: { ...metadata }, snapshot: {}, bytes: original }));
    const result = await createUtilityProtectedHandler(config)(request("GET", undefined, path.replace("?", "/original?")));
    expect(result.status).toBe(200); expect(await result.text()).toBe(canary); expect(result.headers.get("content-disposition")).toContain("attachment;");
    expect(mocks.open).toHaveBeenCalledWith(id(2), expect.anything(), expect.any(Function), false);
  });
  it("does not let a caller claim validation or select arbitrary protected preparation code", async () => {
    const validate = vi.fn(); const handle = createUtilityProtectedHandler(config, { validate });
    expect((await handle(request("POST", '{"validated":true}', path.replace("?", "/validate?"), { "Content-Type": "application/json" }))).status).toBe(405); expect(validate).not.toHaveBeenCalled();
    expect((await createUtilityProtectedHandler(config)(request("POST", "{}", `/protected/utilities/requests/${id(1)}/prepare?expectedVersion=2`, { "Content-Type": "application/json" }))).status).toBe(405);
  });
  it.each<Record<string, string>>([{ Authorization: "Bearer raw-canary" }, { Origin: "https://other.example" }, { "Content-Encoding": "gzip" }, { "X-Forwarded-Host": "untrusted.example" }])("rejects ambiguous or foreign request framing before Auth", async extra => {
    const result = await createUtilityProtectedHandler(config)(request("PUT", canary, path, extra)); expect(result.status).toBe(400); expect(mocks.user).not.toHaveBeenCalled();
  });
});
