import assert from "node:assert/strict";
import { readFileSync, appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

// Loaded only by the test runner's Node command, never by application source or deployment config.
assert.ok(/^caselink-synthetic-[a-f0-9-]{36}$/.test(process.env.OPENAI_API_KEY ?? ""), "Synthetic browser-test credential required");
assert.equal(process.env.CASELINK_ENVIRONMENT, "test");
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, "127.0.0.1");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href !== "https://api.openai.com/v1/responses") {
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "The browser test app cannot send outbound requests.");
    return realFetch(input, options);
  }
  const request = JSON.parse(options.body);
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  const schema = request.text.format.name;
  const control = JSON.parse(readFileSync("tmp/e2e/provider-control.json", "utf8"));
  appendFileSync("tmp/e2e/provider-calls.jsonl", JSON.stringify({ schema, store: request.store }) + "\n");
  if (control.delayMs) await delay(control.delayMs, undefined, { signal: options.signal });
  if (control.failSchema === schema) return new Response("Synthetic provider unavailable", { status: 503 });
  let output;
  if (schema === "lean_intervention_plan") {
    const start = request.input.match(/The plan starts on (\d{4}-\d{2}-\d{2})/)[1];
    output = { steps: [
      ["Prepare a housing intake", "Gather the agreed materials", "Confirm which preparation materials the family has agreed to gather.", "The family has a clear preparation checklist."],
      ["Follow up on the referral", "Check the intake outcome", "Ask about the response to the existing referral and record its outcome.", "The case manager knows the referral status."],
      ["Sustain the agreed support", "Review ongoing arrangements", "Review whether the chosen support is working and discuss any changed needs.", "The family agrees whether to continue the arrangement."],
    ].map(([title, task, summary, expected_outcome], index) => {
      const target = new Date(start + "T12:00:00Z");
      target.setUTCDate(target.getUTCDate() + 7 + index * 14);
      return { goal: "Agree a housing support plan", title,
        summary,
        action_items: [{ title: task, description: "Confirm the family's preferred next step.", target_date: target.toISOString().slice(0, 10) }],
        timing: null, required_documents: ["Agreed preparation checklist"], resource_ids: [],
        expected_outcome, priority: "medium", additional_guidance: null };
    }) };
  } else if (schema.startsWith("lean_plan_phase_")) {
    const phase = schema.slice(-2);
    const inputText = request.input;
    const start = inputText.match(/The plan starts on (\d{4}-\d{2}-\d{2})/)[1];
    const target = new Date(start + "T12:00:00Z");
    target.setUTCDate(target.getUTCDate() + ({ 30: 7, 60: 35, 90: 63 })[phase]);
    const labels = { 30: ["Prepare a housing intake", "Gather the agreed materials"], 60: ["Follow up on the referral", "Check the intake outcome"], 90: ["Sustain the agreed support", "Review ongoing arrangements"] };
    const [title, task] = labels[phase];
    output = { steps: [{ phase, goal: "Agree a housing support plan", title,
      summary: "Discuss the family's preferences and confirm the next step together.",
      action_items: [{ title: task, description: "Confirm the family's preferred next step.", week_index: ({ 30: 1, 60: 5, 90: 9 })[phase], target_date: target.toISOString().slice(0, 10) }],
      timing: null, required_documents: ["Agreed preparation checklist"], resource_ids: [],
      expected_outcome: "The family and case manager agree on the next step.", priority: "medium", additional_guidance: null }] };
  } else if (schema === "plan_refine_lean_steps") {
    const current = JSON.parse(request.input.split("## Current plan (lean view, preserve unless feedback asks to change)\n")[1].split("\n\n## Instructions")[0]);
    const title = current.length > 1 ? "Agree the housing support priorities" : "Prepare the agreed housing intake";
    output = { steps: current.map((step, index) => ({ id: step.id, phase: step.phase,
      title: index === 0 ? title : step.title, description: step.description,
      action_items: null, required_documents: null, resource_ids: null, expected_outcome: step.expected_outcome,
      timing_guidance: step.timing_guidance ?? "", priority: null })) };
  } else if (schema === "case_assistant_answer") {
    output = { answer: "Review the latest saved task and confirm the family's preferred next step. Verify current eligibility and availability before making a referral.", resource_ids: [] };
  } else {
    throw new Error("Unexpected AI contract in the browser journey");
  }
  return Response.json({ model: request.model, status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
};
