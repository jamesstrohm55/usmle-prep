# Content guide (seed files)

Content lives in `supabase/seed/*.json`, one file per topic block, validated by `scripts/seedSchema.ts` (zod) and loaded with `npm run seed` (insert-only; `--force` updates existing rows in place and keeps ids). The reader is Vanessa: a Brazilian physician, 10 years out of medical school, intermediate English, preparing for USMLE Step 1.

## File shape

```json
{ "cards": [ ... ], "questions": [ ... ], "notes": [ ... ] }
```

Every item has: `slug` (globally unique across ALL seed files), `track` (`"step1"`), `system`, `discipline`, `tags`.

- `system`: the organ system or discipline area (e.g. `"cardiovascular"`, `"renal"`, `"microbiology"`).
- `discipline` is one of: `anatomy`, `embryology`, `physiology`, `pathology`, `pharmacology`, `microbiology`.
- `tags`: first tag is the block slug (e.g. `"heart-failure"`), then 1-3 subtopic tags.
- Slugs: `card-<block>-<topic>`, `q-<block>-<topic>`, `note-<block>-<topic>`; lowercase, hyphens only.

### Cards
- `front`: one clear question or cue (not a list dump). `back`: the answer in at most ~40 words, key terms in `**bold**`. `back_pt`: faithful pt-BR version.
- One fact per card. If the answer is a list, keep it to 6 items or fewer.
- No cloze syntax. No HTML. Only `**bold**` and `*italic*` are rendered.

### Questions (USMLE-style, single best answer)
- A short clinical vignette: age and sex, presentation, then the vitals, exam, lab or ECG findings in the text. End with one question (diagnosis, mechanism, next step, drug effect, or artery/structure involved).
- Exactly 5 choices, all plausible and from the same category (five arteries, five drugs, and so on). No "all of the above" or "none of the above". No negatively worded stems.
- `correct` is the 0-based index. Vary the correct position across a block; do not make it mostly the same index.
- `explanation`: 2 to 4 sentences. Why the answer is right, and why the most tempting distractor is wrong. `explanation_pt`: pt-BR. Stems and choices are English only (no `_pt` for them).
- Do not cite doses or guideline thresholds that change between guideline versions. Prefer mechanisms and classic associations.

### Notes
- One note per block: 200-350 words, `##` headings and `-` bullet lists. **No tables** (they render as raw text). Key terms in `**bold**`. `body_pt_md` is a faithful pt-BR version.

## Images
- Files live in `public/images/<system>/<topic>-<n>.jpg` (lowercase, `[a-z0-9_-]` only, .jpg/.jpeg/.png/.webp), at most 300 KB each. `image_url` is the relative path without a leading slash, e.g. `images/ecg/afib-1.jpg` (an `https://` URL also validates, but prefer repo files).
- Permissive licenses only: public domain, CC0, CC BY, CC BY-SA. `image_credit` is required with any image and must give author, license and source URL, e.g. `Jane Doe, CC BY-SA 4.0, https://commons.wikimedia.org/...`.
- The alt text is generic on purpose (`Clinical image (see the question)`) so it never reveals the answer.
- Image items should be NEW image-recognition cards or questions: the image appears on the card front or in the question stem, so the text must not name the finding.
- Every file in `public/images` must be referenced by a seed item (a test enforces this).

## Language rules
- English at about B1-B2: short sentences, common words, one idea per sentence. Medical terms stay (she knows them); avoid idioms and phrasal-verb-heavy phrasing.
- pt-BR: Brazilian medical terminology and abbreviations (IAMCSST, ICFEr, ICFEp, ECG, BRA, IECA, ARNI, FA, TV, FV, PA, DC...). Drug names use the Brazilian INN spelling (e.g. succinato de metoprolol, espironolactona). Keep the same bold terms as the English.

## Accuracy and originality rules
- Only well-established, Step 1-level facts. If a fact is guideline-dependent, state it generally or leave it out. Never invent a statistic, eponym or study.
- Write everything fresh. Do not copy sentences from First Aid, UWorld, Amboss, Sketchy, Pathoma or textbooks; facts are fair game, phrasing must be original.
- All items start unreviewed; Vanessa verifies or flags them in the app.

## Checks before committing a block
1. `npx vitest run scripts` passes (schema validity and global slug uniqueness).
2. The fact-check pass: answer key, distractors (none is also correct), explanation accuracy, and pt-BR terminology.
