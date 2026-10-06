-- Re-saving an explicitly counted quantity is also a recount confirmation.
-- This refreshes counted_at even when the quantity is unchanged, so a count
-- can be finalized after a later receipt once staff has physically rechecked it.
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
    where count_id = p_count_id and owner_id = v_owner_id and item_id = v_item_id;
  end loop;

  if cardinality(v_seen_ids) > 0 then
    update public.inventory_counts set updated_by = v_actor where id = p_count_id and owner_id = v_owner_id;
  end if;
end;
$$;
revoke all on function public.save_inventory_count_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_inventory_count_draft(uuid, jsonb) to authenticated;
