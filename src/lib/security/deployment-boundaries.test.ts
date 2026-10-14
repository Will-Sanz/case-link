import { expect, it } from "vitest";
import { deploymentBoundaryIssues } from "./deployment-boundaries";

const production = { NODE_ENV: "production", VERCEL_ENV: "production", CASELINK_ENVIRONMENT: "production", CASELINK_TENANCY_MODE: "single-tenant", CASELINK_INVITE_ONLY: "1", CASELINK_HSTS: "1", NEXT_PUBLIC_SITE_URL: "https://app.example.edu", NEXT_PUBLIC_SUPABASE_URL: "https://production-test.supabase.co", CASELINK_PRODUCTION_SUPABASE_URL: "https://production-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key", OPENAI_API_KEY: "synthetic-private-canary" };
it("accepts isolated production and preview while keeping local test services usable", () => {
  expect(deploymentBoundaryIssues(production)).toEqual([]);
  expect(deploymentBoundaryIssues({ ...production, VERCEL_ENV: "preview", CASELINK_ENVIRONMENT: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://staging-test.supabase.co" })).toEqual([]);
  expect(deploymentBoundaryIssues({ NODE_ENV: "production", VERCEL_ENV: "development", CASELINK_ENVIRONMENT: "test", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toEqual([]);
});
it("rejects missing, shared, mislabelled or swapped hosted projects", () => {
  for (const patch of [{ CASELINK_PRODUCTION_SUPABASE_URL: "" }, { NEXT_PUBLIC_SUPABASE_URL: "https://staging-test.supabase.co" }, { VERCEL_ENV: "preview", CASELINK_ENVIRONMENT: "preview" }, { VERCEL_ENV: "preview" }])
    expect(deploymentBoundaryIssues({ ...production, ...patch }).length).toBeGreaterThan(0);
});
it.each(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"])("rejects %s without printing its value", name => {
  const errors = deploymentBoundaryIssues({ ...production, [name]: "private-operator-canary" });
  expect(errors.join(" ")).toContain(name);
  expect(errors.join(" ")).not.toContain("private-operator-canary");
});
it("rejects secret or legacy service-role credentials in a public variable", () => {
  for (const key of ["sb_secret_synthetic", `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`])
    expect(deploymentBoundaryIssues({ ...production, NEXT_PUBLIC_SUPABASE_ANON_KEY: key }).join(" ")).toMatch(/public Supabase key/);
});
