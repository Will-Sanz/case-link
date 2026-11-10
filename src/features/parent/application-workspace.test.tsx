// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportRequest } from "@/lib/parent/domain";
import { initialIntake, buildMandate } from "./intake";
import { useParentResource } from "./use-parent-resource";
import { SupportActivity, type RecordedOperation } from "./support-activity";
import { fixtureProtectedSnapOperation } from "@/lib/parent/test-fixtures";
import type { SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import { COMPASS_CAPTCHA, COMPASS_FAMILY_SAFETY } from "@/lib/parent/browser-policy";
import {
  ApplicationWorkspace,
  recordedApplicationState,
  supportTitle,
} from "./application-workspace";

const requestId = "11111111-1111-4111-8111-111111111111";
const receiptEvidence = { source: "agency_receipt", reference: "SNAP receipt for this test", recordedAt: "2026-10-25T12:00:00Z" };
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
function WorkspaceFixture({ request, review, decision }: { request: SupportRequest; review?: SnapProtectedOperation | null; decision?: SnapProtectedOperation | null }) {
  const history = useParentResource<{
    operations: RecordedOperation[];
    historyLimited: boolean;
  }>(`/requests/${request.id}/operations`);
  return (
    <ApplicationWorkspace request={request} history={history} snapReview={review} snapSubmissionDecision={decision}>
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
const finalReviewAction = { id: "snap-final-review", need: "snap_new" as const, reason: "submission_review" as const, field: "snap_final_submit", resolver: "parent" as const, title: "Review the exact SNAP application", explanation: "Review before choosing Submit." };
describe("canonical application continuity", () => {
  it("places one current prepared draft directly after the overview and before all answer details", async () => {
    const request = fixture(), operation: RecordedOperation = { id: "draft", request_id: request.id, request_version: request.version, need: "snap_new", program_id: "snap-pa", action: "prepare", state: "prepared", artifact_id: "exact-form", form: { preparation_only: true }, created_at: request.created_at };
    mockApi(); const history = { data: { operations: [operation], historyLimited: false }, loading: false, error: null, reload: vi.fn() };
    render(<ApplicationWorkspace request={request} history={history}><section id="application-receipts"><SupportActivity request={request} history={history} onChange={vi.fn()}/></section></ApplicationWorkspace>);
    const overview = screen.getByRole("heading", { name: "Where your application stands" });
    openSection(/Your application/);
    const draft = screen.getByRole("region", { name: "Your prepared SNAP draft" }), answers = screen.getByRole("heading", { name: "Your SNAP application answers" });
    expect(overview.compareDocumentPosition(draft) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(draft.compareDocumentPosition(answers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "View prepared draft" })).toHaveLength(1);
    openSection(/Activity & receipts/);
    expect(screen.getByRole("link", { name: "Download incomplete unsigned draft" }).getAttribute("href")).toBe(`/api/parent/requests/${request.id}/forms/exact-form`);
    openSection(/Official website/);
    await screen.findByRole("link", { name: "Start a new SNAP application with DHS" });
  });
  it("opens exact review before the answer recap and suppresses a duplicate COMPASS start", async () => {
    const request = fixture(); request.required_actions = [finalReviewAction];
    mockApi({ available: true, reason: null, session: null }, [{ id: "canonical", request_id: request.id, program_id: "snap-pa", need: "snap_new", action: "submit", request_version: request.version, state: "prepared", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket },
      { id: "earlier-draft", request_id: request.id, program_id: "snap-pa", need: "snap_new", action: "prepare", request_version: request.version, state: "prepared", artifact_id: "unsigned-form", form: { preparation_only: true } }]);
    renderWorkspace(request); await screen.findByText("SNAP application prepared");
    expect(screen.getByRole("link", { name: "Review application and Submit" }).getAttribute("href")).toBe("#snap-final-review");
    fireEvent.click(screen.getByRole("link", { name: "Review application and Submit" }));
    const review = screen.getByRole("heading", { name: "Review your SNAP application" }), answers = screen.getByRole("heading", { name: "Your SNAP application answers" });
    expect(review.compareDocumentPosition(answers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open application view" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Start a new SNAP application with DHS" })).toBeNull();
    openSection(/Official website/);
    expect(screen.getByRole("link", { name: "Open the official SNAP service" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View prepared draft" })).toBeNull();
  });
  it.each([undefined, { snapSubmissionAuthorized: false }, { requestVersion: 2 }, { requestId: "33333333-3333-4333-8333-333333333333" }])("keeps review requested without a matching confirmed decision: %j", async change => {
    const request = fixture(); request.required_actions = [finalReviewAction]; mockApi();
    const review = change ? fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: true, ...change }) : undefined;
    render(<WorkspaceFixture request={request} review={review}/>); await screen.findByText("Next: You");
    expect(screen.getByRole("link", { name: "Review application and Submit" }).getAttribute("href")).toBe("#snap-final-review");
  });
  it("gives a matching recorded Submit to CaseLink without inventing an agency receipt", async () => {
    const request = fixture(); request.required_actions = [finalReviewAction]; mockApi();
    render(<WorkspaceFixture request={request} review={fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: true })}/>);
    await screen.findByText("Next: CaseLink"); expect(screen.getByText("Submit decision recorded")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review application and Submit" })).toBeNull();
    expect(screen.queryByText("SNAP application complete")).toBeNull();
  });
  it("preserves another necessary personal step after the exact Submit is recorded", async () => {
    const request = fixture(); request.required_actions = [finalReviewAction, { id: "interview", need: "snap_new", reason: "personal_step", resolver: "parent", title: "Complete the scheduled interview", explanation: "An independently required personal step." }]; mockApi();
    render(<WorkspaceFixture request={request} review={fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: true })}/>);
    await screen.findByText("Next: You"); expect(screen.getByText(/One personal step needs/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Complete your step" }).getAttribute("href")).toBe("#your-next-steps");
  });
  it("retains an exact recorded decision during refresh without hiding a newer delivery state or another version", async () => {
    const request = fixture(); request.required_actions = [finalReviewAction]; mockApi();
    const decision = fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: true });
    const view = render(<WorkspaceFixture request={request} decision={decision}/>); await screen.findByText("Next: CaseLink");
    view.rerender(<WorkspaceFixture request={request} decision={decision} review={{ ...decision, state: "delivery_unknown", snapSubmissionAuthorized: false }}/>);
    expect(screen.getByText(/must confirm its result before any retry/)).toBeTruthy();
    view.rerender(<WorkspaceFixture request={{ ...request, version: request.version + 1 }} decision={decision}/>);
    await screen.findByText("Next: You"); expect(screen.getByRole("link", { name: "Review application and Submit" })).toBeTruthy();
  });
  it.each(["executing", "delivery_unknown", "sent"] as const)("keeps a fresh tab's exact %s attempt with CaseLink even when the prepared-only Submit flag is false", async state => {
    const request = fixture(); request.required_actions = [finalReviewAction];
    const canonical = fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: false });
    const review = { ...canonical, state };
    mockApi(undefined, [{ id: canonical.operationId, request_id: request.id, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state, artifact_id: null, protected_packet: canonical.packet.protectedSnapPacket }]);
    render(<WorkspaceFixture request={request} review={review}/>); await screen.findByText("Next: CaseLink");
    expect(screen.queryByRole("link", { name: "Review application and Submit" })).toBeNull();
    expect(screen.queryByText("SNAP application complete")).toBeNull();
    expect(screen.getByText(/must confirm its result before any retry/)).toBeTruthy();
  });
  it.each([{ request_id: "33333333-3333-4333-8333-333333333333" }, { request_version: 0 }, { need: "snap_renewal" }, { action: "follow_up" }, { protected_packet: { raw: "PRIVATE-CANARY" } }, { state: "prepared" }])("does not retire review from unrelated, stale or unattempted metadata: %j", async change => {
    const request = fixture(); request.required_actions = [finalReviewAction];
    mockApi(undefined, [{ id: "attempt", request_id: request.id, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state: "delivery_unknown", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket, ...change }]);
    renderWorkspace(request); await screen.findByText("Next: You");
    expect(screen.getByRole("link", { name: "Review application and Submit" })).toBeTruthy();
  });
});
beforeEach(() => window.history.replaceState(null, "", "/"));
function openSection(name: RegExp) {
  fireEvent.click(within(screen.getByRole("navigation", { name: "Your application checklist" })).getByRole("link", { name }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["challenge", "continue"] as const)("shows only an actual %s handoff as the primary family step", async (kind) => {
  mockApi({
    available: true,
    reason: null,
    session: {
      id: "e1671f04-783d-469e-ad76-a426c2a2d832",
      programId: "snap-pa",
      status: "needs_parent",
      currentUrl: kind === "challenge" ? COMPASS_CAPTCHA : COMPASS_FAMILY_SAFETY,
      title: "Pennsylvania COMPASS",
      summary: "Public connection check.",
      updatedAt: new Date().toISOString(),
      canControl: true,
      frameUrl: `/api/parent/requests/${requestId}/browser/frame?frameId=13175423-0b23-4292-a9f9-9071c9903178`,
      handoff: {
        kind,
        frameId: "13175423-0b23-4292-a9f9-9071c9903178",
        width: 1100,
        height: 720,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    },
  });
  const view = renderWorkspace();
  openSection(/Official website/);
  const image = await screen.findByRole("img");
  fireEvent.load(image);
  if (kind === "challenge") {
    await screen.findByText("Next: You — COMPASS verification");
    expect(screen.getByRole("link", { name: /Official website\s*Needs you now/ }).getAttribute("href")).toBe("#application-browser");
    expect(screen.queryByText("Nothing requested")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check and continue" })).toBeNull();
    fireEvent.error(image);
    await waitFor(() => expect(screen.queryByText("Next: You — COMPASS verification")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Refresh application connection" }));
    const refreshed = await screen.findByRole("img");
    fireEvent.load(refreshed);
    await screen.findByText("Next: You — COMPASS verification");
  } else {
    expect(screen.queryByText("Next: You — COMPASS verification")).toBeNull();
  }
  mockApi();
  view.rerender(<WorkspaceFixture request={{ ...fixture(), id: "33333333-3333-4333-8333-333333333333" }} />);
  await screen.findByText("The provider connection is not operational.");
  expect(screen.queryByText("Next: You — COMPASS verification")).toBeNull();
});

describe("actual application evidence", () => {
  it("distinguishes a current canonical application from plans, stale metadata and other journeys", () => {
    const operation = { id: "canonical", program_id: "snap-pa", need: "snap_new" as const, action: "submit", request_version: 1, state: "prepared", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket };
    expect(recordedApplicationState([operation], "snap-pa", 1, "snap_new")).toMatchObject({ label: "SNAP application prepared", submitted: false, hasAttempt: false });
    for (const change of [{ request_version: 0 }, { need: "snap_renewal" as const }, { action: "follow_up" }, { protected_packet: { raw: "PRIVATE-CANARY" } }])
      expect(recordedApplicationState([{ ...operation, ...change }], "snap-pa", 1, "snap_new").label).not.toBe("SNAP application prepared");
  });
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
        [{ id: "snap", program_id: "snap-pa", state: "agency_submitted", evidence: receiptEvidence }],
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
            evidence: receiptEvidence,
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
  it("names an incomplete unsigned draft without calling it an application or submission", async () => {
    mockApi(undefined, [{
      id: "snap-draft", program_id: "snap-pa", need: "snap_new",
      request_version: 1, state: "prepared", action: "prepare",
      artifact_id: "draft-artifact", form: { preparation_only: true },
    }]);
    renderWorkspace();
    await screen.findByText("An incomplete unsigned draft is saved. It is not a complete application and has not been submitted.");
    expect(screen.queryByText("SNAP application complete")).toBeNull();
    expect(screen.queryByRole("link", { name: "View application receipt" })).toBeNull();
  });
  it("does not call an ordinary prepared form incomplete because an earlier draft exists", async () => {
    mockApi(undefined, [
      { id: "form", program_id: "snap-pa", need: "snap_new", state: "prepared", artifact_id: "complete-form", form: { preparation_only: false } },
      { id: "draft", program_id: "snap-pa", need: "snap_new", state: "prepared", artifact_id: "draft-form", form: { preparation_only: true } },
    ]);
    renderWorkspace();
    await screen.findByText("A prepared form is saved. Preparation is separate from sending an application.");
    expect(screen.queryByText(/An incomplete unsigned draft is saved/)).toBeNull();
  });
  it("shows completion only for the current exact SNAP submission and opens its receipt section", async () => {
    mockApi(undefined, [{
      id: "snap-submitted", program_id: "snap-pa", need: "snap_new",
      request_version: 1, state: "agency_submitted", action: "submit",
      evidence: receiptEvidence,
    }]);
    renderWorkspace();
    await screen.findByText("SNAP application complete");
    expect(screen.getByText(/Submission confirmed · benefits decision pending/)).toBeTruthy();
    const receipt = screen.getByRole("link", { name: "View application receipt" });
    expect(receipt.getAttribute("href")).toBe("#application-receipts");
    fireEvent.click(receipt);
    expect(document.activeElement?.id).toBe("application-receipts");
    expect(screen.getByRole("link", { name: /Activity & receipts/ }).getAttribute("aria-current")).toBe("location");
  });
  it.each([
    { program_id: "snap-pa", need: "snap_new", request_version: 1, state: "prepared" },
    { program_id: "snap-pa", need: "snap_new", request_version: 1, state: "sent" },
    { program_id: "snap-pa", need: "snap_renewal", request_version: 1, state: "agency_submitted" },
    { program_id: "peco-cap", need: "electricity", request_version: 1, state: "agency_submitted" },
    { program_id: "snap-pa", need: "snap_new", request_version: 0, state: "agency_submitted" },
    { program_id: "snap-pa", need: "snap_new", state: "agency_submitted" },
  ])("does not label mismatched or unconfirmed evidence as current SNAP completion: %j", async (operation) => {
    mockApi(undefined, [{ id: "other-operation", evidence: receiptEvidence, ...operation }]);
    renderWorkspace();
    await screen.findByRole("navigation", { name: "Your application checklist" });
    await waitFor(() => expect(screen.queryByText("Checking application records…")).toBeNull());
    expect(screen.queryByText("SNAP application complete")).toBeNull();
    expect(screen.queryByRole("link", { name: "View application receipt" })).toBeNull();
  });
  it.each(["assistance_approved", "support_received", "declined"])("does not call a recorded %s decision pending after submission", async (state) => {
    mockApi(undefined, [
      { id: "outcome", program_id: "snap-pa", need: "snap_new", request_version: 1, state, evidence: receiptEvidence },
      { id: "snap-submitted", program_id: "snap-pa", need: "snap_new", request_version: 1, state: "agency_submitted", evidence: receiptEvidence },
    ]);
    renderWorkspace();
    await screen.findByText("SNAP application complete");
    expect(screen.queryByText(/benefits decision pending/)).toBeNull();
    expect(screen.queryByText(/Watch for the official DHS notice/)).toBeNull();
    expect(screen.getByText(/recorded decision or support outcome/)).toBeTruthy();
  });
  it("keeps an older decision separate from the current version’s submission", async () => {
    mockApi(undefined, [
      { id: "old-approved", program_id: "snap-pa", need: "snap_new", request_version: 0, state: "assistance_approved", evidence: receiptEvidence },
      { id: "submitted", program_id: "snap-pa", need: "snap_new", request_version: 1, state: "agency_submitted", evidence: receiptEvidence },
    ]);
    renderWorkspace();
    await screen.findByText("SNAP application complete");
    expect(screen.getByText(/Submission confirmed · benefits decision pending/)).toBeTruthy();
  });
  it("uses evidence time when an older-created operation receives the latest decision", async () => {
    mockApi(undefined, [
      { id: "newer-operation", created_at: "2026-11-02T12:00:00Z", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "agency_submitted", evidence: { ...receiptEvidence, recordedAt: "2026-11-02T12:00:00Z" } },
      { id: "older-operation", created_at: "2026-10-25T12:00:00Z", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "assistance_approved", evidence: { source: "authenticated_partner", reference: "Later decision", observedAt: "2026-11-03T17:30:00+05:30" } },
    ]);
    renderWorkspace();
    await screen.findByText("SNAP application complete");
    expect(screen.getByText("Next: Program follow-up")).toBeTruthy();
    expect(screen.queryByText(/benefits decision pending/)).toBeNull();
  });
  it("shows the latest valid notice by evidence time, regardless of operation response order", async () => {
    mockApi(undefined, [
      { id: "old-status", created_at: "2026-11-02T12:00:00Z", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "agency_submitted", evidence: { ...receiptEvidence, recordedAt: "2026-11-02T12:00:00Z", agencyStatus: {
          reference: "Old synthetic status", observedAt: "2026-11-02T12:00:00Z", documents: [{ name: "Old requested document" }],
        } } },
      { id: "latest-status", created_at: "2026-10-25T12:00:00Z", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "agency_submitted", evidence: { ...receiptEvidence, reference: "Latest synthetic receipt", recordedAt: "2026-11-03T17:30:00+05:30", agencyStatus: {
          reference: "Latest synthetic notice", observedAt: "2026-11-03T12:00:00Z", interview: { channel: "phone" },
        } } },
    ]);
    renderWorkspace();
    await screen.findByText("SNAP application complete");
    expect(screen.getByText(/Status reference: Latest synthetic notice/)).toBeTruthy();
    expect(screen.getByText(/Complete the required SNAP interview by phone/)).toBeTruthy();
    expect(screen.queryByText("Old requested document")).toBeNull();
    expect(screen.getByRole("link", { name: "Download this exact submission record" }).getAttribute("href"))
      .toBe(`/api/parent/requests/${requestId}/operations/latest-status/export`);
  });
  it.each([false, true])("does not let a late-imported older notice replace a newer observed status or decision (decision=%s)", async decision => {
    mockApi(undefined, [
      { id: "late-import", program_id: "snap-pa", need: "snap_new", request_version: 1, state: "agency_submitted",
        evidence: { ...receiptEvidence, recordedAt: "2026-11-03T12:00:00Z", agencyStatus: {
          reference: "Late import of an older notice", observedAt: "2026-11-03T10:00:00Z", documents: [{ name: "Superseded requested document" }],
        } } },
      { id: "newer-observation", program_id: "snap-pa", need: "snap_new", request_version: 1, state: decision ? "assistance_approved" : "agency_submitted",
        evidence: { ...receiptEvidence, reference: "Newer recorded observation", recordedAt: "2026-11-03T11:01:00Z", agencyStatus: {
          reference: "Newer observed notice", observedAt: "2026-11-03T11:00:00Z", interview: { channel: "phone" },
        } } },
    ]);
    renderWorkspace(); await screen.findByText("SNAP application complete");
    expect(screen.queryByText("Superseded requested document")).toBeNull();
    if (decision) {
      expect(screen.queryByText(/benefits decision pending/)).toBeNull();
      expect(screen.getByText(/recorded decision or support outcome/)).toBeTruthy();
    } else {
      expect(screen.getByText(/Status reference: Newer observed notice/)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Download this exact submission record" }).getAttribute("href"))
        .toBe(`/api/parent/requests/${requestId}/operations/newer-observation/export`);
    }
  });
  it("does not infer a pending decision when earlier history is outside the response", () => {
    mockApi();
    render(<ApplicationWorkspace request={fixture()} history={{
      data: { operations: [{ id: "submitted", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "agency_submitted", evidence: receiptEvidence, created_at: fixture().created_at }], historyLimited: true },
      loading: false, error: null, reload: vi.fn(),
    }}>Saved work</ApplicationWorkspace>);
    expect(screen.getByText("SNAP application complete")).toBeTruthy();
    expect(screen.queryByText(/benefits decision pending/)).toBeNull();
  });
  it.each(["sent", "partner_received", "partner_accepted", "agency_submitted", "assistance_approved", "support_received", "declined"])("keeps %s without receipt evidence unconfirmed and prevents a fresh application", async (state) => {
    mockApi({ available: true, reason: null, session: null }, [{
      id: "unverified", program_id: "snap-pa", need: "snap_new", request_version: 1, state,
    }]);
    renderWorkspace();
    await screen.findByText("Agency submission not confirmed");
    expect(screen.queryByText("SNAP application complete")).toBeNull();
    expect(screen.queryByRole("region", { name: "Your SNAP submission record" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open application view" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Start a new SNAP application with DHS" })).toBeNull();
    expect(screen.queryByText("No application submission recorded")).toBeNull();
  });
  it.each(["loading", "error"])("hides retained confirmation data while history is %s", (state) => {
    mockApi();
    render(<ApplicationWorkspace request={fixture()} history={{
      data: { operations: [{ id: "submitted", program_id: "snap-pa", need: "snap_new", request_version: 1,
        state: "agency_submitted", evidence: receiptEvidence, created_at: fixture().created_at }], historyLimited: false },
      loading: state === "loading", error: state === "error" ? new Error("Unavailable") : null, reload: vi.fn(),
    }}>Saved work</ApplicationWorkspace>);
    expect(screen.queryByRole("region", { name: "Your SNAP submission record" })).toBeNull();
    expect(screen.queryByText("SNAP application complete")).toBeNull();
  });
  it("keeps all work states reachable and retains unsaved input when navigating the checklist", async () => {
    mockApi();
    renderWorkspace();
    await screen.findByText("No application submission recorded");
    const checklist = screen.getByRole("navigation", {
      name: "Your application checklist",
    });
    expect(within(checklist).getAllByRole("link")).toHaveLength(12);
    openSection(/Your next steps/);
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
    expect(screen.queryByRole("textbox", { name: "Unsaved answer" })).toBeNull();
    expect(screen.getByText("Permission controls").closest("[data-workspace-panel]")?.hasAttribute("hidden")).toBe(true);
    openSection(/Your next steps/);
    expect(screen.getByRole("textbox", { name: "Unsaved answer" })).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Not saved yet");
  });
  it("opens a bookmarked section and follows browser history without losing the workspace", async () => {
    mockApi();
    window.history.replaceState(null, "", "/#application-documents");
    renderWorkspace();
    expect(screen.getByText("Document controls").closest("[data-workspace-panel]")?.hasAttribute("hidden")).toBe(false);
    expect(screen.queryByRole("heading", { name: "Where your application stands" })).toBeNull();
    openSection(/Your next steps/);
    expect(screen.getByRole("textbox", { name: "Unsaved answer" })).toBeTruthy();
    window.history.replaceState(null, "", "/");
    fireEvent.popState(window);
    expect(screen.getByRole("heading", { name: "Where your application stands" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Unsaved answer" })).toBeNull();
    await screen.findByText("No application submission recorded");
  });
  it("does not invent a live website or filling work when no provider session exists", async () => {
    mockApi();
    renderWorkspace();
    openSection(/Official website/);
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
    openSection(/Official website/);
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
          evidence: receiptEvidence,
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
    openSection(/Official website/);
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
    openSection(/Official website/);
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
        /no personal information is entered and no application is submitted/,
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
    openSection(/Official website/);
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
    openSection(/Official website/);
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
    openSection(/Overview/);
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
    openSection(/Official website/);
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
        evidence: receiptEvidence,
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
