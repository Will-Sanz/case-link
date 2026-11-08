// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest, fixtureSnapCaptureIntent, fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import type { SnapPacketAuthorizationResult } from "@/lib/parent/snap-packet-contract";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
const mocks = vi.hoisted(() => ({ load: vi.fn(), recover: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/parent/snap-review-file", () => ({ loadSnapPacketReviewFile: mocks.load }));
vi.mock("@/lib/parent/snap-direct-completion-transport", () => ({ recoverSnapDirectCompletion: mocks.recover }));
vi.mock("./snap-review-pdf", () => ({ SnapReviewPdf: () => <div role="img" aria-label="Exact stored PDF test viewer"/> }));
import { SnapPreparedApplication } from "./snap-prepared-application";

const now = new Date("2026-11-05T20:00:00.000Z"), snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(now));
const request = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
  mandate: fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: "2026-11-05T20:30:00.000Z" }), required_actions: [] });
const intent = { ...fixtureSnapCaptureIntent(), requestId: request.id, requestVersion: request.version, snapshotId: snapshot.id };
const context = { requestVersion: request.version, snapshotId: snapshot.id, snapshotHash: intent.snapshotHash, source: snapshot.source,
  applyingSubjectIds: snapshot.details.household!.filter(person => person.requestingSnap).map(person => person.id) };
const authorization = (): SnapPacketAuthorizationResult => ({ intent: { ...intent }, subjectIds: context.applyingSubjectIds,
  consentedAt: "2026-11-05T19:59:00.000Z", authorizationExpiresAt: "2026-11-05T20:05:00.000Z", authorityDeclaration: "parent_declared_household_data_authority", state: "stored" });
