import "server-only";
import { canonicalProjectOrigin } from "./project-origin";
import {
  parentConfigurationIssues,
  ParentConfigurationError,
  type ParentEnvironment,
} from "./configuration";
export {
  parentConfigurationIssues,
  ParentConfigurationError,
} from "./configuration";

export function getParentConfig(env: ParentEnvironment = process.env) {
  const issues = parentConfigurationIssues(env);
  if (issues.length) throw new ParentConfigurationError(issues.join("; "));
  return {
    supabaseUrl: canonicalProjectOrigin(env.NEXT_PUBLIC_SUPABASE_URL)!,
    supabaseKey: (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  };
}
export function isParentConfigured(): boolean {
  return parentConfigurationIssues(process.env).length === 0;
}
