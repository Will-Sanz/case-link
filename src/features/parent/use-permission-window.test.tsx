// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissionWindowCurrent, usePermissionWindow } from "./use-permission-window";

function Window({ end, start }: { end: number; start?: number }) {
  return <p>{usePermissionWindow(end, start) ? "open" : "closed"}</p>;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("absolute permission window", () => {
  it("closes at the exact deadline and cancels the timer on unmount", () => {
    const view = render(<Window end={2_000}/>);
    expect(screen.getByText("open")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.getByText("open")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText("closed")).toBeTruthy();
    view.rerender(<Window end={3_000}/>);
    expect(screen.getByText("open")).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never carries an old live window into an expired or invalid replacement", () => {
    const view = render(<Window end={2_000}/>);
    view.rerender(<Window end={1_000}/>);
    expect(screen.getByText("closed")).toBeTruthy();
    view.rerender(<Window end={NaN}/>);
    expect(screen.getByText("closed")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    expect(permissionWindowCurrent(Infinity)).toBe(false);
    expect(permissionWindowCurrent(2_000, NaN)).toBe(false);
  });
  it("rejects a future consent time until that time, without extending expiry", () => {
    render(<Window start={1_500} end={2_000}/>);
    expect(screen.getByText("closed")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText("open")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText("closed")).toBeTruthy();
  });
  it("rechecks a suspended page on focus without needing a request-scope change", () => {
    render(<Window end={2_000}/>);
    act(() => { vi.setSystemTime(2_001); window.dispatchEvent(new Event("focus")); });
    expect(screen.getByText("closed")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reschedules long deadlines instead of expiring at the browser timeout limit", () => {
    const end = 1_000 + 2_147_483_647 + 100;
    render(<Window end={end}/>);
    act(() => { vi.advanceTimersByTime(2_147_483_647); });
    expect(screen.getByText("open")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText("closed")).toBeTruthy();
  });
  it("keeps server-rendered protected controls closed", () => {
    expect(renderToString(<Window end={2_000}/>)).toContain("closed");
  });
});
