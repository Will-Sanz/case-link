import { describe, expect, it, afterEach } from "vitest";
import {
  safeAuthSessionClientMessage,
  safeOAuthRedirectMessage,
  safeSignInPasswordMessage,
  safeSignUpMessage,
} from "@/lib/auth/safe-client-auth-message";

describe("safe-client-auth-message", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalEnv = process.env.NODE_ENV;

  function setNodeEnv(value: string | undefined) {
    env.NODE_ENV = value;
  }

  afterEach(() => {
    setNodeEnv(originalEnv);
  });

  it("preserves raw oauth messages outside production", () => {
    setNodeEnv("development");

    expect(safeOAuthRedirectMessage("Provider said no")).toBe("Provider said no");
    expect(safeAuthSessionClientMessage("Token exchange failed")).toBe("Token exchange failed");
  });

  it("hides sensitive oauth details in production", () => {
    setNodeEnv("production");

    expect(safeOAuthRedirectMessage("SQL exception while exchanging JWT token")).toBe(
      "Sign-in could not be completed. Try again or request a new link.",
    );
  });

  it("falls back for long or infrastructure sign-in errors in production", () => {
    setNodeEnv("production");

    expect(safeSignInPasswordMessage("fetch failed while reaching auth server")).toBe(
      "Could not sign in. Check your email and password and try again.",
    );
    expect(safeSignInPasswordMessage("x".repeat(281))).toBe(
      "Could not sign in. Check your email and password and try again.",
    );
  });

  it("preserves user-facing sign-up messages in production", () => {
    setNodeEnv("production");

    expect(safeSignUpMessage("A user with this email already exists")).toBe(
      "A user with this email already exists",
    );
  });
});
