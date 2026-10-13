import type { SupabaseClient } from "@supabase/supabase-js";
import { safeInternalPath } from "./safe-internal-path";

export const AUTH_CALLBACK_ERROR_PATH = "/login?error=auth";

/** Credentials are captured and removed from the URL before the browser client initializes. */
export async function completeAuthCallback(url: URL, client: () => SupabaseClient): Promise<string> {
  try {
    const query = url.searchParams;
    const fragment = new URLSearchParams(url.hash.slice(1));
    if (url.href.length > 20000 || query.has("error") || fragment.has("error")) return AUTH_CALLBACK_ERROR_PATH;
    const code = query.get("code");
    const tokenHash = query.get("token_hash");
    const type = query.get("type");
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const methods = Number(Boolean(code)) + Number(Boolean(tokenHash)) + Number(Boolean(accessToken || refreshToken));
    if (methods !== 1) return AUTH_CALLBACK_ERROR_PATH;
    if (tokenHash && type !== "invite" && type !== "recovery") return AUTH_CALLBACK_ERROR_PATH;
    if ((accessToken || refreshToken) && (!accessToken || !refreshToken)) return AUTH_CALLBACK_ERROR_PATH;

    const { auth } = client();
    const result = code
      ? await auth.exchangeCodeForSession(code)
      : tokenHash
        ? await auth.verifyOtp({ token_hash: tokenHash, type: type as "invite" | "recovery" })
        : await auth.setSession({ access_token: accessToken!, refresh_token: refreshToken! });
    if (result.error || !result.data.session) return AUTH_CALLBACK_ERROR_PATH;
    const userId = result.data.session.user.id;
    const stored = await auth.getSession();
    if (stored.error || stored.data.session?.user.id !== userId) return AUTH_CALLBACK_ERROR_PATH;
    const verified = await auth.getUser();
    if (verified.error || verified.data.user?.id !== userId) return AUTH_CALLBACK_ERROR_PATH;
    return safeInternalPath(query.get("next"));
  } catch {
    return AUTH_CALLBACK_ERROR_PATH;
  }
}
