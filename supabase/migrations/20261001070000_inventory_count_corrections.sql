create table public.inventory_count_corrections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  count_id uuid not null,
  corrected_at timestamptz not null default clock_timestamp(),
  corrected_by uuid not null references auth.users (id) on delete restrict,
  corrected_by_label text not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  prior_items jsonb not null check (jsonb_typeof(prior_items) = 'array'),
  updated_items jsonb not null check (jsonb_typeof(updated_items) = 'array'),
  foreign key (owner_id, count_id) references public.inventory_counts (owner_id, id) on delete cascade
);

create index inventory_count_corrections_count_idx
  on public.inventory_count_corrections (owner_id, count_id, corrected_at desc);

alter table public.inventory_count_corrections enable row level security;
revoke all on public.inventory_count_corrections from anon, authenticated;
grant select on public.inventory_count_corrections to authenticated;

create policy "owner reads inventory count corrections"
  on public.inventory_count_corrections for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create function public.owner_correct_inventory_count(p_count_id uuid, p_quantities jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count public.inventory_counts%rowtype;
  v_actor_label text;
  v_prior_items jsonb;
  v_updated_items jsonb;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  select owner_id into v_owner_id from public.inventory_counts where id = p_count_id;
  if not found or v_owner_id <> v_actor then
    raise exception using errcode = '42501', message = 'Inventory count not found';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;
  if p_quantities is null or jsonb_typeof(p_quantities) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid count values';
  end if;

  perform private.lock_inventory_owner(v_owner_id);
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found or v_count.owner_id <> v_actor then
    raise exception using errcode = '42501', message = 'Inventory count not found';
  end if;
  if v_count.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only finalized counts can be corrected';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.item_id,
    'item_name', item.item_name,
    'large_unit', item.large_unit,
    'conversion_factor', item.conversion_factor::text,
    'small_unit', item.small_unit,
    'large_quantity', item.large_quantity::text,
    'small_quantity', item.small_quantity::text,
    'counted_quantity', item.counted_quantity::text
  ) order by item.item_name, item.item_id), '[]'::jsonb)
  into v_prior_items
  from public.inventory_count_items as item
  where item.owner_id = v_owner_id and item.count_id = p_count_id;

  update public.inventory_counts
  set status = 'draft', finalized_by = null, finalized_at = null
  where id = p_count_id and owner_id = v_owner_id;

  perform public.save_inventory_count_draft(p_count_id, p_quantities);

  if exists (
    select 1 from public.inventory_count_items
    where owner_id = v_owner_id and count_id = p_count_id and counted_quantity is null
  ) then
    raise exception using errcode = '22023', message = 'Corrected count must remain complete';
  end if;

  update public.inventory_counts
  set status = 'finalized', finalized_by = v_count.finalized_by,
      finalized_at = v_count.finalized_at, updated_by = v_actor
  where id = p_count_id and owner_id = v_owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.item_id,
    'item_name', item.item_name,
    'large_unit', item.large_unit,
    'conversion_factor', item.conversion_factor::text,
    'small_unit', item.small_unit,
    'large_quantity', item.large_quantity::text,
    'small_quantity', item.small_quantity::text,
    'counted_quantity', item.counted_quantity::text
  ) order by item.item_name, item.item_id), '[]'::jsonb)
  into v_updated_items
  from public.inventory_count_items as item
  where item.owner_id = v_owner_id and item.count_id = p_count_id;

  select coalesce(nullif(trim(account.email), ''), v_actor::text)
  into v_actor_label
  from auth.users as account
  where account.id = v_actor;

  insert into public.inventory_count_corrections (
    owner_id, count_id, corrected_by, corrected_by_label, reason, prior_items, updated_items
  ) values (
    v_owner_id, p_count_id, v_actor, coalesce(v_actor_label, v_actor::text), trim(p_reason), v_prior_items, v_updated_items
  );

  return p_count_id;
end;
$$;
revoke all on function public.owner_correct_inventory_count(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_correct_inventory_count(uuid, jsonb, text) to authenticated;
