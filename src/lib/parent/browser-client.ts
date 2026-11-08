import "server-only";
import { requireParentSession } from "./auth";
import {
  APPLICATION_BROWSER_ORIGIN,
  browserControlSchema,
  browserResponseSchema,
  browserUnavailable,
  type BrowserControl,
} from "./browser-policy";

/** The web process forwards only the already verified parent's short-lived token. */
export async function applicationBrowser(
  requestId: string,
  method: "GET" | "POST" | "DELETE",
  frame = false,
  frameId?: string,
): Promise<Response> {
  return forwardBrowser(
    requestId,
    method,
    frame ? "/frame" : "",
    undefined,
    frameId,
  );
}

export async function applicationBrowserControl(
  requestId: string,
  value: BrowserControl,
) {
  return forwardBrowser(
    requestId,
    "POST",
    "/control",
    browserControlSchema.parse(value),
  );
}

async function forwardBrowser(
  requestId: string,
  method: "GET" | "POST" | "DELETE",
  resource: "" | "/frame" | "/control",
  control?: BrowserControl,
  frameId?: string,
): Promise<Response> {
  const frame = resource === "/frame";
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
      `${APPLICATION_BROWSER_ORIGIN}/requests/${requestId}${resource}${frameId ? `?frameId=${frameId}` : ""}`,
      {
        method,
        headers: {
          authorization: `Bearer ${session.access_token}`,
          ...(control ? { "content-type": "application/json" } : {}),
        },
        ...(control ? { body: JSON.stringify(control) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(control ? 30000 : frame ? 15000 : 12000),
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
        [401, 403, 409, 429].includes(response.status) ||
        (control && response.status === 400)
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
    value.session.frameUrl = `/api/parent/requests/${requestId}/browser/frame${value.session.handoff ? `?frameId=${value.session.handoff.frameId}` : ""}`;
  return Response.json(value, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
