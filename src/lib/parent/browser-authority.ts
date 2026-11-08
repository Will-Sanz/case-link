import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "../supabase/fetch-with-timeout";
import { publicKeyIsSafe } from "./configuration";
import {
  browserAuthoritySchema,
  browserDeadline,
  publicBrowserAllowed,
} from "./browser-policy";

export function createBrowserAuthorizer(
  projectUrl: string,
  publicKey: string,
  approvedUntil: string,
) {
  if (!publicKeyIsSafe(publicKey))
    throw new Error("browser_public_key_required");
  return async (token: string, requestId: string) => {
    if (
      !token ||
      token.length > 8192 ||
      Date.parse(approvedUntil) <= Date.now()
    )
      throw new Error("browser_not_authorized");
    const client = createClient(projectUrl, publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetchWithTimeout,
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    const verified = await client.auth.getUser(token);
    if (
      verified.error ||
      !verified.data.user?.email_confirmed_at ||
      verified.data.user.is_anonymous
    )
      throw new Error("browser_not_authorized");
    const ownerId = verified.data.user.id;
    const ensured = await client.rpc("parent_ensure_account");
    if (ensured.error) throw new Error("browser_not_authorized");
    const record = await client
      .from("parent_requests")
      .select(
        "id,household_id,status,version,mandate,mandate_revoked_at,needs:intake->needs",
      )
      .eq("id", requestId)
      .maybeSingle();
    if (record.error || !record.data) throw new Error("browser_not_owned");
    const household = await client
      .from("parent_households")
      .select("id")
      .eq("id", record.data.household_id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (household.error || !household.data)
      throw new Error("browser_not_owned");
    const authority = browserAuthoritySchema.parse({
      ...record.data,
      intake: { needs: record.data.needs },
    });
    const expiresAt = browserDeadline(
      token,
      authority.mandate.expiresAt,
      approvedUntil,
    );
    if (
      authority.id !== requestId ||
      !publicBrowserAllowed(authority) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      throw new Error("browser_not_authorized");
    return { ownerId, authority, expiresAt };
  };
}
