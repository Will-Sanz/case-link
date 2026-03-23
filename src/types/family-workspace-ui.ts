/**
 * Serializable workspace UI config built on the server.
 * Keeps prompt strings, activity taxonomies, and helper menus out of client modules.
 */
export type PlanStepUiConfig = {
  outreachResults: readonly string[];
  activityLogTypes: readonly { value: string; label: string }[];
  stepHelperMenu: readonly { type: string; label: string }[];
};

export type FamilyWorkspaceUiConfig = {
  caseAssistantQuickPrompts: readonly string[];
  planStep: PlanStepUiConfig;
};
