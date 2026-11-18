// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { ParentIntake, buildMandate } from "./intake";
import { fixtureIntake } from "@/lib/parent/test-fixtures";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/pgw-application-fields";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/water-application-fields";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const now = new Date("2026-11-13T22:20:00Z"), id = "11111111-1111-4111-8111-111111111111", sourceId = "22222222-2222-4222-8222-222222222222";
const options = [
  { need: "gas", provider: "PGW", optIn: /Prepare PGW CRP help/, short: "PGW", label: "PGW CRP", key: "pgwApplication", kind: "pgw_application", program: "pgw-crp", privateLabel: "Customer first name", notice: PGW_APPLICATION_NOTICE_VERSION, subject: PGW_SUBJECT_AUTHORITY_STATEMENT, account: PGW_ACCOUNT_AUTHORITY_STATEMENT },
  { need: "water", provider: "Philadelphia Water", optIn: /Prepare Philadelphia water assistance/, short: "water", label: "Philadelphia water assistance", key: "waterApplication", kind: "water_application", program: "pwd-tap", privateLabel: "Applicant full name", notice: WATER_APPLICATION_NOTICE_VERSION, subject: WATER_SUBJECT_AUTHORITY_STATEMENT, account: WATER_ACCOUNT_AUTHORITY_STATEMENT },
] as const;
type Option = typeof options[number];
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const access = (option: Option, override: Record<string, unknown> = {}) => ({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-14T22:20:00Z",
  [option.key]: { collectionEnabled: true, noticeVersion: option.notice, expiresAt: "2026-11-14T22:20:00Z", ...override } } });
