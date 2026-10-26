import "server-only";
import { requireParentSession } from "./auth";
import {
  APPLICATION_BROWSER_ORIGIN,
  browserResponseSchema,
  browserUnavailable,
} from "./browser-policy";

/** The web process forwards only the already verified parent's short-lived token. */
export async function applicationBrowser(
  requestId: string,
  method: "GET" | "POST" | "DELETE",
  frame = false,
): Promise<Response> {
  const { supabase } = await requireParentSession();
  const owned = await supabase
    .from("parent_requests")
    .select("id")
    .eq("id", requestId)
    .maybeSingle();
  if (owned.error || !owned.data)
    throw new Error("This request is unavailable");
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token)
    throw new Error("Authentication required");
  let response: Response;
  try {
    response = await fetch(
      `${APPLICATION_BROWSER_ORIGIN}/requests/${requestId}${frame ? "/frame" : ""}`,
      {
        method,
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(frame ? 15000 : 12000),
      },
    );
  } catch {
    return frame || method !== "GET"
      ? new Response(null, {
          status: 503,
          headers: { "Cache-Control": "private, no-store" },
        })
      : Response.json(browserUnavailable(), {
          headers: { "Cache-Control": "private, no-store" },
        });
  }
  if (!response.ok)
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store" },
      status:
        response.status === 401 || response.status === 403
          ? response.status
          : 503,
    });
  if (frame) {
    if (response.headers.get("content-type") !== "image/jpeg")
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 2_000_000)
      return new Response(null, {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      });
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const value = browserResponseSchema.parse(await response.json());
  if (value.session?.frameUrl)
    value.session.frameUrl = `/api/parent/requests/${requestId}/browser/frame`;
  return Response.json(value, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
