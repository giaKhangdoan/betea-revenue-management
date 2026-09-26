-- Consolidate owner/staff policies after the allowlisted RPC rollout. The
-- previous staff DML policies are intentionally removed because direct table
-- writes are no longer part of the staff contract.
drop policy if exists "staff reads current week daily sales" on public.daily_records;
drop policy if exists "daily_records owner select" on public.daily_records;
drop policy if exists "daily records owner or staff select" on public.daily_records;
create policy "daily records owner or staff select"
  on public.daily_records for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

drop policy if exists "staff reads current week incidental expenses" on public.daily_expenses;
drop policy if exists "daily_expenses owner select" on public.daily_expenses;
drop policy if exists "daily expenses owner or staff select" on public.daily_expenses;
create policy "daily expenses owner or staff select"
  on public.daily_expenses for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and deleted_at is null
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );
drop policy if exists "staff inserts today's daily sales" on public.daily_records;
drop policy if exists "staff updates today's daily sales" on public.daily_records;
drop policy if exists "staff inserts today's incidental expenses" on public.daily_expenses;
drop policy if exists "staff updates today's incidental expenses" on public.daily_expenses;

drop policy if exists "staff reads own active membership" on public.store_memberships;
drop policy if exists "store owner reads own memberships" on public.store_memberships;
drop policy if exists "membership owner or current staff select" on public.store_memberships;
create policy "membership owner or current staff select"
  on public.store_memberships for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (active and user_id = (select auth.uid())
      and private.is_current_staff_auth_session(user_id, staff_session_valid_after))
  );

drop policy if exists "staff reads current week evidence" on public.day_photos;
drop policy if exists "day_photos owner select" on public.day_photos;
drop policy if exists "day photos owner or staff select" on public.day_photos;
create policy "day photos owner or staff select"
  on public.day_photos for select to authenticated
  using (
    (private.is_store_owner() and owner_id = (select auth.uid()))
    or (private.is_active_store_member(owner_id)
      and business_date >= private.current_week_start_vn()
      and business_date <= private.current_week_start_vn() + 6)
  );

create index if not exists daily_expenses_deleted_by_idx on public.daily_expenses (deleted_by);
create index if not exists daily_shift_deletions_deleted_by_idx on public.daily_shift_deletions (deleted_by);
create index if not exists daily_shift_deletions_restored_by_idx on public.daily_shift_deletions (restored_by);

drop policy if exists "staff removes today's orphan evidence files" on storage.objects;
create policy "staff removes today's orphan evidence files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'betea-evidence'
    and private.is_active_store_member(private.evidence_path_owner(name))
    and private.evidence_path_owner(name) = private.staff_owner_id()
    and private.evidence_path_date(name) = private.current_business_date_vn()
    and not exists (select 1 from public.day_photos as photo where photo.object_path = storage.objects.name)
  );
