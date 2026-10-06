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
  v_status text;
  v_added_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if private.is_store_owner() then
    v_owner_id := v_actor;
  else
    v_owner_id := private.staff_owner_id();
    if v_owner_id is null then
      raise exception using errcode = '42501', message = 'Active store membership required';
    end if;
    if p_business_date <> private.current_business_date_vn() then
      raise exception using errcode = '42501', message = 'Staff can open today only';
    end if;
  end if;

  if p_business_date is null or p_business_date > private.current_business_date_vn() then
    raise exception using errcode = '22023', message = 'Inventory count date must not be in the future';
  end if;

  perform private.lock_inventory_owner(v_owner_id);

  insert into public.inventory_counts (owner_id, business_date, created_by, updated_by)
  values (v_owner_id, p_business_date, v_actor, v_actor)
  on conflict (owner_id, business_date) do nothing
  returning id into v_count_id;

  v_created := v_count_id is not null;
  if v_created then
    v_status := 'draft';
  else
    select id, status into v_count_id, v_status
    from public.inventory_counts
    where owner_id = v_owner_id and business_date = p_business_date
    for update;
  end if;

  -- Preserve finalized and historical drafts. A current-day draft can pick up
  -- active catalog items added after the draft was first opened.
  if v_created or (v_status = 'draft' and p_business_date = private.current_business_date_vn()) then
    insert into public.inventory_count_items (
      owner_id, count_id, item_id, item_name, category, large_unit, conversion_factor,
      small_unit, count_large_unit_only, sort_order
    )
    select v_owner_id, v_count_id, item.id, item.name, item.category,
      item.large_unit, item.conversion_factor, item.small_unit, item.count_large_unit_only, item.sort_order
    from public.inventory_items as item
    where item.owner_id = v_owner_id and item.active
    on conflict (count_id, item_id) do nothing;

    get diagnostics v_added_count = row_count;
    if v_added_count > 0 and not v_created then
      update public.inventory_counts
      set updated_by = v_actor
      where id = v_count_id and owner_id = v_owner_id and status = 'draft';
    end if;
  end if;

  return v_count_id;
end;
$$;

revoke all on function public.open_inventory_count(date) from public, anon, authenticated;
grant execute on function public.open_inventory_count(date) to authenticated;
