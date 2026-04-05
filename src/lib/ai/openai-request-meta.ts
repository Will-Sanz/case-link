/**
 * Passed into OpenAI calls from authenticated server actions for rate limiting and usage logs.
 * Never include PII beyond the stable auth user id.
 */
export type OpenAiRequestMeta = {
  userId: string;
  /** Short route label, e.g. "generatePlan", "caseAssistant". */
  route: string;
};
