// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { WaterSavedApplication } from "./water-saved-application";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
import { WATER_APPLICATION_REFERENCE, waterApplicationLeaves } from "@/lib/parent/water-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/water-application-fields";
const now = new Date("2026-11-13T22:20:00Z"), snapshotId = "22222222-2222-4222-8222-222222222222";
const childId = "33333333-3333-4333-8333-333333333333", actorId = "44444444-4444-4444-8444-444444444444";
const applicantId = "55555555-5555-4555-8555-555555555555";
const savedDetails = { journey: "unknown", existingApplication: "saved", applicant: { id: applicantId, name: "SavedCanary Example" }, propertyAddress: "WaterPropertyCanary, Philadelphia PA 19147", householdMembers: [{ id: childId, name: "ChildCanary" }] };
function snapshot() {
  return { id: snapshotId, request_id: fixtureRequest().id, revision: 1, base_version: 1, request_version: 2, details: savedDetails,
    provenance: Object.fromEntries(Object.keys(waterApplicationLeaves(savedDetails)).map(path => [path, { source: "parent", confirmedAt: "2026-11-13T22:15:00Z", asOf: "2026-11-13" }])),
    source: WATER_APPLICATION_REFERENCE, notice_version: WATER_APPLICATION_NOTICE_VERSION, created_at: "2026-11-13T22:15:00Z", idempotency_key: childId,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: WATER_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: WATER_ACCOUNT_AUTHORITY_STATEMENT, accountAuthority: "self", actorId, noticeVersion: WATER_APPLICATION_NOTICE_VERSION,
      declaredAt: "2026-11-13T22:15:00Z", revision: 1, detailsSha256: "a".repeat(64), subjects: [`applicant.${applicantId}`, `householdMembers.${childId}`] } };
}
const support = (status: "active" | "paused" = "active") => fixtureRequest({ version: 2, status, intake: fixtureIntake({ needs: ["water"], zip: "19104", householdSize: null, utilityProviders: ["pwd"], incomeAmount: null, incomeFrequency: "unknown", accountAuthority: "self" }),
  mandate: fixtureMandate({ recipientIds: ["pwd-tap"], mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: "2026-11-16T20:00:00Z" }) });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let enabled = true;
