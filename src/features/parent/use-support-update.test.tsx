// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureNow, fixtureRequest } from "@/lib/parent/test-fixtures";
import type { SupportUpdate, SupportUpdateReceipt } from "@/lib/parent/support-update";
import { useSupportUpdate } from "./use-support-update";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const update: SupportUpdate = { action: "answer_facts", version: 1, answers: [{ need: "food_now", field: "householdSize", value: 4 }, { need: "food_now", field: "income", value: { amount: 0, frequency: "weekly" } }] };
function server() {
  const state = { request: fixtureRequest(), owner, issuedAt: fixtureNow.toISOString(), expiresAt: new Date(fixtureNow.getTime()+86400000).toISOString(),
    commit: true, loseAck: false, denied: false, offline: false, receipt: null as SupportUpdateReceipt | null, body: "", writes: 0 };
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (state.offline) throw new Error("offline");
    if (state.denied) return reply({ error: "This support request is unavailable, or its permission has changed." }, 403);
    if (init?.method === "POST") {
      const key = (init.headers as Record<string,string>)["Idempotency-Key"];
      if (state.receipt) return state.body === init.body ? reply({ update: { ownerId: state.owner, receipt: state.receipt } }) : reply({ error: "This request changed." }, 409);
      if (state.commit) {
        state.writes++; state.body = String(init.body);
        const input = JSON.parse(state.body) as SupportUpdate;
        state.request = { ...state.request, version: input.version + (input.action === "answer_facts" ? input.answers.length : 1) };
        state.receipt = { id: crypto.randomUUID(), key, requestId: state.request.id, action: input.action,
          baseVersion: input.version, resultVersion: state.request.version, recordedAt: fixtureNow.toISOString() };
      }
      if (state.loseAck || !state.commit) throw new Error("lost acknowledgement");
      return reply({ update: { ownerId: state.owner, receipt: state.receipt } });
    }
    expect(url).toContain("?updateKey=");
    return reply({ request: state.request, update: { ownerId: state.owner, receipt: state.receipt, issuedAt: state.issuedAt, expiresAt: state.expiresAt } });
  });
  vi.stubGlobal("fetch", fetch);
  return { state, fetch, posts: () => fetch.mock.calls.filter(([, init]) => init?.method === "POST") };
}

