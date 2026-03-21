import type { User as SupabaseUser } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppUserRow } from "@/types/database";
import { UserRole, type UserRole as UserRoleType } from "@/types/user-role";

export type AppUser = {
  id: string;
  email: string;
  role: UserRoleType;
};

function rowToAppUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
  };
}

export async function getSessionUser(): Promise<SupabaseUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function ensureAppUser(supabaseUser: SupabaseUser): Promise<AppUser> {
  const email = supabaseUser.email?.toLowerCase().trim() ?? "";
  if (!email) {
    throw new Error("Authenticated user is missing an email address.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: existing, error: fetchError } = await supabase
    .from("app_users")
    .select("id, email, role, created_at, updated_at")
    .eq("id", supabaseUser.id)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (existing) {
    if (existing.email !== email) {
      const { error: updateError } = await supabase
        .from("app_users")
        .update({ email })
        .eq("id", existing.id);
      if (updateError) {
        throw new Error(updateError.message);
      }
      return rowToAppUser({ ...existing, email });
    }
    return rowToAppUser(existing as AppUserRow);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("app_users")
    .insert({
      id: supabaseUser.id,
      email,
      role: UserRole.CaseManager,
    })
    .select("id, email, role, created_at, updated_at")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return rowToAppUser(inserted as AppUserRow);
}

export async function getAppUser(): Promise<AppUser | null> {
  const authUser = await getSessionUser();
  if (!authUser) {
    return null;
  }
  return ensureAppUser(authUser);
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAppUser();
  if (user.role !== UserRole.Admin) {
    throw new Error("Forbidden");
  }
  return user;
}
