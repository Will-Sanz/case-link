// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureProtectedSnapOperation, fixtureRequest } from "@/lib/parent/test-fixtures";
import type { SupportRequest } from "@/lib/parent/domain";
import { fixtureUtilityProtectedOperation } from "@/lib/parent/utility-preparation-test-fixtures";
import { SupportActivity, SnapDraftReview, currentSnapDraft, currentSnapReview, type RecordedOperation } from "./support-activity";
import { buildFoodAccessPlanBody, SHARE_FOOD_ACCESS_PROGRAM } from "@/lib/parent/food-access";

const reviewPdf = vi.hoisted(() => vi.fn());
vi.mock("./snap-review-pdf", () => ({ SnapReviewPdf: (props: unknown) => { reviewPdf(props); return <div role="region" aria-label="Exact draft preview"/>; } }));
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-06T22:00:00Z")); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([false,true])("asks the typed food question once while preserving the generic sibling form: combined=%s",combined=>{
  const request=fixtureRequest();request.intake.needs=combined ? ["food_now","snap_new"] : ["food_now"];
  request.mandate.recipientIds=[SHARE_FOOD_ACCESS_PROGRAM,...(combined ? ["snap-pa"] : [])];
  const body=buildFoodAccessPlanBody({ requestId:request.id,requestVersion:request.version,generatedAt:"2026-11-18T12:00:00Z",sourceReviewCurrent:true });
  request.plan={ version:1,summary:"Public food plan",generatedAt:body.generatedAt,model:null,routes:[{ need:"food_now",programId:SHARE_FOOD_ACCESS_PROGRAM,title:"Share",summary:"Prepared",state:"prepared",nextActor:"parent",officialUrl:body.source.operatorUrl,sourceUrl:body.source.operatorUrl,steps:[],limitation:null,foodAccess:{ ...body,planHash:"a".repeat(64) } }] };
  render(<SupportActivity request={request} onChange={vi.fn()} history={{ data:{ operations:[],historyLimited:false },loading:false,error:null,reload:vi.fn() }}/>);
  if(!combined) expect(screen.queryByText("Tell us about an outcome")).toBeNull();
  else expect(Array.from((screen.getByLabelText("Which support?") as HTMLSelectElement).options).map(option=>option.value)).toEqual(["snap_new"]);
});
it.each([
  { zip:"19129",withCity:true,typed:true },
  { zip:"19104",withCity:false,typed:true },
  { zip:"19104",withCity:true,typed:false },
])("keeps the generic question aligned with the selected public path before a first plan: %j",({ zip,withCity,typed })=>{
  const request=fixtureRequest();request.intake.needs=["food_now"];request.intake.zip=zip;
  request.mandate.recipientIds=[SHARE_FOOD_ACCESS_PROGRAM,...(withCity ? ["philly-food"] : [])];
  render(<SupportActivity request={request} onChange={vi.fn()} history={{ data:{ operations:[],historyLimited:false },loading:false,error:null,reload:vi.fn() }}/>);
  expect(screen.queryByText("Tell us about an outcome") === null).toBe(typed);
});
it("does not silently move an in-progress generic food report to a sibling when the typed path arrives",()=>{
  const request=fixtureRequest();request.intake.needs=["food_now","snap_new"];
  const history={ data:{ operations:[],historyLimited:false },loading:false,error:null,reload:vi.fn() };
  const view=render(<SupportActivity request={request} onChange={vi.fn()} history={history}/>);
  fireEvent.change(screen.getByLabelText("What did you receive or hear, and when?"),{ target:{ value:"My unfinished food report" } });
  const body=buildFoodAccessPlanBody({ requestId:request.id,requestVersion:request.version,generatedAt:"2026-11-18T12:00:00Z",sourceReviewCurrent:true });
  const typed={ ...request,mandate:{ ...request.mandate,recipientIds:[SHARE_FOOD_ACCESS_PROGRAM,"snap-pa"] },plan:{ version:1 as const,summary:"Food",generatedAt:body.generatedAt,model:null,routes:[{ need:"food_now" as const,programId:SHARE_FOOD_ACCESS_PROGRAM,title:"Share",summary:"Food",state:"prepared" as const,nextActor:"parent" as const,officialUrl:body.source.operatorUrl,sourceUrl:body.source.operatorUrl,steps:[],limitation:null,foodAccess:{ ...body,planHash:"a".repeat(64) } }] } };
  view.rerender(<SupportActivity request={typed} onChange={vi.fn()} history={history}/>);
  expect((screen.getByLabelText("Which support?") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("What did you receive or hear, and when?") as HTMLTextAreaElement).value).toBe("My unfinished food report");
  expect((screen.getByRole("button",{ name:"Save my report" }) as HTMLButtonElement).disabled).toBe(true);
});

