import { describe, expect, it, vi } from "vitest";
import { testAiSchemaContracts } from "./test-ai-schema-contracts";

describe("synthetic live-contract runner", () => {
  it("checks every supported model/schema without provider storage and emits metadata only", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      expect(body.store).toBe(false);
      expect(body.text.format.strict).toBe(true);
      return Response.json({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: body.input }] }], usage: { total_tokens: 100 } });
    });
    const result = await testAiSchemaContracts("synthetic", request);
    expect(result).toHaveLength(8);
    expect(request).toHaveBeenCalledTimes(8);
    expect(result.every(item => item.passed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Prepare documents");
  });
  it.each(["http", "incomplete", "refusal", "invalid", "changed"])("fails without reporting success for %s", async kind => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      if (kind === "http") return new Response("private detail", { status: 400 });
      const body = JSON.parse(options!.body as string);
      const example = JSON.parse(body.input);
      if (kind === "changed") example.steps[0].title = "Different work";
      return Response.json({ status: kind === "incomplete" ? "incomplete" : "completed", output: [{ type: "message", status: "completed", content: [{ type: kind === "refusal" ? "refusal" : "output_text", text: kind === "invalid" ? "{}" : JSON.stringify(example) }] }] });
    });
    await expect(testAiSchemaContracts("synthetic", request)).rejects.toThrow(/^gpt-/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
