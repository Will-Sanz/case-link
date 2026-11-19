// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest, fixtureSnapCaptureIntent, fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
import { SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD, type SnapDirectAcquisitionResult } from "@/lib/parent/snap-direct-acquisition-contract";
import type { SnapDirectCompletion } from "@/lib/parent/snap-direct-completion-core";
const mocks = vi.hoisted(() => ({ load: vi.fn(), complete: vi.fn(), send: vi.fn(), viewerReady: true, wrongPage: false, signals: new Map<number, (value: boolean, page?: number) => void>() }));
vi.mock("@/lib/parent/snap-signing-copy-file", () => ({ loadSnapSigningCopyFile: mocks.load }));
vi.mock("@/lib/parent/snap-direct-completion-browser", () => ({ completeSnapDirectCompletionInBrowser: mocks.complete }));
vi.mock("@/lib/parent/snap-direct-completion-transport", () => ({ sendSnapDirectCompletion: mocks.send }));
vi.mock("./snap-prepared-application", () => ({ SnapPreparedApplication: () => <p>Existing application recovery</p> }));
vi.mock("./snap-review-pdf", async () => {
  const { useEffect } = await import("react");
  return { SnapReviewPdf: ({ onReady, initialPage }: { onReady: (value: boolean, page?: number) => void; initialPage: number }) => {
    useEffect(() => { mocks.signals.set(initialPage, onReady); onReady(mocks.viewerReady, mocks.wrongPage ? initialPage + 1 : initialPage); return () => { mocks.signals.delete(initialPage); }; }, [onReady, initialPage]);
    return <div role="img" aria-label={`Official-page viewer double ${initialPage}`}/>;
  } };
});
vi.mock("./snap-personal-drawing", () => ({ SnapPersonalDrawing: ({ actId, label, disabled, onChange, onRecovery }: {
  actId: SnapDirectCompletion["certifications"][number]["actId"]; label: string; disabled: boolean;
  onChange: (value: SnapDirectCompletion["certifications"][number]) => void; onRecovery: () => void;
}) => <><button type="button" disabled={disabled} onClick={() => onChange({ actId, provenance: "caller_reported_fresh_parent_drawing", startedAt: "2026-11-05T21:59:58.000Z", completedAt: "2026-11-05T21:59:59.000Z", date: "2026-11-05", strokes: [[{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.6 }]] })}>{label}</button><button type="button" onClick={onRecovery}>Drawing recovery {actId}</button></> }));
import { SnapDirectPersonalEntry } from "./snap-direct-personal-entry";

const now = new Date("2026-11-05T22:00:00.000Z"), preparedAt = new Date("2026-11-05T21:59:00.000Z");
const snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt));
const request = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
  mandate: fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: "2026-11-05T22:30:00.000Z" }) });
const intent = { ...fixtureSnapCaptureIntent(), requestVersion: 2, snapshotId: snapshot.id };
const context = { requestVersion: 2, snapshotId: snapshot.id, snapshotHash: intent.snapshotHash, source: snapshot.source,
  applyingSubjectIds: snapshot.details.household!.map(person => person.id) };
const acquisition: SnapDirectAcquisitionResult = { ownerId: intent.ownerId, requestId: request.id, requestVersion: 2, snapshotId: snapshot.id,
  snapshotHash: context.snapshotHash, recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet",
  method: SNAP_DIRECT_ACQUISITION_METHOD, fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: context.source, subjectIds: context.applyingSubjectIds,
  policyVersion: intent.policyVersion, retentionPolicyVersion: intent.retentionPolicyVersion, expiresAt: "2026-11-05T22:05:00.000Z", state: "authorized",
  acquisitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authorityDeclaration: "parent_declared_household_data_authority", consentedAt: preparedAt.toISOString() };
