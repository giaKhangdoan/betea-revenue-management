alter table public.inventory_items
  alter column large_unit drop not null,
  alter column conversion_factor drop not null,
  add column sort_order integer not null default 1000;

alter table public.inventory_items
  add constraint inventory_items_conversion_pair
    check (large_unit is not null or conversion_factor is null);

alter table public.inventory_receipt_lines
  alter column large_unit drop not null,
  alter column conversion_factor drop not null,
  alter column converted_quantity drop not null,
  add constraint inventory_receipt_lines_conversion_pair
    check (large_unit is not null or conversion_factor is null),
  add constraint inventory_receipt_lines_single_unit_quantity
    check (large_unit is not null or large_quantity = 0);

alter table public.inventory_count_items
  alter column large_unit drop not null,
  alter column conversion_factor drop not null,
  add column sort_order integer not null default 1000,
  drop constraint inventory_count_items_counted_at_consistent,
  drop column counted_quantity;

alter table public.inventory_count_items
  add column counted_quantity numeric generated always as (
    case when large_quantity is null and small_quantity is null then null
      when large_unit is not null and conversion_factor is null then null
      else coalesce(large_quantity, 0) * coalesce(conversion_factor, 1) + coalesce(small_quantity, 0)
    end
  ) stored,
  add constraint inventory_count_items_conversion_pair
    check (large_unit is not null or conversion_factor is null),
  add constraint inventory_count_items_count_large_unit_only_requires_conversion
    check (conversion_factor is not null or not count_large_unit_only),
  add constraint inventory_count_items_single_unit_quantity
    check (large_unit is not null or (not count_large_unit_only and large_quantity is null)),
  add constraint inventory_count_items_counted_quantity_check
    check (counted_quantity is null or counted_quantity <= 999999999999999999999999.999),
  add constraint inventory_count_items_counted_at_consistent
    check ((large_quantity is null and small_quantity is null) = (counted_at is null));

