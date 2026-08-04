import { describe, expect, it } from "vitest";
import {
  parseInviteSiteOrigin,
  parseProvisioningRole,
  validateTestProvisioning,
} from "./provisioning-safety";

describe("test-user provisioning safety", () => {
  it("accepts explicit local credentials without exposing them", () => {
    expect(
      validateTestProvisioning({
        environment: "local",
        url: "http://127.0.0.1:54321",
        email: "case-manager@example.test",
        password: "Long-Test-Secret-42",
      }),
    ).toEqual([]);
  });

  it("refuses production, remote local targets, and weak credentials", () => {
    expect(
      validateTestProvisioning({
        environment: "production",
        url: "https://prod.supabase.co",
        email: "",
        password: "test",
      }),
    ).toHaveLength(3);
  });

  it("defaults invitations to least privilege and rejects unknown roles", () => {
    expect(parseProvisioningRole(undefined)).toBe("case_manager");
    expect(parseProvisioningRole("admin")).toBe("admin");
    expect(() => parseProvisioningRole("owner")).toThrow("case_manager or admin");
  });

  it("requires invitation links to use an exact trusted origin", () => {
    expect(parseInviteSiteOrigin("https://app.example.edu")).toBe("https://app.example.edu");
    expect(parseInviteSiteOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(() => parseInviteSiteOrigin("https://app.example.edu/path")).toThrow("exact HTTPS origin");
    expect(() => parseInviteSiteOrigin("http://app.example.edu")).toThrow("exact HTTPS origin");
  });
});
