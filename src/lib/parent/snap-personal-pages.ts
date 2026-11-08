import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";

/** Source-page locations only. This does not settle conditional acts, documents or filing readiness. */
export const SNAP_PERSONAL_PAGE_MAP = {
  version: "pa600fs-personal-pages-2026-11-05.v1",
  source: SNAP_APPLICATION_SOURCE,
  pageCount: 12,
  width: 612,
  height: 792,
  requiredFullPages: [
    { pdfPage: 3, printedPage: 1, roles: ["applicant_identifiers", "applicant_certification"] },
    { pdfPage: 7, printedPage: 5, roles: ["rights_certification", "conditional_representative_or_witness"] },
  ],
} as const;
