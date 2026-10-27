import type { SupportNeed } from "./domain";

export type SupportProgram = {
  id: string;
  name: string;
  needs: SupportNeed[];
  description: string;
  officialUrl: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  personalSteps: string[];
  execution: "not_configured" | "permitted";
};
// This public entry initializes guest intake; a deep application URL can fail without that session.
export const SNAP_NEW_APPLICATION_URL =
  "https://www.compass.dhs.pa.gov/intake/#/getstarted";
const checked = "2026-10-25";
const program = (
  value: Omit<SupportProgram, "sourceCheckedAt" | "execution" | "sourceUrl">,
): SupportProgram => ({
  ...value,
  sourceUrl: value.officialUrl,
  sourceCheckedAt: checked,
  execution: "not_configured",
});

// Public source review establishes program information, never delegated execution permission.
export const PROGRAMS: SupportProgram[] = [
  program({
    id: "philly-food",
    name: "Philadelphia food and meal finder",
    needs: ["food_now"],
    description:
      "Find city-listed food and meal locations. Confirm hours, pickup requirements and availability before traveling.",
    officialUrl: "https://www.phila.gov/food/",
    personalSteps: ["Confirm a practical pickup or delivery arrangement."],
  }),
  program({
    id: "snap-pa",
    name: "Pennsylvania SNAP",
    needs: ["snap_new", "snap_renewal", "snap_pending", "snap_problem"],
    description:
      "Apply, renew or follow an existing SNAP application through Pennsylvania's official benefits service. A new application can begin without creating a COMPASS account. DHS determines eligibility.",
    officialUrl:
      "https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap",
    personalSteps: [
      "Complete any required provider verification, personal declaration or interview.",
      "Enter sensitive identifiers directly with DHS if required; do not share them in CaseLink chat.",
    ],
  }),
  program({
    id: "wic-pa",
    name: "Pennsylvania WIC",
    needs: ["wic_new", "wic_continuing"],
    description:
      "Coordinate WIC enrollment, continuing support, documents and a specialist appointment.",
    officialUrl:
      "https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist",
    personalSteps: [
      "A WIC specialist completes the program's required assessment.",
    ],
  }),
  program({
    id: "uesf-benefits",
    name: "UESF benefits assistance",
    needs: [
      "snap_new",
      "snap_renewal",
      "snap_pending",
      "snap_problem",
      "wic_new",
      "wic_continuing",
    ],
    description:
      "Partner benefits navigation and help with a supported application or benefit problem.",
    officialUrl: "https://uesfacts.org/i-need-help-with/benefits/",
    personalSteps: [
      "Provide route-required declarations or documents when requested.",
    ],
  }),
  program({
    id: "uesf-utilities",
    name: "UESF utility assistance",
    needs: ["electricity", "water"],
    description:
      "Philadelphia utility grant assistance. Funding, account requirements and any required contribution must be confirmed by the program.",
    officialUrl: "https://uesfacts.org/our-programs/utility-grant-program/",
    personalSteps: [
      "A required household contribution or financial commitment needs your decision.",
    ],
  }),
  program({
    id: "peco-cap",
    name: "PECO assistance programs",
    needs: ["electricity"],
    description:
      "Explore PECO affordability and assistance options for an electric bill or threatened interruption.",
    officialUrl:
      "https://www.peco.com/my-account/customer-support/assistance-programs",
    personalSteps: [
      "Authenticate directly with your provider if required.",
      "Personally accept any binding payment arrangement.",
    ],
  }),
  program({
    id: "pgw-crp",
    name: "PGW financial support",
    needs: ["gas"],
    description:
      "Explore PGW financial support, affordability and energy assistance options.",
    officialUrl:
      "https://www.pgworks.com/about-your-bill/financial-support-programs",
    personalSteps: [
      "Authenticate directly with PGW if required.",
      "Personally accept any binding payment arrangement.",
    ],
  }),
  program({
    id: "pwd-tap",
    name: "Philadelphia water assistance",
    needs: ["water"],
    description:
      "Use the City's water assistance application route. The City does not accept application documents by email.",
    officialUrl:
      "https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/",
    personalSteps: [
      "Complete any required account-holder declaration through an accepted City channel.",
    ],
  }),
];

export function getProgramsForNeeds(
  needs: readonly SupportNeed[],
): SupportProgram[] {
  return PROGRAMS.filter((p) => p.needs.some((n) => needs.includes(n)));
}
export function getProgram(id: string): SupportProgram | undefined {
  return PROGRAMS.find((p) => p.id === id);
}
export function programRoutingIssue(
  program: SupportProgram,
  zip: string | undefined,
  now: Date,
): string | null {
  // Missing routing evidence permits preparation, never confirms coverage for execution.
  if (zip !== undefined && !/^191\d{2}$/.test(zip))
    return "CaseLink currently coordinates support in Philadelphia. Use local official help while we expand coverage.";
  const checkedAt = Date.parse(program.sourceCheckedAt + "T00:00:00Z");
  if (!Number.isFinite(checkedAt) || now.getTime() - checkedAt > 30 * 86400000)
    return "This program's information needs a current source review before CaseLink can recommend the route.";
  return null;
}
export const URGENT_HELP = [
  {
    title: "Food today",
    description:
      "Find food and meal locations listed by Philadelphia. Check hours and access before traveling.",
    url: "https://www.phila.gov/food/",
  },
  {
    title: "A shutoff notice or no service",
    description:
      "Use your utility's official assistance channel now. A saved CaseLink request does not stop a shutoff.",
    url: "https://uesfacts.org/our-programs/utility-grant-program/",
  },
  {
    title: "Start an official SNAP application",
    description: "You can apply directly while other support work continues.",
    url: "https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap",
  },
];
