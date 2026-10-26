import { z } from "zod";

export const uuidSchema = z.uuid();
export function parentJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new Error("parent_origin_denied");
}
export async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new Error("parent_invalid_input");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("parent_invalid_input");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export async function readParentJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("parent_invalid_input");
  const text = new TextDecoder().decode(await readBoundedBody(request, 40000));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("parent_invalid_input");
  }
}
export function parentError(error: unknown): Response {
  if (error instanceof z.ZodError)
    return parentJson(
      {
        ok: false,
        error:
          error.issues[0]?.message ?? "Check the information and try again.",
      },
      400,
    );
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("This request changed"))
    return parentJson(
      {
        ok: false,
        error:
          "This request changed. Reload it before saving your correction so newer information stays safe.",
      },
      409,
    );
  if (message.startsWith("This request is unavailable"))
    return parentJson(
      {
        ok: false,
        error:
          "This support request is unavailable, or its permission has changed.",
      },
      403,
    );
  if (message === "parent_origin_denied")
    return parentJson(
      { ok: false, error: "Open CaseLink directly and try again." },
      403,
    );
  if (message === "parent_invalid_input")
    return parentJson(
      { ok: false, error: "Check the information and try again." },
      400,
    );
  if (
    /sign.?in|unauthenticated|authentication|session|not authenticated/i.test(
      message,
    )
  )
    return parentJson(
      {
        ok: false,
        error: "Sign in again to continue. Your saved support is still here.",
      },
      401,
    );
  if (
    /configuration|configured|environment|processing|gate|parent service|not enabled|not available/i.test(
      message,
    )
  )
    return parentJson(
      {
        ok: false,
        error:
          "Online support is not accepting information in this environment yet. You can still use the official help options.",
      },
      503,
    );
  return parentJson(
    {
      ok: false,
      error:
        "We couldn't save that change. Your saved work is unchanged. Please try again.",
    },
    500,
  );
}
