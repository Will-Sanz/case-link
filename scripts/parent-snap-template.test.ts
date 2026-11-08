import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { snapTemplateLocalTarget, snapTemplateRecord } from "./parent-snap-template";
const source = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
const now = new Date("2026-11-03T22:00:00Z");
const status = { API_URL: "http://127.0.0.1:55321", DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/postgres", SERVICE_ROLE_KEY: "synthetic-local-operator-key" };
describe("local SNAP template installation", () => {
  it("installs only reviewed preparation-only source and the supported ZIP mapping", () => {
    expect(snapTemplateRecord(source, now)).toMatchObject({ program_id: "snap-pa", needs: ["snap_new"],
      preparation_only: true, field_map: { ZIP: "zip" }, required_fields: ["zip"], required_acts: [] });
    const changed = Buffer.from(source); changed[100] ^= 1;
    expect(() => snapTemplateRecord(changed, now)).toThrow("differs");
    expect(() => snapTemplateRecord(source, new Date("2026-12-04"))).toThrow("current review");
  });
  it("keeps the private application preview distinct from the preserved ZIP draft", () => {
    const draft = snapTemplateRecord(source, now), preview = snapTemplateRecord(source, now, "application-preview");
    expect(preview.id).not.toBe(draft.id); expect(preview.version).not.toBe(draft.version);
    expect(preview).toMatchObject({ preparation_only: true, field_map: {}, required_fields: [], required_acts: [] });
    expect(preview.content_sha256).toBe(draft.content_sha256); expect(preview.object_path).toBe(draft.object_path);
  });
  it.each([
    { API_URL: "https://example.supabase.co" },
    { DB_URL: "postgresql://postgres:synthetic@example.com:55322/postgres" },
    { DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres" },
    { DB_URL: "postgresql://postgres:synthetic@127.0.0.1:55322/postgres?options=unsafe" },
  ])("refuses a noncanonical or remote setup target", (change) => {
    expect(() => snapTemplateLocalTarget({ ...status, ...change })).toThrow();
  });
  it("accepts only the isolated setup and its private credential", () => {
    expect(snapTemplateLocalTarget(status).apiUrl).toBe(status.API_URL);
    expect(() => snapTemplateLocalTarget({ ...status, SERVICE_ROLE_KEY: "" })).toThrow();
  });
  it("reaches the actual tsx command entry without contacting any database on invalid arguments", () => {
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/parent-snap-template.ts", "invalid"], { encoding: "utf8", stdio: "pipe" }))
      .toThrow("local unsigned SNAP template could not be installed");
  });
});
