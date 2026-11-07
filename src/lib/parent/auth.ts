import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";
import { getParentConfig } from "./config";
import { verifyParentSession, type ParentSession } from "./parent-session";
export type { ParentSession } from "./parent-session";

export async function createParentClient() {
  const config = getParentConfig();
  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.supabaseKey, {
    global: { fetch: fetchWithTimeout },
    cookieOptions: {
      name: "caselink-parent-auth",
      sameSite: "lax",
      httpOnly: true,
      secure:
        config.supabaseUrl.startsWith("https://") &&
        process.env.CASELINK_ENVIRONMENT !== "connected",
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
  async (): Promise<ParentSession | null> => verifyParentSession(await createParentClient()),
);

export async function requireParentSession(): Promise<ParentSession> {
  const session = await getParentSession();
  if (!session) throw new AuthenticationRequiredError();
  return session;
}
