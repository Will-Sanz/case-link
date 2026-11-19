export function aiBudgetMessage(budget: { reason?: string; retryAfter: number }): string {
  if (budget.reason === "disabled") return "AI assistance is temporarily turned off. Your saved work is available. Contact your CaseLink support person.";
  const seconds = Math.max(1, Math.ceil(budget.retryAfter));
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const wait = seconds < 60 ? `${seconds} seconds`
    : minutes < 60 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
    : `${hours} ${hours === 1 ? "hour" : "hours"}${minutes % 60 ? ` ${minutes % 60} ${minutes % 60 === 1 ? "minute" : "minutes"}` : ""}`;
  const reason = budget.reason === "control_unavailable" ? "AI usage limits could not be checked."
    : budget.reason === "deployment_day" ? "This workspace has reached its daily AI limit."
    : budget.reason === "user_hour" ? "You have reached your hourly AI limit."
    : "You have reached the limit for this AI task.";
  return `${reason} Try again in about ${wait}. Your saved work is unchanged.`;
}
