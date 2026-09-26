alter table public.store_memberships
  add column staff_session_valid_after timestamptz not null default '-infinity';

create or replace function private.is_current_staff_auth_session(
  p_user_id uuid,
  p_valid_after timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    and coalesce(
      (select (auth.jwt() ->> 'iat')::bigint >= ceil(extract(epoch from p_valid_after))),
      false
    )
    and exists (
      select 1
      from auth.sessions as session_record
      where session_record.id = (select nullif(auth.jwt() ->> 'session_id', '')::uuid)
        and session_record.user_id = p_user_id
    );
$$;
revoke all on function private.is_current_staff_auth_session(uuid, timestamptz) from public, anon;
grant execute on function private.is_current_staff_auth_session(uuid, timestamptz) to authenticated;

drop policy if exists "staff reads own active membership" on public.store_memberships;
create policy "staff reads own active membership"
  on public.store_memberships for select to authenticated
  using (
    active
    and user_id = (select auth.uid())
    and private.is_current_staff_auth_session(user_id, staff_session_valid_after)
  );

create or replace function private.is_active_store_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships as membership
    where membership.owner_id = p_owner_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'staff'
      and membership.active
      and private.is_current_staff_auth_session(membership.user_id, membership.staff_session_valid_after)
  );
$$;
revoke all on function private.is_active_store_member(uuid) from public, anon;
grant execute on function private.is_active_store_member(uuid) to authenticated;

create or replace function public.owner_update_staff_membership(
  p_membership_id uuid,
  p_email text,
  p_display_name text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  before_data jsonb;
  after_data jsonb;
  normalized_email text := lower(trim(p_email));
  normalized_name text := trim(p_display_name);
  auth_email text;
  staff_user_id uuid;
  was_active boolean;
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;
  if length(normalized_email) not between 1 and 254 then
    raise exception 'Invalid staff email';
  end if;
  if length(normalized_name) not between 1 and 100 or p_active is null then
    raise exception 'Invalid staff profile';
  end if;

  select jsonb_build_object('email', membership.email, 'display_name', membership.display_name, 'active', membership.active),
         membership.user_id,
         membership.active
    into before_data, staff_user_id, was_active
  from public.store_memberships as membership
  where membership.id = p_membership_id and membership.owner_id = current_owner_id
  for update;

  if before_data is null then raise exception 'Staff account not found'; end if;
  select lower(trim(user_account.email)) into auth_email
  from auth.users as user_account
  where user_account.id = staff_user_id;
  if auth_email is null or auth_email <> normalized_email then
    raise exception 'Staff email does not match Auth account';
  end if;

  update public.store_memberships set
    email = normalized_email,
    display_name = normalized_name,
    active = p_active,
    staff_session_valid_after = case
      when was_active is distinct from p_active then clock_timestamp()
      else staff_session_valid_after
    end,
    updated_at = now()
  where id = p_membership_id and owner_id = current_owner_id;

  after_data := jsonb_build_object('email', normalized_email, 'display_name', normalized_name, 'active', p_active);
  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    current_owner_id, current_owner_id, 'owner', 'store_memberships', p_membership_id::text, 'UPDATE', before_data, after_data
  );
end;
$$;
revoke all on function public.owner_update_staff_membership(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.owner_update_staff_membership(uuid, text, text, boolean) to authenticated;

create or replace function public.owner_begin_staff_password_reset(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  account_data jsonb;
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;

  select jsonb_build_object('email', membership.email, 'display_name', membership.display_name, 'active', membership.active)
    into account_data
  from public.store_memberships as membership
  where membership.id = p_membership_id and membership.owner_id = current_owner_id
  for update;
  if account_data is null then raise exception 'Staff account not found'; end if;

  update public.store_memberships
    set staff_session_valid_after = clock_timestamp(), updated_at = now()
    where id = p_membership_id and owner_id = current_owner_id;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, after_data
  ) values (
    current_owner_id, current_owner_id, 'owner', 'staff_password_resets', p_membership_id::text, 'INSERT',
    account_data || jsonb_build_object('event', 'password_reset_requested')
  );
end;
$$;

create or replace function public.owner_finish_staff_password_reset(
  p_membership_id uuid,
  p_succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  account_data jsonb;
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;
  if p_succeeded is null then raise exception 'Invalid reset result'; end if;

  select jsonb_build_object('email', membership.email, 'display_name', membership.display_name, 'active', membership.active)
    into account_data
  from public.store_memberships as membership
  where membership.id = p_membership_id and membership.owner_id = current_owner_id;
  if account_data is null then raise exception 'Staff account not found'; end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, after_data
  ) values (
    current_owner_id, current_owner_id, 'owner', 'staff_password_resets', p_membership_id::text, 'INSERT',
    account_data || jsonb_build_object('event', case when p_succeeded then 'password_reset' else 'password_reset_failed' end)
  );
end;
$$;

drop function if exists public.owner_log_staff_password_reset(uuid);
revoke all on function public.owner_begin_staff_password_reset(uuid) from public, anon, authenticated;
revoke all on function public.owner_finish_staff_password_reset(uuid, boolean) from public, anon, authenticated;
grant execute on function public.owner_begin_staff_password_reset(uuid) to authenticated;
grant execute on function public.owner_finish_staff_password_reset(uuid, boolean) to authenticated;
