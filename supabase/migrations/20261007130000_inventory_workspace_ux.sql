alter table public.inventory_items
  add column if not exists conversion_verified_at timestamptz,
  add column if not exists conversion_verified_by uuid references auth.users (id) on delete set null;

create index if not exists inventory_receipt_lines_owner_item_idx
  on public.inventory_receipt_lines (owner_id, item_id, receipt_id);

create index if not exists inventory_receipt_versions_owner_event_idx
  on public.inventory_receipt_versions (owner_id, effective_at desc, sequence_no desc);

create index if not exists inventory_count_versions_owner_event_idx
  on public.inventory_count_versions (owner_id, effective_at desc, sequence_no desc);

create index if not exists inventory_receipts_owner_received_export_idx
  on public.inventory_receipts (owner_id, received_at, id);

create index if not exists inventory_receipts_owner_updated_export_idx
  on public.inventory_receipts (owner_id, updated_at, id);

create index if not exists inventory_receipt_versions_owner_export_event_idx
  on public.inventory_receipt_versions (owner_id, effective_at, receipt_id, sequence_no);

create index if not exists inventory_counts_owner_finalized_export_idx
  on public.inventory_counts (owner_id, finalized_at, id)
  where status = 'finalized' and finalized_at is not null;

create index if not exists inventory_count_corrections_owner_page_idx
  on public.inventory_count_corrections (owner_id, count_id, corrected_at desc, id desc);

create or replace function private.reset_inventory_item_conversion_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.large_unit, new.conversion_factor, new.small_unit)
      is distinct from (old.large_unit, old.conversion_factor, old.small_unit) then
    new.conversion_verified_at := null;
    new.conversion_verified_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_inventory_item_conversion_verification() from public, anon, authenticated;

drop trigger if exists reset_inventory_item_conversion_verification on public.inventory_items;
create trigger reset_inventory_item_conversion_verification
before update of large_unit, conversion_factor, small_unit on public.inventory_items
for each row execute function private.reset_inventory_item_conversion_verification();

