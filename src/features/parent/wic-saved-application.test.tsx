// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { WicSavedApplication } from "./wic-saved-application";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
import { WIC_APPLICATION_SOURCE, wicApplicationLeaves } from "@/lib/parent/wic-application-fields";
import { FAMILY_PROFILE_NOTICE_VERSION } from "@/lib/parent/family-profile";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { ParentLocaleProvider, ParentLanguageSelector } from "./parent-locale";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
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
function api(post: (init: RequestInit) => unknown = () => response({ snapshotId }), missing = false, record: unknown = snapshot()) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/family-profile-source?")) return response({ ok: true, fields: [] });
    if (url.includes("/authorization-window")) return response({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-16T20:00:00Z",
      wicApplication: { collectionEnabled: enabled, noticeVersion: enabled ? WIC_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? gateExpiry : null } } });
    if (init?.method === "POST") return post(init);
    return missing ? response({ ok: false, error: "This saved application is unavailable." }, 404) : response({ snapshot: record, routingContext: { label: "Household routing ZIP only; this does not establish the contact's postal address.", zip: "19104" } });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function edit() { fireEvent.click(await screen.findByRole("button", { name: "Correct WIC answers" })); await screen.findByLabelText("Contact first name"); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); enabled = true; gateExpiry = "2026-11-14T20:00:00Z"; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owned WIC saved answers", () => {
  it("automatically confirms its exact interrupted save when the owned latest snapshot arrives", async () => {
    const record = snapshot(), fetcher = api(() => new Promise(() => {}), false, record);
    const request = support(), view = render(<WicSavedApplication request={request}/>); await edit();
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "CommittedCanary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const init = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!, body = JSON.parse(String(init.body));
    Object.assign(record, { id: crypto.randomUUID(), revision: 2, base_version: 2, request_version: 3, details: body.details,
      idempotency_key: (init.headers as Record<string, string>)["Idempotency-Key"], consent_evidence: { ...record.consent_evidence, revision: 2 } });
    view.rerender(<WicSavedApplication request={{ ...request, version: 3 }}/>);
    await screen.findByText(/Your private WIC answers are saved as a new revision/);
    expect(screen.queryByRole("button", { name: "Load latest saved WIC answers" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  function clearedFamily(post?: (init: RequestInit) => unknown) {
    const fields = [
      { applicationPath: "contact.firstName", profilePaths: ["primaryPerson.firstName"] },
      { applicationPath: "contact.lastName", profilePaths: ["primaryPerson.lastName"] },
      { applicationPath: `children.${childId}.firstName`, profilePaths: [`members.${childId}.firstName`] },
    ], base = api(post);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/family-profile-source?")) return response({ fields });
      if (url.endsWith("/account")) return response({ account: { id: actorId } });
      if (url.endsWith("/family-profile")) return response({ ownerId: actorId, revision: 2, lastMutationKey: snapshotId,
        collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-11-20T20:00:00Z", retentionDays: 45 }, profile: null });
      return base(url, init);
    }); vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  it("does not infer application confirmations from opening or saving unchanged cleared-profile answers", async () => {
    const fetcher = clearedFamily(); render(<WicSavedApplication request={support()}/>); await edit();
    const confirmation = await screen.findByRole("checkbox", { name: /^Still correct for this WIC request today: Contact first name/ });
    expect((confirmation as HTMLInputElement).checked).toBe(false);
    expect((await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" })); await screen.findByText(/Your private WIC answers are saved/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).confirmedPaths).toBeUndefined();
  });
  it("records only individually selected WIC declarations and freezes exact interrupted-save recovery", async () => {
    let first = true; const fetcher = clearedFamily(() => { if (first) { first = false; throw new Error("lost acknowledgement"); } return response({ snapshotId }); });
    render(<WicSavedApplication request={support()}/>); await edit();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Still correct for this WIC request today: Contact first name/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Still correct for this WIC request today: Child 1 first name/ }));
    expect(screen.queryByRole("checkbox", { name: /routing ZIP/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    const retry = await screen.findByRole("button", { name: "Retry the same WIC save" });
    expect(screen.getByRole("checkbox", { name: /^Still correct for this WIC request today: Contact last name/ }).matches(":disabled")).toBe(true);
    fireEvent.click(retry); await screen.findByText(/Your private WIC answers are saved/);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(2);
    expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
    expect(JSON.parse(String(posts[0][1]?.body)).confirmedPaths).toEqual(["contact.firstName", `children.${childId}.firstName`]);
    expect(JSON.parse(String(posts[0][1]?.body)).familyProfileSource).toBeUndefined();
  });
  it("uses Spanish labels for individual unchanged-answer declarations without renewing siblings", async () => {
    const fetcher = clearedFamily();
    render(<ParentLocaleProvider initialLocale="es"><WicSavedApplication request={support()}/></ParentLocaleProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Corregir respuestas de WIC" }));
    const selected = await screen.findByRole("checkbox", { name: /^Sigue siendo correcto para esta solicitud de WIC hoy: Contacto nombre/ });
    expect((selected as HTMLInputElement).checked).toBe(false);
    fireEvent.click(selected);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios de WIC" }));
    await screen.findByText(/Sus respuestas privadas de WIC se guardaron como una nueva versión/);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.confirmedPaths).toEqual(["contact.firstName"]); expect(body.familyProfileSource).toBeUndefined();
    expect(body.details).toEqual(savedDetails); expect(body.noticeVersion).toBe(WIC_APPLICATION_NOTICE_VERSION);
  });
  it("removes a selected declaration when its answer changes or its child is removed", async () => {
    const fetcher = clearedFamily(); render(<WicSavedApplication request={support()}/>); await edit();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Still correct for this WIC request today: Contact first name/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^Still correct for this WIC request today: Child 1 first name/ }));
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "ChangedCanary" } });
    expect(screen.queryByRole("checkbox", { name: /today: Contact first name/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove child 1" }));
    expect(screen.queryByRole("checkbox", { name: /today: Child/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" })); await screen.findByText(/Your private WIC answers are saved/);
    expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body)).confirmedPaths).toBeUndefined();
  });

  it("refreshes changed linked child facts after a known-no-write preflight without losing manual WIC answers", async () => {
    const fields = [{ applicationPath: `children.${childId}.firstName`, profilePaths: [`members.${childId}.firstName`] }];
    let revision = 2, name = "ProfileChild";
    const base = api(), fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/family-profile-source?")) return response({ fields });
      if (url.endsWith("/account")) return response({ account: { id: actorId } });
      if (url.endsWith("/family-profile")) return response({ ownerId: actorId, revision, lastMutationKey: snapshotId,
        collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-11-20T20:00:00Z", retentionDays: 45 },
        profile: { revision, idempotencyKey: snapshotId, details: { primaryPerson: { id: actorId }, members: [{ id: childId, firstName: name }] }, provenance: { [`members.${childId}.firstName`]: { confirmedAt: "2026-11-12T15:00:00Z", expiresAt: "2026-12-01T15:00:00Z" } } } });
      return base(url, init);
    }); vi.stubGlobal("fetch", fetcher);
    render(<WicSavedApplication request={support()}/>); await edit();
    expect((screen.getByLabelText("Child 1 first name") as HTMLInputElement).value).toBe("ProfileChild");
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "ManualContact" } });
    revision = 3; name = "CorrectedChild";
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" }));
    await screen.findByText(/Saved family information needs a fresh check/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("ManualContact");
    fireEvent.click(screen.getByRole("button", { name: "Refresh linked family answers" }));
    await waitFor(() => expect((screen.getByLabelText("Child 1 first name") as HTMLInputElement).value).toBe("CorrectedChild"));
    fireEvent.click(screen.getByRole("button", { name: "Save WIC changes" })); await screen.findByText(/Your private WIC answers are saved/);
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.details).toMatchObject({ beneficiaries: "children", contact: { firstName: "ManualContact", zip: "19147" }, children: [{ id: childId, firstName: "CorrectedChild" }] });
    expect(body.details.mother).toBeUndefined(); expect(body.familyProfileSource).toEqual({ expectedOwnerId: actorId, revision: 3, fields, options: { wicChildIds: [childId] } });
  });
  it("clears the retained editor before another signed-in family can save its profile-derived child", async () => {
    let currentOwner = actorId; const fields = [{ applicationPath: `children.${childId}.firstName`, profilePaths: [`members.${childId}.firstName`] }], base = api();
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/family-profile-source?")) return response({ fields });
      if (url.endsWith("/account")) return response({ account: { id: currentOwner } });
      if (url.endsWith("/family-profile")) return response({ ownerId: actorId, revision: 2, lastMutationKey: snapshotId,
        collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-11-20T20:00:00Z", retentionDays: 45 },
        profile: { revision: 2, idempotencyKey: snapshotId, details: { primaryPerson: { id: actorId }, members: [{ id: childId, firstName: "ProfileChild" }] }, provenance: { [`members.${childId}.firstName`]: { confirmedAt: "2026-11-12T15:00:00Z", expiresAt: "2026-12-01T15:00:00Z" } } } });
      return base(url, init);
    }); vi.stubGlobal("fetch", fetcher);
    render(<WicSavedApplication request={support()}/>); await edit();
    currentOwner = snapshotId; act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText(/The signed-in account changed/);
    expect(screen.queryByRole("form")).toBeNull(); expect(screen.queryByDisplayValue("ProfileChild")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Correct WIC answers" }).matches(":disabled")).toBe(true);
  });

  it("keeps cached private fields closed after a denied source read and reopens only after owned access is restored", async () => {
    let denied = true; const base = api(), fetcher = vi.fn(async (url: string, init?: RequestInit) => url.includes("/family-profile-source?") && denied
      ? response({ ok: false, error: "Editing access unavailable" }, 403) : base(url, init));
    vi.stubGlobal("fetch", fetcher); render(<WicSavedApplication request={support()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Correct WIC answers" }));
    await screen.findByText(/Private editing access could not be verified/); expect(screen.queryByLabelText("Contact first name")).toBeNull();
    expect(screen.queryByText(/signed-in account changed/)).toBeNull(); denied = false;
    fireEvent.click(screen.getByRole("button", { name: "Recheck private editing access" }));
    expect((await screen.findByLabelText("Contact first name") as HTMLInputElement).value).toBe("SavedCanary");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

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


it.each([false, true])("keeps Spanish WIC lost-reply recovery exact when switching screen language: %s", async switchLanguage => {
  let first = true;
  const fetcher = api(() => { if (first) { first = false; throw new Error("synthetic lost acknowledgement"); } return response({ snapshotId }); });
  render(<ParentLocaleProvider initialLocale="es"><ParentLanguageSelector/><WicSavedApplication request={support()}/></ParentLocaleProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Corregir respuestas de WIC" }));
  fireEvent.change(await screen.findByLabelText("Nombre de la persona de contacto"), { target: { value: "María" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios de WIC" }));
  await screen.findByRole("button", { name: "Reintentar el mismo guardado de WIC" });
  if (switchLanguage) fireEvent.change(screen.getByLabelText(/Idioma de pantalla/), { target: { value: "en" } });
  fireEvent.click(screen.getByRole("button", { name: switchLanguage ? "Retry the same WIC save" : "Reintentar el mismo guardado de WIC" }));
  await screen.findByText(switchLanguage ? /Your private WIC answers are saved as a new revision/ : /Sus respuestas privadas de WIC se guardaron como una nueva versión/);
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
  expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ expectedVersion: 2, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, details: { contact: { firstName: "María" } } });
  expect(screen.getByRole("region", { name: switchLanguage ? "Your private WIC answers" : "Sus respuestas privadas de WIC" }).getAttribute("lang")).toBe(switchLanguage ? "en" : "es");
});
