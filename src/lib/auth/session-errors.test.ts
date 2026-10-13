import { describe, expect, it } from "vitest";
import {
  AuthenticationRequiredError,
  publicSessionError,
  SessionUnavailableError,
  PasswordSetupRequiredError,
  MfaRequiredError,
} from "@/lib/auth/session-errors";

describe("publicSessionError", () => {
  it("distinguishes missing authentication from dependency failures", () => {
    expect(publicSessionError(new PasswordSetupRequiredError())).toContain("Finish setting your password");
    expect(publicSessionError(new MfaRequiredError())).toContain("authenticator code");
    expect(publicSessionError(new AuthenticationRequiredError())).toBe("Sign in to continue.");
    expect(publicSessionError(new SessionUnavailableError())).toContain("could not verify");
    expect(publicSessionError(new Error("database detail"))).not.toContain("database detail");
  });
});
