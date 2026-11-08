// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApplicationBrowser } from "./application-browser";
import {
  COMPASS_FAMILY_SAFETY,
  type ApplicationBrowserResponse,
} from "@/lib/parent/browser-policy";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { getProgram } from "@/lib/parent/programs";

const request = fixtureRequest();
const sessionId = "e1671f04-783d-469e-ad76-a426c2a2d832";
const firstFrame = "13175423-0b23-4292-a9f9-9071c9903178";
const nextFrame = "b2cc06d3-385e-4e92-93bf-2f2ad7f2cb53";
function record(
  kind: "continue" | "challenge" = "continue",
): ApplicationBrowserResponse {
  return {
    ok: true,
    available: true,
    reason: null,
    session: {
      id: sessionId,
      programId: "snap-pa",
      status: "needs_parent",
      currentUrl: COMPASS_FAMILY_SAFETY,
      title: "Pennsylvania COMPASS",
      summary: "Public connection check.",
      updatedAt: new Date().toISOString(),
      canControl: true,
      frameUrl: `/api/parent/requests/${request.id}/browser/frame?frameId=${firstFrame}`,
      handoff: {
        kind,
        frameId: firstFrame,
        width: 1100,
        height: 720,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    },
  };
}
function setup(
  initial = record(),
  command?: (
    input: unknown,
    signal: AbortSignal,
  ) => Promise<{ status: number }>,
  onNeedsVerification?: (needed: boolean) => void,
  preparedApplicationAvailable = false,
) {
  let state = initial;
  let metadataStatus = 200;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    let status = !init?.method || init.method === "GET" ? metadataStatus : 200;
    if (url.endsWith("/control"))
      status =
        (await command?.(JSON.parse(String(init?.body)), init!.signal!))
          ?.status ?? 200;
    if (init?.method === "DELETE")
      state = {
        ...state,
        session: {
          ...state.session!,
          status: "closed",
          canControl: false,
          handoff: null,
          frameUrl: null,
        },
      };
    return { ok: status === 200, status, json: async () => state };
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(
    <ApplicationBrowser request={request} canStart hasAttempt={false} preparedApplicationAvailable={preparedApplicationAvailable} onNeedsVerification={onNeedsVerification} />,
  );
  return {
    fetch,
    view,
    setState: (next: ApplicationBrowserResponse) => {
      state = next;
    },
    failMetadata: () => {
      metadataStatus = 502;
    },
  };
}
async function loadFrame() {
  const image = await screen.findByRole("img");
  fireEvent.load(image);
  return image;
}
const commandCalls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith("/control"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["none", "closed"] as const)("keeps the official service secondary with a prepared application and %s session", async state => {
  const initial = record();
  initial.session = state === "none" ? null : { ...initial.session!, status: "closed", canControl: false, handoff: null, frameUrl: null };
  const { fetch } = setup(initial, undefined, undefined, true);
  await screen.findByText("Your prepared SNAP application is above.");
  expect(screen.getByRole("link", { name: "Open the official SNAP service" }).getAttribute("href")).toBe(getProgram("snap-pa")!.officialUrl);
  expect(screen.queryByRole("button", { name: /application view|Refresh application connection/ })).toBeNull();
  expect(screen.queryByText(/Connection check only/)).toBeNull();
  expect(screen.queryByRole("link", { name: "Start a new SNAP application with DHS" })).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps an active owned verification and Stop fully usable when the prepared application is above", async () => {
  const verification = vi.fn(), { fetch } = setup(record("challenge"), undefined, verification, true);
  await loadFrame();
  expect(screen.queryByText("Your prepared SNAP application is above.")).toBeNull();
  expect(screen.getByRole("heading", { name: "Complete the COMPASS verification" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Interact with COMPASS verification image" }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("button", { name: "Stop website view" }).hasAttribute("disabled")).toBe(false);
  expect(verification).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Interact with COMPASS verification image" }), { detail: 0 });
  await waitFor(() => expect(commandCalls(fetch)).toHaveLength(1));
  expect(JSON.parse(String(commandCalls(fetch)[0][1].body)).action).toEqual({ type: "key", key: "Tab" });
});

it("enables the preview continuation only after its exact image loads, without calling it a required personal act", async () => {
  const { fetch } = setup();
  const button = await screen.findByRole("button", {
    name: "Continue with COMPASS",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.queryByText("A personal check needs you")).toBeNull();
  const image = await loadFrame();
  expect(image.getAttribute("src")).toContain(`frameId=${firstFrame}`);
  expect(image.getAttribute("width")).toBe("1100");
  expect(image.getAttribute("height")).toBe("720");
  fireEvent.click(button);
  await waitFor(() => expect(commandCalls(fetch)).toHaveLength(1));
  expect(JSON.parse(String(commandCalls(fetch)[0][1].body))).toEqual({
    sessionId,
    frameId: firstFrame,
    action: { type: "continue" },
  });
});

it("keeps Stop available during an action and ignores its late response", async () => {
  let finish: (value: { status: number }) => void = () => {};
  const { fetch } = setup(
    record(),
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await loadFrame();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with COMPASS" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Checking COMPASS…" }));
  expect(commandCalls(fetch)).toHaveLength(1);
  const stop = screen.getByRole("button", { name: "Stop website view" });
  expect(stop.hasAttribute("disabled")).toBe(false);
  fireEvent.click(stop);
  await screen.findByText(
    "Website viewer stopped. Your support request and its permission have not changed.",
  );
  expect(commandCalls(fetch)[0][1].signal.aborted).toBe(true);
  finish({ status: 200 });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Continue with COMPASS" }),
    ).toBeNull(),
  );
});

it("maps scaled pointer positions and native keyboard controls to the same owned session", async () => {
  const { fetch } = setup(record("challenge"));
  await loadFrame();
  const target = screen.getByRole("button", {
    name: "Interact with COMPASS verification image",
  });
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 100,
    width: 550,
    height: 360,
  } as DOMRect);
  fireEvent.click(target, { clientX: 375, clientY: 280, detail: 1 });
  await waitFor(() => expect(commandCalls(fetch)).toHaveLength(1));
  expect(JSON.parse(String(commandCalls(fetch)[0][1].body)).action).toEqual({
    type: "click",
    x: 0.5,
    y: 0.5,
  });
  await waitFor(() =>
    expect(screen.getByRole("img").getAttribute("src")).toContain("view=1"),
  );
  await loadFrame();
  fireEvent.click(screen.getByText("Use keyboard controls"));
  fireEvent.click(
    screen.getByRole("button", { name: "Next control" }),
  );
  await waitFor(() => expect(commandCalls(fetch)).toHaveLength(2));
  expect(JSON.parse(String(commandCalls(fetch)[1][1].body)).action).toEqual({
    type: "key",
    key: "Tab",
  });
});

