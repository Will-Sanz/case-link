import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest, fixtureMandate } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  control: vi.fn(),
  correct: vi.fn(),
  resolve: vi.fn(),
  fact: vi.fn(),
  facts: vi.fn(),
  mandate: vi.fn(),
  booking: vi.fn(),
  update: vi.fn(),
  updateContext: vi.fn(),
  progress: vi.fn(),
}));
vi.mock("@/lib/parent/data", () => ({
  getSupportRequest: mocks.get,
  controlSupportRequest: mocks.control,
  correctSupportRequest: mocks.correct,
  resolveParentAction: mocks.resolve,
}));
vi.mock("@/lib/parent/mutations", () => ({
  answerParentFact: mocks.fact,
  answerParentFacts: mocks.facts,
  replaceParentMandate: mocks.mandate,
  updateParentBooking: mocks.booking,
}));
vi.mock("@/lib/parent/progress-data", () => ({
  getSupportProgress: mocks.progress,
}));
vi.mock("@/lib/parent/support-update-data", () => ({ applySupportUpdate: mocks.update, getSupportUpdateContext: mocks.updateContext, SupportUpdateRejectedError: class extends Error { constructor() { super("parent_invalid_input"); } } }));
import { GET, POST } from "./requests/[id]/route";
import { SupportUpdateRejectedError } from "@/lib/parent/support-update-data";
const id = fixtureRequest().id,
  context = { params: Promise.resolve({ id }) };
