/** Preset labels for intake multi-select; `value` is stored as preset_key when chosen. */
export const PRESET_GOALS = [
  { value: "housing_stability", label: "Housing stability" },
  { value: "employment", label: "Employment" },
  { value: "legal_assistance", label: "Legal assistance" },
  { value: "utility_support", label: "Utility support" },
  { value: "food_support", label: "Food support" },
  { value: "transportation", label: "Transportation" },
  { value: "immigration_documentation", label: "Immigration documentation" },
  { value: "credit_improvement", label: "Credit improvement" },
  { value: "digital_literacy", label: "Digital literacy" },
  { value: "childcare", label: "Childcare" },
  { value: "youth_programming", label: "Youth programming" },
  {
    value: "education_workforce_training",
    label: "Education / workforce training",
  },
  { value: "healthcare_access", label: "Healthcare access" },
] as const;

export const PRESET_BARRIERS = [
  { value: "eviction_risk", label: "Eviction risk" },
  { value: "unemployment", label: "Unemployment" },
  { value: "immigration_documentation", label: "Immigration documentation" },
  { value: "bad_credit", label: "Bad credit" },
  { value: "no_transportation", label: "No transportation" },
  { value: "low_digital_literacy", label: "Low digital literacy" },
  { value: "housing_instability", label: "Housing instability" },
  { value: "utility_debt", label: "Utility arrears / shutoff risk" },
  { value: "food_insecurity", label: "Food insecurity" },
  { value: "childcare_barrier", label: "Childcare barrier" },
  { value: "legal_matter", label: "Active legal matter" },
  { value: "health_barrier", label: "Health / disability barrier" },
] as const;
