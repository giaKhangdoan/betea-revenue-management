alter table public.inventory_count_items add column counted_at timestamptz;

update public.inventory_count_items
set counted_at = updated_at
where counted_quantity is not null;

alter table public.inventory_count_items
  add constraint inventory_count_items_counted_at_consistent
  check ((counted_quantity is null) = (counted_at is null));

create function private.lock_inventory_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.owner_profiles where user_id = p_owner_id for update;
end;
$$;
revoke all on function private.lock_inventory_owner(uuid) from public, anon, authenticated;

create function private.serialize_inventory_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_inventory_owner(new.owner_id);
  new.received_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.serialize_inventory_receipt_insert() from public, anon, authenticated;
create trigger serialize_inventory_receipt_insert
  before insert on public.inventory_receipts
  for each row execute function private.serialize_inventory_receipt_insert();

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
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_quantities is null or jsonb_typeof(p_quantities) <> 'array' then raise exception 'Invalid count values'; end if;

  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception 'Inventory count not found'; end if;
  if private.is_store_owner() and v_count.owner_id = v_actor then
    v_owner_id := v_actor;
  else
    v_owner_id := private.staff_owner_id();
    if v_owner_id is null or v_owner_id <> v_count.owner_id then raise exception 'Inventory access denied'; end if;
    if v_count.business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today''s draft only'; end if;
  end if;
  if v_count.status <> 'draft' then raise exception 'Finalized counts cannot be edited'; end if;
  if jsonb_array_length(p_quantities) > (
    select count(*) from public.inventory_count_items where count_id = p_count_id
  ) then raise exception 'Invalid count values'; end if;

  for v_entry in select value from jsonb_array_elements(p_quantities) as entries(value) loop
    if jsonb_typeof(v_entry) <> 'object' or jsonb_typeof(v_entry->'item_id') <> 'string' then
      raise exception 'Invalid count item';
    end if;
    v_item_id := (v_entry->>'item_id')::uuid;
    if v_item_id = any(v_seen_ids) then raise exception 'Duplicate count item'; end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
    if (v_entry ? 'large_quantity' and jsonb_typeof(v_entry->'large_quantity') not in ('string', 'null'))
      or (v_entry ? 'small_quantity' and jsonb_typeof(v_entry->'small_quantity') not in ('string', 'null')) then
      raise exception 'Invalid count quantity';
    end if;
    if not (v_entry ? 'large_quantity' or v_entry ? 'small_quantity') then
      raise exception 'Missing count quantity';
    end if;

    select * into v_line from public.inventory_count_items
    where count_id = p_count_id and owner_id = v_owner_id and item_id = v_item_id for update;
    if not found then raise exception 'Item is not part of this count'; end if;

    v_large_text := case when v_entry ? 'large_quantity' then nullif(trim(v_entry->>'large_quantity'), '') else null end;
    v_small_text := case when v_entry ? 'small_quantity' then nullif(trim(v_entry->>'small_quantity'), '') else null end;
    if v_large_text is not null and v_large_text !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' then raise exception 'Invalid count quantity'; end if;
    if v_small_text is not null and v_small_text !~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' then raise exception 'Invalid count quantity'; end if;

    v_large := case when v_entry ? 'large_quantity' then v_large_text::numeric else v_line.large_quantity end;
    v_small := case when v_entry ? 'small_quantity' then v_small_text::numeric else v_line.small_quantity end;
    if lower(trim(v_line.small_unit)) not in ('gr', 'g', 'mg', 'ml', 'kg', 'l', 'lít')
      and ((v_large is not null and v_large <> trunc(v_large)) or (v_small is not null and v_small <> trunc(v_small))) then
      raise exception 'Fractions are not allowed for indivisible units';
    end if;

    update public.inventory_count_items set
      large_quantity = v_large,
      small_quantity = v_small,
      counted_at = case when v_large is null and v_small is null then null else clock_timestamp() end,
      updated_by = v_actor
    where count_id = p_count_id and item_id = v_item_id;
  end loop;

  if cardinality(v_seen_ids) > 0 then
    update public.inventory_counts set updated_by = v_actor
    where id = p_count_id;
  end if;
end;
$$;
revoke all on function public.save_inventory_count_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_inventory_count_draft(uuid, jsonb) to authenticated;

create function public.finalize_inventory_count(p_count_id uuid)
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

  -- ponytail: one owner-row lock serializes inventory cutoffs for this single-store app; use per-store locks if concurrent stores are added.
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
    where count_id = p_count_id and counted_quantity is null
  ) then
    raise exception using errcode = '22023', message = 'Inventory count has uncounted items';
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

create or replace function private.apply_inventory_receipt_correction(
  p_receipt_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_lines jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor_label text;
  v_prior_lines jsonb;
  v_prior_item_ids uuid[];
  v_now timestamptz;
begin
  perform private.lock_inventory_owner(p_owner_id);
  v_now := clock_timestamp();
  if p_actor_id <> p_owner_id and exists (
    select 1
    from public.inventory_receipts as receipt
    join public.inventory_counts as count_sheet on count_sheet.owner_id = receipt.owner_id
    where receipt.id = p_receipt_id and receipt.owner_id = p_owner_id
      and count_sheet.status = 'finalized' and count_sheet.finalized_at >= receipt.received_at
  ) then
    raise exception using errcode = '42501', message = 'Receipt requires an owner correction after count finalization';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;

  select coalesce(nullif(trim(membership.display_name), ''), nullif(account.email, ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;

  select coalesce(jsonb_agg(to_jsonb(line) order by line.line_number), '[]'::jsonb),
    coalesce(array_agg(line.item_id), array[]::uuid[])
  into v_prior_lines, v_prior_item_ids
  from public.inventory_receipt_lines as line
  where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id;

  insert into public.inventory_receipt_corrections (
    owner_id, receipt_id, corrected_at, corrected_by, corrected_by_label, reason, prior_lines
  ) values (
    p_owner_id, p_receipt_id, v_now, p_actor_id, coalesce(v_actor_label, p_actor_id::text), trim(p_reason), v_prior_lines
  );

  delete from public.inventory_receipt_lines where owner_id = p_owner_id and receipt_id = p_receipt_id;
  perform private.replace_inventory_receipt_lines(p_receipt_id, p_owner_id, p_lines, v_prior_item_ids);
  update public.inventory_receipts
  set updated_at = v_now, updated_by = p_actor_id
  where id = p_receipt_id and owner_id = p_owner_id;
end;
$$;
revoke all on function private.apply_inventory_receipt_correction(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
