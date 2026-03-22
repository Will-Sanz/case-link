import { z } from "zod";

const labeledItemSchema = z.object({
  presetKey: z.string().max(100).optional().nullable(),
  label: z.string().min(1, "Required").max(200),
});

/** Client + server validation (no output transforms — works with react-hook-form). */
export const familyIntakeFormSchema = z.object({
  name: z.string().min(1, "Household name is required").max(200),
  summary: z.string().max(8000).optional(),
  householdNotes: z.string().max(8000).optional(),
  initialCaseNote: z.string().max(8000).optional(),
  urgency: z
    .union([
      z.enum(["low", "medium", "high", "crisis"]),
      z.literal(""),
    ])
    .optional(),
  goals: z.array(labeledItemSchema).min(1, "Add at least one goal").max(40),
  barriers: z.array(labeledItemSchema).min(1, "Add at least one barrier").max(40),
  members: z
    .array(
      z.object({
        displayName: z.string().min(1).max(200),
        relationship: z.string().max(120).optional(),
        notes: z.string().max(2000).optional(),
        ageApprox: z.string().max(4).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export type FamilyIntakeFormValues = z.infer<typeof familyIntakeFormSchema>;

function parseAgeApprox(s: string | undefined): number | null {
  const t = s?.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 0 || n > 120) return null;
  return n;
}

/** Normalize validated form values for DB insert. */
const URGENCY_SET = new Set(["low", "medium", "high", "crisis"]);

export function normalizeIntakeForDb(v: FamilyIntakeFormValues) {
  const urgency =
    v.urgency && URGENCY_SET.has(v.urgency) ? v.urgency : null;

  return {
    name: v.name.trim(),
    summary: v.summary?.trim() || null,
    householdNotes: v.householdNotes?.trim() || null,
    initialCaseNote: v.initialCaseNote?.trim() || null,
    urgency,
    goals: v.goals.map((g) => ({
      presetKey: g.presetKey?.trim() || null,
      label: g.label.trim(),
    })),
    barriers: v.barriers.map((b) => ({
      presetKey: b.presetKey?.trim() || null,
      label: b.label.trim(),
    })),
    members: (v.members ?? []).map((m) => ({
      displayName: m.displayName.trim(),
      relationship: m.relationship?.trim() || null,
      notes: m.notes?.trim() || null,
      ageApprox: parseAgeApprox(m.ageApprox),
    })),
  };
}

export const updateFamilySchema = z.object({
  familyId: z.string().uuid(),
  summary: z.string().max(8000).optional().nullable(),
  householdNotes: z.string().max(8000).optional().nullable(),
  urgency: z.enum(["low", "medium", "high", "crisis"]).optional().nullable(),
  status: z.enum(["active", "on_hold", "closed"]).optional(),
});

export const addCaseNoteSchema = z.object({
  familyId: z.string().uuid(),
  body: z.string().min(1, "Note cannot be empty").max(12000),
});

export const updateGoalsSchema = z.object({
  familyId: z.string().uuid(),
  goals: z.array(z.object({
    id: z.string().uuid().optional(),
    label: z.string().min(1).max(200),
  })).max(40),
});

export const updateBarriersSchema = z.object({
  familyId: z.string().uuid(),
  barriers: z.array(z.object({
    id: z.string().uuid().optional(),
    label: z.string().min(1).max(200),
  })).max(40),
});

export const updateMembersSchema = z.object({
  familyId: z.string().uuid(),
  members: z.array(z.object({
    id: z.string().uuid().optional(),
    display_name: z.string().min(1).max(200),
    relationship: z.string().max(120).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    age_approx: z
      .union([z.number().int().min(0).max(120), z.string()])
      .optional()
      .nullable()
      .transform((v) => {
        if (v == null || v === "") return null;
        const n = typeof v === "string" ? parseInt(v, 10) : v;
        return Number.isFinite(n) && n >= 0 && n <= 120 ? n : null;
      }),
  })).max(20),
});
