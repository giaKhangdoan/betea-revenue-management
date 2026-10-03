alter table public.inventory_items
  add column count_large_unit_only boolean not null default false;

update public.inventory_items
set count_large_unit_only = true
where conversion_factor = 1 and lower(btrim(large_unit)) = lower(btrim(small_unit));

drop policy "active store members read inventory catalog" on public.inventory_items;
create policy "owners read catalog and staff read active items"
  on public.inventory_items for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (active and private.is_active_store_member(owner_id))
  );

alter table public.inventory_count_items
  add column count_large_unit_only boolean not null default false,
  add constraint inventory_count_items_large_only_small_empty
    check (not count_large_unit_only or small_quantity is null),
  add constraint inventory_count_items_large_only_integral
    check (not count_large_unit_only or large_quantity is null or large_quantity = trunc(large_quantity));

create or replace function private.seed_inventory_catalog_after_owner_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_inventory_catalog_for_owner(new.user_id);
  update public.inventory_items
  set count_large_unit_only = true
  where owner_id = new.user_id and source_code is not null
    and conversion_factor = 1 and lower(btrim(large_unit)) = lower(btrim(small_unit));
  return new;
end;
$$;

drop function public.owner_create_inventory_item(text, text, text, numeric, text);
create function public.owner_create_inventory_item(
  p_name text,
  p_category text,
  p_large_unit text,
  p_conversion_factor numeric,
  p_small_unit text,
  p_count_large_unit_only boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item_id uuid;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if p_conversion_factor is null or p_conversion_factor <= 0
    or p_conversion_factor > 99999999999.999
    or p_conversion_factor <> round(p_conversion_factor, 3)
    or p_count_large_unit_only is null then
    raise exception using errcode = '22023', message = 'Invalid inventory item';
  end if;

  perform private.lock_inventory_owner(v_actor);
  insert into public.inventory_items (
    owner_id, name, category, large_unit, conversion_factor, small_unit, count_large_unit_only
  ) values (
    v_actor, btrim(p_name), btrim(p_category), btrim(p_large_unit), p_conversion_factor,
    btrim(p_small_unit), p_count_large_unit_only
  ) returning id into v_item_id;
  return v_item_id;
end;
$$;
revoke all on function public.owner_create_inventory_item(text, text, text, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.owner_create_inventory_item(text, text, text, numeric, text, boolean) to authenticated;

drop function public.owner_update_inventory_item(uuid, text, text, text, numeric, text);
create function public.owner_update_inventory_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_large_unit text,
  p_conversion_factor numeric,
  p_small_unit text,
  p_count_large_unit_only boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;
  if p_conversion_factor is null or p_conversion_factor <= 0
    or p_conversion_factor > 99999999999.999
    or p_conversion_factor <> round(p_conversion_factor, 3)
    or p_count_large_unit_only is null then
    raise exception using errcode = '22023', message = 'Invalid inventory item';
  end if;

  perform private.lock_inventory_owner(v_actor);
  update public.inventory_items
  set name = btrim(p_name),
    category = btrim(p_category),
    large_unit = btrim(p_large_unit),
    conversion_factor = p_conversion_factor,
    small_unit = btrim(p_small_unit),
    count_large_unit_only = p_count_large_unit_only,
    updated_at = clock_timestamp()
  where id = p_item_id and owner_id = v_actor;
  if not found then raise exception using errcode = '22023', message = 'Inventory item not found'; end if;
end;
$$;
revoke all on function public.owner_update_inventory_item(uuid, text, text, text, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.owner_update_inventory_item(uuid, text, text, text, numeric, text, boolean) to authenticated;

create function public.owner_reactivate_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Owner access required';
  end if;

  perform private.lock_inventory_owner(v_actor);
  update public.inventory_items
  set active = true, updated_at = clock_timestamp()
  where id = p_item_id and owner_id = v_actor;
  if not found then raise exception using errcode = '22023', message = 'Inventory item not found'; end if;
end;
$$;
revoke all on function public.owner_reactivate_inventory_item(uuid) from public, anon, authenticated;
grant execute on function public.owner_reactivate_inventory_item(uuid) to authenticated;

create or replace function public.open_inventory_count(p_business_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count_id uuid;
  v_created boolean := false;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if private.is_store_owner() then
    v_owner_id := v_actor;
  else
    v_owner_id := private.staff_owner_id();
    if v_owner_id is null then raise exception 'Active store membership required'; end if;
    if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can open today only'; end if;
  end if;
  if p_business_date is null or p_business_date > private.current_business_date_vn() then
    raise exception 'Inventory count date must not be in the future';
  end if;

  insert into public.inventory_counts (owner_id, business_date, created_by, updated_by)
  values (v_owner_id, p_business_date, v_actor, v_actor)
  on conflict (owner_id, business_date) do nothing
  returning id into v_count_id;

  v_created := v_count_id is not null;
  if not v_created then
    select id into v_count_id from public.inventory_counts
    where owner_id = v_owner_id and business_date = p_business_date;
  else
    insert into public.inventory_count_items (
      owner_id, count_id, item_id, item_name, category, large_unit, conversion_factor,
      small_unit, count_large_unit_only
    )
    select v_owner_id, v_count_id, item.id, item.name, item.category,
      item.large_unit, item.conversion_factor, item.small_unit, item.count_large_unit_only
    from public.inventory_items as item
    where item.owner_id = v_owner_id and item.active;
  end if;

  return v_count_id;
end;
$$;
