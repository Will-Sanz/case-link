// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportProgress } from "@/lib/parent/progress";
import { PROGRESS_LABELS, SupportProgressPanel } from "./support-progress";
import { ParentLocaleProvider } from "./parent-locale";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);
const progress = (state: SupportProgress["state"]): SupportProgress => ({
  state,
  summary: "Recorded service state.",
  updatedAt: "2026-10-26T16:00:00.000Z",
  nextRunAt: null,
  canContinueAfterClosing: false,
});

describe("recorded support progress", () => {
  it("translates the recorded next actor and Eastern schedule without inventing continuation", () => {
    render(<ParentLocaleProvider initialLocale="es"><SupportProgressPanel progress={{ ...progress("waiting"),
      summary: "Waiting for the next recorded program update. Check the activity below for what was actually sent.",
      nextRunAt: "2026-11-18T02:30:00Z" }} onRefresh={vi.fn()} /></ParentLocaleProvider>);
    expect(screen.getByRole("heading", { name: "En espera del próximo paso" })).toBeTruthy();
    expect(screen.getByText("Esperando la próxima actualización registrada del programa. Consulte la actividad abajo para ver qué se envió realmente.").getAttribute("lang")).toBe("es");
    expect(screen.getByText(/^17 nov 2026, 9:30 p\. ?m\.$/).getAttribute("datetime")).toBe("2026-11-18T02:30:00Z");
    expect(screen.queryByText(/Puede salir de esta página/)).toBeNull();
    expect(screen.getByRole("button", { name: "Actualizar el progreso del apoyo" })).toBeTruthy();
  });
  it("keeps unrecognized original service evidence explicitly English", () => {
    render(<ParentLocaleProvider initialLocale="es"><SupportProgressPanel progress={progress("waiting")} onRefresh={vi.fn()} /></ParentLocaleProvider>);
    expect(screen.getByText("Recorded service state.").getAttribute("lang")).toBe("en");
    expect(screen.getByText("No hay ninguna comprobación automática programada actualmente. Consulte la actividad registrada para ver el próximo paso.")).toBeTruthy();
  });
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
