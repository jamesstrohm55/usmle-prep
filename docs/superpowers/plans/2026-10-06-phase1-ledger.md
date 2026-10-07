# SDD ledger — plan: docs/superpowers/plans/2026-10-06-phase1.md

Spec: docs/superpowers/specs/2026-10-06-phase1-design.md (reachable). Branch: phase1 (in-place; .env and node_modules live in this dir).

## Pre-flight scan
| Pair / task | Finding |
|---|---|
| T1 vite include vs T6 vite include vs T13 CI | T6 adds supabase/tests to include; plain `npm test` then needs local Supabase. Conflict. |
| T2 CardStateRow vs T5 card_state vs T8 saveReview | consistent; T2 requires tsc check against installed ts-fsrs Card type |
| T3 buildQueue vs T9 usage | consistent |
| T4 engine vs T10 usage | consistent |
| T5 Step 2 (user runs supabase login/link) vs local-only work | link not needed until live push (T7 Step 6); local `supabase start` needs only init |
| T7 Step 6 db push / seed to live project | writes to the live DB: user confirmation gate |
| T8 placeholders vs T9-T12 | T8 stubs are replaced in T9-T12; stubs for Flashcards etc. must accept no props |
| T9/T10/T11 injectable load/save | consistent with App (no props, defaults) |
| T12 vs T8 | uses supabase client + useToast; consistent |
| T13 public flip | user confirmation gate (outward-facing) |
| Each task: tests vs code | T2-T4, T7, T9-T12 tests match given code on read-through |

