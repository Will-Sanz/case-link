// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentIntake } from "./intake";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const sourceId = "22222222-2222-4222-8222-222222222222";
const requestId = "11111111-1111-4111-8111-111111111111";
const savedZip = () => ({ sourceRequestId: sourceId, sourceVersion: 1, value: "19104", confirmedAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
function api(defaults: () => unknown | Promise<unknown>, post?: (input: RequestInit) => unknown) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/intake-defaults")) return reply({ zip: await defaults() });
    if (url.endsWith("/account")) return reply({ account: { email: "synthetic@example.invalid", preferences: { language: "en", contactPreference: "in_app" } } });
    if (url.endsWith("/authorization-window")) return reply({ authorization: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() } });
    if (url.endsWith("/requests") && init?.method === "POST") return post ? post(init) : reply({ request: { id: requestId } });
    return reply({ capabilities: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function authorize() {
  fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /I authorize/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start getting support" }));
}
describe("ordinary saved routing intake", () => {
  it("fills the ZIP automatically and starts with only a source reference, without another approval step", async () => {
    const fetcher = api(savedZip);
    render(<ParentIntake initialNeed="food_now" />);
    await waitFor(() => expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104"));
    expect(screen.getByText(/We filled your ZIP code/)).toBeTruthy();
    await authorize();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    const call = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
    const body = JSON.parse(String(call[1]!.body));
    expect(body.reusedZip).toEqual({ sourceRequestId: sourceId, sourceVersion: 1 });
    expect(body.intake.zip).toBe("19104");
    expect(body).not.toHaveProperty("confirmedAt");
    expect(body.intake.incomeAmount).toBeNull();
  });
  it("does not overwrite a manually entered or cleared ZIP when the saved source arrives late", async () => {
    let resolve!: (value: unknown) => void;
    api(() => new Promise(done => { resolve = done; }));
    render(<ParentIntake initialNeed="food_now" />);
    const field = await screen.findByLabelText("Household ZIP code");
    fireEvent.change(field, { target: { value: "19103" } });
    fireEvent.change(field, { target: { value: "" } });
    await act(async () => { resolve(savedZip()); });
    expect((field as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/We filled your ZIP code/)).toBeNull();
  });
  it.each([null, { ...savedZip(), expiresAt: "2020-01-01T00:00:00Z" }])("keeps a manual alternative for absent or expired saved information", async value => {
    api(() => value);
    render(<ParentIntake initialNeed="food_now" />);
    const field = await screen.findByLabelText("Household ZIP code");
    expect((field as HTMLInputElement).value).toBe("");
    fireEvent.change(field, { target: { value: "19103" } });
    expect((field as HTMLInputElement).value).toBe("19103");
  });
  it("refreshes one changed source and retries automatically with the same start key and authorization", async () => {
    let reads = 0, attempts = 0;
    const posts: RequestInit[] = [];
    api(() => ({ ...savedZip(), sourceVersion: ++reads, value: reads === 1 ? "19104" : "19103" }), input => {
      posts.push(input);
      return ++attempts === 1 ? reply({ ok: false, error: "Saved routing information changed before this request was created." }, 412) : reply({ request: { id: requestId } });
    });
    render(<ParentIntake initialNeed="food_now" />);
    await waitFor(() => expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104"));
    await authorize();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(`/support/${requestId}`));
    expect(posts).toHaveLength(2);
    expect(posts[0].headers).toEqual(posts[1].headers);
    const first = JSON.parse(String(posts[0].body)), second = JSON.parse(String(posts[1].body));
    expect(second.mandate).toEqual(first.mandate);
    expect(second.intake.zip).toBe("19103");
    expect(second.reusedZip.sourceVersion).toBe(2);
  });
  it("does not rebase or send a second request when delivery of the creation response is unknown", async () => {
    const fetcher = api(savedZip, () => { throw new Error("network unavailable"); });
    render(<ParentIntake initialNeed="food_now" />);
    await waitFor(() => expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104"));
    await authorize();
    await screen.findByText(/The save result has not been confirmed/);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it("does not refill a withdrawn ZIP from cached defaults after a proved failed start", async () => {
    let reads = 0;
    const fetcher = api(() => ++reads === 1 ? savedZip() : null,
      () => reply({ ok: false, error: "Saved routing information changed before this request was created." }, 412));
    render(<ParentIntake initialNeed="food_now" />);
    await waitFor(() => expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104"));
    await authorize();
    await screen.findByText(/A current household ZIP code is needed/);
    await act(async () => {});
    expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/We filled your ZIP code/)).toBeNull();
    expect(screen.queryByText(/The save result has not been confirmed/)).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
