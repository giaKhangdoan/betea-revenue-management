-- The recipe graph is intentionally separate from inventory and monthly POS COGS.
-- It is stored as one versioned document so an owner save and its cost snapshot
-- commit atomically, while the pure server-side calculator validates references.
create table public.recipe_cost_workspace (
  owner_id uuid primary key references public.owner_profiles (user_id) on delete cascade,
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.owner_profiles (user_id) on delete restrict,
  check (jsonb_typeof(document -> 'ingredients') is not distinct from 'array'),
  check (jsonb_typeof(document -> 'batches') is not distinct from 'array'),
  check (jsonb_typeof(document -> 'products') is not distinct from 'array'),
  check (jsonb_typeof(document -> 'unitConversions') is not distinct from 'array'),
  check (jsonb_typeof(calculation -> 'ingredients') is not distinct from 'object'),
  check (jsonb_typeof(calculation -> 'batches') is not distinct from 'object'),
  check (jsonb_typeof(calculation -> 'products') is not distinct from 'object'),
  check (calculation -> 'calculationVersion' is not distinct from '1'::jsonb)
);

create table public.recipe_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  revision integer not null check (revision > 0),
  captured_at timestamptz not null default clock_timestamp(),
  captured_by uuid not null references public.owner_profiles (user_id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  unique (owner_id, revision)
);

create index recipe_cost_snapshots_owner_history_idx
  on public.recipe_cost_snapshots (owner_id, revision desc);

alter table public.recipe_cost_workspace enable row level security;
alter table public.recipe_cost_snapshots enable row level security;

revoke all on public.recipe_cost_workspace from public, anon, authenticated;
revoke all on public.recipe_cost_snapshots from public, anon, authenticated;
grant select on public.recipe_cost_workspace to authenticated;
grant select on public.recipe_cost_snapshots to authenticated;

create policy "owner reads recipe cost workspace"
  on public.recipe_cost_workspace for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create policy "owner reads recipe cost history"
  on public.recipe_cost_snapshots for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create function public.owner_save_recipe_cost_workspace(
  p_expected_revision integer,
  p_document jsonb,
  p_calculation jsonb,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_revision integer;
  v_next_revision integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected revision must be zero or greater';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'A change reason between 1 and 500 characters is required';
  end if;
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or jsonb_typeof(p_document -> 'ingredients') is distinct from 'array'
    or jsonb_typeof(p_document -> 'batches') is distinct from 'array'
    or jsonb_typeof(p_document -> 'products') is distinct from 'array'
    or jsonb_typeof(p_document -> 'unitConversions') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Recipe document has an invalid shape';
  end if;
  if p_calculation is null or jsonb_typeof(p_calculation) is distinct from 'object'
    or p_calculation -> 'calculationVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_calculation -> 'ingredients') is distinct from 'object'
    or jsonb_typeof(p_calculation -> 'batches') is distinct from 'object'
    or jsonb_typeof(p_calculation -> 'products') is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Recipe calculation has an invalid shape';
  end if;
  if pg_column_size(p_document) + pg_column_size(p_calculation) > 5000000 then
    raise exception using errcode = '22023', message = 'Recipe workspace exceeds the 5 MB limit';
  end if;

  -- Lock the singleton owner profile to serialize first saves as well as updates.
  perform 1 from public.owner_profiles where user_id = v_actor for update;
  select revision into v_current_revision
  from public.recipe_cost_workspace
  where owner_id = v_actor
  for update;
  if not found then v_current_revision := 0; end if;

  if p_expected_revision <> v_current_revision then
    raise exception using errcode = '40001', message = 'Recipe workspace changed; reload before saving';
  end if;
  v_next_revision := v_current_revision + 1;

  insert into public.recipe_cost_workspace (
    owner_id, revision, document, calculation, updated_at, updated_by
  ) values (
    v_actor, v_next_revision, p_document, p_calculation, v_now, v_actor
  )
  on conflict (owner_id) do update set
    revision = excluded.revision,
    document = excluded.document,
    calculation = excluded.calculation,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.recipe_cost_snapshots (
    owner_id, revision, captured_at, captured_by, reason, document, calculation
  ) values (
    v_actor, v_next_revision, v_now, v_actor, btrim(p_reason), p_document, p_calculation
  );

  return v_next_revision;
end;
$$;

revoke all on function public.owner_save_recipe_cost_workspace(integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_save_recipe_cost_workspace(integer, jsonb, jsonb, text) to authenticated;