## Rulings
Ruling: Work on branch `phase1` in the main directory, not a separate worktree — .env and node_modules are here and one dev — if wrong, move to worktree later.
Ruling: RLS tests guarded with describe.skipIf(!process.env.LOCAL_API_URL) so plain `npm test` stays green without local Supabase; CI runs `npx vitest run src scripts` — costs nothing if wrong.
Ruling: T5 does `supabase init` + local start only; `supabase login/link` deferred to T7 Step 6 (live push) — costs nothing.
Ruling: Stop and ask the user before T7 Step 6 (live db push + seed) and T13 Step 3 (make repo public).
Task 1: complete (commits 49b1db0..d1d7baa, review clean); minors deferred: .mcp.json no trailing newline
Task 2: minor (deferred): round-trip test asserts only 3 of 10 fields (fsrs.test.ts:39-45); strengthen with toEqual on a card with nonzero lapses/learning_steps — triage at final review (maps to card_state columns)
Task 2: minor (deferred): no assertion that toRow(newCard).last_review === null
Task 2: complete (commits d1d7baa..3f191e6, review clean, minors deferred)
Task 3+4: minor (deferred): no due===now boundary test (queue.test.ts); timedLimitMs unclamped for negative/NaN
Task 3+4: complete (commits 3f191e6..491ec4a, review clean)
Task 5: minor (deferred): config.toml site_url=127.0.0.1:3000 vs Vite 5173 — fix in T8 auth wiring; pgdelta experimental; no index on card_state.card_id/item_reviews.item_id; attempts.chosen unchecked vs choices count; supabase/.gitignore and tsconfig.tsbuildinfo untracked — handled in T6 dispatch
Task 5: complete (commits 491ec4a..81b6014, review clean)
Task 6: minor (deferred, TRIAGE AT FINAL REVIEW — security suite hardening): add negative tests: student cannot update profiles.role; cannot flip owned card owner_id to null; cannot update/delete another student's private row; anon insert rejected; anon-reads-nothing runs before per-user rows exist (vacuous for card_state/attempts/item_reviews) and ignores error, assert profiles too; assert error code 42501; item_reviews insert at rls.test.ts:88 unchecked; search_content test non-idempotent (use run-scoped term); CI silent-skip guard (throw if CI && !LOCAL_API_URL)
Task 6: complete (commits 81b6014..f396382, review clean; controller re-ran RLS 9/9 on fresh DB)
Task 7: minor (deferred): seed.ts JSON.parse unguarded (poor error, half-seed; idempotent); duplicate-slug tests only for cards; card-hyperk-ecg ordering (P loss before wide QRS); pt-BR 'ARM' wording
Task 7: DEFERRED TO USER GATE: live 'supabase link' + 'db push' + 'npm run seed' to remote project (writes to live DB; needs user confirmation + user runs login/link)
Task 7: complete (commits f396382..e359304, review clean; live push pending)
Task 8: Review: Needs fixes — Important: (1) persisted TanStack cache is a no-op (no useQuery anywhere; spec local read cache unmet; sign-out purge cosmetic); (2) unpaginated select('*') truncates at PostgREST 1000 rows. Minor deferred: saveReview two-write non-atomic (retry safe); fetchCardStates due typed string; Toast provider value recreated; hosted redirect allow-list for Pages origin is a manual dashboard step (T13)
Ruling: Replace TanStack persisted cache with idb-keyval cachedRead(userId-scoped key, fetcher) in db/queries.ts (fall back to cache only on network failure; clear on SIGNED_OUT in AuthGate and sign-out button finally); remove 3 TanStack deps and PersistQueryClientProvider; add paging helper (range loop, 1000/page) for the 4 list fetches — plan defect (plan wired a cache nothing used); spec conformance is binding. Costs: if wrong, rework of db/queries.ts only. T9-T12 unaffected (features call queries directly).
Ruling: T13 CI test step must provide dummy VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY env (client.ts throws at import without them).
Task 8: fix round 1/5 (2 addressed, 0 open; commits d869d72..17ee75a)
Task 8: minor (deferred): pageAll boundaries untested (0/1000/1001) + anon key branch untested; signOut().finally(clearCache) unhandled rejection; AuthGate void clearCache() fire-and-forget; paging/cache unverified against real Supabase+browser IndexedDB (verify manually in T13 smoke)
Task 8: complete (commits e359304..17ee75a, review clean after 1 fix round)
Task 9: Review: Needs fixes — Important: (1) double-click on rating skips a card + double-logs (no in-flight guard); (2) stale Retry closure after a later rating succeeds re-saves old card + slices unrated card; (3) Rich.tsx startsWith drops chars on unbalanced asterisks ('** foo', '*5 mg', bare '**'). Minor deferred: load failure toast w/o retry leaves 'Loading…'; flag/verify failure toast without Retry; NEW_PER_SESSION constant doesn't subtract today's new cards; img alt=''; missing tests for double-click/stale retry/unbalanced asterisks/flag failure (fix round adds the first three)
Task 9: fix round 1/5 (3 addressed, 0 open; commits f61579d..fd3efd0)
Task 9: minor (deferred): stale toast keeps inert Retry visible (Toast has no hide API); Flashcards.test.tsx:51-52 'if (retry)' vacuous-pass guard
Task 9: complete (commits 17ee75a..fd3efd0, review clean after 1 fix round)
Task 10: Review: Needs fixes — Important: (1) persist retry closure reads shared refs: after a new session starts, retry writes old answers with new session_id/mode or is dropped by persistedRef; (2) flag/verify buttons have no failure handling (unhandled rejection, silent). Minor deferred: no visual feedback of chosen answer in timed mode; no explanation review after timed session (only missed via tutor); attempts saved only on Finish (navigating away drops answers); load failure leaves 'Loading…'; double-Finish and double-click-choice tests vacuous (fireEvent flushes state). Folded into fix round: retry in-flight guard; lazy crypto.randomUUID (insecure-context crash)
Task 10: fix round 1/5 (4 addressed, 0 open; commits 621f956..6cfa16e)
Task 10: minor (deferred): crypto fallback test doesn't assert v4 format; stale-retry test final 'still 3 calls' check may hit detached node; setStatus .then(toast.show).catch masks toast throws (theoretical)
Task 10: complete (commits fd3efd0..6cfa16e, review clean after 1 fix round)
Task 11: minor (deferred): stale-failure ignore branch untested; new search doesn't clear previous hits/'No results.' while in flight, blank submit doesn't invalidate in-flight; pt-toggle-reset-on-switch untested; notes <h3> not keyboard-accessible (no button role/aria-expanded) — a11y polish, triage at final review; notes not literally grouped by system
Task 11: complete (commits 6cfa16e..a6bb870, review clean)
Task 12: minor (deferred): rejected 'line N' are data-row indices not file lines; JSON rejections 0-based vs cards 1-based; within-file duplicate fronts/stems silently dropped (not reported as rejected); card front starting with '#' treated as comment; Anki '#guid column' / '#columns' headers ignored (likely real-world: GUID in col 1 shifts front/back) — TRIAGE AT FINAL REVIEW; Retry void runImport unhandled rejection (slugFor outside try); object URL revoked synchronously (older Safari); ImportExport.tsx no component test; card with same front but different back silently skipped as 'already existed'
Task 12: complete (commits a6bb870..269c6f3, review clean)
Ruling: Task 13's per-task review (1.5KB workflow diff) is folded into the final whole-branch review rather than a separate dispatch — tiny diff, and the final reviewer reads it anyway; costs nothing if wrong.
Task 13 (local part, steps 1-2): complete (commits 269c6f3..5432836); steps 3-5 + T7 step 6 are USER GATES (public flip, gh variables, Pages, push, live db push + seed)
FINAL REVIEW (opus): Ready after fixes. Ops: C1 magic-link SMTP for hosted project (user step, in README go-live checklist). Fix wave (one dispatch): I1 open signup, I2 seed validation in CI, I3 offline after token expiry, I4 expired-session state, I5 load-failure retry, I6 question block shuffle/cap, I7 expandable search hits, I8 flag notes + README, I9 Again requeue, I10 CI guard + README go-live, I11 append-only logs + search_path; minors 1-8 (Anki headers, RLS negatives, timed highlight, notes a11y, signOut catch, URL revoke, vacuous test, fsrs roundtrip). See final-fix-brief.md.
Ruling: Do NOT add 'revoke from anon' and do NOT add tags to fts (array_to_string not immutable) in this wave — tags stay non-searchable in Phase 1, documented in README.
Ruling: Edit migrations 1 and 2 in place (never pushed to the remote project).
Ruling: Plan dropped the spec's 'expired session keeps in-progress state' requirement (final review caught it); implementing via overlay Login (I4).
Final fix wave re-review (opus): 4 Important open: (1) AuthGate offline flag never resets when online + cachedRead writes empty anon results into lastUserId cache (AuthGate.tsx:28-30, queries.ts cachedRead); (2) Retry toast from user A survives user switch (ToastProvider wraps AuthGate) and writes under user B (Flashcards headId ref guard passes; Questions.persist has no guard); (3) I9 requeue defeats stale-Retry guard (id-only compare; repro: 3 saves for 2 ratings → duplicate review_log row, double FSRS advance); (4) README go-live order: users created before db push → no profiles rows → admin promotion updates 0 rows. Deferred minors: duplicate question stems still silent; signOut resolves {error} so .catch rarely runs; shared-laptop residual cached content after expiry (document); timed intervals run while hidden behind overlay; anon card_state insert test asserts any error (likely NOT NULL not 42501).
Ruling (DEVIATION from SDD 'no second fix wave'): dispatch ONE narrowly scoped follow-up fix for the 4 Important findings (verified by reviewer repro tests; (2) is a cross-user write = security/data-integrity class; nothing deployed yet), then controller re-verifies and a final scoped check. Costs: one more dispatch; disclosed to user in final summary.
Final scoped check (sonnet): all 4 follow-up findings ADDRESSED; deferred minors: export Retry not alive-guarded; toast.dismiss() after rating clears unrelated toasts; Retry dead after tab navigation; runImport completing after unmount may still setReport/toast.
SDD run complete: 13 tasks, final whole-branch review (opus) + fix wave + follow-up fix; controller-verified at 2193cff: RLS 14/14 on fresh DB, npm test 140 passed/14 skipped, tsc 0, build 0.
