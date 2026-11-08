// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportProgress } from "@/lib/parent/progress";
import { PROGRESS_LABELS, SupportProgressPanel } from "./support-progress";

afterEach(cleanup);
const progress = (state: SupportProgress["state"]): SupportProgress => ({
  state,
  summary: "Recorded service state.",
  updatedAt: "2026-10-26T16:00:00.000Z",
  nextRunAt: null,
  canContinueAfterClosing: false,
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
