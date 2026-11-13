// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentIntake, buildMandate } from "./intake";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { fixtureIntake } from "@/lib/parent/test-fixtures";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const now = new Date("2026-11-13T20:00:00Z");
const requestId = "11111111-1111-4111-8111-111111111111";
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const window = (enabled = true) => ({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-14T20:00:00Z",
  wicApplication: { collectionEnabled: enabled, noticeVersion: enabled ? WIC_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? "2026-11-14T20:00:00Z" : null } } });
function api(post: (init: RequestInit) => unknown = () => reply({ request: { id: requestId } }), gate: unknown = window()) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return reply(gate);
    if (url.endsWith("/account")) return reply({ account: { email: "fixture@example.test", preferences: { language: "en", contactPreference: "in_app" } } });
    if (url.endsWith("/intake-defaults")) return reply({ zip: null });
    if (url.endsWith("/requests") && init?.method === "POST") return post(init);
    return reply({ capabilities: [] });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function permission() {
  await screen.findByLabelText("Contact first name");
  fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
  fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "WicPrivateCanary" } });
  fireEvent.change(screen.getByLabelText("Contact postal ZIP code"), { target: { value: "19147" } });
  fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Start getting support" });
  fireEvent.click(screen.getByRole("checkbox", { name: /I authorize/ }));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); navigation.push.mockClear(); navigation.refresh.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("gated WIC family intake", () => {
  it("saves partial private WIC answers from one genuine mandate with no unrelated income or inferred postal ZIP", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="wic_new"/>);
    await screen.findByLabelText("Contact first name");
    expect((screen.getByLabelText("Contact postal ZIP code") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("People in your household")).toBeNull();
    expect(screen.queryByLabelText(/Household income before taxes/)).toBeNull();
    await permission();
    expect(screen.getByRole("checkbox", { name: /I authorize/ }).closest("label")?.textContent).toContain(WIC_SUBJECT_AUTHORITY_STATEMENT);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/is the named program for your prepared WIC answers/).textContent).toContain("Pennsylvania WIC");
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!;
    const body = JSON.parse(String(post.body));
    expect(body).toMatchObject({ kind: "wic_application", noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true,
      details: { contact: { firstName: "WicPrivateCanary", zip: "19147" } },
      intake: { zip: "19104", householdSize: null, incomeAmount: null, incomeFrequency: "unknown", utilityProviders: [], accountAuthority: "self", pregnantOrPostpartum: null, childrenUnderFive: null } });
    expect(body.mandate.recipientIds).toEqual(["wic-pa"]); expect(body.mandate.allowedData).toEqual(["household"]);
    expect(screen.queryByText(/Any bills or notices you later/)).toBeNull();
  });
  it.each([window(false), {}, { authorization: { ...window().authorization, wicApplication: { collectionEnabled: true, noticeVersion: "wrong", expiresAt: "2026-11-14T20:00:00Z" } } }])("captures no private input without a current independent WIC gate", async gate => {
    api(undefined, gate); render(<ParentIntake initialNeed="wic_new"/>);
    await screen.findByText(/Private WIC questions are not available/);
    expect(screen.queryByLabelText("Contact first name")).toBeNull(); expect(screen.queryByLabelText(/Household income/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open official WIC help" }).getAttribute("href")).toContain("pre-application");
  });
  it("preserves the exact start key/body after an ambiguous 403 and retries it only after WIC access returns", async () => {
    let count = 0; const fetcher = api(() => ++count === 1 ? reply({ ok: false, error: "This support request is unavailable, or its permission has changed." }, 403) : reply({ request: { id: requestId } }));
    render(<ParentIntake initialNeed="wic_new"/>); await permission();
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByText(/The save result has not been confirmed/);
    expect(screen.getByRole("button", { name: "Back" }).matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry the same WIC request" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers); expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  });
  it("closes fields at the recorded WIC deadline without losing the draft", async () => {
    const gate = window(); gate.authorization.wicApplication.expiresAt = "2026-11-13T20:01:00Z";
    api(undefined, gate); render(<ParentIntake initialNeed="wic_new"/>);
    await screen.findByLabelText("Contact first name");
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "DraftCanary" } });
    fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    act(() => { vi.setSystemTime("2026-11-13T20:02:00Z"); globalThis.window.dispatchEvent(new Event("focus")); });
    await screen.findByText(/Private WIC questions are not available/); expect(screen.queryByLabelText("Contact first name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Private WIC collection is unavailable/); expect(screen.queryByRole("heading", { name: "Your permission" })).toBeNull();
  });
  it("keeps continuing WIC separate and never grants WIC-only income processing", async () => {
    api(); render(<ParentIntake initialNeed="wic_continuing"/>);
    await screen.findByText(/Private WIC questions are not available/); expect(screen.queryByLabelText("Contact first name")).toBeNull();
    expect(buildMandate(fixtureIntake({ needs: ["wic_new"] }), ["wic-pa"], "prepare_only", "ask_me", "2026-11-14T20:00:00Z").allowedData).not.toContain("income");
    expect(buildMandate(fixtureIntake({ needs: ["wic_continuing"] }), ["wic-pa"], "prepare_only", "ask_me", "2026-11-14T20:00:00Z").allowedData).not.toContain("documents");
    expect(buildMandate(fixtureIntake({ needs: ["wic_new", "electricity"] }), ["wic-pa", "peco-cap"], "prepare_only", "ask_me", "2026-11-14T20:00:00Z").allowedData).toContain("documents");
    expect(buildMandate(fixtureIntake({ needs: ["electricity"] }), ["peco-cap"], "prepare_only", "ask_me", "2026-11-14T20:00:00Z").allowedData).toContain("income");
  });
});
