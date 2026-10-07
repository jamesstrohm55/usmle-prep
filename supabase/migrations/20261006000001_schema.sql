create type track as enum ('step1', 'step2', 'oet');
create type user_role as enum ('student', 'admin');
create type review_status as enum ('unreviewed', 'verified', 'flagged');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null default 'student'
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create function is_admin() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Content tables -----------------------------------------------------------
create table cards (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  owner_id uuid references auth.users on delete cascade,
  owner_key uuid generated always as (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  track track not null,
  system text not null,
  discipline text not null,
  tags text[] not null default '{}',
  front text not null check (length(front) > 0),
  back text not null check (length(back) > 0),
  back_pt text,
  image_url text,
  image_credit text,
  fts tsvector generated always as (to_tsvector('english', front || ' ' || back)) stored,
  created_at timestamptz not null default now(),
  unique (owner_key, slug)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  owner_id uuid references auth.users on delete cascade,
  owner_key uuid generated always as (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  track track not null,
  system text not null,
  discipline text not null,
  tags text[] not null default '{}',
  stem text not null check (length(stem) > 0),
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 6),
  correct int not null,
  explanation text not null check (length(explanation) > 0),
  explanation_pt text,
  image_url text,
  image_credit text,
  fts tsvector generated always as (to_tsvector('english', stem || ' ' || explanation)) stored,
  created_at timestamptz not null default now(),
  unique (owner_key, slug),
  check (correct >= 0 and correct < jsonb_array_length(choices))
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  owner_id uuid references auth.users on delete cascade,
  owner_key uuid generated always as (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  track track not null,
  system text not null,
  discipline text not null,
  tags text[] not null default '{}',
  title text not null check (length(title) > 0),
  body_md text not null check (length(body_md) > 0),
  body_pt_md text,
  fts tsvector generated always as (to_tsvector('english', title || ' ' || body_md)) stored,
  created_at timestamptz not null default now(),
  unique (owner_key, slug)
);

create index cards_fts on cards using gin (fts);
create index questions_fts on questions using gin (fts);
create index notes_fts on notes using gin (fts);

-- Per-user tables ----------------------------------------------------------
create table card_state (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  card_id uuid not null references cards on delete cascade,
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days int not null,
  scheduled_days int not null,
  learning_steps int not null,
  reps int not null,
  lapses int not null,
  state int not null,
  last_review timestamptz,
  primary key (user_id, card_id)
);

create table review_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  card_id uuid not null references cards on delete cascade,
  rating int not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now(),
  duration_ms int not null default 0
);

create table attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  question_id uuid not null references questions on delete cascade,
  chosen int not null,
  correct boolean not null,
  duration_ms int not null default 0,
  mode text not null check (mode in ('tutor', 'timed')),
  session_id uuid not null,
  answered_at timestamptz not null default now()
);

create table item_reviews (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  item_kind text not null check (item_kind in ('card', 'question', 'note')),
  item_id uuid not null,
  status review_status not null default 'unreviewed',
  note text,
  primary key (user_id, item_kind, item_id)
);

-- Search across all three content tables (RLS applies: security invoker) -----
create function search_content(q text)
returns table (kind text, id uuid, title text, track track, system text)
language sql stable security invoker as $$
  select 'card', id, front, track, system from cards where fts @@ websearch_to_tsquery('english', q)
  union all
  select 'question', id, left(stem, 120), track, system from questions where fts @@ websearch_to_tsquery('english', q)
  union all
  select 'note', id, title, track, system from notes where fts @@ websearch_to_tsquery('english', q)
  limit 50;
$$;
