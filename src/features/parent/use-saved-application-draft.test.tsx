// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { useSavedApplicationDraft } from "./use-saved-application-draft";
const request = fixtureRequest({ version: 2 }), savedId = "22222222-2222-4222-8222-222222222222";
const record = { id: savedId, request_id: request.id, base_version: 1, request_version: 2, idempotency_key: "old-key", notice_version: "notice", details: { firstName: "Saved" } };
const deadline = "2026-11-10T16:00:00Z";
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const buildBody = (details: typeof record.details, expectedVersion: number) => ({ details, expectedVersion, noticeVersion: "notice" });
function setup(input = {}) {
  const callbacks = { onSaved: vi.fn(), onAccessDenied: vi.fn() };
  const initial = { request, record: { ...record }, current: true, available: true, ...input };
  const hook = renderHook(props => useSavedApplicationDraft({ ...props, ...callbacks, savedMessage: "Known saved" }), { initialProps: initial });
  return { ...hook, callbacks };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-03T15:00:00Z")); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("shared saved-application draft lifecycle", () => {
  it("freezes an opaque JSON body and key across unreadable success, blocks edits, and builds only once", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ ok: true }, 201)).mockResolvedValueOnce(json({ snapshotId: savedId })); vi.stubGlobal("fetch", fetcher);
    const { result, callbacks } = setup(), body = vi.fn((details, version) => ({ ...buildBody(details, version), programmeOnly: { choices: ["one", "two"] } }));
    act(() => result.current.begin({ firstName: "Unsent" }));
    await act(async () => { await result.current.save("/requests/example/application", deadline, body); });
    expect(result.current.uncertain).toBe(true);
    act(() => { result.current.change({ firstName: "Changed while unconfirmed" }); result.current.begin({ firstName: "Another attempt" }); });
    expect(result.current.draft!.value.firstName).toBe("Unsent");
    await act(async () => { await result.current.save("/requests/example/application", deadline, body); });
    expect(body).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body); expect(fetcher.mock.calls[1][1].headers).toEqual(fetcher.mock.calls[0][1].headers);
    expect(result.current.draft).toBeNull(); expect(callbacks.onSaved).toHaveBeenCalledOnce();
  });
  it("cannot revive an aborted pending save when its previous permission scope returns", async () => {
    let finish!: (value: unknown) => void; const fetcher = vi.fn((url: string, init?: RequestInit) => { expect(url).toContain("/api/parent/"); expect(init?.method).toBe("POST"); return new Promise(resolve => { finish = resolve; }); }); vi.stubGlobal("fetch", fetcher);
    const { result, rerender, callbacks } = setup();
    act(() => result.current.begin({ firstName: "Retained" }));
    let pending!: Promise<void>; act(() => { pending = result.current.save("/requests/example/application", deadline, buildBody); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    rerender({ request: { ...request, version: 3 }, record, current: true, available: true });
    expect(result.current.pending).toBe(false); expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    rerender({ request, record, current: true, available: true });
    expect(result.current.pending).toBe(false); expect(result.current.uncertain).toBe(true);
    await act(async () => { finish(json({ snapshotId: savedId })); await pending; });
    expect(callbacks.onSaved).not.toHaveBeenCalled(); expect(result.current.draft!.value.firstName).toBe("Retained");
  });
  it("acknowledges the exact owned GET after a no-op save without a second POST or request-version bump", async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => { expect(url).toContain("/api/parent/"); expect(init?.method).toBe("POST"); return new Promise(() => {}); }); vi.stubGlobal("fetch", fetcher);
    const { result, rerender, callbacks } = setup();
    act(() => result.current.begin({ firstName: "Saved" }));
    let pending!: Promise<void>; act(() => { pending = result.current.save("/requests/example/application", deadline, buildBody); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const init = fetcher.mock.calls[0][1]!, key = (init.headers as Record<string, string>)["Idempotency-Key"];
    rerender({ request, current: true, available: true, record: { ...record, id: crypto.randomUUID(), base_version: 2, request_version: 2, idempotency_key: key } });
    await act(async () => { await pending; });
    expect(result.current.message).toBe("Known saved"); expect(result.current.draft).toBeNull(); expect(fetcher).toHaveBeenCalledOnce(); expect(callbacks.onSaved).not.toHaveBeenCalled();
  });
  it("keeps an unsaved draft when a different latest snapshot arrives and resets only by explicit action", () => {
    const { result, rerender } = setup(); act(() => result.current.begin({ firstName: "Own unsaved answer" }));
    const latest = { ...record, id: crypto.randomUUID(), details: { firstName: "New server answer" } };
    rerender({ request, record: latest, current: true, available: true });
    expect(result.current.draft!.value.firstName).toBe("Own unsaved answer"); expect(result.current.editingCurrent).toBe(false);
    act(() => { result.current.reset(); }); act(() => result.current.begin(latest.details));
    expect(result.current.draft!.value.firstName).toBe("New server answer");
  });
  it("preserves a typed conflict and never sends a changed attempt before explicit reload", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "This request changed." }, 409)); vi.stubGlobal("fetch", fetcher);
    const { result } = setup(); act(() => result.current.begin({ firstName: "Retained" }));
    await act(async () => { await result.current.save("/requests/example/application", deadline, buildBody); });
    expect(result.current.conflict).toBe(true);
    act(() => result.current.change({ firstName: "Ignored" })); await act(async () => { await result.current.save("/requests/example/application", deadline, buildBody); });
    expect(fetcher).toHaveBeenCalledOnce(); expect(result.current.draft!.value.firstName).toBe("Retained");
  });
  it("bounds an asynchronous body preflight under the save scope and cannot POST its late result", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); let finish!: (body: unknown) => void;
    const { result, rerender } = setup(); act(() => result.current.begin({ firstName: "Retained" }));
    let pending!: Promise<void>; act(() => { pending = result.current.save("/requests/example/application", deadline, () => new Promise(resolve => { finish = resolve; })); });
    expect(result.current.pending).toBe(true); rerender({ request: { ...request, version: 3 }, record, current: true, available: true });
    await act(async () => { finish({ details: { firstName: "Late" } }); await pending; });
    expect(fetcher).not.toHaveBeenCalled(); expect(result.current.draft!.value.firstName).toBe("Retained");
  });
  it("allows correction after a known-no-write source preflight while keeping an already unknown attempt frozen", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 201)).mockResolvedValueOnce(json({ error: "source changed" }, 412)); vi.stubGlobal("fetch", fetcher);
    const { result } = setup(); act(() => result.current.begin({ firstName: "Retained" }));
    const failed = vi.fn(async () => { const { ParentApiError } = await import("./api"); throw new ParentApiError("Refresh linked family answers", 412); });
    await act(async () => { await result.current.save("/requests/example/application", deadline, failed); });
    expect(result.current.uncertain).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    await act(async () => { await result.current.save("/requests/example/application", deadline, buildBody); });
    expect(result.current.uncertain).toBe(true);
    await act(async () => { await result.current.save("/requests/example/application", deadline, failed); });
    expect(failed).toHaveBeenCalledOnce(); expect(result.current.uncertain).toBe(true);
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  });
  it("denies writes after the actual deadline even when a stale caller still reports availability", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const { result } = setup(); act(() => result.current.begin({ firstName: "Retained" }));
    vi.setSystemTime(new Date(deadline)); await act(async () => { await result.current.save("/requests/example/application", deadline, buildBody); });
    expect(fetcher).not.toHaveBeenCalled(); expect(result.current.draft!.value.firstName).toBe("Retained");
  });
});
