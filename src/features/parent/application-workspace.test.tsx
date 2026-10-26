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
import { useParentResource } from "./use-parent-resource";
import type { RecordedOperation } from "./support-activity";
import {
  ApplicationWorkspace,
  recordedApplicationState,
  supportTitle,
} from "./application-workspace";

const requestId = "11111111-1111-4111-8111-111111111111";
function fixture(): SupportRequest {
  const intake = {
    ...initialIntake,
    needs: ["snap_new"] as SupportRequest["intake"]["needs"],
    zip: "19104",
  };
  return {
    id: requestId,
    household_id: "22222222-2222-4222-8222-222222222222",
    status: "active",
    intake,
    mandate: buildMandate(
      intake,
      ["snap-pa"],
      "prepare_only",
      "ask_me",
      "2026-11-24T12:00:00.000Z",
    ),
    plan: null,
    required_actions: [],
    version: 1,
    created_at: "2026-10-25T12:00:00Z",
    updated_at: "2026-10-25T12:00:00Z",
    documents: [],
  };
}
function mockApi(
  browser = {
    available: false,
    reason: "The provider connection is not operational.",
    session: null,
  } as Record<string, unknown>,
  operations: unknown[] = [],
) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith("/operations")
        ? { ok: true, operations, historyLimited: false }
        : init?.method === "POST"
          ? { ok: true }
          : { ok: true, ...browser },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function WorkspaceFixture({ request }: { request: SupportRequest }) {
  const history = useParentResource<{
    operations: RecordedOperation[];
    historyLimited: boolean;
  }>(`/requests/${request.id}/operations`);
  return (
    <ApplicationWorkspace request={request} history={history}>
      <section id="your-next-steps" tabIndex={-1}>
        <input aria-label="Unsaved answer" />
      </section>
      <section id="application-programs" tabIndex={-1}>
        Recorded program work
      </section>
      <section id="application-documents" tabIndex={-1}>
        Document controls
      </section>
      <section id="application-receipts" tabIndex={-1}>
        Receipt records
      </section>
      <section id="application-controls" tabIndex={-1}>
        Permission controls
      </section>
    </ApplicationWorkspace>
  );
}
function renderWorkspace(request = fixture()) {
  return render(<WorkspaceFixture request={request} />);
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("actual application evidence", () => {
  it("does not turn a support plan or a prepared packet into a submitted application", () => {
    expect(recordedApplicationState([])).toMatchObject({
      label: "No application submission recorded",
      submitted: false,
    });
    expect(
      recordedApplicationState([
        { id: "packet", program_id: "snap-pa", state: "prepared" },
      ]),
    ).toMatchObject({ submitted: false });
    expect(
      recordedApplicationState([
        {
          id: "form",
          program_id: "snap-pa",
          state: "prepared",
          artifact_id: "form-1",
        },
      ]).detail,
    ).toMatch(/prepared form/);
  });
  it.each([
    "executing",
    "delivery_unknown",
    "sent",
    "partner_received",
    "partner_accepted",
    "unresolved",
  ])("does not treat %s as an agency receipt", (state) => {
    expect(
      recordedApplicationState([
        { id: "attempt", program_id: "snap-pa", state },
      ]),
    ).toMatchObject({
      label: "Agency submission not confirmed",
      submitted: false,
    });
  });
  it("requires the relevant program's submitted operation, not another program or an outcome report", () => {
    expect(
      recordedApplicationState(
        [{ id: "utility", program_id: "peco-cap", state: "agency_submitted" }],
        "snap-pa",
      ).submitted,
    ).toBe(false);
    expect(
      recordedApplicationState(
        [{ id: "snap", program_id: "snap-pa", state: "agency_submitted" }],
        "snap-pa",
      ).submitted,
    ).toBe(true);
    expect(
      recordedApplicationState(
        [{ id: "outcome", program_id: "snap-pa", state: "support_received" }],
        "snap-pa",
      ).submitted,
    ).toBe(false);
  });
  it("names the requested journey without assuming all food support is SNAP", () => {
    const request = fixture();
    expect(supportTitle(request)).toBe("Your SNAP application");
    request.intake.needs = ["food_now"];
    expect(supportTitle(request)).toBe("Food for your family");
    request.intake.needs = ["snap_new", "electricity"];
    expect(supportTitle(request)).toBe("Your family’s support");
  });
  it("keeps an earlier submission distinct from corrected current information", () => {
    expect(
      recordedApplicationState(
        [
          {
            id: "snap",
            program_id: "snap-pa",
            state: "agency_submitted",
            request_version: 1,
          },
        ],
        "snap-pa",
        2,
      ),
    ).toMatchObject({
      label: "An earlier application version was submitted",
      hasAttempt: true,
      submitted: true,
    });
  });
  it("does not assign a renewal receipt to a new SNAP application", () => {
    expect(
      recordedApplicationState(
        [
          {
            id: "renewal",
            program_id: "snap-pa",
            need: "snap_renewal",
            state: "agency_submitted",
            request_version: 1,
          },
        ],
        "snap-pa",
        1,
        "snap_new",
      ),
    ).toMatchObject({
      label: "No application submission recorded",
      submitted: false,
      hasAttempt: false,
    });
  });
  it.each(["research", "prepare"])(
    "does not treat an executing %s task as application delivery",
    (action) => {
      expect(
        recordedApplicationState(
          [
            {
              id: "preparation",
              program_id: "snap-pa",
              need: "snap_new",
              action,
              state: "executing",
            },
          ],
          "snap-pa",
          1,
          "snap_new",
        ),
      ).toMatchObject({ submitted: false, hasAttempt: false });
    },
  );
});

describe("application workspace", () => {
  it("keeps all work states reachable and retains unsaved input when navigating the checklist", async () => {
    mockApi();
    renderWorkspace();
    await screen.findByText("No application submission recorded");
    const checklist = screen.getByRole("navigation", {
      name: "Your application checklist",
    });
    expect(within(checklist).getAllByRole("link")).toHaveLength(6);
    const input = screen.getByRole("textbox", { name: "Unsaved answer" });
    fireEvent.change(input, { target: { value: "Not saved yet" } });
    fireEvent.click(
      within(checklist).getByRole("link", { name: /Your documents/ }),
    );
    expect(document.activeElement?.id).toBe("application-documents");
    expect(
      within(checklist)
        .getByRole("link", { name: /Your documents/ })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect((input as HTMLInputElement).value).toBe("Not saved yet");
    expect(screen.getByText("Permission controls")).toBeTruthy();
  });
  it("does not invent a live website or filling work when no provider session exists", async () => {
    mockApi();
    renderWorkspace();
    await screen.findByText("The provider connection is not operational.");
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open application view" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Start a new SNAP application with DHS",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/opening it does not file/)).toBeTruthy();
  });
  it("does not infer absence of a submission from a truncated operation history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("/operations")
            ? {
                ok: true,
                operations: Array.from({ length: 100 }, (_, index) => ({
                  id: `prepared-${index}`,
                  program_id: "snap-pa",
                  need: "snap_new",
                  request_version: 1,
                  state: "prepared",
                })),
                historyLimited: true,
              }
            : { ok: true, available: true, reason: null, session: null },
      })),
    );
    renderWorkspace();
    expect(
      await screen.findByText("Earlier application history needs checking"),
    ).toBeTruthy();
    expect(screen.queryByText("No application submission recorded")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open application view" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", {
        name: "Start a new SNAP application with DHS",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open the official SNAP service" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /earlier submission or uncertain delivery may be outside this view/,
      ),
    ).toBeTruthy();
  });
  it.each([
    [
      "assistance_approved",
      "Next: Program follow-up",
      /Actual receipt of support is a separate step/,
    ],
    [
      "support_received",
      "Outcome recorded: Support received",
      /Your receipt and any remaining support steps/,
    ],
    [
      "declined",
      "Next: Decision & follow-up",
      /decision and Program progress for any recorded appeal or alternative/,
    ],
  ])(
    "shows recorded %s follow-up instead of a new application prompt",
    async (state, next, detail) => {
      mockApi({ available: true, reason: null, session: null }, [
        {
          id: "outcome",
          program_id: "snap-pa",
          need: "snap_new",
          request_version: 1,
          state,
        },
      ]);
      renderWorkspace();
      expect(await screen.findByText(next)).toBeTruthy();
      expect(screen.getByText(detail)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Open application view" }),
      ).toBeNull();
      expect(
        screen.queryByRole("link", {
          name: "Start a new SNAP application with DHS",
        }),
      ).toBeNull();
    },
  );
  it("starts only the actual available SNAP connection and refreshes recorded state", async () => {
    const fetch = mockApi({ available: true, reason: null, session: null });
    renderWorkspace();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open application view" }),
    );
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
        true,
      ),
    );
    const call = fetch.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(call[0]).toBe(`/api/parent/requests/${requestId}/browser`);
    expect(JSON.parse(String(call[1]?.body))).toEqual({ programId: "snap-pa" });
  });
  it("does not offer new browser work on a paused request", async () => {
    mockApi({ available: true, reason: null, session: null });
    const request = fixture();
    request.status = "paused";
    renderWorkspace(request);
    await screen.findByText("No application submission recorded");
    expect(
      screen.queryByRole("button", { name: "Open application view" }),
    ).toBeNull();
    expect(screen.getByText("Work is paused or finished")).toBeTruthy();
  });
  it("closes the actual browser session and can reopen the public application view", async () => {
    let status = "blocked";
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "DELETE") status = "closed";
      if (options?.method === "POST") status = "starting";
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith("/operations")
            ? { ok: true, operations: [], historyLimited: false }
            : {
                ok: true,
                available: true,
                reason: null,
                session: {
                  id: "session-1",
                  programId: "snap-pa",
                  status,
                  currentUrl: null,
                  title: "COMPASS",
                  summary:
                    status === "closed"
                      ? "Website viewer stopped. No application was submitted."
                      : "Public application readiness only.",
                  updatedAt: "2026-10-26T12:00:00Z",
                  canControl: false,
                  frameUrl: null,
                },
              },
      };
    });
    vi.stubGlobal("fetch", fetch);
    renderWorkspace();
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop website view" }),
    );
    expect(
      await screen.findByText(
        "Website viewer stopped. Your support request and its permission have not changed.",
      ),
    ).toBeTruthy();
    const close = fetch.mock.calls.find(
      (call) => call[1]?.method === "DELETE",
    )!;
    expect(close[0]).toBe(`/api/parent/requests/${requestId}/browser`);
    expect(close[1]?.body).toBeUndefined();
    fireEvent.click(
      await screen.findByRole("button", { name: "Reopen application view" }),
    );
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
        true,
      ),
    );
    const reopen = fetch.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(String(reopen[1]?.body))).toEqual({
      programId: "snap-pa",
    });
    expect(
      screen.getByText(
        /does not fill personal fields or submit an application/,
      ),
    ).toBeTruthy();
  });
  it("does not offer a duplicate application while agency delivery is unconfirmed", async () => {
    mockApi({ available: true, reason: null, session: null }, [
      {
        id: "delivery",
        program_id: "snap-pa",
        need: "snap_new",
        state: "sent",
        request_version: 1,
      },
    ]);
    renderWorkspace();
    await screen.findByText("Agency submission not confirmed");
    expect(
      screen.queryByRole("button", { name: "Open application view" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: "Start a new SNAP application with DHS",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open the official SNAP service" }),
    ).toBeTruthy();
  });
  it("keeps a new SNAP readiness view available when a different SNAP journey has a receipt", async () => {
    mockApi({ available: true, reason: null, session: null }, [
      {
        id: "renewal",
        program_id: "snap-pa",
        need: "snap_renewal",
        state: "agency_submitted",
        request_version: 1,
      },
    ]);
    const request = fixture();
    request.intake.needs = ["snap_new", "snap_renewal"];
    renderWorkspace(request);
    await screen.findByText("No application submission recorded");
    expect(
      screen.getByRole("button", { name: "Open application view" }),
    ).toBeTruthy();
    expect(screen.queryByText("Application submission recorded")).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: "Start a new SNAP application with DHS",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open the official SNAP service" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/A separate SNAP journey also has recorded activity/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Review Activity & receipts" })
        .getAttribute("href"),
    ).toBe("#application-receipts");
  });
  it.each([
    "https://untrusted.example/screenshot.jpg",
    `/api/parent/requests/not-this-request/browser/frame`,
    "javascript:alert(1)",
    "/unrelated-private-route",
  ])(
    "rejects a browser frame outside this owned request: %s",
    async (frameUrl) => {
      mockApi({
        available: true,
        reason: null,
        session: {
          id: "session-1",
          programId: "snap-pa",
          status: "blocked",
          currentUrl: "https://www.compass.dhs.pa.gov/intake/#/getstarted",
          title: "COMPASS",
          summary: "Provider verification required.",
          updatedAt: "2026-10-26T12:00:00Z",
          canControl: false,
          frameUrl,
        },
      });
      renderWorkspace();
      await screen.findByText("Provider verification required.");
      expect(screen.queryByRole("img")).toBeNull();
    },
  );
  it("renders only the real same-request browser image and does not call a completed session a submission", async () => {
    mockApi({
      available: true,
      reason: null,
      session: {
        id: "session-1",
        programId: "snap-pa",
        status: "completed",
        currentUrl: "https://www.compass.dhs.pa.gov/intake/#/getstarted",
        title: "COMPASS",
        summary: "Browser work reached its recorded boundary.",
        updatedAt: "2026-10-26T12:00:00Z",
        canControl: false,
        frameUrl: `/api/parent/requests/${requestId}/browser/frame`,
      },
    });
    renderWorkspace();
    const image = await screen.findByRole("img", {
      name: /Current official application page/,
    });
    expect(image.getAttribute("src")).toContain(
      `/api/parent/requests/${requestId}/browser/frame?view=0`,
    );
    expect(screen.getByText("No application submission recorded")).toBeTruthy();
    fireEvent.error(image);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/browser image could not load/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Refresh application connection/ }),
    );
    expect(screen.getByRole("img").getAttribute("src")).toContain("view=1");
  });
  it("groups known parent steps while leaving service issues with CaseLink", async () => {
    mockApi({ available: false, reason: null, session: null }, [
      {
        id: "approved",
        program_id: "snap-pa",
        need: "snap_new",
        request_version: 1,
        state: "assistance_approved",
      },
    ]);
    const request = fixture();
    request.required_actions = [
      {
        id: "income",
        need: "snap_new",
        reason: "missing_fact",
        resolver: "parent",
        title: "Income needed",
        explanation: "A required fact.",
      },
      {
        id: "service",
        need: "snap_new",
        reason: "execution_issue",
        resolver: "operator",
        title: "Verify connection",
        explanation: "Service work.",
      },
    ];
    renderWorkspace(request);
    await screen.findByText("A program outcome is recorded");
    expect(await screen.findByText("Next: You")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Complete your step" })
        .getAttribute("href"),
    ).toBe("#your-next-steps");
    expect(screen.getByText(/One personal step needs/)).toBeTruthy();
  });
});
