-- Diagnostic and planner: per-user settings and diagnostic runs (additive).
create table study_settings (
  user_id uuid primary key references auth.users on delete cascade default auth.uid(),
  target_date date,
  minutes_by_weekday int[] not null default '{60,60,60,60,60,180,180}'
    check (array_length(minutes_by_weekday, 1) = 7 and 0 <= all (minutes_by_weekday) and 600 >= all (minutes_by_weekday)),
  updated_at timestamptz not null default now()
);

create table diagnostic_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  question_ids uuid[] not null,
  seed text not null
);
create unique index diagnostic_runs_one_active on diagnostic_runs (user_id) where status = 'in_progress';

alter table study_settings enable row level security;
alter table diagnostic_runs enable row level security;
create policy study_settings_own on study_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy diagnostic_runs_own on diagnostic_runs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A question can be answered once per session (protects diagnostic resume from double counting).
create unique index attempts_session_question on attempts (session_id, question_id);
