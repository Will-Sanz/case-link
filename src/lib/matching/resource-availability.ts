export function isDemoResource(programName: string, office: string): boolean {
  return /\(\s*Demo\s*\)/i.test(`${programName} ${office}`);
}

export function isResourceAvailable(resource: { active: boolean; is_demo: boolean } | null): boolean {
  return resource?.active === true && resource.is_demo === false;
}
