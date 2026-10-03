alter table public.inventory_items
  add column if not exists sort_order integer not null default 1000;

alter table public.inventory_count_items
  add column if not exists sort_order integer not null default 1000;

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
