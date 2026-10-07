export type Track = 'step1' | 'step2' | 'oet';
type Common = { id: string; slug: string; owner_id: string | null; track: Track; system: string; discipline: string; tags: string[] };
export type Card = Common & { front: string; back: string; back_pt: string | null; image_url: string | null; image_credit: string | null };
export type Question = Common & {
  stem: string; choices: string[]; correct: number; explanation: string;
  explanation_pt: string | null; image_url: string | null; image_credit: string | null;
};
export type Note = Common & { title: string; body_md: string; body_pt_md: string | null };
export type ItemStatus = 'unreviewed' | 'verified' | 'flagged';
