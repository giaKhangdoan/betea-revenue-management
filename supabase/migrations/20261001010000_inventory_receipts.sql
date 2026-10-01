create sequence public.inventory_receipt_code_seq;
revoke all on sequence public.inventory_receipt_code_seq from public, anon, authenticated;

create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  receipt_code text not null unique default (
    'PN-' || to_char(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD')
      || '-' || lpad(nextval('public.inventory_receipt_code_seq')::text, 6, '0')
  ),
  received_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_by_label text not null,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  unique (owner_id, id)
);

create table public.inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  receipt_id uuid not null,
  line_number integer not null check (line_number between 1 and 200),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  item_name text not null,
  category text not null,
  large_unit text not null,
  large_quantity numeric(20, 3) not null check (large_quantity >= 0 and large_quantity = trunc(large_quantity)),
  conversion_factor numeric(14, 3) not null check (conversion_factor > 0),
  small_unit text not null,
  loose_quantity numeric(20, 3) not null check (loose_quantity >= 0),
  converted_quantity numeric(20, 3) not null check (converted_quantity >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (owner_id, receipt_id)
    references public.inventory_receipts (owner_id, id) on delete cascade,
  unique (receipt_id, line_number)
);

create index inventory_receipts_owner_received_idx
  on public.inventory_receipts (owner_id, received_at desc);
create index inventory_receipt_lines_receipt_idx
  on public.inventory_receipt_lines (owner_id, receipt_id);

alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_lines enable row level security;
revoke all on public.inventory_receipts, public.inventory_receipt_lines from anon, authenticated;
grant select on public.inventory_receipts, public.inventory_receipt_lines to authenticated;

