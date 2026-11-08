import { expect, it } from "vitest";
import { validateConnectedProbeFixture } from "./parent-connected-probe-fixture";
const fixture = {
  purpose: "caselink-connected-synthetic-probe",
  projectUrl: "https://zpfypkizsapvsxeykmdq.supabase.co",
  origin: "http://127.0.0.1:3200",
  authUserId: "11111111-1111-4111-8111-111111111111",
  email: "parent-connected-22222222-2222-4222-8222-222222222222@example.test",
  password: "synthetic-password-only",
};
it("limits the connected smoke to an explicitly marked disposable identity and exact provider/site", () => {
  expect(validateConnectedProbeFixture(fixture)).toEqual(fixture);
  for (const change of [
    { email: "real-user@example.test" },
    { projectUrl: "https://other.supabase.co" },
    { origin: "https://public.example.test" },
    { password: "short" },
    { purpose: undefined },
    { serviceRole: "private-canary" },
  ]) {
    expect(() =>
      validateConnectedProbeFixture({ ...fixture, ...change }),
    ).toThrow("exact disposable");
  }
});
