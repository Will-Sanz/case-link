import { describe, expect, it, afterEach } from "vitest";
import {
  safeSignInPasswordMessage,
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

  it("falls back for long or infrastructure sign-in errors in production", () => {
    setNodeEnv("production");

    expect(safeSignInPasswordMessage("fetch failed while reaching auth server")).toBe(
      "Could not sign in. Check your email and password and try again.",
    );
    expect(safeSignInPasswordMessage("x".repeat(281))).toBe(
      "Could not sign in. Check your email and password and try again.",
    );
    expect(safeSignInPasswordMessage("Email not confirmed")).toBe(
      "Confirm your invitation email before signing in.",
    );
    expect(safeSignInPasswordMessage("Too many requests")).toBe(
      "Too many sign-in attempts. Wait a few minutes and try again.",
    );
  });
});
