export function validateTestProvisioning(input: {
  environment?: string;
  url?: string;
  email?: string;
  password?: string;
}): string[] {
  const issues: string[] = [];
  if (input.environment !== "local" && input.environment !== "test") {
    issues.push("CASELINK_ENVIRONMENT must be local or test");
  }
  if (!input.email?.trim()) issues.push("CASELINK_TEST_EMAIL is required");
  if (!input.password || input.password.length < 14) {
    issues.push("CASELINK_TEST_PASSWORD must be at least 14 characters");
  }
  if (input.environment === "local" && input.url) {
    try {
      const host = new URL(input.url).hostname;
      if (host !== "localhost" && host !== "127.0.0.1") {
        issues.push("local test provisioning requires a localhost Supabase URL");
      }
    } catch {
      issues.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
    }
  }
  return issues;
}

export type ProvisioningRole = "case_manager" | "admin";

export function parseInviteSiteOrigin(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL is required for invitation links");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a valid origin");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (!localHttp && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || raw !== url.origin
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an exact HTTPS origin");
  }
  return url.origin;
}

export function parseProvisioningRole(value: string | undefined): ProvisioningRole {
  const role = value?.trim() || "case_manager";
  if (role !== "case_manager" && role !== "admin") {
    throw new Error("CASELINK_INVITE_ROLE must be case_manager or admin");
  }
  return role;
}
