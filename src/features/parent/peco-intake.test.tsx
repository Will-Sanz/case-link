// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { ParentIntake } from "./intake";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_SUBJECT_AUTHORITY_STATEMENT, PECO_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/peco-application-fields";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const now = new Date("2026-11-13T20:10:00Z"), requestId = "11111111-1111-4111-8111-111111111111";
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const access = (enabled = true) => ({ authorization: { issuedAt: now.toISOString(), expiresAt: "2026-11-14T20:00:00Z",
  pecoApplication: { collectionEnabled: enabled, noticeVersion: enabled ? PECO_APPLICATION_NOTICE_VERSION : null, expiresAt: enabled ? "2026-11-14T20:00:00Z" : null } } });
function api(post: (init: RequestInit) => unknown = () => reply({ request: { id: requestId } }), gate: unknown = access()) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/authorization-window")) return reply(gate);
    if (url.endsWith("/account")) return reply({ account: { email: "fixture@example.test", preferences: { language: "en", contactPreference: "in_app" } } });
    if (url.endsWith("/intake-defaults")) return reply({ zip: null });
    if (url.endsWith("/requests") && init?.method === "POST") return post(init);
    return reply({ capabilities: [] });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function routing() {
  await screen.findByLabelText("Household ZIP code");
  fireEvent.change(screen.getByLabelText("Household ZIP code"), { target: { value: "19104" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "PECO" }));
  fireEvent.change(screen.getByLabelText("Your authority for the selected utility accounts"), { target: { value: "self" } });
  fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
}
async function permission() {
  await routing(); fireEvent.click(screen.getByLabelText(/Prepare PECO CAP help for this electricity account/));
  await screen.findByLabelText("Applicant first name");
  fireEvent.change(screen.getByLabelText("Applicant first name"), { target: { value: "PecoPrivateCanary" } });
  fireEvent.change(screen.getByLabelText("PECO account number"), { target: { value: "1234567890" } });
  fireEvent.change(screen.getByLabelText("PECO service ZIP code"), { target: { value: "19147" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Start getting support" });
  fireEvent.click(screen.getByRole("checkbox", { name: /I authorize/ }));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); navigation.push.mockClear(); navigation.refresh.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("explicit PECO CAP family preparation", () => {
  it("keeps generic PECO electricity routing separate from private CAP preparation", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="electricity"/>); await routing();
    expect(screen.queryByLabelText("PECO account number")).toBeNull();
    expect(screen.queryByLabelText("Applicant first name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /I authorize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.kind).toBeUndefined(); expect(body.details).toBeUndefined();
    expect(body.mandate.recipientIds).toContain("uesf-utilities");
    expect(body.mandate.allowedData).toContain("documents");
  });
  it("saves a partial separate CAP request through one named mandate and both exact declarations", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="electricity"/>); await permission();
    const authority = screen.getByRole("checkbox", { name: /I authorize/ }).closest("label")!.textContent;
    expect(authority).toContain(PECO_SUBJECT_AUTHORITY_STATEMENT); expect(authority).toContain(PECO_ACCOUNT_AUTHORITY_STATEMENT);
    expect(authority).toContain("PECO CAP"); expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/is the named program for your private CAP preparation/).textContent).toContain("PECO CAP");
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body).toMatchObject({ kind: "peco_application", noticeVersion: PECO_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true,
      details: { accountNumber: "1234567890", applicant: { firstName: "PecoPrivateCanary", id: expect.any(String) }, address: { zip: "19147" } },
      intake: { needs: ["electricity"], utilityProviders: ["peco"], accountAuthority: "self", zip: "19104", householdSize: null, incomeAmount: null, incomeFrequency: "unknown", pregnantOrPostpartum: null, childrenUnderFive: null } });
    expect(body.details.journey).toBeUndefined(); expect(body.details.currentCapState).toBeUndefined();
    expect(JSON.stringify(body.intake)).not.toMatch(/PecoPrivateCanary|1234567890|19147/);
    expect(body.mandate.mode).toBe("prepare_only"); expect(body.mandate.recipientIds).toEqual(["peco-cap"]);
    expect(body.mandate.allowedData).toEqual(["household", "income", "utility"]);
    expect(screen.queryByText(/Any bills or notices you later/)).toBeNull();
  });
  it("preserves an ordinary urgent shutoff date alongside private preparation", async () => {
    const fetcher = api(); render(<ParentIntake initialNeed="utilities"/>);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Electric bill/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Today/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await routing();
    fireEvent.change(screen.getByLabelText("Shutoff date, if on a notice"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByLabelText(/Prepare PECO CAP help for this electricity account/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /I authorize/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(body.intake).toMatchObject({ urgency: "today", shutoffDate: "2026-11-15" });
    expect(body.details.shutoffDate).toBeUndefined();
  });
  it.each([access(false), {}, { authorization: { ...access().authorization, pecoApplication: { collectionEnabled: true, noticeVersion: "wrong", expiresAt: "2026-11-14T20:00:00Z" } } }])("captures no private CAP input without its current independent purpose gate", async gate => {
    api(undefined, gate); render(<ParentIntake initialNeed="electricity"/>); await routing();
    fireEvent.click(screen.getByLabelText(/Prepare PECO CAP help for this electricity account/));
    await screen.findByText(/Private PECO CAP preparation is not available/);
    expect(screen.queryByLabelText("PECO account number")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Private PECO CAP preparation is unavailable/);
    expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
  });
  it("does not expose a private CAP scope for combined utility needs", async () => {
    api(); render(<ParentIntake initialNeed="utilities"/>);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Electric bill/ })); fireEvent.click(screen.getByRole("checkbox", { name: /Gas bill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Household ZIP code");
    expect(screen.queryByLabelText(/Prepare PECO CAP help/)).toBeNull(); expect(screen.queryByLabelText("Applicant first name")).toBeNull();
    expect(screen.queryByLabelText("Shutoff date, if on a notice")).toBeNull();
  });
  it("preserves the exact start after an ambiguous denial and reconciles it without a second mandate", async () => {
    let count = 0; const fetcher = api(() => ++count === 1 ? reply({ ok: false, error: "This support request is unavailable, or its permission has changed." }, 403) : reply({ request: { id: requestId } }));
    render(<ParentIntake initialNeed="electricity"/>); await permission();
    fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
    await screen.findByText(/The save result has not been confirmed/);
    expect(screen.getByRole("button", { name: "Back" }).matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry the same PECO request" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[1][1]?.headers).toEqual(posts[0][1]?.headers); expect(posts[1][1]?.body).toBe(posts[0][1]?.body);
  });
  it("closes inputs at the PECO deadline and preserves the pending draft without an ordinary-routing fallback", async () => {
    const gate = access(); gate.authorization.pecoApplication.expiresAt = "2026-11-13T20:11:00Z";
    api(undefined, gate); render(<ParentIntake initialNeed="electricity"/>); await routing();
    fireEvent.click(screen.getByLabelText(/Prepare PECO CAP help for this electricity account/));
    fireEvent.change(screen.getByLabelText("Applicant first name"), { target: { value: "DraftCanary" } });
    act(() => { vi.setSystemTime("2026-11-13T20:12:00Z"); window.dispatchEvent(new Event("focus")); });
    await screen.findByText(/Private PECO CAP preparation is not available/);
    expect(screen.queryByLabelText("Applicant first name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" })); await screen.findByText(/Private PECO CAP preparation is unavailable/);
    expect(screen.queryByRole("checkbox", { name: /I authorize/ })).toBeNull();
  });
  it("keeps grouped routing and private input labels accessible", async () => {
    api(); const { container } = render(<main><ParentIntake initialNeed="electricity"/></main>); await routing();
    fireEvent.click(screen.getByLabelText(/Prepare PECO CAP help for this electricity account/));
    await screen.findByLabelText("Applicant first name");
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(finding => finding.id)).toEqual([]);
  });
});
