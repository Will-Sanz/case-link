import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL (e.g. https://xxx.supabase.co)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  /** Server-only; required for privileged scripts (e.g. resource import). Not needed for normal app runtime. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Server-only; when set, plan generation tries OpenAI first, then rules fallback. */
  OPENAI_API_KEY: z.string().optional(),
  /** Server-only; overrides plan generation/regeneration model (default: o3). */
  OPENAI_PLAN_MODEL: z.string().optional(),
  /** Server-only; lean per-phase plan generation (default: same as OPENAI_UI_MODEL). */
  OPENAI_PLAN_PHASE_MODEL: z.string().optional(),
  /** Server-only; per-phase / thinking-quality preset (default: OPENAI_PLAN_MODEL or o3). */
  OPENAI_PLAN_PHASE_THINKING_MODEL: z.string().optional(),
  /** Server-only; non-plan tasks in Thinking mode (default: OPENAI_PLAN_MODEL or o3). */
  OPENAI_THINKING_UI_MODEL: z.string().optional(),
  /** Server-only; monolithic full-plan in Fast mode (default: OPENAI_UI_MODEL). */
  OPENAI_FAST_PLAN_MODEL: z.string().optional(),
  /** Server-only; overrides chat, UI helpers, refinements, and other non-plan AI (default: gpt-4.1-mini). */
  OPENAI_UI_MODEL: z.string().optional(),
  /** Override: force this model for ALL AI tasks (e.g. gpt-4o for QA). */
  OPENAI_MODEL_OVERRIDE: z.string().optional(),
  /** Set to "1" to log AI requests and model selection. */
  OPENAI_DEBUG: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function formatEnvError(parsed: z.ZodError): string {
  const issues = parsed.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
  const hint =
    "\n\nFor Vercel: Project Settings → Environment Variables → add the same names for Production (and Preview if used). Redeploy after saving.";
  return `Invalid or missing environment variables:\n${issues.join("\n")}${hint}`;
}

/**
 * Validated server-side env. Call only from Server Components, Server Actions,
 * Route Handlers, or `server-only` modules — not from client components.
 * Requires NEXT_PUBLIC_* Supabase vars at runtime (and during `next build` on CI/Vercel).
 */
export function getEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error));
  }
  cached = parsed.data;
  return parsed.data;
}

export function requireServiceRoleKey(): string {
  const key = getEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for this operation (e.g. npm run db:import). It is not required for the web app on Vercel.",
    );
  }
  return key;
}
