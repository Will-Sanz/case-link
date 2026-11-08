import { describe, expect, it } from "vitest";
import { parseResourceCsvFromPath } from "./parse-resource-file";
import { parsedResourceToDbRow } from "./to-db-row";

describe("resource import availability", () => {
  it("marks the committed synthetic directory as demo and never reactivates deactivated resources", () => {
    const { rows } = parseResourceCsvFromPath("data/resources-seed.sample.csv");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const payload = parsedResourceToDbRow(row);
      expect(payload.is_demo).toBe(true);
      expect(payload).not.toHaveProperty("active");
      expect(payload.primary_contact_email).toBe(row.primaryContactEmail);
    }
    expect(parsedResourceToDbRow({ ...rows[0], programName: "Community food support", officeOrDepartment: "Community office" }).is_demo).toBe(false);
  });
});
