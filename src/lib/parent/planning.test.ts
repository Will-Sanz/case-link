import { describe, it, expect } from "vitest";
import { NEEDS } from "./domain";
import { buildSupportPlan, requiredActions } from "./planning";
import { getProgramsForNeeds } from "./programs";
import {
  fixtureNow,
  fixtureIntake,
  fixtureMandate,
  fixtureRequest,
} from "./test-fixtures";
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
          fixtureRequest({ intake, mandate }),
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
    const plan = buildSupportPlan(fixtureRequest({ intake, mandate }), fixtureNow);
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
  it("uses each need's current ZIP rather than another need's outside-area mirror", () => {
    const request = fixtureRequest({
      intake: fixtureIntake({ zip: "10001" }),
      intake_need_scoped_fields: ["zip"],
      facts: [
        {
          need: "food_now", field: "zip", value: "10001", source: "parent",
          confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25",
        },
        {
          need: "electricity", field: "zip", value: "19104", source: "parent",
          confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25",
        },
      ],
    });
    const plan = buildSupportPlan(request, fixtureNow);
    expect(plan.routes.find((route) => route.need === "electricity")?.state).toBe("prepared");
    expect(plan.routes.find((route) => route.need === "food_now")?.state).toBe("unresolved");
  });
  it.each(["missing", "expired", "excluded"] as const)(
    "keeps preparation and other necessary questions available when current ZIP is %s",
    (source) => {
      const request = fixtureRequest({
        intake: fixtureIntake({ zip: "10001", accountAuthority: "not_sure" }),
        ...(source === "missing" ? { intake_need_scoped_fields: ["zip"] } : {}),
        ...(source === "expired" ? {
          intake_confirmed_at: { zip: new Date(fixtureNow.getTime() - 46 * 86400000).toISOString() },
        } : {}),
        ...(source === "excluded" ? { mandate: fixtureMandate({ allowedData: ["utility"] }) } : {}),
      });
      const plan = buildSupportPlan(request, fixtureNow);
      expect(plan.routes.map((route) => route.state)).toEqual(["prepared", "prepared"]);
      expect(plan.routes.every((route) => route.limitation)).toBe(true);
      expect(plan.routes.map((route) => route.summary).join(" "))
        .not.toMatch(/you are eligible|coverage (is |has been )?confirmed|while we expand coverage/i);
      expect(
        requiredActions(request.intake, request.mandate)
          .filter((action) => action.resolver !== "operator")
          .map((action) => action.field),
      ).toEqual(["accountAuthority"]);
    },
  );
  it("keeps program-source review required when current ZIP is unavailable", () => {
    const request = fixtureRequest({ intake_need_scoped_fields: ["zip"] });
    const plan = buildSupportPlan(request, new Date("2027-01-01T12:00:00Z"));
    expect(plan.routes.every((route) => route.state === "unresolved")).toBe(true);
    expect(plan.routes.every((route) => /current source review/.test(route.limitation ?? ""))).toBe(true);
  });
});
