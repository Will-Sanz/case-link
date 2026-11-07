// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest, fixtureSnapCaptureIntent, fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
import { SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD } from "@/lib/parent/snap-direct-acquisition-contract";
const mocks = vi.hoisted(() => ({ entry: vi.fn(), prepared: vi.fn() }));
vi.mock("./snap-direct-personal-entry", () => ({ SnapDirectPersonalEntry: (props: { onRecovery: () => void }) => {
  mocks.entry(props); return <div><label>Entry instance<input defaultValue="synthetic unsaved work"/></label><button onClick={props.onRecovery}>Entry recovery</button></div>;
} }));
vi.mock("./snap-prepared-application", () => ({ SnapPreparedApplication: (props: unknown) => { mocks.prepared(props); return <p>Existing prepared application</p>; } }));
import { SnapProtectedApplication } from "./snap-protected-application";

const now = new Date("2026-11-05T22:00:00.000Z"), snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(now));
const request = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
  mandate: fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: "2026-11-05T22:30:00.000Z" }) });
const intent = fixtureSnapCaptureIntent(), context = { requestVersion: 2, snapshotId: snapshot.id, snapshotHash: intent.snapshotHash,
  source: snapshot.source, applyingSubjectIds: snapshot.details.household!.map(person => person.id) };
