import { describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
vi.mock("./deployment-boundaries", () => ({ deploymentBoundaryIssues: () => [] }));
import nextConfig from "../../../next.config";
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
    expect(headers["Content-Security-Policy"]).toContain("'wasm-unsafe-eval'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
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

  it("keeps the SNAP signing-copy policy after global headers without changing other routes", async () => {
    const rules = await nextConfig.headers!();
    const matched = (path: string) => {
      const headers = new Headers();
      for (const rule of rules) if (getPathMatch(rule.source)(path))
        for (const { key, value } of rule.headers) headers.set(key, value);
      return headers;
    };
    const copy = matched("/api/parent/requests/11111111-1111-4111-8111-111111111111/snap-signing-copy");
    expect(copy.get("Referrer-Policy")).toBe("no-referrer");
    expect(copy.get("X-Content-Type-Options")).toBe("nosniff");
    expect(copy.get("Content-Security-Policy")).toContain("object-src 'none'");
    for (const path of ["/families", "/api/parent/requests/example/snap-application"])
      expect(matched(path).get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
