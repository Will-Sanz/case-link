import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { getHeaderAndDataRowIndices, mapCsvRecordToResource } from "@/lib/db/resource-import/map-row";
import type { CsvParseIssue, ParsedResourceRow } from "@/lib/db/resource-import/types";

export type ParseResourceFileResult = {
  rows: ParsedResourceRow[];
  issues: CsvParseIssue[];
  headerRowIndex: number;
  dataRowCount: number;
};

/**
 * Parse the partner resource CSV (multiline quoted header; data starts after header row).
 */
export function parseResourceCsvFromPath(filePath: string): ParseResourceFileResult {
  const content = fs.readFileSync(filePath, "utf8");
  return parseResourceCsvFromString(content);
}

export function parseResourceCsvFromString(csv: string): ParseResourceFileResult {
  const records = parse(csv, {
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];

  const { headerIndex, dataStartIndex } = getHeaderAndDataRowIndices();
  const issues: CsvParseIssue[] = [];
  const rows: ParsedResourceRow[] = [];

  if (records.length <= dataStartIndex) {
    issues.push({
      rowNumber: 0,
      message: "CSV has no data rows after the header",
    });
    return {
      rows,
      issues,
      headerRowIndex: headerIndex,
      dataRowCount: 0,
    };
  }

  for (let i = dataStartIndex; i < records.length; i++) {
    const spreadsheetRow = i + 1;
    const cells = records[i];
    if (!cells || cells.every((c) => emptyRowCell(c))) {
      continue;
    }

    if (isIgnorableBlankRow(cells)) {
      continue;
    }

    const mapped = mapCsvRecordToResource(cells, spreadsheetRow);
    if (!mapped.ok) {
      issues.push(mapped.issue);
      continue;
    }
    rows.push(mapped.row);
  }

  return {
    rows,
    issues,
    headerRowIndex: headerIndex,
    dataRowCount: rows.length,
  };
}

function emptyRowCell(c: string | undefined): boolean {
  return (c ?? "").trim() === "";
}

/** Trailing export rows that only contain empty fields and FALSE/TRUE flags. */
function isIgnorableBlankRow(cells: string[]): boolean {
  const office = (cells[0] ?? "").trim();
  const program = (cells[1] ?? "").trim();
  if (office || program) {
    return false;
  }
  return !cells.slice(2).some((c) => {
    const t = (c ?? "").trim();
    if (!t) return false;
    const u = t.toUpperCase();
    if (u === "TRUE" || u === "FALSE") return false;
    return true;
  });
}