const acquisition = { ownerId: intent.ownerId, requestId: request.id, requestVersion: 2, snapshotId: snapshot.id, snapshotHash: context.snapshotHash,
  recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", method: SNAP_DIRECT_ACQUISITION_METHOD,
  fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: snapshot.source, subjectIds: context.applyingSubjectIds,
  policyVersion: intent.policyVersion, retentionPolicyVersion: intent.retentionPolicyVersion, expiresAt: "2026-11-05T22:05:00.000Z",
  state: "authorized", acquisitionId: intent.packetId, authorityDeclaration: "parent_declared_household_data_authority", consentedAt: now.toISOString() };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function api(options: { capture?: unknown; context?: unknown; acquisition?: unknown; status?: number } = {}) {
  const fetcher = vi.fn(async (url: string) => options.status ? json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, options.status)
    : url.includes("/capture?") ? json({ ok: true, capture: options.capture ?? null }) : url.includes("/context?")
      ? json({ ok: true, context: options.context ?? context }) : json({ ok: true, acquisition: options.acquisition ?? acquisition }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("guarded SNAP existing-grant mount", () => {
  it("reuses exact current permission after the three bounded readonly checks", async () => {
    const fetcher = api(); render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); await screen.findByLabelText("Entry instance");
    expect(fetcher.mock.calls.map(([url]) => url.split("?")[0])).toEqual([`/api/parent/requests/${request.id}/snap-application/capture`, `/api/parent/requests/${request.id}/snap-application/context`, `/api/parent/requests/${request.id}/snap-acquisition`]);
    expect(mocks.entry.mock.calls.at(-1)![0]).toMatchObject({ request, snapshot, context, acquisition }); expect(mocks.prepared).not.toHaveBeenCalled();
  });
  it.each(["capture", "closed"])("preserves honest existing review without new collection for %s", async kind => {
    const fetcher = api(kind === "capture" ? { capture: { packetId: intent.packetId, requestVersion: 2, state: "pending", reason: null } } : { status: 403 });
    render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); await screen.findByText("Existing prepared application");
    expect(mocks.entry).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("offers exact fresh permission only after successful server checks, then opens entry after the authorized POST", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => url.includes("/capture?") ? json({ ok: true, capture: null })
      : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: true, acquisition: init.method === "POST" ? acquisition
        : { ...acquisition, state: "permission_needed", acquisitionId: null, authorityDeclaration: null, consentedAt: null } }));
    vi.stubGlobal("fetch", fetcher); render(<SnapProtectedApplication request={request} snapshot={snapshot}/>);
    await screen.findByRole("heading", { name: "Allow private SNAP personal steps" }); expect(mocks.entry).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Allow and continue" }));
    await screen.findByLabelText("Entry instance"); expect(fetcher).toHaveBeenCalledTimes(4); expect(mocks.entry.mock.calls.at(-1)![0]).toMatchObject({ context, acquisition });
  });
  it("does not treat denied personal-step permission as an existing protected application", async () => {
    const fetcher = api(); fetcher.mockImplementation(async (url: string) => url.includes("/capture?") ? json({ ok: true, capture: null })
      : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, 403));
    render(<SnapProtectedApplication request={request} snapshot={snapshot}/>);
    await screen.findByText("Personal steps are unavailable through CaseLink right now. Your saved answers are unchanged. Check Activity & receipts for any prepared drafts.");
    expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.prepared).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-");
    fireEvent.click(screen.getByRole("button", { name: "Check current application" }));
    await screen.findByText("Personal steps are unavailable through CaseLink right now. Your saved answers are unchanged. Check Activity & receipts for any prepared drafts.");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it.each([401, 409, 500, 503])("keeps acquisition failure %s visible rather than treating it as closed permission", async status => {
    const fetcher = api(); fetcher.mockImplementation(async (url: string) => url.includes("/capture?") ? json({ ok: true, capture: null })
      : url.includes("/context?") ? json({ ok: true, context }) : json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, status));
    render(<SnapProtectedApplication request={request} snapshot={snapshot}/>);
    if (status === 401) await screen.findByRole("link", { name: /Sign in to continue/ }); else await screen.findByRole("alert");
    expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.prepared).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it.each(["wrong_version", "wrong_source", "wrong_subject", "foreign_request", "expired", "future_consent"])("does not mount personal controls from %s metadata", async kind => {
    const value = structuredClone(acquisition);
    if (kind === "wrong_version") value.requestVersion++;
    if (kind === "wrong_source") Reflect.set(value.source, "templateSha256", "f".repeat(64));
    if (kind === "wrong_subject") value.subjectIds = [request.id];
    if (kind === "foreign_request") value.requestId = snapshot.id;
    if (kind === "expired") value.expiresAt = now.toISOString();
    if (kind === "future_consent") value.consentedAt = "2026-11-05T22:01:00.000Z";
    api({ acquisition: value }); render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); await screen.findByRole("alert");
    expect(mocks.entry).not.toHaveBeenCalled(); expect(mocks.prepared).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("preserves the mounted entry through identical polls and delegates focus without unmounting its attempt barrier", async () => {
    const fetcher = api(), page = render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); const input = await screen.findByLabelText("Entry instance");
    page.rerender(<SnapProtectedApplication request={{ ...structuredClone(request), updated_at: now.toISOString(), events: [] }} snapshot={structuredClone(snapshot)}/>);
    await act(async () => { fireEvent(window, new Event("focus")); fireEvent(window, new Event("pageshow")); });
    expect(screen.getByLabelText("Entry instance")).toBe(input); expect(fetcher).toHaveBeenCalledTimes(3);
    page.rerender(<SnapProtectedApplication request={{ ...request, mandate: { ...request.mandate, allowedData: ["household"] } }} snapshot={snapshot}/>);
    expect(screen.queryByLabelText("Entry instance")).toBeNull();
  });
  it("keeps necessary recovery explicit without claiming filing, and permits a fresh readonly check", async () => {
    const fetcher = api(); render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); fireEvent.click(await screen.findByRole("button", { name: "Entry recovery" }));
    expect(screen.queryByLabelText("Entry instance")).toBeNull(); expect(screen.getByRole("link", { name: "Open the official SNAP service" }).getAttribute("href")).toBe("https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap");
    await act(async () => { fireEvent(window, new Event("focus")); }); expect(screen.getByText("Another way to complete personal steps")).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Check current application" })); await screen.findByLabelText("Entry instance"); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(document.body.textContent).not.toMatch(/application submitted|application complete|agency confirmed/i);
  });
  it("preserves sign-in recovery and does not echo server diagnostics", async () => {
    api({ status: 401 }); render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); expect(await screen.findByRole("link", { name: /Sign in to continue/ })).toBeTruthy(); expect(mocks.entry).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("ignores a late response after the request scope closes", async () => {
    let finish!: (value: ReturnType<typeof json>) => void; const fetcher = api(); fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const page = render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); page.rerender(<SnapProtectedApplication request={{ ...request, status: "cancelled" }} snapshot={snapshot}/>);
    await act(async () => { finish(json({ ok: true, capture: null })); }); expect(mocks.entry).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("ends an uncooperative metadata read at its bound and does not accept its late result", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let finish!: (value: ReturnType<typeof json>) => void; const fetcher = api(); fetcher.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); await vi.advanceTimersByTimeAsync(0); }); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole("alert")).toBeTruthy(); await act(async () => { finish(json({ ok: true, capture: null })); }); expect(mocks.entry).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("unmounts existing entry at the earlier acquisition expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); api(); await act(async () => { render(<SnapProtectedApplication request={request} snapshot={snapshot}/>); await vi.advanceTimersByTimeAsync(0); }); expect(screen.getByLabelText("Entry instance")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(300001); }); expect(screen.queryByLabelText("Entry instance")).toBeNull(); expect(screen.getByRole("alert")).toBeTruthy();
  });
});
