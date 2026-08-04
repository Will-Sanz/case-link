export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

export class SessionUnavailableError extends Error {
  constructor() {
    super("Session service unavailable");
    this.name = "SessionUnavailableError";
  }
}

export function publicSessionError(error: unknown): string {
  return error instanceof AuthenticationRequiredError
    ? "Sign in to continue."
    : "CaseLink could not verify your session. Try again.";
}
