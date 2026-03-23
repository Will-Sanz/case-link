import "server-only";

import { getEnv } from "@/lib/env";
import {
  getModelForTask,
  useResponsesApi,
  type AiTaskType,
} from "@/lib/ai/models";

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
  /** Legacy JSON mode — model returns valid JSON only; no schema enforcement. */
  responseFormat?: "json_object";
  /** When set, API enforces this schema (Responses: text.format; Chat: response_format json_schema). */
  structuredJsonSchema?: StructuredJsonSchema;
  temperature?: number;
  maxTokens?: number;
};

export type CreateResponseResult =
  | { ok: true; text: string; model: string; usage?: { total_tokens?: number } }
  | { ok: false; error: string };

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
    return { ok: false, error: "OPENAI_API_KEY is required" };
  }

  const modelOverride = process.env.OPENAI_MODEL_OVERRIDE?.trim();
  const model = modelOverride || getModelForTask(options.taskType);
  const useResponses = !modelOverride && useResponsesApi(options.taskType);

  const debug = process.env.OPENAI_DEBUG === "1";

  try {
    if (useResponses) {
      return await callResponsesApi(apiKey, model, options, debug);
    }
    return await callChatCompletionsApi(apiKey, model, options, debug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Request failed";
    if (debug) {
      console.info(`[ai] task=${options.taskType} model=${model} error=`, msg);
    }
    return { ok: false, error: msg };
  }
}

async function callResponsesApi(
  apiKey: string,
  model: string,
  options: CreateResponseOptions,
  debug: boolean,
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
