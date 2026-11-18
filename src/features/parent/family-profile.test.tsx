// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileLeaves, type FamilyProfileDetails, type FamilyProfileRead } from "@/lib/parent/family-profile";
import { FamilyProfile, FamilyProfileWelcome } from "./family-profile";
import { ParentLanguageSelector, ParentLocaleProvider } from "./parent-locale";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

const ownerId = "11111111-1111-4111-8111-111111111111", personId = "22222222-2222-4222-8222-222222222222";
const previousKey = "33333333-3333-4333-8333-333333333333";
const now = "2026-11-17T18:00:00.000Z";
function read(profile = false): FamilyProfileRead {
  const details: FamilyProfileDetails = { primaryPerson: { id: personId, firstName: "Morgan", lastName: "Example" }, contact: { phone: "215-555-0101" } };
  return { ownerId, revision: profile ? 1 : 0,
    collection: { collectionEnabled: true, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, expiresAt: "2026-11-17T19:00:00.000Z", retentionDays: 45 },
    profile: profile ? { revision: 1, details, provenance: provenance(details, "2026-11-15T18:00:00.000Z"), idempotencyKey: previousKey } : null,
    lastMutationKey: profile ? previousKey : null };
}
function provenance(details: FamilyProfileDetails, confirmedAt = now) {
  return Object.fromEntries(Object.keys(familyProfileLeaves(details)).map(path => [path, { confirmedAt, expiresAt: new Date(Date.parse(confirmedAt) + 45 * 86400000).toISOString() }]));
}
function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
const reply = (value: FamilyProfileRead) => ({ ok: true, ...value });
function fakeApi(initial = read()) {
  let current = initial;
  const mutations: { method: string; key: string; body: string }[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return response(reply(current));
    mutations.push({ method: init.method, key: (init.headers as Record<string, string>)["Idempotency-Key"], body: init.body as string });
    const body = JSON.parse(init.body as string), revision = current.revision + 1;
    current = { ...current, revision, lastMutationKey: mutations.at(-1)!.key, profile: init.method === "DELETE" ? null
      : { revision, details: body.details, provenance: provenance(body.details), idempotencyKey: mutations.at(-1)!.key } };
    return response({ ok: true, revision }, init.method === "POST" ? 201 : 200);
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, mutations, get: () => current, set: (value: FamilyProfileRead) => { current = value; } };
}
function agree() { fireEvent.click(screen.getByRole("checkbox", { name: /I have permission to provide these family details/ })); }
async function ready() { return await screen.findByLabelText("Your first name") as HTMLInputElement; }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("family profile editor", () => {
  it("allows partial optional answers only after one storage/reuse permission and keeps person IDs stable", async () => {
    const api = fakeApi(); render(<FamilyProfile returnTo="/get-support?need=gas"/>);
    fireEvent.change(await ready(), { target: { value: "Morgan" } });
    expect((screen.getByRole("button", { name: "Save and finish later" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Save family information" })); expect(api.mutations).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add a person living with you" }));
    fireEvent.change(screen.getByLabelText("Member 1 first name"), { target: { value: "Casey" } });
    fireEvent.change(screen.getByLabelText("Contact phone"), { target: { value: "(215) 555-0101" } }); fireEvent.blur(screen.getByLabelText("Contact phone"));
    agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    await screen.findByText(/Your family information is saved/); await ready();
    const body = JSON.parse(api.mutations[0].body);
    expect(body).toMatchObject({ expectedOwnerId: ownerId, expectedRevision: 0, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true,
      details: { primaryPerson: { firstName: "Morgan" }, members: [{ firstName: "Casey" }], contact: { phone: "215-555-0101" } } });
    expect(body.details.primaryPerson.id).not.toBe(body.details.members[0].id);
    fireEvent.change(screen.getByLabelText("Your last name"), { target: { value: "Example" } }); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    await waitFor(() => expect(api.mutations).toHaveLength(2));
    const corrected = JSON.parse(api.mutations[1].body);
    expect(corrected.details.primaryPerson.id).toBe(body.details.primaryPerson.id); expect(corrected.details.members[0].id).toBe(body.details.members[0].id);
    expect(screen.getByRole("link", { name: "Skip for now and continue to support" }).getAttribute("href")).toBe("/get-support?need=gas");
    expect(document.querySelector("input[type='password']")).toBeNull(); expect(document.querySelector("input[name='ssn']")).toBeNull();
  });

  it("loads existing information without retyping and shows original source dates", async () => {
    const api = fakeApi(read(true)); render(<FamilyProfile/>);
    expect((await ready()).value).toBe("Morgan"); expect((screen.getByLabelText("Contact phone") as HTMLInputElement).value).toBe("215-555-0101");
    expect(screen.getAllByText(/You provided · Nov 15, 2026 · Reuse until Dec 30, 2026/)).toHaveLength(3);
    expect(api.mutations).toHaveLength(0); expect(screen.queryByText(/Confirm your first name is still current/)).toBeNull();
  });

  it("keeps home and mailing addresses separate until the parent explicitly chooses same address", async () => {
    const api = fakeApi(); render(<FamilyProfile/>); await ready();
    fireEvent.change(screen.getByLabelText("Home address street address"), { target: { value: "100 Example Street" } });
    expect((screen.getByLabelText("Mailing address street address") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Mailing address street address"), { target: { value: "PO Box 10" } });
    fireEvent.change(screen.getByLabelText("Is your mailing address the same as your home address?"), { target: { value: "yes" } });
    expect(screen.queryByLabelText("Mailing address street address")).toBeNull();
    agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" })); await waitFor(() => expect(api.mutations).toHaveLength(1));
    expect(JSON.parse(api.mutations[0].body).details).toMatchObject({ homeAddress: { street: "100 Example Street" }, mailingAddressSameAsHome: true });
    expect(JSON.parse(api.mutations[0].body).details.mailingAddress).toBeUndefined();
  });

  it("supports optional stable income inventories without amounts or program decisions", async () => {
    const api = fakeApi(); render(<FamilyProfile/>); await ready();
    fireEvent.change(screen.getByLabelText("Your income source inventory"), { target: { value: "sources" } });
    fireEvent.change(screen.getByLabelText("Add your income source"), { target: { value: "disability" } });
    expect(screen.getByLabelText("Your income source 1")).toBeTruthy();
    agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" })); await waitFor(() => expect(api.mutations).toHaveLength(1));
    expect(JSON.parse(api.mutations[0].body).details.primaryPerson.income).toMatchObject({ state: "sources", sources: [{ kind: "disability" }] });
    expect(screen.queryByLabelText(/amount|pregnancy|medical|benefit decision/i)).toBeNull();
  });

  it("confirms only the selected expired fact and does not renew other saved dates", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    const initial = read(true); initial.profile!.provenance["primaryPerson.firstName"].expiresAt = "2026-11-17T18:00:01.000Z";
    const api = fakeApi(initial); render(<FamilyProfile/>); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(screen.getByText(/Expired for reuse/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm your first name is still current" }));
    agree(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and finish later" })); }); expect(api.mutations).toHaveLength(1);
    expect(JSON.parse(api.mutations[0].body).confirmedPaths).toEqual(["primaryPerson.firstName"]);
  });

  it("keeps the original draft expiry evidence after a same-revision refresh redacts an expired saved fact", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    const initial = read(true); initial.profile!.provenance["primaryPerson.firstName"].expiresAt = "2026-11-17T18:00:01.000Z";
    const api = fakeApi(initial); render(<FamilyProfile/>); await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1001); });
    const redacted = structuredClone(initial); delete redacted.profile!.details.primaryPerson.firstName; delete redacted.profile!.provenance["primaryPerson.firstName"]; api.set(redacted);
    await act(async () => { fireEvent.focus(window); });
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Morgan");
    const confirm = screen.getByRole("checkbox", { name: "Confirm your first name is still current" });
    expect((confirm as HTMLInputElement).checked).toBe(false); fireEvent.click(confirm); agree();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save and finish later" })); });
    expect(api.mutations).toHaveLength(1); expect(JSON.parse(api.mutations[0].body).confirmedPaths).toEqual(["primaryPerson.firstName"]);
  });

  it.each([false, true])("keeps collection closed before input or new save when gateExpired=%s", async expired => {
    const initial = read(true); initial.collection.collectionEnabled = expired; initial.collection.expiresAt = expired ? "2026-11-17T17:59:59.000Z" : null;
    const api = fakeApi(initial); render(<FamilyProfile/>);
    const input = await ready(); expect(input.value).toBe("Morgan"); expect(input.matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Save and finish later" })).toBeNull();
    fireEvent.submit(screen.getByRole("form", { name: "Save family information" })); expect(api.mutations).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Find urgent food help" })).toBeTruthy();
  });

  it("closes a form when its original collection deadline passes", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now)); const initial = read(); initial.collection.expiresAt = "2026-11-17T18:00:01.000Z";
    fakeApi(initial); render(<FamilyProfile/>); await act(async () => {});
    const input = screen.getByLabelText("Your first name"); agree();
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(input.matches(":disabled")).toBe(true); expect(screen.queryByRole("button", { name: "Save and finish later" })).toBeNull();
  });

  it("reconciles a lost save acknowledgement from the exact owned GET without another save", async () => {
    const api = fakeApi(); const normal = api.fetcher.getMockImplementation()!;
    api.fetcher.mockImplementation(async (url, init) => { const result = await normal(url, init); return init?.method === "POST" ? response({ ok: false, error: "Connection interrupted" }, 503) : result; });
    render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "Morgan" } }); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    expect(await screen.findByText(/Your family information is saved/)).toBeTruthy();
    expect(api.mutations).toHaveLength(1); expect(screen.queryByRole("button", { name: "Retry the same family save" })).toBeNull();
  });

  it("retries identical bytes and key after an uncommitted network failure", async () => {
    const api = fakeApi(); const normal = api.fetcher.getMockImplementation()!; let lost = true;
    api.fetcher.mockImplementation(async (url, init) => { if (init?.method === "POST" && lost) { lost = false; throw new Error("Local network failed"); } return normal(url, init); });
    render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "Morgan" } }); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    const retry = await screen.findByRole("button", { name: "Retry the same family save" });
    expect(screen.getByLabelText("Your first name").matches(":disabled")).toBe(true); fireEvent.click(retry);
    await screen.findByText(/Your family information is saved/);
    const posts = api.fetcher.mock.calls.filter(call => call[1]?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toBe(posts[0][1]?.body); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers);
  });

  it("does not call a malformed success response a saved profile", async () => {
    const api = fakeApi(); const normal = api.fetcher.getMockImplementation()!;
    api.fetcher.mockImplementation(async (url, init) => init?.method === "POST" ? response({ ok: true, revision: "1" }) : normal(url, init));
    render(<FamilyProfile/>); await ready(); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    await screen.findByRole("button", { name: "Retry the same family save" }); expect(screen.queryByRole("status")).toBeNull();
  });

  it("locks one in-flight write and preserves its exact ownership and payload", async () => {
    const api = fakeApi(); let finish!: (value: ReturnType<typeof response>) => void;
    api.fetcher.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : response(reply(read())));
    render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "Pending" } }); agree();
    fireEvent.submit(screen.getByRole("form", { name: "Save family information" })); fireEvent.submit(screen.getByRole("form", { name: "Save family information" }));
    expect(api.fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
    expect(screen.getByLabelText("Your first name").matches(":disabled")).toBe(true);
    await act(async () => { finish(response({ ok: false, error: "Check the input" }, 400)); });
    expect(screen.getByLabelText("Your first name").matches(":disabled")).toBe(false);
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Pending");
  });

  it("preserves the unsaved draft after a revision conflict until latest information is loaded", async () => {
    const api = fakeApi(read(true)); const normal = api.fetcher.getMockImplementation()!;
    api.fetcher.mockImplementation(async (url, init) => {
      if (init?.method === "POST") { const changed = read(true); changed.revision = 2; changed.profile!.revision = 2; changed.profile!.details.primaryPerson.firstName = "Newer"; api.set(changed); return response({ ok: false, error: "This request changed" }, 409); }
      return normal(url, init);
    });
    render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "Unsaved" } }); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    const load = await screen.findByRole("button", { name: "Load latest family information" });
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Unsaved");
    fireEvent.click(load); await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Newer"));
    expect((screen.getByRole("checkbox", { name: /I have permission/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("wipes the previous account draft when a fresh access check finds another owner", async () => {
    const api = fakeApi(read(true)); render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "PRIVATE-OLD-DRAFT" } }); agree();
    const changed = read(true); changed.ownerId = "44444444-4444-4444-8444-444444444444"; changed.profile!.details.primaryPerson.firstName = "Different account"; api.set(changed);
    fireEvent.focus(window);
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Different account"));
    expect(document.body.textContent).not.toContain("PRIVATE-OLD-DRAFT"); expect((screen.getByRole("checkbox", { name: /I have permission/ }) as HTMLInputElement).checked).toBe(false);
    expect(api.mutations).toHaveLength(0);
  });

  it("aborts an old account write and ignores its late response after the account changes", async () => {
    const api = fakeApi(read(true)), normal = api.fetcher.getMockImplementation()!;
    let finish!: (value: ReturnType<typeof response>) => void;
    api.fetcher.mockImplementation(async (url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : normal(url, init));
    render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "PRIVATE-PENDING" } }); agree(); fireEvent.click(screen.getByRole("button", { name: "Save and finish later" }));
    const posted = api.fetcher.mock.calls.find(call => call[1]?.method === "POST")!;
    const changed = read(true); changed.ownerId = "44444444-4444-4444-8444-444444444444"; changed.profile!.details.primaryPerson.firstName = "Different account"; api.set(changed);
    fireEvent.focus(window);
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Different account"));
    expect(posted[1]?.signal?.aborted).toBe(true);
    await act(async () => { finish(response({ ok: true, revision: 2 }, 201)); });
    expect(JSON.parse(posted[1]!.body as string).expectedOwnerId).toBe(ownerId);
    expect(screen.queryByText(/Your family information is saved/)).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-PENDING");
    expect(api.fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("clears the form and offers normal sign-in after the retained session expires", async () => {
    const api = fakeApi(read(true)); render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "PRIVATE-UNSAVED" } });
    api.fetcher.mockResolvedValue(response({ ok: false, error: "Sign in again" }, 401)); fireEvent.focus(window);
    expect((await screen.findByRole("link", { name: /Sign in to continue/ })).getAttribute("href")).toBe("/sign-in?next=%2Ffamily-profile");
    expect(screen.queryByLabelText("Your first name")).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-UNSAVED");
  });

  it("wipes on pagehide and reloads current saved information on return", async () => {
    fakeApi(read(true)); render(<FamilyProfile/>); fireEvent.change(await ready(), { target: { value: "PRIVATE-DRAFT" } }); agree();
    fireEvent(window, new PageTransitionEvent("pagehide"));
    fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Morgan"));
    expect((screen.getByRole("checkbox", { name: /I have permission/ }) as HTMLInputElement).checked).toBe(false);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it("permits owned profile removal with collection closed and reconciles an unknown deletion", async () => {
    const initial = read(true); initial.collection.collectionEnabled = false; const api = fakeApi(initial), normal = api.fetcher.getMockImplementation()!;
    api.fetcher.mockImplementation(async (url, init) => { const result = await normal(url, init); return init?.method === "DELETE" ? response({ ok: false, error: "Lost acknowledgement" }, 503) : result; });
    render(<FamilyProfile/>); await ready(); fireEvent.click(screen.getByText("Remove saved family information")); fireEvent.click(screen.getByRole("button", { name: "Confirm removal of saved family information" }));
    expect(await screen.findByText(/Your saved family information was removed/)).toBeTruthy();
    expect(api.mutations).toHaveLength(1); expect(api.mutations[0]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(api.mutations[0].body)).toEqual({ expectedOwnerId: ownerId, expectedRevision: 1 });
    expect(screen.queryByRole("button", { name: "Retry the same removal" })).toBeNull();
  });

  it("keeps malformed private replies out of the form", async () => {
    const malformed = reply(read(true)); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...malformed, profile: { ...malformed.profile, raw: "PRIVATE-CANARY" } })));
    render(<FamilyProfile/>); await screen.findByText(/needs a service check/);
    expect(screen.queryByLabelText("Your first name")).toBeNull(); expect(document.body.textContent).not.toContain("PRIVATE-CANARY");
  });

  it("uses distinct field labels, legends, IDs and a normal private full-page form", async () => {
    fakeApi(); render(<FamilyProfile/>); await ready(); fireEvent.click(screen.getByRole("button", { name: "Add a person living with you" }));
    const form = screen.getByRole("form", { name: "Save family information" });
    const ids = [...form.querySelectorAll("[id]")].map(element => element.id); expect(new Set(ids).size).toBe(ids.length);
    for (const element of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=checkbox]),select"))
      expect(form.querySelector(`label[for='${element.id}']`)).toBeTruthy();
    expect(within(form).getByRole("group", { name: "Other people living with you" })).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("optional first-sign-in profile offer", () => {
  it("offers a full profile only when collection is current and no saved profile exists", async () => {
    fakeApi(); render(<FamilyProfileWelcome/>); expect((await screen.findByRole("link", { name: "Save family basics" })).getAttribute("href")).toBe("/family-profile");
    expect(screen.getByText(/family profile is optional/)).toBeTruthy();
  });
  it.each(["saved", "closed", "failed"])("adds no setup interruption for %s profile access", async kind => {
    const initial = read(kind === "saved"); if (kind === "closed") initial.collection.collectionEnabled = false;
    const api = fakeApi(initial); if (kind === "failed") api.fetcher.mockResolvedValue(response({ ok: false, error: "Unavailable" }, 503));
    const { container } = render(<FamilyProfileWelcome/>); await waitFor(() => expect(api.fetcher).toHaveBeenCalled()); await act(async () => {});
    expect(container.textContent).toBe(""); expect(screen.queryByRole("link", { name: "Save family basics" })).toBeNull();
  });
});


describe("Spanish family information", () => {
  it("localizes optional fields and consent while keeping original typed values, subject IDs and packet enums", async () => {
    const api = fakeApi(); render(<ParentLocaleProvider initialLocale="es"><FamilyProfile/></ParentLocaleProvider>);
    const firstName = await screen.findByLabelText("Su nombre");
    expect(screen.getByRole("heading", { name: "Su información familiar", level: 1 })).toBeTruthy();
    fireEvent.change(firstName, { target: { value: "Morgan" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a una persona que vive con usted" }));
    fireEvent.change(screen.getByLabelText("Nombre del integrante 1"), { target: { value: "Casey" } });
    fireEvent.change(screen.getByLabelText("Inventario de ingresos del integrante 1"), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText("Idioma preferido para el servicio"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tengo permiso para proporcionar estos datos familiares/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y terminar después" }));
    const savedNotice = await screen.findByText("Su información familiar está guardada. Puede completarla después o continuar para obtener apoyo.");
    await waitFor(() => expect(document.activeElement).toBe(savedNotice));
    expect(api.mutations).toHaveLength(1);
    expect(JSON.parse(api.mutations[0].body)).toMatchObject({ expectedOwnerId: ownerId, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true,
      details: { primaryPerson: { firstName: "Morgan" }, members: [{ firstName: "Casey", income: { state: "unknown", sources: [] } }], preferredLanguage: "en" } });
  });
  it("keeps the exact unknown save packet when only screen language changes", async () => {
    const api = fakeApi(), normal = api.fetcher.getMockImplementation()!;
    let lose = true;
    api.fetcher.mockImplementation(async (url, init) => {
      if (init?.method === "POST" && lose) { lose = false; throw new TypeError("Synthetic lost response before commit"); }
      return normal(url, init);
    });
    render(<ParentLocaleProvider initialLocale="es"><ParentLanguageSelector/><FamilyProfile/></ParentLocaleProvider>);
    fireEvent.change(await screen.findByLabelText("Su nombre"), { target: { value: "Morgan" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tengo permiso para proporcionar estos datos familiares/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y terminar después" }));
    await screen.findByRole("button", { name: "Reintentar el mismo guardado familiar" });
    expect(document.activeElement).toBe(screen.getByRole("alert").parentElement);
    fireEvent.change(screen.getByLabelText("Idioma de pantalla / Screen language"), { target: { value: "en" } });
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Morgan");
    fireEvent.click(screen.getByRole("button", { name: "Retry the same family save" }));
    await screen.findByText("Your family information is saved. You can finish it later or continue to support.");
    const attempts = api.fetcher.mock.calls.filter(call => call[1]?.method === "POST");
    expect(attempts).toHaveLength(2); expect(attempts[1][1]?.body).toBe(attempts[0][1]?.body);
    expect(new Headers(attempts[1][1]?.headers).get("Idempotency-Key")).toBe(new Headers(attempts[0][1]?.headers).get("Idempotency-Key"));
    expect(JSON.parse(attempts[1][1]?.body as string).details.preferredLanguage).toBeUndefined();
  });
  it("offers Spanish narrow reaffirmation without refreshing a different saved answer", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    const initial = read(true); initial.profile!.provenance["primaryPerson.firstName"].expiresAt = "2026-11-17T18:00:01.000Z";
    const api = fakeApi(initial); render(<ParentLocaleProvider initialLocale="es"><FamilyProfile/></ParentLocaleProvider>);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1001); });
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirme que este dato sigue vigente: Su nombre" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tengo permiso para proporcionar estos datos familiares/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Guardar y terminar después" })); });
    expect(api.mutations).toHaveLength(1);
    expect(JSON.parse(api.mutations[0].body).confirmedPaths).toEqual(["primaryPerson.firstName"]);
    expect(JSON.parse(api.mutations[0].body).details.primaryPerson.lastName).toBe("Example");
  });
});
