import { z } from 'zod';

const common = {
  slug: z.string().min(1),
  track: z.enum(['step1', 'step2', 'oet']),
  system: z.string().min(1),
  discipline: z.string().min(1),
  tags: z.array(z.string()).default([]),
};

const card = z.object({
  ...common, front: z.string().min(1), back: z.string().min(1),
  back_pt: z.string().optional(), image_url: z.string().url().optional(), image_credit: z.string().optional(),
});

const question = z
  .object({
    ...common, stem: z.string().min(1), choices: z.array(z.string().min(1)).min(2).max(6),
    correct: z.number().int().min(0), explanation: z.string().min(1),
    explanation_pt: z.string().optional(), image_url: z.string().url().optional(), image_credit: z.string().optional(),
  })
  .refine((q) => q.correct < q.choices.length, { message: 'correct index out of range' });

const note = z.object({
  ...common, title: z.string().min(1), body_md: z.string().min(1), body_pt_md: z.string().optional(),
});

const uniqueSlugs = (items: { slug: string }[]) => new Set(items.map((i) => i.slug)).size === items.length;

export const seedFileSchema = z
  .object({ cards: z.array(card).default([]), questions: z.array(question).default([]), notes: z.array(note).default([]) })
  .refine((f) => uniqueSlugs(f.cards) && uniqueSlugs(f.questions) && uniqueSlugs(f.notes), { message: 'duplicate slug' });

export type SeedFile = z.infer<typeof seedFileSchema>;
