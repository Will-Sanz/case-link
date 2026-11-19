import {
  productionPostureIssues,
  type ProductionPosture,
} from "./production-posture";
import { parentConfigurationIssues } from "../parent/configuration";

type DeploymentEnvironment = ProductionPosture & {
  CASELINK_PRODUCT?: string;
  CASELINK_SCHOOL_SUPABASE_URL?: string;
  CASELINK_PARENT_PRODUCTION_SUPABASE_URL?: string;
  CASELINK_PARENT_REAL_DATA_APPROVED?: string;
  CASELINK_PARENT_ACCOUNT_MODE?: string;
  CASELINK_PARENT_CONNECTED_APPROVED?: string;
  CASELINK_PARENT_RECOVERY_SITE_URL?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VERCEL?: string;
  CASELINK_ENVIRONMENT?: string;
  CASELINK_PRODUCTION_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
  POSTGRES_URL_NON_POOLING?: string;
};

/** Checked at build and runtime; values never appear in failure messages. */
export function deploymentBoundaryIssues(env: DeploymentEnvironment): string[] {
  const target =
    env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview"
      ? env.VERCEL_ENV
      : env.CASELINK_ENVIRONMENT;
  if (target === "connected" && env.CASELINK_PRODUCT === "parent")
    return parentConfigurationIssues({ ...env });
  if (target !== "production" && target !== "preview") return [];
  if (env.CASELINK_PRODUCT === "parent")
    return parentConfigurationIssues({ ...env });
  const issues = productionPostureIssues(env);
  if (env.CASELINK_ENVIRONMENT !== target)
    issues.push(
      "CASELINK_ENVIRONMENT must match the hosted deployment environment",
    );
  const approved = env.CASELINK_PRODUCTION_SUPABASE_URL;
  if (!approved || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(approved)) {
    issues.push(
      "CASELINK_PRODUCTION_SUPABASE_URL must identify the approved production Supabase project",
    );
  } else if (
    target === "production" &&
    env.NEXT_PUBLIC_SUPABASE_URL !== approved
  ) {
    issues.push("Production must use its approved Supabase project");
  } else if (
    target === "preview" &&
    env.NEXT_PUBLIC_SUPABASE_URL === approved
  ) {
    issues.push("Preview must use a separate synthetic Supabase project");
  }
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
  ] as const) {
    if (env[name]?.trim())
      issues.push(
        `${name} belongs in a protected operator job, not the web deployment`,
      );
  }
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (key.startsWith("sb_secret_"))
    issues.push("The public Supabase key must not be a secret key");
  try {
    const claims = JSON.parse(
      atob(key.split(".")[1]?.replaceAll("-", "+").replaceAll("_", "/") ?? ""),
    );
    if (claims.role === "service_role")
      issues.push("The public Supabase key must not carry the service role");
  } catch {
    /* Publishable keys have no JWT payload. Provider authentication validates the key. */
  }
  return issues;
}
