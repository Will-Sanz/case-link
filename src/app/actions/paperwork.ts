"use server";

import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { createAiResponse } from "@/lib/ai/client";
import { getFamilyDetail } from "@/lib/services/families";
import { buildPaperworkSource, createDeterministicMappings } from "@/lib/paperwork/pdf-field-mapper";
import { validateFamilyNoPii } from "@/lib/privacy/no-pii";
import { isManualOnlyPaperworkField } from "@/lib/paperwork/scanned-pdf-analysis";
import type { PdfFieldMapping } from "@/types/paperwork";

const fieldSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["text", "checkbox", "dropdown", "radio", "option-list"]),
  options: z.array(z.string().max(200)).max(50),
  maxLength: z.number().int().positive().max(100_000).nullable(),
});

const inputSchema = z.object({ familyId: z.string().uuid(), fields: z.array(fieldSchema).min(1).max(150) });
const aiMappingSchema = z.object({
  mappings: z.array(z.object({
    fieldName: z.string().min(1).max(200),
    value: z.union([z.string().max(10_000), z.null()]),
    confidence: z.enum(["high", "medium", "low"]),
    source: z.string().min(1).max(300),
    needsReview: z.boolean(),
  })).max(150),
});

const jsonSchema = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      maxItems: 150,
      items: {
        type: "object",
        properties: {
          fieldName: { type: "string" },
          value: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          source: { type: "string" },
          needsReview: { type: "boolean" },
        },
        required: ["fieldName", "value", "confidence", "source", "needsReview"],
        additionalProperties: false,
      },
    },
  },
  required: ["mappings"],
  additionalProperties: false,
} as const;

export async function mapPdfFieldsAction(input: unknown): Promise<{ ok: true; mappings: PdfFieldMapping[]; assistedByAi: boolean } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The PDF contains unsupported or invalid form fields." };

  let user;
  let supabase;
  try {
    ({ user, supabase } = await requireAppUserWithClient());
  } catch {
    return { ok: false, error: "Your session expired. Sign in again and retry." };
  }

  const family = await getFamilyDetail(supabase, parsed.data.familyId);
  if (!family) return { ok: false, error: "This family record could not be loaded." };
  if (!family.plan || (family.plan.generation_state && family.plan.generation_state.status !== "complete")) {
    return { ok: false, error: "Finish generating the intervention plan before preparing paperwork." };
  }
  const privacy = validateFamilyNoPii(family);
  if (!privacy.ok) {
    return { ok: false, error: privacy.error ?? "Remove identifying text before preparing paperwork." };
  }

  const source = buildPaperworkSource(family);
  const fallback = createDeterministicMappings(parsed.data.fields, source);
  const ai = await createAiResponse({
    taskType: "pdf_field_mapping",
    aiMode: "fast",
    temperature: 0,
    maxTokens: 4096,
    requestMeta: { userId: user.id, route: "/families/[id]/paperwork" },
    instructions: [
      "Map reviewed CaseLink source information into the provided PDF form fields.",
      "Never invent facts, infer identities, or fill signatures, consent, dates of birth, addresses, IDs, eligibility attestations, or case-manager certifications.",
      "Use only the supplied source. Preserve the requested fieldName exactly.",
      "For dropdown/radio/option-list values, use an exact supplied option or null.",
      "For checkboxes, return 'true', 'false', or null only when directly supported.",
      "Set needsReview true for missing, uncertain, sensitive, consent, signature, or attestation fields.",
      "The source intentionally omits the family label and household-member names.",
    ].join("\n"),
    input: JSON.stringify({ fields: parsed.data.fields, reviewedSource: source }),
    structuredJsonSchema: { name: "pdf_field_mappings", schema: jsonSchema, strict: true },
  });

  if (!ai.ok) return { ok: true, mappings: fallback, assistedByAi: false };
  try {
    const output = aiMappingSchema.parse(JSON.parse(ai.text));
    const validNames = new Set(parsed.data.fields.map((field) => field.name));
    const aiByName = new Map(output.mappings.filter((item) => validNames.has(item.fieldName)).map((item) => [item.fieldName, item]));
    const fieldsByName = new Map(parsed.data.fields.map((field) => [field.name, field]));
    const mappings = fallback.map((base) => {
      const proposed = aiByName.get(base.fieldName);
      const field = fieldsByName.get(base.fieldName)!;
      if (isManualOnlyPaperworkField(field.name, field.name)) {
        return {
          ...base,
          value: "",
          confidence: "low" as const,
          source: "Complete manually outside CaseLink",
          needsReview: true,
        };
      }
      if (!proposed || proposed.value == null) return base;
      let value = proposed.value;
      if (field.maxLength) value = value.slice(0, field.maxLength);
      if (["dropdown", "radio", "option-list"].includes(field.kind) && !field.options.includes(value)) return base;
      if (field.kind === "checkbox" && !["true", "false"].includes(value.toLowerCase())) return base;
      return { ...proposed, value };
    });
    return { ok: true, mappings, assistedByAi: true };
  } catch {
    return { ok: true, mappings: fallback, assistedByAi: false };
  }
}