it("recovers an exact committed bundle after a lost ACK without another mutation or a new key", async () => {
  const s = server(), saved = vi.fn(); s.state.loseAck = true;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update));
  expect(result.current.unresolved).toBe(true); expect(s.state.writes).toBe(1); expect(saved).not.toHaveBeenCalled();
  s.state.loseAck = false;
  await act(() => result.current.check());
  expect(saved).toHaveBeenCalledExactlyOnceWith(s.state.request, false);
  expect(s.posts()).toHaveLength(2); expect(s.posts()[0][1]?.body).toBe(s.posts()[1][1]?.body);
  expect(s.posts()[0][1]?.headers).toEqual(s.posts()[1][1]?.headers); expect(s.state.writes).toBe(1);
});
it("checks an absent receipt without sending; only an explicit retry resends the original bytes and deadline", async () => {
  const s = server(), saved = vi.fn(); s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  let acceptedExpiry = "";
  await act(() => result.current.save(expiresAt => { acceptedExpiry = expiresAt; return { action: "replace_mandate", version: 1, mandate: { ...s.state.request.mandate, expiresAt } }; }));
  s.state.issuedAt = new Date(fixtureNow.getTime()+60000).toISOString(); s.state.expiresAt = new Date(fixtureNow.getTime()+2*86400000).toISOString();
  await act(() => result.current.check()); expect(s.posts()).toHaveLength(1); expect(result.current.locked).toBe(true);
  s.state.commit = true; await act(() => result.current.retry());
  expect(s.posts()).toHaveLength(2); expect(s.posts()[1][1]?.body).toBe(s.posts()[0][1]?.body);
  expect(JSON.parse(String(s.posts()[1][1]?.body)).mandate.expiresAt).toBe(acceptedExpiry); expect(saved).toHaveBeenCalledOnce();
});
it("uses authoritative time and still acknowledges a recorded receipt after the original window or permission ends", async () => {
  const s = server(), saved = vi.fn(); s.state.loseAck = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2035-01-01T00:00:00Z");
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); expect(s.state.writes).toBe(1);
  s.state.issuedAt = "2035-01-01T00:00:00Z"; s.state.request = { ...s.state.request, status: "cancelled", version: 4 }; s.state.loseAck = false;
  await act(() => result.current.check()); expect(saved).toHaveBeenCalledExactlyOnceWith(s.state.request, true); expect(s.state.writes).toBe(1);
});
it("never resends an unrecorded accepted edit after its original server deadline", async () => {
  const s = server(), saved = vi.fn(); s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); s.state.issuedAt = s.state.expiresAt;
  await act(() => result.current.retry()); expect(s.posts()).toHaveLength(1); expect(result.current.error).toContain("window ended"); expect(saved).not.toHaveBeenCalled();
});
it("serializes rapid saves before the first owned read resolves", async () => {
  const s = server(), saved = vi.fn();
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(async () => { await Promise.all([result.current.save(() => update), result.current.save(() => ({ ...update, version: 7 }))]); });
  expect(s.state.writes).toBe(1); expect(s.posts()).toHaveLength(1); expect(saved).toHaveBeenCalledOnce();
});
it("retains a conflicting accepted draft until an explicit current owned review; it never overwrites the newer version", async () => {
  const s = server(), saved = vi.fn(); s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); s.state.request = { ...s.state.request, version: 4, status: "paused" };
  await act(() => result.current.retry()); expect(s.posts()).toHaveLength(1); expect(result.current.conflict).toBe(true);
  const reviewed = vi.fn(); await act(() => result.current.review(reviewed));
  expect(reviewed).toHaveBeenCalledExactlyOnceWith(s.state.request); expect(result.current.locked).toBe(false); expect(saved).not.toHaveBeenCalled();
});
it("cannot discard an absent but still potentially committing receipt by reviewing latest", async () => {
  const s = server(); s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, vi.fn()));
  await act(() => result.current.save(() => update)); const reviewed = vi.fn();
  await act(() => result.current.review(reviewed));
  expect(reviewed).not.toHaveBeenCalled(); expect(result.current.locked).toBe(true); expect(s.posts()).toHaveLength(1);
});
it("rechecks current ownership after a successful POST before applying its private response", async () => {
  const s = server(), saved = vi.fn(), original = s.fetch.getMockImplementation()!;
  s.fetch.mockImplementation(async (url, init) => { const reply = await original(url, init); if (init?.method === "POST") { s.state.owner = other; s.state.denied = true; } return reply; });
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); expect(saved).not.toHaveBeenCalled(); expect(result.current.locked).toBe(true);
});
it("ignores a delayed response after the owning request changes or unmounts", async () => {
  const s = server(), saved = vi.fn(), original = s.fetch.getMockImplementation()!;
  let release!: () => void;
  s.fetch.mockImplementation(async (url, init) => { const reply = await original(url, init); if (init?.method === "POST") await new Promise<void>(done => { release = done; }); return reply; });
  const { result, rerender, unmount } = renderHook(({ id }) => useSupportUpdate(id, saved), { initialProps: { id: s.state.request.id } });
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.save(() => update); await new Promise(done => setTimeout(done, 0)); });
  rerender({ id: other }); unmount(); await act(async () => { release(); await pending; }); expect(saved).not.toHaveBeenCalled();
});
it("does not treat matching receipt metadata as an exact-body acknowledgement", async () => {
  const s = server(), saved = vi.fn(); s.state.loseAck = true;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); s.state.body = JSON.stringify({ ...update, answers: [] }); s.state.loseAck = false;
  await act(() => result.current.check()); expect(result.current.conflict).toBe(true); expect(saved).not.toHaveBeenCalled(); expect(s.state.writes).toBe(1);
});
it("bounds automatic unknown reads and never automatically dispatches an unrecorded write", async () => {
  vi.useFakeTimers(); const s = server(); s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, vi.fn()));
  await act(() => result.current.save(() => update));
  for (let i=0;i<8;i++) await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(s.posts()).toHaveLength(1); expect(s.fetch.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(7);
  expect(result.current.unresolved).toBe(true);
});
it.each(["read", "known_ack"])("keeps the accepted packet when a %s response unexpectedly fails with400", async stage => {
  const s = server(), saved = vi.fn(); s.state.loseAck = true;
  if (stage === "read") s.state.commit = false;
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update));
  const original = s.fetch.getMockImplementation()!;
  s.fetch.mockImplementation(async (url, init) => {
    if (stage === "read" && init?.method !== "POST" || stage === "known_ack" && init?.method === "POST")
      return { ok: false, status: 400, json: async () => ({ error: "Unexpected response" }) };
    return original(url, init);
  });
  await act(() => result.current.check()); expect(result.current.locked).toBe(true); expect(saved).not.toHaveBeenCalled();
  s.fetch.mockImplementation(original); s.state.commit = true; s.state.loseAck = false;
  await act(() => result.current.retry()); expect(saved).toHaveBeenCalledOnce();
  expect(s.posts().at(-1)?.[1]?.body).toBe(s.posts()[0][1]?.body);
});
it("permits correction after a definite validation rejection of a new unrecorded write", async () => {
  const s = server(), original = s.fetch.getMockImplementation()!;
  let first = true;
  s.fetch.mockImplementation(async (url, init) => {
    if (init?.method === "POST" && first) { first = false; return { ok: false, status: 400, json: async () => ({ error: "Check your answer", supportUpdateRejected: true }) }; }
    return original(url, init);
  });
  const saved = vi.fn(), { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); expect(result.current.locked).toBe(false); expect(s.state.writes).toBe(0);
  await act(() => result.current.save(() => ({ action: "answer_fact", version: 1, need: "food_now", field: "householdSize", value: 5 })));
  expect(saved).toHaveBeenCalledOnce(); expect(s.state.writes).toBe(1);
});
it.each(["generic400", "generic422", "truncated400", "null400", "array400"])("keeps a committed packet on %s without an explicit application rejection", async kind => {
  const s = server(), original = s.fetch.getMockImplementation()!, saved = vi.fn(); let first = true;
  s.fetch.mockImplementation(async (url, init) => {
    const normal = await original(url, init);
    if (init?.method === "POST" && first) {
      first = false;
      return { ok: false, status: kind === "generic422" ? 422 : 400, json: async () => {
        if (kind === "truncated400") throw new SyntaxError("truncated");
        if (kind === "null400") return null;
        if (kind === "array400") return [];
        return { error: "Unexpected gateway failure" };
      } };
    }
    return normal;
  });
  const { result } = renderHook(() => useSupportUpdate(s.state.request.id, saved));
  await act(() => result.current.save(() => update)); expect(result.current.unresolved).toBe(true); expect(saved).not.toHaveBeenCalled();
  if (["null400", "array400", "truncated400"].includes(kind)) expect(result.current.error).toContain("couldn’t read the response");
  await act(() => result.current.check()); expect(saved).toHaveBeenCalledOnce(); expect(s.state.writes).toBe(1);
  expect(s.posts().at(-1)?.[1]?.body).toBe(s.posts()[0][1]?.body);
});
