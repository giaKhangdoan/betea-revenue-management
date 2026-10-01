create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  business_date date not null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_by uuid references auth.users (id) on delete restrict,
  finalized_at timestamptz,
  unique (owner_id, business_date),
  unique (owner_id, id),
  check ((status = 'draft' and finalized_by is null and finalized_at is null)
    or (status = 'finalized' and finalized_by is not null and finalized_at is not null))
);

create table public.inventory_count_items (
  owner_id uuid not null,
  count_id uuid not null,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  item_name text not null,
  category text not null,
  large_unit text not null,
  conversion_factor numeric(14, 3) not null check (conversion_factor > 0),
  small_unit text not null,
  large_quantity numeric check (large_quantity is null or large_quantity between 0 and 999999999999.999),
  small_quantity numeric check (small_quantity is null or small_quantity between 0 and 999999999999.999),
  counted_quantity numeric generated always as (
    case when large_quantity is null and small_quantity is null then null
      else coalesce(large_quantity, 0) * conversion_factor + coalesce(small_quantity, 0)
    end
  ) stored,
  updated_by uuid references auth.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (count_id, item_id),
  foreign key (owner_id, count_id) references public.inventory_counts (owner_id, id) on delete cascade,
  check (counted_quantity is null or counted_quantity <= 999999999999999999999999.999)
);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
revoke all on public.inventory_counts, public.inventory_count_items from anon, authenticated;
grant select on public.inventory_counts, public.inventory_count_items to authenticated;

create policy "owners and current week staff read inventory counts"
  on public.inventory_counts for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

create policy "owners and current week staff read inventory count items"
  on public.inventory_count_items for select to authenticated
  using (
    exists (
      select 1 from public.inventory_counts as count_sheet
      where count_sheet.id = inventory_count_items.count_id
        and count_sheet.owner_id = inventory_count_items.owner_id
    )
  );

create trigger set_updated_at before update on public.inventory_counts
  for each row execute function private.touch_updated_at();
create trigger set_updated_at before update on public.inventory_count_items
  for each row execute function private.touch_updated_at();

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
      owner_id, count_id, item_id, item_name, category, large_unit, conversion_factor, small_unit
    )
    select v_owner_id, v_count_id, item.id, item.name, item.category,
      item.large_unit, item.conversion_factor, item.small_unit
    from public.inventory_items as item
    where item.owner_id = v_owner_id and item.active;
  end if;

  return v_count_id;
end;
$$;
revoke all on function public.open_inventory_count(date) from public, anon, authenticated;
grant execute on function public.open_inventory_count(date) to authenticated;

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
    if v_count.business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today's draft only'; end if;
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
      updated_by = v_actor
    where count_id = p_count_id and item_id = v_item_id
      and (large_quantity, small_quantity) is distinct from (v_large, v_small);
  end loop;

  if cardinality(v_seen_ids) > 0 then
    update public.inventory_counts set updated_by = v_actor
    where id = p_count_id;
  end if;
end;
$$;
revoke all on function public.save_inventory_count_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_inventory_count_draft(uuid, jsonb) to authenticated;
