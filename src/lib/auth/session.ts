import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
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

/**
 * Sync `app_users` using an existing server Supabase client.
 * Use this in server actions that also run PostgREST writes so `getUser()`/token refresh
 * stays on the same in-memory session as subsequent `.from()` calls (avoids stale cookies
 * when `cookies().set` is unavailable and a second client would read old JWTs → RLS failure).
 */
export async function ensureAppUserWithClient(
  supabase: SupabaseClient,
  supabaseUser: SupabaseUser,
): Promise<AppUser> {
  const email = supabaseUser.email?.toLowerCase().trim() ?? "";
  if (!email) {
    throw new Error("Authenticated user is missing an email address.");
  }

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

export async function ensureAppUser(supabaseUser: SupabaseUser): Promise<AppUser> {
  const supabase = await createSupabaseServerClient();
  return ensureAppUserWithClient(supabase, supabaseUser);
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

/** One Supabase client for auth + DB in the same request (required for reliable RLS JWT). */
export async function requireAppUserWithClient(): Promise<{
  user: AppUser;
  supabase: SupabaseClient;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();
  if (error || !authUser) {
    throw new Error("Unauthorized");
  }
  const user = await ensureAppUserWithClient(supabase, authUser);
  return { user, supabase };
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAppUser();
  if (user.role !== UserRole.Admin) {
    throw new Error("Forbidden");
  }
  return user;
}
