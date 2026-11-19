import { expect, it } from "vitest";
import { releaseCheckFailures, REQUIRED_CHECKS } from "./release-checks";
const sha = "a".repeat(40);
const passed = REQUIRED_CHECKS.map((check, index) => ({ id: index + 1, name: check.name, head_sha: sha, status: "completed", conclusion: "success", app: { id: check.appId } }));
it("requires successful checks for the exact commit from the trusted providers", () => {
  expect(releaseCheckFailures(sha, [{ check_runs: passed }])).toEqual([]);
  for (const patch of [{ head_sha: "b".repeat(40) }, { app: { id: 999 } }, { status: "queued" }, { conclusion: "failure" }, { conclusion: "skipped" }]) {
    expect(releaseCheckFailures(sha, [{ check_runs: [{ ...passed[0], ...patch }, ...passed.slice(1)] }])).toHaveLength(1);
  }
  expect(releaseCheckFailures(sha, [])).toHaveLength(5);
  expect(() => releaseCheckFailures("HEAD", [])).toThrow();
});
it("blocks a newer failed or pending rerun despite an older successful result", () => {
  for (const status of ["completed", "in_progress"])
    expect(releaseCheckFailures(sha, [{ check_runs: passed }, { check_runs: [{ ...passed[0], id: 999, status, conclusion: "failure" }] }])).toHaveLength(1);
});

const parentNative = { id: 100, name: "parent-native-security", head_sha: sha, status: "completed", conclusion: "success", app: { id: 15368 } };
it.each([
  ["missing", null],
  ["failed", { ...parentNative, conclusion: "failure" }],
  ["skipped", { ...parentNative, conclusion: "skipped" }],
  ["pending", { ...parentNative, status: "in_progress", conclusion: null }],
  ["another commit", { ...parentNative, head_sha: "b".repeat(40) }],
  ["an untrusted provider", { ...parentNative, app: { id: 999 } }],
])("blocks release when parent-native-security is %s", (_condition, native) => {
  const check_runs = [...passed.filter(check => check.name !== "parent-native-security"), ...(native ? [native] : [])];
  expect(releaseCheckFailures(sha, [{ check_runs }])).toEqual([expect.stringContaining("parent-native-security:")]);
});
