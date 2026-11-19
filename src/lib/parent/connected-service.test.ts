import { expect, it } from "vitest";
import { connectedParentServiceAllowed } from "./connected-service";
it("permits only explicitly approved private loopback services with verified TLS to the exact existing project", () => {
  const project = "https://approved.supabase.co";
  const env = {
    CASELINK_ENVIRONMENT: "connected",
    CASELINK_PARENT_CONNECTED_APPROVED: "1",
    CASELINK_PARENT_ACCOUNT_MODE: "existing",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
    CASELINK_SCHOOL_SUPABASE_URL: project,
    CASELINK_PARENT_PRODUCTION_SUPABASE_URL: project,
  };
  const db =
    "postgresql://restricted:private@db.approved.supabase.co:5432/postgres?sslmode=verify-full";
  expect(
    connectedParentServiceAllowed(env, db, project, "http://127.0.0.1:3310"),
  ).toBe(true);
  for (const patch of [
    { CASELINK_PARENT_CONNECTED_APPROVED: "" },
    { CASELINK_PARENT_ACCOUNT_MODE: "isolated" },
    { VERCEL: "1" },
    { VERCEL_ENV: "production" },
    { CASELINK_PARENT_PRODUCTION_SUPABASE_URL: "https://other.supabase.co" },
    { NEXT_PUBLIC_SITE_URL: "http://0.0.0.0:3200" },
  ])
    expect(
      connectedParentServiceAllowed({ ...env, ...patch }, db, project),
    ).toBe(false);
  for (const invalid of [
    db.replace("verify-full", "require"),
    db.replace("db.approved", "db.other"),
    db.replace("5432", "9999"),
    db.replace("/postgres?", "/other?"),
    `${db}&sslmode=no-verify`,
    `${db}&host=other.example`,
    `${db}&port=9999`,
    `${db}&user=postgres`,
    `${db}&password=other`,
    `${db}&ssl=false`,
    `${db}&uselibpqcompat=true`,
    `${db}&sslrootcert=one&sslrootcert=two`,
    "not-a-url",
  ])
    expect(connectedParentServiceAllowed(env, invalid, project)).toBe(false);
  expect(
    connectedParentServiceAllowed(
      env,
      `${db}&sslrootcert=%2Fprivate%2Fca.crt`,
      project,
    ),
  ).toBe(true);
  expect(
    connectedParentServiceAllowed(env, db, project, "http://0.0.0.0:3310"),
  ).toBe(false);
});
