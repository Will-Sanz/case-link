import { describe, expect, it } from "vitest";
import { explicitParentLocale, parentLocale, parentRecoveryHref, parentText } from "./locale";

describe("parent interface locale without service facts", () => {
  it.each([undefined, null, "fr", "ES", "es; Path=/", ["en", "es"], {}])("rejects an unsupported locale %#", value => {
    expect(explicitParentLocale(value)).toBeUndefined();
    expect(parentLocale(value)).toBe("en");
  });
  it("uses fixed reviewed copy and keeps English as the unchanged default", () => {
    expect(parentText("en", "Sign in")).toBe("Sign in");
    expect(parentText("es", "Sign in")).toBe("Iniciar sesión");
    expect(parentText("es", "Terms of service")).toBe("Términos del servicio");
  });
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "Original recorded evidence"])("preserves unknown recorded text as text: %s", value => {
    expect(parentText("es", value)).toBe(value);
    expect(typeof parentText("es", value)).toBe("string");
  });
  it("carries only an interface enum without changing the original recovery origin or callback destination", () => {
    const href = parentRecoveryHref("https://original.example.invalid/forgot-password", "es");
    expect(href).toBe("https://original.example.invalid/forgot-password?ui=es");
    const next = parentRecoveryHref("/reset-password?mode=recovery", "es");
    expect(next).toBe("/reset-password?mode=recovery&ui=es");
  });
});