const request = (body: unknown, origin = "https://app.example.test") =>
  new Request(`https://app.example.test/api/parent/requests/${id}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const bundle = {
  answers: [
    { need: "electricity", field: "income", value: { amount: 0, frequency: "monthly" } },
    { need: "electricity", field: "amountDue", value: 0 },
  ],
  version: 2,
};
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  vi.clearAllMocks();
  mocks.facts.mockReset().mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(fixtureRequest());
  mocks.progress.mockReset().mockResolvedValue({ state: "service_offline" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("versioned parent actions", () => {
  it("saves one strict answer bundle without partial per-fact mutations", async () => {
    const body = { action: "answer_facts", ...bundle };
    const result = await POST(request(body), context);
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.facts).toHaveBeenCalledExactlyOnceWith(id, { answers: body.answers, version: 2 });
    expect(mocks.fact).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(id);
  });
  it.each([
    ["empty", { answers: [] }],
    ["duplicate", { answers: [bundle.answers[0], bundle.answers[0]] }],
    ["legacy alias", { answers: [{ need: "electricity", field: "incomeAmount", value: 0 }] }],
    ["secret", { answers: [{ need: "electricity", field: "password", value: "synthetic-secret" }] }],
    ["invalid second answer", { answers: [bundle.answers[0], { need: "electricity", field: "dueDate", value: "2026-02-30" }] }],
    ["per-entry version", { answers: [{ ...bundle.answers[0], version: 1 }] }],
    ["unknown key", { extra: true }],
    ["invalid version", { version: 0 }],
  ])("rejects a %s bundle before invoking either mutation path", async (_label, change) => {
    const result = await POST(request({ action: "answer_facts", ...bundle, ...change }), context);
    expect(result.status).toBe(400);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.facts).not.toHaveBeenCalled();
    expect(mocks.fact).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([
    ["Authentication session expired: private-canary", 401],
    ["This request changed. private-canary", 409],
    ["This request is unavailable: private-canary", 403],
    ["Parent service not enabled: private-canary", 503],
  ])("preserves safe bundle error handling for %s", async (message, status) => {
    mocks.facts.mockRejectedValueOnce(new Error(String(message)));
    const result = await POST(request({ action: "answer_facts", ...bundle }), context);
    expect(result.status).toBe(status);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await result.json();
    expect(body.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain("private-canary");
    expect(mocks.facts).toHaveBeenCalledTimes(1);
    expect(mocks.fact).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("keeps same-origin, bounded JSON and malformed-body guards ahead of bundle mutation", async () => {
    const body = { action: "answer_facts", ...bundle };
    expect((await POST(request(body, "https://evil.example.test"), context)).status).toBe(403);
    for (const content of ["{", JSON.stringify(body) + " ".repeat(40001)]) {
      const malformed = new Request(`https://app.example.test/api/parent/requests/${id}`, {
        method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" }, body: content,
      });
      expect((await POST(malformed, context)).status).toBe(400);
    }
    const wrongType = new Request(`https://app.example.test/api/parent/requests/${id}`, {
      method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "text/plain" }, body: JSON.stringify(body),
    });
    expect((await POST(wrongType, context)).status).toBe(400);
    expect(mocks.facts).not.toHaveBeenCalled();
    expect(mocks.fact).not.toHaveBeenCalled();
  });
  it.each(["pause", "resume", "cancel"])("preserves the existing %s action", async (action) => {
    expect((await POST(request({ action }), context)).status).toBe(200);
    expect(mocks.control).toHaveBeenCalledExactlyOnceWith(id, action);
    expect(mocks.facts).not.toHaveBeenCalled();
  });
  it("passes one typed source fact and rejects account secrets or invalid dates before mutation", async () => {
    const body = {
      action: "answer_fact",
      need: "electricity",
      field: "amountDue",
      value: 0,
      version: 2,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.fact).toHaveBeenCalledWith(id, {
      need: "electricity",
      field: "amountDue",
      value: 0,
      version: 2,
    });
    expect(
      (
        await POST(
          request({ ...body, field: "dueDate", value: "2026-02-30" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({ ...body, field: "password", value: "secret" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.fact).toHaveBeenCalledTimes(1);
  });
  it("requires exact renewed scope and same-origin access; concurrent corrections stay safe", async () => {
    const body = {
      action: "replace_mandate",
      mandate: fixtureMandate(),
      version: 2,
    };
    expect(
      (await POST(request(body, "https://evil.example.test"), context)).status,
    ).toBe(403);
    expect(mocks.mandate).not.toHaveBeenCalled();
    mocks.mandate.mockRejectedValueOnce(
      new Error("This request changed. Reload it before saving your update."),
    );
    expect((await POST(request(body), context)).status).toBe(409);
    expect(mocks.mandate).toHaveBeenCalledWith(id, body.mandate, 2);
  });
});


describe("exact owned support-update API", () => {
  const key = "22222222-2222-4222-8222-222222222222";
  const ack = { ownerId: "33333333-3333-4333-8333-333333333333", receipt: { id: key, key, requestId: id, action: "answer_facts", baseVersion: 2, resultVersion: 4, recordedAt: "2026-11-18T12:00:00Z" } };
  const keyed = (body: unknown) => { const value = request(body); value.headers.set("Idempotency-Key", key); return value; };
  it.each([
    { action: "answer_facts", ...bundle },
    { action: "answer_fact", ...bundle.answers[0], version: 2 },
    { action: "replace_mandate", mandate: fixtureMandate({ expiresAt: "2020-01-01T00:00:00Z" }), version: 2 },
    { action: "booking_preference", preference: "any_weekday", version: 2 },
  ])("routes $action through one exact atomic update without pre-calling legacy mutation/current-expiry validation", async body => {
    mocks.update.mockResolvedValueOnce(ack);
    const result = await POST(keyed(body), context);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true, update: ack });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(id, key, body);
    for (const legacy of [mocks.fact, mocks.facts, mocks.mandate, mocks.booking, mocks.get]) expect(legacy).not.toHaveBeenCalled();
  });
  it("rejects unsupported keyed actions, malformed keys, cross-origin and invalid body before any mutation", async () => {
    for (const body of [{ action: "cancel" }, { action: "pause" }, { action: "answer_facts", ...bundle, answers: [] }, { action: "answer_facts", ...bundle, extra: true }])
      expect(await (await POST(keyed(body), context)).json()).toMatchObject({ ok: false, supportUpdateRejected: true });
    const malformed = keyed({ action: "answer_facts", ...bundle }); malformed.headers.set("Idempotency-Key", "wrong");
    expect((await POST(malformed, context)).status).toBe(400);
    const foreign = keyed({ action: "answer_facts", ...bundle }); foreign.headers.set("Origin", "https://wrong.example.test");
    expect((await POST(foreign, context)).status).toBe(403); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.control).not.toHaveBeenCalled();
  });
  it("reads metadata only after the owned request is readable, without mutating or caching it", async () => {
    mocks.updateContext.mockResolvedValueOnce({ ...ack, expiresAt: null, issuedAt: null });
    const result = await GET(new Request(`https://app.example.test/api/parent/requests/${id}?updateKey=${key}`), context);
    expect(result.status).toBe(200); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await result.json()).update).toEqual({ ...ack, expiresAt: null, issuedAt: null });
    expect(mocks.updateContext).toHaveBeenCalledExactlyOnceWith(id, key); expect(mocks.update).not.toHaveBeenCalled();
    mocks.get.mockResolvedValueOnce(null); mocks.updateContext.mockClear();
    expect((await GET(new Request(`https://app.example.test/api/parent/requests/${id}?updateKey=${key}`), context)).status).toBe(404);
    expect(mocks.updateContext).not.toHaveBeenCalled();
  });
  it("keeps an owned receipt read independent of progress-only failure while preserving ordinary progress reads", async () => {
    mocks.updateContext.mockResolvedValueOnce({ ...ack, expiresAt: null, issuedAt: null });
    mocks.progress.mockRejectedValueOnce(new Error("This request is unavailable, or its permission has changed."));
    const read = await GET(new Request(`https://app.example.test/api/parent/requests/${id}?updateKey=${key}`), context);
    expect(read.status).toBe(200); expect((await read.json()).update.receipt).toEqual(ack.receipt);
    expect(mocks.get).toHaveBeenCalledWith(id); expect(mocks.progress).not.toHaveBeenCalled();
    expect((await GET(new Request(`https://app.example.test/api/parent/requests/${id}`), context)).status).toBe(403);
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(id);
  });
  it("rejects invalid or duplicate recovery query keys before reading private information", async () => {
    for (const query of ["updateKey=wrong", `updateKey=${key}&updateKey=${key}`])
      expect((await GET(new Request(`https://app.example.test/api/parent/requests/${id}?${query}`), context)).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.updateContext).not.toHaveBeenCalled();
  });
});

it("marks a rolled-back keyed RPC validation failure while leaving all legacy error bodies unchanged", async () => {
 const id=fixtureRequest().id, ctx={params:Promise.resolve({id})}, body={action:"booking_preference",preference:"any_weekday",version:1};
 const keyed=new Request(`https://app.example.test/api/parent/requests/${id}`,{method:"POST",headers:{Origin:"https://app.example.test","Content-Type":"application/json","Idempotency-Key":"22222222-2222-4222-8222-222222222222"},body:JSON.stringify(body)});
 mocks.update.mockRejectedValueOnce(new SupportUpdateRejectedError());
 const rejected=await POST(keyed,ctx);expect(rejected.status).toBe(400);expect((await rejected.json()).supportUpdateRejected).toBe(true);
 const legacy=new Request(`https://app.example.test/api/parent/requests/${id}`,{method:"POST",headers:{Origin:"https://app.example.test","Content-Type":"application/json"},body:JSON.stringify({action:"answer_facts",answers:[],version:1})});
 expect((await(await POST(legacy,ctx)).json()).supportUpdateRejected).toBeUndefined();
});
