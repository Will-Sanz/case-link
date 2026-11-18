// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { PgwSavedApplication } from "./pgw-saved-application";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
import { PGW_APPLICATION_SOURCE, pgwApplicationLeaves } from "@/lib/parent/pgw-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/pgw-application-fields";
const now = new Date("2026-11-13T22:00:00Z"), snapshotId = "22222222-2222-4222-8222-222222222222";
const childId = "33333333-3333-4333-8333-333333333333", actorId = "44444444-4444-4444-8444-444444444444";
const customerId = "55555555-5555-4555-8555-555555555555";
const savedDetails = { journey: "unknown", currentCrpState: "unknown", accountNumber: "1234567890", customer: { id: customerId, firstName: "SavedCanary", lastName: "Example" }, address: { zip: "19147" }, householdMembers: [{ id: childId, firstName: "ChildCanary" }] };
function snapshot() {
  return { id: snapshotId, request_id: fixtureRequest().id, revision: 1, base_version: 1, request_version: 2, details: savedDetails,
    provenance: Object.fromEntries(Object.keys(pgwApplicationLeaves(savedDetails)).map(path => [path, { source: "parent", confirmedAt: "2026-11-13T21:58:00Z", asOf: "2026-11-13" }])),
    source: PGW_APPLICATION_SOURCE, notice_version: PGW_APPLICATION_NOTICE_VERSION, created_at: "2026-11-13T21:58:00Z", idempotency_key: childId,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: PGW_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: PGW_ACCOUNT_AUTHORITY_STATEMENT, accountAuthority: "self", actorId, noticeVersion: PGW_APPLICATION_NOTICE_VERSION,
      declaredAt: "2026-11-13T21:58:00Z", revision: 1, detailsSha256: "a".repeat(64), accountNumberSha256: "b".repeat(64), subjects: [`customer.${customerId}`, `householdMembers.${childId}`] } };
}
const support = (status: "active" | "paused" = "active") => fixtureRequest({ version: 2, status, intake: fixtureIntake({ needs: ["gas"], zip: "19104", householdSize: null, utilityProviders: ["pgw"], incomeAmount: null, incomeFrequency: "unknown", accountAuthority: "self" }),
  mandate: fixtureMandate({ recipientIds: ["pgw-crp"], mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: "2026-11-16T20:00:00Z" }) });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let enabled = true;
