create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  source_code text,
  name text not null check (length(trim(name)) > 0),
  category text not null check (length(trim(category)) > 0),
  large_unit text not null check (length(trim(large_unit)) > 0),
  conversion_factor numeric(14, 3) not null check (conversion_factor > 0),
  small_unit text not null check (length(trim(small_unit)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_code)
);

alter table public.inventory_items enable row level security;
revoke all on public.inventory_items from anon, authenticated;
grant select on public.inventory_items to authenticated;
create policy "active store members read inventory catalog"
  on public.inventory_items for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or private.is_active_store_member(owner_id)
  );

create or replace function private.seed_inventory_catalog_for_owner(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_items (
    owner_id, source_code, name, category, large_unit, conversion_factor, small_unit
  )
  select p_owner_id, seed.source_code, seed.name, seed.category,
    seed.large_unit, seed.conversion_factor, seed.small_unit
  from (values
    ('001', 'Đường cát', 'Nguyên liệu', 'Kg', 1000, 'Gr'),
    ('002', 'Sữa Đặc', 'Nguyên liệu', 'Hộp', 1200, 'Ml'),
    ('003', 'Sữa tươi', 'Nguyên liệu', 'Hộp', 900, 'Ml'),
    ('004', 'Chanh', 'Nguyên liệu', 'Kg', 1000, 'Gr'),
    ('005', 'Mật Ong', 'Nguyên liệu', 'Chai', 1000, 'Ml'),
    ('006', 'Khăn giấy', 'Vật tư', 'Gói', 1, 'Gói'),
    ('007', 'Bao rác', 'Vật tư', 'KG', 1000, 'Gr'),
    ('008', 'Ly 12oz', 'Bao bì', 'Cái', 1, 'Cái'),
    ('009', 'Ly 16oz', 'Bao bì', 'Cái', 1, 'Cái'),
    ('010', 'Ly 20oz', 'Bao bì', 'Cái', 1, 'Cái'),
    ('011', 'Cuộn màng dập ly', 'Bao bì', 'Cuộn', 1, 'Cuộn'),
    ('012', 'Túi T', 'Bao bì', 'Túi', 1000, 'Gr'),
    ('013', 'Túi đôi', 'Bao bì', 'Túi', 1000, 'Gr'),
    ('014', 'Ống hút phi 6', 'Bao bì', 'Cây', 10, 'Bịch'),
    ('015', 'Ống hút phi 12', 'Bao bì', 'Cây', 10, 'Bịch'),
    ('016', 'Muỗng', 'Bao bì', 'Thùng', 2000, 'Cái'),
    ('017', 'Giấy in bill', 'Vật tư', 'Cuộn', 100, 'Cái'),
    ('018', 'Hồng Trà', 'Nguyên liệu', 'Gói', 1000, 'Gr'),
    ('019', 'Lục Hoàng Trà', 'Nguyên liệu', 'Gói', 1000, 'Gr'),
    ('020', 'Oolong Chi Tử', 'Nguyên liệu', 'Gói', 999, 'Gr'),
    ('021', 'Bột MT-35', 'Nguyên liệu', 'Kg', 1000, 'Gr'),
    ('022', 'Trân Châu Hoàng Kim', 'Topping', 'Hộp', 3000, 'Gr'),
    ('023', 'Trà Atisô Cam Đào', 'Đồ uống đóng chai', 'Chai', 1, 'Chai'),
    ('024', 'Trà Atisô Cam Xoài', 'Đồ uống đóng chai', 'Chai', 1, 'Chai'),
    ('025', 'Trà Hibiscus', 'Đồ uống đóng chai', 'Chai', 1, 'Chai'),
    ('026', 'Kombucha Nguyên Bản', 'Kombucha', 'Chai', 1, 'Chai'),
    ('027', 'Kombucha Ổi', 'Kombucha', 'Chai', 1, 'Chai'),
    ('028', 'Kombucha Đào', 'Kombucha', 'Chai', 1, 'Chai'),
    ('029', 'Kombucha Táo', 'Kombucha', 'Chai', 1, 'Chai'),
    ('030', 'Kombucha Vải', 'Kombucha', 'Chai', 1, 'Chai'),
    ('031', 'Kombucha Nho', 'Kombucha', 'Chai', 1, 'Chai'),
    ('032', 'Kombucha Hibiscus', 'Kombucha', 'Chai', 1, 'Chai'),
    ('033', 'Kombucha Dâu Tây', 'Kombucha', 'Chai', 1, 'Chai'),
    ('034', 'Kombucha Việt Quất', 'Kombucha', 'Chai', 1, 'Chai'),
    ('035', 'Soda', 'Nước lon', 'Lon', 1, 'Lon'),
    ('036', 'Pepsi', 'Nước lon', 'Thùng', 24, 'Lon'),
    ('037', '7 UP', 'Nước lon', 'Lon', 1, 'Lon'),
    ('038', 'Sting', 'Nước lon', 'Lon', 1, 'Lon'),
    ('039', 'Sting ít đường', 'Nước lon', 'Lon', 1, 'Lon'),
    ('040', 'Mirinda Cam', 'Nước đóng chai/lon', 'Đơn vị', 1, 'Đơn vị'),
    ('041', 'Mirinda Xá Xị', 'Nước đóng chai/lon', 'Đơn vị', 1, 'Đơn vị'),
    ('042', 'Rockstar', 'Nước lon', 'Lon', 1, 'Lon'),
    ('043', 'Juicy Milk Dâu', 'Nước đóng chai/lon', 'Đơn vị', 1, 'Đơn vị')
  ) as seed(source_code, name, category, large_unit, conversion_factor, small_unit)
  on conflict (owner_id, source_code) do nothing;
end;
$$;
revoke all on function private.seed_inventory_catalog_for_owner(uuid) from public, anon, authenticated;

create or replace function private.seed_inventory_catalog_after_owner_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_inventory_catalog_for_owner(new.user_id);
  return new;
end;
$$;
revoke all on function private.seed_inventory_catalog_after_owner_insert() from public, anon, authenticated;

create trigger seed_inventory_catalog_after_owner_insert
  after insert on public.owner_profiles
  for each row execute function private.seed_inventory_catalog_after_owner_insert();

do $$
declare
  existing_owner record;
begin
  for existing_owner in select user_id from public.owner_profiles loop
    perform private.seed_inventory_catalog_for_owner(existing_owner.user_id);
  end loop;
end;
$$;
