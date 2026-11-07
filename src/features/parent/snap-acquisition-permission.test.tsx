// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate, fixtureRequest, fixtureSnapCaptureIntent, fixtureSnapSnapshot } from "@/lib/parent/test-fixtures";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
import { SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD, type SnapDirectAcquisitionResult } from "@/lib/parent/snap-direct-acquisition-contract";
import { SnapAcquisitionPermission } from "./snap-acquisition-permission";

const now = new Date("2026-11-05T22:00:00.000Z"), snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(now));
const request = fixtureRequest({ version: 2, intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
  mandate: fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: "2026-11-05T22:30:00.000Z" }) });
const intent = fixtureSnapCaptureIntent(), context = { requestVersion: 2, snapshotId: snapshot.id, snapshotHash: intent.snapshotHash,
  source: snapshot.source, applyingSubjectIds: snapshot.details.household!.map(person => person.id) };
const acquisition: SnapDirectAcquisitionResult = { ownerId: intent.ownerId, requestId: request.id, requestVersion: 2, snapshotId: snapshot.id, snapshotHash: context.snapshotHash,
  recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", method: SNAP_DIRECT_ACQUISITION_METHOD,
  fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: snapshot.source, subjectIds: context.applyingSubjectIds,
  policyVersion: intent.policyVersion, retentionPolicyVersion: intent.retentionPolicyVersion, expiresAt: "2026-11-05T22:05:00.000Z",
  state: "permission_needed", acquisitionId: null, authorityDeclaration: null, consentedAt: null };
const granted: SnapDirectAcquisitionResult = { ...acquisition, state: "authorized", acquisitionId: intent.packetId,
  authorityDeclaration: "parent_declared_household_data_authority", consentedAt: now.toISOString() };
