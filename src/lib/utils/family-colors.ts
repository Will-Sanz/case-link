/**
 * Deterministic family-to-color mapping for calendar and case UI.
 * Same family always gets the same color across views.
 */

/** Professional, accessible palette - soft but distinct tones */
const FAMILY_PALETTE = [
  { bg: "bg-teal-50", border: "border-l-teal-500 border-teal-200", muted: "bg-teal-50/70" },
  { bg: "bg-sky-50", border: "border-l-sky-500 border-sky-200", muted: "bg-sky-50/70" },
  { bg: "bg-violet-50", border: "border-l-violet-500 border-violet-200", muted: "bg-violet-50/70" },
  { bg: "bg-amber-50", border: "border-l-amber-500 border-amber-200", muted: "bg-amber-50/70" },
  { bg: "bg-rose-50", border: "border-l-rose-500 border-rose-200", muted: "bg-rose-50/70" },
  { bg: "bg-emerald-50", border: "border-l-emerald-500 border-emerald-200", muted: "bg-emerald-50/70" },
  { bg: "bg-indigo-50", border: "border-l-indigo-500 border-indigo-200", muted: "bg-indigo-50/70" },
  { bg: "bg-orange-50", border: "border-l-orange-500 border-orange-200", muted: "bg-orange-50/70" },
  { bg: "bg-cyan-50", border: "border-l-cyan-500 border-cyan-200", muted: "bg-cyan-50/70" },
  { bg: "bg-fuchsia-50", border: "border-l-fuchsia-500 border-fuchsia-200", muted: "bg-fuchsia-50/70" },
] as const;

export type FamilyColorToken = (typeof FAMILY_PALETTE)[number];

/** Simple string hash for deterministic index */
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = (h << 5) - h + c;
    h = h & h;
  }
  return Math.abs(h);
}

/**
 * Get a stable color token for a family. Same familyId always returns same token.
 */
export function getFamilyColor(familyId: string): FamilyColorToken {
  const idx = hashString(familyId) % FAMILY_PALETTE.length;
  return FAMILY_PALETTE[idx];
}
