import { afterEach, expect, it, vi } from "vitest";
import { parentTestEnvironment } from "./parent-test-environment.mjs";
afterEach(() => vi.unstubAllEnvs());
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