const json = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value });
const saved = (value: unknown = granted) => json({ ok: true, acquisition: value });
const declaration = /I may provide the applying people/;
const props = () => ({ request: structuredClone(request), snapshot: structuredClone(snapshot), context: structuredClone(context), acquisition: structuredClone(acquisition) as SnapDirectAcquisitionResult, onAuthorized: vi.fn() });
function checkAndAllow() { fireEvent.click(screen.getByRole("checkbox", { name: declaration })); fireEvent.click(screen.getByRole("button", { name: "Allow and continue" })); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("exact private SNAP acquisition permission", () => {
  it("explains actual use, named subjects, expiry and withdrawal before enabling a single explicit POST", async () => {
    const input = props(), fetcher = vi.fn(async () => saved()); vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>);
    expect(screen.getByText(/People applying:/).parentElement!.textContent).toContain(`${snapshot.details.household![0].firstName} ${snapshot.details.household![0].lastName}`);
    expect(screen.getByText(/Permission and the private form expire/).textContent).toContain("5:05 PM");
    expect(screen.getByText(/CaseLink may use these entries/).textContent).toContain("Protected entries stay out of AI");
    expect(screen.getByText(/Permission and the private form expire/).textContent).toContain("Cancel request & withdraw permission");
    expect(screen.queryByRole("textbox")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Allow and continue" }) as HTMLButtonElement).disabled).toBe(true);
    checkAndAllow(); await act(async () => {});
    expect(fetcher).toHaveBeenCalledOnce(); const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/parent/requests/${request.id}/snap-acquisition`); expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 2, snapshotId: snapshot.id, snapshotHash: context.snapshotHash,
      acquisitionId: expect.stringMatching(/^[a-f0-9-]{36}$/), policyVersion: acquisition.policyVersion,
      retentionPolicyVersion: acquisition.retentionPolicyVersion, acceptedExpiresAt: acquisition.expiresAt, subjectIds: acquisition.subjectIds, authorityDeclared: true });
    expect(input.onAuthorized).toHaveBeenCalledExactlyOnceWith(granted);
  });
  it("lets the parent decline without writing or opening personal fields", () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...props()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("status").textContent).toContain("Personal steps are paused"); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Use the official SNAP service" }).getAttribute("href")).toBe("https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("resumes declined permission without silently preserving an earlier declaration", async () => {
    const input = props(), fetcher = vi.fn(async () => saved()); vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Review personal-step permission" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    checkAndAllow(); await act(async () => {}); expect(input.onAuthorized).toHaveBeenCalledOnce();
  });
  it("blocks duplicate posts while saving", async () => {
    let finish!: (value: ReturnType<typeof saved>) => void;
    const input = props(), fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>);
    checkAndAllow(); fireEvent.click(screen.getByRole("button", { name: "Saving permission…" })); expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => { finish(saved()); }); expect(input.onAuthorized).toHaveBeenCalledOnce();
  });
  it("reconciles a lost acknowledgement using GET only and reuses an actual saved grant", async () => {
    const input = props(), fetcher = vi.fn(async (_url: string, init: RequestInit) => { if (init.method === "POST") throw new Error("PRIVATE-CANARY"); return saved(); });
    vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>); checkAndAllow(); await act(async () => {});
    expect(fetcher.mock.calls.map(([, init]) => init.method ?? "GET")).toEqual(["POST", "GET"]); expect(input.onAuthorized).toHaveBeenCalledExactlyOnceWith(granted); expect(document.body.textContent).not.toContain("PRIVATE-CANARY");
  });
  it("keeps an unresolved acknowledgement closed and never posts again, even when a later read has no grant", async () => {
    const input = props(), fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? json({ ok: false, error: "PRIVATE-CANARY" }, 503) : saved(acquisition));
    vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>); checkAndAllow(); await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain("Permission is not confirmed yet");
    fireEvent.click(screen.getByRole("button", { name: "Allow and continue" })); fireEvent.click(screen.getByRole("button", { name: "Check saved permission" })); await act(async () => {});
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1); expect(input.onAuthorized).not.toHaveBeenCalled(); expect(screen.queryByRole("textbox")).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-CANARY");
  });
  it("does not overlap acknowledgement reads on focus, pageshow or manual checks", async () => {
    let finish!: (value: ReturnType<typeof saved>) => void; const input = props();
    const fetcher = vi.fn((_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error()) : new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher); render(<SnapAcquisitionPermission {...input}/>); checkAndAllow(); await act(async () => {});
    await act(async () => { fireEvent(window, new Event("focus")); fireEvent(window, new Event("pageshow")); fireEvent.click(screen.getByRole("button", { name: "Check saved permission" })); });
    expect(fetcher).toHaveBeenCalledTimes(2); await act(async () => { finish(saved()); }); expect(input.onAuthorized).toHaveBeenCalledOnce();
  });
  it.each(["owner", "request", "version", "snapshot", "hash", "policy", "retention", "subjects", "source", "expired", "future", "extended"])("rejects %s changes in an apparent grant and never opens fields", async kind => {
    const input = props(), value = structuredClone(granted);
    if (kind === "owner") value.ownerId = request.id;
    if (kind === "request") value.requestId = snapshot.id;
    if (kind === "version") value.requestVersion++;
    if (kind === "snapshot") value.snapshotId = request.id;
    if (kind === "hash") value.snapshotHash = "f".repeat(64);
    if (kind === "policy") value.policyVersion += "changed";
    if (kind === "retention") value.retentionPolicyVersion += "changed";
    if (kind === "subjects") value.subjectIds = [request.id];
    if (kind === "source") Reflect.set(value.source, "templateSha256", "f".repeat(64));
    if (kind === "expired") value.expiresAt = now.toISOString();
    if (kind === "future" && value.state === "authorized") value.consentedAt = "2026-11-05T22:01:00.000Z";
    if (kind === "extended") value.expiresAt = "2026-11-05T22:05:01.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => saved(value))); render(<SnapAcquisitionPermission {...input}/>); checkAndAllow(); await act(async () => {});
    expect(input.onAuthorized).not.toHaveBeenCalled(); expect(screen.getByRole("status").textContent).toContain("Permission is not confirmed yet");
  });
  it.each(["cancelled", "wrong_need", "subject", "context_version", "snapshot", "source", "mandate", "expires", "existing_grant"])("does not offer new permission for %s metadata", kind => {
    const input = props();
    if (kind === "cancelled") input.request.status = "cancelled";
    if (kind === "wrong_need") input.request.intake.needs = ["food_now"];
    if (kind === "subject") input.acquisition.subjectIds = [request.id];
    if (kind === "context_version") input.context.requestVersion++;
    if (kind === "snapshot") input.snapshot.id = request.id;
    if (kind === "source") Reflect.set(input.context.source, "templateSha256", "f".repeat(64));
    if (kind === "mandate") input.request.mandate.allowedActions = ["research"];
    if (kind === "expires") input.acquisition.expiresAt = now.toISOString();
    if (kind === "existing_grant") input.acquisition = structuredClone(granted);
    render(<SnapAcquisitionPermission {...input}/>); expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Allow and continue" })).toBeNull();
  });
  it("preserves a choice across identical polls and clears it when permission scope changes", () => {
    const input = props(), page = render(<SnapAcquisitionPermission {...input}/>); fireEvent.click(screen.getByRole("checkbox", { name: declaration }));
    page.rerender(<SnapAcquisitionPermission {...props()} onAuthorized={input.onAuthorized}/>); expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    page.rerender(<SnapAcquisitionPermission {...input} acquisition={{ ...input.acquisition, policyVersion: "changed-policy" }}/>); expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("ignores a late write reply after a correction or unmount", async () => {
    let finish!: (value: ReturnType<typeof saved>) => void; const input = props(), fetcher = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    const page = render(<SnapAcquisitionPermission {...input}/>); checkAndAllow(); page.rerender(<SnapAcquisitionPermission {...input} request={{ ...input.request, version: 3 }}/>);
    await act(async () => { finish(saved()); }); expect(input.onAuthorized).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce(); expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("ends an uncooperative write at thirty seconds, reconciles once at a time and closes at expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const input = props(), fetcher = vi.fn(() => new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
    await act(async () => { render(<SnapAcquisitionPermission {...input}/>); }); checkAndAllow();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(screen.getByRole("status").textContent).toContain("Permission is not confirmed yet"); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(265000); }); expect(screen.queryByRole("checkbox")).toBeNull(); expect(input.onAuthorized).not.toHaveBeenCalled(); expect(screen.getByRole("status").textContent).toContain("unavailable");
  });
});
