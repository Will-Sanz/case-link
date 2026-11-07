// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useLayoutEffect, useState } from "react";
import { fixtureIntake, fixtureMandate, fixtureProtectedSnapOperation, fixtureRequest } from "@/lib/parent/test-fixtures";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "@/lib/parent/snap-protected-operation";
const mocks = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn(), revoke: vi.fn(), display: vi.fn(), reloads: new Map<string, () => void>() }));
vi.mock("@/lib/parent/snap-review-file", () => ({ loadSnapReviewFile: mocks.load }));
vi.mock("./use-parent-resource", async importOriginal => {
  const actual = await importOriginal<typeof import("./use-parent-resource")>();
  return { useParentResource: (path: string) => { const value = actual.useParentResource(path); mocks.reloads.set(path, value.reload); return value; } };
});
vi.mock("./snap-review-pdf", async () => {
  const { useEffect } = await import("react");
  return { SnapReviewPdf: ({ onReady }: { onReady: (ready: boolean) => void }) => {
    const ready = mocks.display(); useEffect(() => onReady(ready), [ready, onReady]);
    return <div role="img" aria-label="Exact SNAP application test viewer"/>;
  } };
});
import { SnapFinalReview } from "./snap-final-review";

const operation = fixtureProtectedSnapOperation(), request = fixtureRequest({ intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }), mandate: fixtureMandate({ recipientIds: ["snap-pa"] }),
  required_actions: [{ id: "synthetic-current-review", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Review and submit", explanation: "Synthetic reviewed exact operation" }] });
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const bytes = () => new Uint8Array([37, 80, 68, 70]); // Explicit loader fixture; this suite does not verify PDF content.
function api(review: unknown = operation, post?: (url: string, init: RequestInit) => unknown) {
  let authorized = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (post) return post(url, init);
      authorized = true; return json({ ok: true, operationId: operation.operationId, state: "authorization_recorded" });
    }
    return json({ ok: true, review: authorized ? { ...operation, snapSubmissionAuthorized: true, personalActsComplete: true } : review });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.reloads.clear(); mocks.display.mockReturnValue(true); mocks.load.mockImplementation(async () => bytes()); mocks.create.mockReturnValue("blob:https://caselink.test/synthetic-pdf");
  vi.stubGlobal("URL", class extends URL { static createObjectURL = mocks.create; static revokeObjectURL = mocks.revoke; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("exact parent SNAP final review and genuine Submit", () => {
  it("waits for exact private rendering and records the visible personal-step report only with a genuine Submit click", async () => {
    let resolve!: (value: Uint8Array) => void; mocks.load.mockReturnValue(new Promise<Uint8Array>(done => { resolve = done; }));
    const fetcher = api(), changed = vi.fn(); render(<SnapFinalReview request={request} onChange={changed}/>);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce()); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    const privateBytes = bytes(); resolve(privateBytes);
    const submit = await screen.findByRole("button", { name: "Submit" }); expect(submit.matches(":disabled")).toBe(false);
    expect(submit.getAttribute("aria-describedby")).toBe("snap-final-submit-report");
    expect(screen.getByText(/By choosing Submit, I confirm/).textContent).toMatch(/handwritten signatures and dates.*pages 1 and 5.*Pennsylvania SNAP/);
    expect(screen.queryByRole("checkbox")).toBeNull(); expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(screen.getByRole("img", { name: "Exact SNAP application test viewer" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open this exact application PDF/ }).getAttribute("rel")).toBe("noopener noreferrer");
    expect([...privateBytes]).toEqual([0, 0, 0, 0]);
    fireEvent.click(submit);
    await screen.findByText(/Your Submit decision is recorded/); expect(changed).toHaveBeenCalledOnce();
    const attempt = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(attempt[0]).toBe(`/api/parent/requests/${request.id}/snap-submission`);
    expect(JSON.parse(attempt[1]!.body as string)).toEqual({ operationId: operation.operationId, expectedVersion: request.version, packetHash: operation.packetHash,
      packetId: operation.packet.protectedSnapPacket.packetId, contentSha256: operation.packet.protectedSnapPacket.contentSha256, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS] });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(document.body.textContent).not.toContain("SNAP application complete");
  });
  it.each([{ protectedParentSubmitReady: false }, { protectedPacketCurrent: false }])("does not offer Submit for an unresolved requirement: %j", async change => {
    api({ ...operation, ...change }); render(<SnapFinalReview request={request}/>);
    await screen.findByRole("link", { name: /Open this exact application PDF/ });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/CaseLink must resolve/)).toBeTruthy();
  });
  it.each(["executing", "delivery_unknown", "sent"])("shows a recorded delivery status without another Submit or an invented receipt: %s", async state => {
    api({ ...operation, state, snapSubmissionAuthorized: false, protectedParentSubmitReady: false }); render(<SnapFinalReview request={request}/>);
    await screen.findByText(/You do not need to Submit this application again/);
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.body.textContent).not.toContain("SNAP application complete"); expect(document.body.textContent).not.toContain("CaseLink must resolve");
  });
  it("keeps a failed PDF closed until an explicit retry succeeds", async () => {
    api(); mocks.load.mockRejectedValueOnce(new Error("PRIVATE-CANARY")); render(<SnapFinalReview request={request}/>);
    const retry = await screen.findByRole("button", { name: "Try again" }); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(document.body.textContent).not.toContain("PRIVATE-CANARY"); fireEvent.click(retry);
    await screen.findByRole("button", { name: "Submit" }); expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("corrects the exact file through the version-changing page route without another intake form", async () => {
    const changed = vi.fn(), fetcher = api(operation, () => json({ ok: true, requestVersion: request.version + 1 }));
    render(<SnapFinalReview request={request} onChange={changed}/>); await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const attempt = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(attempt[0]).toContain("/snap-application/capture"); expect(JSON.parse(attempt[1]!.body as string)).toEqual({ expectedVersion: request.version, previousPacketId: operation.packet.protectedSnapPacket.packetId });
    expect(screen.getByRole("link", { name: "Correct saved answers" }).getAttribute("href")).toBe("#application-answers");
  });
  it("closes superseded private pages as soon as replacement is recorded, before any parent refresh", async () => {
    const changed = vi.fn(), review = structuredClone(operation);
    api(review, () => json({ ok: true, requestVersion: request.version + 1 }));
    const page = render(<SnapFinalReview request={request} onChange={changed}/>); await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("link", { name: /Open this exact application PDF/ })).toBeNull();
    expect(mocks.revoke).toHaveBeenCalledWith("blob:https://caselink.test/synthetic-pdf"); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByText(/Waiting for the current application revision/)).toBeTruthy();
    Object.assign(review, { requestVersion: request.version + 1 });
    page.rerender(<SnapFinalReview request={{ ...request, version: request.version + 1 }} onChange={changed}/>);
    expect(await screen.findByRole("button", { name: "Submit" })).toBeTruthy();
  });
  it("revokes the superseded URL during the replacement commit, before following layout observers", async () => {
    api(operation, () => json({ ok: true, requestVersion: request.version + 1 }));
    const observed = vi.fn();
    function Review() {
      const [recorded, setRecorded] = useState(false);
      useLayoutEffect(() => {
        if (!recorded) return;
        observed({ shown: !!screen.queryByRole("img"), revoked: mocks.revoke.mock.calls.some(([url]) => url === "blob:https://caselink.test/synthetic-pdf") });
      }, [recorded]);
      return <SnapFinalReview request={request} onChange={() => setRecorded(true)}/>;
    }
    render(<Review/>); await screen.findByRole("button", { name: "Submit" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); });
    expect(observed).toHaveBeenCalledExactlyOnceWith({ shown: false, revoked: true });
  });
  it.each([null, { ...operation, requestVersion: request.version + 1 }, { ...operation, requestId: "11111111-1111-4111-8111-111111111111" }])("does not open or Submit a missing or different application: %j", async review => {
    api(review); render(<SnapFinalReview request={request}/>); await screen.findByText(/The exact application is not available for review yet/);
    expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it("aborts pending work and clears a late file when the review is closed", async () => {
    let resolve!: (value: Uint8Array) => void; mocks.load.mockReturnValue(new Promise<Uint8Array>(done => { resolve = done; }));
    api(); const result = render(<SnapFinalReview request={request}/>); await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
    const signal = mocks.load.mock.calls[0][1] as AbortSignal; result.unmount(); expect(signal.aborted).toBe(true);
    const privateBytes = bytes(); resolve(privateBytes); await waitFor(() => expect([...privateBytes]).toEqual([0, 0, 0, 0])); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("revokes the loaded local PDF URL when the review closes", async () => {
    api(); const result = render(<SnapFinalReview request={request}/>); await screen.findByRole("button", { name: "Submit" }); result.unmount();
    expect(mocks.revoke).toHaveBeenCalledWith("blob:https://caselink.test/synthetic-pdf");
  });
  it("closes the exact viewer at a shortened mandate expiry without a poll or another Submit", async () => {
    vi.useFakeTimers(); const now = new Date("2026-11-05T22:00:00.000Z"); vi.setSystemTime(now);
    const value = { ...request, mandate: { ...request.mandate, expiresAt: new Date(now.getTime() + 30000).toISOString() } };
    const fetcher = api(), changed = vi.fn(); let page!: ReturnType<typeof render>;
    await act(async () => { page = render(<SnapFinalReview request={value} onReviewChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    page.rerender(<SnapFinalReview request={{ ...value, mandate: { ...value.mandate, expiresAt: new Date(now.getTime() + 5000).toISOString() } }} onReviewChange={changed}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); }); expect(screen.getByRole("img")).toBeTruthy();
    vi.setSystemTime(new Date(now.getTime() + 5000));
    fireEvent.click(screen.getByRole("button", { name: "Submit" })); fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("link", { name: /Open this exact application PDF/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.getByRole("button", { name: "Replace personal pages" }).matches(":disabled")).toBe(true);
    expect(screen.getByText(/Your application permission has expired or could not be checked/)).toBeTruthy();
    expect(mocks.revoke).toHaveBeenCalledWith("blob:https://caselink.test/synthetic-pdf"); expect(changed).toHaveBeenLastCalledWith(null);
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("aborts an unfinished exact load at mandate expiry and wipes late private bytes", async () => {
    vi.useFakeTimers(); const now = new Date("2026-11-05T22:00:00.000Z"); vi.setSystemTime(now);
    let finish!: (value: Uint8Array) => void; mocks.load.mockReturnValue(new Promise<Uint8Array>(resolve => { finish = resolve; })); api();
    await act(async () => { render(<SnapFinalReview request={{ ...request, mandate: { ...request.mandate, expiresAt: new Date(now.getTime() + 5000).toISOString() } }}/>); await vi.advanceTimersByTimeAsync(0); });
    const signal = mocks.load.mock.calls[0][1] as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(signal.aborted).toBe(true);
    const privateBytes = bytes(); await act(async () => { finish(privateBytes); });
    expect([...privateBytes]).toEqual([0, 0, 0, 0]); expect(mocks.create).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it.each(["2026-11-05T22:00:00.000Z", "invalid"])("does not open an exact file with an expired or invalid mandate: %s", async expiresAt => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T22:00:00.000Z")); api();
    await act(async () => { render(<SnapFinalReview request={{ ...request, mandate: { ...request.mandate, expiresAt } }}/>); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/Your application permission has expired or could not be checked/)).toBeTruthy(); expect(mocks.load).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.getByRole("button", { name: "Replace personal pages" }).matches(":disabled")).toBe(true);
  });
  it("requires a current parent review action, beyond merely having a prepared reference", async () => {
    api(); render(<SnapFinalReview request={{ ...request, required_actions: [] }}/>);
    await screen.findByRole("link", { name: /Open this exact application PDF/ }); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it("does not reuse a revoked same-file viewer after a metadata refresh fails to reload it", async () => {
    let rejectReload!: (error: Error) => void;
    mocks.load.mockResolvedValueOnce(bytes()).mockImplementation(() => new Promise<Uint8Array>((_, reject) => { rejectReload = reject; }));
    api(operation, () => { throw new Error("Synthetic lost Submit response"); }); render(<SnapFinalReview request={request}/>);
    const submit = await screen.findByRole("button", { name: "Submit" }); fireEvent.click(submit);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(mocks.revoke).toHaveBeenCalledWith("blob:https://caselink.test/synthetic-pdf");
    expect(screen.queryByRole("img", { name: "Exact SNAP application test viewer" })).toBeNull(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    rejectReload(new Error("PRIVATE-CANARY")); await screen.findByText(/The exact application could not be opened/);
    expect(screen.queryByRole("img", { name: "Exact SNAP application test viewer" })).toBeNull(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(document.body.textContent).not.toContain("PRIVATE-CANARY");
  });
  it("keeps Submit unavailable when verified PDF bytes cannot actually be displayed", async () => {
    mocks.display.mockReturnValue(false); api(); render(<SnapFinalReview request={request}/>);
    await screen.findByRole("img", { name: "Exact SNAP application test viewer" });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it.each(["fetch", "body"])("bounds an unknown Submit %s and only reconciles with GET, even after its late reply", async stage => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z"));
    let finish!: (value: unknown) => void;
    const stalled = new Promise(resolve => { finish = resolve; }), changed = vi.fn();
    const fetcher = api(operation, () => stage === "fetch" ? stalled : { ok: true, status: 202, json: () => stalled });
    let page!: ReturnType<typeof render>;
    await act(async () => { page = render(<SnapFinalReview request={request} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    const submit = screen.getByRole("button", { name: "Submit" }); fireEvent.click(submit); fireEvent.click(submit);
    page.rerender(<SnapFinalReview request={{ ...structuredClone(request), updated_at: "2026-11-06T16:30:01.000Z", events: [] }} onChange={changed}/>);
    expect(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.queryByText("Recording Submit…")).toBeNull(); expect(screen.getByText(/Submit result is not confirmed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(2);
    const signal = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal!; expect(signal.aborted).toBe(true);
    const calls = changed.mock.calls.length;
    await act(async () => { finish(stage === "fetch" ? json({ ok: true, operationId: operation.operationId, state: "authorization_recorded" }) : { ok: true, operationId: operation.operationId, state: "authorization_recorded" }); });
    expect(changed).toHaveBeenCalledTimes(calls); expect(screen.queryByText(/Your Submit decision is recorded/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check current application status" })); await act(async () => {});
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it.each(["expiry", "version", "unmount"])("ignores a late Submit result after %s and stops its pending work", async change => {
    vi.useFakeTimers(); const now = new Date("2026-11-06T16:30:00.000Z"); vi.setSystemTime(now);
    let finish!: (value: unknown) => void; const changed = vi.fn(), fetcher = api(operation, () => new Promise(resolve => { finish = resolve; }));
    const value = { ...request, mandate: { ...request.mandate, expiresAt: new Date(now.getTime() + 5000).toISOString() } };
    let page!: ReturnType<typeof render>; await act(async () => { page = render(<SnapFinalReview request={value} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    if (change === "expiry") await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    if (change === "version") page.rerender(<SnapFinalReview request={{ ...value, version: value.version + 1 }} onChange={changed}/>);
    if (change === "unmount") page.unmount();
    expect(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal?.aborted).toBe(true);
    await act(async () => { finish(json({ ok: true, operationId: operation.operationId, state: "authorization_recorded" })); });
    expect(changed).not.toHaveBeenCalled(); expect(screen.queryByText(/Your Submit decision is recorded/)).toBeNull();
  });
  it("clears pending immediately after a same-version mandate change without another poll", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z"));
    let finish!: (value: unknown) => void; const changed = vi.fn(), fetcher = api(operation, () => new Promise(resolve => { finish = resolve; }));
    let page!: ReturnType<typeof render>; await act(async () => { page = render(<SnapFinalReview request={request} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    page.rerender(<SnapFinalReview request={{ ...request, mandate: { ...request.mandate, expiresAt: "2026-11-06T16:31:00.000Z" } }} onChange={changed}/>);
    expect(screen.queryByText("Recording Submit…")).toBeNull(); expect(screen.getByText(/Submit result is not confirmed/)).toBeTruthy();
    expect(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal?.aborted).toBe(true);
    await act(async () => { finish(json({ ok: true, operationId: operation.operationId, state: "authorization_recorded" })); });
    expect(changed).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });
  it("aborts an old Submit when the exact review binding changes at the same request version", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z")); const current = structuredClone(operation);
    let finish!: (value: unknown) => void; const changed = vi.fn(), fetcher = api(current, () => new Promise(resolve => { finish = resolve; }));
    await act(async () => { render(<SnapFinalReview request={request} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    Object.assign(current, { operationId: request.household_id, packetHash: "d".repeat(64) });
    await act(async () => { mocks.reloads.get(`/requests/${request.id}/snap-submission?expectedVersion=${request.version}`)!(); await vi.advanceTimersByTimeAsync(0); });
    expect(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal?.aborted).toBe(true);
    await act(async () => { finish(json({ ok: true, operationId: operation.operationId, state: "authorization_recorded" })); });
    expect(changed).not.toHaveBeenCalled(); expect(screen.queryByText(/Your Submit decision is recorded/)).toBeNull();
  });
  it("bounds unknown page replacement and never repeats the correction write", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z")); const changed = vi.fn(), fetcher = api(operation, () => new Promise(() => {}));
    await act(async () => { render(<SnapFinalReview request={request} onChange={changed}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Replace personal pages" })); await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByText(/Page replacement result is not confirmed/)).toBeTruthy(); expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Replace personal pages" }).matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check current application status" })); await act(async () => {});
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("keeps the current write lifecycle usable after a Strict Mode remount check", async () => {
    const fetcher = api(); render(<StrictMode><SnapFinalReview request={request}/></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Submit" })); await screen.findByText(/Your Submit decision is recorded/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("accepts a GET-confirmed Submit decision after its POST response timed out", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z")); const review = structuredClone(operation);
    const fetcher = api(review, () => new Promise(() => {}));
    await act(async () => { render(<SnapFinalReview request={request}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Submit" })); Object.assign(review, { snapSubmissionAuthorized: true, personalActsComplete: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByText(/Your Submit decision is recorded/)).toBeTruthy(); expect(screen.queryByText(/Submit result is not confirmed/)).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(document.body.textContent).not.toMatch(/application submitted|application complete/i);
  });
  it("automatically reconciles an unknown Submit when the next idle GET confirms it, without another personal act", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T16:30:00.000Z")); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const review = structuredClone(operation), fetcher = api(review, () => { throw new Error("Synthetic lost Submit response"); });
    await act(async () => { render(<SnapFinalReview request={request}/>); await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Submit" })); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText(/Submit result is not confirmed/)).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(3);
    Object.assign(review, { snapSubmissionAuthorized: true, personalActsComplete: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText(/Your Submit decision is recorded/)).toBeTruthy(); expect(screen.queryByText(/Submit result is not confirmed/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(4); await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(fetcher).toHaveBeenCalledTimes(4);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string).completedActs).toEqual([...SNAP_PARENT_CERTIFICATION_ACTS]);
  });
  it.each(["foreign_operation", "private_extra"])("treats %s Submit replies as unconfirmed without echoing or another write", async kind => {
    const fetcher = api(operation, () => json({ ok: true, operationId: kind === "foreign_operation" ? request.household_id : operation.operationId,
      state: "authorization_recorded", ...(kind === "private_extra" ? { private: "PRIVATE-REPLY-CANARY" } : {}) }));
    render(<SnapFinalReview request={request}/>); fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await screen.findByText(/Submit result is not confirmed/); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(document.body.textContent).not.toContain("PRIVATE-"); expect(screen.queryByText(/Your Submit decision is recorded/)).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("reports only current owned review metadata to the containing workspace", async () => {
    const changed = vi.fn(); api(); render(<SnapFinalReview request={request} onReviewChange={changed}/>);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(operation));
    expect(changed.mock.calls.some(([value]) => value === null)).toBe(true);
  });
  it.each(["paused", "cancelled", "closed"] as const)("clears a usable viewer and stops asking for Submit when the request is %s", async status => {
    api(); const changed = vi.fn(), result = render(<SnapFinalReview request={request} onReviewChange={changed}/>);
    await screen.findByRole("button", { name: "Submit" });
    result.rerender(<SnapFinalReview request={{ ...request, status }} onReviewChange={changed}/>);
    expect(screen.getByRole("heading", { name: `SNAP work is ${status}` })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/will check the delivery|preparing the exact/);
    expect(mocks.revoke).toHaveBeenCalled(); await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
  });
});
