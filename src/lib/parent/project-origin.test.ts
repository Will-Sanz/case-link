import { describe, expect, it } from "vitest";
import {
  canonicalProjectOrigin,
  parentProjectIsolationIssues,
} from "./project-origin";
describe("canonical parent project origins", () => {
  it("normalizes case, trailing slash and default ports before comparing projects", () => {
    expect(canonicalProjectOrigin("https://PARENT.supabase.co:443/")).toBe(
      "https://parent.supabase.co",
    );
    expect(
      parentProjectIsolationIssues({
        projectUrl: "https://SCHOOL.supabase.co:443/",
        schoolUrl: "https://school.supabase.co",
        parentProductionUrl: "https://parent.supabase.co",
        environment: "production",
      }).join(),
    ).toContain("separate");
    expect(
      parentProjectIsolationIssues({
        projectUrl: "https://PARENT.supabase.co:443/",
        schoolUrl: "https://school.supabase.co",
        parentProductionUrl: "https://parent.supabase.co",
        environment: "preview",
      }).join(),
    ).toContain("synthetic");
  });
  it.each([
    "https://user:secret@parent.supabase.co",
    "https://parent.supabase.co/project",
    "https://parent.supabase.co/?token=secret",
    "https://parent.supabase.co/#private",
    "http://parent.supabase.co",
    "not a url",
  ])("rejects a non-origin input: %s", (value) => {
    expect(canonicalProjectOrigin(value)).toBeNull();
  });
  it("allows only the isolated local parent API", () => {
    expect(
      parentProjectIsolationIssues({ projectUrl: "http://127.0.0.1:55321" }),
    ).toEqual([]);
    expect(
      parentProjectIsolationIssues({
        projectUrl: "http://127.0.0.1:54321",
      }).join(),
    ).toContain("55321");
  });
});
