/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { clearLocalActionDrafts, DRAFT_LOGOUT_KEY, DRAFT_PREFIX, DRAFT_TTL_MS, localActionDraftKey, parseLocalActionDraft, pruneLocalActionDrafts, serializeLocalActionDraft } from "./local-action-draft";
import type { PlanStepRow } from "@/types/family";
const owner = "90000000-0000-4000-8000-000000000001";
const other = "90000000-0000-4000-8000-000000000002";
const step: PlanStepRow = {
  id: "00000000-0000-4000-8000-000000000003",
  plan_id: "00000000-0000-4000-8000-000000000001",
  phase: "30", title: "Call the program", description: "", status: "pending",
  due_date: null, assigned_to_id: null, sort_order: 0,
  created_at: "2026-08-03T12:00:00.000Z", updated_at: "2026-08-03T12:00:00.000Z", action_items: [],
};
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
describe("account-scoped temporary recovery", () => {
  it("keeps only directory references in recovery, including when storage contains forged contact text", () => {
    const contacts = [{ source_resource_id: other, source_updated_at: step.updated_at, name: "Source program", phone: "215-555-0148", email: "source@example.test" }];
    const value = serializeLocalActionDraft(owner,step.plan_id,{...step,details:{contacts}})!;
    expect(value).not.toMatch(/215-555|source@|Source program/);
    const stored = JSON.parse(value); stored.step.details.contacts[0].phone = "215-555-9999";
    expect(parseLocalActionDraft(JSON.stringify(stored),owner,step.plan_id)?.step.details?.contacts).toEqual([{source_resource_id:other,source_updated_at:step.updated_at}]);
    expect(serializeLocalActionDraft(owner,step.plan_id,{...step,details:{contacts:[{phone:"215-555-0148"}]}})).toBeNull();
    expect(parseLocalActionDraft(serializeLocalActionDraft(owner,step.plan_id,{...step,details:{contacts:[{name:"Previous office"}]}}),owner,step.plan_id)?.step.details?.contacts).toEqual([{name:"Previous office"}]);
  });
  it("round-trips the same account's edits across session renewal, without unused helper content", () => {
    const now = Date.now();
    const value = serializeLocalActionDraft(owner, step.plan_id, { ...step, ai_helper_data: { call_script: "Not edited" } }, now);
    expect(parseLocalActionDraft(value, owner, step.plan_id, now + 100)).toMatchObject({ userId: owner, step: { title: step.title } });
    expect(value).not.toContain("Not edited");
    expect(localActionDraftKey(owner, step.plan_id)).not.toBe(localActionDraftKey(other, step.plan_id));
  });
  it("denies another account, another plan, logout copies, future timestamps and expired drafts", () => {
    const now = Date.now();
    const value = serializeLocalActionDraft(owner, step.plan_id, step, now);
    expect(parseLocalActionDraft(value, other, step.plan_id, now)).toBeNull();
    expect(parseLocalActionDraft(value, owner, other, now)).toBeNull();
    expect(parseLocalActionDraft(value, owner, step.plan_id, now, now)).toBeNull();
    expect(parseLocalActionDraft(value, owner, step.plan_id, now - 1)).toBeNull();
    expect(parseLocalActionDraft(value, owner, step.plan_id, now + DRAFT_TTL_MS)).toBeNull();
  });
  it.each(["not json", JSON.stringify({ v: 1, planId: "x" }), "x".repeat(100_001)])("rejects malformed, legacy and oversized content", value => {
    expect(parseLocalActionDraft(value, owner, step.plan_id)).toBeNull();
  });
  it("validates nested fields rather than casting arbitrary storage as a plan", () => {
    const value = JSON.parse(serializeLocalActionDraft(owner, step.plan_id, step)!);
    value.step.details = { checklist: [42] };
    expect(parseLocalActionDraft(JSON.stringify(value), owner, step.plan_id)).toBeNull();
    value.step.details = {};
    value.step.plan_id = other;
    expect(parseLocalActionDraft(JSON.stringify(value), owner, step.plan_id)).toBeNull();
  });
  it.each([
    { description: "Email parent@example.test" },
    { workflow_data: { outcome_notes: "Call 215-555-0188" } },
    { details: { checklist: ["Student ID: AB1234"] } },
  ])("does not persist likely identifiers anywhere in an edited field", fields => {
    expect(serializeLocalActionDraft(owner, step.plan_id, { ...step, ...fields })).toBeNull();
    const value = JSON.parse(serializeLocalActionDraft(owner, step.plan_id, step)!);
    Object.assign(value.step, fields);
    expect(parseLocalActionDraft(JSON.stringify(value), owner, step.plan_id)).toBeNull();
  });
  it("purges legacy persistent drafts, other users and expired drafts while preserving a current same-user edit", () => {
    const key = localActionDraftKey(owner, step.plan_id);
    localStorage.setItem(`${DRAFT_PREFIX}legacy`, "raw legacy content");
    sessionStorage.setItem(key, serializeLocalActionDraft(owner, step.plan_id, step)!);
    sessionStorage.setItem(localActionDraftKey(other, step.plan_id), serializeLocalActionDraft(other, step.plan_id, step)!);
    pruneLocalActionDrafts(owner);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(key)).toBeTruthy();
    localStorage.setItem(DRAFT_LOGOUT_KEY, String(Date.now() + 1));
    pruneLocalActionDrafts(owner);
    expect(sessionStorage.length).toBe(0);
  });
  it("clears drafts on explicit logout without removing unrelated browser preferences", () => {
    sessionStorage.setItem(localActionDraftKey(owner, step.plan_id), "draft");
    localStorage.setItem(`${DRAFT_PREFIX}legacy`, "draft");
    localStorage.setItem("color-preference", "light");
    clearLocalActionDrafts();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(`${DRAFT_PREFIX}legacy`)).toBeNull();
    expect(localStorage.getItem("color-preference")).toBe("light");
    expect(Number(localStorage.getItem(DRAFT_LOGOUT_KEY))).toBeGreaterThan(0);
  });
});