create or replace function private.seed_inventory_catalog_for_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_items (
    owner_id, source_code, name, category, large_unit, conversion_factor, small_unit, sort_order
  )
  select p_owner_id, seed.source_code, seed.name, seed.category,
    seed.large_unit, seed.conversion_factor, seed.small_unit, seed.sort_order
  from (values
    ('001', 'Đường cát', 'Nguyên liệu', 'Kg', 1000, 'Gr', 1),
    ('002', 'Sữa Đặc', 'Nguyên liệu', 'Hộp', 1284, 'Gr', 2),
    ('003', 'Sữa tươi', 'Nguyên liệu', 'Hộp', 900, 'Ml', 3),
    ('004', 'Chanh', 'Nguyên liệu', 'Kg', 1000, 'Gr', 4),
    ('005', 'Mật Ong', 'Nguyên liệu', 'Chai', 1000, 'Ml', 5),
    ('006', 'Khăn giấy', 'Vật tư', null, null, 'Gói', 21),
    ('007', 'Bao rác', 'Vật tư', 'Túi', null, 'Cuộn', 22),
    ('008', 'Ly 12oz', 'Bao bì', null, null, 'Cái', 11),
    ('009', 'Ly 16oz', 'Bao bì', null, null, 'Cái', 12),
    ('010', 'Ly 20oz', 'Bao bì', null, null, 'Cái', 13),
    ('011', 'Cuộn màng dập ly', 'Bao bì', null, null, 'Cuộn', 14),
    ('012', 'Túi T', 'Bao bì', 'Kg', 1000, 'Gr', 15),
    ('013', 'Túi đôi', 'Bao bì', 'Kg', 1000, 'Gr', 16),
    ('014', 'Ống hút phi 6', 'Bao bì', 'Kg', 1000, 'Gr', 17),
    ('015', 'Ống hút phi 12', 'Bao bì', 'Kg', 1000, 'Gr', 18),
    ('016', 'Muỗng', 'Bao bì', 'Túi', 50, 'Cái', 19),
    ('017', 'Giấy in bill', 'Vật tư', null, null, 'Cuộn', 20),
    ('018', 'Hồng Trà', 'Nguyên liệu', 'Gói', 500, 'Gr', 6),
    ('019', 'Lục Hoàng Trà', 'Nguyên liệu', 'Gói', 500, 'Gr', 7),
    ('020', 'Oolong Chi Tử', 'Nguyên liệu', 'Gói', 500, 'Gr', 8),
    ('021', 'Bột MT-35', 'Nguyên liệu', 'Kg', 1000, 'Gr', 9),
    ('022', 'Trân Châu Hoàng Kim', 'Topping', 'Gói', 3000, 'Gr', 10),
    ('023', 'Trà Atisô Cam Đào', 'Đồ uống đóng chai', 'Chai', 1000, 'Ml', 23),
    ('024', 'Trà Atisô Cam Xoài', 'Đồ uống đóng chai', 'Chai', 1000, 'Ml', 24),
    ('025', 'Trà Hibiscus', 'Đồ uống đóng chai', 'Chai', 1000, 'Ml', 25),
    ('026', 'Kombucha Nguyên Bản', 'Kombucha', 'Chai', 1000, 'Ml', 26),
    ('027', 'Kombucha Ổi', 'Kombucha', 'Chai', 1000, 'Ml', 27),
    ('028', 'Kombucha Đào', 'Kombucha', 'Chai', 1000, 'Ml', 28),
    ('029', 'Kombucha Táo', 'Kombucha', 'Chai', 1000, 'Ml', 29),
    ('030', 'Kombucha Vải', 'Kombucha', 'Chai', 1000, 'Ml', 30),
    ('031', 'Kombucha Nho', 'Kombucha', 'Chai', 1000, 'Ml', 31),
    ('032', 'Kombucha Hibiscus', 'Kombucha', 'Chai', 1000, 'Ml', 32),
    ('033', 'Kombucha Dâu Tây', 'Kombucha', 'Chai', 1000, 'Ml', 33),
    ('034', 'Kombucha Việt Quất', 'Kombucha', 'Chai', 1000, 'Ml', 34),
    ('035', 'Soda', 'Nước lon', 'Lốc', 6, 'Lon', 35),
    ('036', 'Pepsi', 'Nước lon', 'Lốc', 6, 'Lon', 36),
    ('037', '7 UP', 'Nước lon', 'Lốc', 6, 'Lon', 37),
    ('038', 'Sting', 'Nước lon', 'Lốc', 6, 'Lon', 38),
    ('039', 'Sting ít đường', 'Nước lon', 'Lốc', 6, 'Lon', 39),
    ('040', 'Mirinda Cam', 'Nước đóng chai/lon', 'Lốc', 6, 'Lon', 40),
    ('041', 'Mirinda Xá Xị', 'Nước đóng chai/lon', 'Lốc', 6, 'Lon', 41),
    ('042', 'Rockstar 250ml', 'Nước lon', 'Lốc', 6, 'Lon', 42),
    ('043', 'Juicy Milk Dâu', 'Nước đóng chai/lon', 'Lốc', 6, 'Chai', 43)
  ) as seed(source_code, name, category, large_unit, conversion_factor, small_unit, sort_order)
  on conflict (owner_id, source_code) do nothing;
end;
$$;
revoke all on function private.seed_inventory_catalog_for_owner(uuid) from public, anon, authenticated;

update public.inventory_items as item
set name = defaults.new_name,
    large_unit = defaults.new_large_unit,
    conversion_factor = defaults.new_factor,
    small_unit = defaults.new_small_unit,
    count_large_unit_only = false,
    updated_at = clock_timestamp()
