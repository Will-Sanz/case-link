import type {
  FamilyMatchInput,
  MatchableResource,
  RankedMatch,
} from "@/lib/matching/types";

type RuleHit = { points: number; reason: string };

/** Map preset keys + shared themes to category substrings (case-insensitive). */
const PRESET_CATEGORY_HINTS: Record<string, string[]> = {
  housing_stability: ["housing", "home", "rent", "tenant", "shelter", "repair", "phdc"],
  eviction_risk: ["housing", "legal", "tenant", "eviction", "landlord", "clsphila"],
  housing_instability: ["housing", "homeless", "youth", "shelter", "family"],
  employment: ["workforce", "employment", "job", "career", "paan", "training"],
  unemployment: ["workforce", "employment", "job", "training", "skill"],
  legal_assistance: ["legal", "law", "tenant", "eviction", "advocacy"],
  legal_matter: ["legal", "law", "court", "tenant"],
  utility_support: ["water", "electric", "utility", "energy", "peco", "cap", "tap"],
  utility_debt: ["water", "electric", "utility", "bill", "assistance", "uesf"],
  food_support: ["food", "meal", "nutrition", "hunger", "grocery"],
  food_insecurity: ["food", "meal", "nutrition", "grocery"],
  transportation: ["transport", "septa", "route", "safe route", "mobility"],
  no_transportation: ["transport", "septa", "route", "mobility"],
  immigration_documentation: ["immigration", "documentation", "citizen", "legal"],
  credit_improvement: ["credit", "financial", "homebuyer", "mortgage"],
  bad_credit: ["credit", "housing", "financial", "home"],
  digital_literacy: ["digital", "literacy", "technology", "computer", "tech"],
  low_digital_literacy: ["digital", "literacy", "technology", "computer"],
  childcare: ["childcare", "child", "early", "daycare"],
  childcare_barrier: ["childcare", "child", "family"],
  youth_programming: ["youth", "student", "school", "teen", "after school"],
  education_workforce_training: ["education", "workforce", "training", "school", "ged"],
  healthcare_access: ["health", "medical", "behavioral", "dbhids", "wellness"],
  health_barrier: ["health", "medical", "behavioral", "disability", "dbhids"],
};

/** Haystack keywords when preset fires (program/description/search). */
const PRESET_TEXT_KEYWORDS: Record<string, string[]> = {
  housing_stability: ["housing", "home repair", "rent", "tenant", "stabilization"],
  eviction_risk: ["eviction", "tenant", "legal aid", "housing court"],
  employment: ["job", "employment", "workforce", "training", "hire"],
  legal_assistance: ["legal", "representation", "law"],
  utility_support: ["utility", "water bill", "electric", "assistance program"],
  food_support: ["food", "meal", "pantry", "nutrition"],
  youth_programming: ["youth", "student", "after school", "teen"],
  immigration_documentation: ["immigration", "documentation", "citizenship"],
  digital_literacy: ["digital", "computer", "literacy", "technology"],
};

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function buildHaystack(r: MatchableResource): string {
  const parts = [
    r.program_name,
    r.office_or_department,
    r.description ?? "",
    r.category ?? "",
    r.search_text ?? "",
    ...(r.tags ?? []),
  ];
  return norm(parts.join(" "));
}

function collectPresetKeys(input: FamilyMatchInput): Set<string> {
  const keys = new Set<string>();
  for (const g of input.goals) {
    if (g.preset_key) keys.add(g.preset_key);
  }
  for (const b of input.barriers) {
    if (b.preset_key) keys.add(b.preset_key);
  }
  return keys;
}

function familyTextBlob(input: FamilyMatchInput): string {
  const labels = [
    ...input.goals.map((g) => g.label),
    ...input.barriers.map((b) => b.label),
    input.summary ?? "",
    input.household_notes ?? "",
  ];
  return norm(labels.join(" "));
}

