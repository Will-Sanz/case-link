import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { descriptionEvaluationOracle, descriptionEvaluationPlan, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";

const corpus = loadDescriptionEvaluationCorpus();
const item = (id: string) => corpus.cases.find(value => value.id === id)!;
const provisional = ["renewal-1", "renewal-2", "pending-1", "pending-2", "benefit_problem-1", "benefit_problem-2", "ambiguity-1", "ambiguity-2", "owned_history-2", "untrusted_and_sources-1", "untrusted_and_sources-3"];
const languages = ["en", "es"];

describe("independently reviewed current food-description expectations", () => {
  it.each(provisional.flatMap(scenario => languages.map(language => `description-${scenario}-${language}`)))("retains provisional food while its necessary question is unanswered: %s", id => {
    const { archived, current, differences } = descriptionEvaluationOracle(item(id), 0);
    expect(archived.needIds).not.toContain("food_now");
    expect(current.needIds).toEqual(["food_now", ...(archived.needIds as string[])]);
    expect(current.questionIds).toEqual(archived.questionIds);
    expect(current).toMatchObject({ state: "needs_clarification", urgency: null, executionGranted: false });
    expect(current.allowedProgramIdsByNeed).toMatchObject({ food_now: ["philly-food", "share-community-fridge-19129"] });
    expect(differences.join(" ")).toContain("provisional food");
  });
  it.each(languages)("does not turn a requested food site into a food-supply assertion (%s)", language => {
    const source = item(`description-choice_and_scope-3-${language}`);
    const first = descriptionEvaluationOracle(source, 0), next = descriptionEvaluationOracle(source, 1), edit = descriptionEvaluationOracle(source, 2), terminal = descriptionEvaluationOracle(source, 3);
    expect(first.archived).toMatchObject({ state: "proposal", questionIds: [], urgency: "today" });
    expect(first.current).toMatchObject({ state: "needs_clarification", needIds: ["food_now"], questionIds: ["foodForTwoDays"], urgency: null });
    expect(next.current).toMatchObject({ answers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure", existingIssue: null }, remainingQuestionIds: ["foodForTwoDays"], needIds: ["food_now"], urgency: null });
    expect(edit.current).toMatchObject({ state: "needs_clarification", answers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, questionIds: ["foodForTwoDays"], needIds: ["food_now", "snap_new"], urgency: null });
    expect(terminal.current.handoff).toMatchObject({ needs: ["snap_new"], answers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null } });
    expect(terminal.archived.handoff).toMatchObject({ need: "snap_new" });
    expect(terminal.current).toMatchObject({ partialHandoff: true, remainingQuestionIds: ["foodForTwoDays"], requiresNewMandate: true, unstartedNeedIds: ["food_now"] });
  });
  it.each(languages)("keeps a no-current-action correction on the manual path (%s)", language => {
    const { archived, current } = descriptionEvaluationOracle(item(`description-pending-3-${language}`), 2);
    expect(archived.state).toBe("proposal");
    expect(current).toMatchObject({ state: "manual", needIds: [], questionIds: [], answers: { foodForTwoDays: "yes", benefitHistory: "receiving", existingIssue: "none" } });
  });
  it.each(languages)("opens the already owned application after an explicit pending correction (%s)", language => {
    const source = item(`description-owned_history-3-${language}`), { archived, current } = descriptionEvaluationOracle(source, 2);
    expect(archived).toMatchObject({ state: "proposal", needIds: ["snap_pending"] });
    expect(current).toMatchObject({ state: "open_existing", needIds: [], questionIds: [], existingRequests: [{ requestId: "00000000-0000-4000-8000-000000000101", needIds: ["snap_pending"] }] });
    expect(descriptionEvaluationOracle(source, 3).current).toMatchObject({ requiresNewMandate: false, askRepeatedRoutingFacts: false });
  });
  it.each([1, 3].flatMap(kind => languages.map(language => ({ kind, language }))))("does not manufacture an applied answer while reopening owned history $kind ($language)", ({ kind, language }) => {
    const source = item(`description-owned_history-${kind}-${language}`), { archived, current } = descriptionEvaluationOracle(source, 1);
    expect(source.turns[1].suppliedAnswers).toEqual({});
    expect(archived).toMatchObject({ answers: { benefitHistory: "applied" } });
    expect(current).toMatchObject({ state: "open_existing", needIds: [], answers: { foodForTwoDays: kind === 3 ? "yes" : "not_sure", benefitHistory: "not_sure", existingIssue: null },
      existingRequests: [{ requestId: "00000000-0000-4000-8000-000000000101", needIds: ["snap_pending"] }] });
  });
  it("preserves archived corpus bytes, held v10 history and all declared evaluation denominators", () => {
    const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(hash("tests/fixtures/parent/food-description-2026-11-18.v3.json")).toBe("6ea3e44b253e66bc26720507c355d6b3da030bfd2d85e59b282feb9607570a19");
    expect(hash("tests/fixtures/parent/food-description-2026-11-18.v10-adapter.json")).toBe("1e889f0bb66b19ad6adec3d2093506ead93d739f0312d85412a917c01fe1ea55");
    expect(hash("tests/fixtures/parent/food-description-2026-11-18.v13-adapter.json")).toBe("747f54fcc97277b83eb34b68a20488883007a5342c62be849631a2aea727a0b9");
    const plan = descriptionEvaluationPlan(corpus);
    expect(plan).toMatchObject({ caseCount: 60, turnCount: 240, maximumModelCalls: 80, zeroCallGuardCases: 24, languageCounts: { en: 30, es: 30 } });
    expect(plan.cases.flatMap(value => value.turns)).toHaveLength(240);
  });
  it("preserves every predeclared current expectation from the stopped v13 run", () => {
    const previous = JSON.parse(readFileSync("tests/fixtures/parent/food-description-2026-11-18.v13-adapter.json", "utf8"));
    const current = descriptionEvaluationPlan(corpus);
    expect(current.cases.map(value => value.turns.map(turn => turn.current))).toEqual(previous.cases.map((value: { turns: { current: unknown }[] }) => value.turns.map(turn => turn.current)));
  });
  it("changes only the 44 reviewed current turns and preserves every archived turn", () => {
    const archivedPlan = JSON.parse(readFileSync("tests/fixtures/parent/food-description-2026-11-18.v10-adapter.json", "utf8"));
    const plan = descriptionEvaluationPlan(corpus), changed: string[] = [];
    for (const [caseIndex, value] of plan.cases.entries()) for (const [turnIndex, turn] of value.turns.entries()) {
      const previous = archivedPlan.cases[caseIndex].turns[turnIndex];
      expect(turn.archived).toEqual(previous.archived);
      if (JSON.stringify(turn.current) !== JSON.stringify(previous.current)) changed.push(`${value.id}:${turn.turn}`);
    }
    const expected = [
      ...provisional.flatMap(scenario => languages.map(language => `description-${scenario}-${language}:1`)),
      ...languages.flatMap(language => [1, 2, 3, 4].map(turn => `description-choice_and_scope-3-${language}:${turn}`)),
      ...languages.flatMap(language => [`description-pending-3-${language}:3`, `description-owned_history-3-${language}:3`]),
      ...languages.flatMap(language => [`description-choice_and_scope-2-${language}:1`, `description-untrusted_and_sources-3-${language}:3`, `description-untrusted_and_sources-3-${language}:4`]),
      ...[1, 3].flatMap(kind => languages.map(language => `description-owned_history-${kind}-${language}:2`)),
    ];
    expect(changed.sort()).toEqual(expected.sort());
  });

});
