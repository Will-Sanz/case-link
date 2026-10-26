import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/dist/server/web/spec-extension/request";

const mocks = vi.hoisted(() => ({
  issues: vi.fn(() => [] as string[]),
  create: vi.fn(),
}));
vi.mock("./configuration", () => ({ parentConfigurationIssues: mocks.issues }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
import { runSupabaseProxy } from "../supabase/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("parent session responses", () => {
  it("uses the same validated connected loopback cookie policy as the parent server client", async () => {
    vi.stubEnv("CASELINK_PRODUCT", "parent");
    vi.stubEnv("CASELINK_ENVIRONMENT", "connected");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://existing.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_synthetic",
    );
    mocks.issues.mockReturnValue([]);
    mocks.create.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    await runSupabaseProxy(new NextRequest("http://127.0.0.1:3200/sign-in"));
    expect(mocks.create.mock.lastCall?.[2].cookieOptions).toMatchObject({
      secure: false,
      httpOnly: true,
      sameSite: "lax",
    });
  });
  it("keeps rotated session credentials inaccessible to JavaScript and uncached on public routes", async () => {
    vi.stubEnv("CASELINK_PRODUCT", "parent");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://parent.example.test");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_synthetic",
    );
    mocks.issues.mockReturnValue([]);
    mocks.create.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            {
              name: "caselink-parent-auth",
              value: "synthetic-rotation",
              options: options.cookieOptions,
            },
          ]);
          return { data: { user: null } };
        },
      },
    }));
    const result = await runSupabaseProxy(
      new NextRequest("https://app.example.test/support/privacy"),
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.cookies.get("caselink-parent-auth")).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  });
  it("does not cache an intake-disabled parent response", async () => {
    vi.stubEnv("CASELINK_PRODUCT", "parent");
    mocks.issues.mockReturnValue(["not approved"]);
    const result = await runSupabaseProxy(
      new NextRequest("https://app.example.test/"),
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
