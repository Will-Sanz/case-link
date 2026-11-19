import { z } from "zod";
import english from "../../../data/verified-forms/snap-pa600fs-2019.json";
import spanish from "../../../data/verified-forms/snap-pa600fs-es-2019.json";
import spanishMap from "../../../data/verified-forms/snap-pa600fs-es-2019.fields.json";

export const SNAP_EN_TEMPLATE_ID = "pa-snap-pa600fs-sg-2019";
export const SNAP_ES_TEMPLATE_ID = "pa-snap-pa600fs-sg-2019-es";
export const SNAP_PREVIEW_TEMPLATE_ID = "pa-snap-pa600fs-sg-2019-preview";
export const SNAP_PREVIEW_TEMPLATE_VERSION = "application-preview-2026-11-03.v1";
export function snapFormPreview(templateId: unknown = SNAP_EN_TEMPLATE_ID) {
  return snapFormSource(templateId).language === "es"
    ? { id: "pa-snap-pa600fs-sg-2019-es-preview", version: "application-preview-2026-11-18.v1" }
    : { id: SNAP_PREVIEW_TEMPLATE_ID, version: SNAP_PREVIEW_TEMPLATE_VERSION };
}
export const SNAP_APPLICATION_SOURCE = {
  templateId: english.id, templateVersion: english.version, templateSha256: english.sha256,
  inventoryId: "pa-snap-pa600fs-sg-2019-field-inventory", inventoryVersion: "2026-11-03.v1",
  inventorySha256: "5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee",
} as const;
export const SNAP_SPANISH_APPLICATION_SOURCE = {
  templateId: spanish.id, templateVersion: spanish.version, templateSha256: spanish.sha256,
  inventoryId: spanishMap.id, inventoryVersion: spanishMap.version,
  inventorySha256: "ec5123d2b21c5ed5309bf7215fae1d72b87f0240edf5d275affe0433bac2a6dc",
} as const;
function templateSchema(source: typeof SNAP_APPLICATION_SOURCE | typeof SNAP_SPANISH_APPLICATION_SOURCE) {
  return z.object({ templateId: z.literal(source.templateId), templateVersion: z.literal(source.templateVersion), templateSha256: z.literal(source.templateSha256) }).strict();
}
function applicationSchema(source: typeof SNAP_APPLICATION_SOURCE | typeof SNAP_SPANISH_APPLICATION_SOURCE) {
  return templateSchema(source).extend({ inventoryId: z.literal(source.inventoryId), inventoryVersion: z.literal(source.inventoryVersion), inventorySha256: z.literal(source.inventorySha256) }).strict();
}
export const snapFormTemplateIdSchema = z.union([z.literal(english.id), z.literal(spanish.id)]);
export const snapFormTemplateSourceSchema = z.union([templateSchema(SNAP_APPLICATION_SOURCE), templateSchema(SNAP_SPANISH_APPLICATION_SOURCE)]);
export const snapApplicationSourceSchema = z.union([applicationSchema(SNAP_APPLICATION_SOURCE), applicationSchema(SNAP_SPANISH_APPLICATION_SOURCE)]);

/** Exact offline source selection only; neither source availability nor a locale grants processing or filing permission. */
export function snapFormSource(templateId: unknown = SNAP_EN_TEMPLATE_ID) {
  if (templateId === SNAP_EN_TEMPLATE_ID) return { contract: english, source: { ...SNAP_APPLICATION_SOURCE }, language: "en" as const };
  if (templateId === SNAP_ES_TEMPLATE_ID) return { contract: spanish, source: { ...SNAP_SPANISH_APPLICATION_SOURCE }, language: "es" as const };
  throw new Error("snap_form_source_invalid");
}
