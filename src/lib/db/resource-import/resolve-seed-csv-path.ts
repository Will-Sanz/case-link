import fs from "node:fs";
import path from "node:path";

/** Local-only full directory export; never commit. */
export const RESOURCE_SEED_PRIVATE_BASENAME = "resources-seed.private.csv";

/** Small synthetic rows safe to commit; used when private file is absent. */
export const RESOURCE_SEED_SAMPLE_BASENAME = "resources-seed.sample.csv";

export type ResourceSeedSource = "private" | "sample";

/**
 * Default CSV for `scripts/import-resources.ts`: prefers `data/resources-seed.private.csv`
 * when present, otherwise `data/resources-seed.sample.csv`.
 */
export function resolveDefaultResourceSeedCsvPath(repoRoot: string): {
  absolutePath: string;
  source: ResourceSeedSource;
} {
  const dataDir = path.join(repoRoot, "data");
  const privatePath = path.join(dataDir, RESOURCE_SEED_PRIVATE_BASENAME);
  if (fs.existsSync(privatePath)) {
    return { absolutePath: privatePath, source: "private" };
  }
  const samplePath = path.join(dataDir, RESOURCE_SEED_SAMPLE_BASENAME);
  return { absolutePath: samplePath, source: "sample" };
}
