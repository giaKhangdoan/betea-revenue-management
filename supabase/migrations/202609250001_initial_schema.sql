create schema if not exists private;

create table if not exists public.owner_profiles (
  singleton boolean primary key not null default true check (singleton),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.owner_profiles enable row level security;
revoke all on public.owner_profiles from anon, authenticated;
grant select on public.owner_profiles to authenticated;
create policy "owner reads own profile"
  on public.owner_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function private.is_store_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.owner_profiles as profile
    where profile.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_store_owner() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_store_owner() to authenticated;

create table if not exists public.daily_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  business_date date not null check (business_date >= date '2026-09-01'),
  business_status text not null default 'open'
    check (business_status in ('open', 'closed', 'no_business')),
  shift_06_10_vnd bigint check (shift_06_10_vnd >= 0),
  shift_10_14_vnd bigint check (shift_10_14_vnd >= 0),
  shift_14_18_vnd bigint check (shift_14_18_vnd >= 0),
  shift_18_22_vnd bigint check (shift_18_22_vnd >= 0),
  grab_vnd bigint check (grab_vnd >= 0),
  shopee_vnd bigint check (shopee_vnd >= 0),
  electricity_morning_kwh numeric(14, 3) check (electricity_morning_kwh >= 0),
  electricity_evening_kwh numeric(14, 3) check (electricity_evening_kwh >= 0),
  cleaning_done boolean,
  arrangement_done boolean,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, business_date),
  unique (owner_id, business_date, id)
);

create table if not exists public.monthly_costs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  month_start date not null check (
    month_start >= date '2026-09-01' and extract(day from month_start) = 1
  ),
  cogs_vnd bigint check (cogs_vnd >= 0),
  rent_vnd bigint not null default 10000000 check (rent_vnd >= 0),
  wages_vnd bigint check (wages_vnd >= 0),
  water_bill_vnd bigint check (water_bill_vnd >= 0),
  electricity_bill_vnd bigint check (electricity_bill_vnd >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, month_start),
  unique (owner_id, month_start, id)
);

create table if not exists public.daily_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  business_date date not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id, business_date)
    references public.daily_records (owner_id, business_date) on delete cascade
);

create table if not exists public.weekly_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  week_start date not null check (
    week_start >= date '2026-08-31' and extract(isodow from week_start) = 1
  ),
  revenue_target_vnd bigint check (revenue_target_vnd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, week_start)
);

create table if not exists public.monthly_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  month_start date not null check (
    month_start >= date '2026-09-01' and extract(day from month_start) = 1
  ),
  revenue_target_vnd bigint check (revenue_target_vnd >= 0),
  profit_target_vnd bigint check (profit_target_vnd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, month_start)
);

create table if not exists public.day_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  business_date date not null,
  shift_code text check (shift_code in ('06-10', '10-14', '14-18', '18-22')),
  category text not null check (category in ('bluebook', 'cleaning', 'arrangement', 'other')),
  object_path text not null unique,
  caption text,
  created_at timestamptz not null default now(),
  foreign key (owner_id, business_date)
    references public.daily_records (owner_id, business_date) on delete cascade
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete restrict,
  actor_id uuid references auth.users (id) on delete restrict,
  actor_type text not null check (actor_type in ('owner', 'system')),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now()
);

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  record_key text;
  row_owner uuid;
begin
  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    row_data := new_row;
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    row_data := new_row;
  else
    old_row := to_jsonb(old);
    row_data := old_row;
  end if;

  row_owner := (row_data ->> 'owner_id')::uuid;
  if row_owner is null or ((select auth.uid()) is not null and row_owner <> (select auth.uid())) then
    raise exception 'Invalid owner for audit event';
  end if;

  record_key := coalesce(row_data ->> 'id', row_data ->> 'business_date', row_data ->> 'month_start', row_data ->> 'week_start');
  if record_key is null then
    raise exception 'Cannot audit row without a record key';
  end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    row_owner, (select auth.uid()), case when (select auth.uid()) is null then 'system' else 'owner' end,
    tg_table_name, record_key, tg_op, old_row, new_row
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'daily_records', 'monthly_costs', 'daily_expenses', 'weekly_targets',
    'monthly_targets', 'day_photos'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
    if table_name in ('daily_expenses', 'day_photos') then
      execute format('grant delete on public.%I to authenticated', table_name);
    end if;
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_store_owner() and owner_id = (select auth.uid()))',
      table_name || ' owner select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.is_store_owner() and owner_id = (select auth.uid()))',
      table_name || ' owner insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.is_store_owner() and owner_id = (select auth.uid())) with check (private.is_store_owner() and owner_id = (select auth.uid()))',
      table_name || ' owner update', table_name
    );
    if table_name in ('daily_expenses', 'day_photos') then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (private.is_store_owner() and owner_id = (select auth.uid()))',
        table_name || ' owner delete', table_name
      );
    end if;
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I for each row execute function private.audit_row_change()',
      table_name
    );
    if table_name <> 'day_photos' then
      execute format(
        'create trigger set_updated_at before update on public.%I for each row execute function private.touch_updated_at()',
        table_name
      );
    end if;
  end loop;
end;
$$;

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
create policy "owner reads own audit history"
  on public.audit_events for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create index if not exists daily_records_owner_date_idx
  on public.daily_records (owner_id, business_date desc);
create index if not exists daily_expenses_owner_date_idx
  on public.daily_expenses (owner_id, business_date desc);
create index if not exists day_photos_owner_date_idx
  on public.day_photos (owner_id, business_date desc);
create index if not exists audit_events_owner_occurred_idx
  on public.audit_events (owner_id, occurred_at desc);

alter table public.day_photos
  add constraint day_photos_object_path_owner_prefix
  check (split_part(object_path, '/', 1) = owner_id::text);
alter table public.day_photos
  add constraint day_photos_object_path_date
  check (split_part(object_path, '/', 2) = business_date::text);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'betea-evidence',
  'betea-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "owner views own evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'betea-evidence'
    and private.is_store_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "owner uploads own evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'betea-evidence'
    and private.is_store_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "owner removes own evidence"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'betea-evidence'
    and private.is_store_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1
      from public.day_photos as photo
      where photo.owner_id = (select auth.uid())
        and photo.object_path = storage.objects.name
    )
  );
