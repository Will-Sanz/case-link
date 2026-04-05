import "server-only";

import type { AiMode } from "@/lib/ai/ai-mode";
import { parseAiMode } from "@/lib/ai/ai-mode";
import {
  augmentInstructionsForMode,
  getDefaultMaxTokensForTask,
  getModelForTask,
  modelSupportsReasoningEffort,
  taskUsesResponsesApi,
  type AiTaskType,
} from "@/lib/ai/models";
import { isAllowedOpenAiModelId } from "@/lib/ai/model-allowlist";
import type { OpenAiRequestMeta } from "@/lib/ai/openai-request-meta";
import { getEnv } from "@/lib/env";
import { takeOpenAiRateSlot } from "@/lib/rate-limit/ai-rate-limit";

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

export type CreateResponseOptions = {
  taskType: AiTaskType;
  instructions: string;
  input: string | ChatMessage[];
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
  | { ok: false; error: string };

function summarizeInput(input: string | ChatMessage[]): { chars: number; preview: string } {
  if (typeof input === "string") {
    return { chars: input.length, preview: input.slice(0, 1200) };
  }
  const combined = input.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
  return { chars: combined.length, preview: combined.slice(0, 1200) };
}

function exposeAiErrorToClient(internal: string): string {
  if (internal.startsWith("Too many AI requests")) return internal;
  if (internal.startsWith("Request is too large")) return internal;
  if (process.env.NODE_ENV === "development" || process.env.OPENAI_DEBUG === "1") {
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
    userId: meta.userId,
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
 * Reasoning models (o1, o3, o4, …) return 400 if `temperature` is sent on Responses / Chat.
 */
function modelSupportsTemperature(modelId: string): boolean {
  const id = modelId.toLowerCase().trim();
  // e.g. o3, o3-mini, o4-mini-2025-01-01
  if (/^o\d/.test(id)) return false;
  return true;
}

/**
 * Call OpenAI. Uses Responses API for core reasoning tasks, Chat Completions for helpers.
 * Supports env override: OPENAI_MODEL_OVERRIDE forces a single model for all tasks.
 */
export async function createAiResponse(
  options: CreateResponseOptions,
): Promise<CreateResponseResult> {
  const env = getEnv();
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: exposeAiErrorToClient("OPENAI_API_KEY is not set") };
  }

  const meta = options.requestMeta;
  if (meta) {
    const allowed = takeOpenAiRateSlot(meta.userId);
    if (!allowed) {
      const msg = "Too many AI requests. Please wait a minute and try again.";
      logOpenAiUsage(meta, options.taskType, "(rate_limited)", { ok: false, error: msg }, 0);
      return { ok: false, error: msg };
    }
  }

  const mode = parseAiMode(options.aiMode);
  const modelOverride = env.OPENAI_MODEL_OVERRIDE?.trim();
  const model = modelOverride || getModelForTask(options.taskType, mode);
  if (!isAllowedOpenAiModelId(model)) {
    const internal = `Resolved model id is not allowed: ${model}`;
    console.error("[ai]", internal);
    return { ok: false, error: exposeAiErrorToClient(internal) };
  }

  const useResponses = !modelOverride && taskUsesResponsesApi(options.taskType);
  const instructions = augmentInstructionsForMode(options.instructions, mode);
  const requestedMax = options.maxTokens ?? getDefaultMaxTokensForTask(options.taskType, mode);
  const outputCap =
    typeof env.OPENAI_MAX_OUTPUT_TOKENS === "number" &&
    Number.isFinite(env.OPENAI_MAX_OUTPUT_TOKENS) &&
    env.OPENAI_MAX_OUTPUT_TOKENS >= 256
      ? Math.min(32_768, Math.floor(env.OPENAI_MAX_OUTPUT_TOKENS))
      : 8192;
  const maxTokens = Math.min(requestedMax, outputCap);

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
    return { ok: false, error: exposeAiErrorToClient(err) };
  }

  const resolved: CreateResponseOptions = { ...options, instructions, maxTokens };

  const debug = process.env.OPENAI_DEBUG === "1";
  const payloadDebug = process.env.OPENAI_PAYLOAD_DEBUG === "1";
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
    });
    if (payloadDebug) {
      console.info("[ai] request:instructions", instructions.slice(0, 2000));
      console.info("[ai] request:input_preview", inputSummary.preview);
    }
  }

  try {
    const rawResult = useResponses
      ? await callResponsesApi(apiKey, model, resolved, debug, mode)
      : await callChatCompletionsApi(apiKey, model, resolved, debug);
    const result: CreateResponseResult =
      rawResult.ok ?
        rawResult
      : {
          ok: false,
          error: exposeAiErrorToClient(rawResult.error),
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
      if (payloadDebug && rawResult.ok) {
        console.info("[ai] response:preview", rawResult.text.slice(0, 2500));
      }
    }

    if (meta) {
      logOpenAiUsage(meta, options.taskType, model, rawResult, Date.now() - startedAt);
    }

    return result;
  } catch (e) {
    if (isAbortOrTimeoutError(e)) {
      const internal = `OpenAI request timed out after ${OPENAI_FETCH_TIMEOUT_MS / 1000}s`;
      if (debug) console.info(`[ai] task=${options.taskType} model=${model} error=`, internal);
      const out = { ok: false as const, error: exposeAiErrorToClient(internal) };
      if (meta) {
        logOpenAiUsage(meta, options.taskType, model, { ok: false, error: internal }, Date.now() - startedAt);
      }
      return out;
    }
    const internal = e instanceof Error ? e.message : "Request failed";
    if (debug) {
      console.info(`[ai] task=${options.taskType} model=${model} error=`, internal);
    }
    const out = { ok: false as const, error: exposeAiErrorToClient(internal) };
    if (meta) {
      logOpenAiUsage(meta, options.taskType, model, { ok: false, error: internal }, Date.now() - startedAt);
    }
    return out;
  }
}

async function callResponsesApi(
  apiKey: string,
  model: string,
  options: CreateResponseOptions,
  debug: boolean,
  mode: AiMode,
): Promise<CreateResponseResult> {
  const input =
    typeof options.input === "string"
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
  };
  if (modelSupportsReasoningEffort(model)) {
    body.reasoning = { effort: mode === "thinking" ? "high" : "low" };
  }
  if (modelSupportsTemperature(model)) {
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

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (debug) console.info("[ai] Responses API error", res.status, errText.slice(0, 300));
    return { ok: false, error: `API ${res.status}: ${errText.slice(0, 100)}` };
  }

  const data = (await res.json()) as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { total_tokens?: number };
  };

  const text = extractOutputText(data);
  if (text === null) {
    return { ok: false, error: "Empty response" };
  }

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
    max_tokens: options.maxTokens ?? 4096,
  };
  if (modelSupportsTemperature(model)) {
    body.temperature = options.temperature ?? 0.4;
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

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (debug) console.info("[ai] Chat error", res.status, errText.slice(0, 300));
    return { ok: false, error: `API ${res.status}: ${errText.slice(0, 100)}` };
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { total_tokens?: number };
  };

  const raw = data.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Empty response" };
  }

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