create or replace function public.owner_verify_inventory_item_conversion(p_item_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_verified_at timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  update public.inventory_items
  set conversion_verified_at = v_verified_at,
      conversion_verified_by = v_actor,
      updated_at = clock_timestamp()
  where id = p_item_id and owner_id = v_actor
    and large_unit is not null and conversion_factor is not null and conversion_factor > 0;
  if not found then
    raise exception using errcode = '22023', message = 'Item needs a valid package unit and conversion factor';
  end if;
  return v_verified_at;
end;
$$;
revoke all on function public.owner_verify_inventory_item_conversion(uuid) from public, anon, authenticated;
grant execute on function public.owner_verify_inventory_item_conversion(uuid) to authenticated;

create or replace function public.inventory_count_items_needing_recount(p_count_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_business_date date;
  v_status text;
  v_week_start date := private.current_week_start_vn();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select count_sheet.owner_id, count_sheet.business_date, count_sheet.status
  into v_owner_id, v_business_date, v_status
  from public.inventory_counts as count_sheet
  where count_sheet.id = p_count_id;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory count not found';
  end if;
  if private.is_store_owner() then
    if v_owner_id <> v_actor then
      raise exception using errcode = '42501', message = 'Inventory access denied';
    end if;
  else
    if private.staff_owner_id() is distinct from v_owner_id
      or v_business_date < v_week_start or v_business_date >= v_week_start + 7 then
      raise exception using errcode = '42501', message = 'Staff may only inspect the current week';
    end if;
  end if;
  if v_status <> 'draft' then return; end if;

  return query
  select count_item.item_id
  from public.inventory_count_items as count_item
  where count_item.owner_id = v_owner_id and count_item.count_id = p_count_id
    and count_item.counted_at is not null
    and exists (
      select 1
      from public.inventory_receipt_lines as receipt_line
      join public.inventory_receipts as receipt
        on receipt.owner_id = receipt_line.owner_id and receipt.id = receipt_line.receipt_id
      where receipt_line.owner_id = v_owner_id and receipt_line.item_id = count_item.item_id
        and receipt.received_at <= clock_timestamp()
        and greatest(receipt.received_at, receipt.updated_at) > count_item.counted_at
    )
  order by count_item.item_id;
end;
$$;
revoke all on function public.inventory_count_items_needing_recount(uuid) from public, anon, authenticated;
grant execute on function public.inventory_count_items_needing_recount(uuid) to authenticated;

create or replace function public.inventory_receipt_outlier_baselines(
  p_item_ids uuid[],
  p_exclude_receipt_id uuid default null
)
returns table(item_id uuid, receipt_count integer, median_quantity numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_requested_count integer;
  v_is_owner boolean := private.is_store_owner();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if v_is_owner then
    v_owner_id := v_actor;
  else
    v_owner_id := private.staff_owner_id();
    if v_owner_id is null then
      raise exception using errcode = '42501', message = 'Active store membership required';
    end if;
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 or cardinality(p_item_ids) > 200 then
    raise exception using errcode = '22023', message = 'A list of 1 to 200 inventory items is required';
  end if;
  select count(*) into v_requested_count
  from (select distinct unnest(p_item_ids) as item_id) as requested
  join public.inventory_items as item on item.id = requested.item_id and item.owner_id = v_owner_id;
  if v_requested_count <> (select count(distinct requested.item_id) from unnest(p_item_ids) as requested(item_id)) then
    raise exception using errcode = '42501', message = 'Inventory item access denied';
  end if;

  return query
  with requested as (
    select distinct unnest(p_item_ids) as item_id
  ), quantities as (
    select line.item_id, receipt.id as receipt_id, receipt.received_at, sum(line.converted_quantity) as quantity
    from public.inventory_receipt_lines as line
    join public.inventory_receipts as receipt
      on receipt.owner_id = line.owner_id and receipt.id = line.receipt_id
    join requested on requested.item_id = line.item_id
    where line.owner_id = v_owner_id and receipt.id is distinct from p_exclude_receipt_id
      and line.converted_quantity is not null
      and (v_is_owner or receipt.received_at >= (private.current_week_start_vn()::timestamp at time zone 'Asia/Ho_Chi_Minh')
        and receipt.received_at < ((private.current_week_start_vn() + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    group by line.item_id, receipt.id, receipt.received_at
  ), recent as (
    select quantities.*,
      row_number() over (partition by quantities.item_id order by quantities.received_at desc, quantities.receipt_id desc) as position
    from quantities
  ), stats as (
    select recent.item_id, count(*)::integer as receipt_count,
      percentile_disc(0.5) within group (order by recent.quantity) as median_quantity
    from recent where position <= 5
    group by recent.item_id
  )
  select requested.item_id, coalesce(stats.receipt_count, 0), stats.median_quantity
  from requested left join stats on stats.item_id = requested.item_id
  order by requested.item_id;
end;
$$;
revoke all on function public.inventory_receipt_outlier_baselines(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.inventory_receipt_outlier_baselines(uuid[], uuid) to authenticated;

create or replace function private.guard_inventory_receipt_quantity_outlier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_count integer;
  v_median numeric;
begin
  if new.converted_quantity is null
    or (private.is_store_owner() and current_setting('app.inventory_allow_large_receipt', true) = 'true') then
    return new;
  end if;

  with per_receipt as (
    select receipt.id as receipt_id, receipt.received_at, sum(line.converted_quantity) as quantity
    from public.inventory_receipt_lines as line
    join public.inventory_receipts as receipt
      on receipt.owner_id = line.owner_id and receipt.id = line.receipt_id
    where line.owner_id = new.owner_id and line.item_id = new.item_id
      and receipt.id <> new.receipt_id and line.converted_quantity is not null
      and (private.is_store_owner() or receipt.received_at >= (private.current_week_start_vn()::timestamp at time zone 'Asia/Ho_Chi_Minh')
        and receipt.received_at < ((private.current_week_start_vn() + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
    group by receipt.id, receipt.received_at
  ), recent as (
    select per_receipt.quantity,
      row_number() over (order by per_receipt.received_at desc, per_receipt.receipt_id desc) as position
    from per_receipt
  )
  select count(*)::integer, percentile_disc(0.5) within group (order by quantity)
  into v_count, v_median
  from recent where position <= 5;

  if coalesce(v_count, 0) >= 3 and coalesce(v_median, 0) > 0
    and new.converted_quantity > v_median * 5 then
    raise exception using errcode = '22023', message = 'Large inventory receipt quantity requires owner confirmation';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inventory_receipt_quantity_outlier() from public, anon, authenticated;

drop trigger if exists guard_inventory_receipt_quantity_outlier on public.inventory_receipt_lines;
create trigger guard_inventory_receipt_quantity_outlier
before insert on public.inventory_receipt_lines
for each row execute function private.guard_inventory_receipt_quantity_outlier();

create or replace function public.owner_create_inventory_receipt(p_lines jsonb, p_confirm_large_quantities boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_receipt_id uuid;
  v_actor_label text;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  select coalesce(nullif(trim(account.raw_user_meta_data ->> 'display_name'), ''), nullif(account.email, ''), v_actor::text)
  into v_actor_label from auth.users as account where account.id = v_actor;
  perform set_config('app.inventory_allow_large_receipt', case when p_confirm_large_quantities then 'true' else 'false' end, true);
  insert into public.inventory_receipts (owner_id, created_by, created_by_label, updated_by)
  values (v_actor, v_actor, coalesce(v_actor_label, v_actor::text), v_actor)
  returning id into v_receipt_id;
  perform private.replace_inventory_receipt_lines(v_receipt_id, v_actor, p_lines);
  return v_receipt_id;
end;
$$;
revoke all on function public.owner_create_inventory_receipt(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.owner_create_inventory_receipt(jsonb, boolean) to authenticated;

create or replace function public.owner_correct_inventory_receipt_confirmed(
  p_receipt_id uuid,
  p_lines jsonb,
  p_reason text,
  p_confirm_large_quantities boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  perform 1 from public.inventory_receipts where id = p_receipt_id and owner_id = v_actor for update;
  if not found then raise exception using errcode = '42501', message = 'Receipt not found'; end if;
  perform set_config('app.inventory_allow_large_receipt', case when p_confirm_large_quantities then 'true' else 'false' end, true);
  perform private.apply_inventory_receipt_correction(p_receipt_id, v_actor, v_actor, p_reason, p_lines);
  return p_receipt_id;
end;
$$;
revoke all on function public.owner_correct_inventory_receipt_confirmed(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.owner_correct_inventory_receipt_confirmed(uuid, jsonb, text, boolean) to authenticated;

comment on column public.inventory_items.conversion_verified_at is
  'Owner confirmation time for the current package-to-stock conversion. Automatically cleared if units or factor change.';