let gateExpiry = "2026-11-14T20:00:00Z";
function api(post: (init: RequestInit) => unknown = () => response({ snapshotId }), missing = false, record: unknown = snapshot()) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return response({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-16T20:00:00Z",
      waterApplication: { collectionEnabled: enabled, noticeVersion: enabled ? WATER_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? gateExpiry : null } } });
    if (init?.method === "POST") return post(init);
    return missing ? response({ ok: false, error: "This saved application is unavailable." }, 404) : response({ snapshot: record });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function edit() { fireEvent.click(await screen.findByRole("button", { name: "Correct water answers" })); await screen.findByLabelText("Applicant full name"); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); enabled = true; gateExpiry = "2026-11-14T20:00:00Z"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owned water saved answers", () => {
  it("automatically confirms its exact interrupted save when the owned latest snapshot arrives", async () => {
    const record = snapshot(), fetcher = api(() => new Promise(() => {}), false, record);
    const request = support(), view = render(<WaterSavedApplication request={request}/>); await edit();
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "CommittedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const init = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!, body = JSON.parse(String(init.body));
    Object.assign(record, { id: crypto.randomUUID(), revision: 2, base_version: 2, request_version: 3, details: body.details,
      idempotency_key: (init.headers as Record<string, string>)["Idempotency-Key"], consent_evidence: { ...record.consent_evidence, revision: 2 } });
    view.rerender(<WaterSavedApplication request={{ ...request, version: 3 }}/>);
    await screen.findByText(/Your private water assistance answers are saved as a new revision/);
    expect(screen.queryByRole("button", { name: "Load latest saved water answers" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each([false, true])("reuses paused saved answers without another checkbox with document scope %s", async documentScope => {
    const request = support("paused");
    if (documentScope) request.mandate.allowedData.push("documents");
    const fetcher = api(), changed = vi.fn(); render(<WaterSavedApplication request={request} onChange={changed}/>); await edit();
    expect((screen.getByLabelText("Applicant full name") as HTMLInputElement).value).toBe("SavedCanary Example");
    expect((screen.getByLabelText("Water property address") as HTMLInputElement).value).toBe("WaterPropertyCanary, Philadelphia PA 19147");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "UpdatedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await screen.findByText(/Your water assistance answers are saved. Your request stays paused/);
    expect(changed).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ expectedVersion: 2, subjectAuthorityDeclared: true, noticeVersion: WATER_APPLICATION_NOTICE_VERSION,
      accountAuthorityDeclared: true, details: { applicant: { id: applicantId, name: "UpdatedCanary" }, propertyAddress: "WaterPropertyCanary, Philadelphia PA 19147", householdMembers: [{ id: childId, name: "ChildCanary" }] } });
  });
  it("keeps history readable but exposes no private controls with a closed water purpose", async () => {
    enabled = false; api(); render(<WaterSavedApplication request={support()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.getByText("SavedCanary Example")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Correct water answers" })).toBeNull();
  });
  it.each([
    ["generic water with no named water recipient", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, recipientIds: [] } })],
    ["multiple needs", (request: ReturnType<typeof support>) => ({ ...request, intake: { ...request.intake, needs: ["water", "gas"] as ReturnType<typeof support>["intake"]["needs"] } })],
    ["unresolved account authority", (request: ReturnType<typeof support>) => ({ ...request, intake: { ...request.intake, accountAuthority: "not_sure" as const } })],
    ["full execution mandate", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, mode: "full" as const } })],
    ["missing utility data permission", (request: ReturnType<typeof support>) => ({ ...request, mandate: { ...request.mandate, allowedData: ["household", "income"] as ReturnType<typeof support>["mandate"]["allowedData"] } })],
  ])("does not expose private water editing for %s", async (_name, change) => {
    api(); render(<WaterSavedApplication request={change(support())}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.queryByRole("button", { name: "Correct water answers" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("can save an explicitly partial empty history after the full notice", async () => {
    const fetcher = api(undefined, true); render(<WaterSavedApplication request={support()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Add private water answers" }));
    await screen.findByRole("region", { name: "Water private information notice" });
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "PartialCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await screen.findByText(/Your private water assistance answers are saved as a new revision/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).details).toMatchObject({ applicant: { id: expect.any(String), name: "PartialCanary" } });
  });
  it("retries an unknown save with identical bytes/key even after a later permission denial", async () => {
    let calls = 0; const fetcher = api(() => { calls++; if (calls === 1) throw new Error("lost response");
      if (calls === 2) { enabled = false; return response({ ok: false, error: "This support request is unavailable, or its permission has changed." }, 403); }
      return response({ snapshotId }); });
    render(<WaterSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "UnknownCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry the same water save" }));
    await waitFor(() => expect(screen.queryByLabelText("Applicant full name")).toBeNull());
    enabled = true; fireEvent.click(screen.getByRole("button", { name: "Check water editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same water save" });
    expect((screen.getByLabelText("Applicant full name") as HTMLInputElement).value).toBe("UnknownCanary");
    expect(screen.getByLabelText("Applicant full name").matches(":disabled")).toBe(true);
    fireEvent.click(retry); await screen.findByText(/Your private water assistance answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[2][1]?.body).toBe(posts[0][1]?.body);
    expect(posts[2][1]?.headers).toEqual(posts[0][1]?.headers);
  });
  it("retains a draft rather than rebasing it silently when the request changes", async () => {
    const fetcher = api(); const { rerender } = render(<WaterSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "UnsavedCanary" } });
    rerender(<WaterSavedApplication request={{ ...support(), version: 3 }}/>);
    await screen.findByText(/The request changed. Your unsaved draft is still on this page/);
    expect(screen.queryByRole("button", { name: "Save water changes" })).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Load latest saved water answers" })).toBeTruthy();
  });
  it("closes private inputs at the recorded source/purpose deadline", async () => {
    api(); render(<WaterSavedApplication request={support()}/>); await edit();
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Applicant full name")).toBeNull());
    expect(screen.getByText(/Your unsaved draft remains on this page/)).toBeTruthy();
  });
  it("locks an in-flight save whose scope expires until its exact attempt is reconciled", async () => {
    let finish!: (result: unknown) => void, count = 0;
    const fetcher = api(() => ++count === 1 ? new Promise(resolve => { finish = resolve; }) : response({ snapshotId }));
    render(<WaterSavedApplication request={support()}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Applicant full name")).toBeNull());
    gateExpiry = "2026-11-15T20:00:00Z";
    fireEvent.click(screen.getByRole("button", { name: "Check water editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same water save" });
    expect(screen.getByLabelText("Applicant full name").matches(":disabled")).toBe(true);
    await act(async () => finish(response({ snapshotId })));
    fireEvent.click(retry); await screen.findByText(/Your private water assistance answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers); expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  });
  it("ignores late save completion after unmount", async () => {
    let finish!: (result: unknown) => void; const changed = vi.fn(); api(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<WaterSavedApplication request={support()} onChange={changed}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function")); unmount();
    await act(async () => finish(response({ snapshotId })));
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps labels, groups and errors accessible in the actual water editor", async () => {
    api(); const { container } = render(<main><WaterSavedApplication request={support()}/></main>); await edit();
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(finding => finding.id)).toEqual([]);
  });
  it("saves a partial financial explanation as words without inventing a signed zero-income attachment", async () => {
    const fetcher = api(); render(<WaterSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Does anyone in the household receive financial support from someone outside the household?"), { target: { value: "no" } });
    fireEvent.change(screen.getByLabelText("How does the applicant pay for food?"), { target: { value: "Using savings\nAnother adult buys groceries" } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save water changes" }));
    await screen.findByText(/Your private water assistance answers are saved as a new revision/);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.details).toMatchObject({ outsideIncomeSupport: "no", applicant: { grossMonthlyIncome: "0.00" }, livingExpenses: { food: "Using savings Another adult buys groceries" } });
    expect(body.details).not.toHaveProperty("signature"); expect(body).not.toHaveProperty("financialAssent");
  });
});
