import { pathToFileURL } from "node:url";
import { OPENAI_MODELS } from "../src/lib/ai/model-allowlist";
import { buildLeanPhaseRootJsonSchema, planPhaseResponseSchema } from "../src/lib/plan-generator/lean-plan-schema";
import { OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA, planRefineLeanResponseSchema } from "../src/lib/plan-generator/plan-refine-lean";
import { generatedPlanStep, refinedPlanStep } from "../tests/fixtures/plan-contract";

/** Opt-in synthetic schema smoke test. Never reads family data or prints provider content/credentials. */
export async function testAiSchemaContracts(apiKey: string, request: typeof fetch = fetch) {
  const cases = [
    ...(["30", "60", "90"] as const).map(phase => ({ name: `phase_${phase}`, schema: buildLeanPhaseRootJsonSchema(phase), validator: planPhaseResponseSchema(phase), example: { steps: [{ ...generatedPlanStep, phase }] } })),
    { name: "refinement", schema: OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA, validator: planRefineLeanResponseSchema, example: { steps: [refinedPlanStep] } },
  ];
  const results = [];
  for (const [model, contract] of Object.entries(OPENAI_MODELS)) {
    for (const item of cases) {
      const started = Date.now();
      const response = await request("https://api.openai.com/v1/responses", {
        method: "POST", signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, store: false, max_output_tokens: 1536,
          ...(contract.reasoning ? { reasoning: { effort: "low" } } : { temperature: 0 }),
          instructions: "This is a synthetic software contract check. Copy the supplied example exactly; do not add advice or change values.",
          input: JSON.stringify(item.example), text: { format: { type: "json_schema", name: item.name, schema: item.schema, strict: true } },
        }),
      });
      if (!response.ok) throw new Error(`${model}/${item.name}: HTTP ${response.status}`);
      const body = await response.json();
      if (body?.status !== "completed" || body.error || !Array.isArray(body.output)) throw new Error(`${model}/${item.name}: incomplete or malformed response`);
      const text = body.output.flatMap((part: { type?: string; status?: string; content?: Array<{ type?: string; text?: string }> }) => {
        if (part.type !== "message") return [];
        if (part.status !== "completed" || !Array.isArray(part.content) || part.content.some(content => content.type === "refusal")) throw new Error(`${model}/${item.name}: incomplete or refused message`);
        return part.content.filter(content => content.type === "output_text").map(content => content.text ?? "");
      }).join("");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error(`${model}/${item.name}: invalid JSON`); }
      const validated = item.validator.safeParse(parsed);
      if (!validated.success) throw new Error(`${model}/${item.name}: invalid output contract`);
      // Compare in schema order; JSON property ordering is not meaningful.
      if (JSON.stringify(validated.data) !== JSON.stringify(item.validator.parse(item.example))) throw new Error(`${model}/${item.name}: synthetic values changed`);
      results.push({ model, task: item.name, passed: true, elapsedMs: Date.now() - started, totalTokens: typeof body.usage?.total_tokens === "number" ? body.usage.total_tokens : null });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes("--live") || !process.env.OPENAI_API_KEY?.trim()) {
    console.error("Supply --live and an operator-provided OPENAI_API_KEY to run eight small synthetic requests.");
    process.exitCode = 1;
  } else {
    testAiSchemaContracts(process.env.OPENAI_API_KEY).then(results => console.log(JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, results }, null, 2))).catch(error => {
      console.error(error instanceof Error && /^(gpt-)/.test(error.message) ? error.message : "AI schema contract check failed before completion.");
      process.exitCode = 1;
    });
  }
}
