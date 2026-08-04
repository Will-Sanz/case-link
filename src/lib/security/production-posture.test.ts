import { describe, expect, it } from "vitest";
import { productionPostureIssues } from "@/lib/security/production-posture";

describe("productionPostureIssues", () => {
  it("accepts the approved V1 deployment posture", () => {
    expect(
      productionPostureIssues({
        CASELINK_TENANCY_MODE: "single-tenant",
        CASELINK_PDF_MODE: "fillable-only",
        CASELINK_INVITE_ONLY: "1",
        CASELINK_HSTS: "1",
        NEXT_PUBLIC_SITE_URL: "https://app.example.edu",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-public-placeholder",
        OPENAI_API_KEY: "ci-openai-placeholder",
      }),
    ).toEqual([]);
  });

  it("rejects unsafe or ambiguous production settings", () => {
    expect(
      productionPostureIssues({
        CASELINK_TENANCY_MODE: "shared",
        CASELINK_PDF_MODE: "scanned",
        CASELINK_INVITE_ONLY: "0",
        CASELINK_HSTS: "0",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        OPENAI_PAYLOAD_DEBUG: "1",
        OPENAI_DEBUG: "1",
        PLAN_REGENERATE_DEBUG: "1",
        PLAN_REFINE_DEBUG: "1",
      }),
    ).toHaveLength(12);
  });

  it.each([
    "https://app.example.edu/path",
    "https://user:password@app.example.edu",
    "https://app.example.edu?next=elsewhere",
    "https://app.example.edu#fragment",
    " https://app.example.edu",
  ])("rejects a site URL that is not an exact origin: %s", (siteUrl) => {
    const issues = productionPostureIssues({
      CASELINK_TENANCY_MODE: "single-tenant",
      CASELINK_PDF_MODE: "fillable-only",
      CASELINK_INVITE_ONLY: "1",
      CASELINK_HSTS: "1",
      NEXT_PUBLIC_SITE_URL: siteUrl,
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-public-placeholder",
      OPENAI_API_KEY: "ci-openai-placeholder",
    });
    expect(issues).toContain("NEXT_PUBLIC_SITE_URL must be an explicit HTTPS origin");
  });
});
