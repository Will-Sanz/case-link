import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureMandate, fixtureRequest } from "./test-fixtures";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  window: vi.fn(),
}));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
vi.mock("./authorization-window", () => ({
  getParentAuthorizationWindow: mocks.window,
}));
import { answerParentFact, answerParentFacts, replaceParentMandate } from "./mutations";
import type { FactAnswerBundle } from "./answers";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2028-01-01T00:00:00Z"));
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.window.mockResolvedValue({
    issuedAt: "2026-10-26T12:00:00.000Z",
    expiresAt: "2026-11-25T12:00:00.000Z",
  });
});

describe("atomic factual answer mutation", () => {
  const bundle: FactAnswerBundle = {
    answers: [
      { need: "electricity", field: "income", value: { amount: 0, frequency: "monthly" } },
      { need: "electricity", field: "amountDue", value: 0 },
    ], version: 2,
  };
  it("sends two canonical answers with one version in exactly one RPC", async () => {
    await answerParentFacts(fixtureRequest().id, bundle);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_answer_facts", {
      p_request_id: fixtureRequest().id,
      p_answers: bundle.answers,
      p_expected_version: 2,
    });
  });
  it("validates the whole bundle before any RPC, including a valid prefix followed by an invalid fact", async () => {
    for (const input of [
      { ...bundle, answers: [] },
      { ...bundle, answers: Array.from({ length: 31 }, () => bundle.answers[0]) },
      { ...bundle, answers: [bundle.answers[0], bundle.answers[0]] },
      { ...bundle, answers: [bundle.answers[0], { need: "electricity", field: "dueDate", value: "2026-02-30" }] },
      { ...bundle, answers: [{ need: "electricity", field: "incomeAmount", value: 0 }] },
      { ...bundle, answers: [{ need: "electricity", field: "password", value: "synthetic-secret" }] },
      { ...bundle, answers: [{ ...bundle.answers[0], extra: true }] },
      { ...bundle, version: 0 },
      { ...bundle, extra: true },
    ])
      await expect(answerParentFacts(fixtureRequest().id, input as FactAnswerBundle)).rejects.toThrow();
    await expect(answerParentFacts("not-a-request-id", bundle)).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not make an RPC without a current parent session", async () => {
    mocks.session.mockRejectedValueOnce(new Error("Sign in again."));
    await expect(answerParentFacts(fixtureRequest().id, bundle)).rejects.toThrow("Sign in again.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["40001", "This request changed. Reload it before saving your update."],
    ["42501", "This request is unavailable, or its permission has changed."],
  ])("preserves the safe %s error for an atomic bundle failure", async (code, message) => {
    mocks.rpc.mockResolvedValueOnce({ error: { code, message: "private database canary" } });
    await expect(answerParentFacts(fixtureRequest().id, bundle)).rejects.toThrow(message);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves the existing versioned single-fact path", async () => {
    const single = { need: "electricity" as const, field: "incomeAmount" as const, value: 0, version: 2 };
    await answerParentFact(fixtureRequest().id, single);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_answer_fact", {
      p_request_id: fixtureRequest().id, p_need: "electricity", p_field: "incomeAmount", p_value: 0, p_expected_version: 2,
    });
  });
});
afterEach(() => vi.useRealTimers());

describe("authoritative permission renewal", () => {
  it("preserves the exact quoted or shorter deadline and version despite a wrong web clock", async () => {
    for (const expiresAt of [
      "2026-11-25T12:00:00.000Z",
      "2026-10-27T12:00:00.000Z",
    ]) {
      const mandate = fixtureMandate({ expiresAt });
      await replaceParentMandate(fixtureRequest().id, mandate, 3);
      expect(mocks.rpc).toHaveBeenLastCalledWith("parent_replace_mandate", {
        p_request_id: fixtureRequest().id,
        p_mandate: mandate,
        p_expected_version: 3,
      });
    }
  });
  it("keeps the strict trusted thirty-day ceiling and fails closed if timing is unavailable", async () => {
    await expect(
      replaceParentMandate(
        fixtureRequest().id,
        fixtureMandate({ expiresAt: "2026-12-01T00:00:00.000Z" }),
        3,
      ),
    ).rejects.toThrow("Check the named programs and permission expiry");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.window.mockRejectedValueOnce(
      new Error("Authorization timing is temporarily unavailable."),
    );
    await expect(
      replaceParentMandate(fixtureRequest().id, fixtureMandate(), 3),
    ).rejects.toThrow("Authorization timing is temporarily unavailable.");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
