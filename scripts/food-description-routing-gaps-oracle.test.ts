import { describe, expect, it } from "vitest";
import { descriptionEvaluationOracle, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
const corpus = loadDescriptionEvaluationCorpus();
describe("current expectation ports for truthful routing states", () => {
  it.each(["en", "es"])("names only the explicit outside-PA marker in %s without rewriting the archived geography", language => {
    const item = corpus.cases.find(value => value.id === `description-choice_and_scope-2-${language}`)!;
    const value = descriptionEvaluationOracle(item, 0);
    expect(value.archived.state).toBe("outside_supported_geography");
    expect(value.current).toMatchObject({ state: "manual", outOfScope: "outside_pa" });
  });
  it.each(["en", "es"])("keeps a denied application's problem route without invented received benefits in %s", language => {
    const item = corpus.cases.find(value => value.id === `description-untrusted_and_sources-3-${language}`)!;
    const edited = descriptionEvaluationOracle(item, 2), terminal = descriptionEvaluationOracle(item, 3);
    expect(edited.archived.answers).toMatchObject({ benefitHistory: "receiving", existingIssue: "not_sure" });
    expect(edited.current.answers).toEqual({ foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null });
    expect(edited.current.needIds).toEqual(["snap_problem"]);
    expect(terminal.current.handoff).toEqual({ needs: ["snap_problem"], answers: { foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null } });
  });
});
