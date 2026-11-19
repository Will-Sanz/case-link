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
  it("permits only explicitly approved loopback connected access to the exact existing provider", () => {
    const connected = { ...hosted, VERCEL_ENV: "development", CASELINK_ENVIRONMENT: "connected", CASELINK_PARENT_ACCOUNT_MODE: "existing", CASELINK_PARENT_CONNECTED_APPROVED: "1", CASELINK_SCHOOL_SUPABASE_URL: hosted.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200", CASELINK_PARENT_RECOVERY_SITE_URL: "https://old.example.test", CASELINK_PARENT_REAL_DATA_APPROVED: undefined };
    expect(parentConfigurationIssues(connected)).toEqual([]);
    for (const change of [{ CASELINK_PARENT_CONNECTED_APPROVED: undefined }, { CASELINK_PARENT_ACCOUNT_MODE: "isolated" }, { CASELINK_PARENT_PRODUCTION_SUPABASE_URL: "https://other.supabase.co" }, { CASELINK_SCHOOL_SUPABASE_URL: "https://other.supabase.co" }, { NEXT_PUBLIC_SITE_URL: "http://localhost:3200" }, { NEXT_PUBLIC_SITE_URL: "https://public.example.test" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { VERCEL: "1" }, { CASELINK_PARENT_RECOVERY_SITE_URL: "https://old.example.test/path" }, { SUPABASE_SERVICE_ROLE_KEY: "private-canary" }])
      expect(parentConfigurationIssues({ ...connected, ...change }).length).toBeGreaterThan(0);
    for (const environment of ["test", "preview"])
      expect(parentConfigurationIssues({ ...connected, VERCEL_ENV: environment === "preview" ? "preview" : "development", CASELINK_ENVIRONMENT: environment }).join()).toContain("synthetic");
  });
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
  it("rejects an unsafe alternate public key even when the preferred key is valid", () => {
    const serviceRole = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    for (const environment of [
      local,
      hosted,
      {
        ...hosted,
        CASELINK_PARENT_ACCOUNT_MODE: "existing",
        CASELINK_SCHOOL_SUPABASE_URL: hosted.NEXT_PUBLIC_SUPABASE_URL,
      },
    ]) {
      for (const alternate of ["sb_secret_synthetic_private", serviceRole]) {
        const issues = parentConfigurationIssues({
          ...environment,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: alternate,
        });
        expect(issues.join()).toContain("public Supabase");
        expect(issues.join()).not.toContain(alternate);
      }
    }
  });
  it("accepts two public key forms without changing the preferred server key", () => {
    const anonymous = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
    expect(
      getParentConfig({ ...local, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonymous })
        .supabaseKey,
    ).toBe(local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(
      parentConfigurationIssues({
        ...local,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toEqual([]);
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
  it("reuses the approved existing identity project only with explicit account mode", () => {
    const shared = {
      ...hosted,
      NEXT_PUBLIC_SUPABASE_URL: "https://school.supabase.co",
      CASELINK_PARENT_PRODUCTION_SUPABASE_URL: undefined,
      CASELINK_PRODUCTION_SUPABASE_URL: "https://school.supabase.co",
      CASELINK_PARENT_ACCOUNT_MODE: "existing",
    };
    expect(parentConfigurationIssues(shared)).toEqual([]);
    expect(
      parentConfigurationIssues({
        ...shared,
        CASELINK_PARENT_ACCOUNT_MODE: undefined,
      }).join(),
    ).toContain("separate");
    expect(
      parentConfigurationIssues({
        ...shared,
        VERCEL_ENV: "preview",
        CASELINK_ENVIRONMENT: "preview",
      }).join(),
    ).toContain("synthetic");
    expect(
      parentConfigurationIssues({
        ...shared,
        NEXT_PUBLIC_SUPABASE_URL: "https://unexpected.supabase.co",
      }).join(),
    ).toContain("existing CaseLink");
    expect(
      parentConfigurationIssues({
        ...shared,
        CASELINK_PARENT_REAL_DATA_APPROVED: "0",
      }).join(),
    ).toContain("release gate");
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
    for (const name of ["OPENAI_API_KEY", "RESEND_API_KEY", "CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID", "CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY", "CASELINK_PARENT_STORAGE_BROKER_S3_REGION"])
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
