import { describe, expect, it } from "vitest";
import {
  getParentConfig,
  ParentConfigurationError,
  parentConfigurationIssues,
} from "./config";

const local = {
  CASELINK_PRODUCT: "parent",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_test",
};
const hosted = {
  ...local,
  NEXT_PUBLIC_SUPABASE_URL: "https://parent.supabase.co",
  VERCEL_ENV: "production",
  CASELINK_ENVIRONMENT: "production",
  CASELINK_PARENT_PRODUCTION_SUPABASE_URL: "https://parent.supabase.co",
  CASELINK_SCHOOL_SUPABASE_URL: "https://school.supabase.co",
  CASELINK_PARENT_REAL_DATA_APPROVED: "1",
  NEXT_PUBLIC_SITE_URL: "https://parents.example.test",
  CASELINK_HSTS: "1",
};

describe("parent purpose and environment boundary", () => {
  it("requires explicit product selection and safe public credentials", () => {
    expect(getParentConfig(local).supabaseUrl).toBe(
      local.NEXT_PUBLIC_SUPABASE_URL,
    );
    expect(() =>
      getParentConfig({ ...local, CASELINK_PRODUCT: undefined }),
    ).toThrow(ParentConfigurationError);
    expect(() =>
      getParentConfig({
        ...local,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_never_public",
      }),
    ).toThrow(ParentConfigurationError);
    const token = `a.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.b`;
    expect(() =>
      getParentConfig({
        ...local,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token,
      }),
    ).toThrow(ParentConfigurationError);
  });
  it("keeps hosted parent, school and synthetic projects separate", () => {
    expect(parentConfigurationIssues(hosted)).toEqual([]);
    expect(
      parentConfigurationIssues({
        ...hosted,
        CASELINK_SCHOOL_SUPABASE_URL: hosted.NEXT_PUBLIC_SUPABASE_URL,
      }).join(),
    ).toContain("separate");
    expect(
      parentConfigurationIssues({
        ...hosted,
        CASELINK_PARENT_REAL_DATA_APPROVED: undefined,
      }).join(),
    ).toContain("release gate");
    expect(
      parentConfigurationIssues({
        ...hosted,
        VERCEL_ENV: "preview",
        CASELINK_ENVIRONMENT: "preview",
      }).join(),
    ).toContain("synthetic");
    expect(
      parentConfigurationIssues({
        ...hosted,
        VERCEL_ENV: "preview",
        CASELINK_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
      }),
    ).toEqual([]);
  });
  it("preserves HTTPS, HSTS and real-data gates on every hosted environment", () => {
    for (const environment of ["production", "preview"]) {
      const configuration = {
        ...hosted,
        VERCEL_ENV: environment,
        CASELINK_ENVIRONMENT: environment,
        NEXT_PUBLIC_SUPABASE_URL:
          environment === "preview"
            ? "https://synthetic.supabase.co"
            : hosted.NEXT_PUBLIC_SUPABASE_URL,
      };
      expect(
        parentConfigurationIssues({
          ...configuration,
          CASELINK_PARENT_REAL_DATA_APPROVED: undefined,
        }).join(),
      ).toContain("release gate");
      expect(
        parentConfigurationIssues({
          ...configuration,
          CASELINK_HSTS: undefined,
        }).join(),
      ).toContain("HSTS");
      for (const site of [
        undefined,
        "http://parents.example.test",
        "https://parents.example.test/path",
        "https://parents.example.test/",
      ])
        expect(
          parentConfigurationIssues({
            ...configuration,
            NEXT_PUBLIC_SITE_URL: site,
          }).join(),
        ).toContain("exact HTTPS");
    }
  });
  it("rejects privileged worker credentials in the web runtime without exposing values", () => {
    const issues = parentConfigurationIssues({
      ...local,
      CASELINK_PARENT_WORKER_DATABASE_URL: "private-sensitive-value",
      SUPABASE_SERVICE_ROLE_KEY: "secret-value",
    });
    expect(issues).toHaveLength(2);
    expect(issues.join()).not.toContain("private-sensitive-value");
    expect(issues.join()).not.toContain("secret-value");
    for (const name of ["OPENAI_API_KEY", "RESEND_API_KEY"])
      expect(
        parentConfigurationIssues({
          ...local,
          [name]: "private-runtime-value",
        }).join(),
      ).toContain(`${name} belongs in an isolated`);
  });
  it("does not silently process remote real data from local development", () => {
    expect(
      parentConfigurationIssues({
        ...local,
        NEXT_PUBLIC_SUPABASE_URL: "https://unknown.supabase.co",
      }).join(),
    ).toContain("synthetic test");
    expect(
      parentConfigurationIssues({
        ...hosted,
        NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL,
      }).join(),
    ).toContain("HTTPS");
  });
});
