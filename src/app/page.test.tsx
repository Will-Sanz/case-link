import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parent: vi.fn(), configured: vi.fn(), school: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ getParentSession: mocks.parent }));
vi.mock("@/lib/parent/config", () => ({ isParentConfigured: mocks.configured }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.school }));
vi.mock("@/features/parent/parent-shell", () => ({ ParentShell: () => null }));
vi.mock("@/features/parent/landing", () => ({ ParentLanding: () => null, UrgentHelp: () => null }));
vi.mock("@/components/layout/public-site-shell", () => ({ PublicSiteShell: () => null }));
vi.mock("@/features/marketing/home-page-content", () => ({ HomePageContent: () => null }));
vi.mock("@/features/marketing/product-page-content", () => ({ ProductPageContent: () => null }));
import Home from "./page";
import Product from "./product/page";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CASELINK_PRODUCT", "parent");
  mocks.configured.mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

it.each([Home, Product])("keeps signed-in navigation and assistant context on public parent pages", async Page => {
  mocks.parent.mockResolvedValue({ user: { id: "parent" } });
  expect((await Page()).props.signedIn).toBe(true);
  expect(mocks.parent).toHaveBeenCalledOnce();
  expect(mocks.school).not.toHaveBeenCalled();
});
it("shows public navigation to a signed-out visitor", async () => {
  mocks.parent.mockResolvedValue(null);
  expect((await Home()).props.signedIn).toBe(false);
});
it("keeps the homepage available when parent authentication fails", async () => {
  mocks.parent.mockRejectedValue(new Error("unavailable"));
  expect((await Home()).props.signedIn).toBe(false);
});
it("does not contact authentication when parent configuration is unavailable", async () => {
  mocks.configured.mockReturnValue(false);
  expect((await Home()).props.signedIn).toBe(false);
  expect(mocks.parent).not.toHaveBeenCalled();
});
it("preserves the separate school homepage session", async () => {
  vi.stubEnv("CASELINK_PRODUCT", "school");
  mocks.school.mockResolvedValue({ id: "staff" });
  expect((await Home()).props.authenticated).toBe(true);
  expect(mocks.parent).not.toHaveBeenCalled();
});