function scoreResource(
  r: MatchableResource,
  presetKeys: Set<string>,
  familyBlob: string,
): RuleHit[] {
  const hits: RuleHit[] = [];
  const hay = buildHaystack(r);
  const cat = (r.category ?? "").toLowerCase();

  for (const key of presetKeys) {
    const catHints = PRESET_CATEGORY_HINTS[key];
    if (catHints) {
      for (const hint of catHints) {
        if (cat.includes(hint)) {
          hits.push({
            points: 18,
            reason: `Category matches ${key.replace(/_/g, " ")} need`,
          });
          break;
        }
      }
    }

    const textKw = PRESET_TEXT_KEYWORDS[key];
    if (textKw) {
      for (const kw of textKw) {
        if (hay.includes(kw)) {
          hits.push({
            points: 10,
            reason: `Program or services relate to ${key.replace(/_/g, " ")}`,
          });
          break;
        }
      }
    }
  }

  // Free-text: family narrative overlaps resource haystack (lightweight keyword overlap).
  const familyTokens = familyBlob
    .split(/\W+/)
    .filter((t) => t.length > 3)
    .slice(0, 40);
  let overlap = 0;
  for (const t of familyTokens) {
    if (hay.includes(t)) overlap++;
  }
  if (overlap >= 3) {
    hits.push({
      points: Math.min(12, 4 + overlap * 2),
      reason: "Keywords from family circumstances appear in this resource",
    });
  }

  // Service flags
  if (
    (presetKeys.has("food_support") || presetKeys.has("food_insecurity")) &&
    r.recruit_for_grocery_giveaways
  ) {
    hits.push({
      points: 8,
      reason: "Recruits for grocery giveaways (food support)",
    });
  }

  if (
    presetKeys.has("youth_programming") ||
    presetKeys.has("childcare") ||
    presetKeys.has("childcare_barrier")
  ) {
    if (cat.includes("youth")) {
      hits.push({ points: 14, reason: "Youth-focused category" });
    }
  }

  if (presetKeys.has("employment") || presetKeys.has("unemployment")) {
    if (hay.includes("workforce") || hay.includes("job readiness")) {
      hits.push({ points: 12, reason: "Workforce / job readiness services" });
    }
  }

  if (
    presetKeys.has("utility_support") ||
    presetKeys.has("utility_debt")
  ) {
    if (
      hay.includes("water") ||
      hay.includes("electric") ||
      hay.includes("utility")
    ) {
      hits.push({ points: 12, reason: "Utility or energy assistance" });
    }
  }

  if (presetKeys.has("eviction_risk") || presetKeys.has("legal_matter")) {
    if (hay.includes("legal") && (hay.includes("tenant") || hay.includes("eviction"))) {
      hits.push({ points: 16, reason: "Legal support relevant to housing risk" });
    }
  }

  return hits;
}

function mergeHits(hits: RuleHit[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();
  let score = 0;
  for (const h of hits) {
    score += h.points;
    if (!seen.has(h.reason)) {
      seen.add(h.reason);
      reasons.push(h.reason);
    }
  }
  return { score, reasons };
}

const MAX_REASON_LEN = 900;
const DEFAULT_MAX_RESULTS = 35;
const MIN_SCORE = 6;

/**
 * Deterministic, ranked matches for a family. No network / no AI.
 */
export function rankResourcesForFamily(
  input: FamilyMatchInput,
  resources: MatchableResource[],
  options?: { maxResults?: number; minScore?: number },
): RankedMatch[] {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = options?.minScore ?? MIN_SCORE;
  const presetKeys = collectPresetKeys(input);
  const familyBlob = familyTextBlob(input);

  const ranked: RankedMatch[] = [];

  for (const r of resources) {
    const hits = scoreResource(r, presetKeys, familyBlob);
    const { score, reasons } = mergeHits(hits);
    if (score < minScore) continue;

    let matchReason = reasons.join("; ");
    if (matchReason.length > MAX_REASON_LEN) {
      matchReason = `${matchReason.slice(0, MAX_REASON_LEN - 3)}…`;
    }

    ranked.push({
      resourceId: r.id,
      score,
      matchReason,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.resourceId.localeCompare(b.resourceId);
  });

  return ranked.slice(0, maxResults);
}
