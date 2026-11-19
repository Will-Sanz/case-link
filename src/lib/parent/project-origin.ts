export const isLoopbackHost = (hostname: string): boolean =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

/** Compare origins, not spelling; reject credentials and URL components that SDKs may reinterpret. */
export function canonicalProjectOrigin(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && isLoopbackHost(url.hostname)))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parentProjectIsolationIssues(input: {
  projectUrl?: string;
  schoolUrl?: string;
  parentProductionUrl?: string;
  environment?: string;
  accountMode?: string;
}): string[] {
  const issues: string[] = [];
  const project = canonicalProjectOrigin(input.projectUrl),
    school = canonicalProjectOrigin(input.schoolUrl),
    production = canonicalProjectOrigin(input.parentProductionUrl);
  if (!project)
    return [
      "A valid parent Supabase origin without credentials, path, query or fragment is required",
    ];
  const url = new URL(project);
  const existing = input.accountMode === "existing";
  if (
    input.environment === "connected" &&
    (!existing ||
      !project.startsWith("https://") ||
      !school ||
      !production ||
      project !== school ||
      project !== production)
  )
    issues.push(
      "Connected parent access requires the exact approved existing production project",
    );
  if (
    input.accountMode &&
    !["existing", "isolated"].includes(input.accountMode)
  )
    issues.push("Parent account mode must be existing or isolated");
  if (
    existing &&
    (!school || project !== school) &&
    !["preview", "test"].includes(input.environment ?? "")
  )
    issues.push(
      "Existing-account mode must use the approved existing CaseLink project",
    );
  if (!existing && school && project === school)
    issues.push(
      "Parent support must use a project separate from the school environment",
    );
  if (isLoopbackHost(url.hostname)) {
    if (
      url.port !== "55321" &&
      !(existing && project === school && url.port === "54321")
    )
      issues.push(
        "Local parent support must use the isolated parent API on port 55321",
      );
    return issues;
  }
  if (!school || !production)
    issues.push(
      "Remote parent environments must identify the existing CaseLink and approved production origins",
    );
  if (input.environment === "production" && project !== production)
    issues.push("Production must use the approved parent project");
  if (
    ["preview", "test"].includes(input.environment ?? "") &&
    project === production
  )
    issues.push(
      "Preview and test must use a separate synthetic parent project",
    );
  return issues;
}