describe("recorded form downloads", () => {
  it.each(["active", "paused"] as const)("keeps water LOCAL TEST and permits recorded private inspection while %s", async status => {
    vi.setSystemTime(new Date("2026-11-13T22:21:00Z"));
    const operation = fixtureUtilityProtectedOperation(), reference = operation.packet.protectedUtilityPacket;
    const request = fixtureRequest({ id: reference.requestId, version: reference.requestVersion + (status === "paused" ? 1 : 0), status });
    request.mandate.expiresAt = reference.expiresAt;
    render(<SupportActivity request={request} onChange={vi.fn()} history={{ data: { operations: [{ id: operation.operationId,
      request_id: reference.requestId, request_version: reference.requestVersion, program_id: reference.programId, need: operation.need, action: "prepare", state: status === "paused" ? "invalidated" : "prepared", artifact_id: null,
      protected_packet: reference, created_at: reference.preparedAt }], historyLimited: false }, loading: false, error: null, reload: vi.fn() }}/>);
    if (status === "active") expect(screen.getByText(/LOCAL TEST water draft · not submitted/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download LOCAL TEST water draft" }).getAttribute("href"))
      .toBe(`/protected/utilities/requests/${request.id}/prepared/${reference.packetId}?expectedVersion=${request.version}`);
    expect(screen.queryByText(/agency submitted/i)).toBeNull();
    await act(async () => { vi.setSystemTime(new Date(reference.expiresAt)); window.dispatchEvent(new Event("focus")); });
    expect(screen.queryByRole("link", { name: "Download LOCAL TEST water draft" })).toBeNull();
  });
  it("rejects malformed, unrelated and stale review metadata before using any Submit flag", () => {
    const request = fixtureRequest(), review = fixtureProtectedSnapOperation({ requestId: request.id, requestVersion: request.version, snapSubmissionAuthorized: true });
    expect(currentSnapReview(request, review)).toEqual(review);
    for (const value of [null, { ...review, snapSubmissionAuthorized: "true" }, { ...review, need: "snap_renewal" }, { ...review, programId: "philly-food" }, { ...review, requestVersion: request.version + 1 }])
      expect(currentSnapReview(request, value)).toBeNull();
  });
  const request = fixtureRequest();
  function renderOperation(operation: Partial<RecordedOperation>) {
    render(<SupportActivity request={request} onChange={vi.fn()} history={{
      data: { operations: [{
        id: "exact-operation", program_id: "snap-pa", state: "prepared",
        created_at: request.created_at, artifact_id: "exact-form", ...operation,
      }], historyLimited: false },
      loading: false, error: null, reload: vi.fn(),
    }} />);
  }
  it("labels the incomplete unsigned draft and preserves both exact download routes", () => {
    renderOperation({ form: { preparation_only: true } });
    expect(screen.getByText(/Incomplete unsigned draft · not submitted/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download incomplete unsigned draft" }).getAttribute("href"))
      .toBe(`/api/parent/requests/${request.id}/forms/exact-form`);
    expect(screen.getByRole("link", { name: "Download recorded information" }).getAttribute("href"))
      .toBe(`/api/parent/requests/${request.id}/operations/exact-operation/export`);
    expect(screen.queryByRole("link", { name: "Download this prepared form" })).toBeNull();
  });
  it.each([undefined, null, { preparation_only: false }])("preserves an ordinary form label for %j metadata", (form) => {
    renderOperation({ form });
    expect(screen.getByRole("link", { name: "Download this prepared form" })).toBeTruthy();
    expect(screen.queryByText(/Incomplete unsigned draft/)).toBeNull();
  });
  it("preserves a stronger recorded receipt rather than labeling it as an unsubmitted attempt", () => {
    renderOperation({ state: "agency_submitted", form: { preparation_only: true } });
    expect(screen.getByText(/Application submitted/)).toBeTruthy();
    expect(screen.queryByText(/not submitted/)).toBeNull();
    expect(screen.getByRole("link", { name: "Download incomplete unsigned draft" })).toBeTruthy();
  });
  it("labels the exact protected SNAP application without creating an ordinary form download", () => {
    renderOperation({ need: "snap_new", action: "submit", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket });
    expect(screen.getByText(/SNAP application prepared · not submitted/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download this prepared form" })).toBeNull();
    expect(screen.getByRole("link", { name: "Download recorded information" }).getAttribute("href")).toContain("/operations/exact-operation/export");
  });
  it.each([{ need: "snap_renewal" as const }, { action: "follow_up" }, { protected_packet: { raw: "PRIVATE-CANARY" } }])("does not label unrelated or invalid metadata as a protected application: %j", change => {
    renderOperation({ need: "snap_new", action: "submit", artifact_id: null, protected_packet: fixtureProtectedSnapOperation().packet.protectedSnapPacket, ...change });
    expect(screen.queryByText(/SNAP application prepared · not submitted/)).toBeNull();
  });
});

describe("inline prepared SNAP draft review", () => {
  const initial = fixtureRequest(), request = { ...initial, intake: { ...initial.intake, needs: ["snap_new" as const] } };
  const operation: RecordedOperation = { id: "exact-operation", request_id: request.id, request_version: request.version, need: "snap_new",
    program_id: "snap-pa", action: "prepare", state: "prepared", created_at: request.created_at, artifact_id: "exact-form", form: { preparation_only: true } };
  function view(op: Partial<RecordedOperation> = {}, current: SupportRequest = request) {
    const record = { ...operation, ...op };
    return <><SnapDraftReview key={`${current.id}:${current.version}:${record.artifact_id}`} request={current} operation={record}/>
      <SupportActivity request={current} onChange={vi.fn()} history={{ data: { operations: [record], historyLimited: false }, loading: false, error: null, reload: vi.fn() }}/></>;
  }
  function response(overrides: Record<string, unknown> = {}) {
    return { ok: true, status: 200, redirected: false, headers: new Headers({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store" }),
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7\nexact stored draft").buffer, ...overrides };
  }
  it("opens the same authenticated verified artifact on demand without downloading or submitting", async () => {
    const fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetcher); render(view());
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View prepared draft" }));
    await screen.findByRole("region", { name: "Exact draft preview" });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/parent/requests/${request.id}/forms/exact-form`, expect.objectContaining({ cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Accept: "application/pdf" }, signal: expect.any(AbortSignal) }));
    expect(reviewPdf).toHaveBeenLastCalledWith(expect.objectContaining({ source: expect.any(Blob) }));
    expect(screen.getByText(/Viewing it does not submit/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download incomplete unsigned draft" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide prepared draft" }));
    expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each([{ need: "snap_renewal" }, { program_id: "peco-cap" }, { action: "submit" }, { form: { preparation_only: false } }, { state: "invalidated" }, { request_id: "other-request" }, { request_version: request.version - 1 }, { artifact_id: null }])("preserves downloads without mounting this SNAP viewer for %j", change => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(view(change as Partial<RecordedOperation>));
    expect(screen.queryByRole("button", { name: "View prepared draft" })).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects ambiguous current drafts and keeps the read-only viewer out of recorded history", () => {
    expect(currentSnapDraft(request, [operation, { ...operation, id: "other", artifact_id: "other-form" }])).toBeNull();
    render(<SupportActivity request={request} onChange={vi.fn()} history={{ data: { operations: [operation], historyLimited: false }, loading: false, error: null, reload: vi.fn() }}/>);
    expect(screen.queryByRole("button", { name: "View prepared draft" })).toBeNull(); expect(screen.getByRole("link", { name: "Download incomplete unsigned draft" })).toBeTruthy();
  });
  it.each([{ status: "paused" as const }, { status: "cancelled" as const }, { intake: { ...request.intake, needs: ["food_now" as const] } }, { mandate: { ...request.mandate, expiresAt: "2026-01-01T00:00:00Z" } }])("does not mount a private viewer outside the current SNAP request: %j", change => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(view({}, { ...request, ...change }));
    expect(screen.queryByRole("button", { name: "View prepared draft" })).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([response({ ok: false, status: 403 }), response({ redirected: true }), response({ headers: new Headers({ "Content-Type": "text/html", "Cache-Control": "private, no-store" }) }), response({ arrayBuffer: async () => new TextEncoder().encode("not a PDF").buffer })])("keeps a failed response out of the PDF viewer and supports a fresh read", async failed => {
    const fetcher = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(response()); vi.stubGlobal("fetch", fetcher); render(view());
    fireEvent.click(screen.getByRole("button", { name: "View prepared draft" })); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("region", { name: "Exact draft preview" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("offers normal sign-in after a private read loses its session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: false, status: 401 }))); render(view());
    fireEvent.click(screen.getByRole("button", { name: "View prepared draft" }));
    expect((await screen.findByRole("link", { name: /Sign in to continue/ })).getAttribute("href")).toContain(encodeURIComponent(`/support/${request.id}`));
    expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull();
  });
  it("cancels a pending read on close and ignores a late reply", async () => {
    let reply!: (value: unknown) => void; const fetcher = vi.fn().mockImplementation(() => new Promise(resolve => { reply = resolve; })); vi.stubGlobal("fetch", fetcher); render(view());
    fireEvent.click(screen.getByRole("button", { name: "View prepared draft" })); expect(screen.getByRole("status", { name: "Opening your prepared draft" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide prepared draft" })); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { reply(response()); }); expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull();
  });
  it("bounds a stalled read and retries without accepting the earlier reply", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T22:00:00Z"));
    let reply!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { reply = resolve; })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetcher); render(view());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View prepared draft" })); });
    await act(async () => { vi.advanceTimersByTime(30_001); });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true); expect(screen.getByRole("alert")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(screen.getByRole("region", { name: "Exact draft preview" })).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { reply(response({ ok: false, status: 401 })); });
    expect(screen.getByRole("region", { name: "Exact draft preview" })).toBeTruthy(); expect(screen.queryByRole("link", { name: /Sign in to continue/ })).toBeNull();
  });
  it("drops the previous exact file when the request revision changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response())); const rendered = render(view());
    fireEvent.click(screen.getByRole("button", { name: "View prepared draft" })); await screen.findByRole("region", { name: "Exact draft preview" });
    rendered.rerender(view({ request_version: request.version + 1, artifact_id: "corrected-form" }, { ...request, version: request.version + 1 }));
    expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull(); expect(screen.getByRole("button", { name: "View prepared draft" })).toBeTruthy();
  });
  it("clears the in-memory viewer at permission expiry and makes no read after expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T22:00:00Z"));
    const fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetcher);
    render(view({}, { ...request, mandate: { ...request.mandate, expiresAt: "2026-11-06T22:00:01Z" } }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View prepared draft" })); });
    expect(screen.getByRole("region", { name: "Exact draft preview" })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(screen.queryByRole("region", { name: "Exact draft preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View prepared draft" })).toBeNull(); expect(screen.queryByRole("button", { name: "Hide prepared draft" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
