export const UserRole = {
  Admin: "admin",
  CaseManager: "case_manager",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
