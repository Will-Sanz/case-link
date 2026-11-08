import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.session }));
vi.mock("@/components/layout/auth-shell", () => ({ AuthShell: () => null }));
vi.mock("@/features/auth/login-form", () => ({ LoginForm: () => null }));
import LoginPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe("shared-account recovery return", () => {
  it.each([
    [
      { message: "password-reset-success" },
      "/sign-in?message=password-reset-success",
    ],
    [{ error: "auth" }, "/sign-in?error=auth"],
    [
      {
        message: "https://other.test",
        error: "provider-secret",
        next: "//other.test",
      },
      "/sign-in",
    ],
  ])(
    "returns to parent sign-in with only supported notices",
    async (query, target) => {
      vi.stubEnv("CASELINK_PRODUCT", "parent");
      vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
      await expect(
        LoginPage({ searchParams: Promise.resolve(query) }),
      ).rejects.toThrow(`redirect:${target}`);
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it("keeps the school login and school-session behavior unchanged", async () => {
    vi.stubEnv("CASELINK_PRODUCT", "school");
    vi.stubEnv("CASELINK_PARENT_ACCOUNT_MODE", "existing");
    expect(await LoginPage({ searchParams: Promise.resolve({}) })).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ id: "synthetic" });
    await expect(
      LoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect:/families");
  });
});
