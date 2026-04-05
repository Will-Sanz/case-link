/**
 * Passed into OpenAI calls from authenticated server actions for rate limiting and usage logs.
 * Never include PII beyond the stable auth user id.
 */
export type OpenAiRequestMeta = {
  userId: string;
  /** Short route label, e.g. "generatePlan", "caseAssistant". */
  route: string;
  /** Optional; used with OPENAI_RATE_LIMIT_PER_IP_MAX as a secondary abuse control. */
  clientIp?: string | null;
};
