import { describe, expect, it } from "vitest";
import { applyRuntimeHsts, buildSecurityHeaders } from "@/lib/security/response-headers";

describe("buildSecurityHeaders", () => {
  it("enforces the production CSP and HSTS", () => {
    const headers = Object.fromEntries(
      buildSecurityHeaders({
        production: true,
        enableHsts: true,
        supabaseUrl: "https://project.supabase.co",
      }).map(({ key, value }) => [key, value]),
    );
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("https://project.supabase.co");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=63072000");
  });

  it("adds HSTS at runtime only for an enabled production deployment", () => {
    const productionHeaders = new Headers();
    applyRuntimeHsts(productionHeaders, { productionDeployment: true, enableHsts: true });
    expect(productionHeaders.get("Strict-Transport-Security")).toContain("max-age=63072000");

    const previewHeaders = new Headers();
    applyRuntimeHsts(previewHeaders, { productionDeployment: false, enableHsts: true });
    expect(previewHeaders.has("Strict-Transport-Security")).toBe(false);
  });
});
