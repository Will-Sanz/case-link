import { describe, expect, it } from "vitest";
import { buildSafeErrorPayload } from "@/lib/logger/safe-error-payload";

describe("buildSafeErrorPayload", () => {
  it("omits error text and stack from production events", () => {
    const payload = buildSafeErrorPayload(
      "paperwork mapping",
      new Error("student@example.test should never enter a production log"),
      { includeDetails: false, correlationId: "request-1" },
    );

    expect(payload.scope).toBe("paperwork_mapping");
    expect(payload.correlationId).toBe("request-1");
    expect(JSON.stringify(payload)).not.toContain("student@example.test");
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it("keeps diagnostic details in explicit development mode", () => {
    const payload = buildSafeErrorPayload("test", new Error("development detail"), {
      includeDetails: true,
    });
    expect(payload).toMatchObject({ message: "development detail" });
  });
});
