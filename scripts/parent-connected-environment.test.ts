import { describe, expect, it } from "vitest";
import { parentConnectedEnvironment } from "./parent-connected-environment";

const project = "https://existing.supabase.co";
const source = {
  NEXT_PUBLIC_SUPABASE_URL: project,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
  NEXT_PUBLIC_SITE_URL: "https://old.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "private-admin-canary",
  OPENAI_API_KEY: "private-model-canary",
  NEXT_PUBLIC_WRONG_SECRET: "private-file-canary",
};
const approval = {
  CASELINK_PARENT_CONNECTED_APPROVED: "1",
  CASELINK_PARENT_PRODUCTION_SUPABASE_URL: project,
  CASELINK_PARENT_RECOVERY_SITE_URL: "https://www.old.example.test",
};
describe("explicit connected parent launcher", () => {
  it("keeps only approved public file settings and safe system values", () => {
    const env = parentConnectedEnvironment(source, approval, {
      PATH: "/synthetic-bin",
      HOME: "/synthetic-home",
      RESEND_API_KEY: "private-inherited-canary",
      NODE_OPTIONS: "private-inherited-canary",
      NEXT_PUBLIC_SUPABASE_URL: "https://unexpected.supabase.co",
    });
    expect(env).toMatchObject({
      CASELINK_ENVIRONMENT: "connected",
      CASELINK_PARENT_ACCOUNT_MODE: "existing",
      NEXT_PUBLIC_SUPABASE_URL: project,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      CASELINK_PARENT_RECOVERY_SITE_URL:
        approval.CASELINK_PARENT_RECOVERY_SITE_URL,
      CASELINK_PARENT_EMAIL_CODE_ENABLED: "0",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OPENAI_API_KEY: "",
      NEXT_PUBLIC_WRONG_SECRET: "",
    });
    expect(JSON.stringify(env)).not.toContain("private-");
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });
  it("requires independent exact project approval and public credentials", () => {
    for (const system of [
      { VERCEL: "1" },
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "production" },
    ])
      expect(() =>
        parentConnectedEnvironment(source, approval, system),
      ).toThrow("hosted deployment");
    for (const overrides of [
      { CASELINK_PARENT_CONNECTED_APPROVED: undefined },
      { CASELINK_PARENT_PRODUCTION_SUPABASE_URL: undefined },
      {
        CASELINK_PARENT_PRODUCTION_SUPABASE_URL:
          "https://unexpected.supabase.co",
      },
      { CASELINK_PARENT_RECOVERY_SITE_URL: "http://127.0.0.1:3200" },
    ])
      expect(() =>
        parentConnectedEnvironment(source, { ...approval, ...overrides }, {}),
      ).toThrow("not approved");
    expect(() =>
      parentConnectedEnvironment(
        {
          ...source,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_private-canary",
        },
        approval,
        {},
      ),
    ).toThrow("public Supabase");
  });
});
