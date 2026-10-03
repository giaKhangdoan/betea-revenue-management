alter table public.inventory_items
  add constraint inventory_items_name_valid check (length(btrim(name)) between 1 and 120),
  add constraint inventory_items_category_valid check (length(btrim(category)) between 1 and 120),
  add constraint inventory_items_large_unit_valid check (length(btrim(large_unit)) between 1 and 120),
  add constraint inventory_items_small_unit_valid check (length(btrim(small_unit)) between 1 and 120);

create function private.serialize_inventory_count_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_inventory_owner(new.owner_id);
  return new;
end;
$$;
revoke all on function private.serialize_inventory_count_insert() from public, anon, authenticated;
create trigger serialize_inventory_count_insert
  before insert on public.inventory_counts
  for each row execute function private.serialize_inventory_count_insert();

create function public.owner_create_inventory_item(
  p_name text,
  p_category text,
  p_large_unit text,
  p_conversion_factor numeric,
  p_small_unit text
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
    or p_conversion_factor <> round(p_conversion_factor, 3) then
    raise exception using errcode = '22023', message = 'Invalid conversion factor';
  end if;

  perform private.lock_inventory_owner(v_actor);
  insert into public.inventory_items (
    owner_id, name, category, large_unit, conversion_factor, small_unit
  ) values (
    v_actor, btrim(p_name), btrim(p_category), btrim(p_large_unit), p_conversion_factor, btrim(p_small_unit)
  ) returning id into v_item_id;
  return v_item_id;
end;
$$;
revoke all on function public.owner_create_inventory_item(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.owner_create_inventory_item(text, text, text, numeric, text) to authenticated;

create function public.owner_update_inventory_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_large_unit text,
  p_conversion_factor numeric,
  p_small_unit text
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
    or p_conversion_factor <> round(p_conversion_factor, 3) then
    raise exception using errcode = '22023', message = 'Invalid conversion factor';
  end if;

  perform private.lock_inventory_owner(v_actor);
  update public.inventory_items
  set name = btrim(p_name),
    category = btrim(p_category),
    large_unit = btrim(p_large_unit),
    conversion_factor = p_conversion_factor,
    small_unit = btrim(p_small_unit),
    updated_at = clock_timestamp()
  where id = p_item_id and owner_id = v_actor;
  if not found then raise exception using errcode = '22023', message = 'Inventory item not found'; end if;
end;
$$;
revoke all on function public.owner_update_inventory_item(uuid, text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.owner_update_inventory_item(uuid, text, text, text, numeric, text) to authenticated;

create function public.owner_deactivate_inventory_item(p_item_id uuid)
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
  set active = false, updated_at = clock_timestamp()
  where id = p_item_id and owner_id = v_actor;
  if not found then raise exception using errcode = '22023', message = 'Inventory item not found'; end if;
end;
$$;
revoke all on function public.owner_deactivate_inventory_item(uuid) from public, anon, authenticated;
grant execute on function public.owner_deactivate_inventory_item(uuid) to authenticated;
