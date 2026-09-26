revoke insert, update, delete on public.store_memberships from authenticated;

create or replace function public.owner_create_staff_membership(
  p_user_id uuid,
  p_email text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
  membership_id uuid;
  normalized_email text := lower(trim(p_email));
  normalized_name text := trim(p_display_name);
  auth_email text;
begin
  if current_owner_id is null or not private.is_store_owner() then
    raise exception 'Owner authorization required';
  end if;
  if p_user_id is null or p_user_id = current_owner_id then
    raise exception 'Invalid staff user';
  end if;
  select lower(trim(user_account.email)) into auth_email
  from auth.users as user_account
  where user_account.id = p_user_id;
  if auth_email is null or auth_email <> normalized_email then
    raise exception 'Staff email does not match Auth account';
  end if;
  if normalized_email = '' or length(normalized_email) > 254 then
    raise exception 'Invalid staff email';
  end if;
  if length(normalized_name) not between 1 and 100 then
    raise exception 'Invalid staff display name';
  end if;

  insert into public.store_memberships (owner_id, user_id, email, display_name, role, active)
  values (current_owner_id, p_user_id, normalized_email, normalized_name, 'staff', true)
  returning id into membership_id;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, after_data
  ) values (
    current_owner_id, current_owner_id, 'owner', 'store_memberships', membership_id::text, 'INSERT',
    jsonb_build_object('email', normalized_email, 'display_name', normalized_name, 'active', true)
  );

  return membership_id;
end;
$$;

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
         membership.user_id
    into before_data, staff_user_id
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

create or replace function public.owner_log_staff_password_reset(p_membership_id uuid)
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
  where membership.id = p_membership_id and membership.owner_id = current_owner_id;
  if account_data is null then raise exception 'Staff account not found'; end if;

  insert into public.audit_events (
    owner_id, actor_id, actor_type, table_name, record_id, action, before_data, after_data
  ) values (
    current_owner_id, current_owner_id, 'owner', 'staff_password_resets', p_membership_id::text, 'INSERT',
    account_data, account_data || jsonb_build_object('event', 'password_reset')
  );
end;
$$;

revoke all on function public.owner_create_staff_membership(uuid, text, text) from public, anon, authenticated;
revoke all on function public.owner_update_staff_membership(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.owner_log_staff_password_reset(uuid) from public, anon, authenticated;
grant execute on function public.owner_create_staff_membership(uuid, text, text) to authenticated;
grant execute on function public.owner_update_staff_membership(uuid, text, text, boolean) to authenticated;
grant execute on function public.owner_log_staff_password_reset(uuid) to authenticated;
