import type { StepTemplate } from "./types";

/** Maps preset keys to suggested plan step templates. Each key can yield multiple steps across phases. */
const PRESET_STEPS: Record<string, StepTemplate[]> = {
  housing_stability: [
    {
      phase: "30",
      title: "Schedule housing intake and submit rent assistance application",
      description: "Call housing stabilization programs, confirm eligibility, and submit applications for rent assistance or repairs.",
    },
    {
      phase: "60",
      title: "Follow up on housing applications and attend appointments",
      description: "Submit missing documents, attend scheduled appointments, and document outcomes.",
    },
    {
      phase: "90",
      title: "Confirm ongoing housing support and renewal dates",
      description: "Check in on housing goals, note renewal deadlines, and adjust plan as needed.",
    },
  ],
  eviction_risk: [
    {
      phase: "30",
      title: "Call tenant legal aid and request earliest intake",
      description: "Contact legal aid, confirm eviction timeline and court dates, and schedule intake or hotline guidance.",
    },
    {
      phase: "60",
      title: "Attend legal appointments and submit required documents",
      description: "Follow up with legal aid or mediation, submit paperwork, and document outcomes.",
    },
  ],
  housing_instability: [
    {
      phase: "30",
      title: "Contact housing navigation and apply for emergency or transitional housing",
      description: "Call housing navigation programs, apply for shelter or rapid rehousing, and schedule intake appointments.",
    },
    {
      phase: "60",
      title: "Submit documents and attend housing appointments",
      description: "Complete applications, submit required documents, and attend scheduled housing appointments.",
    },
  ],
  employment: [
    {
      phase: "30",
      title: "Register with workforce office and schedule job readiness intake",
      description: "Apply to workforce programs, schedule intake, and document transportation or childcare barriers during registration.",
    },
    {
      phase: "60",
      title: "Complete job training applications and attend appointments",
      description: "Submit applications, attend training or placement appointments, and document outcomes.",
    },
    {
      phase: "90",
      title: "Support job search applications and interview follow-up",
      description: "Assist with applications, interviews, and follow-up.",
    },
  ],
  unemployment: [
    {
      phase: "30",
      title: "Register with workforce office and document barriers",
      description: "Apply to workforce programs, document transportation/childcare/skill barriers during registration, and schedule resume or placement support.",
    },
    {
      phase: "60",
      title: "Complete job training applications and attend intake",
      description: "Submit applications to job training or placement services and attend scheduled appointments.",
    },
  ],
  legal_assistance: [
    {
      phase: "30",
      title: "Call legal aid hotline and request earliest intake",
      description: "Contact legal aid, document deadlines and case type, and schedule intake or referral.",
    },
    {
      phase: "60",
      title: "Attend legal intake and submit required documents",
      description: "Complete intake with legal aid or pro bono services and submit any requested paperwork.",
    },
  ],
  legal_matter: [
    {
      phase: "30",
      title: "Call legal aid and schedule intake for active matter",
      description: "Contact legal aid, confirm court dates and representation needs, and book the earliest intake.",
    },
    {
      phase: "60",
      title: "Submit documents and attend legal appointments",
      description: "Help family complete intake, submit paperwork, and attend scheduled legal appointments.",
    },
  ],
  utility_support: [
    {
      phase: "30",
      title: "Apply to CAP/TAP/UESF and gather utility bills",
      description: "Call utility assistance programs, confirm eligibility, and submit application with bills and shutoff notices.",
    },
    {
      phase: "60",
      title: "Submit missing documents and confirm application status",
      description: "Follow up on applications, submit any requested documents, and confirm approval or next steps.",
    },
  ],
  utility_debt: [
    {
      phase: "30",
      title: "Gather bills and shutoff notices; apply for utility assistance",
      description: "Collect utility bills and shutoff notices, call assistance programs, and submit application.",
    },
    {
      phase: "60",
      title: "Submit documents and confirm application status",
      description: "Complete application requirements and follow up on approval.",
    },
  ],
  food_support: [
    {
      phase: "30",
      title: "Apply for SNAP and register with food pantry",
      description: "Submit SNAP application, call food pantries to confirm eligibility and intake, and schedule first pickup or delivery.",
    },
    {
      phase: "60",
      title: "Complete SNAP interview and attend pantry appointments",
      description: "Complete SNAP interview, attend pantry intake, and document ongoing food access.",
    },
  ],
  food_insecurity: [
    {
      phase: "30",
      title: "Apply for SNAP/WIC and contact food pantries",
      description: "Submit SNAP or WIC application, call pantries and school meal programs, and schedule intake.",
    },
    {
      phase: "60",
      title: "Complete benefit interviews and pantry intake",
      description: "Attend SNAP/WIC interviews and pantry appointments; document outcomes.",
    },
  ],
  transportation: [
    {
      phase: "30",
      title: "Apply for SEPTA transit program and schedule intake",
      description: "Call transit assistance programs, confirm eligibility, and submit application for passes or rideshare.",
    },
    {
      phase: "60",
      title: "Submit documents and confirm transit benefit",
      description: "Complete application requirements and secure transit support.",
    },
  ],
  no_transportation: [
    {
      phase: "30",
      title: "Apply for transit assistance and document trip needs",
      description: "Call transit programs, document work and appointment trips, and submit application.",
    },
    {
      phase: "60",
      title: "Complete intake and secure transit support",
      description: "Attend intake, submit documents, and confirm transit passes or ride options.",
    },
  ],
  immigration_documentation: [
    {
      phase: "30",
      title: "Call immigration legal services and schedule consultation",
      description: "Contact accredited representatives, document deadlines and needed documents, and book earliest consultation.",
    },
    {
      phase: "60",
      title: "Attend consultation and submit required documents",
      description: "Complete intake with immigration legal services and submit requested paperwork.",
    },
  ],
  credit_improvement: [
    {
      phase: "30",
      title: "Register with financial counseling and request credit report review",
      description: "Call credit counseling programs, schedule intake, and bring credit report for review.",
    },
    {
      phase: "60",
      title: "Attend counseling sessions and enroll in credit-building program",
      description: "Complete intake and follow recommended credit-building steps.",
    },
  ],
  bad_credit: [
    {
      phase: "30",
      title: "Schedule credit counseling intake and gather credit reports",
      description: "Call credit counseling, request free credit reports, and book intake to address housing/employment barriers.",
    },
    {
      phase: "60",
      title: "Attend counseling and start dispute or repair process",
      description: "Complete intake and begin credit repair steps as recommended.",
    },
  ],
  digital_literacy: [
    {
      phase: "30",
      title: "Enroll in digital literacy program and request device/internet assistance",
      description: "Call programs that provide devices, internet, or training; schedule intake and document needs.",
    },
    {
      phase: "60",
      title: "Attend training sessions and confirm access",
      description: "Complete enrollment and attend first sessions.",
    },
  ],
  low_digital_literacy: [
    {
      phase: "30",
      title: "Apply for device/internet assistance and schedule tech training",
      description: "Call programs for devices or internet, document barriers, and schedule training intake.",
    },
    {
      phase: "60",
      title: "Receive device and attend first training session",
      description: "Complete intake and attend training.",
    },
  ],
  childcare: [
    {
      phase: "30",
      title: "Call childcare assistance and book earliest intake",
      description: "Contact childcare assistance line, confirm eligibility by child ages and work schedule, and schedule intake.",
    },
    {
      phase: "60",
      title: "Submit childcare application and attend intake",
      description: "Complete subsidy application, attend intake, and document placement or waitlist status.",
    },
  ],
  childcare_barrier: [
    {
      phase: "30",
      title: "Register with childcare assistance and document barriers",
      description: "Call childcare subsidy programs and Head Start, document schedule and transportation barriers, and schedule intake.",
    },
    {
      phase: "60",
      title: "Submit applications and attend childcare intake",
      description: "Complete subsidy and Head Start applications and attend appointments.",
    },
  ],
  youth_programming: [
    {
      phase: "30",
      title: "Register youth for after-school or enrichment program",
      description: "Call programs matching child ages and interests, confirm availability, and submit registration.",
    },
    {
      phase: "60",
      title: "Complete enrollment and confirm start date",
      description: "Attend intake if needed and confirm youth is enrolled.",
    },
  ],
  education_workforce_training: [
    {
      phase: "30",
      title: "Apply to GED, ESL, or vocational program and schedule intake",
      description: "Call adult education or training programs, confirm eligibility, and submit application.",
    },
    {
      phase: "60",
      title: "Complete intake and attend first classes",
      description: "Attend enrollment appointments and start program.",
    },
    {
      phase: "90",
      title: "Check in on progress and support completion",
      description: "Assist with attendance and follow-up as needed.",
    },
  ],
  healthcare_access: [
    {
      phase: "30",
      title: "Apply for Medicaid/CHIP and schedule healthcare intake",
      description: "Submit Medicaid or CHIP application, call community health centers, and book earliest appointment.",
    },
    {
      phase: "60",
      title: "Complete enrollment and attend first appointment",
      description: "Finish insurance enrollment and attend scheduled healthcare appointments.",
    },
  ],
  health_barrier: [
    {
      phase: "30",
      title: "Schedule intake with health or disability support program",
      description: "Call medical, behavioral, or disability services, document barriers, and book earliest intake.",
    },
    {
      phase: "60",
      title: "Attend intake and submit required documentation",
      description: "Complete intake and follow recommended next steps.",
    },
  ],
};

/** Default steps added when no preset-driven steps exist (e.g. goals are custom only). */
const DEFAULT_STEPS: StepTemplate[] = [
  { phase: "30", title: "Schedule first appointments and submit priority applications", description: "Call 2 to 3 key programs from goals, submit applications, and book earliest intake appointments." },
  { phase: "60", title: "Follow up on applications and attend scheduled appointments", description: "Submit missing documents, attend appointments, and document outcomes." },
  { phase: "90", title: "Confirm progress and set renewal or next-phase dates", description: "Check in on goals and update plan with next steps." },
];

export function getStepTemplatesForPreset(presetKey: string | null): StepTemplate[] {
  if (!presetKey) return [];
  return PRESET_STEPS[presetKey] ?? [];
}

export function getDefaultSteps(): StepTemplate[] {
  return DEFAULT_STEPS;
}
