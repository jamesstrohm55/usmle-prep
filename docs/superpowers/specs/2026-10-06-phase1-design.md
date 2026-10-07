# USMLE Prep — Phase 1 Design

Study platform for Vanessa (Brazilian IMG, 10 yrs post-graduation, intermediate English, laptop).
Tracks: Step 1 (target Jan 2027) → Step 2 CK → OET (required, no date yet).
This spec covers **Phase 1 only**. Phases 2 and 3 get their own spec cycles.

## Understanding

**Said by the user**
- Local-feeling study app, laptop only, not a live/commercial product.
- Content: mixed (Claude-generated seed + imports). Original content only; no copying UWorld/First Aid/Sketchy/etc.
- No runtime AI in v1. AI speaking feedback is a later phase; keep a seam for it.
- Stack: Vite + React + TypeScript; frontend on GitHub Pages; Supabase for data (decision B: content and user data both in the database).
- Online-first with a local read cache. Writes require a connection and fail visibly with retry. No offline write queue.
- Two accounts: Vanessa (student), James (admin).
- Explanations in plain English (~B1-B2) with key terms bolded; optional pt-BR reveal on explanations/notes. Stems and answer choices are never translated.
- Items carry an optional image with attribution, and a per-user status (unreviewed / verified / flagged) plus note.
- Vertical slice first: Step 1 cardiology fully populated, 2-3 Step 2 specialties; then scale content per system.

**Assumed**
- Content volume stays in the low thousands of items; Vanessa is effectively the only student.
- Free-tier Supabase is sufficient (note: free projects pause after ~1 week of inactivity).

**Success**
- She can drill cards and MCQs daily; progress persists and syncs.
- A wrong item she flags is fixable by James in-app or via re-seed, without touching her progress.

## Phase 1 scope

Flashcards (FSRS spaced repetition), MCQ engine (tutor + timed modes, review of missed questions, flagging), notes, tags, full-text search, CSV/TSV import for cards and JSON import for MCQs, export/backup of her data, cardiology slice.

**Out of Phase 1:** analytics, planner, diagnostic, glossary, pt-BR glossary tap-to-define, videos (Phase 2); full-length exams, OET modules, AI speaking (Phase 3+). Schema must not block these (taxonomy columns, append-only logs).

## Architecture

```
src/
  engine/      pure TS, no React/Supabase imports: FSRS wrapper, MCQ session logic, due-queue builder
  db/          Supabase client + typed queries
  features/    flashcards/ questions/ notes/ search/ import-export/ auth/
supabase/
  migrations/  versioned SQL (schema + RLS)
  seed/        generated content JSON (reviewable in git)
scripts/
  seed.ts      upserts seed JSON by slug using service key from .env
```

- **Client:** React + `@supabase/supabase-js`; TanStack Query with persisted cache (IndexedDB) so reads work offline.
- **Auth:** email magic link. Redirect URLs configured for the GitHub Pages origin and localhost.
- **Scheduling:** FSRS runs client-side in `engine/`; results are written to Supabase.

## Data model (SQL migrations)

**Content** — `cards`, `questions`, `notes` (separate tables so Postgres enforces real constraints). Shared columns: `id`, `slug` (stable, unique), `track` (step1/step2/oet), `system`, `discipline`, `tags text[]`, `owner_id uuid null`, generated `tsvector` for search.
- `cards`: `front`, `back`, `back_pt`, optional `image_url`, `image_credit`
- `questions`: `stem`, `choices jsonb`, `correct`, `explanation`, `explanation_pt`, optional `image_url`, `image_credit`
- `notes`: `title`, `body_md`, `body_pt_md`
- `owner_id` null = curated content; set = that user's private import.

**Per-user**
- `card_state` (user_id, card_id, FSRS fields: due, stability, difficulty, state, reps, lapses, last_review)
- `review_log` (append-only: user_id, card_id, rating, reviewed_at, duration_ms)
- `attempts` (user_id, question_id, chosen, correct, duration_ms, mode, session_id, answered_at)
- `item_reviews` (user_id, item kind + id, status, note)
- `profiles` (id → auth.users, role: student | admin)

## Security (RLS — the real boundary, since the frontend is public)

- Logged-out: no reads.
- Content read: `owner_id is null or owner_id = auth.uid()`.
- Students write only rows they own and only their own per-user rows.
- Admins write curated rows (`owner_id is null`) and can read all `item_reviews`.
- Service key lives only in a gitignored `.env`; never in the browser or chat.
- The publishable key is public by design.

## Content flow

- Pipeline output is JSON in `supabase/seed/`, validated by a zod schema; a malformed item fails the build.
- `npm run seed` upserts by `slug`. **The database is the source of truth after seeding:** seed only inserts new slugs and never overwrites a curated row edited in-app unless `--force`.

## Errors

- Failed write: toast + retry; no silent loss.
- Expired session: return to login, preserving the in-progress session state.
- Bad import: rejected row-by-row with a report.

## Testing

- **Vitest** for `engine/`, written test-first.
- **RLS tests** against local Supabase (`supabase start`, Docker) proving: student can't read admin-only data, can't write curated rows, logged-out reads nothing, students can't read each other's per-user rows.
- **Seed validation** check in CI/build.

## Deployment

- GitHub Pages serves the static frontend. **Free-plan Pages requires a public repo**; the repo stays private until the first deploy, then needs James's explicit confirmation to flip to public. Content is not exposed by this, since it lives behind RLS.
- Supabase project ref: `mrpdbyjvnkklykpbumph`. Schema changes ship only as migrations.

## Open items

- Vanessa's actual Step 1 date and any material she already owns (Anki etc.).
- AI speaking feedback design (later phase).
- Reset the Supabase DB password (it was pasted in chat); hold the new one locally only.
