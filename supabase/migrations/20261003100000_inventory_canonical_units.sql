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
    ('035', 'Soda 320ml', 'Nước lon', 'Lốc', 6, 'Lon', 35),
    ('036', 'Pepsi 320ml', 'Nước lon', 'Lốc', 6, 'Lon', 36),
    ('037', '7 UP 320ml', 'Nước lon', 'Lốc', 6, 'Lon', 37),
    ('038', 'Sting 320ml', 'Nước lon', 'Lốc', 6, 'Lon', 38),
    ('039', 'Sting ít đường 320ml', 'Nước lon', 'Lốc', 6, 'Lon', 39),
    ('040', 'Mirinda Cam 320ml', 'Nước đóng chai/lon', 'Lốc', 6, 'Lon', 40),
    ('041', 'Mirinda Xá Xị 320ml', 'Nước đóng chai/lon', 'Lốc', 6, 'Lon', 41),
    ('042', 'Rockstar 250ml', 'Nước lon', 'Lốc', 6, 'Lon', 42),
    ('043', 'Juicy Milk Dâu', 'Nước đóng chai/lon', 'Lốc', 6, 'Chai', 43)
  ) as seed(source_code, name, category, large_unit, conversion_factor, small_unit, sort_order)
  on conflict (owner_id, source_code) do nothing;
end;
$$;
revoke all on function private.seed_inventory_catalog_for_owner(uuid) from public, anon, authenticated;

update public.inventory_items as item
set large_unit = 'Chai',
    conversion_factor = 1000,
    small_unit = 'Ml',
    count_large_unit_only = false,
    updated_at = clock_timestamp()
from (values
  ('023', 'Trà Atisô Cam Đào', 'Đồ uống đóng chai'),
  ('024', 'Trà Atisô Cam Xoài', 'Đồ uống đóng chai'),
  ('025', 'Trà Hibiscus', 'Đồ uống đóng chai'),
  ('026', 'Kombucha Nguyên Bản', 'Kombucha'),
  ('027', 'Kombucha Ổi', 'Kombucha'),
  ('028', 'Kombucha Đào', 'Kombucha'),
  ('029', 'Kombucha Táo', 'Kombucha'),
  ('030', 'Kombucha Vải', 'Kombucha'),
  ('031', 'Kombucha Nho', 'Kombucha'),
  ('032', 'Kombucha Hibiscus', 'Kombucha'),
  ('033', 'Kombucha Dâu Tây', 'Kombucha'),
  ('034', 'Kombucha Việt Quất', 'Kombucha')
) as beverage(source_code, name, category)
where item.source_code = beverage.source_code
  and item.name = beverage.name
  and item.category = beverage.category
  and (
    (item.large_unit is null and item.conversion_factor is null and item.small_unit = 'Chai')
    or (item.large_unit = 'Chai' and item.conversion_factor = 1 and item.small_unit = 'Chai')
  );

update public.inventory_items as item
set name = drink.new_name,
    updated_at = clock_timestamp()
from (values
  ('035', 'Soda', 'Soda 320ml', 'Nước lon', 'Lon'),
  ('036', 'Pepsi', 'Pepsi 320ml', 'Nước lon', 'Lon'),
  ('037', '7 UP', '7 UP 320ml', 'Nước lon', 'Lon'),
  ('038', 'Sting', 'Sting 320ml', 'Nước lon', 'Lon'),
  ('039', 'Sting ít đường', 'Sting ít đường 320ml', 'Nước lon', 'Lon'),
  ('040', 'Mirinda Cam', 'Mirinda Cam 320ml', 'Nước đóng chai/lon', 'Lon'),
  ('041', 'Mirinda Xá Xị', 'Mirinda Xá Xị 320ml', 'Nước đóng chai/lon', 'Lon'),
  ('042', 'Rockstar', 'Rockstar 250ml', 'Nước lon', 'Lon')
) as drink(source_code, old_name, new_name, category, loose_unit)
where item.source_code = drink.source_code
  and item.name = drink.old_name
  and item.category = drink.category
  and item.large_unit = 'Lốc'
  and item.conversion_factor = 6
  and item.small_unit = drink.loose_unit;

