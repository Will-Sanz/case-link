/** Shared with shell sidebar + family workspace (single source of truth). */
export const FAMILY_WORKSPACE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "plan", label: "30 / 60 / 90 plan" },
  { id: "members", label: "Household members" },
  { id: "goals", label: "Goals" },
  { id: "barriers", label: "Barriers" },
  { id: "notes", label: "Notes" },
  { id: "activity", label: "Activity" },
  { id: "resources", label: "Resources" },
] as const;

export type FamilyWorkspaceSectionId =
  (typeof FAMILY_WORKSPACE_SECTIONS)[number]["id"];

const SECTION_IDS = FAMILY_WORKSPACE_SECTIONS.map((s) => s.id);

export function parseFamilyWorkspaceSection(
  raw: string | null,
): FamilyWorkspaceSectionId {
  if (raw && (SECTION_IDS as readonly string[]).includes(raw)) {
    return raw as FamilyWorkspaceSectionId;
  }
  return "overview";
}

/** True for `/families/<uuid>` only (not list, not new). */
export function isFamilyCaseDetailPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/families\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i.test(
    pathname,
  );
}

export function extractFamilyCaseId(pathname: string | null): string | null {
  if (!pathname || !isFamilyCaseDetailPath(pathname)) return null;
  const m = pathname.match(/^\/families\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}
