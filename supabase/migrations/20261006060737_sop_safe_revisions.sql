-- Owner-edited SOP content is versioned separately from cost data. Staff can
-- read only a sanitized current publication, never the draft or its history.
create table public.owner_sop_workspace (
  owner_id uuid primary key references public.owner_profiles (user_id) on delete cascade,
  revision integer not null check (revision > 0),
  recipe_revision integer not null check (recipe_revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.owner_profiles (user_id) on delete restrict,
  check (jsonb_typeof(document -> 'products') is not distinct from 'array')
);

create table public.owner_sop_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  revision integer not null check (revision > 0),
  recipe_revision integer not null check (recipe_revision >= 0),
  captured_at timestamptz not null default clock_timestamp(),
  captured_by uuid not null references public.owner_profiles (user_id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  unique (owner_id, revision),
  check (jsonb_typeof(document -> 'products') is not distinct from 'array')
);

create index owner_sop_snapshots_history_idx on public.owner_sop_snapshots (owner_id, revision desc);

create table public.staff_sop_publications (
  owner_id uuid primary key references public.owner_profiles (user_id) on delete cascade,
  revision integer not null check (revision > 0),
  recipe_revision integer not null check (recipe_revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  published_at timestamptz not null default clock_timestamp(),
  published_by uuid not null references public.owner_profiles (user_id) on delete restrict,
  check (jsonb_typeof(document -> 'products') is not distinct from 'array')
);

alter table public.owner_sop_workspace enable row level security;
alter table public.owner_sop_snapshots enable row level security;
alter table public.staff_sop_publications enable row level security;

revoke all on public.owner_sop_workspace, public.owner_sop_snapshots, public.staff_sop_publications from public, anon, authenticated;
grant select on public.owner_sop_workspace, public.owner_sop_snapshots, public.staff_sop_publications to authenticated;

create policy "owner reads SOP draft"
  on public.owner_sop_workspace for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create policy "owner reads SOP history"
  on public.owner_sop_snapshots for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create policy "owner and active staff read published SOP"
  on public.staff_sop_publications for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or private.is_active_store_member(owner_id)
  );

create function private.allowlisted_staff_sop(p_document jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'products', coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'name', product.item -> 'name',
        'variants', (
          select coalesce(jsonb_agg(
            jsonb_strip_nulls(jsonb_build_object(
              'size', variant.item -> 'size',
              'sizeOz', variant.item -> 'sizeOz',
              'components', (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'name', component.item -> 'name',
                  'quantity', component.item -> 'quantity',
                  'unit', component.item -> 'unit'
                ) order by component.position), '[]'::jsonb)
                from jsonb_array_elements(variant.item -> 'components') with ordinality as component(item, position)
              ),
              'steps', (
                select coalesce(jsonb_agg(jsonb_build_object(
                  'title', step.item -> 'title',
                  'instruction', step.item -> 'instruction'
                ) order by step.position), '[]'::jsonb)
                from jsonb_array_elements(variant.item -> 'steps') with ordinality as step(item, position)
              ),
              'notes', variant.item -> 'notes'
            )) order by variant.position
          ), '[]'::jsonb)
          from jsonb_array_elements(product.item -> 'variants') with ordinality as variant(item, position)
        )
      ))
    order by product.position
    ), '[]'::jsonb)
  )
  from jsonb_array_elements(p_document -> 'products') with ordinality as product(item, position);
$$;
revoke all on function private.allowlisted_staff_sop(jsonb) from public, anon, authenticated;