create policy "owner and current week staff read inventory receipts"
  on public.inventory_receipts for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (
      private.is_active_store_member(owner_id)
      and received_at >= (private.current_week_start_vn()::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and received_at < ((private.current_week_start_vn() + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh')
    )
  );

create policy "owner and current week staff read inventory receipt lines"
  on public.inventory_receipt_lines for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (
      private.is_active_store_member(owner_id)
      and exists (
        select 1 from public.inventory_receipts as receipt
        where receipt.id = receipt_id
          and receipt.owner_id = inventory_receipt_lines.owner_id
          and receipt.received_at >= (private.current_week_start_vn()::timestamp at time zone 'Asia/Ho_Chi_Minh')
          and receipt.received_at < ((private.current_week_start_vn() + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      )
    )
  );

create function private.replace_inventory_receipt_lines(
  p_receipt_id uuid,
  p_owner_id uuid,
  p_lines jsonb,
  p_allowed_inactive_item_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_item_id uuid;
  v_item record;
  v_large_quantity numeric;
  v_loose_quantity numeric;
  v_converted_quantity numeric;
  v_line_number integer := 0;
  v_max_quantity constant numeric := 99999999999999999.999;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'A receipt needs between 1 and 200 lines';
  end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 200 then
    raise exception using errcode = '22023', message = 'A receipt needs between 1 and 200 lines';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_number := v_line_number + 1;
    if jsonb_typeof(v_line -> 'item_id') is distinct from 'string'
      or jsonb_typeof(v_line -> 'large_quantity') is distinct from 'string'
      or jsonb_typeof(v_line -> 'loose_quantity') is distinct from 'string'
      or length(v_line ->> 'large_quantity') > 17
      or length(v_line ->> 'loose_quantity') > 21
      or (v_line ->> 'large_quantity') !~ '^[0-9]+$'
      or (v_line ->> 'loose_quantity') !~ '^[0-9]+([.][0-9]{1,3})?$' then
      raise exception using errcode = '22023', message = 'Invalid receipt line quantity';
    end if;

    begin
      v_item_id := (v_line ->> 'item_id')::uuid;
      v_large_quantity := (v_line ->> 'large_quantity')::numeric;
      v_loose_quantity := (v_line ->> 'loose_quantity')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid receipt line';
    end;

    if v_large_quantity > v_max_quantity or v_loose_quantity > v_max_quantity then
      raise exception using errcode = '22003', message = 'Receipt quantity is out of range';
    end if;

    select id, name, category, large_unit, conversion_factor, small_unit
    into v_item
    from public.inventory_items
    where id = v_item_id and owner_id = p_owner_id
      and (active or v_item_id = any(p_allowed_inactive_item_ids))
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'Inventory item is not active';
    end if;
    if v_item.conversion_factor <= 0 then
      raise exception using errcode = '22023', message = 'Invalid inventory conversion factor';
    end if;
    -- ponytail: only the seeded Gr/Ml base units allow fractions; extend this list when a divisible unit is added.
    if lower(trim(v_item.small_unit)) not in ('gr', 'ml')
      and v_loose_quantity <> trunc(v_loose_quantity) then
      raise exception using errcode = '22023', message = 'This unit does not allow fractional loose quantities';
    end if;

    v_converted_quantity := v_large_quantity * v_item.conversion_factor + v_loose_quantity;
    if v_converted_quantity > v_max_quantity then
      raise exception using errcode = '22003', message = 'Converted receipt quantity is out of range';
    end if;

    insert into public.inventory_receipt_lines (
      owner_id, receipt_id, line_number, item_id, item_name, category, large_unit,
      large_quantity, conversion_factor, small_unit, loose_quantity, converted_quantity
    ) values (
      p_owner_id, p_receipt_id, v_line_number, v_item.id, v_item.name, v_item.category, v_item.large_unit,
      v_large_quantity, v_item.conversion_factor, v_item.small_unit, v_loose_quantity, v_converted_quantity
    );
  end loop;
end;
$$;
revoke all on function private.replace_inventory_receipt_lines(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;

create function public.staff_create_inventory_receipt(p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_actor_label text;
  v_receipt_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select membership.owner_id, membership.display_name
  into v_owner_id, v_actor_label
  from public.store_memberships as membership
  where membership.user_id = v_actor and membership.active;
  if not found or not private.is_active_store_member(v_owner_id) then
    raise exception using errcode = '42501', message = 'Active store staff membership required';
  end if;

  insert into public.inventory_receipts (owner_id, created_by, created_by_label, updated_by)
  values (v_owner_id, v_actor, v_actor_label, v_actor)
  returning id into v_receipt_id;

  perform private.replace_inventory_receipt_lines(v_receipt_id, v_owner_id, p_lines);
  return v_receipt_id;
end;
$$;
revoke all on function public.staff_create_inventory_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.staff_create_inventory_receipt(jsonb) to authenticated;

create function public.staff_update_inventory_receipt(p_receipt_id uuid, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_existing_item_ids uuid[];
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select membership.owner_id
  into v_owner_id
  from public.store_memberships as membership
  where membership.user_id = v_actor and membership.active;
  if not found or not private.is_active_store_member(v_owner_id) then
    raise exception using errcode = '42501', message = 'Active store staff membership required';
  end if;

  perform 1
  from public.inventory_receipts as receipt
  where receipt.id = p_receipt_id
    and receipt.owner_id = v_owner_id
    and (receipt.received_at at time zone 'Asia/Ho_Chi_Minh')::date = private.current_business_date_vn()
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Receipt is not eligible for staff edit today';
  end if;

  select coalesce(array_agg(item_id), array[]::uuid[]) into v_existing_item_ids
  from public.inventory_receipt_lines where receipt_id = p_receipt_id and owner_id = v_owner_id;
  delete from public.inventory_receipt_lines where receipt_id = p_receipt_id and owner_id = v_owner_id;
  perform private.replace_inventory_receipt_lines(p_receipt_id, v_owner_id, p_lines, v_existing_item_ids);
  update public.inventory_receipts
  set updated_at = clock_timestamp(), updated_by = v_actor
  where id = p_receipt_id and owner_id = v_owner_id;
  return p_receipt_id;
end;
$$;
revoke all on function public.staff_update_inventory_receipt(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.staff_update_inventory_receipt(uuid, jsonb) to authenticated;
