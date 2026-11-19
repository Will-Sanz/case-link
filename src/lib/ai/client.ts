import "server-only";
import { z } from "zod";

import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import {
  augmentInstructionsForMode,
  getDefaultMaxTokensForTask,
  getModelForTask,
  getReasoningEffortForTask,
  modelSupportsReasoningEffort,
  type ReasoningEffort,
  type AiTaskType,
} from "@/lib/ai/models";
import { isAllowedOpenAiModelId, OPENAI_MODELS } from "@/lib/ai/model-allowlist";
import type { OpenAiRequestMeta } from "@/lib/ai/openai-request-meta";
import { getEnv } from "@/lib/env";
import { isDev } from "@/lib/env/runtime";
import { aiBudgetMessage } from "@/lib/rate-limit/ai-budget-message";
import { consumeOpenAiRateSlot } from "@/lib/rate-limit/ai-rate-limit";
import { findLikelyIdentifiers } from "@/lib/privacy/no-pii";
import { aiUsageSchema, estimateAiCost, type AiUsage } from "@/lib/ai/usage";

/** Wall-clock cap for OpenAI HTTP requests (large plan payloads + reasoning can be slow). */
const OPENAI_FETCH_TIMEOUT_MS = 180_000;

function openAiAbortSignal(): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(new Error("timeout")), OPENAI_FETCH_TIMEOUT_MS);
  return c.signal;
}

function isAbortOrTimeoutError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as Error).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const msg = String((e as Error).message ?? "");
  return /aborted|timeout/i.test(msg);
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** OpenAI Structured Outputs (strict JSON Schema). Preferred over json_object for plan/steps. */
export type StructuredJsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict: true;
};

export type CreateResponseOptions = {
  taskType: AiTaskType;
  instructions: string;
  input: string | ChatMessage[];
  /** API-enforced structured output, also validated by each task before use. */
  structuredJsonSchema?: StructuredJsonSchema;
  temperature?: number;
  maxTokens?: number;
  /** Defaults to fast when omitted. */
  aiMode?: AiMode;
  /** Optional routing metadata for content-free usage logs. All requests are rate limited. */
  requestMeta?: OpenAiRequestMeta;
};

type ResponseUsage = { usage?: AiUsage; returnedModel?: string; serviceTier?: string };
export type CreateResponseResult = ResponseUsage & (
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; code?: "privacy_blocked" | "rate_limited" | "incomplete" | "refused" | "provider_error" | "model_unavailable" | "safety_review" | "invalid_response" | "timeout" | "network_error"; retryAfter?: number });

function payloadHasIdentifiers(value: unknown): boolean {
  if (typeof value === "string") return findLikelyIdentifiers(value).length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => findLikelyIdentifiers(key).length > 0 || payloadHasIdentifiers(child));
}

function summarizeInput(input: string | ChatMessage[]): { chars: number } {
  if (typeof input === "string") {
    return { chars: input.length };
  }
  const combined = input.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  return { chars: combined.length };
}

function exposeAiErrorToClient(internal: string, envDebug: boolean): string {
  if (internal.startsWith("Too many AI requests")) return internal;
  if (internal.startsWith("Request is too large")) return internal;
  if (isDev() || envDebug) {
    return internal;
  }
  if (internal === "OPENAI_API_KEY is not set") {
    return "AI is not configured for this environment.";
  }
  return "The AI service could not complete this request. Please try again.";
}

function logOpenAiUsage(
  meta: OpenAiRequestMeta,
  taskType: AiTaskType,
  model: string,
  result: CreateResponseResult,
  elapsedMs: number,
) {
  console.info("[openai-usage]", {
    route: meta.route,
    taskType,
    model,
    returnedModel: result.returnedModel ?? null,
    ok: result.ok,
    usage: result.usage ?? null,
    serviceTier: result.serviceTier ?? null,
    estimatedUsd: estimateAiCost(result.returnedModel ?? model, result.usage, result.serviceTier),
    elapsedMs,
    ts: new Date().toISOString(),
  });
}

/**
 * Call OpenAI Responses API for the current text-only product tasks.
 * Supports env override: OPENAI_MODEL_OVERRIDE forces a single model for all tasks.
 */
