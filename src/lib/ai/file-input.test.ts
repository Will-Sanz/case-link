import { describe, expect, it } from "vitest";
import { pdfBase64DataUrl } from "@/lib/ai/file-input";

describe("pdfBase64DataUrl", () => {
  it("formats raw PDF bytes for an OpenAI file input", () => {
    expect(pdfBase64DataUrl("JVBERi0xLjQ=")).toBe(
      "data:application/pdf;base64,JVBERi0xLjQ=",
    );
  });
});
