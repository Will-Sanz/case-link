// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { WicSavedApplication } from "./wic-saved-application";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
import { WIC_APPLICATION_SOURCE, wicApplicationLeaves } from "@/lib/parent/wic-application-fields";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
const now = new Date("2026-11-13T20:00:00Z"), snapshotId = "22222222-2222-4222-8222-222222222222";
const childId = "33333333-3333-4333-8333-333333333333", actorId = "44444444-4444-4444-8444-444444444444";
const savedDetails = { applicationType: "new", beneficiaries: "children", contact: { firstName: "SavedCanary", lastName: "Example", zip: "19147" }, children: [{ id: childId, firstName: "ChildCanary" }] };
function snapshot() {
  return { id: snapshotId, request_id: fixtureRequest().id, revision: 1, base_version: 1, request_version: 2, details: savedDetails,
    provenance: Object.fromEntries(Object.keys(wicApplicationLeaves(savedDetails)).map(path => [path, { source: "parent", confirmedAt: "2026-11-13T19:00:00Z", asOf: "2026-11-13" }])),
    source: WIC_APPLICATION_SOURCE, notice_version: WIC_APPLICATION_NOTICE_VERSION, created_at: "2026-11-13T19:00:00Z", idempotency_key: childId,
    consent_evidence: { subjectAuthorityDeclared: true, statement: WIC_SUBJECT_AUTHORITY_STATEMENT, actorId, noticeVersion: WIC_APPLICATION_NOTICE_VERSION,
      declaredAt: "2026-11-13T19:00:00Z", revision: 1, detailsSha256: "a".repeat(64), subjects: ["contact", `children.${childId}`] } };
}
const support = (status: "active" | "paused" = "active") => fixtureRequest({ version: 2, status, intake: fixtureIntake({ needs: ["wic_new"], zip: "19104", householdSize: null, utilityProviders: [] }),
  mandate: fixtureMandate({ recipientIds: ["wic-pa"], mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: "2026-11-16T20:00:00Z" }) });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let enabled = true;
let gateExpiry = "2026-11-14T20:00:00Z";
function api(post: (init: RequestInit) => unknown = () => response({ snapshotId }), missing = false) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return response({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-16T20:00:00Z",
      wicApplication: { collectionEnabled: enabled, noticeVersion: enabled ? WIC_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? gateExpiry : null } } });
    if (init?.method === "POST") return post(init);
    return missing ? response({ ok: false, error: "This saved application is unavailable." }, 404) : response({ snapshot: snapshot(), routingContext: { label: "Household routing ZIP only; this does not establish the contact's postal address.", zip: "19104" } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function edit() { fireEvent.click(await screen.findByRole("button", { name: "Correct WIC answers" })); await screen.findByLabelText("Contact first name"); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); enabled = true; gateExpiry = "2026-11-14T20:00:00Z"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owned WIC saved answers", () => {
  it("reuses saved private answers and an independent postal ZIP while paused without extra consent checkbox", async () => {
    const fetcher = api(), changed = vi.fn(); render(<WicSavedApplication request={support("paused")} onChange={changed}/>); await edit();
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("SavedCanary");
    expect((screen.getByLabelText("Contact postal ZIP code") as HTMLInputElement).value).toBe("19147");
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "UpdatedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await screen.findByText(/Your WIC answers are saved. Your request stays paused/);
    expect(changed).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ expectedVersion: 2, subjectAuthorityDeclared: true, noticeVersion: WIC_APPLICATION_NOTICE_VERSION,
      details: { contact: { firstName: "UpdatedCanary", zip: "19147" }, children: [{ id: childId, firstName: "ChildCanary" }] } });
  });
  it("keeps history readable but exposes no private controls with a closed WIC purpose", async () => {
    enabled = false; api(); render(<WicSavedApplication request={support()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.getByText("SavedCanary")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("button", { name: "Correct WIC answers" })).toBeNull();
  });
  it("can save an explicitly partial empty history after the full notice", async () => {
    const fetcher = api(undefined, true); render(<WicSavedApplication request={support()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Add private WIC answers" }));
    await screen.findByRole("region", { name: "WIC private information notice" });
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "PartialCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await screen.findByText(/Your private WIC answers are saved as a new revision/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).details).toEqual({ contact: { firstName: "PartialCanary" } });
  });
  it("retries an unknown save with identical bytes/key even after a later permission denial", async () => {
    let calls = 0; const fetcher = api(() => { calls++; if (calls === 1) throw new Error("lost response");
      if (calls === 2) { enabled = false; return response({ ok: false, error: "This support request is unavailable, or its permission has changed." }, 403); }
      return response({ snapshotId }); });
    render(<WicSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "UnknownCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry the same WIC save" }));
    await waitFor(() => expect(screen.queryByLabelText("Contact first name")).toBeNull());
    enabled = true; fireEvent.click(screen.getByRole("button", { name: "Check WIC editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same WIC save" });
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("UnknownCanary");
    expect(screen.getByLabelText("Contact first name").matches(":disabled")).toBe(true);
    fireEvent.click(retry); await screen.findByText(/Your private WIC answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[2][1]?.body).toBe(posts[0][1]?.body);
    expect(posts[2][1]?.headers).toEqual(posts[0][1]?.headers);
  });
  it("retains a draft rather than rebasing it silently when the request changes", async () => {
    const fetcher = api(); const { rerender } = render(<WicSavedApplication request={support()}/>); await edit();
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "UnsavedCanary" } });
    rerender(<WicSavedApplication request={{ ...support(), version: 3 }}/>);
    await screen.findByText(/The request changed. Your unsaved draft is still on this page/);
    expect(screen.queryByRole("button", { name: "Save WIC changes" })).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Load latest saved WIC answers" })).toBeTruthy();
  });
  it("closes private inputs at the recorded source/purpose deadline", async () => {
    api(); render(<WicSavedApplication request={support()}/>); await edit();
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Contact first name")).toBeNull());
    expect(screen.getByText(/Your unsaved draft remains on this page/)).toBeTruthy();
  });
  it("locks an in-flight save whose scope expires until its exact attempt is reconciled", async () => {
    let finish!: (result: unknown) => void, count = 0;
    const fetcher = api(() => ++count === 1 ? new Promise(resolve => { finish = resolve; }) : response({ snapshotId }));
    render(<WicSavedApplication request={support()}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => { vi.setSystemTime("2026-11-14T20:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByLabelText("Contact first name")).toBeNull());
    gateExpiry = "2026-11-15T20:00:00Z";
    fireEvent.click(screen.getByRole("button", { name: "Check WIC editing access again" }));
    const retry = await screen.findByRole("button", { name: "Retry the same WIC save" });
    expect(screen.getByLabelText("Contact first name").matches(":disabled")).toBe(true);
    await act(async () => finish(response({ snapshotId })));
    fireEvent.click(retry); await screen.findByText(/Your private WIC answers are saved as a new revision/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers); expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  });
  it("ignores late save completion after unmount", async () => {
    let finish!: (result: unknown) => void; const changed = vi.fn(); api(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<WicSavedApplication request={support()} onChange={changed}/>); await edit();
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await waitFor(() => expect(finish).toBeTypeOf("function")); unmount();
    await act(async () => finish(response({ snapshotId })));
    expect(changed).not.toHaveBeenCalled();
  });
  it("keeps labels, groups and errors accessible in the actual WIC editor", async () => {
    api(); const { container } = render(<main><WicSavedApplication request={support()}/></main>); await edit();
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(finding => finding.id)).toEqual([]);
  });
});
