import { createHash } from "crypto";
import {
  emptyToNull,
  orderPrimaryContactTriplet,
  parseOptionalBoolean,
  parseServiceFlag,
  secondaryContact,
  slugifyPart,
} from "@/lib/db/resource-import/normalize";
import type { CsvParseIssue, ParsedResourceRow } from "@/lib/db/resource-import/types";

const HEADER_ROW_INDEX = 1;
const DATA_START_INDEX = 2;

export function buildImportKey(
  office: string,
  program: string,
  category: string | null,
): string {
  return createHash("sha256")
    .update(
      [office, program, category ?? ""]
        .map((x) => x.trim().toLowerCase())
        .join("|"),
    )
    .digest("hex");
}

export function buildSlug(office: string, program: string, importKey: string): string {
  const base = slugifyPart(`${office}-${program}`) || "resource";
  return `${base}-${importKey.slice(0, 8)}`;
}

function buildTags(category: string | null, program: string, office: string): string[] {
  const set = new Set<string>();
  if (category) {
    for (const part of category.split(/[,;/]/)) {
      const t = part.trim().toLowerCase();
      if (t) set.add(t);
    }
  }
  for (const w of program.toLowerCase().split(/\s+/).slice(0, 8)) {
    if (w.length > 3) set.add(w);
  }
  if (office.trim()) {
    set.add(office.trim().toLowerCase().slice(0, 40));
  }
  return [...set];
}

function buildSearchText(row: Omit<ParsedResourceRow, "searchText">): string {
  const parts = [
    row.officeOrDepartment,
    row.programName,
    row.description ?? "",
    row.category ?? "",
    row.primaryContactName ?? "",
    row.primaryContactTitle ?? "",
    row.primaryContactEmail ?? "",
    row.primaryContactPhone ?? "",
    row.secondaryContactName ?? "",
    row.servicesSelectAll ?? "",
    row.additionalInfo ?? "",
    row.tags.join(" "),
  ];
  return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Map one CSV record (array of columns) to ParsedResourceRow.
 * `rowNumber` is 1-based spreadsheet row for logging.
 */
export function mapCsvRecordToResource(
  cells: string[],
  rowNumber: number,
): { ok: true; row: ParsedResourceRow } | { ok: false; issue: CsvParseIssue } {
  if (cells.length < 21) {
    return {
      ok: false,
      issue: {
        rowNumber,
        message: `Expected at least 21 columns, got ${cells.length}`,
        rawPreview: cells.join(",").slice(0, 120),
      },
    };
  }

  const office = emptyToNull(cells[0]);
  const program = emptyToNull(cells[1]);
  if (!office || !program) {
    return {
      ok: false,
      issue: {
        rowNumber,
        message: "Missing office/department or program name",
        rawPreview: cells.join(",").slice(0, 120),
      },
    };
  }

  const description = emptyToNull(cells[2]);
  const category = emptyToNull(cells[3]);
  const inviteMarchPartnerFair = parseOptionalBoolean(cells[4]);
  const partnerFairAttended = emptyToNull(cells[5]);
  const recruitForGroceryGiveaways = parseOptionalBoolean(cells[6]);

  const primaryContactName = emptyToNull(cells[7]);
  const primary = orderPrimaryContactTriplet(cells[8], cells[9], cells[10]);

  const sec = secondaryContact(cells[11], cells[12], cells[13], cells[14]);
  const servicesSelectAll = emptyToNull(cells[15]);
  const additionalInfo = emptyToNull(cells[16]);
  const tablingAtEvents = parseServiceFlag(cells[17]);
  const promotionalMaterials = parseServiceFlag(cells[18]);
  const educationalWorkshops = parseServiceFlag(cells[19]);
  const volunteerRecruitmentSupport = parseServiceFlag(cells[20]);

  const importKey = buildImportKey(office, program, category);
  const slug = buildSlug(office, program, importKey);
  const tags = buildTags(category, program, office);

  const base: Omit<ParsedResourceRow, "searchText"> = {
    officeOrDepartment: office,
    programName: program,
    description,
    category,
    inviteMarchPartnerFair,
    partnerFairAttended,
    recruitForGroceryGiveaways,
    primaryContactName,
    primaryContactTitle: primary.title,
    primaryContactEmail: primary.email,
    primaryContactPhone: primary.phone,
    primaryContactPhoneNorm: primary.phoneNorm,
    secondaryContactName: sec.name,
    secondaryContactTitle: sec.title,
    secondaryContactEmail: sec.email,
    secondaryContactPhone: sec.phone,
    secondaryContactPhoneNorm: sec.phoneNorm,
    servicesSelectAll,
    additionalInfo,
    tablingAtEvents,
    promotionalMaterials,
    educationalWorkshops,
    volunteerRecruitmentSupport,
    importKey,
    slug,
    tags,
  };

  return {
    ok: true,
    row: {
      ...base,
      searchText: buildSearchText(base),
    },
  };
}

export function getHeaderAndDataRowIndices(): {
  headerIndex: number;
  dataStartIndex: number;
} {
  return { headerIndex: HEADER_ROW_INDEX, dataStartIndex: DATA_START_INDEX };
}
