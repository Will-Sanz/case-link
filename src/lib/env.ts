import "server-only";

import { z } from "zod";
import { isAllowedOpenAiModelId } from "@/lib/ai/model-allowlist";
import { productionPostureIssues } from "@/lib/security/production-posture";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .optional()
    .default("development"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL (e.g. https://xxx.supabase.co)"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  /**
   * Canonical public URL (e.g. https://app.example.com). Recommended for signup `redirectTo`
   * and other auth URLs when not on Vercel, or when overriding the production fallback.
   */
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  /** @deprecated Prefer NEXT_PUBLIC_SITE_URL; still read for backwards compatibility. */
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  /** Server-only; required for privileged database scripts. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Server-only; required in production for the approved Core workflow. */
  OPENAI_API_KEY: z.string().optional(),
  /** Server-only; overrides plan generation/regeneration model (default: gpt-5.6-luna). */
  OPENAI_PLAN_MODEL: z.string().optional(),
  /** Server-only; lean per-phase plan generation (default: same as OPENAI_UI_MODEL). */
  OPENAI_PLAN_PHASE_MODEL: z.string().optional(),
  /** Server-only; per-phase / thinking-quality preset (default: OPENAI_PLAN_MODEL or gpt-5.6-luna). */
  OPENAI_PLAN_PHASE_THINKING_MODEL: z.string().optional(),
  /** Server-only; non-plan tasks in Thinking mode (default: OPENAI_PLAN_MODEL or gpt-5.6-luna). */
  OPENAI_THINKING_UI_MODEL: z.string().optional(),
  /** Server-only; monolithic full-plan in Fast mode (default: OPENAI_UI_MODEL). */
  OPENAI_FAST_PLAN_MODEL: z.string().optional(),
  /** Server-only; overrides chat, UI helpers, refinements, and other non-plan AI (default: gpt-5.6-luna). */
  OPENAI_UI_MODEL: z.string().optional(),
  /** Override: force this model for ALL AI tasks (e.g. gpt-4o for QA). */
  OPENAI_MODEL_OVERRIDE: z.string().optional(),
  /** Set to "1" to log AI requests and model selection. */
  OPENAI_DEBUG: z.string().optional(),
  /** Set to "1" to log OpenAI request payloads (server only). */
  OPENAI_PAYLOAD_DEBUG: z.string().optional(),
  /** Plan regeneration trace logs (server only). */
  PLAN_REGENERATE_DEBUG: z.string().optional(),
  PLAN_REFINE_DEBUG: z.string().optional(),
  /** Explicit launch posture. Required for production deployments. */
  CASELINK_TENANCY_MODE: z.literal("single-tenant").optional(),
  CASELINK_PDF_MODE: z.literal("fillable-only").optional(),
  CASELINK_INVITE_ONLY: z.literal("1").optional(),
  CASELINK_HSTS: z.literal("1").optional(),
  CASELINK_ENVIRONMENT: z.enum(["local", "test", "preview", "production"]).optional(),
  /** Reject prompts larger than this (character count of serialized input). Default 120000. */
  OPENAI_MAX_INPUT_CHARS: z.coerce.number().optional(),
  /** Hard cap on max_tokens / max_output_tokens per request. Default 8192. */
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().optional(),
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
 * Route Handlers, or `server-only` modules, not from client components.
 * Requires NEXT_PUBLIC_* Supabase vars at runtime (and during `next build` on CI/Vercel).
 */
function assertOptionalModelEnv(name: string, value: string | undefined): void {
  if (!value?.trim()) return;
  const id = value.trim();
  if (!isAllowedOpenAiModelId(id)) {
    throw new Error(
      `Invalid ${name}: "${id}" is not an allowed OpenAI model id pattern. See src/lib/ai/model-allowlist.ts.`,
    );
  }
}

export function getEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error));
  }
  const data = parsed.data;
  assertOptionalModelEnv("OPENAI_MODEL_OVERRIDE", data.OPENAI_MODEL_OVERRIDE);
  assertOptionalModelEnv("OPENAI_PLAN_MODEL", data.OPENAI_PLAN_MODEL);
  assertOptionalModelEnv("OPENAI_PLAN_PHASE_MODEL", data.OPENAI_PLAN_PHASE_MODEL);
  assertOptionalModelEnv("OPENAI_PLAN_PHASE_THINKING_MODEL", data.OPENAI_PLAN_PHASE_THINKING_MODEL);
  assertOptionalModelEnv("OPENAI_THINKING_UI_MODEL", data.OPENAI_THINKING_UI_MODEL);
  assertOptionalModelEnv("OPENAI_FAST_PLAN_MODEL", data.OPENAI_FAST_PLAN_MODEL);
  assertOptionalModelEnv("OPENAI_UI_MODEL", data.OPENAI_UI_MODEL);
  if (data.VERCEL_ENV === "production" || data.CASELINK_ENVIRONMENT === "production") {
    const postureIssues = productionPostureIssues(data);
    if (postureIssues.length > 0) {
      throw new Error(`Unsafe production posture:\n${postureIssues.join("\n")}`);
    }
  }
  cached = data;
  return cached;
}

/** Re-export for modules that must not import the full `getEnv` graph. */
export { isDev, isProd } from "@/lib/env/runtime";
