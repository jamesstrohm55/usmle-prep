# SDD ledger — plan: docs/superpowers/plans/2026-10-07-diagnostic-planner.md
Branch: feat/diagnostic-planner (from main 5bd2c9d). Spec: docs/superpowers/specs/2026-10-07-diagnostic-planner-design.md
Execution approved by James ("Let's execute the plan, docker should be up"). Docker verified up. Merge/push/migration apply need his explicit approval (Task 9).

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 -> T2 | T1 `QLite`, `pickBlock` use; T2 imports `QLite` | consistent |
| T1,T2 -> T5 | engine fns used by Today | names match plan interfaces |
| T1,T2 -> T6 | `sampleDiagnostic`, `summarizeRun`, `latestPerQuestion` | consistent |
| T2 -> T7 | `selectForTask`, `latestPerQuestion` | consistent |
| T3 -> T4/T6 | tables, unique index; T6 treats 23505 as saved | consistent |
| T4 -> T5,T6,T7,T8 | queries `fetchRuns`, `createRun`, `setRunStatus`, `fetchRunAttempts`, `fetchAttempts`, `fetchReviews`, `fetchSettings`, `saveSettings` | consistent; T5 Today uses `fetchRuns().catch(()=>null)` |
| T6 -> T7 | shared `src/ui/uuid.ts` edit of Questions.tsx; T7 also edits Questions.tsx | sequential tasks, no conflict if T7 starts from T6 head |
| T7 -> T8 | `QuestionsRoute` exported from Questions.tsx; T8 imports | consistent |
| T8 | moves Flashcards route `/` -> `/cards`; Today links to `/cards` | consistent |
| T1 own text | test `allocate({renal:4,nervous:5})` equals {renal:4,nervous:5}: total 100 > supply 9, so left=0 after floors | ok |
| T2 own text | test short day: minutes 15, no cards -> count floor(15*60/90)=10, minutes 15 | ok; test 'minutes 25' with no cards: left 25>=20, note 6, rest 19, 0.6*19=11.4min->7q, 0.4*19=7.6min->5q second>=5 so NOT merged: plan test expects ['note','questions'] | CONFLICT -> Ruling below |
| T3 | RLS tests need Docker (up) | ok |
Ruling: Task 2 test "second set under 5 merged" must use a time where second<5 (e.g. minutes 21: left 21, rest 15, 0.4*15=6min->4q -> merged); implementer to fix the test input, not the algorithm — arithmetic error in plan — cost if wrong: none (test-only).
Ruling: work on feature branch feat/diagnostic-planner (not main), merge only after James approves in Task 9 — protects the live deploy.
Task 1: implemented (commit 5bd2c9d..793047b), minor: TDD red step not clean (process only); under review
Task 1: minor (deferred): allocate() returns floors summing > total when total < 3*systems (unreachable with real constants; no test)
Task 1: minor (deferred): summarizeRun doesn't guard duplicate ids in run; last attempt wins (by design)
Task 1: complete (commits 5bd2c9d..793047b, review approved, 0 Critical/Important, 2 minors deferred)
Task 2: implemented (793047b..d4508c5); under review
Task 2: minor (deferred -> fold into Task 5 dispatch as one hardening change): latestPerQuestion NaN timestamp pins row; daysLeft returns NaN for malformed target (should be null); medianSeconds can return 0 -> use Math.max(1, ...); buildPlan can emit a lone note when focus has 0 questions available (skip note if focusCount 0)
Task 2: complete (commits 793047b..d4508c5, review approved, 0 Critical/Important, 4 minors deferred)
Task 3 precheck: live DB duplicate check on attempts(session_id, question_id) returned 0 rows (read-only, run by controller)
Task 3: implemented (d4508c5..1084631); RLS tests RAN locally 17/17; under review
Task 3: minor (deferred, triage before live apply): RLS tests assert only "an error" for forged/bad/big/second (should pin codes 42501/23514/23505); no test that a student can't reassign her run's user_id; minutes_by_weekday check lets NULL elements through (add array_position(...) is null); updated_at has no trigger (app sets it)
Task 3: complete (commits d4508c5..1084631, review approved, 0 Critical/Important, minors deferred; RLS tests RAN locally 17/17)
Task 4: implemented (1084631..c15df56); under review
Task 4: review: Needs fixes (2 Important, tests only: assert from() table names for run helpers; assert order('id') for fetchAttempts/fetchReviews/fetchRunAttempts). minors (deferred): no cache-fallback/auth-error test for fetchSettings; select column lists unasserted
Task 4: fix round 1/5 dispatched (resumed implementer a4bea25cd1991964f)
Task 4: fix round 1/5 (2 addressed, 0 open; commits c15df56..168f383)
Task 4: complete (commits 1084631..168f383, review clean after 1 fix round; minors deferred)
Task 5: implemented (168f383..e47de46; 53e9cac planner hardening + e47de46 Today/Settings); under review. Today not yet routed (Task 8).
Task 5: review: Needs fixes (1 Important: `now` default recreated each render defeats useMemo + midnight override-key mismatch). minors (deferred): a11y roles on load error/loading/progress; "0 days left" on target day; e.message on non-Error renders undefined; `available` counts all questions not remaining (selectForTask repeats answered ones, acceptable); Settings shows unclamped text after save; StrictMode double load harmless
Ruling: included reviewer's cheap minors 2 (cap override at 600) and 3 ("Nothing to do today" empty-plan message) in fix round 1 — same file/round, user-facing, reviewer recommended — cost if wrong: two small extra tests
Task 5: fix round 1/5 dispatched (resumed implementer a71bdeb5e2b3d0680)
Task 5: fix round 1/5 (3 addressed, 0 open; commits e47de46..f0666bb)
Task 5: complete (commits 168f383..f0666bb, review clean after 1 fix round; minors deferred)
Task 6: implemented (f0666bb..66fc4fb); under review. Implementer concerns (minor): 23505 review may show clicked choice not stored one; unrequested addition: Resume marks run complete if all answered.
Task 6: review: Needs fixes (2 Important: (1) stale Retry/in-flight save can write one run's answer into another run's state after Start over; (2) in-session results from local state not fetchRunAttempts, deviating from brief)
Task 6: minors (deferred): completing a run abandoned/completed elsewhere has no status guard in setRunStatus (.eq('status','in_progress')); raw error text / e.message undefined for non-Error; a11y focus/aria-live on question change
Ruling: included reviewer minors 3 (progress count only run questions), 4 (disable Pause while saving), 6 (Retry re-sends same row) and two missing tests in fix round 1 — data-quality, same file — cost if wrong: small extra tests
Task 6: fix round 1/5 dispatched (resumed implementer a5ab28b1941fd035b)
Task 6: fix round 1/5 (all addressed, 0 open; commits 66fc4fb..832e361)
Task 6: minors (deferred): run-id guards in submit/finish have no test (load-bearing: Retry during Start-over's own await); Pause can stay disabled if saveAttempts never settles; toast.dismiss() clears the app-wide single toast slot (same pattern as Flashcards.tsx:70); Start diagnostic silently ignored while a slow save holds busy
Task 6: complete (commits f0666bb..832e361, review clean after 1 fix round; minors deferred)
Task 7: implemented (832e361..c8fb7ea); under review. Implementer concern: planned set clicked before attempts load treats all as unseen.
Task 7: review: Needs fixes (1 Important: planned-set button clickable before attempts load -> treats all as unseen -> repeats). minors (deferred): effect depends on loadAttempts identity (render loop risk for inline arrow callers); Number('0x10')/('1e1') pass integer check (harmless)
Ruling: included reviewer minors "1 question" pluralization and URL-encoded system test in fix round 1 — trivial, same files — cost if wrong: two tiny tests
Task 7: fix round 1/5 dispatched (resumed implementer afaac2e7abb37e2d1)
Task 7: minor (deferred): QuestionsRoute encoded-system test mutates shared bank (leak risk for later tests); ready stays true if loadAttempts identity changes
Task 7: fix round 1/5 (3 addressed, 0 open; commits c8fb7ea..361ab42)
Task 7: complete (commits 832e361..361ab42, review clean after 1 fix round; minors deferred)
Task 8: implemented (361ab42..a28c6fc); under review. James approved Task 9 live steps (migration apply + push) conditional on clean final review.
Task 8: complete (commits 361ab42..a28c6fc, review approved, 0 Critical/Important, minors: no test for unmount guard/replace; Loading forever if fetchRuns never settles)
Final review (fable): Ready with fixes. MUST: (1) Questions.tsx persist: treat 23505 as saved (unique index creates failure mode on lost-response retry); (2) migration NULL-element guard in minutes_by_weekday check before live apply. Recommended: clamp n in QuestionsRoute; Diagnostic `seen` includes this visit's answers; disabled={saving} on choices; aria-label/role=status; friendlier 23505 message on start.
Ruling: single final fix dispatch also includes: setRunStatus status guard (.eq('status','in_progress')), tighten RLS tests to error codes + add user_id-reassign test, 23505 friendly message — all cheap, migration/RLS files get re-tested locally anyway — cost if wrong: small extra diff
Deploy order (from final review): apply migration -> verify -> push main (deploy.yml does not apply migrations). Re-run duplicate precheck immediately before apply.

## Release (2026-10-08)
Migration applied live as 20261008023950_planner (via Supabase MCP apply_migration after live prechecks: tables absent, 0 duplicate attempts); verified RLS on, policies, indexes. Local file renamed to match. Merged fast-forward to main (87a133a), deploy green, bundle smoke-tested (no secret keys; only the public publishable key). Not exercised: signed-in browser flows on the live site.

## Today progress + plan snapshot (2026-10-08, main 5477984, no DB change)
Added after James's request ("check if you completed that task"): per-day plan snapshot in localStorage (user-scoped keys `<user>:plan:<day>`, `<user>:note-done:<day>:<system>`, `<user>:today-minutes:<day>`), progress = distinct cards/questions since the plan's `since` timestamp, "Mark read" for notes, Rebuild plan, pace floors (8 s/card, 30 s/question), 600-minute override note. Reviewed in 3 rounds (opus). Rulings: adopted baseline then timestamp-`since` after review; user-scoped keys; null diagnostic state keeps stored plan.
Deferred minors: Rebuild when storage setItem fails but getItem works can bring back the old plan (rare); a `since` in the future freezes progress at 0 until Rebuild (clamp Math.min(since, now) optional); first offline open of the day with no snapshot stores hasCompletedRun=false and resets that day's progress once when back online; "41 flashcards at 10 minutes" report could not be reproduced (DB had 1 reviewed card; likely typed digits appended to the minutes box, now capped/visible); no dedicated CSS-scoping test; formal /code-review skill not run (subagent restrictions).

## Questions save each answer immediately (2026-10-08, main 202dcef, no DB change)
Bug: the Questions screen saved answers in one batch only at Finish, so leaving mid-set (e.g. to Today) lost them (live DB showed 0 answers for a 42-question planned set). Fix: each answer is saved when given (tutor and timed); failed rows retried on later answers/Finish; 23505 = saved; multi-row batches rejected with a server code fall back to per-row sends (poison-row guard); toast dismissed on leaving; non-Error rejections readable. Reviewed in 3 rounds (opus), 490 tests.
Deferred minors: the per-row fallback fires on ANY coded error, including auth expiry/RLS/5xx that fail every row, causing ~1+i requests on answer i (about 860 requests over a 40-question block, no data loss): narrow to integrity errors `/^23/` + a test that PGRST301 does not fall back; a permanently rejected row keeps a Retry toast that cannot succeed and the Finish toast shows only the last failure's message with no unsaved count; a save in flight that fails after the student leaves is lost silently (user-switch safety); `setStatus` in Questions.tsx still shows "undefined" for a non-Error rejection.

## Resume planned set (2026-10-08, main c03a077, no DB change)
Real data showed answers saved and Today counting, but every click on the Today task started a new full-size set at Q1/42. Today's question task now links to the remaining work (`n=remaining&done=done`, "Answer N more ..."), a completed task links to practice (`practice=1`, "Practice N more ..."); Questions labels the planned button "Resume planned set (N left in S, D done)" / "Start practice set" / "Start planned set". Reviewed (opus), 508 tests.
Deferred minors: after finishing a set and pressing Done without leaving the page the planned button still shows the old Resume numbers and the answer history is stale (questions just answered can be re-served): refresh history after a set finishes or hide the button once used (worth doing); `done` above 100 falls back to the Start label (task counts can exceed 100 with 600 minutes); when the unseen pool is short, re-served missed questions do not move Today's distinct-question counter; one test name ("preset with done 0 ...") is misleading.

## Planned-set hide + more questions (2026-10-08)
Questions: after using the planned button it is hidden for the rest of the visit; the finished-set summary shows "Back to Today" (`a href="#/today"`). (A history-reload was removed as dead code.) Content: six question-heavy blocks (12 q, 5 cards, 1 note each): biostat-07 study design/bias, biostat-08 statistics/inference, biostat-09 epidemiology/test performance, behavioral-08 ethics consent/capacity, behavioral-09 confidentiality/law/end of life, behavioral-10 communication/safety/professionalism. Live totals: 1,037 cards, 601 questions, 123 notes (+132 image items counted within).
Incident: two content agents wrote the same shared scratch script filename; the consent/capacity block file was overwritten with another block's items (duplicate slugs). Caught by an agent's test run, regenerated by its owner from author notes + fact-check report; lesson: give scratch scripts block-unique names. Known gap: futility / "do everything" care is not covered in any block (the consent block's pointer was removed).
