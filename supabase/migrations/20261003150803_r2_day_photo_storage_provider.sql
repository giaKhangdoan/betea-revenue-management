-- Keep evidence metadata in Supabase while allowing the object itself to live
-- in either the existing private Supabase bucket or the private R2 bucket.
alter table public.day_photos
  add column if not exists storage_provider text not null default 'supabase';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.day_photos'::regclass
      and conname = 'day_photos_storage_provider_check'
  ) then
    alter table public.day_photos
      add constraint day_photos_storage_provider_check
      check (storage_provider in ('supabase', 'r2'));
  end if;
end $$;

comment on column public.day_photos.storage_provider is
  'Private object storage provider for this evidence image: supabase or r2.';

create or replace function public.owner_create_day_photo_r2(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;
  if p_business_date < date '2026-09-01' then
    raise exception 'Invalid business date';
  end if;
  if p_category not in ('bluebook', 'cleaning', 'arrangement', 'other') then
    raise exception 'Invalid photo category';
  end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then
    raise exception 'Invalid shift code';
  end if;
  if p_object_path is null
    or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then
    raise exception 'Caption too long';
  end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  insert into public.day_photos (owner_id, business_date, shift_code, category, object_path, caption, storage_provider)
  values (current_owner_id, p_business_date, normalized_shift, p_category, p_object_path, normalized_caption, 'r2')
  on conflict (object_path) do nothing
  returning id into photo_id;

  if photo_id is null then
    select id into photo_id
    from public.day_photos
    where object_path = p_object_path
      and owner_id = current_owner_id
      and business_date = p_business_date
      and storage_provider = 'r2';
    if photo_id is null then
      raise exception 'Evidence path is already in use';
    end if;
  end if;

  return photo_id;
end;
$$;
revoke all on function public.owner_create_day_photo_r2(date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.owner_create_day_photo_r2(date,text,text,text,text) to authenticated;

create or replace function public.staff_create_day_photo_r2(
  p_business_date date,
  p_category text,
  p_shift_code text,
  p_object_path text,
  p_caption text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select private.staff_owner_id());
  photo_id uuid;
  normalized_shift text := nullif(trim(p_shift_code), '');
  normalized_caption text := nullif(trim(p_caption), '');
begin
  if current_owner_id is null then
    raise exception 'Active staff authorization required';
  end if;
  if p_business_date <> private.current_business_date_vn() then
    raise exception 'Staff can edit today only';
  end if;
  if p_category not in ('bluebook', 'cleaning', 'arrangement', 'other') then
    raise exception 'Invalid photo category';
  end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then
    raise exception 'Invalid shift code';
  end if;
  if p_object_path is null
    or length(p_object_path) > 360
    or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3)
    or split_part(p_object_path, '/', 4) <> ''
    or split_part(p_object_path, '/', 3) !~* '^[0-9a-f-]{36}\.(jpg|png|webp)$' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then
    raise exception 'Caption too long';
  end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;

  insert into public.day_photos (owner_id, business_date, shift_code, category, object_path, caption, storage_provider)
  values (current_owner_id, p_business_date, normalized_shift, p_category, p_object_path, normalized_caption, 'r2')
  on conflict (object_path) do nothing
  returning id into photo_id;

  if photo_id is null then
    select id into photo_id
    from public.day_photos
    where object_path = p_object_path
      and owner_id = current_owner_id
      and business_date = p_business_date
      and storage_provider = 'r2';
    if photo_id is null then
      raise exception 'Evidence path is already in use';
    end if;
  end if;

  return photo_id;
end;
$$;
revoke all on function public.staff_create_day_photo_r2(date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.staff_create_day_photo_r2(date,text,text,text,text) to authenticated;
