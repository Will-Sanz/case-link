"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction(): Promise<{ error: string | null }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) return { error: "Sign-out could not be confirmed. Please try again before leaving this device." };
  } catch {
    return { error: "Sign-out could not be confirmed. Please try again before leaving this device." };
  }
  redirect("/login");
}
