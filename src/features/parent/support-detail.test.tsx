// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportRequest } from "@/lib/parent/domain";
import { initialIntake, buildMandate } from "./intake";
import { SupportDetail } from "./support-detail";
import { buildSupportPlan } from "@/lib/parent/planning";
import { getProgram, SNAP_NEW_APPLICATION_URL } from "@/lib/parent/programs";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const requestId = "11111111-1111-4111-8111-111111111111";
const fixture = (): SupportRequest => ({
  id: requestId,
  household_id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  intake: { ...initialIntake, needs: ["electricity"], zip: "19104" },
  mandate: buildMandate(
    initialIntake,
    ["peco-cap"],
    "prepare_only",
    "ask_me",
    "2026-11-24T12:00:00.000Z",
  ),
  plan: null,
  required_actions: [],
  version: 1,
  created_at: "2026-10-25T12:00:00Z",
  updated_at: "2026-10-25T12:00:00Z",
  events: [],
  documents: [],
});
const response = (request: SupportRequest) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, request }),
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("support detail", () => {
  it.each([
    "snap_new",
    "snap_renewal",
    "snap_pending",
    "snap_problem",
  ] as const)(
    "offers a new-application shortcut only for snap_new, preserving %s routing",
    async (need) => {
      const request = fixture();
      request.intake.needs = [need];
      request.mandate = buildMandate(
        request.intake,
        ["snap-pa"],
        "prepare_only",
        "ask_me",
        "2026-11-24T12:00:00.000Z",
      );
      request.plan =
        need === "snap_new"
          ? null
          : buildSupportPlan(
              request.intake,
              request.mandate,
              new Date(request.updated_at),
            );
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
      render(<SupportDetail requestId={requestId} />);
      await screen.findByRole("heading", { name: "Program progress" });
      if (need !== "snap_new")
        expect(
          screen
            .getByRole("link", { name: "Official program & direct access" })
            .getAttribute("href"),
        ).toBe(getProgram("snap-pa")!.officialUrl);
      const shortcut = screen.queryByRole("link", {
        name: "Start a new SNAP application with DHS",
      });
      expect(shortcut?.getAttribute("href") ?? null).toBe(
        need === "snap_new" ? SNAP_NEW_APPLICATION_URL : null,
      );
      if (need === "snap_new")
        expect(
          screen.getByText(/opening it does not file an application/),
        ).toBeTruthy();
    },
  );
  it("shows the parent's actual outcome and reference with attribution after reload", async () => {
    const request = fixture();
    request.events = [
      {
        id: "parent-report",
        request_id: requestId,
        kind: "parent.outcome_reported",
        actor: "parent",
        summary: "You reported an outcome for electricity.",
        created_at: request.updated_at,
        evidence: {
          need: "electricity",
          outcome: "support_received",
          reference: "Pantry pickup on Monday.",
          attribution: "parent_reported",
        },
      },
    ];
    request.events_truncated = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />);
    expect(
      await screen.findByText("Reported outcome: Support received"),
    ).toBeTruthy();
    expect(screen.getByText("Pantry pickup on Monday.")).toBeTruthy();
    expect(screen.getByText("Parent reported")).toBeTruthy();
    expect(screen.getByText(/Showing the latest 200 updates/)).toBeTruthy();
  });
  it("allows correcting WIC household answers without inventing an answer for Not sure", async () => {
    const request = fixture();
    request.intake.needs = ["wic_new"];
    const fetch = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    fireEvent.change(
      screen.getByLabelText("Does your household include a child under five?"),
      { target: { value: "false" } },
    );
    fireEvent.change(
      screen.getByLabelText("Is anyone pregnant or recently postpartum?"),
      { target: { value: "unknown" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
        true,
      ),
    );
    const post = fetch.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({
      action: "correct",
      intake: { childrenUnderFive: false, pregnantOrPostpartum: null },
      version: 1,
    });
  });
  it("offers wrapping permission choices and requires fresh consent after changing actions", async () => {
    const request = fixture();
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/authorization-window")
        ? {
            ok: true,
            json: async () => ({
              ok: true,
              authorization: { expiresAt: "2026-11-24T12:00:00.000Z" },
            }),
          }
        : response(request),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Change or renew permission" }),
    );
    const group = screen.getByRole("group", {
      name: "Actions within these limits",
    });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).queryByRole("combobox")).toBeNull();
    const consent = screen.getByLabelText(/I authorize these programs/);
    fireEvent.click(consent);
    fireEvent.click(
      within(group).getByRole("radio", {
        name: /^Prepare and carry out permitted steps/,
      }),
    );
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Save updated permission",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole("button", { name: "Save updated permission" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    )!;
    expect(JSON.parse(String(post[1].body)).mandate).toMatchObject({
      mode: "full",
      allowedActions: [
        "research",
        "prepare",
        "share",
        "submit",
        "schedule",
        "follow_up",
      ],
    });
  });
  it("shows the actual named recipient count and avoids repeating a route’s program name", async () => {
    const request = fixture();
    request.mandate.maxRecipients = 8;
    request.plan = buildSupportPlan(
      request.intake,
      request.mandate,
      new Date(request.created_at),
    );
    request.plan.routes[0].title = "PECO assistance programs";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />);
    const heading = await screen.findByRole("heading", {
      name: /^Electric bill$/,
    });
    const article = heading.closest("article")!;
    expect(
      within(article).getAllByText("PECO assistance programs", { exact: true }),
    ).toHaveLength(1);
    expect(screen.getByText(/1 named program$/)).toBeTruthy();
    expect(screen.queryByText(/8 named programs/)).toBeNull();
  });
  it("opens and focuses permission changes from the exact required step", async () => {
    const request = fixture();
    request.required_actions = [
      {
        id: "permission-income",
        need: "electricity",
        reason: "expanded_permission",
        resolver: "parent",
        title: "Allow required income information",
        explanation: "The selected program requires this information.",
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Review permission$/,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Permission for up to 30 days" }),
    ).toBeTruthy();
    expect(document.activeElement?.getAttribute("type")).toBe("checkbox");
    fireEvent.click(screen.getByLabelText(/I authorize these programs/));
    expect((document.activeElement as HTMLInputElement).checked).toBeDefined();
  });
  it("labels independent utility questions with the account they affect", async () => {
    const request = fixture();
    request.intake.needs = ["electricity", "gas"];
    request.required_actions = ["electricity", "gas"].map((need) => ({
      id: `authority-${need}`,
      need: need as "electricity" | "gas",
      reason: "missing_fact",
      resolver: "parent",
      field: "accountAuthority",
      title: "Can you act for this utility account?",
      explanation: "Your authority is needed for this account only.",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />);
    expect(
      await screen.findByRole("region", {
        name: "Electric bill Can you act for this utility account?",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", {
        name: "Gas bill Can you act for this utility account?",
      }),
    ).toBeTruthy();
  });
  it("preserves an unsaved correction and original version while progress refreshes", async () => {
    const request = fixture();
    let reads = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/partners"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, partners: [] }),
        };
      if (url.endsWith("/assistant"))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [],
            available: false,
            unavailableReason: "Assistant unavailable.",
            historyLimited: false,
          }),
        };
      if (url.endsWith("/operations"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, operations: [] }),
        };
      if (options?.method !== "POST") reads++;
      return response(reads > 1 ? { ...request, version: 2 } : request);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    const details = screen
      .getByText("Correct household or bill information")
      .closest("details")!;
    fireEvent(details, new Event("toggle"));
    fireEvent.change(screen.getByLabelText("ZIP code"), {
      target: { value: "19105" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh support progress" }),
    );
    await waitFor(() => expect(reads).toBe(2));
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe(
      "19105",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(reads).toBe(3));
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(String(post![1]!.body)).version).toBe(1);
    expect(JSON.parse(String(post![1]!.body)).intake.zip).toBe("19105");
  });
  it("requires a separate informed cancellation action before stopping support", async () => {
    const request = fixture();
    const fetchMock = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel request & withdraw permission",
      }),
    );
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, cancel this request" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(post![1].body)).toEqual({ action: "cancel" });
  });
  it("keeps an unsaved correction after a network refresh failure and stops claiming a current running status", async () => {
    const request = fixture();
    let disconnected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/assistant"))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              messages: [],
              available: false,
              unavailableReason: "Unavailable.",
              historyLimited: false,
            }),
          };
        if (url.endsWith("/partners"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ partners: [] }),
          };
        if (url.endsWith("/operations"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ operations: [] }),
          };
        if (disconnected) throw new Error("Disconnected");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            request,
            progress: {
              state: "running",
              summary: "Recorded worker activity.",
              updatedAt: request.updated_at,
              nextRunAt: null,
              canContinueAfterClosing: true,
            },
          }),
        };
      }),
    );
    render(<SupportDetail requestId={requestId} />);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    fireEvent.change(screen.getByLabelText("ZIP code"), {
      target: { value: "19105" },
    });
    disconnected = true;
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh support progress" }),
    );
    await screen.findByRole("alert");
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe(
      "19105",
    );
    expect(
      screen.getByRole("heading", { name: "Status unavailable" }),
    ).toBeTruthy();
    expect(screen.queryByText("Recorded worker activity.")).toBeNull();
  });
  it("attributes evidence and keeps operator-owned connection work away from parent action cards", async () => {
    const request = fixture();
    request.required_actions = [
      {
        id: "connection",
        need: "electricity",
        resolver: "operator",
        reason: "execution_issue",
        title: "Verify program connection",
        explanation: "The service channel needs verification.",
      },
    ];
    request.events = [
      {
        id: "event",
        request_id: requestId,
        kind: "parent.reported",
        actor: "parent",
        summary: "An outcome was reported",
        created_at: request.created_at,
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />);
    expect(
      await screen.findByText("CaseLink is handling a service step"),
    ).toBeTruthy();
    expect(screen.getByText("Parent reported")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open the official program" }),
    ).toBeNull();
  });
});
