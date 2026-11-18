// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindFoodAccessReport, buildFoodAccessPlanBody, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM, type FoodAccessPlan, type FoodAccessReport } from "@/lib/parent/food-access";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "@/lib/parent/test-fixtures";
import { FoodAccess, FoodAccessReportSummary } from "./food-access";

const now = new Date("2026-11-18T12:00:00Z"), reportAt = "2026-11-18T12:05:00Z";
const request = () => fixtureRequest({ version: 2, created_at: now.toISOString(), updated_at: now.toISOString(),
  intake: fixtureIntake({ needs: ["food_now", "snap_new"], zip: "19129", householdSize: null, incomeAmount: null }),
  mandate: fixtureMandate({ mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household"],
    recipientIds: [SHARE_FOOD_ACCESS_PROGRAM, "snap-pa"], expiresAt: "2026-11-25T12:00:00Z" }) });
function plan(current = request(), override: Partial<Parameters<typeof buildFoodAccessPlanBody>[0]> = {}): FoodAccessPlan {
  const body = buildFoodAccessPlanBody({ requestId: current.id, requestVersion: current.version, generatedAt: now.toISOString(), sourceReviewCurrent: true, ...override });
  return { ...body, planHash: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}
function recorded(source: FoodAccessPlan, body: string): FoodAccessReport {
  const { action: _, ...input } = JSON.parse(body); void _;
  return bindFoodAccessReport(source, input, { eventId: "22222222-2222-4222-8222-222222222222", reportedAt: reportAt });
}
function response(value: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => value }; }
function select(result = "no_food") { fireEvent.change(screen.getByLabelText("Did this food option work for you?"), { target: { value: result } }); }
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Save food report" }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("saved public food access plan and report", () => {
  it.each(["active", "closed"] as const)("allows an intentional correction while %s without a routine confirmation or silent restart", async status => {
    const original=request(), source=plan(original), current={ ...original,status,...(status === "closed" ? { version:original.version+1,closed_reason:"completed" } : {}) };
    const positive=recorded(source,JSON.stringify({ expectedVersion:original.version,siteId:source.site.id,planHash:source.planHash,reportKey:"22222222-2222-4222-8222-222222222222",result:"received_enough_food" }));
    const fetch=vi.fn(async (_url:string, init:RequestInit)=>{ const { action:_,...input }=JSON.parse(String(init.body)); void _;
      return response({ ok:true,report:foodAccessReportSchema.parse({ ...positive,...input,eventId:"33333333-3333-4333-8333-333333333333",reportedAt:"2026-11-18T12:06:00Z",outcome:"unresolved" }) }); });
    vi.stubGlobal("fetch",fetch);render(<FoodAccess request={current} plan={source} report={positive} onChange={vi.fn()}/>);
    expect(screen.queryByLabelText("Did this food option work for you?")).toBeNull();
    fireEvent.click(screen.getByRole("button",{ name:"Correct this food report" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Did this food option work for you?"));
    select("no_food");submit();await screen.findByRole("heading",{ name:"Your food need remains open" });
    expect(screen.getByRole("status").textContent).toContain("Your food report is saved");
    expect(fetch).toHaveBeenCalledOnce();expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({ expectedVersion:current.version,result:"no_food" });
    if(status === "closed") expect(screen.getByText(/This request stays closed and no work has restarted/)).toBeTruthy();
  });
  it("shows dated source guidance and unknown stock without a routine confirmation or any mount-time write", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<FoodAccess request={request()} plan={plan()} onChange={vi.fn()} />);
    expect(screen.getByText("2901 W Hunting Park Ave, Philadelphia, PA 19129")).toBeTruthy();
    expect(screen.getByText(/Stock is unknown and nothing is reserved/)).toBeTruthy();
    expect(screen.getByText(/Share guidance reviewed Nov 17, 2026/)).toBeTruthy();
    expect((screen.getByLabelText("Did this food option work for you?") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("saves one site-bound report, announces the retained unmet need and reloads existing work", async () => {
    const source = plan(), changed = vi.fn();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => response({ ok: true, report: recorded(source, String(init.body)) }));
    vi.stubGlobal("fetch", fetch); render(<FoodAccess request={request()} plan={source} onChange={changed} />);
    select(); const button = screen.getByRole("button", { name: "Save food report" }); fireEvent.click(button); fireEvent.click(button);
    await screen.findByRole("heading", { name: "Your food need remains open" });
    expect(screen.getByText(/Food access report: There was no food available/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See direct support options" }).getAttribute("href")).toBe("/support/help");
    expect(fetch).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(Object.keys(body).sort()).toEqual(["action", "expectedVersion", "planHash", "reportKey", "result", "siteId"]);
    expect(body).toMatchObject({ action: "food_visit", expectedVersion: 2, planHash: source.planHash, siteId: source.site.id, result: "no_food" });
    expect(fetch.mock.calls[0][0]).toBe(`/api/parent/requests/${request().id}/outcome`);
  });
  it("retains the exact unknown attempt across polling and a new plan, then retries the same body", async () => {
    const current = request(), source = plan(), changed = vi.fn();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_url: string, init: RequestInit) => response({ ok: true, report: recorded(source, String(init.body)) }));
    vi.stubGlobal("fetch", fetch);
    const view = render(<FoodAccess request={current} plan={source} onChange={changed} />);
    select(); submit(); await screen.findByRole("button", { name: "Retry same report" });
    const original = fetch.mock.calls[0][1].body;
    view.rerender(<FoodAccess request={{ ...current, updated_at: reportAt }} plan={plan(current, { generatedAt: "2026-11-18T12:01:00Z" })} onChange={changed} />);
    expect((screen.getByLabelText("Did this food option work for you?") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry same report" }));
    await screen.findByRole("heading", { name: "Your food need remains open" });
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].body).toBe(original);
  });
  it("reconciles a lost acknowledgement from the saved event without another POST", async () => {
    const current = request(), source = plan(), changed = vi.fn();
    const fetch = vi.fn().mockResolvedValue(response({ ok: true, report: {} })); vi.stubGlobal("fetch", fetch);
    const view = render(<FoodAccess request={current} plan={source} onChange={changed} />);
    select("received_enough_food"); submit(); await screen.findByRole("button", { name: "Retry same report" });
    const saved = recorded(source, String(fetch.mock.calls[0][1].body));
    view.rerender(<FoodAccess request={{ ...current, events: [{ id: saved.eventId, request_id: current.id, kind: "parent.outcome_reported", actor: "parent",
      summary: "You reported a food visit.", created_at: reportAt, evidence: { foodAccessReport: saved } }] }} plan={source} onChange={changed} />);
    await screen.findByRole("heading", { name: "Your food report is recorded" });
    expect(screen.queryByRole("button", { name: "Retry same report" })).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Other support requests keep their own progress/)).toBeTruthy();
  });
  it.each(["expectedVersion", "planHash", "result"] as const)("does not reconcile an event that shares a key but changes %s", async field => {
    const current = request(), source = plan(), fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch);
    const view = render(<FoodAccess request={current} plan={source} onChange={vi.fn()} />);
    select(); submit(); await screen.findByRole("button", { name: "Retry same report" });
    const saved = recorded(source, String(fetch.mock.calls[0][1].body));
    const changed = { ...saved, [field]: field === "expectedVersion" ? 1 : field === "planHash" ? "f".repeat(64) : "could_not_access" };
    view.rerender(<FoodAccess request={current} plan={source} report={changed} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Retry same report" })).toBeTruthy();
    expect((screen.getByLabelText("Did this food option work for you?") as HTMLSelectElement).disabled).toBe(true);
  });
  it("permits only an exact retry after a pause, without enabling a new report", async () => {
    const current = request(), source = plan(), fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (_url: string, init: RequestInit) => response({ ok: true, report: recorded(source, String(init.body)) }));
    vi.stubGlobal("fetch", fetch); const view = render(<FoodAccess request={current} plan={source} onChange={vi.fn()} />);
    select(); submit(); await screen.findByRole("button", { name: "Retry same report" });
    view.rerender(<FoodAccess request={{ ...current, status: "paused" }} plan={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry same report" }));
    await screen.findByRole("heading", { name: "Your food need remains open" });
    expect((screen.getByRole("button", { name: "Save food report" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it.each(["paused", "cancelled", "expired", "program", "prepare", "household", "stale_plan", "read_error"])("keeps new reporting closed for %s", kind => {
    const current = request(), source = plan(); let readError: Error | undefined;
    if (kind === "paused" || kind === "cancelled") current.status = kind;
    if (kind === "expired") current.mandate.expiresAt = "2026-11-18T11:00:00Z";
    if (kind === "program") current.mandate.recipientIds = ["philly-food"];
    if (kind === "prepare") current.mandate.allowedActions = ["research"];
    if (kind === "household") current.mandate.allowedData = ["income"];
    if (kind === "stale_plan") current.version++;
    if (kind === "read_error") readError = new Error("Latest check unavailable");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<FoodAccess request={current} plan={source} onChange={vi.fn()} readError={readError} />);
    expect((screen.getByLabelText("Did this food option work for you?") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save food report" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("suppresses conflicting walk-up instructions while allowing a current request to ask for another way", async () => {
    const source = plan(request(), { cityObservation: { recordId: 122, checkedAt: now.toISOString(), state: "closed" } });
    const fetch = vi.fn(async (_url: string, init: RequestInit) => response({ ok: true, report: recorded(source, String(init.body)) })); vi.stubGlobal("fetch", fetch);
    render(<FoodAccess request={request()} plan={source} onChange={vi.fn()} />);
    expect(screen.queryByText(/24-hour access/)).toBeNull(); select("need_another_way"); submit();
    await screen.findByRole("heading", { name: "Your food need remains open" });
    expect(screen.getByText(/Food access report: I need another way/)).toBeTruthy();
  });
  it.each([400, 409, 412])("reloads after a definitive %s transaction rejection and allows a fresh corrected report", async status => {
    const changed = vi.fn(), fetch = vi.fn().mockResolvedValue(response({ ok: false, error: "Check the current plan." }, status)); vi.stubGlobal("fetch", fetch);
    render(<FoodAccess request={request()} plan={plan()} onChange={changed} />);
    select(); submit(); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Retry same report" })).toBeNull();
    expect((screen.getByLabelText("Did this food option work for you?") as HTMLSelectElement).disabled).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("displays an earlier validated site report after a regenerated plan, without claiming a program receipt", () => {
    const source = plan(), saved = recorded(source, JSON.stringify({ action: "food_visit", expectedVersion: 2, siteId: source.site.id, planHash: source.planHash,
      reportKey: "33333333-3333-4333-8333-333333333333", result: "some_food_still_needed" }));
    render(<FoodAccess request={request()} plan={plan(request(), { generatedAt: "2026-11-18T12:06:00Z" })} report={saved} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your food need remains open" })).toBeTruthy();
    expect(screen.getByText(/Share has not confirmed it/)).toBeTruthy();
    expect(screen.queryByText(/24-hour access/)).toBeNull();
  });
  it("does not display another household's report or malformed provider attribution", () => {
    const source = plan(), saved = recorded(source, JSON.stringify({ action: "food_visit", expectedVersion: 2, siteId: source.site.id, planHash: source.planHash,
      reportKey: "33333333-3333-4333-8333-333333333333", result: "no_food" }));
    render(<><FoodAccessReportSummary requestId={request().id} report={{ ...saved, requestId: "44444444-4444-4444-8444-444444444444" }} />
      <FoodAccessReportSummary requestId={request().id} report={{ ...saved, attribution: "provider_api" }} /></>);
    expect(screen.queryByText(/Food access report/)).toBeNull();
  });
});
