update public.inventory_items
set large_unit = null,
    conversion_factor = null,
    small_unit = 'Chai',
    updated_at = clock_timestamp()
where source_code between '023' and '034'
  and category in ('Đồ uống đóng chai', 'Kombucha')
  and large_unit = 'Chai'
  and conversion_factor = 1000
  and small_unit = 'Ml';

update public.inventory_items as item
set large_unit = restore.large_unit,
    conversion_factor = restore.conversion_factor,
    small_unit = restore.small_unit,
    updated_at = clock_timestamp()
from (values
  ('035', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('035', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('036', 'Nước lon', 'Thùng', 24::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('036', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('037', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('037', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('038', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('038', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('039', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('039', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('040', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('040', 'Nước đóng chai/lon', null::text, null::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('041', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('041', 'Nước đóng chai/lon', null::text, null::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Lon'),
  ('042', 'Nước lon', 'Lon', 1::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('042', 'Nước lon', null::text, null::numeric, 'Lon', 'Lốc', 6::numeric, 'Lon'),
  ('043', 'Nước đóng chai/lon', 'Đơn vị', 1::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Chai'),
  ('043', 'Nước đóng chai/lon', null::text, null::numeric, 'Đơn vị', 'Lốc', 6::numeric, 'Chai')
) as restore(source_code, category, old_large_unit, old_factor, old_small_unit, large_unit, conversion_factor, small_unit)
where item.source_code = restore.source_code
  and item.category = restore.category
  and item.large_unit is not distinct from restore.old_large_unit
  and item.conversion_factor is not distinct from restore.old_factor
  and item.small_unit = restore.old_small_unit;
