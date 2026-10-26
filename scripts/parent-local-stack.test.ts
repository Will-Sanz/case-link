import { expect, it } from "vitest";
import { safeLocalStackOutput } from "./parent-local-stack.mjs";

it("keeps service progress while suppressing structured and tabular local credentials", () => {
  const output = safeLocalStackOutput(
    'Starting local services\n{"API_URL":"http://127.0.0.1:55321","SERVICE_ROLE_KEY":"private-canary"}\nSecret key: private-second-canary\npostgresql://postgres:private-third-canary@127.0.0.1:55322/postgres\nReady',
  );
  expect(output).toBe("Starting local services\nReady");
  expect(output).not.toContain("private-");
});
it("also suppresses unlabeled bearer and modern secret keys", () => {
  expect(
    safeLocalStackOutput(
      "eyJhbGci.fakepayload.fakesignature\nsb_secret_private-canary\nApplying migration safe.sql",
    ),
  ).toBe("Applying migration safe.sql");
});
