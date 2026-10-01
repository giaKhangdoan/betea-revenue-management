alter table public.inventory_items
  add constraint inventory_items_indivisible_factor_integral check (
    lower(btrim(small_unit)) in ('gr', 'g', 'mg', 'ml', 'kg', 'l', 'lít')
    or conversion_factor = trunc(conversion_factor)
  );
