import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { parentTestEnvironment } from "./parent-test-environment.mjs";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("keeps the preview and verification synthetic and strips inherited live credentials", () => {
  vi.stubEnv("OPENAI_API_KEY", "private-model-key");
  vi.stubEnv("RESEND_API_KEY", "private-email-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://live.example.test");
  vi.stubEnv("CASELINK_PARENT_REAL_DATA_APPROVED", "1");
  const environment = parentTestEnvironment();
  expect(environment.OPENAI_API_KEY).toBe("");
  expect(environment.RESEND_API_KEY).toBe("");
  expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:55321");
  expect(environment.CASELINK_PRODUCT).toBe("parent");
  expect(environment.CASELINK_PARENT_REAL_DATA_APPROVED).toBeUndefined();
  expect(JSON.stringify(environment)).not.toContain("private-model-key");
});

const localStatus = {
  API_URL: "http://127.0.0.1:55321",
  DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/postgres",
  MAILPIT_URL: "http://127.0.0.1:55324",
  ANON_KEY: `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`,
  SERVICE_ROLE_KEY: "private-operator-key",
};
it("uses actual local public credentials only when deliberately selected", () => {
  vi.stubEnv("CASELINK_SUPABASE_CLI", "/synthetic-cli");
  vi.mocked(execFileSync).mockReturnValue(JSON.stringify(localStatus));
  const env = parentTestEnvironment(true);
  expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(localStatus.ANON_KEY);
  expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(localStatus.ANON_KEY);
  expect(JSON.stringify(env)).not.toContain("private-operator-key");
  expect(env.OPENAI_API_KEY).toBe("");
});
it.each([
  { ...localStatus, API_URL: "https://production.example.test" },
  {
    ...localStatus,
    DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres",
  },
  {
    ...localStatus,
    ANON_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
  },
])(
  "rejects unsafe actual-service targets or privileged web credentials",
  (status) => {
    vi.stubEnv("CASELINK_SUPABASE_CLI", "/synthetic-cli");
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify(status));
    expect(() => parentTestEnvironment(true)).toThrow();
  },
);
