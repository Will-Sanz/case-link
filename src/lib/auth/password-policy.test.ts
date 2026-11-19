import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { passwordMeetsPolicy } from "./password-policy";
it.each(["short1!A", "onlylowercase1!", "ONLYUPPERCASE1!", "NoNumbersHere!", "NoSymbolsHere12", "WhitespaceOnly12 "])("rejects passwords missing the configured requirements: %s", (password) => {
  expect(passwordMeetsPolicy(password)).toBe(false);
});
it("accepts a qualifying password and matches the checked-in Auth configuration", () => {
  expect(passwordMeetsPolicy("Synthetic passphrase1!")).toBe(true);
  const config = readFileSync("supabase/config.toml", "utf8");
  expect(config).toContain("minimum_password_length = 14");
  expect(config).toContain('password_requirements = "lower_upper_letters_digits_symbols"');
});
