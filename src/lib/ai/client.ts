import "server-only";

import { getEnv } from "@/lib/env";
import {
  getModelForTask,
  useResponsesApi,
  type AiTaskType,
} from "@/lib/ai/models";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CreateResponseOptions = {
  taskType: AiTaskType;
  instructions: string;
  input: string | ChatMessage[];
  /** JSON schema for structured output; if set, response is parsed as JSON */
  responseFormat?: "json_object";
  temperature?: number;
  maxTokens?: number;
};

export type CreateResponseResult =
  | { ok: true; text: string; model: string; usage?: { total_tokens?: number } }
  | { ok: false; error: string };

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
    temperature: options.temperature ?? 0.4,
    max_output_tokens: options.maxTokens ?? 4096,
  };

  // Responses API: structured output via text.format would require full JSON schema.
  // For now we rely on prompt instructions + parse; both APIs return raw text.

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
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
  };

  if (options.responseFormat === "json_object") {
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
