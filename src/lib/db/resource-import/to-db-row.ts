import type { ParsedResourceRow } from "@/lib/db/resource-import/types";

/** Payload for `resources` upsert (matches `public.resources` columns). */
export function parsedResourceToDbRow(row: ParsedResourceRow) {
  return {
    slug: row.slug,
    active: true,
    import_key: row.importKey,
    office_or_department: row.officeOrDepartment,
    program_name: row.programName,
    description: row.description,
    category: row.category,
    invite_march_partner_fair: row.inviteMarchPartnerFair,
    partner_fair_attended: row.partnerFairAttended,
    recruit_for_grocery_giveaways: row.recruitForGroceryGiveaways,
    primary_contact_name: row.primaryContactName,
    primary_contact_title: row.primaryContactTitle,
    primary_contact_email: row.primaryContactEmail,
    primary_contact_phone: row.primaryContactPhone,
    primary_contact_phone_norm: row.primaryContactPhoneNorm,
    secondary_contact_name: row.secondaryContactName,
    secondary_contact_title: row.secondaryContactTitle,
    secondary_contact_email: row.secondaryContactEmail,
    secondary_contact_phone: row.secondaryContactPhone,
    secondary_contact_phone_norm: row.secondaryContactPhoneNorm,
    services_select_all: row.servicesSelectAll,
    additional_info: row.additionalInfo,
    tabling_at_events: row.tablingAtEvents,
    promotional_materials: row.promotionalMaterials,
    educational_workshops: row.educationalWorkshops,
    volunteer_recruitment_support: row.volunteerRecruitmentSupport,
    tags: row.tags,
    search_text: row.searchText,
  };
}
