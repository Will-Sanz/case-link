import { afterEach, expect, it, vi } from "vitest";
import SignInPage from "./page";
afterEach(() => vi.unstubAllEnvs());
it("offers the existing reset route only when explicitly reusing those accounts", async () => {
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  const shared = await SignInPage({
    searchParams: Promise.resolve({
      message: "password-reset-success",
      next: "/my-support",
    }),
  });
  expect(shared.props.existingAccountRecovery).toBe(true);
  expect(shared.props.authNotice).toBe("password-reset-success");
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "isolated");
  const isolated = await SignInPage({
    searchParams: Promise.resolve({
      message: "provider-secret",
      error: "provider-secret",
    }),
  });
  expect(isolated.props.existingAccountRecovery).toBe(false);
  expect(isolated.props.authNotice).toBeUndefined();
});
