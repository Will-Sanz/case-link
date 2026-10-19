import { expect, it } from "vitest";
import { estimateAiCost } from "./usage";

it.each([["gpt-5.6-luna", .0044], ["gpt-6-luna", .002], ["gpt-6.1-sol", .04], ["gpt-6-astra", .2]] as const)("prices %s without billing reasoning output twice", (model, expected) => {
  expect(estimateAiCost(model, { input_tokens: 10000, output_tokens: 2000, output_tokens_details: { reasoning_tokens: 1000 } })).toBeCloseTo(expected);
});
it("accounts for Standard cache reads/writes", () => {
  expect(estimateAiCost("gpt-6.1-sol", { input_tokens: 1000, output_tokens: 1000, input_tokens_details: { cached_tokens: 500, cache_write_tokens: 200 } })).toBeCloseTo(.01115);
  expect(estimateAiCost("gpt-5.6-luna", { input_tokens: 1000, output_tokens: 0, input_tokens_details: { cache_creation_tokens: 1000 } })).toBeCloseTo(.00025);
});
it("does not invent a price for missing usage, an unknown model/tier or impossible token counts", () => {
  expect(estimateAiCost("unknown", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  expect(estimateAiCost("gpt-6-astra", { total_tokens: 10 })).toBeNull();
  expect(estimateAiCost("gpt-6-astra", { input_tokens: 1, output_tokens: 1 }, "unknown")).toBeNull();
  expect(estimateAiCost("gpt-6-astra", { input_tokens: 1, output_tokens: 1 }, "priority")).toBeNull();
  expect(estimateAiCost("gpt-6-astra", { input_tokens: 300000, output_tokens: 1 })).toBeNull();
  expect(estimateAiCost("gpt-4o-2024-05-13", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  expect(estimateAiCost("gpt-4o", { input_tokens: 1, output_tokens: 1, input_tokens_details: { cache_write_tokens: 1 } })).toBeNull();
  expect(estimateAiCost("gpt-6-astra", { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 2 } })).toBeNull();
});
