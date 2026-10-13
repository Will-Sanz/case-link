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
  if (error instanceof PasswordSetupRequiredError || error instanceof MfaRequiredError) return error.message;
  return error instanceof AuthenticationRequiredError
    ? "Sign in to continue."
    : "CaseLink could not verify your session. Try again.";
}

export class MfaRequiredError extends Error {
  constructor() {
    super("Verify your authenticator code to continue. Open account verification and try again.");
    this.name = "MfaRequiredError";
  }
}

export class PasswordSetupRequiredError extends Error {
  constructor() {
    super("Finish setting your password, then sign in with it to open the workspace.");
    this.name = "PasswordSetupRequiredError";
  }
}
