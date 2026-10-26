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
  expect(shared.props.emailCodeAvailable).toBe(false);
  expect(shared.props.authNotice).toBe("password-reset-success");
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "isolated");
  const isolated = await SignInPage({
    searchParams: Promise.resolve({
      message: "provider-secret",
      error: "provider-secret",
    }),
  });
  expect(isolated.props.existingAccountRecovery).toBe(false);
  expect(isolated.props.emailCodeAvailable).toBe(true);
  expect(isolated.props.authNotice).toBeUndefined();
});
it("uses the original provider recovery site for the connected local account experience", async () => {
  vi.stubEnv("CASELINK_ENVIRONMENT", "connected");
  vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
  vi.stubEnv(
    "CASELINK_PARENT_RECOVERY_SITE_URL",
    "https://www.old.example.test",
  );
  const page = await SignInPage({ searchParams: Promise.resolve({}) });
  expect(page.props.recoveryHref).toBe(
    "https://www.old.example.test/forgot-password",
  );
  expect(page.props.emailCodeAvailable).toBe(false);
});
