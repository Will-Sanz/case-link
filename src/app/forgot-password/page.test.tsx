import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
  config: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/parent/config", () => ({ getParentConfig: mocks.config }));
import ForgotPasswordPage from "./page";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("keeps connected reset requests on the original site's PKCE and allowed callback", () => {
  vi.stubEnv("CASELINK_PRODUCT", "parent");
  vi.stubEnv("CASELINK_ENVIRONMENT", "connected");
  vi.stubEnv(
    "CASELINK_PARENT_RECOVERY_SITE_URL",
    "https://www.old.example.test",
  );
  expect(() => ForgotPasswordPage()).toThrow("redirected");
  expect(mocks.config).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith(
    "https://www.old.example.test/forgot-password",
  );
});
it("preserves the school and non-connected recovery page", () => {
  vi.stubEnv("CASELINK_PRODUCT", "school");
  vi.stubEnv("CASELINK_ENVIRONMENT", "production");
  expect(ForgotPasswordPage()).toBeTruthy();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
