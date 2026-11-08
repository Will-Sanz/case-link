import { expect, it } from "vitest";
import { releaseCheckFailures, REQUIRED_CHECKS } from "./release-checks";
const sha = "a".repeat(40);
const passed = REQUIRED_CHECKS.map((check, index) => ({ id: index + 1, name: check.name, head_sha: sha, status: "completed", conclusion: "success", app: { id: check.appId } }));
it("requires successful checks for the exact commit from the trusted providers", () => {
  expect(releaseCheckFailures(sha, [{ check_runs: passed }])).toEqual([]);
  for (const patch of [{ head_sha: "b".repeat(40) }, { app: { id: 999 } }, { status: "queued" }, { conclusion: "failure" }, { conclusion: "skipped" }]) {
    expect(releaseCheckFailures(sha, [{ check_runs: [{ ...passed[0], ...patch }, ...passed.slice(1)] }])).toHaveLength(1);
  }
  expect(releaseCheckFailures(sha, [])).toHaveLength(4);
  expect(() => releaseCheckFailures("HEAD", [])).toThrow();
});
it("blocks a newer failed or pending rerun despite an older successful result", () => {
  for (const status of ["completed", "in_progress"])
    expect(releaseCheckFailures(sha, [{ check_runs: passed }, { check_runs: [{ ...passed[0], id: 999, status, conclusion: "failure" }] }])).toHaveLength(1);
});
