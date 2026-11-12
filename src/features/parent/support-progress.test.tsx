// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportProgress } from "@/lib/parent/progress";
import { PROGRESS_LABELS, SupportProgressPanel, ApplicationSchedule } from "./support-progress";
import { fixtureRequest, fixtureMandate } from "@/lib/parent/test-fixtures";

afterEach(cleanup);
const progress = (state: SupportProgress["state"]): SupportProgress => ({
  state,
  summary: "Recorded service state.",
  updatedAt: "2026-10-26T16:00:00.000Z",
  nextRunAt: null,
  canContinueAfterClosing: false,
});

describe("application schedule evidence", () => {
  const request = () => fixtureRequest({ mandate: fixtureMandate({ expiresAt: new Date(Date.now() + 60000).toISOString() }), next_trigger: "parent_action_completed" });
  it("distinguishes a future personal step from a recorded Submit decision", () => {
    const r = request();
    const { rerender } = render(<ApplicationSchedule request={r} progress={progress("waiting")} />);
    expect(screen.getByText(/Completion of your required step/)).toBeTruthy();
    expect(screen.getByText(/No automatic check is currently scheduled/)).toBeTruthy();
    rerender(<ApplicationSchedule request={r} progress={progress("waiting")} decisionFinished />);
    expect(screen.getByText(/Submit is already recorded/)).toBeTruthy();
    expect(screen.queryByText(/Completion of your required step/)).toBeNull();
  });
  it("shows only a verified active schedule, stopping it for expired or paused permission", () => {
    const r = request(), scheduled = { ...progress("waiting"), nextRunAt: "2026-11-12T19:00:00Z" };
    const { rerender } = render(<ApplicationSchedule request={r} progress={scheduled} />);
    expect(document.querySelector("time")?.dateTime).toBe(scheduled.nextRunAt);
    rerender(<ApplicationSchedule request={r} progress={{ ...scheduled, state: "service_offline" }} />);
    expect(document.querySelector("time")).toBeNull();
    expect(screen.getByText(/schedule cannot currently be verified/)).toBeTruthy();
    rerender(<ApplicationSchedule request={{ ...r, mandate: { ...r.mandate, expiresAt: "2000-01-01T00:00:00Z" } }} progress={scheduled} />);
    expect(screen.getByText(/Permission has expired; future work is stopped/)).toBeTruthy();
    expect(document.querySelector("time")).toBeNull();
    rerender(<ApplicationSchedule request={{ ...r, status: "paused" }} progress={scheduled} />);
    expect(screen.getByText(/Future work is stopped/)).toBeTruthy();
    expect(document.querySelector("time")).toBeNull();
  });
});

describe("recorded support progress", () => {
  it.each(Object.keys(PROGRESS_LABELS) as SupportProgress["state"][])(
    "shows %s without inventing completion or a percentage",
    (state) => {
      render(
        <SupportProgressPanel progress={progress(state)} onRefresh={vi.fn()} />,
      );
      expect(
        screen.getByRole("heading", { name: PROGRESS_LABELS[state] }),
      ).toBeTruthy();
      expect(screen.getByText("Recorded service state.")).toBeTruthy();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(screen.queryByText(/You can leave this page/)).toBeNull();
    },
  );
  it("only promises continuation and a next check when the server confirms them", () => {
    const refresh = vi.fn();
    render(
      <SupportProgressPanel
        progress={{
          ...progress("queued"),
          canContinueAfterClosing: true,
          nextRunAt: "2026-10-26T16:05:00.000Z",
        }}
        onRefresh={refresh}
      />,
    );
    expect(screen.getByText(/You can leave this page/)).toBeTruthy();
    expect(screen.getByText(/Next check scheduled for/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh support progress" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("says that background activity cannot be verified when no status was returned", () => {
    render(<SupportProgressPanel onRefresh={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Status unavailable" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/saved request does not mean an application was sent/),
    ).toBeTruthy();
  });
  it("makes an unscheduled wait explicit and updates it when a check is scheduled", () => {
    const { rerender } = render(
      <SupportProgressPanel progress={progress("waiting")} onRefresh={vi.fn()} />,
    );
    expect(screen.getByText(/No automatic check is currently scheduled/)).toBeTruthy();
    expect(screen.queryByText(/Next check scheduled for/)).toBeNull();
    rerender(<SupportProgressPanel progress={{ ...progress("waiting"), nextRunAt: "2026-10-26T16:05:00.000Z" }} onRefresh={vi.fn()} />);
    expect(screen.queryByText(/No automatic check is currently scheduled/)).toBeNull();
    expect(screen.getByText(/Next check scheduled for/)).toBeTruthy();
  });
  it.each(["queued", "running", "needs_parent", "paused", "cancelled", "closed", "failed", "service_offline"] as const)(
    "does not describe %s as an unscheduled wait", (state) => {
      render(<SupportProgressPanel progress={progress(state)} onRefresh={vi.fn()} />);
      expect(screen.queryByText(/No automatic check is currently scheduled/)).toBeNull();
    },
  );
  it("does not treat an unavailable worker heartbeat as proof that all work has stopped", () => {
    render(
      <SupportProgressPanel
        progress={progress("service_offline")}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/We cannot confirm that background work is running/),
    ).toBeTruthy();
    expect(screen.getByText(/Last recorded work update/)).toBeTruthy();
    expect(
      screen.queryByText("No work is running in the background."),
    ).toBeNull();
  });
});
