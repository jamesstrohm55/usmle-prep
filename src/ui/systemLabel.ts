import type { Tr } from './lang';

const SPECIAL: Record<string, string> = {
  'hematology-oncology': 'Hematology & oncology',
  'biochemistry-genetics': 'Biochemistry & genetics',
  'biostatistics-epidemiology': 'Biostatistics & epidemiology',
  'musculoskeletal-dermatology': 'Musculoskeletal & dermatology',
  'behavioral-science': 'Behavioral science',
  'general-principles': 'General principles',
};

// "gastrointestinal" -> "Gastrointestinal"; stored slugs stay as they are everywhere else.
// With a translator, the readable English name is looked up in the Portuguese dictionary.
export function systemLabel(slug: string, tr: Tr = (s) => s): string {
  return tr(SPECIAL[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' '));
}
