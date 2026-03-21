import type { StepTemplate } from "./types";

/** Maps preset keys to suggested plan step templates. Each key can yield multiple steps across phases. */
const PRESET_STEPS: Record<string, StepTemplate[]> = {
  housing_stability: [
    {
      phase: "30",
      title: "Assess housing stability needs",
      description: "Review current housing situation, lease status, and any immediate concerns.",
    },
    {
      phase: "60",
      title: "Connect with housing stabilization resources",
      description: "Identify and reach out to programs that support rent assistance, repairs, or tenant rights.",
    },
    {
      phase: "90",
      title: "Evaluate housing stability progress",
      description: "Check in on housing goals and adjust plan as needed.",
    },
  ],
  eviction_risk: [
    {
      phase: "30",
      title: "Assess eviction timeline and legal options",
      description: "Document notice dates, court dates if any, and connect with tenant legal services.",
    },
    {
      phase: "60",
      title: "Pursue legal representation or mediation",
      description: "Follow up with legal aid or landlord-tenant mediation programs.",
    },
  ],
  housing_instability: [
    {
      phase: "30",
      title: "Assess housing situation and options",
      description: "Understand current living arrangement and explore emergency shelter or transitional housing if needed.",
    },
    {
      phase: "60",
      title: "Connect with housing navigation or rapid rehousing",
      description: "Engage programs that help families secure stable housing.",
    },
  ],
  employment: [
    {
      phase: "30",
      title: "Identify job readiness and skills",
      description: "Assess employment history, skills, and barriers to work.",
    },
    {
      phase: "60",
      title: "Connect with workforce or job training programs",
      description: "Apply to employment programs that match the family's goals.",
    },
    {
      phase: "90",
      title: "Support job search and placement",
      description: "Assist with applications, interviews, and follow-up.",
    },
  ],
  unemployment: [
    {
      phase: "30",
      title: "Assess employment barriers",
      description: "Identify obstacles (transportation, childcare, skills) and supports needed.",
    },
    {
      phase: "60",
      title: "Connect with workforce development programs",
      description: "Link to job training, resume support, or job placement services.",
    },
  ],
  legal_assistance: [
    {
      phase: "30",
      title: "Identify legal needs and urgency",
      description: "Document the type of legal matter and any deadlines.",
    },
    {
      phase: "60",
      title: "Connect with legal aid or pro bono services",
      description: "Refer to appropriate legal services for the family's situation.",
    },
  ],
  legal_matter: [
    {
      phase: "30",
      title: "Assess active legal matter",
      description: "Document case status, court dates, and representation needs.",
    },
    {
      phase: "60",
      title: "Support connection to legal resources",
      description: "Help family access legal aid or appropriate referrals.",
    },
  ],
  utility_support: [
    {
      phase: "30",
      title: "Assess utility arrears and shutoff risk",
      description: "Identify outstanding bills, LIHEAP or other assistance eligibility.",
    },
    {
      phase: "60",
      title: "Connect with utility assistance programs",
      description: "Apply to CAP, TAP, UESF, or similar programs as applicable.",
    },
  ],
  utility_debt: [
    {
      phase: "30",
      title: "Document utility debt and risk level",
      description: "Gather bills, shutoff notices, and determine urgency.",
    },
    {
      phase: "60",
      title: "Apply for utility assistance",
      description: "Connect with programs that help with water, electric, or gas arrears.",
    },
  ],
  food_support: [
    {
      phase: "30",
      title: "Assess food security and SNAP eligibility",
      description: "Check current food access and potential benefits enrollment.",
    },
    {
      phase: "60",
      title: "Connect with food pantries and nutrition programs",
      description: "Link to local food resources and grocery programs.",
    },
  ],
  food_insecurity: [
    {
      phase: "30",
      title: "Assess food access needs",
      description: "Understand current food situation and barriers.",
    },
    {
      phase: "60",
      title: "Connect to food resources",
      description: "Refer to pantries, SNAP, WIC, or school meal programs as appropriate.",
    },
  ],
  transportation: [
    {
      phase: "30",
      title: "Assess transportation needs",
      description: "Identify how family gets to work, appointments, and essential trips.",
    },
    {
      phase: "60",
      title: "Connect with transit or mobility programs",
      description: "Explore SEPTA programs, subsidized transit, or rideshare options.",
    },
  ],
  no_transportation: [
    {
      phase: "30",
      title: "Identify transportation barriers",
      description: "Document where family needs to go and what's preventing access.",
    },
    {
      phase: "60",
      title: "Connect with transit assistance or ride programs",
      description: "Link to programs that provide transit passes or transportation support.",
    },
  ],
  immigration_documentation: [
    {
      phase: "30",
      title: "Assess immigration documentation status",
      description: "Understand what documents are needed and any deadlines.",
    },
    {
      phase: "60",
      title: "Connect with immigration legal services",
      description: "Refer to reputable immigration attorneys or accredited representatives.",
    },
  ],
  credit_improvement: [
    {
      phase: "30",
      title: "Assess credit situation and goals",
      description: "Understand current credit and what the family hopes to achieve.",
    },
    {
      phase: "60",
      title: "Connect with financial counseling or credit-building programs",
      description: "Refer to programs that help with credit repair and financial literacy.",
    },
  ],
  bad_credit: [
    {
      phase: "30",
      title: "Assess credit barriers",
      description: "Understand how credit is affecting housing, employment, or other goals.",
    },
    {
      phase: "60",
      title: "Connect with credit counseling",
      description: "Link to services that help address credit issues.",
    },
  ],
  digital_literacy: [
    {
      phase: "30",
      title: "Assess digital access and skills",
      description: "Identify device access, internet, and comfort with technology.",
    },
    {
      phase: "60",
      title: "Connect with digital literacy programs",
      description: "Refer to programs that teach basic computer and online skills.",
    },
  ],
  low_digital_literacy: [
    {
      phase: "30",
      title: "Identify digital barriers",
      description: "Understand how limited digital access affects the family.",
    },
    {
      phase: "60",
      title: "Connect with tech support or training",
      description: "Link to programs that provide devices, internet, or training.",
    },
  ],
  childcare: [
    {
      phase: "30",
      title: "Assess childcare needs and preferences",
      description: "Document ages of children, schedule needs, and any special requirements.",
    },
    {
      phase: "60",
      title: "Connect with childcare resources",
      description: "Explore Pre-K, subsidized care, or after-school programs.",
    },
  ],
  childcare_barrier: [
    {
      phase: "30",
      title: "Identify childcare barriers",
      description: "Understand what's preventing access to reliable childcare.",
    },
    {
      phase: "60",
      title: "Connect with childcare assistance programs",
      description: "Refer to subsidies, Head Start, or other early childhood programs.",
    },
  ],
  youth_programming: [
    {
      phase: "30",
      title: "Assess youth program interests",
      description: "Identify ages, interests, and what types of programs would help.",
    },
    {
      phase: "60",
      title: "Connect youth with after-school or enrichment programs",
      description: "Link to programs that support academic and social development.",
    },
  ],
  education_workforce_training: [
    {
      phase: "30",
      title: "Assess education and training goals",
      description: "Identify GED, ESL, or workforce training interests.",
    },
    {
      phase: "60",
      title: "Connect with education or training programs",
      description: "Refer to adult education, GED prep, or vocational programs.",
    },
    {
      phase: "90",
      title: "Support enrollment and follow-up",
      description: "Assist with applications and check in on progress.",
    },
  ],
  healthcare_access: [
    {
      phase: "30",
      title: "Assess healthcare access and needs",
      description: "Identify primary care, insurance status, and any urgent health concerns.",
    },
    {
      phase: "60",
      title: "Connect with healthcare enrollment or navigation",
      description: "Link to Medicaid, CHIP, or community health resources.",
    },
  ],
  health_barrier: [
    {
      phase: "30",
      title: "Assess health and disability barriers",
      description: "Understand how health or disability affects daily life and goals.",
    },
    {
      phase: "60",
      title: "Connect with health and disability supports",
      description: "Refer to appropriate medical, behavioral, or disability services.",
    },
  ],
};

/** Default steps added when no preset-driven steps exist (e.g. goals are custom only). */
const DEFAULT_STEPS: StepTemplate[] = [
  { phase: "30", title: "Review goals and identify immediate priorities", description: "Discuss what matters most right now and what supports would help." },
  { phase: "60", title: "Connect with relevant resources", description: "Based on priorities, identify and reach out to programs that can help." },
  { phase: "90", title: "Check in on progress and adjust plan", description: "Review progress and update the plan as needed." },
];

export function getStepTemplatesForPreset(presetKey: string | null): StepTemplate[] {
  if (!presetKey) return [];
  return PRESET_STEPS[presetKey] ?? [];
}

export function getDefaultSteps(): StepTemplate[] {
  return DEFAULT_STEPS;
}