update public.inventory_items as item
set sort_order = canonical.sort_order,
    updated_at = case when item.sort_order is distinct from canonical.sort_order then clock_timestamp() else item.updated_at end
from (values
  ('001', 1), ('002', 2), ('003', 3), ('004', 4), ('005', 5),
  ('018', 6), ('019', 7), ('020', 8), ('021', 9), ('022', 10),
  ('008', 11), ('009', 12), ('010', 13), ('011', 14), ('012', 15), ('013', 16),
  ('014', 17), ('015', 18), ('016', 19), ('017', 20), ('006', 21), ('007', 22),
  ('023', 23), ('024', 24), ('025', 25), ('026', 26), ('027', 27), ('028', 28),
  ('029', 29), ('030', 30), ('031', 31), ('032', 32), ('033', 33), ('034', 34),
  ('035', 35), ('036', 36), ('037', 37), ('038', 38), ('039', 39), ('040', 40),
  ('041', 41), ('042', 42), ('043', 43)
) as canonical(source_code, sort_order)
where item.source_code = canonical.source_code;

with mapped as (
  select count_item.owner_id, count_item.count_id, count_item.item_id,
    item.name as item_name,
    item.category,
    item.large_unit,
    item.conversion_factor,
    item.small_unit,
    item.count_large_unit_only,
    item.sort_order,
    case when item.large_unit is null then null
      when (lower(btrim(count_item.large_unit)) = lower(btrim(item.large_unit)) and count_item.large_quantity is not null)
        or (lower(btrim(count_item.small_unit)) = lower(btrim(item.large_unit)) and count_item.small_quantity is not null)
      then coalesce(case when lower(btrim(count_item.large_unit)) = lower(btrim(item.large_unit)) then count_item.large_quantity end, 0)
        + coalesce(case when lower(btrim(count_item.small_unit)) = lower(btrim(item.large_unit)) then count_item.small_quantity end, 0)
      else null
    end as large_quantity,
    case when item.source_code between '023' and '034'
      and lower(btrim(item.large_unit)) = 'chai'
      and item.conversion_factor = 1000
      and lower(btrim(item.small_unit)) = 'ml'
      and lower(btrim(count_item.small_unit)) = 'chai'
      and (count_item.large_quantity is not null or count_item.small_quantity is not null)
      then 0
      when (lower(btrim(count_item.large_unit)) = lower(btrim(item.small_unit)) and count_item.large_quantity is not null)
        or (lower(btrim(count_item.small_unit)) = lower(btrim(item.small_unit)) and count_item.small_quantity is not null)
      then coalesce(case when lower(btrim(count_item.large_unit)) = lower(btrim(item.small_unit)) then count_item.large_quantity end, 0)
        + coalesce(case when lower(btrim(count_item.small_unit)) = lower(btrim(item.small_unit)) then count_item.small_quantity end, 0)
      else null
    end as small_quantity,
    count_item.counted_at
  from public.inventory_count_items as count_item
  join public.inventory_counts as count_sheet
    on count_sheet.id = count_item.count_id and count_sheet.owner_id = count_item.owner_id
  join public.inventory_items as item
    on item.id = count_item.item_id and item.owner_id = count_item.owner_id
  where count_sheet.status = 'draft'
    and count_sheet.business_date = private.current_business_date_vn()
)
update public.inventory_count_items as count_item
set item_name = mapped.item_name,
    category = mapped.category,
    large_unit = mapped.large_unit,
    conversion_factor = mapped.conversion_factor,
    small_unit = mapped.small_unit,
    count_large_unit_only = mapped.count_large_unit_only,
    sort_order = mapped.sort_order,
    large_quantity = mapped.large_quantity,
    small_quantity = mapped.small_quantity,
    counted_at = case when mapped.large_quantity is null and mapped.small_quantity is null then null else mapped.counted_at end
from mapped
where count_item.owner_id = mapped.owner_id
  and count_item.count_id = mapped.count_id
  and count_item.item_id = mapped.item_id;
