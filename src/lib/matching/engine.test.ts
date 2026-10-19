import { describe, expect, it } from "vitest";
import { rankResourcesForFamily } from "./engine";
import type { FamilyMatchInput, MatchableResource } from "./types";

function resource(id: string, description: string, category: string): MatchableResource {
  return {
    id, program_name: id, office_or_department: "Community programs", description,
    category, search_text: null, tags: [], recruit_for_grocery_giveaways: null,
    tabling_at_events: false, promotional_materials: false,
    educational_workshops: false, volunteer_recruitment_support: false,
  };
}

function family(presetKey: string, label: string, asGoal = false): FamilyMatchInput {
  const need = { preset_key: presetKey, label };
  return { goals: asGoal ? [need] : [], barriers: asGoal ? [] : [need], summary: null, household_notes: null };
}

const unrelated = [
  resource("arts", "Free choir and theater activities for teens.", "Youth Programming"),
  resource("school", "Help students return to high school.", "Youth Services or Resources"),
  resource("parents", "Parent discussion groups and peer support.", "Adult/Family Services or Resources"),
];

describe("resource service fit", () => {
  it("matches actual housing support without treating every family or youth program as housing", () => {
    const resources = [
      ...unrelated,
      resource("housing", "Housing stabilization and eviction prevention.", "Adult/Family Services or Resources"),
      resource("shelter", "Temporary shelter for homeless youth ages 12–17.", "Youth Services or Resources"),
    ];
    expect(rankResourcesForFamily(family("housing_instability", "Housing"), resources)
      .map(match => match.resourceId).sort()).toEqual(["housing", "shelter"]);
  });

  it.each([
    ["childcare", true],
    ["childcare_barrier", false],
  ] as const)("requires an actual care service for %s", (key, asGoal) => {
    const resources = [
      ...unrelated,
      resource("care", "Head Start and early learning enrollment.", "Youth Services or Resources"),
      resource("daycare", "Full-day care for young children.", "Daycare"),
    ];
    expect(rankResourcesForFamily(family(key, "Childcare", asGoal), resources)
      .map(match => match.resourceId).sort()).toEqual(["care", "daycare"]);
  });

  it("still includes youth programs when youth programming is an explicit goal", () => {
    const matches = rankResourcesForFamily(family("youth_programming", "Youth activities", true), unrelated);
    expect(matches.map(match => match.resourceId)).toContain("arts");
  });

  it("does not turn ordinary family-context wording into evidence of service fit", () => {
    const input = { ...family("housing_instability", "Housing"), summary: "The family wants stable housing and support with their needs." };
    const resources = [
      resource("arts", "We support families with their needs through arts activities.", "Youth Programming"),
      resource("housing", "Housing stabilization and eviction prevention.", "Adult/Family Services or Resources"),
    ];
    expect(rankResourcesForFamily(input, resources).map(match => match.resourceId)).toEqual(["housing"]);
  });

  it("does not count repeated words as independent matching evidence", () => {
    const input: FamilyMatchInput = { goals: [], barriers: [], summary: "Transportation transportation transportation transportation", household_notes: null };
    expect(rankResourcesForFamily(input, [resource("event", "Transportation to an arts event.", "Youth Programming")])).toEqual([]);
  });

  it("compares whole narrative words so rent, care and work do not match parent, childcare and workshops", () => {
    const input: FamilyMatchInput = { goals: [], barriers: [], summary: "Rent care work", household_notes: null };
    expect(rankResourcesForFamily(input, [resource("event", "Parent childcare workshops.", "Youth Programming")])).toEqual([]);
  });

  it("retains matching evidence from distinct specific narrative words", () => {
    const input: FamilyMatchInput = { goals: [], barriers: [], summary: "Loaner devices weekend pickup", household_notes: null };
    const matches = rankResourcesForFamily(input, [resource("devices", "Loaner devices available for weekend pickup.", "Community services")]);
    expect(matches.map(match => match.resourceId)).toEqual(["devices"]);
  });
});
