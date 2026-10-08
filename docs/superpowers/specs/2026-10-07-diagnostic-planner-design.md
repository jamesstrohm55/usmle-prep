# Diagnostic and daily planner: design

Status: draft for review (brainstormed 2026-10-07). Scope: Step 1 only.

## Purpose

Vanessa (Brazilian physician, 10 years out of medical school) targets Step 1 in **January 2027**; the exact date is not fixed. She can study **1 to 3 hours a day** and that varies. Today the app has content but no guidance on where to start or what to do each day.

- The **diagnostic** finds out, per system, where she stands, so time goes to weak areas.
- The **planner** ("Today") builds each day's list from her time budget, weak spots and due flashcards.

Success: on day one she can take the diagnostic in short sittings, see per-system results, and from then on open one screen that tells her what to do in the time she has. A missed day needs no repair: the next day's plan adapts.

Said by James: Step 1 first; diagnostic plus planner; sampled sessions that can pause and resume; option "daily plan recomputed each day"; 1-3 hours a day, variable; target date January 2027, not fixed.
My assumptions (correctable): one diagnostic up front, repeatable later; the plan is a suggestion she can ignore; no runtime AI; per-system granularity; no countdown shown until she sets a date.

## Out of scope

Calendar view; reminders and notifications; tracking which notes were read (notes are suggested, not tracked); mastery below system level; Step 2 CK and OET plans; changing the spaced-repetition scheduler.

## User-facing behavior

### Settings
- Target exam date (optional, editable) and study minutes per weekday (Monday-first array of 7). Defaults: 60 on weekdays, 180 on Saturday and Sunday.
- "Minutes today" override on the Today screen, stored per viewer in the browser only (a convenience, not shared state).
- No date set: Today still works and shows a prompt to set a date. No made-up default date.

### Diagnostic
- One in-progress run at a time. Starting a run draws about 100 questions, frozen into the run so a resume gives the same questions.
- Sampling: allocation per system proportional to the weights in `src/engine/blueprint.ts` (approximate test weights, one editable file, not official figures), at least 3 per system when the system has that many questions, total 100 (largest-remainder rounding), capped by available questions. Prefer questions she has not answered before. Draw is seeded random, seed stored with the run.
- She answers in sittings and can pause any time. During a sitting there are no explanations. On pause or finish she sees the questions she answered in that sitting with explanations. Each answer is saved immediately (nothing lost on close). A resumed run skips questions already answered.
- Results: per system, answered, correct, accuracy, and a "low confidence" flag when fewer than 5 answered. Overall accuracy too.
- She can abandon a run ("start over") and take a new diagnostic later.

### Today (planner)
- Header: days left (when a date is set), minutes available today, and a weekly bar of minutes done vs planned (Monday to Sunday, local time).
- Task list sized to today's minutes:
  1. **Due flashcards**, capped at 40% of the time.
  2. **Focus system** (highest priority): a note to read (estimated 6 minutes, suggested only), then a question set.
  3. **Second system** (when time remains): questions only.
- Each task links to the existing screens (flashcards, notes, questions).
- Under 10 minutes of time left after cards: a single question set in the focus system.

## Logic (pure functions in `src/engine/`)

### Mastery
Per system, use the **latest attempt per question** (re-seeing a question does not inflate the score):
`mastery = (correct + 2) / (answered + 4)`  (a neutral 0.5 prior worth 4 questions).
The diagnostic and later practice feed the same pool, so real practice gradually outweighs the diagnostic.

### Priority
`priority = weight × (1 − mastery) × recency`, where `recency = clamp(0.5 + daysSinceLastStudy / 4, 0.5, 1.5)` and `daysSinceLastStudy` is the days since her last attempt or card review in that system (never studied counts as 7 or more). Highest priority is the focus system, second highest is the second system.

### Time estimates
Seconds per card and per question come from her own history (median of recent `review_log.duration_ms` and `attempts.duration_ms`); defaults 20 s per card and 90 s per question until there is data. A question set has at least 5 questions.

### Question selection for a task
Unseen questions first, then questions she got wrong last time, then the rest, within the task's system.

### Weekly bar
Done minutes = sum of `review_log.duration_ms` and `attempts.duration_ms` for the local week; planned minutes = sum of her weekday minutes for that week.

## Data

New migration (one file, additive, nothing existing altered):
- `study_settings(user_id uuid pk default auth.uid(), target_date date null, minutes_by_weekday int[] not null default '{60,60,60,60,60,180,180}', updated_at timestamptz default now())`, check `array_length = 7` and each value between 0 and 600.
- `diagnostic_runs(id uuid pk default gen_random_uuid(), user_id uuid default auth.uid(), started_at timestamptz default now(), completed_at timestamptz null, status text check in ('in_progress','completed','abandoned'), question_ids uuid[] not null, seed text not null)`; at most one `in_progress` per user (partial unique index).
- RLS on both: a user reads and writes only their own rows; admin read not required.
- Diagnostic answers reuse `attempts` (`session_id` = the run id, `mode = 'timed'`); no new answers table. Results are computed, not stored.
- Applying the migration to the live project is a production database change: it needs explicit approval at execution time and the local RLS tests (Docker) must pass first.

## Code layout
- `src/engine/blueprint.ts`: system weights.
- `src/engine/diagnostic.ts`: sampling and result summary (pure).
- `src/engine/planner.ts`: mastery, priority, estimates, plan building (pure).
- `src/features/diagnostic/`, `src/features/planner/` (Today and settings): screens, using `cachedRead` for content and the existing query helpers.
- `src/db/queries.ts`: fetch and save helpers for the two new tables and for attempts by session.
- `src/App.tsx`: two nav links (Today first as the landing page when the diagnostic is done; Diagnostic until then).
- Questions screen: accept `system` and `n` query params so a planner task opens a ready set.

## Errors and offline
Online-first as elsewhere. Today computes from cached content and cached card state when offline. Starting or answering the diagnostic and saving settings require a connection and show a clear message otherwise. A failed attempt save keeps the answer in the sitting and offers retry (same pattern as Questions).

## Testing
Test-first. Unit tests for the engine: sample sizes sum to 100 and honor the minimum and the cap, determinism for a seed, unseen preference, mastery with a de-duplicated latest attempt, priority ordering with recency, plan time never exceeds the budget, the card cap, the under-10-minute case, the no-date case. Component tests (existing mocking style) for settings, a diagnostic pause and resume with no duplicated answers, results with low-confidence flags, and Today. RLS tests for the new tables (own rows only) in the existing Docker-based suite.

## Review focus (risks the tests should pin)
1. Resuming a run must never double-count an answer.
2. A week with zero minutes for a day must not break the plan or the bar.
3. A system with fewer than 3 questions available must not break sampling.
4. Local-time week and day boundaries (she is in Brazil; use the browser's local date).
5. A new user with no attempts, no cards and no settings still sees a sensible Today.
