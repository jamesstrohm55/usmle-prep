# USMLE Prep

A private study app for Vanessa: Step 1, then Step 2 CK, then OET. Spaced-repetition flashcards (FSRS), multiple-choice question sessions (tutor and timed), notes, full-text search, and CSV/JSON import and backup export. English first, with a pt-BR reveal on cards, question explanations and notes.

Stack: Vite + React + TypeScript frontend (deployed to GitHub Pages), Supabase (Postgres + Auth + RLS) backend. Sign-in is by emailed magic link; sign-up is closed, users are created by an admin.

## Dev setup

```sh
npm i
supabase start          # local stack (needs Docker)
npm run dev
```

Create `.env` (git-ignored, never commit it). Names only, take the values from `supabase status` locally or the Supabase dashboard:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`: used by the frontend build.
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`: used only by `npm run seed` (server-side secret, never in the frontend or the repo).

Tests:

```sh
npm test                 # unit + component tests; the RLS suite is skipped without a local stack
npx tsc --noEmit
npm run build
```

RLS suite (needs `supabase start`; run it on a freshly reset DB):

```sh
supabase db reset
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
LOCAL_API_URL=$API_URL LOCAL_ANON_KEY=$ANON_KEY LOCAL_SERVICE_KEY=$SERVICE_ROLE_KEY npx vitest run supabase/tests
```

Migrations in `supabase/migrations/` define the schema and RLS. Students can read curated content and read/write their own private content and progress; `review_log` and `attempts` are append-only for students.

## Content workflow

Curated content lives in `supabase/seed/*.json` (cards, questions, notes; schema in `scripts/seedSchema.ts`). `scripts/seedFiles.test.ts` validates every file in CI, and `npm run seed` validates all files before writing anything.

```sh
npm run seed             # inserts new rows, leaves existing ones untouched
npm run seed -- --force  # also updates existing curated rows in place
```

`--force` upserts on `(owner_key, slug)`, so edited rows keep their ids and students' progress (card state, attempts, flags) survives. Change a `slug` and it becomes a new row.

## Finding flags

Students flag cards/questions/notes as wrong (with an optional note). Run in the Supabase SQL editor (bypasses RLS):

```sql
select ir.item_kind, ir.item_id, ir.status, ir.note, u.email as flagged_by,
       coalesce(c.front, left(q.stem, 120), n.title) as title
from item_reviews ir
join auth.users u on u.id = ir.user_id
left join cards c on ir.item_kind = 'card' and c.id = ir.item_id
left join questions q on ir.item_kind = 'question' and q.id = ir.item_id
left join notes n on ir.item_kind = 'note' and n.id = ir.item_id
where ir.status = 'flagged'
order by ir.item_kind, title;
```

## Promote an admin

Admins can write curated content and read everyone's flags. This upsert also works if the profile row is missing:

```sql
insert into profiles (id, role) select id, 'admin' from auth.users where email = '<email>'
on conflict (id) do update set role = 'admin';
```

Profiles are created by the `on_auth_user_created` trigger, which only fires for users created after the migrations are applied. If anyone was created earlier, backfill:

```sql
insert into profiles (id) select id from auth.users on conflict do nothing;
```

## Known limits (Phase 1)

- Tags are stored but not searchable or filterable.
- The free-tier Supabase project pauses after about a week of inactivity; restore it from the dashboard.
- Reads work offline from a per-user cache; writes need a connection and show a retry toast.

## Go-live checklist

1. Push the schema first (so the profile trigger exists before any user is created): `supabase link --project-ref mrpdbyjvnkklykpbumph`, `supabase db push`, `npm run seed`.
2. Supabase hosted Auth: configure custom SMTP (the built-in mailer only delivers to team members and is rate-limited), create the two users (dashboard, Add user), then turn off "Allow new users to sign up". If any user was created before step 1, run the profiles backfill above.
3. Hosted Auth URL configuration: Site URL and redirect allow-list `https://jamesstrohm55.github.io/usmle-prep/`.
4. Promote the admin (SQL above).
5. GitHub: make the repo public (Pages on the free plan), set Pages source to GitHub Actions, add repo Variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The deploy workflow fails early if either is empty.
6. Smoke test: sign in; an authenticated select returns the seeded rows (this also verifies the Data API grants on the hosted project); a flashcard review persists across a refresh.
7. Reset the database password that was pasted into chat earlier.
