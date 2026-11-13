import { NEEDS } from "@/lib/parent/domain";
import { SNAP_APPLICATION_NOTICE_VERSION, WIC_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";
import wicSource from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE } from "@/lib/parent/peco-application-fields";

export type ParentAuthorizationWindow = {
  authorization?: {
    issuedAt: string;
    expiresAt: string;
    snapApplication?: { collectionEnabled: boolean; noticeVersion: string | null };
    wicApplication?: { collectionEnabled: boolean; noticeVersion: string | null; expiresAt: string | null };
    pecoApplication?: { collectionEnabled: boolean; noticeVersion: string | null; expiresAt: string | null };
  };
};

export function canCollectSnapApplication(value: ParentAuthorizationWindow | null): boolean {
  return value?.authorization?.snapApplication?.collectionEnabled === true &&
    value.authorization.snapApplication.noticeVersion === SNAP_APPLICATION_NOTICE_VERSION;
}

export function canCollectWicApplication(value: ParentAuthorizationWindow | null): boolean {
  const collection = value?.authorization?.wicApplication, now = Date.now();
  return collection?.collectionEnabled === true && collection.noticeVersion === WIC_APPLICATION_NOTICE_VERSION &&
    typeof collection.expiresAt === "string" && Date.parse(collection.expiresAt) > now && now >= Date.parse(wicSource.sourceCheckedAt) && now < Date.parse(wicSource.verifiedUntil);
}

export function canCollectPecoApplication(value: ParentAuthorizationWindow | null): boolean {
  const collection = value?.authorization?.pecoApplication, now = Date.now();
  return collection?.collectionEnabled === true && collection.noticeVersion === PECO_APPLICATION_NOTICE_VERSION &&
    typeof collection.expiresAt === "string" && Date.parse(collection.expiresAt) > now &&
    now >= Date.parse(PECO_APPLICATION_SOURCE.sourceCheckedAt) && now < Date.parse(PECO_APPLICATION_SOURCE.verifiedUntil);
}

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

export async function boundedParentApi(path: string, init: RequestInit, owner: AbortSignal, expiry: string): Promise<unknown> {
  const remaining = Math.min(30_000, Date.parse(expiry) - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0 || owner.aborted) throw new Error();
  const deadline = new AbortController(), signal = AbortSignal.any([owner, deadline.signal]);
  let rejectAbort!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = () => rejectAbort(new ParentApiError("We couldn’t finish checking this information. Check your connection and try again.", 0));
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => deadline.abort(), remaining);
  try { return await Promise.race([parentApi<unknown>(path, { ...init, signal }), stopped]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
}


export function safeReturnPath(value: string | undefined): string {
  if (!value || value.trim() !== value) return "/my-support";
  const [path, need, ...extra] = value.split("?need=");
  return (
    /^\/(?:get-support|my-support|account|support\/[a-zA-Z0-9-]+)$/.test(path) &&
    extra.length === 0 &&
    (need === undefined ||
      (path === "/get-support" &&
        (["food", "utilities", ...NEEDS] as readonly string[]).includes(need)))
  ) ? value : "/my-support";
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