export async function createAiResponse(
  options: CreateResponseOptions,
): Promise<CreateResponseResult> {
  const env = getEnv();
  const envDebug = env.OPENAI_DEBUG === "1";
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: exposeAiErrorToClient("OPENAI_API_KEY is not set", envDebug) };
  }

  const meta = options.requestMeta;
  const mode = parseAiMode(options.aiMode);
  const modelOverride = env.OPENAI_MODEL_OVERRIDE?.trim();
  const model = modelOverride || getModelForTask(options.taskType, mode);
  if (!isAllowedOpenAiModelId(model)) {
    const internal = "The configured AI model is not supported.";
    console.error("[ai]", internal);
    return { ok: false, error: exposeAiErrorToClient(internal, envDebug) };
  }

  const instructions = augmentInstructionsForMode(options.instructions, mode);
  const effort = getReasoningEffortForTask(options.taskType);
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) return { ok: false, error: "Invalid AI reasoning configuration." };
  const taskCap = getDefaultMaxTokensForTask(options.taskType);
  const requestedMax = options.maxTokens ?? taskCap;
  const outputCap =
    typeof env.OPENAI_MAX_OUTPUT_TOKENS === "number" &&
    Number.isFinite(env.OPENAI_MAX_OUTPUT_TOKENS) &&
    env.OPENAI_MAX_OUTPUT_TOKENS >= 256
      ? Math.min(32_768, Math.floor(env.OPENAI_MAX_OUTPUT_TOKENS))
      : 32768;
  if (!Number.isInteger(requestedMax) || requestedMax < 1 || !Number.isInteger(taskCap) || taskCap < 256 || taskCap > 32768) {
    return { ok: false, error: "Invalid AI response size. Try again with the default settings." };
  }
  const maxTokens = Math.min(requestedMax, taskCap, outputCap, OPENAI_MODELS[model].maxOutputTokens);

  const inputSummary = summarizeInput(options.input);
  const maxInputChars =
    typeof env.OPENAI_MAX_INPUT_CHARS === "number" &&
    Number.isFinite(env.OPENAI_MAX_INPUT_CHARS) &&
    env.OPENAI_MAX_INPUT_CHARS >= 5000
      ? Math.min(500_000, Math.floor(env.OPENAI_MAX_INPUT_CHARS))
      : 120_000;
  const promptChars = inputSummary.chars + instructions.length;
  if (promptChars > maxInputChars) {
    const err = `Request is too large for AI processing (${promptChars} chars; max ${maxInputChars}).`;
    if (meta) {
      logOpenAiUsage(meta, options.taskType, model, { ok: false, error: err }, 0);
    }
    return { ok: false, error: exposeAiErrorToClient(err, envDebug) };
  }
  const resolved: CreateResponseOptions = { ...options, instructions, maxTokens };
  // Freeze the exact provider body before any await; no caller can change it after inspection.
  const requestBody = buildResponsesBody(model, resolved, effort);
  if (payloadHasIdentifiers(JSON.parse(requestBody))) {
    return { ok: false, code: "privacy_blocked", error: "This AI request contains likely identifying information. Review the case text, instructions, and conversation before trying again." };
  }
  const budget = await consumeOpenAiRateSlot(options.taskType);
  if (!budget.allowed) {
    const msg = aiBudgetMessage(budget);
    if (meta) {
      logOpenAiUsage(meta, options.taskType, "(rate_limited)", { ok: false, error: msg }, 0);
    }
    return { ok: false, error: msg, code: "rate_limited", retryAfter: budget.retryAfter };
  }

  const debug = envDebug;
  const payloadDebug = env.OPENAI_PAYLOAD_DEBUG === "1";
  const startedAt = Date.now();

  if (debug || payloadDebug) {
    console.info("[ai] request:start", {
      taskType: options.taskType,
      model,
      aiMode: mode,
      reasoningEffort: modelSupportsReasoningEffort(model) ? effort : null,
      api: "responses",
      hasStructuredJsonSchema: Boolean(options.structuredJsonSchema),
      inputChars: inputSummary.chars,
      instructionsChars: instructions.length,
      maxTokens,
    });
    if (payloadDebug) {
      console.info("[ai] request:payload_summary", {
        inputChars: inputSummary.chars,
        instructionsChars: instructions.length,
      });
    }
  }

  try {
    const rawResult = await callResponsesApi(apiKey, model, requestBody, options.taskType, debug);
    const result: CreateResponseResult =
      rawResult.ok ?
        rawResult
      : {
          ...rawResult,
          error: rawResult.code ? rawResult.error : exposeAiErrorToClient(rawResult.error, envDebug),
        };

    if (!rawResult.ok && debug) {
      console.info("[ai] request:error_detail", { error: rawResult.error });
    }

    if (debug || payloadDebug) {
      console.info("[ai] request:end", {
        taskType: options.taskType,
        model,
        aiMode: mode,
        elapsedMs: Date.now() - startedAt,
        ok: rawResult.ok,
        error: rawResult.ok ? null : rawResult.error,
        tokens: rawResult.ok ? (rawResult.usage?.total_tokens ?? null) : null,
        outputChars: rawResult.ok ? rawResult.text.length : null,
      });
    }

    if (meta) {
      logOpenAiUsage(meta, options.taskType, model, rawResult, Date.now() - startedAt);
    }

    return result;
  } catch (e) {
    if (isAbortOrTimeoutError(e)) {
      const internal = `OpenAI request timed out after ${OPENAI_FETCH_TIMEOUT_MS / 1000}s`;
      if (debug) console.info(`[ai] task=${options.taskType} model=${model} error=`, internal);
      const out = { ok: false as const, code: "timeout" as const, error: "The AI request timed out. Your saved work is unchanged. Try again." };
      if (meta) {
        logOpenAiUsage(meta, options.taskType, model, { ok: false, error: internal }, Date.now() - startedAt);
      }
      return out;
    }
    const code = e instanceof SyntaxError ? "invalid_response" as const : "network_error" as const;
    const internal = "The AI service could not complete this request. Your saved work is unchanged. Try again.";
    if (debug) {
      console.info(`[ai] task=${options.taskType} model=${model} error=`, internal);
    }
    const out = { ok: false as const, code, error: internal };
    if (meta) {
      logOpenAiUsage(meta, options.taskType, model, { ok: false, error: internal }, Date.now() - startedAt);
    }
    return out;
  }
}

