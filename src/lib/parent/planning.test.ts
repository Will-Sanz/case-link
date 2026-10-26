import { describe, it, expect } from "vitest";
import { NEEDS } from "./domain";
import { buildSupportPlan, requiredActions } from "./planning";
import { getProgramsForNeeds } from "./programs";
import { fixtureNow, fixtureIntake, fixtureMandate } from "./test-fixtures";
describe("reviewable synthetic journey corpus: every need in six conditions", () => {
  for (const need of NEEDS) {
    const recipients = getProgramsForNeeds([need]).map((p) => p.id);
    for (const scenario of [
      "ordinary",
      "unknown_facts",
      "zero_income",
      "preparation_only",
      "outside_area",
      "stale_source",
    ] as const) {
      it(`${need}: ${scenario}`, () => {
        const intake = fixtureIntake({
          needs: [need],
          ...(scenario === "unknown_facts"
            ? { householdSize: null, accountAuthority: "not_sure" }
            : {}),
          ...(scenario === "zero_income"
            ? { incomeAmount: 0, incomeFrequency: "monthly" }
            : {}),
          ...(scenario === "outside_area" ? { zip: "10001" } : {}),
        });
        const mandate = fixtureMandate({
          recipientIds: recipients,
          ...(scenario === "preparation_only"
            ? { mode: "prepare_only", allowedActions: ["research", "prepare"] }
            : {}),
        });
        const plan = buildSupportPlan(
          intake,
          mandate,
          scenario === "stale_source"
            ? new Date("2027-01-01T12:00:00Z")
            : fixtureNow,
        );
        expect(plan.routes).toHaveLength(1);
        expect(plan.routes[0].need).toBe(need);
        expect(plan.routes[0].state).toBe(
          ["outside_area", "stale_source"].includes(scenario)
            ? "unresolved"
            : "prepared",
        );
        expect(plan.routes[0].limitation).toBeTruthy();
        expect(plan.routes[0].summary).not.toMatch(
          /you (are eligible|have been approved)/i,
        );
        if (need === "snap_pending" || need === "snap_renewal")
          expect(plan.routes[0].steps.join(" ")).not.toMatch(
            /start a new application/,
          );
      });
    }
  }
  it("records independent outcomes and limits human questions to necessary facts", () => {
    const intake = fixtureIntake({ accountAuthority: "not_sure" });
    const mandate = fixtureMandate();
    const plan = buildSupportPlan(intake, mandate, fixtureNow);
    expect(plan.routes.map((r) => r.need)).toEqual(["food_now", "electricity"]);
    expect(
      requiredActions(intake, mandate)
        .filter((a) => a.resolver !== "operator")
        .map((a) => a.field),
    ).toEqual(["accountAuthority"]);
    expect(
      requiredActions(
        fixtureIntake(),
        fixtureMandate({
          mode: "prepare_only",
          allowedActions: ["research", "prepare"],
        }),
      ),
    ).toEqual([]);
  });
});
