import { expect, it } from "vitest";
import { parseResourceCsvFromString } from "./parse-resource-file";

it("preserves quoted commas, multiline descriptions and literal prototype-like values in partner CSVs", () => {
  const row = ["Synthetic office", "Program, with a comma", "Two lines\nof support", "Housing", "Yes", "October 2026", "No", "", "", "support@example.test", "", "", "", "", "", "__proto__", "Confirm requirements", "TRUE", "FALSE", "TRUE", "FALSE"];
  const csvRow = (cells: string[]) => cells.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",");
  const csv = [csvRow(Array(21).fill("")), csvRow(Array(21).fill("Column")), csvRow(row), csvRow(["", "", ...Array(19).fill("FALSE")])].join("\r\n");
  const result = parseResourceCsvFromString(csv);
  expect(result.issues).toEqual([]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ programName: "Program, with a comma", primaryContactEmail: "support@example.test", tablingAtEvents: true });
  expect(result.rows[0].searchText).toContain("__proto__");
  expect(result.rows[0].searchText).toContain("two lines");
  expect(Object.getPrototypeOf(result.rows[0])).toBe(Object.prototype);
});