const trusted = { requestId: request.id, context, snapshot, preparedAt: preparedAt.toISOString(), unsignedContentSha256: "d".repeat(64) };
const json = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value });
function api(options: { capture?: unknown; registered?: unknown; fresh?: unknown; post?: (body: Record<string, unknown>) => unknown } = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return options.post ? options.post(body) : json({ ok: true, authorization: { intent: { ...intent, packetId: body.packetId, authorizationId: body.packetId,
        contentSha256: body.contentSha256, byteLength: body.byteLength }, subjectIds: acquisition.subjectIds, authorityDeclaration: acquisition.authorityDeclaration,
        consentedAt: acquisition.consentedAt, authorizationExpiresAt: acquisition.expiresAt, state: "authorized" } });
    }
    if (url.includes("/capture?")) return json({ ok: true, capture: options.capture ?? null });
    if (url.includes("/snap-acquisition?")) return json({ ok: true, acquisition: options.fresh ?? acquisition });
    if (url.includes("/snap-direct-packet?")) return json({ ok: true, authorization: options.registered ?? null });
    throw new Error("Unexpected synthetic endpoint");
  }); vi.stubGlobal("fetch", fetcher); return fetcher;
}
const props = () => ({ request, snapshot, context, acquisition, onChange: vi.fn(), onRecovery: vi.fn() });
const postCalls = (fetcher: ReturnType<typeof api>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
async function completeFields() {
  fireEvent.change(await screen.findByLabelText(/Social Security number/), { target: { value: "900000001" } });
  fireEvent.click(screen.getByRole("button", { name: "Your applicant certification" }));
  fireEvent.click(screen.getByRole("button", { name: "Your rights and responsibilities certification" }));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); mocks.viewerReady = true; mocks.wrongPage = false; mocks.signals.clear();
  mocks.load.mockImplementation(async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), trusted: structuredClone(trusted) }));
  mocks.complete.mockImplementation(async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), contentSha256: "c".repeat(64), byteLength: 4 }));
  mocks.send.mockResolvedValue({ state: "stored", packetId: intent.packetId });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("closed already-authorized SNAP personal entry", () => {
  it("mounts private controls only after fresh exact permission and NULL capture/current-intent metadata; reuses saved answers", async () => {
    const fetcher = api(); render(<SnapDirectPersonalEntry {...props()}/>);
    expect(document.querySelector("input,canvas")).toBeNull(); await screen.findByLabelText(/Social Security number/);
    expect(fetcher.mock.calls.map(([url]) => url.split("?")[0])).toEqual([`/api/parent/requests/${request.id}/snap-application/capture`, `/api/parent/requests/${request.id}/snap-acquisition`, `/api/parent/requests/${request.id}/snap-direct-packet`]);
    expect(mocks.load).toHaveBeenCalledOnce(); expect(screen.getByRole("img", { name: "Official-page viewer double 3" })).toBeTruthy(); expect(screen.getByRole("img", { name: "Official-page viewer double 7" })).toBeTruthy();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1); expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false); expect(postCalls(fetcher)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(document.body.textContent).not.toMatch(/signature verified|application submitted|SNAP application complete/);
  });
  it.each(["permission", "expiry", "future_consent", "request", "version", "snapshot", "hash", "subjects", "source", "mandate", "recipient", "cancelled", "canonical"])("never exposes protected controls for changed %s", async kind => {
    const value = { ...props(), request: structuredClone(request), snapshot: structuredClone(snapshot), context: structuredClone(context), acquisition: structuredClone(acquisition) };
    if (kind === "permission") Object.assign(value.acquisition, { state: "permission_needed", acquisitionId: null, authorityDeclaration: null, consentedAt: null });
    if (kind === "expiry") value.acquisition.expiresAt = now.toISOString();
    if (kind === "future_consent") value.acquisition.consentedAt = "2026-11-05T22:01:00.000Z";
    if (kind === "request") value.acquisition.requestId = snapshot.id;
    if (kind === "version") value.acquisition.requestVersion++;
    if (kind === "snapshot") value.acquisition.snapshotId = request.id;
    if (kind === "hash") value.acquisition.snapshotHash = "f".repeat(64);
    if (kind === "subjects") value.acquisition.subjectIds = [request.id];
    if (kind === "source") Reflect.set(value.acquisition.source, "templateSha256", "f".repeat(64));
    if (kind === "mandate") value.request.mandate.allowedData = ["household"];
    if (kind === "recipient") value.request.mandate.recipientIds = ["peco-cap"];
    if (kind === "cancelled") value.request.status = "cancelled";
    if (kind === "canonical") value.request.required_actions = [{ id: "review", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Review", explanation: "Exact review", resolved: true }];
    const fetcher = api(); render(<SnapDirectPersonalEntry {...value}/>); await act(async () => {});
    expect(document.querySelector("input,canvas")).toBeNull(); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not collect before resolving an unsupported personal-step branch", async () => {
    const changed = fixtureSnapSnapshot(preparedAt, { ...snapshot.details, authorizedRepresentative: { name: "Synthetic Helper", phone: "2155550100", address: { street: "1 Synthetic Street", city: "Philadelphia", state: "PA", zip: "19104" } } });
    const value = { ...props(), snapshot: snapApplicationSnapshotSchema.parse(changed) }, fetcher = api();
    render(<SnapDirectPersonalEntry {...value}/>); expect(screen.getByRole("button", { name: "Get help with personal steps" })).toBeTruthy();
    expect(document.querySelector("input,canvas")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["capture", "registered"])("opens existing %s work without another private entry or construction", async kind => {
    const value = { intent, authorizationExpiresAt: acquisition.expiresAt, consentedAt: acquisition.consentedAt, subjectIds: acquisition.subjectIds, authorityDeclaration: acquisition.authorityDeclaration, state: "authorized" };
    const fetcher = api(kind === "capture" ? { capture: { packetId: intent.packetId, requestVersion: 2, state: "pending", reason: null } } : { registered: value });
    render(<SnapDirectPersonalEntry {...props()}/>); await screen.findByText("Existing application recovery"); expect(document.querySelector("input")).toBeNull(); expect(mocks.load).not.toHaveBeenCalled(); expect(postCalls(fetcher)).toEqual([]);
  });
  it.each(["revoked", "different_grant", "unknown_metadata"])("keeps a %s response closed without treating it as absence", async kind => {
    const fetcher = api({ fresh: kind === "different_grant" ? { ...acquisition, acquisitionId: request.id } : acquisition });
    if (kind !== "different_grant") fetcher.mockResolvedValue(kind === "revoked" ? json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, 403) : json({ ok: true }));
    render(<SnapDirectPersonalEntry {...props()}/>); await screen.findByRole("alert"); expect(document.querySelector("input")).toBeNull(); expect(mocks.load).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("offers an explicit bounded recheck and help after a pre-registration failure", async () => {
    const value = props(), failed = api(); failed.mockRejectedValue(new Error("PRIVATE-FAILURE"));
    render(<SnapDirectPersonalEntry {...value}/>); await screen.findByRole("alert"); expect(screen.getByRole("button", { name: "Get help with personal steps" })).toBeTruthy();
    const fresh = api(); fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByLabelText(/Social Security number/);
    expect(fresh).toHaveBeenCalledTimes(3); expect(postCalls(fresh)).toEqual([]); expect(mocks.complete).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("sends only references/hash/size through ordinary metadata; private completion uses only the protected transport", async () => {
    const value = props(), fetcher = api(), candidate = new Uint8Array([37, 80, 68, 70]); mocks.complete.mockResolvedValue({ bytes: candidate, contentSha256: "c".repeat(64), byteLength: 4 });
    render(<SnapDirectPersonalEntry {...value}/>); await completeFields(); fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" }));
    await screen.findByText("Existing application recovery"); expect(mocks.complete).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledOnce(); expect(postCalls(fetcher)).toHaveLength(1);
    const body = JSON.parse(postCalls(fetcher)[0][1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(["acquisitionId", "byteLength", "contentSha256", "expectedVersion", "packetId", "snapshotHash", "snapshotId"]);
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/900000001|strokes|certifications|caller_reported_fresh_parent_drawing/);
    expect(mocks.send.mock.calls[0][3]).toMatchObject({ identifiers: [{ personId: context.applyingSubjectIds[0], kind: "ssn", value: "900000001" }], certifications: [{ actId: "applicant_signature_printed_page_1" }, { actId: "rights_certification_printed_page_5" }] });
    expect([...candidate]).toEqual([0, 0, 0, 0]); expect(value.onChange).toHaveBeenCalledOnce(); expect(document.querySelector("input")).toBeNull();
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it("accepts ordinary formatted entry without copying a saved identifier or manufacturing ink", async () => {
    api(); render(<SnapDirectPersonalEntry {...props()}/>); const input = await screen.findByLabelText(/Social Security number/) as HTMLInputElement;
    expect(input.value).toBe(""); expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "900-00-0001" } }); expect(input.value).toBe("900000001"); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("allows an explicit initial filing without an applicant number and discards an earlier typed value", async () => {
    const fetcher = api(); render(<SnapDirectPersonalEntry {...props()}/>);
    const input = await screen.findByLabelText(/Social Security number/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "900000001" } }); fireEvent.click(screen.getByRole("checkbox"));
    expect(input.disabled).toBe(true); expect(input.required).toBe(false); expect(input.value).toBe("");
    expect(screen.getByText(/A missing number does not prevent an initial filing/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Your applicant certification" })); fireEvent.click(screen.getByRole("button", { name: "Your rights and responsibilities certification" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" })); await screen.findByText("Existing application recovery");
    expect(mocks.send.mock.calls[0][3].identifiers).toEqual([{ personId: context.applyingSubjectIds[0], kind: "provide_to_agency_later" }]);
    expect(JSON.stringify(mocks.send.mock.calls[0][3])).not.toContain("900000001");
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/900000001|provide_to_agency_later|strokes/);
  });
  it("requires a real number again after deferral is removed, without restoring the discarded value", async () => {
    api(); render(<SnapDirectPersonalEntry {...props()}/>); await completeFields();
    const checkbox = screen.getByRole("checkbox"), input = screen.getByLabelText(/Social Security number/) as HTMLInputElement;
    fireEvent.click(checkbox); expect(input.value).toBe("");
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(checkbox); expect(input.disabled).toBe(false); expect(input.required).toBe(true); expect(input.value).toBe("");
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector("form")!); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each(["loading", "wrong_page"])("requires the exact certification page before drawing or finishing (%s)", async kind => {
    mocks.viewerReady = kind !== "loading"; mocks.wrongPage = kind === "wrong_page"; api(); render(<SnapDirectPersonalEntry {...props()}/>);
    await screen.findByLabelText(/Social Security number/);
    expect((screen.getByRole("button", { name: "Your applicant certification" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Your rights and responsibilities certification" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector("form")!); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("keeps an exact-page display opportunity and completed drawing while navigating the same immutable copy", async () => {
    api(); render(<SnapDirectPersonalEntry {...props()}/>); await completeFields();
    act(() => { mocks.signals.get(3)!(false, 4); mocks.signals.get(3)!(true, 4); mocks.signals.get(7)!(false, 8); });
    expect((screen.getByRole("button", { name: "Your applicant certification" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("asks only applying people and resolves a duplicate supplied number without exposing it", async () => {
    const self = snapshot.details.household![0], details = { ...snapshot.details, householdSize: 3, household: [self,
      { ...self, id: "11111111-1111-4111-8111-000000000002", firstName: "Second", relationship: "CHILD" },
      { id: "11111111-1111-4111-8111-000000000003", firstName: "Third", lastName: "Fixture", dateOfBirth: "1990-01-01", sex: "female" as const, student: false, relationship: "SPOUSE", requestingSnap: false }] };
    const ownSnapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt, details));
    const ownContext = { ...context, applyingSubjectIds: ownSnapshot.details.household!.filter(person => person.requestingSnap).map(person => person.id) };
    const ownAcquisition = { ...acquisition, subjectIds: ownContext.applyingSubjectIds };
    api({ fresh: ownAcquisition }); mocks.load.mockResolvedValue({ bytes: new Uint8Array([37, 80, 68, 70]), trusted: { ...trusted, context: ownContext, snapshot: ownSnapshot } });
    render(<SnapDirectPersonalEntry {...props()} snapshot={ownSnapshot} context={ownContext} acquisition={ownAcquisition}/>);
    await screen.findByLabelText(/Second.*Social Security number/); expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2); expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByLabelText(/Third.*Social Security number/)).toBeNull(); expect(mocks.complete).not.toHaveBeenCalled();
    for (const input of screen.getAllByLabelText(/Social Security number/)) fireEvent.change(input, { target: { value: "900000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Your applicant certification" })); fireEvent.click(screen.getByRole("button", { name: "Your rights and responsibilities certification" }));
    expect(screen.getByRole("alert").textContent).toContain("The same number is entered"); expect(screen.getByRole("alert").textContent).not.toContain("900000001");
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector("form")!); expect(mocks.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("checkbox")[1]); expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(["metadata_unknown", "competing", "private_unknown", "wrong_reply"])("does not repeat construction/upload after %s", async kind => {
    const value = props(), fetcher = api({ post: () => { if (kind === "metadata_unknown") throw new Error("PRIVATE-ERROR-CANARY"); return kind === "competing" ? json({ ok: false, error: "PRIVATE-ERROR-CANARY" }, 409) : json({ ok: true, authorization: null }); } });
    if (kind === "private_unknown") { api(); mocks.send.mockResolvedValue({ state: "storage_unconfirmed", packetId: intent.packetId }); }
    render(<SnapDirectPersonalEntry {...value}/>); await completeFields(); fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" }));
    await screen.findByText("Existing application recovery"); expect(mocks.complete).toHaveBeenCalledOnce(); expect(mocks.send).toHaveBeenCalledTimes(kind === "private_unknown" ? 1 : 0);
    expect(postCalls(fetcher).length).toBeLessThanOrEqual(1); expect(value.onChange).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain("PRIVATE-"); expect(document.querySelector("input")).toBeNull();
  });
  it.each(["unknown", "in_flight"])("keeps same-version focus/pageshow read-only after %s metadata registration, even if discovery remains NULL", async stage => {
    let finish!: (value: unknown) => void; const value = props();
    const fetcher = api({ post: () => stage === "unknown" ? Promise.reject(new Error("PRIVATE-UNKNOWN")) : new Promise(resolve => { finish = resolve; }) });
    const page = render(<SnapDirectPersonalEntry {...value}/>); await completeFields(); fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" }));
    await waitFor(() => expect(postCalls(fetcher)).toHaveLength(1));
    if (stage === "unknown") await screen.findByText("Existing application recovery");
    for (const event of ["focus", "pageshow"]) await act(async () => { fireEvent(window, new Event(event)); });
    expect(screen.getByText("Existing application recovery")).toBeTruthy(); expect(document.querySelector("input")).toBeNull();
    page.rerender(<SnapDirectPersonalEntry {...value} request={{ ...request, mandate: { ...request.mandate } }}/>) ;
    await act(async () => {}); expect(screen.getByText("Existing application recovery")).toBeTruthy(); expect(document.querySelector("input")).toBeNull();
    if (stage === "in_flight") await act(async () => { finish(json({ ok: false, error: "PRIVATE-LATE" }, 409)); });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.complete).toHaveBeenCalledOnce(); expect(postCalls(fetcher)).toHaveLength(1); expect(mocks.send).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("PRIVATE-");
  });
  it("starts only one worker for two immediate Finish events", async () => {
    let finish!: (value: unknown) => void; mocks.complete.mockReturnValue(new Promise(resolve => { finish = resolve; })); const fetcher = api();
    render(<SnapDirectPersonalEntry {...props()}/>); await completeFields();
    act(() => { fireEvent.submit(document.querySelector("form")!); fireEvent.submit(document.querySelector("form")!); });
    expect(mocks.complete).toHaveBeenCalledOnce(); expect(postCalls(fetcher)).toEqual([]);
    await act(async () => { finish({ bytes: null, readiness: { reason: "invalid_completion" } }); }); expect(mocks.complete).toHaveBeenCalledOnce();
  });
  it("reconciles a timed-out metadata registration without accepting a late reply or private re-upload", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let finish!: (value: unknown) => void; const value = props(), fetcher = api({ post: () => new Promise(resolve => { finish = resolve; }) });
    await act(async () => { render(<SnapDirectPersonalEntry {...value}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText(/Social Security number/), { target: { value: "900000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Your applicant certification" })); fireEvent.click(screen.getByRole("button", { name: "Your rights and responsibilities certification" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" })); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(postCalls(fetcher)).toHaveLength(1); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByText("Existing application recovery")).toBeTruthy(); expect(document.querySelector("input")).toBeNull(); expect(value.onChange).toHaveBeenCalledOnce();
    await act(async () => { finish(json({ ok: true, authorization: null })); fireEvent(window, new Event("focus")); });
    expect(mocks.send).not.toHaveBeenCalled(); expect(postCalls(fetcher)).toHaveLength(1); expect(value.onChange).toHaveBeenCalledOnce();
  });
  it("does not register an intent after a closed renderer disposition", async () => {
    const fetcher = api(); mocks.complete.mockResolvedValue({ bytes: null, readiness: { reason: "personal_act_route_unresolved" } });
    render(<SnapDirectPersonalEntry {...props()}/>); await completeFields(); fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" }));
    await screen.findByRole("alert"); expect(postCalls(fetcher)).toEqual([]); expect(mocks.send).not.toHaveBeenCalled(); expect(document.querySelector("input")).toBeNull();
  });
  it.each(["main", "drawing"])("clears all entries and stops work before %s recovery", async kind => {
    const value = props(), fetcher = api(); render(<SnapDirectPersonalEntry {...value}/>); await completeFields();
    const input = screen.getByLabelText(/Social Security number/) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: kind === "main" ? "Get help with personal steps" : "Drawing recovery applicant_signature_printed_page_1" }));
    expect(input.value).toBe(""); expect(input.defaultValue).toBe("");
    expect(value.onRecovery).toHaveBeenCalledOnce(); expect(document.querySelector("input")).toBeNull(); expect(mocks.complete).not.toHaveBeenCalled(); expect(postCalls(fetcher)).toEqual([]);
  });
  it("preserves personal work across identical metadata and unrelated status polls, then clears it for a changed mandate", async () => {
    const value = props(), fetcher = api(); const page = render(<SnapDirectPersonalEntry {...value}/>); await completeFields();
    const input = screen.getByLabelText(/Social Security number/) as HTMLInputElement;
    page.rerender(<SnapDirectPersonalEntry {...value} request={{ ...structuredClone(request), updated_at: now.toISOString(), events: [] }} snapshot={structuredClone(snapshot)} context={structuredClone(context)} acquisition={structuredClone(acquisition)}/>);
    await act(async () => {}); expect(screen.getByLabelText(/Social Security number/)).toBe(input); expect(input.value).toBe("900000001");
    expect((screen.getByRole("button", { name: "Finish personal steps" }) as HTMLButtonElement).disabled).toBe(false); expect(fetcher).toHaveBeenCalledTimes(3); expect(mocks.load).toHaveBeenCalledOnce();
    page.rerender(<SnapDirectPersonalEntry {...value} request={{ ...request, mandate: { ...request.mandate, allowedData: ["household"] } }}/>);
    expect(document.querySelector("input")).toBeNull(); expect(input.value).toBe(""); expect(input.defaultValue).toBe(""); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("rechecks current authority automatically on return and clears earlier private controls", async () => {
    const fetcher = api(); render(<SnapDirectPersonalEntry {...props()}/>); await completeFields();
    fetcher.mockResolvedValue(json({ ok: false, error: "PRIVATE-REVOCATION-CANARY" }, 403)); fireEvent(window, new Event("focus"));
    expect(document.querySelector("input")).toBeNull(); await screen.findByRole("alert"); expect(mocks.complete).not.toHaveBeenCalled(); expect(postCalls(fetcher)).toEqual([]);
  });
  it("immediately removes and wipes a loaded form when replacement metadata is already expired", async () => {
    const value = props(), fetcher = api(), bytes = new Uint8Array([37, 80, 68, 70]);
    mocks.load.mockResolvedValue({ bytes, trusted });
    const page = render(<SnapDirectPersonalEntry {...value}/>); await completeFields();
    const input = screen.getByLabelText(/Social Security number/) as HTMLInputElement;
    const signal = mocks.load.mock.calls[0][1] as AbortSignal;
    page.rerender(<SnapDirectPersonalEntry {...value} acquisition={{ ...acquisition, expiresAt: now.toISOString() }}/>);
    expect(document.querySelector("input")).toBeNull(); expect(screen.queryByRole("img")).toBeNull();
    expect(input.value).toBe(""); expect(input.defaultValue).toBe(""); expect([...bytes]).toEqual([0, 0, 0, 0]); expect(signal.aborted).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled(); expect(postCalls(fetcher)).toEqual([]);
  });
  it("discards late construction from an old scope without clearing the new protected form", async () => {
    let finish!: (value: unknown) => void;
    mocks.complete.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const value = props(), fetcher = api(), page = render(<SnapDirectPersonalEntry {...value}/>);
    await completeFields(); fireEvent.click(screen.getByRole("button", { name: "Finish personal steps" }));
    const oldSignal = mocks.complete.mock.calls[0][4].signal as AbortSignal;
    page.rerender(<SnapDirectPersonalEntry {...value} request={{ ...request, mandate: { ...request.mandate, expiresAt: "2026-11-05T22:29:00.000Z" } }}/>);
    await completeFields(); const newInput = screen.getByLabelText(/Social Security number/) as HTMLInputElement;
    const candidate = new Uint8Array([37, 80, 68, 70]);
    await act(async () => { finish({ bytes: candidate, contentSha256: "c".repeat(64), byteLength: 4 }); });
    expect(oldSignal.aborted).toBe(true); expect([...candidate]).toEqual([0, 0, 0, 0]);
    expect(screen.getByLabelText(/Social Security number/)).toBe(newInput); expect(newInput.value).toBe("900000001");
    expect(screen.getByRole("button", { name: "Finish personal steps" }).matches(":disabled")).toBe(false);
    expect(postCalls(fetcher)).toEqual([]); expect(mocks.send).not.toHaveBeenCalled(); expect(value.onChange).not.toHaveBeenCalled();
  });
  it("expires and wipes loaded bytes and fields without extending permission", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const copyBytes = new Uint8Array([37, 80, 68, 70]); mocks.load.mockResolvedValue({ bytes: copyBytes, trusted }); api();
    await act(async () => { render(<SnapDirectPersonalEntry {...props()}/>); await vi.advanceTimersByTimeAsync(0); }); expect(document.querySelector("input")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(300001); }); expect(document.querySelector("input")).toBeNull(); expect([...copyBytes]).toEqual([0, 0, 0, 0]);
  });
  it("aborts and wipes late signing-copy bytes after unmount", async () => {
    let finish!: (value: unknown) => void; mocks.load.mockReturnValue(new Promise(resolve => { finish = resolve; })); api();
    const page = render(<SnapDirectPersonalEntry {...props()}/>); await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce()); const signal = mocks.load.mock.calls[0][1] as AbortSignal;
    page.unmount(); expect(signal.aborted).toBe(true); const bytes = new Uint8Array([37, 80, 68, 70]); await act(async () => { finish({ bytes, trusted }); }); expect([...bytes]).toEqual([0, 0, 0, 0]);
  });
  it("bounds an uncooperative metadata read without leaking late success or mounting inputs", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); let finish!: (value: unknown) => void; const fetcher = api(); fetcher.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<SnapDirectPersonalEntry {...props()}/>); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(screen.getByRole("alert")).toBeTruthy();
    await act(async () => { finish(json({ ok: true, capture: null })); }); expect(document.querySelector("input")).toBeNull(); expect(fetcher).toHaveBeenCalledOnce(); expect(mocks.load).not.toHaveBeenCalled();
  });
});
