import { isIP } from "node:net";
import { canonicalProjectOrigin, isLoopbackHost } from "./project-origin";

/** The single-host pilot keeps its private broker on loopback; database authority stays independent. */
export function hostedParentServiceAllowed(
  env: Record<string, string | undefined>, databaseUrl: string, projectUrl: string, brokerOrigin: string,
  now = Date.now(),
): boolean {
  try {
    const project = canonicalProjectOrigin(projectUrl), site = canonicalProjectOrigin(env.NEXT_PUBLIC_SITE_URL);
    const ref = project && /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(project)?.[1];
    const db = new URL(databaseUrl), host = site ? new URL(site).hostname : "";
    const until = Date.parse(env.CASELINK_PARENT_HOSTED_APPROVED_UNTIL ?? "");
    return Boolean(ref && projectUrl === project && site === env.NEXT_PUBLIC_SITE_URL && site?.startsWith("https:")
      && host.includes(".") && !isLoopbackHost(host) && !host.endsWith(".localhost") && !isIP(host.replace(/^\[|\]$/g, ""))
      && env.CASELINK_ENVIRONMENT === "production" && env.CASELINK_PARENT_ACCOUNT_MODE === "existing"
      && !env.VERCEL && !env.VERCEL_ENV && !env.CASELINK_PARENT_CONNECTED_APPROVED
      && env.CASELINK_PARENT_HOSTED_APPROVED === "1"
      && (env.CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE?.trim().length ?? 0) > 0
      && (env.CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE?.length ?? 0) <= 1000
      && Number.isFinite(now) && until > now
      && project === env.CASELINK_SCHOOL_SUPABASE_URL && project === env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL
      && brokerOrigin === "http://127.0.0.1:3310"
      && ["postgres:", "postgresql:"].includes(db.protocol) && db.hostname === `db.${ref}.supabase.co`
      && ["", "5432"].includes(db.port) && db.pathname === "/postgres" && !db.hash && Boolean(db.password)
      && /^caselink_[a-z0-9_]{1,54}$/.test(decodeURIComponent(db.username))
      && db.searchParams.getAll("sslmode").length === 1 && db.searchParams.get("sslmode") === "verify-full"
      && [...db.searchParams.keys()].every(key => ["sslmode", "sslrootcert"].includes(key) && db.searchParams.getAll(key).length === 1));
  } catch { return false; }
}