from (values
  ('002', 'Sữa Đặc', 'Sữa Đặc', 'Nguyên liệu', 'Hộp', 1200::numeric, 'Ml', 'Hộp', 1284::numeric, 'Gr'),
  ('006', 'Khăn giấy', 'Khăn giấy', 'Vật tư', 'Gói', 1::numeric, 'Gói', null, null, 'Gói'),
  ('007', 'Bao rác', 'Bao rác', 'Vật tư', 'KG', 1000::numeric, 'Gr', 'Túi', null, 'Cuộn'),
  ('008', 'Ly 12oz', 'Ly 12oz', 'Bao bì', 'Cái', 1::numeric, 'Cái', null, null, 'Cái'),
  ('009', 'Ly 16oz', 'Ly 16oz', 'Bao bì', 'Cái', 1::numeric, 'Cái', null, null, 'Cái'),
  ('010', 'Ly 20oz', 'Ly 20oz', 'Bao bì', 'Cái', 1::numeric, 'Cái', null, null, 'Cái'),
  ('011', 'Cuộn màng dập ly', 'Cuộn màng dập ly', 'Bao bì', 'Cuộn', 1::numeric, 'Cuộn', null, null, 'Cuộn'),
  ('012', 'Túi T', 'Túi T', 'Bao bì', 'Túi', 1000::numeric, 'Gr', 'Kg', 1000::numeric, 'Gr'),
  ('013', 'Túi đôi', 'Túi đôi', 'Bao bì', 'Túi', 1000::numeric, 'Gr', 'Kg', 1000::numeric, 'Gr'),
  ('014', 'Ống hút phi 6', 'Ống hút phi 6', 'Bao bì', 'Cây', 10::numeric, 'Bịch', 'Kg', 1000::numeric, 'Gr'),
  ('015', 'Ống hút phi 12', 'Ống hút phi 12', 'Bao bì', 'Cây', 10::numeric, 'Bịch', 'Kg', 1000::numeric, 'Gr'),
  ('016', 'Muỗng', 'Muỗng', 'Bao bì', 'Thùng', 2000::numeric, 'Cái', 'Túi', 50::numeric, 'Cái'),
  ('017', 'Giấy in bill', 'Giấy in bill', 'Vật tư', 'Cuộn', 100::numeric, 'Cái', null, null, 'Cuộn'),
  ('018', 'Hồng Trà', 'Hồng Trà', 'Nguyên liệu', 'Gói', 1000::numeric, 'Gr', 'Gói', 500::numeric, 'Gr'),
  ('019', 'Lục Hoàng Trà', 'Lục Hoàng Trà', 'Nguyên liệu', 'Gói', 1000::numeric, 'Gr', 'Gói', 500::numeric, 'Gr'),
  ('020', 'Oolong Chi Tử', 'Oolong Chi Tử', 'Nguyên liệu', 'Gói', 999::numeric, 'Gr', 'Gói', 500::numeric, 'Gr'),
  ('022', 'Trân Châu Hoàng Kim', 'Trân Châu Hoàng Kim', 'Topping', 'Hộp', 3000::numeric, 'Gr', 'Gói', 3000::numeric, 'Gr'),
  ('023', 'Trà Atisô Cam Đào', 'Trà Atisô Cam Đào', 'Đồ uống đóng chai', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('024', 'Trà Atisô Cam Xoài', 'Trà Atisô Cam Xoài', 'Đồ uống đóng chai', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('025', 'Trà Hibiscus', 'Trà Hibiscus', 'Đồ uống đóng chai', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('026', 'Kombucha Nguyên Bản', 'Kombucha Nguyên Bản', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('027', 'Kombucha Ổi', 'Kombucha Ổi', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('028', 'Kombucha Đào', 'Kombucha Đào', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('029', 'Kombucha Táo', 'Kombucha Táo', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('030', 'Kombucha Vải', 'Kombucha Vải', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('031', 'Kombucha Nho', 'Kombucha Nho', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('032', 'Kombucha Hibiscus', 'Kombucha Hibiscus', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('033', 'Kombucha Dâu Tây', 'Kombucha Dâu Tây', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('034', 'Kombucha Việt Quất', 'Kombucha Việt Quất', 'Kombucha', 'Chai', 1::numeric, 'Chai', 'Chai', 1000::numeric, 'Ml'),
  ('035', 'Soda', 'Soda', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('036', 'Pepsi', 'Pepsi', 'Nước lon', 'Thùng', 24::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('037', '7 UP', '7 UP', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('038', 'Sting', 'Sting', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('039', 'Sting ít đường', 'Sting ít đường', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('040', 'Mirinda Cam', 'Mirinda Cam', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('041', 'Mirinda Xá Xị', 'Mirinda Xá Xị', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('042', 'Rockstar', 'Rockstar 250ml', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('043', 'Juicy Milk Dâu', 'Juicy Milk Dâu', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Chai')
) as defaults(source_code, old_name, new_name, old_category, old_large_unit, old_factor, old_small_unit, new_large_unit, new_factor, new_small_unit)
where item.source_code = defaults.source_code
  and item.name = defaults.old_name
  and item.category = defaults.old_category
  and item.large_unit = defaults.old_large_unit
  and item.conversion_factor = defaults.old_factor
  and item.small_unit = defaults.old_small_unit;

update public.inventory_items as item
set sort_order = ordering.sort_order
from (values
  ('001', 1), ('002', 2), ('003', 3), ('004', 4), ('005', 5),
  ('018', 6), ('019', 7), ('020', 8), ('021', 9), ('022', 10),
  ('008', 11), ('009', 12), ('010', 13), ('011', 14), ('012', 15), ('013', 16),
  ('014', 17), ('015', 18), ('016', 19), ('017', 20), ('006', 21), ('007', 22),
  ('023', 23), ('024', 24), ('025', 25), ('026', 26), ('027', 27), ('028', 28),
  ('029', 29), ('030', 30), ('031', 31), ('032', 32), ('033', 33), ('034', 34),
  ('035', 35), ('036', 36), ('037', 37), ('038', 38), ('039', 39), ('040', 40),
  ('041', 41), ('042', 42), ('043', 43)
) as ordering(source_code, sort_order)
where item.source_code = ordering.source_code;

update public.inventory_count_items as count_item
set sort_order = item.sort_order
from public.inventory_items as item
where count_item.item_id = item.id and count_item.owner_id = item.owner_id;

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
      small_unit, count_large_unit_only, sort_order
    )
    select v_owner_id, v_count_id, item.id, item.name, item.category,
      item.large_unit, item.conversion_factor, item.small_unit, item.count_large_unit_only, item.sort_order
    from public.inventory_items as item
    where item.owner_id = v_owner_id and item.active;
  end if;

  return v_count_id;
end;
$$;
revoke all on function public.open_inventory_count(date) from public, anon, authenticated;
grant execute on function public.open_inventory_count(date) to authenticated;

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

create or replace function public.owner_correct_inventory_count(p_count_id uuid, p_quantities jsonb, p_reason text)
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
  ) order by item.sort_order, item.item_name, item.item_id), '[]'::jsonb)
  into v_prior_items
  from public.inventory_count_items as item
  where item.owner_id = v_owner_id and item.count_id = p_count_id;

  update public.inventory_counts
  set status = 'draft', finalized_by = null, finalized_at = null
  where id = p_count_id and owner_id = v_owner_id;

  perform public.save_inventory_count_draft(p_count_id, p_quantities);

  if exists (
    select 1 from public.inventory_count_items
    where owner_id = v_owner_id and count_id = p_count_id and counted_at is null
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
  ) order by item.sort_order, item.item_name, item.item_id), '[]'::jsonb)
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

update public.inventory_items
set large_unit = null,
    conversion_factor = null,
    count_large_unit_only = false,
    updated_at = clock_timestamp()
where lower(btrim(large_unit)) = lower(btrim(small_unit));

alter table public.inventory_items
  add constraint inventory_items_no_identity_conversion
    check (large_unit is null or lower(btrim(large_unit)) <> lower(btrim(small_unit))),
  add constraint inventory_items_single_unit_count_mode
    check ((large_unit is not null and conversion_factor is not null) or not count_large_unit_only);

drop function public.owner_create_inventory_item(text, text, text, numeric, text, boolean);
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
  if (p_large_unit is null and p_conversion_factor is not null)
    or (p_large_unit is not null and length(btrim(p_large_unit)) = 0)
    or (p_conversion_factor is not null and (p_conversion_factor <= 0
      or p_conversion_factor > 99999999999.999
      or p_conversion_factor <> round(p_conversion_factor, 3)))
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

drop function public.owner_update_inventory_item(uuid, text, text, text, numeric, text, boolean);
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
  if (p_large_unit is null and p_conversion_factor is not null)
    or (p_large_unit is not null and length(btrim(p_large_unit)) = 0)
    or (p_conversion_factor is not null and (p_conversion_factor <= 0
      or p_conversion_factor > 99999999999.999
      or p_conversion_factor <> round(p_conversion_factor, 3)))
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

create or replace function private.replace_inventory_receipt_lines(
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
    if v_item.large_unit is null then
      if v_large_quantity <> 0 then
        raise exception using errcode = '22023', message = 'This item has no purchase-unit conversion';
      end if;
      v_converted_quantity := v_loose_quantity;
    elsif v_item.conversion_factor is null then
      v_converted_quantity := null;
    else
      if v_item.conversion_factor <= 0 then
        raise exception using errcode = '22023', message = 'Invalid inventory conversion factor';
      end if;
      v_converted_quantity := v_large_quantity * v_item.conversion_factor + v_loose_quantity;
    end if;
    -- ponytail: only the seeded Gr/Ml base units allow fractions; extend this list when a divisible unit is added.
    if lower(trim(v_item.small_unit)) not in ('gr', 'ml')
      and v_loose_quantity <> trunc(v_loose_quantity) then
      raise exception using errcode = '22023', message = 'This unit does not allow fractional loose quantities';
    end if;

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
  if exists (
    select 1
    from public.inventory_receipt_lines as line
    join public.inventory_items as item on item.id = line.item_id and item.owner_id = line.owner_id
    where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id
      and (line.large_unit is distinct from item.large_unit
        or line.conversion_factor is distinct from item.conversion_factor
        or line.small_unit is distinct from item.small_unit)
  ) then
    raise exception using errcode = '22023', message = 'Receipt item unit configuration changed';
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
