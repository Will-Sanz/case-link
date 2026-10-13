import "server-only";
import { z } from "zod";

import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import { pdfBase64DataUrl } from "@/lib/ai/file-input";
import {
  augmentInstructionsForMode,
  getDefaultMaxTokensForTask,
  getModelForTask,
  modelSupportsReasoningEffort,
  taskUsesResponsesApi,
  type AiTaskType,
} from "@/lib/ai/models";
import { isAllowedOpenAiModelId, OPENAI_MODELS } from "@/lib/ai/model-allowlist";
import type { OpenAiRequestMeta } from "@/lib/ai/openai-request-meta";
import { getEnv } from "@/lib/env";
import { isDev } from "@/lib/env/runtime";
import { consumeOpenAiRateSlot } from "@/lib/rate-limit/ai-rate-limit";

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
  strict?: boolean;
};

export type AiFileInput = {
  filename: string;
  /** Raw base64, without a data-URL prefix. */
  fileDataBase64: string;
};

export type CreateResponseOptions = {
  taskType: AiTaskType;
  instructions: string;
  input: string | ChatMessage[];
  /** Responses API file inputs. Used only for short-lived, request-scoped analysis. */
  fileInputs?: AiFileInput[];
  /** Legacy JSON mode, model returns valid JSON only; no schema enforcement. */
  responseFormat?: "json_object";
  /** When set, API enforces this schema (Responses: text.format; Chat: response_format json_schema). */
  structuredJsonSchema?: StructuredJsonSchema;
  temperature?: number;
  maxTokens?: number;
  /** Defaults to fast when omitted. */
  aiMode?: AiMode;
  /** When set, applies per-user rate limits and emits lightweight `[openai-usage]` logs. */
  requestMeta?: OpenAiRequestMeta;
};

export type CreateResponseResult =
  | { ok: true; text: string; model: string; usage?: { total_tokens?: number } }
  | { ok: false; error: string; code?: "rate_limited" | "incomplete" | "refused" | "provider_error" | "invalid_response" | "timeout" | "network_error"; retryAfter?: number };

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
    ok: result.ok,
    total_tokens: result.ok ? (result.usage?.total_tokens ?? null) : null,
    elapsedMs,
    ts: new Date().toISOString(),
  });
}

