// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { ParentIntake } from "./intake";
import { familyProfileLeaves, type FamilyProfileDetails } from "@/lib/parent/family-profile";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";
import { PECO_APPLICATION_NOTICE_VERSION } from "@/lib/parent/peco-application-fields";
import { PGW_APPLICATION_NOTICE_VERSION } from "@/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION } from "@/lib/parent/water-application-fields";
import { assessFoodSupport } from "@/lib/parent/food-assessment";
import { getProgramsForNeeds } from "@/lib/parent/programs";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const now = new Date("2026-11-17T18:00:00Z"), personId = "11111111-1111-4111-8111-111111111111", childId = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
function saved() {
  const details: FamilyProfileDetails = { primaryPerson: { id: personId, firstName: "Saved", lastName: "Parent", dateOfBirth: "1990-01-01" },
    members: [{ id: childId, firstName: "Saved", lastName: "Child", dateOfBirth: "2023-01-01", relationship: "Child" }],
    homeAddress: { street: "123 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19104", county: "Philadelphia" },
    mailingAddress: { street: "456 Synthetic Avenue", city: "Philadelphia", state: "PA", zip: "19103", county: "Philadelphia" }, contact: { phone: "215-555-0101", email: "saved@example.invalid" }, preferredLanguage: "en" };
  const key = "44444444-4444-4444-8444-444444444444";
  return { ok: true, ownerId: personId, revision: 2, lastMutationKey: key,
    collection: { collectionEnabled: true, noticeVersion: "family-profile-2026-11-17.v1", expiresAt: "2026-11-18T18:00:00Z", retentionDays: 45 },
    profile: { revision: 2, idempotencyKey: key, details, provenance: Object.fromEntries(Object.keys(familyProfileLeaves(details)).map(path => [path, { confirmedAt: "2026-11-16T18:00:00Z", expiresAt: "2026-12-01T18:00:00Z" }])) } };
}
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
function api(profile: () => unknown | Promise<unknown> = saved) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/family-profile")) return reply(await profile());
    if (url.endsWith("/account")) return reply({ account: { id: personId, email: "fixture@example.invalid" } });
    if (url.includes("/authorization-window")) return reply({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-18T18:00:00Z",
      snapApplication: { collectionEnabled: true, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION },
      wicApplication: { collectionEnabled: true, noticeVersion: WIC_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-18T18:00:00Z" },
      pecoApplication: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-18T18:00:00Z" },
      pgwApplication: { collectionEnabled: true, noticeVersion: PGW_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-18T18:00:00Z" },
      waterApplication: { collectionEnabled: true, noticeVersion: WATER_APPLICATION_NOTICE_VERSION, expiresAt: "2026-11-18T18:00:00Z" } } });
    if (url.endsWith("/intake-defaults")) return reply({ zip: null });
    if (url.endsWith("/food-assessment")) return reply({ ownerId: personId, candidates: assessFoodSupport(JSON.parse(String(init?.body)).answers).map(path => ({ ...path,
      programs: getProgramsForNeeds([path.need]).map(program => ({ programId: program.id, actions: [] })) })) });
    if (url.endsWith("/requests") && init?.method === "POST") return reply({ request: { id: requestId } });
    return reply({ capabilities: [] });
  }); vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function authorize() {
  fireEvent.click(screen.getByLabelText(/I’m 18 or older/)); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /I authorize/ })); fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
}
async function completeSnapQuestions() {
  const answer = (path: string, value: string) => fireEvent.change(document.querySelector(`[data-snap-path="${path}"]`)!, { target: { value } });
  answer("interpreter", "no");
  for (const [label, value] of [["Your sex, as requested on the form", "female"], ["Are you a student?", "no"], ["Are you applying for SNAP?", "yes"], ["Are you a U.S. citizen?", "yes"],
    ["Person 2 sex, as requested on the form", "male"], ["Is person 2 a student?", "no"], ["Is person 2 applying for SNAP?", "no"]])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  answer("income.hasIncome", "no");
  for (const path of ["screening.lowCashAndIncome", "screening.migrantOrSeasonal", "screening.belowShelterCosts", "history.fleeingOrProbation.answer", "history.welfareFraud.answer", "history.otherStateDisqualification.answer"]) answer(path, "no");
  answer("expenseClaims.household", "do_not_claim"); answer("expenseClaims.medical", "not_applicable");
}
async function utility(need: "electricity" | "gas" | "water", authority = "self") {
  const provider = need === "electricity" ? "PECO" : need === "gas" ? "PGW" : "Philadelphia Water";
  await screen.findByLabelText("Household ZIP code"); fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
  fireEvent.click(screen.getByRole("checkbox", { name: provider }));
  fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: authority } });
  fireEvent.click(screen.getByLabelText(need === "electricity" ? /Prepare PECO CAP help/ : need === "gas" ? /Prepare PGW CRP help/ : /Prepare Philadelphia water assistance/));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("saved family information in actual application intake", () => {
  it("keeps explicit guided language while reusing other original-dated SNAP profile facts", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="food"/>);
    fireEvent.change(screen.getByLabelText("Language / Idioma"), { target: { value: "es" } });
    fireEvent.change(screen.getByLabelText(/suficiente comida/), { target: { value: "no" } });
    fireEvent.change(screen.getByLabelText(/ayuda para comprar/), { target: { value: "never" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver mis opciones" }));
    fireEvent.click(screen.getByRole("button", { name: "Solicitar SNAP" }));
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Saved"));
    expect((document.querySelector('[data-snap-path="language"]') as HTMLSelectElement).value).toBe("es");
    await completeSnapQuestions(); await authorize();
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const packet = JSON.parse(String(fetcher.mock.calls.find(([url, init]) => url.endsWith("/requests") && init?.method === "POST")![1]!.body));
    expect(packet.intake).toMatchObject({ language: "es", urgency: "today" }); expect(packet.details.language).toBe("es");
    expect(packet.familyProfileSource.fields.some((field: { applicationPath: string }) => field.applicationPath === "language")).toBe(false);
    expect(packet.familyProfileSource.fields.some((field: { applicationPath: string }) => field.applicationPath === "applicant.firstName")).toBe(true);
  });
  it("does not fetch private family details for ordinary food routing", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="food_now"/>); await screen.findByLabelText("Household ZIP code");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/family-profile"))).toBe(false);
  });
  it("prefills SNAP shared facts without deciding applicants, citizenship or current-month income", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="snap_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Saved"));
    expect((screen.getByLabelText("Your date of birth") as HTMLInputElement).value).toBe("1990-01-01");
    expect((document.querySelector('[data-snap-path="address.street"]') as HTMLInputElement).value).toBe("123 Synthetic Lane");
    expect((screen.getByLabelText("Person 2 first name") as HTMLInputElement).value).toBe("Saved");
    expect((screen.getByLabelText("Are you applying for SNAP?") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByLabelText("Are you a U.S. citizen?")).toBeNull();
    expect((document.querySelector('[data-snap-path="income.hasIncome"]') as HTMLSelectElement).value).toBe("");
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/family-profile"))).toHaveLength(1);
  });
  it("starts SNAP once with the original profile links while new application-specific answers stay parent-provided", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="snap_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Saved"));
    await completeSnapQuestions();
    await authorize(); await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.kind).toBe("snap_application"); expect(body.details.household[0]).toMatchObject({ id: personId, firstName: "Saved", citizen: true });
    expect(body.familyProfileSource.fields).toContainEqual({ applicationPath: `household.${personId}.dateOfBirth`, profilePaths: ["primaryPerson.dateOfBirth"] });
    expect(body.familyProfileSource.fields.some((field: { applicationPath: string }) => /citizen|requestingSnap|income/.test(field.applicationPath))).toBe(false);
    expect(body.intake.zip).toBe("19104");
  });
  it("does not overwrite typed or cleared SNAP answers when the saved profile arrives late", async () => {
    let resolve!: (value: unknown) => void; api(() => new Promise(done => { resolve = done; }));
    render(<ParentIntake initialNeed="snap_new"/>); const first = await screen.findByLabelText("Your first name");
    fireEvent.change(first, { target: { value: "Typed" } }); fireEvent.change(first, { target: { value: "" } });
    await act(async () => { resolve(saved()); });
    expect((first as HTMLInputElement).value).toBe(""); expect((screen.getByLabelText("Your last name") as HTMLInputElement).value).toBe("");
  });
  it("keeps all manual SNAP fields available if the optional profile is missing or malformed", async () => {
    api(() => ({ ok: false, error: "profile RPC not installed" })); render(<ParentIntake initialNeed="snap_new"/>);
    const first = await screen.findByLabelText("Your first name"); fireEvent.change(first, { target: { value: "Manual" } });
    expect((first as HTMLInputElement).value).toBe("Manual"); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("copies WIC contact facts and only an explicitly selected child, preserving source references in the single start", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    expect((screen.getByLabelText("Contact street address") as HTMLInputElement).value).toBe("456 Synthetic Avenue");
    expect((screen.getByLabelText("Who is applying for WIC?") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByLabelText("Mother first name")).toBeNull(); expect(screen.queryByLabelText("Child 1 first name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
    fireEvent.change(screen.getByLabelText("Who is applying for WIC?"), { target: { value: "children" } });
    fireEvent.change(screen.getByLabelText("Add a child from your saved family information"), { target: { value: childId } });
    expect((screen.getByLabelText("Child 1 first name") as HTMLInputElement).value).toBe("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Remove child 1" }));
    fireEvent.change(screen.getByLabelText("Add a child from your saved family information"), { target: { value: childId } });
    await authorize(); await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.details.children).toEqual([{ id: childId, firstName: "Saved", lastName: "Child", dateOfBirth: "2023-01-01" }]);
    expect(body.details).not.toHaveProperty("mother"); expect(body.familyProfileSource).toMatchObject({ expectedOwnerId: personId, revision: 2, options: { wicChildIds: [childId] } });
    expect(body.familyProfileSource.fields).toContainEqual({ applicationPath: `children.${childId}.dateOfBirth`, profilePaths: [`members.${childId}.dateOfBirth`] });
    expect(body).not.toHaveProperty("confirmedAt"); expect(body.intake).not.toHaveProperty("contact");
  });
  it.each(["snap_new", "wic_new"] as const)("refreshes only unchanged %s autofills after a proven no-write profile change within the original mandate", async need => {
    let changed = false;
    const latest = saved(); latest.revision = latest.profile.revision = 3; latest.profile.details.primaryPerson.lastName = "Updated";
    const fetcher = api(() => changed ? latest : saved()), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/requests") && init?.method === "POST" && !changed) {
        changed = true; return reply({ ok: false, error: "Your saved family answers changed or expired before this save. Check the current family profile before trying again." }, 412);
      }
      return usual(url, init);
    });
    render(<ParentIntake initialNeed={need}/>);
    await waitFor(() => expect((screen.getByLabelText(need === "snap_new" ? "Your first name" : "Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText(need === "snap_new" ? "Your first name" : "Contact first name"), { target: { value: "Manual" } });
    if (need === "snap_new") await completeSnapQuestions();
    else {
      fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
      fireEvent.change(screen.getByLabelText("Who is applying for WIC?"), { target: { value: "children" } });
      fireEvent.change(screen.getByLabelText("Add a child from your saved family information"), { target: { value: childId } });
    }
    await authorize(); await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"), first = JSON.parse(String(posts[0][1]!.body)), second = JSON.parse(String(posts[1][1]!.body));
    expect(posts).toHaveLength(2); expect(posts[1][1]!.headers).toEqual(posts[0][1]!.headers);
    expect(second.mandate).toEqual(first.mandate); expect(second.familyProfileSource.revision).toBe(3);
    const key = need === "snap_new" ? "applicant" : "contact";
    expect(second.details[key]).toMatchObject({ firstName: "Manual", lastName: "Updated" });
    expect(second.familyProfileSource.fields.some((field: { applicationPath: string }) => field.applicationPath === `${key}.firstName`)).toBe(false);
    if (need === "wic_new") { expect(second.details.beneficiaries).toBe("children"); expect(second.details.children).toEqual(first.details.children); expect(second.familyProfileSource.options).toEqual({ wicChildIds: [childId] }); }
    else { expect(second.details.income).toEqual(first.details.income); expect(second.details.household[0].citizen).toBe(true); }
  });
  it("clears only an expired indispensable SNAP fact and keeps application-specific answers for the necessary question", async () => {
    let changed = false;
    const latest = saved(); latest.revision = latest.profile.revision = 3;
    delete latest.profile.details.primaryPerson.dateOfBirth; delete latest.profile.provenance["primaryPerson.dateOfBirth"];
    const fetcher = api(() => changed ? latest : saved()), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/requests") && init?.method === "POST") { changed = true; return reply({ ok: false, error: "Your saved family answers changed or expired before this save. Check the current family profile before trying again." }, 412); }
      return usual(url, init);
    });
    render(<ParentIntake initialNeed="snap_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Saved"));
    await completeSnapQuestions(); await authorize();
    await screen.findByText("A current date of birth is needed. Your other application answers are kept.");
    expect((screen.getByLabelText("Your date of birth") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Saved");
    expect((screen.getByLabelText("Your sex, as requested on the form") as HTMLSelectElement).value).toBe("female");
    expect((screen.getByLabelText("Are you applying for SNAP?") as HTMLSelectElement).value).toBe("yes");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("removes an expired optional WIC autofill without turning it into a newly typed fact or repeating permission", async () => {
    let changed = false;
    const latest = saved(); latest.revision = latest.profile.revision = 3;
    delete latest.profile.details.contact!.phone; delete latest.profile.provenance["contact.phone"];
    const fetcher = api(() => changed ? latest : saved()), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/requests") && init?.method === "POST" && !changed) { changed = true; return reply({ ok: false, error: "Your saved family answers changed or expired before this save. Check the current family profile before trying again." }, 412); }
      return usual(url, init);
    });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); await authorize();
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"), body = JSON.parse(String(posts[1][1]!.body));
    expect(body.details.contact.phone).toBeUndefined(); expect(body.familyProfileSource.fields.some((field: { applicationPath: string }) => field.applicationPath === "contact.phone")).toBe(false);
    expect(body.details.contact.firstName).toBe("Saved"); expect(posts).toHaveLength(2);
  });
  it.each(["profile", "ZIP"])("never rebases an earlier unknown start after a later %s 412", async source => {
    let posted = 0;
    const latest = saved(); latest.revision = latest.profile.revision = 3; latest.profile.details.primaryPerson.firstName = "Newer";
    const fetcher = api(() => posted ? latest : saved()), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (source === "ZIP" && url.endsWith("/intake-defaults")) return reply({ zip: { value: posted ? "19103" : "19104", sourceRequestId: requestId, sourceVersion: posted ? 2 : 1,
        confirmedAt: "2026-11-16T18:00:00Z", expiresAt: "2026-12-01T18:00:00Z" } });
      if (url.endsWith("/requests") && init?.method === "POST") {
        posted++;
        return reply({ ok: false, error: posted === 1 ? "Response unconfirmed" : source === "profile"
          ? "Your saved family answers changed or expired before this save. Check the current family profile before trying again."
          : "Saved routing information changed before this request was created." }, posted === 1 ? 503 : 412);
      }
      return usual(url, init);
    });
    render(<ParentIntake initialNeed={source === "profile" ? "wic_new" : "food_now"}/>);
    if (source === "profile") {
      await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
      fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
    } else await waitFor(() => expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104"));
    await authorize(); await screen.findByText(/The save result has not been confirmed/);
    const retry = () => screen.getByRole("button", { name: source === "profile" ? "Retry the same WIC request" : "Start getting support" });
    fireEvent.click(retry()); await waitFor(() => expect(posted).toBe(2));
    await screen.findByText(source === "profile" ? /Your saved family answers changed or expired/ : /Saved routing information changed before/);
    fireEvent.click(retry()); await waitFor(() => expect(posted).toBe(3));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    for (const [, init] of posts) { expect(init!.body).toBe(posts[0][1]!.body); expect(init!.headers).toEqual(posts[0][1]!.headers); }
    expect(navigation.push).not.toHaveBeenCalled();
    if (source === "ZIP") expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/intake-defaults"))).toHaveLength(1);
  });
  it("rechecks ownership before a profile 412 refresh and clears facts after a sign-in swap", async () => {
    let owner = personId;
    const fetcher = api(), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/account")) return reply({ account: { id: owner, email: "fixture@example.invalid" } });
      if (url.endsWith("/requests") && init?.method === "POST") { owner = "77777777-7777-4777-8777-777777777777"; return reply({ ok: false, error: "Your saved family answers changed or expired before this save. Check the current family profile before trying again." }, 412); }
      return usual(url, init);
    });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); await authorize();
    await screen.findByRole("heading", { name: "Your sign-in changed" });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(navigation.push).not.toHaveBeenCalled();
  });
  it.each(["electricity", "gas", "water"] as const)("prefills %s people and needs an actual service-address choice without a second mandate", async need => {
    const fetcher = api(); render(<ParentIntake initialNeed={need}/>); await utility(need);
    const firstLabel = need === "electricity" ? "Applicant first name" : need === "gas" ? "Customer first name" : "Applicant full name";
    await waitFor(() => expect((screen.getByLabelText(firstLabel) as HTMLInputElement).value).toBe(need === "water" ? "Saved Parent" : "Saved"));
    const address = screen.getByLabelText(need === "electricity" ? "PECO service street address" : need === "gas" ? "PGW service street address" : "Water property address") as HTMLInputElement;
    expect(address.value).toBe(""); fireEvent.click(screen.getByRole("button", { name: "Use saved home address for this utility account" }));
    expect(address.value).toBe(need === "water" ? "123 Synthetic Lane, Philadelphia, PA, 19104" : "123 Synthetic Lane");
    await authorize(); await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.familyProfileSource).toMatchObject({ expectedOwnerId: personId, revision: 2, options: { useHomeAddress: true } });
    expect(body.mandate.recipientIds).toHaveLength(1); expect(body.details.householdComplete).toBeUndefined();
    expect(body.details.accountNumber).toBeUndefined();
    if (need === "gas") expect(body.details.customer.dateOfBirth).toBeUndefined();
  });
  it("fills a later utility request when unresolved account authority is answered, without losing the cached profile", async () => {
    api(); render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Apply for WIC/ })); fireEvent.click(screen.getByRole("checkbox", { name: /Water bill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Philadelphia Water" }));
    fireEvent.click(screen.getByLabelText(/Prepare Philadelphia water assistance/));
    expect(screen.queryByLabelText("Applicant full name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: "self" } });
    await waitFor(() => expect((screen.getByLabelText("Applicant full name") as HTMLInputElement).value).toBe("Saved Parent"));
  });
  it("keeps a late profile out of the permission step and fills untouched WIC fields when returning to details", async () => {
    let resolve!: (value: unknown) => void; api(() => new Promise(done => { resolve = done; }));
    render(<ParentIntake initialNeed="wic_new"/>); await screen.findByLabelText("Contact first name");
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); await screen.findByRole("button", { name: "Start getting support" });
    await act(async () => { resolve(saved()); }); expect(screen.queryByLabelText("Contact first name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved");
  });
  it("removes old automatic contact and relationship answers when changing the account holder, preserving actual corrections", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="water"/>); await utility("water");
    await waitFor(() => expect((screen.getByLabelText("Applicant full name") as HTMLInputElement).value).toBe("Saved Parent"));
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "Corrected Parent" } });
    fireEvent.change(screen.getByLabelText("What water assistance help is needed?"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: "authorized_caregiver" } });
    fireEvent.change(screen.getByLabelText("Account holder from your saved family information"), { target: { value: childId } });
    expect((screen.getByLabelText("Applicant full name") as HTMLInputElement).value).toBe("Saved Child");
    expect((screen.getByLabelText("Daytime phone number") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Email for application updates") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Mailing address, if different") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Household member 1 full name") as HTMLInputElement).value).toBe("Corrected Parent");
    expect((screen.getByLabelText("Household member 1 relationship to applicant") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("What water assistance help is needed?") as HTMLSelectElement).value).toBe("pending");
    await authorize(); await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.details.phone).toBeUndefined(); expect(body.details.email).toBeUndefined(); expect(body.details.mailingAddress).toBeUndefined();
    expect(body.details.householdMembers[0]).toMatchObject({ id: personId, name: "Corrected Parent" });
    expect(body.familyProfileSource.fields.some((field: { applicationPath: string }) => /phone|email|mailingAddress|relationship/.test(field.applicationPath))).toBe(false);
  });
  it("does not assign the helper as the water applicant without an explicit account-person choice", async () => {
    api(); render(<ParentIntake initialNeed="water"/>); await utility("water", "authorized_caregiver");
    const field = await screen.findByLabelText("Applicant full name"); expect((field as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Account holder from your saved family information"), { target: { value: childId } });
    expect((field as HTMLInputElement).value).toBe("Saved Child");
  });
  it.each(["focus", "pageshow"])("clears cached family facts on %s after an account switch, even when the other profile revision matches", async eventName => {
    let owner = personId; const fetcher = api(); const usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/account") ? reply({ account: { id: owner, email: "fixture@example.invalid" } }) : usual(url, init));
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    owner = "77777777-7777-4777-8777-777777777777";
    const returned = new Event(eventName); if (eventName === "pageshow") Object.defineProperty(returned, "persisted", { value: true });
    fireEvent(window, returned); await screen.findByRole("heading", { name: "Your sign-in changed" });
    expect(screen.queryByLabelText("Contact first name")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Start a fresh request" }).getAttribute("href")).toBe("/get-support?need=wic_new");
  });
  it("rechecks owner immediately before a profile-backed start and cannot reattribute old facts under a new cookie", async () => {
    let owner = personId; const fetcher = api(); const usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith("/account") ? reply({ account: { id: owner, email: "fixture@example.invalid" } }) : usual(url, init));
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); fireEvent.click(await screen.findByRole("checkbox", { name: /I authorize/ }));
    owner = "77777777-7777-4777-8777-777777777777";
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" })); await screen.findByRole("heading", { name: "Your sign-in changed" });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0); expect(navigation.push).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain creation with old family facts after the browser signs into another account", async () => {
    let owner = personId; const fetcher = api(); const usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/account")) return reply({ account: { id: owner, email: "fixture@example.invalid" } });
      if (url.endsWith("/requests") && init?.method === "POST") return reply({ ok: false, error: "Response unconfirmed" }, 503);
      return usual(url, init);
    });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); await authorize();
    const retry = await screen.findByRole("button", { name: "Retry the same WIC request" });
    const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1); expect(JSON.parse(String(posts()[0][1]!.body)).familyProfileSource.expectedOwnerId).toBe(personId);
    owner = "77777777-7777-4777-8777-777777777777";
    fireEvent.click(retry); await screen.findByRole("heading", { name: "Your sign-in changed" });
    expect(posts()).toHaveLength(1); expect(navigation.push).not.toHaveBeenCalled();
  });
  it("acknowledges an uncertain WIC start with the frozen body after the same owner's profile purpose closes", async () => {
    let posted = 0, profileClosed = false;
    const fetcher = api(), usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (profileClosed && url.endsWith("/family-profile")) return reply({ ok: false, error: "Family profile unavailable" }, 403);
      if (url.endsWith("/requests") && init?.method === "POST") return ++posted === 1
        ? reply({ ok: false, error: "Response unconfirmed" }, 503) : reply({ request: { id: requestId } });
      return usual(url, init);
    });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } }); await authorize();
    await screen.findByRole("button", { name: "Retry the same WIC request" });
    const profileReads = fetcher.mock.calls.filter(([url]) => url.endsWith("/family-profile")).length;
    profileClosed = true; fireEvent(window, new Event("focus"));
    fireEvent.click(await screen.findByRole("button", { name: "Retry the same WIC request" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]!.body).toBe(posts[0][1]!.body); expect(posts[1][1]!.headers).toEqual(posts[0][1]!.headers);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/family-profile"))).toHaveLength(profileReads);
  });
  it("keeps facts hidden after a failed page-return check and restores the same draft when access is reverified", async () => {
    let online = true; const fetcher = api(); const usual = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => { if (!online && url.endsWith("/account")) throw new Error("offline"); return usual(url, init); });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "Edited" } }); online = false;
    fireEvent(window, new Event("focus")); await screen.findByRole("heading", { name: "We could not recheck your saved family information" });
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).closest("[hidden]")).toBeTruthy(); online = true;
    fireEvent(window, new Event("online"));
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Edited"));
  });
  it("keeps withdrawn family-profile facts out of a new request instead of treating them as freshly typed answers", async () => {
    let exists = true; const fetcher = api(() => exists ? saved() : { ...saved(), profile: null, revision: 3, lastMutationKey: "88888888-8888-4888-8888-888888888888" });
    render(<ParentIntake initialNeed="wic_new"/>);
    await waitFor(() => expect((screen.getByLabelText("Contact first name") as HTMLInputElement).value).toBe("Saved"));
    exists = false; fireEvent(window, new Event("focus"));
    await screen.findByRole("heading", { name: "We could not recheck your saved family information" });
    expect((screen.getByLabelText("Contact first name") as HTMLInputElement).closest("[hidden]")).toBeTruthy();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
  it("keeps the family picker, notices and existing form accessible", async () => {
    api(); const view = render(<ParentIntake initialNeed="wic_new"/>); await screen.findByLabelText("Contact first name");
    fireEvent.change(screen.getByLabelText("Who is applying for WIC?"), { target: { value: "children" } });
    let violations: unknown[] = [];
    await act(async () => { violations = (await axe.run(view.container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations; });
    expect(violations).toEqual([]);
  });
});
