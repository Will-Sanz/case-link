import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security/response-headers";
import { productionPostureIssues } from "./src/lib/security/production-posture";

const production = process.env.NODE_ENV === "production";
const productionDeployment =
  process.env.VERCEL_ENV === "production"
  || process.env.CASELINK_ENVIRONMENT === "production";
if (productionDeployment) {
  const postureIssues = productionPostureIssues({
    CASELINK_TENANCY_MODE: process.env.CASELINK_TENANCY_MODE,
    CASELINK_PDF_MODE: process.env.CASELINK_PDF_MODE,
    CASELINK_INVITE_ONLY: process.env.CASELINK_INVITE_ONLY,
    CASELINK_HSTS: process.env.CASELINK_HSTS,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_DEBUG: process.env.OPENAI_DEBUG,
    OPENAI_PAYLOAD_DEBUG: process.env.OPENAI_PAYLOAD_DEBUG,
    PLAN_REGENERATE_DEBUG: process.env.PLAN_REGENERATE_DEBUG,
    PLAN_REFINE_DEBUG: process.env.PLAN_REFINE_DEBUG,
  });
  if (postureIssues.length > 0) {
    throw new Error(`Unsafe production posture:\n${postureIssues.join("\n")}`);
  }
}
const securityHeaders = buildSecurityHeaders({
  production,
  enableHsts: productionDeployment && process.env.CASELINK_HSTS === "1",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
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
