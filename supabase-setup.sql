create table if not exists public.weight_journal_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_weight_journal_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists weight_journal_snapshots_set_updated_at on public.weight_journal_snapshots;

create trigger weight_journal_snapshots_set_updated_at
before update on public.weight_journal_snapshots
for each row
execute function public.set_weight_journal_updated_at();

alter table public.weight_journal_snapshots enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.weight_journal_snapshots to authenticated;

drop policy if exists "select own weight journal snapshot" on public.weight_journal_snapshots;
create policy "select own weight journal snapshot"
on public.weight_journal_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "insert own weight journal snapshot" on public.weight_journal_snapshots;
create policy "insert own weight journal snapshot"
on public.weight_journal_snapshots
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "update own weight journal snapshot" on public.weight_journal_snapshots;
create policy "update own weight journal snapshot"
on public.weight_journal_snapshots
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "delete own weight journal snapshot" on public.weight_journal_snapshots;
create policy "delete own weight journal snapshot"
on public.weight_journal_snapshots
for delete
to authenticated
using ((select auth.uid()) = user_id);
