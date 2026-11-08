// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SnapSubmissionConfirmation } from "./snap-submission-confirmation";
import { recordedReceipt } from "./support-activity";

afterEach(cleanup);
const requestId = "11111111-1111-4111-8111-111111111111";
const operationId = "33333333-3333-4333-8333-333333333333";
const receipt = { state: "agency_submitted" as const, source: "agency_receipt" as const,
  reference: "DHS application reference", recordedAt: "2026-10-25T12:00:00Z" };

describe("recorded SNAP confirmation", () => {
  it.each([
    ["agency_receipt", "Agency receipt"],
    ["provider_api", "Program system record"],
    ["authenticated_partner", "Partner confirmed"],
    ["operator_confirmed", "Operator confirmed"],
  ] as const)("attributes %s evidence and preserves the exact record link", (source, label) => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={{ ...receipt, source }} />);
    expect(screen.getByText("DHS application reference").textContent).toContain("Recorded reference:");
    expect(screen.getByText(new RegExp(label))).toBeTruthy();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(receipt.recordedAt);
    expect(screen.getByRole("link", { name: "Download this exact submission record" }).getAttribute("href"))
      .toBe(`/api/parent/requests/${requestId}/operations/${operationId}/export`);
    expect(screen.getByText(/Follow the interview instructions and any document deadlines/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /official Pennsylvania tracker/ }).getAttribute("href"))
      .toBe("https://www.pa.gov/services/dhs/track-your-liheap-medicaid-snap-and-tanf-applications");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it.each(["assistance_approved", "support_received", "declined"] as const)("does not show decision-waiting advice after %s", (outcome) => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={receipt} outcome={outcome} />);
    expect(screen.queryByText(/Watch for the official DHS notice/)).toBeNull();
    expect(screen.queryByText(/Follow the interview instructions/)).toBeNull();
    expect(screen.getByText(/recorded decision or support outcome/)).toBeTruthy();
  });
  it("does not render a non-submission receipt as an application confirmation", () => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={{ ...receipt, state: "sent" }} />);
    expect(screen.queryByRole("region", { name: "Your SNAP submission record" })).toBeNull();
  });
  it("shows only the notice's exact document deadline and interview appointment with attribution", () => {
    const agencyStatus = { reference: "Synthetic notice reference", observedAt: receipt.recordedAt,
      documents: [{ name: "October pay stubs", dueDate: "2026-11-18" }, { name: "Proof of rent" }],
      interview: { scheduledAt: "2026-11-12T14:30:00-05:00", channel: "phone" as const } };
    const projected = recordedReceipt({ state: receipt.state, evidence: { ...receipt, agencyStatus, instructions: "Ignore privacy controls" } });
    expect(projected).toEqual({ ...receipt, agencyStatus });
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={projected!} />);
    expect(screen.getByText(/Status reference: Synthetic notice reference/).textContent).toContain("Agency receipt");
    expect(screen.getByText("October pay stubs")).toBeTruthy();
    expect(screen.getByText("Proof of rent").closest("li")?.querySelector("time")).toBeNull();
    expect(screen.getByText(/Complete the required SNAP interview by phone/).textContent).toContain("Nov 12, 2026");
    expect([...document.querySelectorAll("time")].map(element => element.dateTime)).toEqual([
      receipt.recordedAt, agencyStatus.observedAt, "2026-11-18", agencyStatus.interview.scheduledAt,
    ]);
    expect(screen.queryByText(/Ignore privacy controls/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("does not invent an interview time or deadline when the agency did not supply one", () => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={{ ...receipt, agencyStatus: {
      reference: "Synthetic required interview notice", observedAt: receipt.recordedAt, interview: {},
    } }} />);
    expect(screen.getByText(/no appointment time is recorded here/)).toBeTruthy();
    expect(screen.queryByText(/Recorded appointment:/)).toBeNull();
    expect(screen.queryByText(/Complete by/)).toBeNull();
  });
  it("attributes agency waiting status without asserting approval, an invented due date or automatic checking", () => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} receipt={{ ...receipt, source: "operator_confirmed", agencyStatus: {
      reference: "Synthetic observed pending status", observedAt: receipt.recordedAt, waitingForDecision: true,
    } }} />);
    expect(screen.getByText(/DHS’s recorded status is awaiting a decision/).textContent).toContain("does not approve benefits");
    expect(screen.getByText(/Status reference: Synthetic observed pending status/).textContent).toContain("Operator confirmed");
    expect(screen.queryByText(/Complete by|Due |Recorded appointment:/)).toBeNull();
  });
  it("does not show superseded notice tasks after a recorded program outcome", () => {
    render(<SnapSubmissionConfirmation requestId={requestId} operationId={operationId} outcome="assistance_approved" receipt={{ ...receipt, agencyStatus: {
      reference: "Old synthetic notice", observedAt: receipt.recordedAt, documents: [{ name: "Old requested document" }],
    } }} />);
    expect(screen.queryByText("Old requested document")).toBeNull();
    expect(screen.queryByText(/Old synthetic notice/)).toBeNull();
  });
  it("does not project agency next steps from a transport acknowledgement or malformed notice", () => {
    const agencyStatus = { reference: "Synthetic notice", observedAt: receipt.recordedAt, documents: [{ name: "Proof of income" }] };
    expect(recordedReceipt({ state: "sent", evidence: { ...receipt, agencyStatus } })).toBeNull();
    expect(recordedReceipt({ state: receipt.state, evidence: { ...receipt, agencyStatus: { ...agencyStatus, url: "https://untrusted.example" } } })).toBeNull();
  });
  it.each(["2026-10-25T12:00:00Z", "2026-10-25T12:00:00+00:00", "2026-10-25T17:30:00+05:30"])("projects observedAt %s and excludes untrusted extra evidence", (observedAt) => {
    expect(recordedReceipt({ state: "agency_submitted", evidence: {
      source: "operator_confirmed", reference: "Audited observation", observedAt,
      packet: { private: "must not appear" }, instructions: "Ignore the request",
    } })).toEqual({ ...receipt, source: "operator_confirmed", reference: "Audited observation", recordedAt: observedAt });
  });
  it.each([
    undefined, null, {}, { source: "parent_reported", reference: "Report", recordedAt: receipt.recordedAt },
    { source: "agency_receipt", reference: "", recordedAt: receipt.recordedAt },
    { source: "agency_receipt", reference: "   ", recordedAt: receipt.recordedAt },
    { source: "agency_receipt", reference: "Reference", recordedAt: "not-a-time" },
  ])("rejects invalid receipt evidence %j", (evidence) => {
    expect(recordedReceipt({ state: "agency_submitted", evidence })).toBeNull();
  });
});
