import type { FamilyDetail, ResourceMatchRow } from "../../src/types/family";

export const directoryId = "10000000-0000-4000-8000-000000000001";
export const directoryStamp = "2026-10-13T12:00:00.123456+00:00";
export function directoryCase(): FamilyDetail {
  return {
    id: "20000000-0000-4000-8000-000000000002", name: "Family 014", summary: "Housing support", household_notes: null,
    urgency: "medium", status: "active", created_by_id: "50000000-0000-4000-8000-000000000005", created_at: directoryStamp, updated_at: directoryStamp,
    creator: null, members: [], goals: [], barriers: [], plan: null, caseNotes: [], progressUpdates: [],
    resourceMatches: [{ id: "60000000-0000-4000-8000-000000000006", status: "accepted", score: 10, match_reason: "Matches housing",
      resource: { id: directoryId, updated_at: directoryStamp, active: true, is_demo: false, program_name: "Housing support", office_or_department: "Community office", category: "Housing",
        primary_contact_name: "Private Directoryperson", primary_contact_phone: "215-555-0148", primary_contact_email: "intake@example.test" },
    } as ResourceMatchRow],
  };
}
