-- Keep the owner day view event-driven instead of refreshing every second.
-- The fallback metadata poll in the client still works if Realtime is unavailable.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'day_photos'
  ) then
    alter publication supabase_realtime add table public.day_photos;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daily_records'
  ) then
    alter publication supabase_realtime add table public.daily_records;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daily_expenses'
  ) then
    alter publication supabase_realtime add table public.daily_expenses;
  end if;
end $$;

-- DELETE events need the old row so the client can keep the date/owner filter.
alter table public.day_photos replica identity full;
alter table public.daily_records replica identity full;
alter table public.daily_expenses replica identity full;
