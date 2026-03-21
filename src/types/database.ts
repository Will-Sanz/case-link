import type { UserRole } from "@/types/user-role";

/** Row shape for `public.app_users` (matches Supabase migration). */
export type AppUserRow = {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

/** Subset of `public.resources` used by list/detail UIs. */
export type ResourceRow = {
  id: string;
  slug: string;
  active: boolean;
  office_or_department: string;
  program_name: string;
  description: string | null;
  category: string | null;
  primary_contact_name: string | null;
  primary_contact_title: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  secondary_contact_name: string | null;
  secondary_contact_title: string | null;
  secondary_contact_email: string | null;
  secondary_contact_phone: string | null;
  recruit_for_grocery_giveaways: boolean | null;
  tabling_at_events: boolean;
  promotional_materials: boolean;
  educational_workshops: boolean;
  volunteer_recruitment_support: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
};
