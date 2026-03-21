import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Server-only; required for privileged scripts (e.g. resource import). */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Server-only; when set, plan generation tries OpenAI first, then rules fallback. */
  OPENAI_API_KEY: z.string().optional(),
  /** Chat model for plan generation (default gpt-4o-mini). */
  OPENAI_PLAN_MODEL: z.string().optional(),
  /** Set to "1" to log OpenAI request/response in any NODE_ENV. */
  OPENAI_DEBUG: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid environment: ${JSON.stringify(fieldErrors, null, 2)}`,
    );
  }
  cached = parsed.data;
  return parsed.data;
}

export function requireServiceRoleKey(): string {
  const key = getEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for this operation (set it in .env.local).",
    );
  }
  return key;
}