create function private.owner_save_sop_workspace_impl(
  p_expected_revision integer,
  p_expected_recipe_revision integer,
  p_document jsonb,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_recipe_revision integer;
  v_current_revision integer;
  v_next_revision integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or p_expected_recipe_revision is null or p_expected_recipe_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected revisions must be zero or greater';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'A change reason between 1 and 500 characters is required';
  end if;
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or jsonb_typeof(p_document -> 'products') is distinct from 'array'
    or pg_column_size(p_document) > 5000000 then
    raise exception using errcode = '22023', message = 'SOP draft has an invalid shape or exceeds the 5 MB limit';
  end if;

  -- Match the recipe-save lock order so a draft cannot be bound to a moving revision.
  perform 1 from public.owner_profiles where user_id = v_actor for update;
  select revision into v_recipe_revision from public.recipe_cost_workspace where owner_id = v_actor for update;
  if not found then v_recipe_revision := 0; end if;
  if p_expected_recipe_revision <> v_recipe_revision then
    raise exception using errcode = '40001', message = 'Recipe workspace changed; reload before saving SOP';
  end if;

  select revision into v_current_revision from public.owner_sop_workspace where owner_id = v_actor for update;
  if not found then v_current_revision := 0; end if;
  if p_expected_revision <> v_current_revision then
    raise exception using errcode = '40001', message = 'SOP draft changed; reload before saving';
  end if;
  v_next_revision := v_current_revision + 1;

  insert into public.owner_sop_workspace (owner_id, revision, recipe_revision, document, updated_at, updated_by)
  values (v_actor, v_next_revision, v_recipe_revision, p_document, v_now, v_actor)
  on conflict (owner_id) do update set
    revision = excluded.revision,
    recipe_revision = excluded.recipe_revision,
    document = excluded.document,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.owner_sop_snapshots (owner_id, revision, recipe_revision, captured_at, captured_by, reason, document)
  values (v_actor, v_next_revision, v_recipe_revision, v_now, v_actor, btrim(p_reason), p_document);
  return v_next_revision;
end;
$$;

create function private.owner_publish_staff_sop_impl(
  p_expected_revision integer,
  p_expected_recipe_revision integer,
  p_staff_document jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_recipe_revision integer;
  v_sop_revision integer;
  v_sop_recipe_revision integer;
  v_publication_revision integer;
  v_next_revision integer;
  v_product jsonb;
  v_variant jsonb;
  v_component jsonb;
  v_step jsonb;
  v_safe_document jsonb;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if p_expected_revision is null or p_expected_revision < 1
    or p_expected_recipe_revision is null or p_expected_recipe_revision < 0 then
    raise exception using errcode = '22023', message = 'Expected revisions are invalid';
  end if;
  if p_staff_document is null or jsonb_typeof(p_staff_document) is distinct from 'object'
    or jsonb_typeof(p_staff_document -> 'products') is distinct from 'array'
    or pg_column_size(p_staff_document) > 1000000 then
    raise exception using errcode = '22023', message = 'Published SOP has an invalid shape or exceeds the 1 MB limit';
  end if;
  if jsonb_array_length(p_staff_document -> 'products') not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Published SOP must include one to 1000 products';
  end if;

  perform 1 from public.owner_profiles where user_id = v_actor for update;
  select revision into v_recipe_revision from public.recipe_cost_workspace where owner_id = v_actor for update;
  if not found then v_recipe_revision := 0; end if;
  select revision, recipe_revision into v_sop_revision, v_sop_recipe_revision
  from public.owner_sop_workspace where owner_id = v_actor for update;
  if not found then
    raise exception using errcode = '22023', message = 'Save an SOP draft before publishing';
  end if;
  if v_sop_revision <> p_expected_revision or v_recipe_revision <> p_expected_recipe_revision
    or v_sop_recipe_revision <> v_recipe_revision then
    raise exception using errcode = '40001', message = 'SOP or recipe revision changed; reload and review before publishing';
  end if;

  for v_product in select value from jsonb_array_elements(p_staff_document -> 'products') as item(value) loop
    if jsonb_typeof(v_product) is distinct from 'object'
      or jsonb_typeof(v_product -> 'name') is distinct from 'string'
      or length(btrim(v_product ->> 'name')) not between 1 and 240
      or jsonb_typeof(v_product -> 'variants') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Published SOP product is invalid';
    end if;
    if jsonb_array_length(v_product -> 'variants') not between 1 and 3 then
      raise exception using errcode = '22023', message = 'Published SOP product must include one to three sizes';
    end if;
    for v_variant in select value from jsonb_array_elements(v_product -> 'variants') as item(value) loop
      if jsonb_typeof(v_variant) is distinct from 'object'
        or jsonb_typeof(v_variant -> 'size') is distinct from 'string'
        or v_variant ->> 'size' not in ('S', 'M', 'L')
        or jsonb_typeof(v_variant -> 'sizeOz') is distinct from 'number'
        or v_variant ->> 'sizeOz' not in ('12', '17', '22')
        or jsonb_typeof(v_variant -> 'components') is distinct from 'array'
        or jsonb_typeof(v_variant -> 'steps') is distinct from 'array'
        or (v_variant ? 'notes' and (jsonb_typeof(v_variant -> 'notes') is distinct from 'string' or length(v_variant ->> 'notes') > 1200)) then
        raise exception using errcode = '22023', message = 'Published SOP size is invalid';
      end if;
      if (v_variant ->> 'size' = 'S' and v_variant ->> 'sizeOz' <> '12')
        or (v_variant ->> 'size' = 'M' and v_variant ->> 'sizeOz' <> '17')
        or (v_variant ->> 'size' = 'L' and v_variant ->> 'sizeOz' <> '22') then
        raise exception using errcode = '22023', message = 'Published SOP size and ounce value do not match';
      end if;
      if jsonb_array_length(v_variant -> 'components') not between 1 and 200
        or jsonb_array_length(v_variant -> 'steps') not between 1 and 40 then
        raise exception using errcode = '22023', message = 'Published SOP size has too many ingredients or invalid steps';
      end if;
      for v_component in select value from jsonb_array_elements(v_variant -> 'components') as item(value) loop
        if jsonb_typeof(v_component) is distinct from 'object'
          or jsonb_typeof(v_component -> 'name') is distinct from 'string'
          or length(btrim(v_component ->> 'name')) not between 1 and 240
          or jsonb_typeof(v_component -> 'quantity') is distinct from 'string'
          or length(btrim(v_component ->> 'quantity')) not between 1 and 32
          or jsonb_typeof(v_component -> 'unit') is distinct from 'string'
          or length(btrim(v_component ->> 'unit')) not between 1 and 80 then
          raise exception using errcode = '22023', message = 'Published SOP quantity is invalid';
        end if;
      end loop;
      for v_step in select value from jsonb_array_elements(v_variant -> 'steps') as item(value) loop
        if jsonb_typeof(v_step) is distinct from 'object'
          or jsonb_typeof(v_step -> 'title') is distinct from 'string'
          or length(btrim(v_step ->> 'title')) not between 1 and 120
          or jsonb_typeof(v_step -> 'instruction') is distinct from 'string'
          or length(btrim(v_step ->> 'instruction')) not between 1 and 1200 then
          raise exception using errcode = '22023', message = 'Published SOP step is incomplete';
        end if;
      end loop;
    end loop;
  end loop;

  v_safe_document := private.allowlisted_staff_sop(p_staff_document);
  select revision into v_publication_revision from public.staff_sop_publications where owner_id = v_actor for update;
  if not found then v_publication_revision := 0; end if;
  v_next_revision := v_publication_revision + 1;
  insert into public.staff_sop_publications (owner_id, revision, recipe_revision, document, published_at, published_by)
  values (v_actor, v_next_revision, v_recipe_revision, v_safe_document, clock_timestamp(), v_actor)
  on conflict (owner_id) do update set
    revision = excluded.revision,
    recipe_revision = excluded.recipe_revision,
    document = excluded.document,
    published_at = excluded.published_at,
    published_by = excluded.published_by;
  return v_next_revision;
end;
$$;

revoke all on function private.owner_save_sop_workspace_impl(integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function private.owner_save_sop_workspace_impl(integer, integer, jsonb, text) to authenticated;
revoke all on function private.owner_publish_staff_sop_impl(integer, integer, jsonb) from public, anon, authenticated;
grant execute on function private.owner_publish_staff_sop_impl(integer, integer, jsonb) to authenticated;

-- PostgREST calls the public entry points as the authenticated invoker. Only
-- the private helpers are SECURITY DEFINER, and both re-check the store owner.
create function public.owner_save_sop_workspace(
  p_expected_revision integer,
  p_expected_recipe_revision integer,
  p_document jsonb,
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.owner_save_sop_workspace_impl($1, $2, $3, $4);
$$;

create function public.owner_publish_staff_sop(
  p_expected_revision integer,
  p_expected_recipe_revision integer,
  p_staff_document jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.owner_publish_staff_sop_impl($1, $2, $3);
$$;

revoke all on function public.owner_save_sop_workspace(integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_save_sop_workspace(integer, integer, jsonb, text) to authenticated;
revoke all on function public.owner_publish_staff_sop(integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.owner_publish_staff_sop(integer, integer, jsonb) to authenticated;
