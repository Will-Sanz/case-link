import { canonicalProjectOrigin } from "./project-origin";

/** A private loopback process may reach the approved hosted project without making its listener public. */
export function connectedParentServiceAllowed(
  env: Record<string, string | undefined>,
  databaseUrl: string,
  projectUrl: string,
  brokerOrigin?: string,
): boolean {
  try {
    const database = new URL(databaseUrl);
    const project = canonicalProjectOrigin(projectUrl);
    const ref =
      project && /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(project)?.[1];
    return Boolean(
      ref &&
      env.CASELINK_ENVIRONMENT === "connected" &&
      env.CASELINK_PARENT_CONNECTED_APPROVED === "1" &&
      env.CASELINK_PARENT_ACCOUNT_MODE === "existing" &&
      env.NEXT_PUBLIC_SITE_URL === "http://127.0.0.1:3200" &&
      !env.VERCEL &&
      !["production", "preview"].includes(env.VERCEL_ENV ?? "") &&
      project === env.CASELINK_SCHOOL_SUPABASE_URL &&
      project === env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL &&
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      database.hostname === `db.${ref}.supabase.co` &&
      (database.port === "5432" || database.port === "") &&
      database.pathname === "/postgres" &&
      database.searchParams.getAll("sslmode").length === 1 &&
      database.searchParams.get("sslmode") === "verify-full" &&
      [...database.searchParams.keys()].every(
        (key) =>
          ["sslmode", "sslrootcert"].includes(key) &&
          database.searchParams.getAll(key).length === 1,
      ) &&
      (!brokerOrigin || brokerOrigin === "http://127.0.0.1:3310"),
    );
  } catch {
    return false;
  }
}
