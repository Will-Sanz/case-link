export type ProductionPosture = {
  CASELINK_TENANCY_MODE?: string;
  CASELINK_PDF_MODE?: string;
  CASELINK_INVITE_ONLY?: string;
  CASELINK_HSTS?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_DEBUG?: string;
  OPENAI_PAYLOAD_DEBUG?: string;
  PLAN_REGENERATE_DEBUG?: string;
  PLAN_REFINE_DEBUG?: string;
};

function isExactHttpsOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.pathname === "/"
      && url.search === ""
      && url.hash === ""
      && value === url.origin;
  } catch {
    return false;
  }
}

export function productionPostureIssues(env: ProductionPosture): string[] {
  const issues: string[] = [];
  if (env.CASELINK_TENANCY_MODE !== "single-tenant") {
    issues.push("CASELINK_TENANCY_MODE must be single-tenant");
  }
  if (env.CASELINK_PDF_MODE !== "fillable-only") {
    issues.push("CASELINK_PDF_MODE must be fillable-only");
  }
  if (env.CASELINK_INVITE_ONLY !== "1") {
    issues.push("CASELINK_INVITE_ONLY must be 1");
  }
  if (env.CASELINK_HSTS !== "1") {
    issues.push("CASELINK_HSTS must be 1 after the production domain is HTTPS-only");
  }
  if (!isExactHttpsOrigin(env.NEXT_PUBLIC_SITE_URL)) {
    issues.push("NEXT_PUBLIC_SITE_URL must be an explicit HTTPS origin");
  }
  if (!isExactHttpsOrigin(env.NEXT_PUBLIC_SUPABASE_URL)) {
    issues.push("NEXT_PUBLIC_SUPABASE_URL must be an explicit HTTPS origin");
  }
  if ((env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim().length ?? 0) < 10) {
    issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");
  }
  if ((env.OPENAI_API_KEY?.trim().length ?? 0) < 10) {
    issues.push("OPENAI_API_KEY must be configured for the Core workflow");
  }
  if (env.OPENAI_PAYLOAD_DEBUG === "1") {
    issues.push("OPENAI_PAYLOAD_DEBUG must be disabled");
  }
  if (env.OPENAI_DEBUG === "1") {
    issues.push("OPENAI_DEBUG must be disabled");
  }
  if (env.PLAN_REGENERATE_DEBUG === "1") {
    issues.push("PLAN_REGENERATE_DEBUG must be disabled");
  }
  if (env.PLAN_REFINE_DEBUG === "1") {
    issues.push("PLAN_REFINE_DEBUG must be disabled");
  }
  return issues;
}
