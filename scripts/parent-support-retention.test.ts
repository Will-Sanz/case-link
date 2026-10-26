import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), storage: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    constructor() {
      mocks.client();
    }
    async connect() {}
    async query() {
      return { rows: [] };
    }
    async end() {}
  },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.storage }));
const originalExit = process.exitCode;
afterEach(() => {
  process.exitCode = originalExit;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it.each([
  "db.other.supabase.co:5432/postgres?sslmode=verify-full",
  "db.approved.supabase.co:5432/postgres?sslmode=verify-full&sslmode=no-verify",
])(
  "rejects an unsafe standalone connected retention target before creating privileged clients: %s",
  async (target) => {
    vi.resetModules();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const [key, value] of Object.entries({
      CASELINK_PRODUCT: "parent",
      CASELINK_ENVIRONMENT: "connected",
      CASELINK_PARENT_ACCOUNT_MODE: "existing",
      CASELINK_PARENT_CONNECTED_APPROVED: "1",
      CASELINK_PARENT_RETENTION_APPROVED: "1",
      CASELINK_PARENT_RETENTION_DATABASE_URL: `postgresql://restricted:synthetic@${target}`,
      CASELINK_PARENT_RETENTION_SUPABASE_URL: "https://approved.supabase.co",
      CASELINK_PARENT_RETENTION_STORAGE_KEY: "synthetic-storage-key",
      CASELINK_SCHOOL_SUPABASE_URL: "https://approved.supabase.co",
      CASELINK_PARENT_PRODUCTION_SUPABASE_URL: "https://approved.supabase.co",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
      VERCEL: "",
      VERCEL_ENV: "development",
    }))
      vi.stubEnv(key, value);
    await import("./parent-support-retention");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
  },
);
