// Approximate Step 1 emphasis per system, used only to size the diagnostic and rank study priority.
// Not official figures; edit freely (weights should sum to about 100).
export const SYSTEM_WEIGHTS: Record<string, number> = {
  cardiovascular: 9, respiratory: 8, renal: 7, gastrointestinal: 7, endocrine: 6, reproductive: 7,
  nervous: 9, 'hematology-oncology': 6, psychiatry: 5, 'behavioral-science': 4,
  'biostatistics-epidemiology': 5, 'musculoskeletal-dermatology': 7, 'biochemistry-genetics': 6,
  immunology: 5, microbiology: 6, 'general-principles': 3,
};
export const weightOf = (system: string) => SYSTEM_WEIGHTS[system] ?? 3;
