alter table profiles enable row level security;
alter table cards enable row level security;
alter table questions enable row level security;
alter table notes enable row level security;
alter table card_state enable row level security;
alter table review_log enable row level security;
alter table attempts enable row level security;
alter table item_reviews enable row level security;

create policy profiles_self on profiles for select using (id = auth.uid());

-- Content: same three policies on each table.
do $$
declare t text;
begin
  foreach t in array array['cards', 'questions', 'notes'] loop
    execute format($f$create policy %1$s_read on %1$s for select
      using (auth.uid() is not null and (owner_id is null or owner_id = auth.uid()))$f$, t);
    execute format($f$create policy %1$s_insert on %1$s for insert
      with check ((owner_id = auth.uid()) or (owner_id is null and is_admin()))$f$, t);
    execute format($f$create policy %1$s_update on %1$s for update
      using ((owner_id = auth.uid()) or (owner_id is null and is_admin()))
      with check ((owner_id = auth.uid()) or (owner_id is null and is_admin()))$f$, t);
    execute format($f$create policy %1$s_delete on %1$s for delete
      using ((owner_id = auth.uid()) or (owner_id is null and is_admin()))$f$, t);
  end loop;
end $$;

create policy card_state_own on card_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Append-only for students: they can read and insert their logs, never edit or delete.
do $$
declare t text;
begin
  foreach t in array array['review_log', 'attempts'] loop
    execute format($f$create policy %1$s_select on %1$s for select using (user_id = auth.uid())$f$, t);
    execute format($f$create policy %1$s_insert on %1$s for insert with check (user_id = auth.uid())$f$, t);
  end loop;
end $$;

create policy item_reviews_own on item_reviews for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy item_reviews_admin_read on item_reviews for select using (is_admin());
