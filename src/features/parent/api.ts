export class ParentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ParentApiError";
  }
}

export async function parentApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/parent${path}`, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers:
        init.body instanceof FormData
          ? init.headers
          : { "Content-Type": "application/json", ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ParentApiError(
      "We couldn’t connect. Your changes are still on this page. Check your connection and try again.",
      0,
    );
  }
  let body: T & { ok?: boolean; error?: string };
  try {
    body = await response.json();
  } catch {
    throw new ParentApiError(
      "We couldn’t read the response. Your information is still on this page. Please try again.",
      response.status,
    );
  }
  if (!response.ok || body.ok === false)
    throw new ParentApiError(
      typeof body.error === "string"
        ? body.error
        : "We couldn’t finish that step. Please try again.",
      response.status,
    );
  return body;
}

export function safeReturnPath(value: string | undefined): string {
  return value &&
    /^\/(?:get-support|my-support|account|support\/[a-zA-Z0-9-]+)(?:\?need=(?:food|utilities))?$/.test(
      value,
    )
    ? value
    : "/my-support";
}

export function displayDate(value: string, includeTime = false): string {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
  );
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
        ...(includeTime
          ? ({ hour: "numeric", minute: "2-digit" } as const)
          : {}),
      }).format(date);
}