function api(option: Option, post: (init: RequestInit) => unknown = () => reply({ request: { id } }), window: () => unknown = () => access(option), defaults: () => unknown = () => ({ zip: null })) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return reply(window());
    if (url.endsWith("/account")) return reply({ account: { email: "fixture@example.invalid", preferences: { language: "en", contactPreference: "in_app" } } });
    if (url.endsWith("/intake-defaults")) return reply(defaults());
    if (url.endsWith("/requests") && init?.method === "POST") return post(init);
    return reply({ capabilities: [] });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function routing(option: Option, savedZip = false) {
  await screen.findByLabelText("Household ZIP code");
  if (!savedZip) fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
  fireEvent.click(screen.getByRole("checkbox", { name: option.provider }));
  fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: "self" } });
  fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
}
async function details(option: Option, savedZip = false) {
  await routing(option, savedZip); fireEvent.click(screen.getByLabelText(option.optIn));
  await screen.findByLabelText(option.privateLabel);
  fireEvent.change(screen.getByLabelText(option.privateLabel), { target: { value: "UtilityPrivateCanary" } });
  if (option.need === "gas") {
    fireEvent.change(screen.getByLabelText("PGW account number"), { target: { value: "FICT/PGW.01" } });
    fireEvent.change(screen.getByLabelText("PGW service ZIP code"), { target: { value: "19147" } });
  } else fireEvent.change(screen.getByLabelText("Water property address"), { target: { value: "100 Synthetic Lane, Philadelphia PA 19147" } });
}
async function permission(option: Option, savedZip = false) {
  await details(option, savedZip); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Start getting support" }); fireEvent.click(screen.getByRole("checkbox", { name: /I authorize/ }));
}
const posts = (fetcher: ReturnType<typeof api>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); navigation.push.mockClear(); navigation.refresh.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe.each(options)("explicit $label preparation", option => {
  it("keeps ordinary utility routing separate from an optional private application", async () => {
    const fetcher = api(option); render(<ParentIntake initialNeed={option.need}/>); await routing(option);
    expect(screen.queryByLabelText(option.privateLabel)).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /I authorize/ })); fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const body = JSON.parse(String(posts(fetcher)[0][1]!.body)); expect(body.kind).toBeUndefined(); expect(body.details).toBeUndefined();
    expect(body.intake.needs).toEqual([option.need]);
  });
  it("uses one named mandate for a partial private draft and explicit document scope, with no guessed journey or unrelated fields", async () => {
    const fetcher = api(option); render(<ParentIntake initialNeed={option.need}/>); await permission(option);
    const consent = screen.getByRole("checkbox", { name: /I authorize/ }).closest("label")!.textContent;
    expect(screen.getAllByRole("checkbox")).toHaveLength(1); expect(consent).toContain(option.subject); expect(consent).toContain(option.account);
    expect(consent).toContain("household, income, utility and document use"); expect(consent).toContain("each protected document needs its separate processing consent");
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" })); await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${id}`));
    const body = JSON.parse(String(posts(fetcher)[0][1]!.body));
    expect(body).toMatchObject({ kind: option.kind, noticeVersion: option.notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true,
      intake: { needs: [option.need], householdSize: null, incomeAmount: null, incomeFrequency: "unknown", pregnantOrPostpartum: null, childrenUnderFive: null },
      mandate: { mode: "prepare_only", recipientIds: [option.program], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"] } });
    expect(body.details.journey).toBeUndefined(); expect(body.details.currentCrpState).toBeUndefined(); expect(body.details.existingApplication).toBeUndefined();
    expect(JSON.stringify(body.intake)).not.toMatch(/UtilityPrivateCanary|19147|FICT\/PGW/);
    expect(screen.queryByText(/Any bills or notices you later/)).toBeNull();
  });
  it.each([{}, { collectionEnabled: false }, { noticeVersion: "wrong-purpose" }, { expiresAt: now.toISOString() }])("captures nothing when its independent gate is unavailable: %j", async override => {
    const fetcher = api(option, undefined, () => Object.keys(override).length ? access(option, override) : {});
    render(<ParentIntake initialNeed={option.need}/>); await routing(option); fireEvent.click(screen.getByLabelText(option.optIn));
    await screen.findByText(new RegExp(`Private ${option.label} preparation is not available`)); expect(screen.queryByLabelText(option.privateLabel)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); expect(posts(fetcher)).toHaveLength(0); expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
  });
  it("requires actual account authority before private fields are shown", async () => {
    const fetcher = api(option); render(<ParentIntake initialNeed={option.need}/>); await routing(option);
    fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: "not_sure" } }); fireEvent.click(screen.getByLabelText(option.optIn));
    expect(screen.queryByLabelText(option.privateLabel)).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(posts(fetcher)).toHaveLength(0);
  });
  it("rechecks current permission before starting and keeps private answers when collection closes", async () => {
    let open = true; const fetcher = api(option, undefined, () => access(option, { collectionEnabled: open }));
    render(<ParentIntake initialNeed={option.need}/>); await permission(option); open = false;
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByText(new RegExp(`Private ${option.label} collection is unavailable`)); expect(posts(fetcher)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Back" })); open = true;
    fireEvent.click(await screen.findByRole("button", { name: `Check ${option.short} preparation access again` }));
    expect((await screen.findByLabelText(option.privateLabel) as HTMLInputElement).value).toBe("UtilityPrivateCanary");
  });
  it("preserves the same private start body and key after an ambiguous denial without another mandate", async () => {
    let count = 0; const fetcher = api(option, () => ++count === 1 ? reply({ ok: false, error: "Permission unavailable" }, 403) : reply({ request: { id } }));
    render(<ParentIntake initialNeed={option.need}/>); await permission(option); fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByText(/The save result has not been confirmed/); expect(screen.getByRole("button", { name: "Back" }).matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: `Retry the same ${option.short} request` })); await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const attempts = posts(fetcher); expect(attempts).toHaveLength(2); expect(attempts[1][1]!.body).toBe(attempts[0][1]!.body); expect(attempts[1][1]!.headers).toEqual(attempts[0][1]!.headers);
  });
  it("refreshes only stale saved ZIP routing after a proven 412 without changing private answers, mandate or key", async () => {
    let count = 0, defaultsRead = 0;
    const zip = { value: "19104", sourceRequestId: sourceId, sourceVersion: 1, confirmedAt: "2026-11-10T22:20:00Z", expiresAt: "2026-11-17T22:20:00Z" };
    const fetcher = api(option, () => ++count === 1 ? reply({ ok: false, error: "Saved routing information changed before this request was created." }, 412) : reply({ request: { id } }), undefined,
      () => ({ zip: ++defaultsRead === 1 ? zip : { ...zip, value: "19103", sourceVersion: 2 } }));
    render(<ParentIntake initialNeed={option.need}/>); await screen.findByText(/We filled your ZIP code/); await permission(option, true);
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" })); await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const attempts = posts(fetcher), first = JSON.parse(String(attempts[0][1]!.body)), second = JSON.parse(String(attempts[1][1]!.body));
    expect(second.details).toEqual(first.details); expect(second.mandate).toEqual(first.mandate); expect(second.intake.zip).toBe("19103"); expect(second.reusedZip).toEqual({ sourceRequestId: sourceId, sourceVersion: 2 });
    expect(attempts[1][1]!.headers).toEqual(attempts[0][1]!.headers);
  });
  it("closes private fields at the actual source ceiling and preserves the draft instead of sending an ordinary request", async () => {
    const fetcher = api(option); render(<ParentIntake initialNeed={option.need}/>); await details(option);
    act(() => { vi.setSystemTime("2026-11-20T23:00:00Z"); window.dispatchEvent(new Event("focus")); });
    await screen.findByText(new RegExp(`Private ${option.label} preparation is not available`)); expect(screen.queryByLabelText(option.privateLabel)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); expect(posts(fetcher)).toHaveLength(0);
  });
  it("ignores a late private start response after unmount", async () => {
    let finish!: (value: unknown) => void; api(option, () => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<ParentIntake initialNeed={option.need}/>); await permission(option); fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(finish).toBeTypeOf("function")); unmount(); await act(async () => finish(reply({ request: { id } })));
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it("does not expose this private program for combined utility needs", async () => {
    api(option); render(<ParentIntake initialNeed="utilities"/>); fireEvent.click(await screen.findByRole("checkbox", { name: /Gas bill/ })); fireEvent.click(screen.getByRole("checkbox", { name: /Water bill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); await screen.findByLabelText("Household ZIP code"); expect(screen.queryByLabelText(option.optIn)).toBeNull(); expect(screen.queryByLabelText(option.privateLabel)).toBeNull();
  });
  it("keeps the grouped private intake accessible", async () => {
    api(option); const { container } = render(<main><ParentIntake initialNeed={option.need}/></main>); await details(option);
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(item => item.id)).toEqual([]);
  });
});
it("preserves existing fields-only mandate callers and adds protected documents only when explicitly requested", () => {
  const intake = fixtureIntake({ needs: ["electricity"] });
  expect(buildMandate(intake, ["peco-cap"], "prepare_only", "ask_me", "2026-11-14T22:20:00Z", true).allowedData).toEqual(["household", "income", "utility"]);
  expect(buildMandate(intake, ["peco-cap"], "prepare_only", "ask_me", "2026-11-14T22:20:00Z", true, true).allowedData).toEqual(["household", "income", "utility", "documents"]);
});
