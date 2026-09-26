-- Evidence remains private. Staff can read the current week and upload only
-- today's files; only the owner can remove evidence or edit its labels.
revoke insert, update, delete on public.day_photos from authenticated;
grant select on public.day_photos to authenticated;

create or replace function private.evidence_path_owner(p_path text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_path is null or split_part(p_path, '/', 1) = '' then
    return null;
  end if;
  return split_part(p_path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
revoke all on function private.evidence_path_owner(text) from public, anon;
grant execute on function private.evidence_path_owner(text) to authenticated;

create or replace function private.evidence_path_date(p_path text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_path is null or split_part(p_path, '/', 2) = '' then
    return null;
  end if;
  return split_part(p_path, '/', 2)::date;
exception when others then
  return null;
end;
$$;
revoke all on function private.evidence_path_date(text) from public, anon;
grant execute on function private.evidence_path_date(text) to authenticated;

drop policy if exists "day_photos owner select" on public.day_photos;
drop policy if exists "staff reads current week evidence" on public.day_photos;
create policy "day photos owner or staff select"
  on public.day_photos for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

create policy "staff views current week evidence files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'betea-evidence'
    and private.is_active_store_member(private.evidence_path_owner(name))
    and private.evidence_path_date(name) >= private.current_week_start_vn()
    and private.evidence_path_date(name) <= private.current_week_start_vn() + 6
  );

create policy "staff uploads today's evidence files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'betea-evidence'
    and private.is_active_store_member(private.evidence_path_owner(name))
    and private.evidence_path_owner(name) = private.staff_owner_id()
    and private.evidence_path_date(name) = private.current_business_date_vn()
  );

create policy "staff removes today's orphan evidence files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'betea-evidence'
    and private.is_active_store_member(private.evidence_path_owner(name))
    and private.evidence_path_owner(name) = private.staff_owner_id()
    and private.evidence_path_date(name) = private.current_business_date_vn()
    and not exists (select 1 from public.day_photos as photo where photo.object_path = storage.objects.name)
  );

create or replace function public.owner_create_day_photo(
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
  if current_owner_id is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  if p_business_date < date '2026-09-01' then raise exception 'Invalid business date'; end if;
  if p_category not in ('bluebook', 'cleaning', 'arrangement', 'other') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if p_object_path is null or length(p_object_path) > 360 or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3) or split_part(p_object_path, '/', 4) <> '' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.day_photos (owner_id, business_date, shift_code, category, object_path, caption)
  values (current_owner_id, p_business_date, normalized_shift, p_category, p_object_path, normalized_caption)
  on conflict (object_path) do update set
    shift_code = excluded.shift_code,
    category = excluded.category,
    caption = excluded.caption
  returning id into photo_id;
  return photo_id;
end;
$$;
revoke all on function public.owner_create_day_photo(date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.owner_create_day_photo(date,text,text,text,text) to authenticated;

create or replace function public.staff_create_day_photo(
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
  if current_owner_id is null then raise exception 'Active staff authorization required'; end if;
  if p_business_date <> private.current_business_date_vn() then raise exception 'Staff can edit today only'; end if;
  if p_category not in ('bluebook', 'cleaning', 'arrangement', 'other') then raise exception 'Invalid photo category'; end if;
  if normalized_shift is not null and normalized_shift not in ('06-10', '10-14', '14-18', '18-22') then raise exception 'Invalid shift code'; end if;
  if p_object_path is null or length(p_object_path) > 360 or p_object_path <> current_owner_id::text || '/' || p_business_date::text || '/' || split_part(p_object_path, '/', 3) or split_part(p_object_path, '/', 4) <> '' then
    raise exception 'Invalid evidence path';
  end if;
  if normalized_caption is not null and length(normalized_caption) > 240 then raise exception 'Caption too long'; end if;

  insert into public.daily_records (owner_id, business_date)
  values (current_owner_id, p_business_date)
  on conflict (owner_id, business_date) do nothing;
  insert into public.day_photos (owner_id, business_date, shift_code, category, object_path, caption)
  values (current_owner_id, p_business_date, normalized_shift, p_category, p_object_path, normalized_caption)
  on conflict (object_path) do update set
    shift_code = excluded.shift_code,
    category = excluded.category,
    caption = excluded.caption
  returning id into photo_id;
  return photo_id;
end;
$$;
revoke all on function public.staff_create_day_photo(date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.staff_create_day_photo(date,text,text,text,text) to authenticated;

create or replace function public.owner_delete_day_photo(p_business_date date, p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_store_owner() then raise exception 'Owner authorization required'; end if;
  delete from public.day_photos
  where id = p_photo_id and owner_id = (select auth.uid()) and business_date = p_business_date;
  if not found then raise exception 'Photo not found'; end if;
end;
$$;
revoke all on function public.owner_delete_day_photo(date,uuid) from public, anon, authenticated;
grant execute on function public.owner_delete_day_photo(date,uuid) to authenticated;