it("uses keyboard activation to enter verification without inventing a pointer coordinate", async () => {
  const { fetch } = setup(record("challenge"));
  await loadFrame();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Interact with COMPASS verification image",
    }),
    { detail: 0 },
  );
  await waitFor(() => expect(commandCalls(fetch)).toHaveLength(1));
  expect(JSON.parse(String(commandCalls(fetch)[0][1].body)).action).toEqual({
    type: "key",
    key: "Tab",
  });
});

it("refreshes a stale view without automatically repeating its action", async () => {
  const next = record();
  next.session!.handoff!.frameId = nextFrame;
  next.session!.frameUrl = `/api/parent/requests/${request.id}/browser/frame?frameId=${nextFrame}`;
  let update: (value: ApplicationBrowserResponse) => void = () => {};
  const { fetch, setState } = setup(record(), async () => {
    update(next);
    return { status: 409 };
  });
  update = setState;
  await loadFrame();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with COMPASS" }),
  );
  await screen.findByText(/The website view changed/);
  expect(commandCalls(fetch)).toHaveLength(1);
  await waitFor(() =>
    expect(screen.getByRole("img").getAttribute("src")).toContain(nextFrame),
  );
  expect(
    screen
      .getByRole("button", { name: "Continue with COMPASS" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("disables an expired or failed image while preserving Stop and the official alternative", async () => {
  const initial = record();
  initial.session!.handoff!.expiresAt = new Date(
    Date.now() - 1000,
  ).toISOString();
  const { fetch } = setup(initial);
  const image = await loadFrame();
  expect(
    screen
      .getByRole("button", { name: "Continue with COMPASS" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("button", { name: "Stop website view" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(
    screen.getByRole("link", { name: "Start a new SNAP application with DHS" }),
  ).toBeTruthy();
  fireEvent.error(image);
  expect(screen.getByText(/browser image could not load/)).toBeTruthy();
  expect(commandCalls(fetch)).toHaveLength(0);
});

it("calls a completed browser check a connection result and removes parent controls", async () => {
  const initial = record();
  initial.session = {
    ...initial.session!,
    status: "completed",
    canControl: false,
    handoff: null,
    frameUrl: null,
    summary:
      "The official household form was reached in this same browser session. No household information was entered and no application was submitted.",
  };
  setup(initial);
  await screen.findByRole("heading", { name: "Connection check complete" });
  expect(
    screen.queryByRole("button", { name: "Continue with COMPASS" }),
  ).toBeNull();
  expect(
    screen.getByText(
      /No household information was entered and no application was submitted/,
    ),
  ).toBeTruthy();
});

it("disables controls when a loaded session expires while the page remains open", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const initial = record();
  initial.session!.handoff!.expiresAt = new Date(
    Date.now() + 1000,
  ).toISOString();
  setup(initial);
  await loadFrame();
  expect(
    screen
      .getByRole("button", { name: "Continue with COMPASS" })
      .hasAttribute("disabled"),
  ).toBe(false);
  await act(async () => {
    vi.advanceTimersByTime(1001);
  });
  expect(
    screen
      .getByRole("button", { name: "Continue with COMPASS" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText(/This website session expired/)).toBeTruthy();
});

it("does not enable an unexpired handoff when its current image fails", async () => {
  const { fetch } = setup();
  const image = await loadFrame();
  fireEvent.error(image);
  const button = screen.getByRole("button", { name: "Continue with COMPASS" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(commandCalls(fetch)).toHaveLength(0);
});

it("keeps only Stop recovery after metadata fails for an active owned session", async () => {
  const { fetch, failMetadata } = setup();
  await loadFrame();
  failMetadata();
  fireEvent.click(screen.getByRole("button", { name: "Refresh application connection" }));
  await screen.findByText(/We couldn’t confirm the application connection/);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue with COMPASS" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open application view" })).toBeNull();
  const previousControls = commandCalls(fetch).length;
  fireEvent.click(screen.getByRole("button", { name: "Stop website view" }));
  await screen.findByText(/Website viewer stopped/);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  expect(commandCalls(fetch)).toHaveLength(previousControls);
});

it.each(["completed", "blocked", "error"] as const)("clears the family verification signal after %s", async (status) => {
  const notify = vi.fn();
  const { setState, failMetadata, view } = setup(record("challenge"), undefined, notify);
  await loadFrame();
  await waitFor(() => expect(notify).toHaveBeenLastCalledWith(true));
  if (status === "error") failMetadata();
  else setState({ ...record(), session: { ...record().session!, status, canControl: false, handoff: null, frameUrl: null } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh application connection" }));
  await waitFor(() => expect(notify).toHaveBeenLastCalledWith(false));
  view.unmount();
  expect(notify).toHaveBeenLastCalledWith(false);
});