/**
 * Call OpenAI. Uses Responses API for core reasoning tasks, Chat Completions for helpers.
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
  const budget = await consumeOpenAiRateSlot(options.taskType);
  if (!budget.allowed) {
    const msg = "Too many AI requests. Please wait a minute and try again.";
    if (meta) {
      logOpenAiUsage(meta, options.taskType, "(rate_limited)", { ok: false, error: msg }, 0);
    }
    return { ok: false, error: msg, code: "rate_limited", retryAfter: budget.retryAfter };
  }

  const mode = parseAiMode(options.aiMode);
  const modelOverride = env.OPENAI_MODEL_OVERRIDE?.trim();
  const model = modelOverride || getModelForTask(options.taskType, mode);
  if (!isAllowedOpenAiModelId(model)) {
    const internal = `Resolved model id is not allowed: ${model}`;
    console.error("[ai]", internal);
    return { ok: false, error: exposeAiErrorToClient(internal, envDebug) };
  }

  const useResponses = Boolean(options.fileInputs?.length) ||
    taskUsesResponsesApi(options.taskType);
  const instructions = augmentInstructionsForMode(options.instructions, mode);
  const requestedMax = options.maxTokens ?? getDefaultMaxTokensForTask(options.taskType, mode);
  const outputCap =
    typeof env.OPENAI_MAX_OUTPUT_TOKENS === "number" &&
    Number.isFinite(env.OPENAI_MAX_OUTPUT_TOKENS) &&
    env.OPENAI_MAX_OUTPUT_TOKENS >= 256
      ? Math.min(32_768, Math.floor(env.OPENAI_MAX_OUTPUT_TOKENS))
      : 8192;
  const maxTokens = Math.min(requestedMax, outputCap, OPENAI_MODELS[model].maxOutputTokens);

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
  if (options.fileInputs?.length && typeof options.input !== "string") {
    const internal = "File inputs require a single text prompt.";
    return { ok: false, error: exposeAiErrorToClient(internal, envDebug) };
  }

  const resolved: CreateResponseOptions = { ...options, instructions, maxTokens };

  const debug = envDebug;
  const payloadDebug = env.OPENAI_PAYLOAD_DEBUG === "1";
  const startedAt = Date.now();

  if (debug || payloadDebug) {
    const reasoning =
      modelSupportsReasoningEffort(model) ? (mode === "thinking" ? "high" : "low") : null;
    console.info("[ai] request:start", {
      taskType: options.taskType,
      model,
      aiMode: mode,
      reasoningEffort: reasoning,
      api: useResponses ? "responses" : "chat.completions",
      hasStructuredJsonSchema: Boolean(options.structuredJsonSchema),
      responseFormat: options.responseFormat ?? null,
      inputChars: inputSummary.chars,
      instructionsChars: instructions.length,
      maxTokens,
      fileCount: options.fileInputs?.length ?? 0,
    });
    if (payloadDebug) {
      console.info("[ai] request:payload_summary", {
        inputChars: inputSummary.chars,
        instructionsChars: instructions.length,
        fileCount: options.fileInputs?.length ?? 0,
      });
    }
  }

  try {
    const rawResult = useResponses
      ? await callResponsesApi(apiKey, model, resolved, debug, mode)
      : await callChatCompletionsApi(apiKey, model, resolved, debug, mode);
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

const usageSchema = z.object({ total_tokens: z.number().int().nonnegative().optional() }).optional();
const responsesBodySchema = z.object({
  status: z.string(),
  error: z.unknown().optional(),
  output: z.array(z.object({
    type: z.string(),
    status: z.string().optional(),
    text: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
  usage: usageSchema,
});
const chatBodySchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
  })).min(1),
  usage: usageSchema,
});

function invalidResponse(): CreateResponseResult {
  return { ok: false, code: "invalid_response", error: "The AI returned an unusable answer. Your saved work is unchanged. Try again." };
}

function providerHttpError(response: Response): CreateResponseResult {
  // Provider error bodies can echo case input; never expose or log them.
  void response.body?.cancel().catch(() => {});
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header)
      : header ? (Date.parse(header) - Date.now()) / 1000 : 60;
    const retryAfter = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60;
    return { ok: false, code: "rate_limited", retryAfter, error: `The AI service is busy. Try again in ${retryAfter} seconds.` };
  }
  return { ok: false, code: "provider_error", error: "The AI service could not complete this request. Try again." };
}

async function callResponsesApi(
  apiKey: string,
  model: string,
  options: CreateResponseOptions,
  debug: boolean,
  mode: AiMode,
): Promise<CreateResponseResult> {
  const input =
    typeof options.input === "string" && options.fileInputs?.length
      ? [
          {
            role: "user",
            content: [
              { type: "input_text", text: options.input },
              ...options.fileInputs.map((file) => ({
                type: "input_file",
                filename: file.filename,
                file_data: pdfBase64DataUrl(file.fileDataBase64),
              })),
            ],
          },
        ]
      : typeof options.input === "string"
      ? options.input
      : options.input.map((m) => ({
          role: m.role,
          content: m.content,
        }));

  const body: Record<string, unknown> = {
    model,
    instructions: options.instructions,
    input,
    max_output_tokens: options.maxTokens ?? 4096,
    store: false,
  };
  if (modelSupportsReasoningEffort(model)) {
    body.reasoning = { effort: mode === "thinking" ? "high" : "low" };
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
        strict: options.structuredJsonSchema.strict !== false,
      },
      // Omit `verbosity`: values like "high" are not supported on all models (e.g. gpt-4o) and return 400.
    };
  } else if (options.responseFormat === "json_object") {
    body.text = {
      format: { type: "json_object" },
    };
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: openAiAbortSignal(),
  });

  if (!res.ok) return providerHttpError(res);

  const parsed = responsesBodySchema.safeParse(await res.json());
  if (!parsed.success) return invalidResponse();
  const data = parsed.data;
  if (data.error) return { ok: false, code: "provider_error", error: "The AI service could not complete this request. Try again." };
  if (data.output.some((item) => item.content?.some((part) => part.type === "refusal"))) {
    return { ok: false, code: "refused", error: "The AI could not help with that request. Reword it or edit the plan yourself." };
  }
  if (data.status !== "completed" || data.output.some((item) => item.status && item.status !== "completed")) {
    return { ok: false, code: "incomplete", error: "The AI answer was incomplete and was not applied. Try a shorter request." };
  }
  const text = extractOutputText(data);
  if (!text?.trim()) return invalidResponse();

  if (debug) {
    console.info(`[ai] Responses task=${options.taskType} model=${model} tokens=`, data.usage?.total_tokens);
  }

  return {
    ok: true,
    text,
    model,
    usage: data.usage,
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

async function callChatCompletionsApi(
  apiKey: string,
  model: string,
  options: CreateResponseOptions,
  debug: boolean,
  mode: AiMode,
): Promise<CreateResponseResult> {
  const messages =
    typeof options.input === "string"
      ? [
          { role: "system" as const, content: options.instructions },
          { role: "user" as const, content: options.input },
        ]
      : options.input;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: options.maxTokens ?? 4096,
    store: false,
  };
  if (!modelSupportsReasoningEffort(model)) {
    body.temperature = options.temperature ?? 0.4;
  }
  if (modelSupportsReasoningEffort(model)) {
    body.reasoning_effort = mode === "thinking" ? "high" : "none";
  }

  if (options.structuredJsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: options.structuredJsonSchema.name,
        schema: options.structuredJsonSchema.schema,
        strict: options.structuredJsonSchema.strict !== false,
      },
    };
  } else if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: openAiAbortSignal(),
  });

  if (!res.ok) return providerHttpError(res);

  const parsed = chatBodySchema.safeParse(await res.json());
  if (!parsed.success) return invalidResponse();
  const data = parsed.data;
  const choice = data.choices[0];
  if (choice.message.refusal) {
    return { ok: false, code: "refused", error: "The AI could not help with that request. Reword it or edit the plan yourself." };
  }
  if (choice.finish_reason !== "stop") {
    return { ok: false, code: "incomplete", error: "The AI answer was incomplete and was not applied. Try a shorter request." };
  }
  const raw = choice.message.content;
  if (!raw?.trim()) return invalidResponse();

  if (debug) {
    console.info(`[ai] Chat task=${options.taskType} model=${model} tokens=`, data.usage?.total_tokens);
  }

  return {
    ok: true,
    text: raw.trim(),
    model,
    usage: data.usage,
  };
}
