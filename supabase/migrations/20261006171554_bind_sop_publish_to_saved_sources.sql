-- Derive the staff projection from the locked owner draft and recipe. An
-- authenticated owner must not be able to publish different safe-shaped
-- values through the Data API than the owner workspace shows.
create function private.build_staff_sop_document(
  p_sop_document jsonb,
  p_recipe_document jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', recipe_product.value -> 'name',
          'variants', coalesce((
            select jsonb_agg(
              jsonb_strip_nulls(jsonb_build_object(
                'size', sop_variant.value -> 'size',
                'sizeOz', case sop_variant.value ->> 'size'
                  when 'S' then 12
                  when 'M' then 17
                  when 'L' then 22
                end,
                'components', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'name', coalesce(ingredient.name, batch.name),
                      'quantity', recipe_component.value -> 'quantity',
                      'unit', recipe_component.value -> 'unit'
                    ) order by recipe_component.position
                  )
                  from jsonb_array_elements(recipe_variant.value -> 'components')
                    with ordinality as recipe_component(value, position)
                  left join lateral (
                    select candidate.value -> 'name' as name
                    from jsonb_array_elements(coalesce(p_recipe_document -> 'ingredients', '[]'::jsonb)) as candidate(value)
                    where candidate.value ->> 'id' = recipe_component.value ->> 'ingredientId'
                    limit 1
                  ) as ingredient on true
                  left join lateral (
                    select candidate.value -> 'name' as name
                    from jsonb_array_elements(coalesce(p_recipe_document -> 'batches', '[]'::jsonb)) as candidate(value)
                    where candidate.value ->> 'id' = recipe_component.value ->> 'batchId'
                    limit 1
                  ) as batch on true
                ), '[]'::jsonb),
                'steps', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'title', btrim(step.value ->> 'title'),
                      'instruction', btrim(step.value ->> 'instruction')
                    ) order by step.position
                  )
                  from jsonb_array_elements(sop_variant.value -> 'steps')
                    with ordinality as step(value, position)
                ), '[]'::jsonb),
                'notes', nullif(btrim(sop_variant.value ->> 'notes'), '')
              )) order by sop_variant.position
            )
            from jsonb_array_elements(sop_product.value -> 'variants')
              with ordinality as sop_variant(value, position)
            left join lateral (
              select candidate.value
              from jsonb_array_elements(coalesce(recipe_product.value -> 'variants', '[]'::jsonb)) as candidate(value)
              where candidate.value ->> 'size' = sop_variant.value ->> 'size'
              limit 1
            ) as recipe_variant on true
          ), '[]'::jsonb)
        ) order by sop_product.position
      )
      from jsonb_array_elements(p_sop_document -> 'products')
        with ordinality as sop_product(value, position)
      left join lateral (
        select candidate.value
        from jsonb_array_elements(coalesce(p_recipe_document -> 'products', '[]'::jsonb)) as candidate(value)
        where candidate.value ->> 'id' = sop_product.value ->> 'productId'
        limit 1
      ) as recipe_product on true
    ), '[]'::jsonb)
  );
$$;
revoke all on function private.build_staff_sop_document(jsonb, jsonb) from public, anon, authenticated;

create or replace function private.owner_publish_staff_sop_impl(
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
  v_recipe_document jsonb;
  v_sop_revision integer;
  v_sop_recipe_revision integer;
  v_sop_document jsonb;
  v_publication_revision integer;
  v_next_revision integer;
  v_product jsonb;
  v_variant jsonb;
  v_component jsonb;
  v_step jsonb;
  v_safe_document jsonb;
  v_expected_document jsonb;
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
  select revision, document into v_recipe_revision, v_recipe_document
  from public.recipe_cost_workspace where owner_id = v_actor for update;
  if not found then
    v_recipe_revision := 0;
    v_recipe_document := null;
  end if;
  select revision, recipe_revision, document into v_sop_revision, v_sop_recipe_revision, v_sop_document
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
  v_expected_document := private.build_staff_sop_document(v_sop_document, v_recipe_document);
  if v_safe_document is distinct from v_expected_document then
    raise exception using errcode = '22023', message = 'Published SOP must match the saved SOP draft and recipe';
  end if;

  select revision into v_publication_revision from public.staff_sop_publications where owner_id = v_actor for update;
  if not found then v_publication_revision := 0; end if;
  v_next_revision := v_publication_revision + 1;
  insert into public.staff_sop_publications (owner_id, revision, recipe_revision, document, published_at, published_by)
  values (v_actor, v_next_revision, v_recipe_revision, v_expected_document, clock_timestamp(), v_actor)
  on conflict (owner_id) do update set
    revision = excluded.revision,
    recipe_revision = excluded.recipe_revision,
    document = excluded.document,
    published_at = excluded.published_at,
    published_by = excluded.published_by;
  return v_next_revision;
end;
$$;
