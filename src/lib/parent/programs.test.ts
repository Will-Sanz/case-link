import { describe, expect, it } from "vitest";
import {
  getProgram,
  getProgramsForNeeds,
  programRoutingIssue,
  SNAP_NEW_APPLICATION_URL,
} from "./programs";
import { fixtureNow } from "./test-fixtures";

describe("verified SNAP public application entry", () => {
  it("offers the initialized public COMPASS entry without requiring account creation", () => {
    const snap = getProgram("snap-pa")!;
    expect(SNAP_NEW_APPLICATION_URL).toBe(
      "https://www.compass.dhs.pa.gov/intake/#/getstarted",
    );
    expect(snap.description).toContain(
      "A new application can begin without creating a COMPASS account",
    );
    expect(snap.personalSteps.join(" ")).not.toMatch(
      /own account|required account/,
    );
    expect(snap.personalSteps.join(" ")).toMatch(/provider verification/i);
    expect(snap.personalSteps.join(" ")).toMatch(/directly with DHS/);
  });

  it("preserves continuing-SNAP routing without claiming a submission connector", () => {
    for (const need of [
      "snap_new",
      "snap_renewal",
      "snap_pending",
      "snap_problem",
    ] as const) {
      expect(
        getProgramsForNeeds([need]).find((program) => program.id === "snap-pa"),
      ).toMatchObject({
        officialUrl:
          "https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap",
        execution: "not_configured",
      });
    }
  });
});

describe("source review before current service-area facts are available", () => {
  it("permits source review and preparation without inventing a ZIP or a coverage decision", () => {
    expect(programRoutingIssue(getProgram("peco-cap")!, undefined, fixtureNow)).toBeNull();
  });

  it("still requires current program information when ZIP is unavailable", () => {
    const program = { ...getProgram("peco-cap")!, sourceCheckedAt: "2026-08-01" };
    expect(programRoutingIssue(program, undefined, fixtureNow)).toMatch(/current source review/);
    expect(programRoutingIssue({ ...program, sourceCheckedAt: "not-a-date" }, undefined, fixtureNow))
      .toMatch(/current source review/);
  });
});
