import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/response-headers";
import { deploymentBoundaryIssues } from "./src/lib/security/deployment-boundaries";

const production = process.env.NODE_ENV === "production";
const productionDeployment =
  process.env.VERCEL_ENV === "production"
  || process.env.CASELINK_ENVIRONMENT === "production";
const postureIssues = deploymentBoundaryIssues(process.env);
if (postureIssues.length > 0) throw new Error(`Unsafe hosted configuration:\n${postureIssues.join("\n")}`);
const securityHeaders = buildSecurityHeaders({
  production,
  enableHsts: productionDeployment && process.env.CASELINK_HSTS === "1",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Compiler caches can retain server environment values.
    turbopackFileSystemCacheForBuild: false,
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
