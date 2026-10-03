create or replace function public.save_inventory_count_draft(p_count_id uuid, p_quantities jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count public.inventory_counts%rowtype;
  v_entry jsonb;
  v_item_id uuid;
  v_seen_ids uuid[] := array[]::uuid[];
  v_line public.inventory_count_items%rowtype;
  v_large_text text;
  v_small_text text;
  v_large numeric;
  v_small numeric;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_quantities is null or jsonb_typeof(p_quantities) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid count values';
  end if;

  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception using errcode = '22023', message = 'Inventory count not found'; end if;
  if private.is_store_owner() and v_count.owner_id = v_actor then
    v_owner_id := v_actor;
  else
    v_owner_id := private.staff_owner_id();
    if v_owner_id is null or v_owner_id <> v_count.owner_id then
      raise exception using errcode = '42501', message = 'Inventory access denied';
    end if;
    if v_count.business_date <> private.current_business_date_vn() then
      raise exception using errcode = '42501', message = 'Staff can edit today''s draft only';
    end if;
  end if;
  if v_count.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Finalized counts cannot be edited';
  end if;
  if jsonb_array_length(p_quantities) > (
    select count(*) from public.inventory_count_items where count_id = p_count_id
  ) then raise exception using errcode = '22023', message = 'Invalid count values'; end if;

  for v_entry in select value from jsonb_array_elements(p_quantities) as entries(value) loop
    if jsonb_typeof(v_entry) is distinct from 'object' or jsonb_typeof(v_entry -> 'item_id') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Invalid count item';
    end if;
    v_item_id := (v_entry ->> 'item_id')::uuid;
    if v_item_id = any(v_seen_ids) then raise exception using errcode = '22023', message = 'Duplicate count item'; end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
    if (v_entry ? 'large_quantity' and jsonb_typeof(v_entry -> 'large_quantity') not in ('string', 'null'))
      or (v_entry ? 'small_quantity' and jsonb_typeof(v_entry -> 'small_quantity') not in ('string', 'null'))
      or not (v_entry ? 'large_quantity' or v_entry ? 'small_quantity') then
      raise exception using errcode = '22023', message = 'Invalid count quantity';
    end if;

    select * into v_line from public.inventory_count_items
    where count_id = p_count_id and owner_id = v_owner_id and item_id = v_item_id for update;
    if not found then raise exception using errcode = '22023', message = 'Item is not part of this count'; end if;

    v_large_text := case when v_entry ? 'large_quantity' then nullif(trim(v_entry ->> 'large_quantity'), '') else null end;
    v_small_text := case when v_entry ? 'small_quantity' then nullif(trim(v_entry ->> 'small_quantity'), '') else null end;
    if v_large_text is not null and v_large_text !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' then
      raise exception using errcode = '22023', message = 'Invalid count quantity';
    end if;
    if v_small_text is not null and v_small_text !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' then
      raise exception using errcode = '22023', message = 'Invalid count quantity';
    end if;

    v_large := case when v_entry ? 'large_quantity' then v_large_text::numeric else v_line.large_quantity end;
    v_small := case when v_entry ? 'small_quantity' then v_small_text::numeric else v_line.small_quantity end;
    if v_large is not null and v_large <> trunc(v_large) then
      raise exception using errcode = '22023', message = 'Package quantities must be whole numbers';
    end if;
    if lower(trim(v_line.small_unit)) not in ('gr', 'ml')
      and v_small is not null and v_small <> trunc(v_small) then
      raise exception using errcode = '22023', message = 'Fractions are allowed only for Gr and Ml';
    end if;

    update public.inventory_count_items set
      large_quantity = v_large,
      small_quantity = v_small,
      counted_at = case when v_large is null and v_small is null then null else clock_timestamp() end,
      updated_by = v_actor
    where count_id = p_count_id and owner_id = v_owner_id and item_id = v_item_id
      and (large_quantity, small_quantity) is distinct from (v_large, v_small);
  end loop;

  if cardinality(v_seen_ids) > 0 then
    update public.inventory_counts set updated_by = v_actor where id = p_count_id and owner_id = v_owner_id;
  end if;
end;
$$;
revoke all on function public.save_inventory_count_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_inventory_count_draft(uuid, jsonb) to authenticated;

create or replace function public.finalize_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count public.inventory_counts%rowtype;
  v_finalized_at timestamptz;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select owner_id into v_owner_id from public.inventory_counts where id = p_count_id;
  if not found then raise exception using errcode = '22023', message = 'Inventory count not found'; end if;
  if not (private.is_store_owner() and v_owner_id = v_actor) then
    if private.staff_owner_id() is distinct from v_owner_id then
      raise exception using errcode = '42501', message = 'Inventory access denied';
    end if;
  end if;

  perform private.lock_inventory_owner(v_owner_id);
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception using errcode = '22023', message = 'Inventory count not found'; end if;
  if v_count.owner_id <> v_owner_id then raise exception using errcode = '42501', message = 'Inventory access denied'; end if;
  if v_count.business_date > private.current_business_date_vn() then
    raise exception using errcode = '22023', message = 'Inventory count date must not be in the future';
  end if;
  if not (private.is_store_owner() and v_owner_id = v_actor)
    and v_count.business_date <> private.current_business_date_vn() then
    raise exception using errcode = '42501', message = 'Staff can finalize today only';
  end if;
  if v_count.status <> 'draft' then raise exception using errcode = '22023', message = 'Inventory count is already finalized'; end if;
  if exists (
    select 1 from public.inventory_count_items
    where count_id = p_count_id and counted_at is null
  ) then
    raise exception using errcode = '22023', message = 'Inventory count has uncounted items';
  end if;
  if exists (
    select 1 from public.inventory_count_items
    where count_id = p_count_id and owner_id = v_owner_id
      and ((large_quantity is not null and large_quantity <> trunc(large_quantity))
        or (lower(trim(small_unit)) not in ('gr', 'ml')
          and small_quantity is not null and small_quantity <> trunc(small_quantity)))
  ) then
    raise exception using errcode = '22023', message = 'Inventory count has fractional package quantities';
  end if;

  v_finalized_at := clock_timestamp();
  if exists (
    select 1
    from public.inventory_receipts as receipt
    join public.inventory_receipt_lines as receipt_line
      on receipt_line.owner_id = receipt.owner_id and receipt_line.receipt_id = receipt.id
    join public.inventory_count_items as count_item
      on count_item.owner_id = receipt_line.owner_id and count_item.item_id = receipt_line.item_id
    where receipt.owner_id = v_owner_id and count_item.count_id = p_count_id
      and receipt.received_at <= v_finalized_at
      and greatest(receipt.received_at, receipt.updated_at) > count_item.counted_at
  ) then
    raise exception using errcode = '22023', message = 'Inventory items must be recounted after the latest receipt';
  end if;

  update public.inventory_counts set
    status = 'finalized', finalized_by = v_actor, finalized_at = v_finalized_at, updated_by = v_actor
  where id = p_count_id;
end;
$$;
revoke all on function public.finalize_inventory_count(uuid) from public, anon, authenticated;
grant execute on function public.finalize_inventory_count(uuid) to authenticated;

create or replace function public.owner_create_inventory_item(
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
  if (p_large_unit is null and p_conversion_factor is not null)
    or (p_large_unit is not null and length(btrim(p_large_unit)) = 0)
    or (p_conversion_factor is not null and (p_conversion_factor <= 0
      or p_conversion_factor > 99999999999.999
      or p_conversion_factor <> round(p_conversion_factor, 3)
      or (lower(btrim(p_small_unit)) not in ('gr', 'ml') and p_conversion_factor <> trunc(p_conversion_factor))))
    or (p_count_large_unit_only and (p_large_unit is null or p_conversion_factor is null))
    or (p_large_unit is not null and lower(btrim(p_large_unit)) = lower(btrim(p_small_unit)))
    or p_count_large_unit_only is null then
    raise exception using errcode = '22023', message = 'Invalid inventory item';
  end if;

  perform private.lock_inventory_owner(v_actor);
  insert into public.inventory_items (
    owner_id, name, category, large_unit, conversion_factor, small_unit, count_large_unit_only
  ) values (
    v_actor, btrim(p_name), btrim(p_category), p_large_unit, p_conversion_factor,
    btrim(p_small_unit), p_count_large_unit_only
  ) returning id into v_item_id;
  return v_item_id;
end;
$$;
revoke all on function public.owner_create_inventory_item(text, text, text, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.owner_create_inventory_item(text, text, text, numeric, text, boolean) to authenticated;

create or replace function public.owner_update_inventory_item(
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
  if (p_large_unit is null and p_conversion_factor is not null)
    or (p_large_unit is not null and length(btrim(p_large_unit)) = 0)
    or (p_conversion_factor is not null and (p_conversion_factor <= 0
      or p_conversion_factor > 99999999999.999
      or p_conversion_factor <> round(p_conversion_factor, 3)
      or (lower(btrim(p_small_unit)) not in ('gr', 'ml') and p_conversion_factor <> trunc(p_conversion_factor))))
    or (p_count_large_unit_only and (p_large_unit is null or p_conversion_factor is null))
    or (p_large_unit is not null and lower(btrim(p_large_unit)) = lower(btrim(p_small_unit)))
    or p_count_large_unit_only is null then
    raise exception using errcode = '22023', message = 'Invalid inventory item';
  end if;

  perform private.lock_inventory_owner(v_actor);
  update public.inventory_items
  set name = btrim(p_name),
    category = btrim(p_category),
    large_unit = p_large_unit,
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
