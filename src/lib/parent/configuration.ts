import {
  canonicalProjectOrigin,
  isLoopbackHost,
  parentProjectIsolationIssues,
} from "./project-origin";
export type ParentEnvironment = Record<string, string | undefined>;
export function parentEmailCodeEnabled(env: ParentEnvironment): boolean {
  return (
    env.CASELINK_PARENT_ACCOUNT_MODE !== "existing" ||
    env.CASELINK_PARENT_EMAIL_CODE_ENABLED === "1"
  );
}
export class ParentConfigurationError extends Error {
  constructor(
    message = "Parent support is not configured for this environment.",
  ) {
    super(message);
    this.name = "ParentConfigurationError";
  }
}
export function publicKeyIsSafe(key: string): boolean {
  if (key.startsWith("sb_secret_")) return false;
  if (key.startsWith("sb_publishable_")) return true;
  try {
    return (
      JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
        .role === "anon"
    );
  } catch {
    return false;
  }
}
export function parentConfigurationIssues(env: ParentEnvironment): string[] {
  const issues: string[] = [];
  if (env.CASELINK_PRODUCT !== "parent")
    issues.push("CASELINK_PRODUCT must explicitly select parent support");
  const origin = canonicalProjectOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const loopback = Boolean(origin && isLoopbackHost(new URL(origin).hostname));
  const target = ["production", "preview"].includes(env.VERCEL_ENV ?? "")
    ? env.VERCEL_ENV
    : env.CASELINK_ENVIRONMENT;
  const hosted = target === "production" || target === "preview";
  const connected = env.CASELINK_ENVIRONMENT === "connected";
  if (connected) {
    if (
      target !== "connected" ||
      env.VERCEL ||
      (env.VERCEL_ENV && env.VERCEL_ENV !== "development")
    )
      issues.push(
        "Connected parent access is restricted to a local owner runtime",
      );
    if (env.CASELINK_PARENT_CONNECTED_APPROVED !== "1")
      issues.push("Connected parent access requires explicit owner approval");
    if (env.NEXT_PUBLIC_SITE_URL !== "http://127.0.0.1:3200")
      issues.push(
        "Connected parent access requires the exact loopback site on port 3200",
      );
    const recovery = canonicalProjectOrigin(
      env.CASELINK_PARENT_RECOVERY_SITE_URL,
    );
    if (
      !recovery?.startsWith("https://") ||
      isLoopbackHost(new URL(recovery).hostname) ||
      recovery !== env.CASELINK_PARENT_RECOVERY_SITE_URL
    )
      issues.push(
        "Connected parent recovery requires the existing exact HTTPS site origin",
      );
  }
  issues.push(
    ...parentProjectIsolationIssues({
      projectUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
      parentProductionUrl:
        env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ??
        env.CASELINK_PRODUCTION_SUPABASE_URL,
      environment: target,
      accountMode: env.CASELINK_PARENT_ACCOUNT_MODE,
    }),
  );
  if (
    !publicKeyIsSafe(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        "",
    ) ||
    [
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ].some((key) => key !== undefined && key !== "" && !publicKeyIsSafe(key))
  )
    issues.push("A public Supabase publishable or anonymous key is required");
  if (!loopback && !connected && env.CASELINK_PARENT_REAL_DATA_APPROVED !== "1")
    issues.push(
      "Hosted parent processing requires the documented real-data release gate",
    );
  if (hosted) {
    if (env.CASELINK_ENVIRONMENT !== target)
      issues.push("The parent environment must match the hosted environment");
    if (loopback || !origin?.startsWith("https:"))
      issues.push(
        "Hosted parent support must use HTTPS and cannot use a local database",
      );
    const site = canonicalProjectOrigin(env.NEXT_PUBLIC_SITE_URL);
    if (
      !site?.startsWith("https:") ||
      isLoopbackHost(new URL(site).hostname) ||
      env.NEXT_PUBLIC_SITE_URL !== site
    )
      issues.push("NEXT_PUBLIC_SITE_URL must be an exact HTTPS origin");
    if (env.CASELINK_HSTS !== "1")
      issues.push(
        "CASELINK_HSTS must be 1 for the HTTPS-only parent deployment",
      );
    for (const name of [
      "OPENAI_DEBUG",
      "OPENAI_PAYLOAD_DEBUG",
      "PLAN_REGENERATE_DEBUG",
      "PLAN_REFINE_DEBUG",
    ])
      if (env[name] === "1") issues.push(`${name} must be disabled`);
  } else if (!loopback && !connected && env.CASELINK_ENVIRONMENT !== "test")
    issues.push(
      "Local parent development must use a local project or an explicit synthetic test environment",
    );
  for (const name of [
    "OPENAI_API_KEY",
    "RESEND_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "CASELINK_PARENT_WORKER_DATABASE_URL",
    "CASELINK_PARENT_RETENTION_DATABASE_URL",
    "CASELINK_PARENT_RETENTION_STORAGE_KEY",
    "CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL",
    "CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY",
    "CASELINK_PARENT_STORAGE_BROKER_SECRET",
  ])
    if (env[name]?.trim())
      issues.push(`${name} belongs in an isolated operator or worker runtime`);
  return issues;
}
