import { SNAP_APPLICATION_SOURCE, SNAP_EN_TEMPLATE_ID, snapFormSource } from "./snap-form-source";

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

/** Same physical-page roles; exact source binding remains different for each official form. */
export function snapPersonalPageMap(templateId: unknown = SNAP_EN_TEMPLATE_ID) {
  const form = snapFormSource(templateId);
  return form.language === "en" ? SNAP_PERSONAL_PAGE_MAP : {
    ...SNAP_PERSONAL_PAGE_MAP, version: "pa600fs-es-personal-pages-2026-11-18.v1", source: form.source,
  };
}
