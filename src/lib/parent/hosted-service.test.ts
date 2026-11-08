import { describe, expect, it } from "vitest";
import { hostedParentServiceAllowed } from "./hosted-service";
const now = Date.parse("2026-11-07T12:00:00Z"), project = "https://projectref.supabase.co";
const db = "postgresql://caselink_worker:fixture@db.projectref.supabase.co/postgres?sslmode=verify-full";
const env = { CASELINK_ENVIRONMENT: "production", CASELINK_PARENT_ACCOUNT_MODE: "existing", NEXT_PUBLIC_SITE_URL: "https://pilot.thecaselink.com",
  CASELINK_PARENT_HOSTED_APPROVED: "1", CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE: "test authorization", CASELINK_PARENT_HOSTED_APPROVED_UNTIL: "2026-12-01T12:00:00Z",
  CASELINK_SCHOOL_SUPABASE_URL: project, CASELINK_PARENT_PRODUCTION_SUPABASE_URL: project };
describe("explicit same-host production service boundary", () => {
  it("allows an explicitly authorized multi-day pilot without changing connected mode", () => expect(hostedParentServiceAllowed(env, db, project, "http://127.0.0.1:3310", now)).toBe(true));
  it.each([
    { CASELINK_PARENT_HOSTED_APPROVED: "0" }, { CASELINK_PARENT_HOSTED_APPROVAL_REFERENCE: " " }, { CASELINK_PARENT_HOSTED_APPROVED_UNTIL: "2026-11-07T12:00:00Z" },
    { CASELINK_PARENT_CONNECTED_APPROVED: "1" }, { VERCEL: "1" }, { VERCEL_ENV: "production" }, { CASELINK_ENVIRONMENT: "connected" },
    { CASELINK_PARENT_ACCOUNT_MODE: "separate" }, { CASELINK_SCHOOL_SUPABASE_URL: "https://other.supabase.co" },
    { NEXT_PUBLIC_SITE_URL: "http://pilot.thecaselink.com" }, { NEXT_PUBLIC_SITE_URL: "https://127.0.0.1" }, { NEXT_PUBLIC_SITE_URL: "https://child.localhost" },
    { NEXT_PUBLIC_SITE_URL: "https://pilot.thecaselink.com/" },
  ])("rejects absent, expired or incompatible authority: %j", delta => expect(hostedParentServiceAllowed({ ...env, ...delta }, db, project, "http://127.0.0.1:3310", now)).toBe(false));
  it.each([db.replace("db.projectref", "db.other"), db.replace("caselink_worker", "postgres"), db.replace("verify-full", "require"),
    db + "&options=-crole%3Dpostgres", db + "&sslmode=disable", db.replace("/postgres?", ":6543/postgres?"), db.replace("fixture@", "@")])("rejects noncanonical database authority", value => expect(hostedParentServiceAllowed(env, value, project, "http://127.0.0.1:3310", now)).toBe(false));
  it.each(["http://localhost:3310", "http://127.0.0.1:3311", "https://broker.example.com", "http://127.0.0.1:3310/"])("rejects broker override %s", origin => expect(hostedParentServiceAllowed(env, db, project, origin, now)).toBe(false));
});
