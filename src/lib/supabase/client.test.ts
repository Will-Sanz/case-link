import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.create }));
import { createSupabaseBrowserClient } from "./client";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("reuses the legacy public key and supports publishable-only recovery environments", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-legacy-anon");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_synthetic",
  );
  createSupabaseBrowserClient();
  expect(mocks.create.mock.calls[0][1]).toBe("synthetic-legacy-anon");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
  createSupabaseBrowserClient();
  expect(mocks.create.mock.calls[1][1]).toBe("sb_publishable_synthetic");
  expect(mocks.create.mock.calls[1][2].global.fetch).toBeTypeOf("function");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  createSupabaseBrowserClient();
  expect(mocks.create.mock.calls[2][1]).toBe("sb_publishable_synthetic");
});
