// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SupportProgress } from "@/lib/parent/progress";
import { MySupport } from "./my-support";

const request = fixtureRequest();
const response = (state: SupportProgress["state"], requests: SupportRequest[] = [request]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    requests,
    progress: { [request.id]: {
      state, summary: `Recorded ${state} progress`, updatedAt: request.updated_at,
      nextRunAt: null, canContinueAfterClosing: false,
    } },
  }),
});
let visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<MySupport />); });
  return result;
}
async function tick() {
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
}
async function show() {
  visibility = "visible";
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}

describe("current support-list progress", () => {
  it("does not restart a slow outstanding refresh on another timer or visibility event", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response("queued")).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    ).mockResolvedValue(response("waiting"));
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    const signal = fetch.mock.calls[1][1].signal as AbortSignal;
    await tick();
    await show();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
    await act(async () => { finish(response("needs_parent")); });
    expect(screen.getByText("A step needs you")).toBeTruthy();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Waiting for the next step")).toBeTruthy();
  });

  it("updates recorded progress while visible without posting new work", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("queued")).mockResolvedValue(response("needs_parent"));
    vi.stubGlobal("fetch", fetch);
    await open();
    expect(screen.getByText("Waiting to start")).toBeTruthy();
    await tick();
    expect(screen.getByText("A step needs you")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
  });

  it("skips hidden polling and checks once on return to the tab", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("queued")).mockResolvedValue(response("running"));
    vi.stubGlobal("fetch", fetch);
    await open();
    visibility = "hidden";
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    await show();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("CaseLink is working")).toBeTruthy();
  });

  it.each(["closed", "empty"])("allows manual refresh without background polling for a %s list", async (state) => {
    const requests = state === "empty" ? [] : [{ ...request, status: "closed" as const }];
    const fetch = vi.fn().mockResolvedValue(response("closed", requests));
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh support status" })); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("also refreshes paused requests when another session resumes them", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("paused", [{ ...request, status: "paused" }])).mockResolvedValue(response("running"));
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    expect(screen.getByText("CaseLink is working")).toBeTruthy();
  });

  it("shows refresh failure instead of repeating an old running claim and recovers", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("running")).mockResolvedValueOnce({
      ok: false, status: 502, json: async () => ({ ok: false, error: "Status is temporarily unavailable." }),
    }).mockResolvedValue(response("waiting"));
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    expect(screen.getByRole("alert").textContent).toContain("Status is temporarily unavailable.");
    expect(screen.queryByText("CaseLink is working")).toBeNull();
    await tick();
    expect(screen.getByText("Waiting for the next step")).toBeTruthy();
  });

  it("clears records and stops polling after authentication is lost", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("running")).mockResolvedValue({
      ok: false, status: 401, json: async () => ({ ok: false, error: "Sign in again." }),
    });
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    expect(screen.queryByRole("link", { name: /View support/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Sign in to continue/ })).toBeTruthy();
    await tick();
    await show();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears records and stops polling when processing is closed", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response("running")).mockResolvedValue({
      ok: false, status: 503, json: async () => ({ ok: false, error: "Processing is unavailable." }),
    });
    vi.stubGlobal("fetch", fetch);
    await open();
    await tick();
    expect(screen.queryByRole("link", { name: /View support/ })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Processing is unavailable.");
    await tick();
    await show();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cleans the timer, visibility listener and request on unmount", async () => {
    const fetch = vi.fn().mockResolvedValue(response("running"));
    vi.stubGlobal("fetch", fetch);
    const mounted = await open();
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    await tick();
    await show();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
