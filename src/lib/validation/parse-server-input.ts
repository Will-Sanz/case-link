import { z } from "zod";

export type ParseServerInputFailure = {
  ok: false;
  /** Safe, user-facing message (first issue or generic). */
  error: string;
};

export type ParseServerInputSuccess<T> = { ok: true; data: T };

export type ParseServerInputResult<T> = ParseServerInputSuccess<T> | ParseServerInputFailure;

/**
 * Shared Zod entry point for server actions and route handlers.
 * Prefer `.strict()` on object schemas when you need to reject unknown keys.
 */
export function parseServerInput<TSchema extends z.ZodType>(
  schema: TSchema,
  raw: unknown,
): ParseServerInputResult<z.infer<TSchema>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first?.message ?? "Invalid request",
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Parse URLSearchParams or a plain object of query strings (e.g. from `searchParams`).
 */
export function parseSearchParams<TSchema extends z.ZodType>(
  schema: TSchema,
  raw: Record<string, string | string[] | undefined>,
): ParseServerInputResult<z.infer<TSchema>> {
  const asObject = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  return parseServerInput(schema, asObject);
}