const capture = { packetId: intent.packetId, requestVersion: request.version, state: "pending", reason: null };
const bytes = () => new Uint8Array([37, 80, 68, 70]); // Explicit loader double; PDF bytes/rendering are not proved by this UI suite.
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
type ApiOptions = { capture?: unknown; authorization?: unknown; context?: unknown; directStatus?: number; post?: (url: string, init: RequestInit) => unknown };
function api(options: ApiOptions = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return options.post ? options.post(url, init) : json({ ok: true, requestVersion: request.version + 1 });
    if (url.includes("/snap-application/capture?")) return json({ ok: true, capture: Object.hasOwn(options, "capture") ? options.capture : capture });
    if (url.includes("/snap-application/context?")) return json({ ok: true, context: options.context ?? context });
    if (url.includes("/snap-direct-packet?")) return options.directStatus ? json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, options.directStatus)
      : json({ ok: true, authorization: Object.hasOwn(options, "authorization") ? options.authorization : authorization() });
    throw new Error("Unexpected synthetic endpoint");
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
const posts = (fetcher: ReturnType<typeof api>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); mocks.load.mockImplementation(async () => bytes());
  mocks.recover.mockResolvedValue({ state: "storage_unconfirmed", packetId: intent.packetId }); let urls = 0;
  mocks.create.mockImplementation(() => `blob:https://caselink.test/saved-${++urls}`);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = mocks.create; static revokeObjectURL = mocks.revoke; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("read-only prepared application return and correction", () => {
  it("automatically inspects current capture/context/discovery and opens exact stored bytes without any write or approval", async () => {
    const privateBytes = bytes(); mocks.load.mockResolvedValue(privateBytes); const fetcher = api();
    render(<SnapPreparedApplication request={request} snapshot={snapshot}/>);
    expect(screen.getByRole("status", { name: "Checking your saved application" })).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Open exact saved PDF full size" });
    expect(screen.getByRole("img", { name: "Exact stored PDF test viewer" })).toBeTruthy(); expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(fetcher.mock.calls.map(([url]) => url.split("?")[0])).toEqual([`/api/parent/requests/${request.id}/snap-application/capture`, `/api/parent/requests/${request.id}/snap-application/context`, `/api/parent/requests/${request.id}/snap-direct-packet`]);
    expect(mocks.load.mock.calls[0][0]).toEqual(authorization()); expect([...privateBytes]).toEqual([0, 0, 0, 0]); expect(mocks.recover).not.toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull(); expect(document.querySelector("input,textarea,form")).toBeNull();
    expect(document.body.textContent).not.toMatch(/application complete|submission ready|signature verified/i);
  });
  it("accepts pinned JSONB source metadata independently of key ordering", async () => {
    api(); const reordered = { ...snapshot, source: Object.fromEntries(Object.entries(snapshot.source).reverse()) as typeof snapshot.source };
    render(<SnapPreparedApplication request={request} snapshot={reordered}/>); expect(await screen.findByRole("img")).toBeTruthy();
  });
  it("keeps NULL capture/discovery honest without inventing absence or offering a fresh construction", async () => {
    const fetcher = api({ capture: null, authorization: null }); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>);
    await screen.findByText(/A prepared application could not be confirmed here/); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Replace personal pages" })).toBeNull(); expect(document.body.textContent).not.toMatch(/nothing was sent|no delivery|start again|enter.*number/i);
  });
  it.each([null, { ...authorization(), intent: { ...intent, packetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }])("preserves the server-selected binary/different pointer without choosing a direct candidate %#", async value => {
    api({ authorization: value }); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByText(/Your request has an application record/);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("preserves existing setup copy when a closed private gate has no candidate", async () => {
    const fetcher = api({ capture: null, directStatus: 403 }); render(<><p>Existing protected setup information</p><SnapPreparedApplication request={request} snapshot={snapshot}/></>);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); await waitFor(() => expect(screen.queryByRole("heading", { name: "Your prepared application" })).toBeNull());
    expect(screen.getByText("Existing protected setup information")).toBeTruthy(); expect(screen.queryByRole("alert")).toBeNull(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("recovers a known authorized attempt only through readonly GET and re-reads actual stored metadata before loading", async () => {
    const value = { ...authorization(), state: "authorized" as const }; const fetcher = api({ authorization: value, capture: null });
    fetcher.mockImplementation(async (url: string) => url.includes("packetId=") ? json({ ok: true, authorization: authorization() })
      : url.includes("/capture?") ? json({ ok: true, capture: null }) : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: true, authorization: value }));
    mocks.recover.mockResolvedValue({ state: "stored", packetId: intent.packetId }); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>);
    await screen.findByRole("img"); expect(mocks.recover).toHaveBeenCalledExactlyOnceWith({ ownerId: intent.ownerId, requestId: request.id, expectedVersion: request.version, packetId: intent.packetId, snapshotId: snapshot.id, snapshotHash: context.snapshotHash }, value, { signal: expect.any(AbortSignal) });
    expect(fetcher.mock.calls[3][0]).toContain(`packetId=${intent.packetId}`); expect(mocks.load.mock.calls[0][0]).toEqual(authorization()); expect(posts(fetcher)).toEqual([]);
  });
  it("leaves missing storage unconfirmed without another POST or a fabricated stored result", async () => {
    const fetcher = api({ authorization: { ...authorization(), state: "authorized" }, capture: { ...capture, state: "unavailable", reason: "permission_or_file_unavailable" } });
    render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByText(/Storage of these pages is not confirmed/);
    expect(mocks.recover).toHaveBeenCalledOnce(); expect(mocks.load).not.toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]); expect(screen.getByRole("button", { name: "Replace personal pages" })).toBeTruthy();
  });
  it.each(["authorized", "changed_hash", "changed_consent", "wrong_recovery_packet"])("does not open after inconsistent %s recovery", async kind => {
    const value = { ...authorization(), state: "authorized" as const }, fetcher = api(); mocks.recover.mockResolvedValue({ state: "stored", packetId: kind === "wrong_recovery_packet" ? snapshot.id : intent.packetId });
    const latest = kind === "authorized" ? value : kind === "changed_hash" ? { ...authorization(), intent: { ...intent, contentSha256: "c".repeat(64) } } : kind === "changed_consent" ? { ...authorization(), consentedAt: "2026-11-05T19:58:00.000Z" } : authorization();
    fetcher.mockImplementation(async (url: string) => url.includes("/capture?") ? json({ ok: true, capture }) : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: true, authorization: url.includes("packetId=") ? latest : value }));
    render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("alert"); expect(mocks.load).not.toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]);
  });
  it("keeps a unique revoked/expired locator available only for explicit correction", async () => {
    const fetcher = api({ capture: { ...capture, state: "unavailable", reason: "permission_or_file_unavailable" }, directStatus: 403 });
    render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByText(/Access to the saved application has changed/);
    expect(screen.getByRole("button", { name: "Replace personal pages" })).toBeTruthy(); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.recover).not.toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("replaces only the exact current locator by explicit version-changing CAS, then refreshes the containing request", async () => {
    const changed = vi.fn(), fetcher = api(); render(<SnapPreparedApplication request={request} snapshot={snapshot} onChange={changed}/>); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); await screen.findByText(/earlier personal pages are no longer current/);
    expect(posts(fetcher)).toHaveLength(1); expect(posts(fetcher)[0][0]).toBe(`/api/parent/requests/${request.id}/snap-application/capture`);
    expect(JSON.parse(posts(fetcher)[0][1]!.body as string)).toEqual({ expectedVersion: request.version, previousPacketId: intent.packetId }); expect(changed).toHaveBeenCalledOnce();
    expect(mocks.revoke).toHaveBeenCalledWith("blob:https://caselink.test/saved-1"); expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("button", { name: "Replace personal pages" })).toBeNull();
  });
  it("keeps superseded pages closed on focus/pageshow after acknowledged correction until the parent version refreshes", async () => {
    const changed = vi.fn(), fetcher = api();
    const page = render(<SnapPreparedApplication request={request} snapshot={snapshot} onChange={changed}/>); await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" }));
    await screen.findByText(/earlier personal pages are no longer current/);
    for (const event of ["focus", "pageshow"]) await act(async () => { fireEvent(window, new Event(event)); });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.create).toHaveBeenCalledOnce();
    expect(screen.queryByRole("img")).toBeNull(); expect(changed).toHaveBeenCalledOnce(); expect(posts(fetcher)).toHaveLength(1);
    const nextRequest = { ...request, version: 3 }, nextSnapshot = { ...snapshot, request_version: 3 };
    fetcher.mockImplementation(async (url: string) => url.includes("/capture?") ? json({ ok: true, capture: null }) : url.includes("/context?")
      ? json({ ok: true, context: { ...context, requestVersion: 3 } }) : json({ ok: true, authorization: null }));
    page.rerender(<SnapPreparedApplication request={nextRequest} snapshot={nextSnapshot} onChange={changed}/>);
    await screen.findByText(/A prepared application could not be confirmed here/); expect(fetcher).toHaveBeenCalledTimes(7);
    expect(mocks.load).toHaveBeenCalledOnce(); expect(posts(fetcher)).toHaveLength(1);
  });
  it.each(["lost_response", "wrong_version", "conflict"])("does not blindly retry an uncertain or changed correction: %s", async kind => {
    const changed = vi.fn(), fetcher = api({ post: () => { if (kind === "lost_response") throw new Error("PRIVATE-TRANSPORT-CANARY"); return kind === "conflict"
      ? json({ ok: false, error: "PRIVATE-REPLY-CANARY" }, 409) : json({ ok: true, requestVersion: 99 }); } });
    render(<SnapPreparedApplication request={request} snapshot={snapshot} onChange={changed}/>); await screen.findByRole("img"); fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" }));
    await screen.findByText(/page change needs checking/); expect(posts(fetcher)).toHaveLength(1); expect(changed).toHaveBeenCalledOnce(); expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("button", { name: "Replace personal pages" })).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("clears private rendering on recheck and preserves sign-in recovery after signout", async () => {
    const fetcher = api(); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("img");
    fetcher.mockResolvedValue(json({ ok: false, error: "PRIVATE-SESSION-CANARY" }, 401)); fireEvent.click(screen.getByRole("button", { name: "Check saved application" }));
    expect(screen.queryByRole("img")).toBeNull(); const signIn = await screen.findByRole("link", { name: /Sign in to continue/ }); expect(signIn.getAttribute("href")).toContain(encodeURIComponent(`/support/${request.id}`));
    expect(mocks.revoke).toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Replace personal pages" })).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-"); expect(posts(fetcher)).toEqual([]);
  });
  it("revalidates automatically on return/focus and clears a viewer after permission withdrawal", async () => {
    const fetcher = api(); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("img");
    fetcher.mockImplementation(async (url: string) => url.includes("/capture?") ? json({ ok: true, capture: { ...capture, state: "unavailable", reason: "permission_or_file_unavailable" } }) : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: false, error: "PRIVATE-REVOCATION-CANARY" }, 403));
    fireEvent(window, new Event("focus")); expect(screen.queryByRole("img")).toBeNull(); await screen.findByText(/Access to the saved application has changed/); expect(mocks.revoke).toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]);
  });
  it("expires a displayed file and revokes its URL without a fresh write", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const fetcher = api();
    await act(async () => { render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await vi.advanceTimersByTimeAsync(0); }); expect(screen.getByRole("img")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(300001); }); expect(screen.queryByRole("img")).toBeNull(); expect(mocks.revoke).toHaveBeenCalled(); expect(posts(fetcher)).toEqual([]);
  });
  it("never extends the known mandate expiry to a later authorization expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const fetcher = api();
    const shortMandate = { ...request, mandate: { ...request.mandate, expiresAt: "2026-11-05T20:00:10.000Z" } };
    await act(async () => { render(<SnapPreparedApplication request={shortMandate} snapshot={snapshot}/>); await vi.advanceTimersByTimeAsync(0); }); expect(screen.getByRole("img")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); }); expect(screen.queryByRole("img")).toBeNull(); expect(mocks.revoke).toHaveBeenCalledOnce(); expect(posts(fetcher)).toEqual([]);
  });
  it.each(["capture", "context", "discovery", "stored_metadata"])("bounds a lost %s reply even when fetch ignores abort and discards late success", async stage => {
    vi.useFakeTimers(); vi.setSystemTime(now); let finish!: (value: ReturnType<typeof json>) => void, signal!: AbortSignal;
    const fetcher = api({ authorization: stage === "stored_metadata" ? { ...authorization(), state: "authorized" } : authorization() }), original = fetcher.getMockImplementation()!;
    mocks.recover.mockResolvedValue({ state: "stored", packetId: intent.packetId });
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      const blocked = stage === "capture" ? url.includes("/capture?") : stage === "context" ? url.includes("/context?")
        : stage === "stored_metadata" ? url.includes("packetId=") : url.includes("/snap-direct-packet?");
      if (blocked) { signal = init!.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); }
      return original(url, init);
    });
    await act(async () => { render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await vi.advanceTimersByTimeAsync(0); });
    expect(signal.aborted).toBe(false); await act(async () => { await vi.advanceTimersByTimeAsync(29_999); }); expect(screen.getByRole("status", { name: "Checking your saved application" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(signal.aborted).toBe(true); expect(screen.getByRole("alert").textContent).toContain("could not be checked");
    expect(screen.queryByRole("status", { name: "Checking your saved application" })).toBeNull(); expect(posts(fetcher)).toEqual([]);
    const calls = fetcher.mock.calls.length;
    await act(async () => { finish(json(stage === "capture" ? { ok: true, capture } : stage === "context" ? { ok: true, context } : { ok: true, authorization: authorization() })); });
    expect(fetcher).toHaveBeenCalledTimes(calls); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
  });
  it.each(["timeout", "mandate_expiry"])("ends an uncertain correction on %s without retrying and ignores late success", async kind => {
    vi.useFakeTimers(); vi.setSystemTime(now); let finish!: (value: ReturnType<typeof json>) => void;
    const changed = vi.fn(), fetcher = api({ post: () => new Promise(resolve => { finish = resolve; }) });
    const currentRequest = kind === "mandate_expiry" ? { ...request, mandate: { ...request.mandate, expiresAt: "2026-11-05T20:00:10.000Z" } } : request;
    await act(async () => { render(<SnapPreparedApplication request={currentRequest} snapshot={snapshot} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); expect(screen.queryByRole("img")).toBeNull(); expect(mocks.revoke).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(kind === "timeout" ? 30_000 : 10_001); });
    expect((posts(fetcher)[0][1]!.signal as AbortSignal).aborted).toBe(true); expect(changed).toHaveBeenCalledOnce(); expect(posts(fetcher)).toHaveLength(1);
    expect(screen.queryByRole("status", { name: "Changing page version" })).toBeNull(); expect(screen.queryByRole("button", { name: "Replace personal pages" })).toBeNull();
    if (kind === "timeout") expect(screen.getByRole("alert").textContent).toContain("page change needs checking");
    await act(async () => { finish(json({ ok: true, requestVersion: request.version + 1 })); }); expect(changed).toHaveBeenCalledOnce(); expect(posts(fetcher)).toHaveLength(1); expect(screen.queryByText(/earlier personal pages are no longer current/)).toBeNull();
  });
  it.each(["request", "snapshot", "unmount"])("aborts and wipes a late PDF after %s scope changes", async kind => {
    let finish!: (value: Uint8Array<ArrayBuffer>) => void; mocks.load.mockReturnValue(new Promise<Uint8Array<ArrayBuffer>>(resolve => { finish = resolve; })); api();
    const page = render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce()); const signal = mocks.load.mock.calls[0][1] as AbortSignal;
    if (kind === "unmount") page.unmount(); else page.rerender(<SnapPreparedApplication request={kind === "request" ? { ...request, version: 3 } : request} snapshot={kind === "snapshot" ? { ...snapshot, id: intent.packetId } : snapshot}/>);
    expect(signal.aborted).toBe(true); const privateBytes = bytes(); finish(privateBytes); await waitFor(() => expect([...privateBytes]).toEqual([0, 0, 0, 0])); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull();
  });
  it("cancels an in-flight correction on unmount without changing the new parent scope", async () => {
    let finish!: (value: ReturnType<typeof json>) => void; const changed = vi.fn(), fetcher = api({ post: () => new Promise(resolve => { finish = resolve; }) });
    const page = render(<SnapPreparedApplication request={request} snapshot={snapshot} onChange={changed}/>); await screen.findByRole("img"); fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" }));
    const signal = posts(fetcher)[0][1]!.signal as AbortSignal; page.unmount(); expect(signal.aborted).toBe(true); await act(async () => { finish(json({ ok: true, requestVersion: 3 })); }); expect(changed).not.toHaveBeenCalled();
  });
  it("does not interrupt an explicit correction merely because the window gains focus", async () => {
    let finish!: (value: ReturnType<typeof json>) => void; const changed = vi.fn(), fetcher = api({ post: () => new Promise(resolve => { finish = resolve; }) });
    render(<SnapPreparedApplication request={request} snapshot={snapshot} onChange={changed}/>); await screen.findByRole("img"); fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" }));
    fireEvent(window, new Event("focus")); expect((posts(fetcher)[0][1]!.signal as AbortSignal).aborted).toBe(false); expect(fetcher).toHaveBeenCalledTimes(4);
    await act(async () => { finish(json({ ok: true, requestVersion: 3 })); }); expect(changed).toHaveBeenCalledOnce(); expect(posts(fetcher)).toHaveLength(1);
  });
  it.each(["paused", "cancelled", "closed"] as const)("hides and revokes an existing viewer when the request becomes %s", async status => {
    api(); const page = render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("img");
    page.rerender(<SnapPreparedApplication request={{ ...request, status }} snapshot={snapshot}/>); expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("heading")).toBeNull(); expect(mocks.revoke).toHaveBeenCalled();
  });
  it("defers entirely to an existing final Submit action, including its recorded decision", () => {
    const fetcher = api(); render(<SnapPreparedApplication request={{ ...request, required_actions: [{ id: "review", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Review", explanation: "Exact action", resolved: true }] }} snapshot={snapshot}/>);
    expect(screen.queryByRole("heading")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["foreign_request", "version", "snapshot", "hash", "subjects", "future_consent", "expired", "private_extra"])("refuses mismatched or stale %s metadata without private echo", async kind => {
    const value = authorization();
    if (kind === "foreign_request") value.intent.requestId = snapshot.id;
    if (kind === "version") value.intent.requestVersion++;
    if (kind === "snapshot") value.intent.snapshotId = intent.packetId;
    if (kind === "hash") value.intent.snapshotHash = "c".repeat(64);
    if (kind === "subjects") value.subjectIds = [snapshot.id];
    if (kind === "future_consent") value.consentedAt = "2026-11-05T20:01:00.000Z";
    if (kind === "expired") value.authorizationExpiresAt = now.toISOString();
    if (kind === "private_extra") Reflect.set(value, "file", "PRIVATE-REPLY-CANARY");
    api({ authorization: value }); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("alert"); expect(mocks.load).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("keeps a loader failure closed and sanitizes its error", async () => {
    mocks.load.mockRejectedValue(new Error("PRIVATE-PDF-CANARY")); api(); render(<SnapPreparedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("alert"); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByRole("img")).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("uses named native controls and has no DOM accessibility violations in the read-only state", async () => {
    api(); const page = render(<main><SnapPreparedApplication request={request} snapshot={snapshot}/></main>); await screen.findByRole("img");
    expect(screen.getByRole("region", { name: "Your prepared application" })).toBeTruthy();
    const result = await axe.run(page.container, { rules: { "color-contrast": { enabled: false } } }); expect(result.violations.map(violation => violation.id)).toEqual([]);
  });
});
