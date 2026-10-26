import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  AuthenticationRequiredError,
  SessionUnavailableError,
} from "@/lib/auth/session-errors";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";
import { getParentConfig } from "./config";

export type ParentSession = {
  supabase: SupabaseClient;
  user: { id: string; email: string };
};

export async function createParentClient() {
  const config = getParentConfig();
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.supabaseKey, {
    global: { fetch: fetchWithTimeout },
    cookieOptions: {
      name: "caselink-parent-auth",
      sameSite: "lax",
      httpOnly: true,
      secure: config.supabaseUrl.startsWith("https://"),
      path: "/",
    },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(values) {
        try {
          for (const { name, value, options } of values)
            cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; parent proxy refreshes them before rendering.
        }
      },
    },
  });
}

export const getParentSession = cache(
  async (): Promise<ParentSession | null> => {
    const supabase = await createParentClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      if ([400, 401, 403].includes(error.status ?? 0)) return null;
      throw new SessionUnavailableError();
    }
    if (!user?.email || !user.email_confirmed_at || user.is_anonymous)
      return null;
    const ensured = await supabase.rpc("parent_ensure_account");
    if (ensured.error) {
      if (ensured.error.code === "42501") return null;
      throw new SessionUnavailableError();
    }
    return { supabase, user: { id: user.id, email: user.email } };
  },
);

export async function requireParentSession(): Promise<ParentSession> {
  const session = await getParentSession();
  if (!session) throw new AuthenticationRequiredError();
  return session;
}