let gateExpiry = "2026-11-14T20:00:00Z";
function api(post: (init: RequestInit) => unknown = () => response({ snapshotId }), missing = false, record: unknown = snapshot()) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return response({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-16T20:00:00Z",
      pgwApplication: { collectionEnabled: enabled, noticeVersion: enabled ? PGW_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? gateExpiry : null } } });
    if (init?.method === "POST") return post(init);
    return missing ? response({ ok: false, error: "This saved application is unavailable." }, 404) : response({ snapshot: record });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function edit() { fireEvent.click(await screen.findByRole("button", { name: "Correct PGW answers" })); await screen.findByLabelText("Customer first name"); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); enabled = true; gateExpiry = "2026-11-14T20:00:00Z"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owned PGW saved answers", () => {
  it("automatically confirms its exact interrupted save when the owned latest snapshot arrives", async () => {
    const record = snapshot(), fetcher = api(() => new Promise(() => {}), false, record);
    const request = support(), view = render(<PgwSavedApplication request={request}/>); await edit();
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "CommittedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const init = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!, body = JSON.parse(String(init.body));
    Object.assign(record, { id: crypto.randomUUID(), revision: 2, base_version: 2, request_version: 3, details: body.details,
      idempotency_key: (init.headers as Record<string, string>)["Idempotency-Key"], consent_evidence: { ...record.consent_evidence, revision: 2 } });
    view.rerender(<PgwSavedApplication request={{ ...request, version: 3 }}/>);
    await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    expect(screen.queryByRole("button", { name: "Load latest saved PGW answers" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each([false, true])("reuses paused saved answers without another checkbox with document scope %s", async documentScope => {
    const request = support("paused");
    if (documentScope) request.mandate.allowedData.push("documents");
    const fetcher = api(), changed = vi.fn(); render(<PgwSavedApplication request={request} onChange={changed}/>); await edit();
    expect((screen.getByLabelText("Customer first name") as HTMLInputElement).value).toBe("SavedCanary");
    expect((screen.getByLabelText("PGW service ZIP code") as HTMLInputElement).value).toBe("19147");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "UpdatedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await screen.findByText(/Your PGW CRP answers are saved. Your request stays paused/);
    expect(changed).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ expectedVersion: 2, subjectAuthorityDeclared: true, noticeVersion: PGW_APPLICATION_NOTICE_VERSION,
      accountAuthorityDeclared: true, details: { customer: { id: customerId, firstName: "UpdatedCanary" }, accountNumber: "1234567890", address: { zip: "19147" }, householdMembers: [{ id: childId, firstName: "ChildCanary" }] } });
  });
  it("keeps history readable but exposes no private controls with a closed PGW purpose", async () => {
    enabled = false; api(); render(<PgwSavedApplication request={support()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.getByText("SavedCanary")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Correct PGW answers" })).toBeNull();
  });
  it("reads the applicable outside support, no-income and assistance amounts privately without claiming signatures or PGW status", async () => {
    const supporter = crypto.randomUUID(), details = { ...savedDetails, customer: { ...savedDetails.customer, under18: false, income: { state: "none", sources: [], noIncomeSituation: "Between jobs" } },
      outsideSupport: { receives: true, supporter: { id: supporter, firstName: "SupporterCanary", monthlyAmountCents: 1234 } }, snap: { receives: true, monthlyAmountCents: 29 }, housingSubsidy: { receives: false } };
    const record = { ...snapshot(), details, provenance: Object.fromEntries(Object.keys(pgwApplicationLeaves(details)).map(path => [path, { source: "parent", confirmedAt: "2026-11-13T21:58:00Z", asOf: "2026-11-13" }])),
      consent_evidence: { ...snapshot().consent_evidence, subjects: [...snapshot().consent_evidence.subjects, `outsideSupport.supporter.${supporter}`] } };
    enabled = false; api(undefined, false, record); render(<PgwSavedApplication request={support()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.getByText(/Brief no-income situation: Between jobs/)).toBeTruthy();
    expect(screen.getByText(/Monthly support: \$12.34/)).toBeTruthy(); expect(screen.getByText(/Receives SNAP: Yes. Monthly amount: \$0.29/)).toBeTruthy();
    expect(screen.getByText(/not a PGW status check/)).toBeTruthy(); expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("keeps an invalid money answer on the page and saves only its exact corrected cents", async () => {
    const fetcher = api(); render(<PgwSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Does the household receive SNAP?"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("SNAP monthly amount"), { target: { value: "12.345" } });
    fireEvent.submit(screen.getByRole("form", { name: "Correct PGW application answers" }));
    await screen.findByText(/Check the PGW account, names, dates, contact details/);
    expect((screen.getByLabelText("SNAP monthly amount") as HTMLInputElement).value).toBe("12.345");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("SNAP monthly amount"), { target: { value: "0.29" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).details.snap).toEqual({ receives: true, monthlyAmountCents: 29 });
  });
  it("saves every word of a naturally multiline explanation through the strict private write", async () => {
    const fetcher = api(); render(<PgwSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Is the customer of record under 18?"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("Customer income sources"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("Customer brief no-income situation"), { target: { value: "Between jobs.\nUsing savings." } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).details.customer.income.noIncomeSituation).toBe("Between jobs. Using savings.");
  });
  it.each([
    ["generic gas with no named CRP recipient", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, recipientIds: [] } })],
    ["multiple needs", (request: ReturnType<typeof support>) => ({ ...request, intake: { ...request.intake, needs: ["gas", "water"] as ReturnType<typeof support>["intake"]["needs"] } })],
    ["unresolved account authority", (request: ReturnType<typeof support>) => ({ ...request, intake: { ...request.intake, accountAuthority: "not_sure" as const } })],
    ["full execution mandate", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, mode: "full" as const } })],
    ["missing utility data permission", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, allowedData: ["household", "income"] as ReturnType<typeof support>["mandate"]["allowedData"] } })],
  ])("does not expose private CRP editing for %s", async (_name, change) => {
    api(); render(<PgwSavedApplication request={change(support())}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.queryByRole("button", { name: "Correct PGW answers" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("can save an explicitly partial empty history after the full notice", async () => {
    const fetcher = api(undefined, true); render(<PgwSavedApplication request={support()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Add private PGW answers" }));
    await screen.findByRole("region", { name: "PGW private information notice" });
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "PartialCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).details).toMatchObject({ customer: { id: expect.any(String), firstName: "PartialCanary" } });
  });
  it("retries an unknown save with identical bytes/key even after a later permission denial", async () => {
    let calls = 0; const fetcher = api(() => { calls++; if (calls === 1) throw new Error("lost response");
      if (calls === 2) { enabled = false; return response({ ok: false, error: "This support request is unavailable, or its permission has changed." }, 403); }
      return response({ snapshotId }); });
    render(<PgwSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "UnknownCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry the same PGW save" }));
    await waitFor(() => expect(screen.queryByLabelText("Customer first name")).toBeNull());
    enabled = true; fireEvent.click(screen.getByRole("button", { name: "Check PGW editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same PGW save" });
    expect((screen.getByLabelText("Customer first name") as HTMLInputElement).value).toBe("UnknownCanary");
    expect(screen.getByLabelText("Customer first name").matches(":disabled")).toBe(true);
    fireEvent.click(retry); await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[2][1]?.body).toBe(posts[0][1]?.body);
    expect(posts[2][1]?.headers).toEqual(posts[0][1]?.headers);
  });
  it("retains a draft rather than rebasing it silently when the request changes", async () => {
    const fetcher = api(); const { rerender } = render(<PgwSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "UnsavedCanary" } });
    rerender(<PgwSavedApplication request={{ ...support(), version: 3 }}/>);
    await screen.findByText(/The request changed. Your unsaved draft is still on this page/);
    expect(screen.queryByRole("button", { name: "Save PGW changes" })).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Load latest saved PGW answers" })).toBeTruthy();
  });
  it("closes private inputs at the recorded source/purpose deadline", async () => {
    api(); render(<PgwSavedApplication request={support()}/>); await edit();
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Customer first name")).toBeNull());
    expect(screen.getByText(/Your unsaved draft remains on this page/)).toBeTruthy();
  });
  it("locks an in-flight save whose scope expires until its exact attempt is reconciled", async () => {
    let finish!: (result: unknown) => void, count = 0;
    const fetcher = api(() => ++count === 1 ? new Promise(resolve => { finish = resolve; }) : response({ snapshotId }));
    render(<PgwSavedApplication request={support()}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Customer first name")).toBeNull());
    gateExpiry = "2026-11-15T20:00:00Z";
    fireEvent.click(screen.getByRole("button", { name: "Check PGW editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same PGW save" });
    expect(screen.getByLabelText("Customer first name").matches(":disabled")).toBe(true);
    await act(async () => finish(response({ snapshotId })));
    fireEvent.click(retry); await screen.findByText(/Your private PGW CRP answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers); expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  });
  it("ignores late save completion after unmount", async () => {
    let finish!: (result: unknown) => void; const changed = vi.fn(); api(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<PgwSavedApplication request={support()} onChange={changed}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save PGW changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function")); unmount();
    await act(async () => finish(response({ snapshotId })));
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps labels, groups and errors accessible in the actual PGW editor", async () => {
    api(); const { container } = render(<main><PgwSavedApplication request={support()}/></main>); await edit();
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(finding => finding.id)).toEqual([]);
  });
});
