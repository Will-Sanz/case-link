const DEFAULT_INTERNAL_PATH = "/families";

function isSafeCandidate(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !/[\\\u0000-\u001f\u007f]/.test(value)
  );
}

/** Returns a same-origin relative path, including query/hash, or a safe fallback. */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = DEFAULT_INTERNAL_PATH,
): string {
  if (!value || !isSafeCandidate(value)) return fallback;

  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return fallback;
    }
    if (!isSafeCandidate(decoded)) return fallback;
  }

  try {
    const base = new URL("https://caselink.invalid");
    const resolved = new URL(value, base);
    return resolved.origin === base.origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : fallback;
  } catch {
    return fallback;
  }
}