const responsesBodySchema = z.object({
  model: z.string().max(200).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  service_tier: z.string().max(40).regex(/^[a-z_]+$/).optional(),
  status: z.string(),
  error: z.unknown().optional(),
  output: z.array(z.object({
    type: z.string(),
    status: z.string().optional(),
    text: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
  usage: aiUsageSchema.optional(),
});
function invalidResponse(): CreateResponseResult {
  return { ok: false, code: "invalid_response", error: "The AI returned an unusable answer. Your saved work is unchanged. Try again." };
}

async function providerHttpError(response: Response): Promise<CreateResponseResult> {
  // Inspect only known codes; provider messages can echo case input and are never exposed or logged.
  const body = await response.json().catch(() => null);
  if (body?.error?.code === "misalignment_policy_violation") return { ok: false, code: "safety_review", error: "The AI request needs an administrator's review. Edit the saved plan manually; do not retry this AI request." };
  if (response.status === 403 || response.status === 404 || body?.error?.code === "model_not_found") return { ok: false, code: "model_unavailable", error: "The configured AI model is unavailable for this environment. Your saved work is unchanged. Ask an administrator to check model access." };
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header)
      : header ? (Date.parse(header) - Date.now()) / 1000 : 60;
    const retryAfter = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60;
    return { ok: false, code: "rate_limited", retryAfter, error: `The AI service is busy. Try again in ${retryAfter} seconds.` };
  }
  return { ok: false, code: "provider_error", error: "The AI service could not complete this request. Try again." };
}

function buildResponsesBody(
  model: string,
  options: CreateResponseOptions,
  effort: ReasoningEffort,
): string {
  const body: Record<string, unknown> = {
    model,
    instructions: options.instructions,
    input: typeof options.input === "string" ? options.input : options.input.map(({ role, content }) => ({ role, content })),
    max_output_tokens: options.maxTokens ?? 4096,
    store: false,
    service_tier: "default",
  };
  if (modelSupportsReasoningEffort(model)) {
    body.reasoning = { effort };
  }
  if (!modelSupportsReasoningEffort(model)) {
    body.temperature = options.temperature ?? 0.4;
  }

  if (options.structuredJsonSchema) {
    body.text = {
      format: {
        type: "json_schema",
        name: options.structuredJsonSchema.name,
        schema: options.structuredJsonSchema.schema,
        strict: true,
      },
      // Omit `verbosity`: values like "high" are not supported on all models (e.g. gpt-4o) and return 400.
    };
  }

  return JSON.stringify(body);
}

async function callResponsesApi(apiKey: string, model: string, body: string, taskType: AiTaskType, debug: boolean): Promise<CreateResponseResult> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    signal: openAiAbortSignal(),
  });

  if (!res.ok) return providerHttpError(res);

  const parsed = responsesBodySchema.safeParse(await res.json());
  if (!parsed.success) return invalidResponse();
  const data = parsed.data;
  const telemetry: ResponseUsage = { usage: data.usage, returnedModel: data.model, serviceTier: data.service_tier };
  if (data.error) return { ...telemetry, ok: false, code: "provider_error", error: "The AI service could not complete this request. Try again." };
  if (data.output.some((item) => item.content?.some((part) => part.type === "refusal"))) {
    return { ...telemetry, ok: false, code: "refused", error: "The AI could not help with that request. Reword it or edit the plan yourself." };
  }
  if (data.status !== "completed" || data.output.some((item) => item.status && item.status !== "completed")) {
    return { ...telemetry, ok: false, code: "incomplete", error: "The AI answer was incomplete and was not applied. Try a shorter request." };
  }
  const text = extractOutputText(data);
  if (!text?.trim()) return { ...telemetry, ...invalidResponse() };

  if (debug) {
    console.info(`[ai] Responses task=${taskType} model=${model} tokens=`, data.usage?.total_tokens);
  }

  return {
    ok: true,
    text,
    model,
    usage: data.usage,
    returnedModel: data.model,
    serviceTier: data.service_tier,
  };
}

function extractOutputText(
  data: { output?: Array<Record<string, unknown>>; output_text?: string },
): string | null {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = data.output;
  if (!Array.isArray(output)) return null;
  const texts: string[] = [];
  for (const item of output) {
    const type = item.type as string | undefined;
    if (type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<{ type?: string; text?: string }>) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          texts.push(part.text);
        }
      }
    } else if (type === "output_text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}
