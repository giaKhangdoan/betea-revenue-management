-- Inventory history is reconstructed from immutable, time-stamped states.
-- A transactional counter provides a deterministic tie-breaker after the per-store lock.
create table private.inventory_history_clock (
  singleton boolean primary key default true check (singleton),
  last_sequence bigint not null default 0 check (last_sequence >= 0)
);
insert into private.inventory_history_clock (singleton, last_sequence) values (true, 0);
revoke all on private.inventory_history_clock from public, anon, authenticated, service_role;

create table public.inventory_receipt_versions (
  owner_id uuid not null references public.owner_profiles (user_id) on delete restrict,
  receipt_id uuid not null,
  effective_at timestamptz not null,
  sequence_no bigint not null unique,
  event_type text not null check (event_type in ('receipt_created', 'receipt_corrected', 'receipt_backfill')),
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_label text not null,
  reason text,
  lines_snapshot jsonb not null check (jsonb_typeof(lines_snapshot) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, receipt_id, sequence_no),
  foreign key (owner_id, receipt_id)
    references public.inventory_receipts (owner_id, id) on delete restrict,
  check (event_type <> 'receipt_corrected' or (reason is not null and length(btrim(reason)) > 0))
);

create index inventory_receipt_versions_as_of_idx
  on public.inventory_receipt_versions (owner_id, receipt_id, effective_at, sequence_no);

create table public.inventory_count_versions (
  owner_id uuid not null references public.owner_profiles (user_id) on delete restrict,
  count_id uuid not null,
  effective_at timestamptz not null,
  sequence_no bigint not null unique,
  event_type text not null check (event_type in ('count_finalized', 'count_corrected', 'count_backfill')),
  actor_id uuid not null references auth.users (id) on delete restrict,
  actor_label text not null,
  reason text,
  items_snapshot jsonb not null check (jsonb_typeof(items_snapshot) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, count_id, sequence_no),
  foreign key (owner_id, count_id)
    references public.inventory_counts (owner_id, id) on delete restrict,
  check (event_type <> 'count_corrected' or (reason is not null and length(btrim(reason)) > 0))
);

create index inventory_count_versions_as_of_idx
  on public.inventory_count_versions (owner_id, count_id, effective_at, sequence_no);

create table public.inventory_history_backfill_status (
  owner_id uuid not null references public.owner_profiles (user_id) on delete restrict,
  entity_type text not null check (entity_type in ('receipt', 'count')),
  entity_id uuid not null,
  status text not null check (status in ('verified', 'unverified')),
  reason text,
  snapshots_created integer not null default 0 check (snapshots_created >= 0),
  checked_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, entity_type, entity_id)
);

alter table public.inventory_receipt_versions enable row level security;
alter table public.inventory_count_versions enable row level security;
alter table public.inventory_history_backfill_status enable row level security;
revoke all on public.inventory_receipt_versions, public.inventory_count_versions,
  public.inventory_history_backfill_status from public, anon, authenticated, service_role;
grant select on public.inventory_receipt_versions, public.inventory_count_versions,
  public.inventory_history_backfill_status to authenticated;

create policy "store owner reads receipt history versions"
  on public.inventory_receipt_versions for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "store owner reads count history versions"
  on public.inventory_count_versions for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "store owner reads history backfill status"
  on public.inventory_history_backfill_status for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

-- Canonical comparison keys ignore storage type differences (JSON numbers vs text)
-- while retaining every quantity, unit and item identity used by movement reports.
create function private.inventory_history_snapshot_state_key(p_entity_type text, p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  if p_entity_type not in ('receipt', 'count')
    or jsonb_typeof(p_snapshot) is distinct from 'array'
    or jsonb_array_length(p_snapshot) = 0 then
    return null;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_snapshot) as snapshot(value)
    where jsonb_typeof(snapshot.value) is distinct from 'object'
  ) then
    return null;
  end if;

  if p_entity_type = 'receipt' then
    if exists (
      select 1 from jsonb_array_elements(p_snapshot) as snapshot(value)
      where nullif(snapshot.value ->> 'item_id', '') is null
        or nullif(snapshot.value ->> 'item_name', '') is null
        or nullif(snapshot.value ->> 'small_unit', '') is null
        or nullif(snapshot.value ->> 'converted_quantity', '') is null
        or nullif(snapshot.value ->> 'line_number', '') is null
        or (snapshot.value ->> 'line_number') !~ '^[0-9]+$'
        or snapshot.value ->> 'created_at' is null
    ) or (
      select count(*) <> count(distinct snapshot.value ->> 'line_number')
      from jsonb_array_elements(p_snapshot) as snapshot(value)
    ) then
      return null;
    end if;
    select jsonb_agg(jsonb_build_array(
      snapshot.value ->> 'line_number', snapshot.value ->> 'item_id', snapshot.value ->> 'item_name',
      snapshot.value ->> 'category', snapshot.value ->> 'large_unit', snapshot.value ->> 'large_quantity',
      snapshot.value ->> 'conversion_factor', snapshot.value ->> 'small_unit',
      snapshot.value ->> 'loose_quantity', snapshot.value ->> 'converted_quantity'
    ) order by (snapshot.value ->> 'line_number')::integer)
    into v_state
    from jsonb_array_elements(p_snapshot) as snapshot(value);
  else
    if exists (
      select 1 from jsonb_array_elements(p_snapshot) as snapshot(value)
      where nullif(snapshot.value ->> 'item_id', '') is null
        or nullif(snapshot.value ->> 'item_name', '') is null
        or nullif(snapshot.value ->> 'small_unit', '') is null
        or nullif(snapshot.value ->> 'counted_quantity', '') is null
    ) or (
      select count(*) <> count(distinct snapshot.value ->> 'item_id')
      from jsonb_array_elements(p_snapshot) as snapshot(value)
    ) then
      return null;
    end if;
    select jsonb_agg(jsonb_build_array(
      snapshot.value ->> 'item_id', snapshot.value ->> 'item_name', snapshot.value ->> 'large_unit',
      snapshot.value ->> 'conversion_factor', snapshot.value ->> 'small_unit',
      snapshot.value ->> 'large_quantity', snapshot.value ->> 'small_quantity',
      snapshot.value ->> 'counted_quantity'
    ) order by snapshot.value ->> 'item_id')
    into v_state
    from jsonb_array_elements(p_snapshot) as snapshot(value);
  end if;
  return v_state;
exception when others then
  return null;
end;
$$;
revoke all on function private.inventory_history_snapshot_state_key(text, jsonb)
  from public, anon, authenticated, service_role;

-- Receipt corrections retain only their before-state. Reconstruct an after-state
-- from the next before-state only when the whole correction chain is well-formed,
-- timestamp ordered, and the current header still points at its last correction.
create function private.inventory_receipt_correction_history_problem(p_owner_id uuid, p_receipt_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_receipt public.inventory_receipts%rowtype;
  v_correction record;
  v_previous_at timestamptz;
  v_last_at timestamptz;
  v_last_actor uuid;
  v_lines_snapshot jsonb;
  v_has_corrections boolean := false;
begin
  select * into v_receipt from public.inventory_receipts
  where owner_id = p_owner_id and id = p_receipt_id;
  if not found then return 'Receipt header is missing.'; end if;

  for v_correction in
    select correction.corrected_at, correction.corrected_by, correction.prior_lines
    from public.inventory_receipt_corrections as correction
    where correction.owner_id = p_owner_id and correction.receipt_id = p_receipt_id
    order by correction.corrected_at, correction.id
  loop
    v_has_corrections := true;
    if v_previous_at is not null and v_correction.corrected_at <= v_previous_at then
      return 'Correction timestamps tie or move backwards; event order is ambiguous.';
    end if;
    if v_correction.corrected_at <= v_receipt.received_at then
      return 'A correction does not occur after the receipt was created.';
    end if;
    if private.inventory_history_snapshot_state_key('receipt', v_correction.prior_lines) is null then
      return 'A receipt correction before-state is incomplete or malformed.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_correction.prior_lines) as line(value)
      where (line.value ->> 'created_at')::timestamptz > v_correction.corrected_at
    ) then
      return 'A receipt before-state contains a line created after its correction.';
    end if;
    v_previous_at := v_correction.corrected_at;
    v_last_at := v_correction.corrected_at;
    v_last_actor := v_correction.corrected_by;
  end loop;
  if not v_has_corrections then return 'No receipt correction rows exist.'; end if;

  if v_receipt.updated_by is distinct from v_last_actor
    or v_receipt.updated_at < v_last_at - interval '5 minutes'
    or v_receipt.updated_at > v_last_at + interval '5 minutes' then
    return 'Current receipt header does not corroborate the last correction.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(line) order by line.line_number, line.id), '[]'::jsonb)
  into v_lines_snapshot
  from public.inventory_receipt_lines as line
  where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id;
  if private.inventory_history_snapshot_state_key('receipt', v_lines_snapshot) is null then
    return 'Current receipt lines are incomplete or malformed.';
  end if;
  return null;
exception when others then
  return 'Receipt correction timeline contains an invalid timestamp or snapshot.';
end;
$$;
revoke all on function private.inventory_receipt_correction_history_problem(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.inventory_count_correction_history_problem(p_owner_id uuid, p_count_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_correction record;
  v_previous_at timestamptz;
  v_previous_after jsonb;
  v_prior_state jsonb;
  v_after_state jsonb;
  v_current_snapshot jsonb;
  v_has_corrections boolean := false;
begin
  select * into v_count from public.inventory_counts
  where owner_id = p_owner_id and id = p_count_id and status = 'finalized' and finalized_at is not null;
  if not found then return 'Finalized count header is missing.'; end if;

  for v_correction in
    select correction.corrected_at, correction.prior_items, correction.updated_items
    from public.inventory_count_corrections as correction
    where correction.owner_id = p_owner_id and correction.count_id = p_count_id
    order by correction.corrected_at, correction.id
  loop
    v_has_corrections := true;
    if v_previous_at is not null and v_correction.corrected_at <= v_previous_at then
      return 'Correction timestamps tie or move backwards; event order is ambiguous.';
    end if;
    if v_correction.corrected_at <= v_count.finalized_at then
      return 'A correction does not occur after the count was finalized.';
    end if;
    v_prior_state := private.inventory_history_snapshot_state_key('count', v_correction.prior_items);
    v_after_state := private.inventory_history_snapshot_state_key('count', v_correction.updated_items);
    if v_prior_state is null or v_after_state is null then
      return 'A count correction before-state or after-state is incomplete or malformed.';
    end if;
    if v_previous_after is not null and v_previous_after is distinct from v_prior_state then
      return 'A count correction before-state does not match the previous correction after-state.';
    end if;
    v_previous_at := v_correction.corrected_at;
    v_previous_after := v_after_state;
  end loop;
  if not v_has_corrections then return 'No count correction rows exist.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.item_id,
    'item_name', item.item_name,
    'large_unit', item.large_unit,
    'conversion_factor', item.conversion_factor::text,
    'small_unit', item.small_unit,
    'large_quantity', item.large_quantity::text,
    'small_quantity', item.small_quantity::text,
    'counted_quantity', item.counted_quantity::text
  ) order by item.item_id), '[]'::jsonb)
  into v_current_snapshot
  from public.inventory_count_items as item
  where item.owner_id = p_owner_id and item.count_id = p_count_id;
  if v_previous_after is distinct from private.inventory_history_snapshot_state_key('count', v_current_snapshot) then
    return 'Current finalized count does not match the last correction after-state.';
  end if;
  return null;
exception when others then
  return 'Count correction timeline contains an invalid timestamp or snapshot.';
end;
$$;
revoke all on function private.inventory_count_correction_history_problem(uuid, uuid)
  from public, anon, authenticated, service_role;

-- A same-owner receipt and finalized count at the exact same legacy time has no
-- recoverable ordering. Return all source events (including correction audit
-- rows) so backfill can invalidate both timelines before assigning sequences.
create function private.inventory_history_cross_entity_tie_pairs()
returns table(owner_id uuid, receipt_id uuid, count_id uuid, effective_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select receipt.owner_id, receipt.id, count_sheet.id, receipt.received_at
  from public.inventory_receipts as receipt
  join public.inventory_counts as count_sheet
    on count_sheet.owner_id = receipt.owner_id and count_sheet.status = 'finalized'
   and count_sheet.finalized_at = receipt.received_at
  where count_sheet.finalized_at is not null
  union
  select receipt.owner_id, receipt.id, count_sheet.id, receipt_correction.corrected_at
  from public.inventory_receipts as receipt
  join public.inventory_receipt_corrections as receipt_correction
    on receipt_correction.owner_id = receipt.owner_id and receipt_correction.receipt_id = receipt.id
  join public.inventory_counts as count_sheet
    on count_sheet.owner_id = receipt.owner_id and count_sheet.status = 'finalized'
   and count_sheet.finalized_at = receipt_correction.corrected_at
  where count_sheet.finalized_at is not null
  union
  select receipt.owner_id, receipt.id, count_sheet.id, count_correction.corrected_at
  from public.inventory_receipts as receipt
  join public.inventory_counts as count_sheet
    on count_sheet.owner_id = receipt.owner_id and count_sheet.status = 'finalized'
  join public.inventory_count_corrections as count_correction
    on count_correction.owner_id = count_sheet.owner_id and count_correction.count_id = count_sheet.id
   and count_correction.corrected_at = receipt.received_at
  where count_sheet.finalized_at is not null
  union
  select receipt.owner_id, receipt.id, count_sheet.id, receipt_correction.corrected_at
  from public.inventory_receipts as receipt
  join public.inventory_receipt_corrections as receipt_correction
    on receipt_correction.owner_id = receipt.owner_id and receipt_correction.receipt_id = receipt.id
  join public.inventory_counts as count_sheet
    on count_sheet.owner_id = receipt.owner_id and count_sheet.status = 'finalized'
  join public.inventory_count_corrections as count_correction
    on count_correction.owner_id = count_sheet.owner_id and count_correction.count_id = count_sheet.id
   and count_correction.corrected_at = receipt_correction.corrected_at
  where count_sheet.finalized_at is not null
$$;
revoke all on function private.inventory_history_cross_entity_tie_pairs()
  from public, anon, authenticated, service_role;

create function private.reject_inventory_history_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Inventory history snapshots are append-only';
end;
$$;
revoke all on function private.reject_inventory_history_version_mutation() from public, anon, authenticated, service_role;

create trigger inventory_receipt_versions_append_only
before update or delete on public.inventory_receipt_versions
for each row execute function private.reject_inventory_history_version_mutation();
create trigger inventory_count_versions_append_only
before update or delete on public.inventory_count_versions
for each row execute function private.reject_inventory_history_version_mutation();

create function private.append_inventory_receipt_snapshot(
  p_owner_id uuid,
  p_receipt_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_reason text,
  p_effective_at timestamptz,
  p_lines_snapshot jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.inventory_receipts%rowtype;
  v_sequence bigint;
  v_actor_label text;
  v_effective_at timestamptz;
  v_lines_snapshot jsonb;
begin
  if p_event_type not in ('receipt_created', 'receipt_corrected', 'receipt_backfill')
    or p_actor_id is null
    or (p_event_type = 'receipt_corrected' and (p_reason is null or length(btrim(p_reason)) = 0)) then
    raise exception using errcode = '22023', message = 'Invalid receipt history snapshot';
  end if;
  if auth.uid() is not null and (
    p_actor_id is distinct from auth.uid()
    or not ((private.is_store_owner() and p_owner_id = auth.uid()) or private.is_active_store_member(p_owner_id))
  ) then
    raise exception using errcode = '42501', message = 'Inventory history access denied';
  end if;

  perform private.lock_inventory_owner(p_owner_id);
  select * into v_receipt
  from public.inventory_receipts
  where owner_id = p_owner_id and id = p_receipt_id
  for key share;
  if not found then
    raise exception using errcode = '22023', message = 'Inventory receipt not found';
  end if;

  v_effective_at := case when p_event_type = 'receipt_created' then v_receipt.received_at else p_effective_at end;
  if v_effective_at is null then
    raise exception using errcode = '22023', message = 'Inventory history effective time is required';
  end if;
  if p_lines_snapshot is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', line.id,
      'receipt_id', line.receipt_id,
      'line_number', line.line_number,
      'item_id', line.item_id,
      'item_name', line.item_name,
      'category', line.category,
      'large_unit', line.large_unit,
      'large_quantity', line.large_quantity::text,
      'conversion_factor', line.conversion_factor::text,
      'small_unit', line.small_unit,
      'loose_quantity', line.loose_quantity::text,
      'converted_quantity', line.converted_quantity::text,
      'created_at', line.created_at
    ) order by line.line_number, line.id), '[]'::jsonb)
    into v_lines_snapshot
    from public.inventory_receipt_lines as line
    where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id;
  else
    v_lines_snapshot := p_lines_snapshot;
  end if;
  if jsonb_typeof(v_lines_snapshot) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Receipt history snapshot must be an array';
  end if;

  select coalesce(nullif(btrim(membership.display_name), ''), nullif(btrim(account.email), ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;
  if v_actor_label is null then
    raise exception using errcode = '22023', message = 'Inventory history actor not found';
  end if;

  update private.inventory_history_clock
  set last_sequence = last_sequence + 1
  where singleton
  returning last_sequence into v_sequence;

  insert into public.inventory_receipt_versions (
    owner_id, receipt_id, effective_at, sequence_no, event_type, actor_id, actor_label, reason, lines_snapshot
  ) values (
    p_owner_id, p_receipt_id, v_effective_at, v_sequence, p_event_type, p_actor_id, v_actor_label,
    nullif(btrim(p_reason), ''), v_lines_snapshot
  );
  return v_sequence;
end;
$$;
revoke all on function private.append_inventory_receipt_snapshot(uuid, uuid, text, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

create function private.append_inventory_count_snapshot(
  p_owner_id uuid,
  p_count_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_reason text,
  p_effective_at timestamptz,
  p_items_snapshot jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_sequence bigint;
  v_actor_label text;
  v_effective_at timestamptz;
  v_items_snapshot jsonb;
begin
  if p_event_type not in ('count_finalized', 'count_corrected', 'count_backfill')
    or p_actor_id is null
    or (p_event_type = 'count_corrected' and (p_reason is null or length(btrim(p_reason)) = 0)) then
    raise exception using errcode = '22023', message = 'Invalid count history snapshot';
  end if;
  if auth.uid() is not null and (
    p_actor_id is distinct from auth.uid()
    or not ((private.is_store_owner() and p_owner_id = auth.uid()) or private.is_active_store_member(p_owner_id))
  ) then
    raise exception using errcode = '42501', message = 'Inventory history access denied';
  end if;

  perform private.lock_inventory_owner(p_owner_id);
  select * into v_count
  from public.inventory_counts
  where owner_id = p_owner_id and id = p_count_id
  for key share;
  if not found then
    raise exception using errcode = '22023', message = 'Inventory count not found';
  end if;

  v_effective_at := case when p_event_type = 'count_finalized' then v_count.finalized_at else p_effective_at end;
  if v_effective_at is null then
    raise exception using errcode = '22023', message = 'Inventory history effective time is required';
  end if;
  if p_items_snapshot is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', item.item_id,
      'item_name', item.item_name,
      'category', item.category,
      'large_unit', item.large_unit,
      'conversion_factor', item.conversion_factor::text,
      'small_unit', item.small_unit,
      'large_quantity', item.large_quantity::text,
      'small_quantity', item.small_quantity::text,
      'counted_quantity', item.counted_quantity::text,
      'sort_order', item.sort_order
    ) order by item.sort_order, item.item_name, item.item_id), '[]'::jsonb)
    into v_items_snapshot
    from public.inventory_count_items as item
    where item.owner_id = p_owner_id and item.count_id = p_count_id;
  else
    v_items_snapshot := p_items_snapshot;
  end if;
  if jsonb_typeof(v_items_snapshot) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Count history snapshot must be an array';
  end if;

  select coalesce(nullif(btrim(membership.display_name), ''), nullif(btrim(account.email), ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;
  if v_actor_label is null then
    raise exception using errcode = '22023', message = 'Inventory history actor not found';
  end if;

  update private.inventory_history_clock
  set last_sequence = last_sequence + 1
  where singleton
  returning last_sequence into v_sequence;

  insert into public.inventory_count_versions (
    owner_id, count_id, effective_at, sequence_no, event_type, actor_id, actor_label, reason, items_snapshot
  ) values (
    p_owner_id, p_count_id, v_effective_at, v_sequence, p_event_type, p_actor_id, v_actor_label,
    nullif(btrim(p_reason), ''), v_items_snapshot
  );
  return v_sequence;
end;
$$;
revoke all on function private.append_inventory_count_snapshot(uuid, uuid, text, uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

-- Stage all recoverable legacy events first so equal timestamps get a deterministic global sequence.
create temporary table inventory_history_backfill_events (
  owner_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  effective_at timestamptz not null,
  event_order integer not null,
  event_type text not null,
  actor_id uuid not null,
  reason text,
  state_snapshot jsonb,
  primary key (entity_type, entity_id, event_order)
) on commit drop;

create temporary table inventory_history_backfill_results (
  owner_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  status text not null,
  reason text,
  primary key (entity_type, entity_id)
) on commit drop;

create temporary table inventory_history_cross_entity_ties (
  owner_id uuid not null,
  receipt_id uuid not null,
  count_id uuid not null,
  effective_at timestamptz not null,
  primary key (owner_id, receipt_id, count_id, effective_at)
) on commit drop;

do $$
declare
  v_receipt record;
  v_count record;
  v_event record;
  v_first_receipt_correction record;
  v_first_count_correction record;
  v_is_verified boolean;
  v_reason text;
begin
  for v_receipt in
    select receipt.* from public.inventory_receipts as receipt
    order by receipt.owner_id, receipt.received_at, receipt.id
  loop
    select correction.* into v_first_receipt_correction
    from public.inventory_receipt_corrections as correction
    where correction.owner_id = v_receipt.owner_id and correction.receipt_id = v_receipt.id
    order by correction.corrected_at, correction.id limit 1;

    if found then
      v_reason := private.inventory_receipt_correction_history_problem(v_receipt.owner_id, v_receipt.id);
      if v_reason is null then
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        ) values (
          v_receipt.owner_id, 'receipt', v_receipt.id, v_receipt.received_at, 0, 'receipt_backfill',
          v_receipt.created_by, null, v_first_receipt_correction.prior_lines
        );
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        )
        select correction.owner_id, 'receipt', correction.receipt_id, correction.corrected_at,
          row_number() over (order by correction.corrected_at, correction.id)::integer,
          'receipt_backfill', correction.corrected_by, correction.reason,
          lead(correction.prior_lines) over (order by correction.corrected_at, correction.id)
        from public.inventory_receipt_corrections as correction
        where correction.owner_id = v_receipt.owner_id and correction.receipt_id = v_receipt.id;
        insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
        values (v_receipt.owner_id, 'receipt', v_receipt.id, 'verified',
          'Reconstructed from a validated prior_lines chain and corroborated final receipt state.');
      else
        insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
        values (v_receipt.owner_id, 'receipt', v_receipt.id, 'unverified', v_reason);
      end if;
    else
      select count(*) > 0
        and bool_and(line.created_at >= v_receipt.received_at - interval '5 minutes'
          and line.created_at <= v_receipt.received_at + interval '5 minutes')
      into v_is_verified
      from public.inventory_receipt_lines as line
      where line.owner_id = v_receipt.owner_id and line.receipt_id = v_receipt.id;
      v_is_verified := coalesce(v_is_verified, false)
        and v_receipt.updated_by = v_receipt.created_by
        and v_receipt.updated_at <= v_receipt.received_at
        and v_receipt.received_at - v_receipt.updated_at <= interval '5 minutes';
      if v_is_verified then
        v_reason := 'Creation timestamps and actor match within the five-minute verification window.';
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        ) values (
          v_receipt.owner_id, 'receipt', v_receipt.id, v_receipt.received_at, 0, 'receipt_backfill',
          v_receipt.created_by, null, null
        );
      else
        v_reason := 'No correction audit exists and receipt timestamps do not prove that current lines are the creation state.';
      end if;
      insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
      values (v_receipt.owner_id, 'receipt', v_receipt.id, case when v_is_verified then 'verified' else 'unverified' end, v_reason);
    end if;
  end loop;

  for v_count in
    select count_sheet.* from public.inventory_counts as count_sheet
    where count_sheet.status = 'finalized' and count_sheet.finalized_at is not null
    order by count_sheet.owner_id, count_sheet.finalized_at, count_sheet.id
  loop
    select correction.* into v_first_count_correction
    from public.inventory_count_corrections as correction
    where correction.owner_id = v_count.owner_id and correction.count_id = v_count.id
    order by correction.corrected_at, correction.id limit 1;

    if found then
      v_reason := private.inventory_count_correction_history_problem(v_count.owner_id, v_count.id);
      if v_reason is null then
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        ) values (
          v_count.owner_id, 'count', v_count.id, v_count.finalized_at, 0, 'count_backfill',
          v_count.finalized_by, null, v_first_count_correction.prior_items
        );
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        )
        select correction.owner_id, 'count', correction.count_id, correction.corrected_at,
          row_number() over (order by correction.corrected_at, correction.id)::integer,
          'count_backfill', correction.corrected_by, correction.reason, correction.updated_items
        from public.inventory_count_corrections as correction
        where correction.owner_id = v_count.owner_id and correction.count_id = v_count.id;
        insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
        values (v_count.owner_id, 'count', v_count.id, 'verified',
          'Reconstructed from a validated prior_items/updated_items chain matching current count state.');
      else
        insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
        values (v_count.owner_id, 'count', v_count.id, 'unverified', v_reason);
      end if;
    else
      select count(*) > 0 and bool_and(item.counted_at <= v_count.finalized_at and item.updated_at <= v_count.finalized_at)
      into v_is_verified
      from public.inventory_count_items as item
      where item.owner_id = v_count.owner_id and item.count_id = v_count.id;
      v_is_verified := coalesce(v_is_verified, false)
        and v_count.updated_at >= v_count.finalized_at
        and v_count.updated_at - v_count.finalized_at <= interval '5 minutes';
      if v_is_verified then
        v_reason := 'Count item and finalization timestamps are consistent within the five-minute verification window.';
        insert into inventory_history_backfill_events (
          owner_id, entity_type, entity_id, effective_at, event_order, event_type, actor_id, reason, state_snapshot
        ) values (
          v_count.owner_id, 'count', v_count.id, v_count.finalized_at, 0, 'count_backfill',
          v_count.finalized_by, null, null
        );
      else
        v_reason := 'No correction audit exists and count timestamps do not prove that current items are the finalized state.';
      end if;
      insert into inventory_history_backfill_results (owner_id, entity_type, entity_id, status, reason)
      values (v_count.owner_id, 'count', v_count.id, case when v_is_verified then 'verified' else 'unverified' end, v_reason);
    end if;
  end loop;

  insert into inventory_history_cross_entity_ties (owner_id, receipt_id, count_id, effective_at)
  select tie.owner_id, tie.receipt_id, tie.count_id, tie.effective_at
  from private.inventory_history_cross_entity_tie_pairs() as tie;

  with conflicted_entities as (
    select owner_id, 'receipt'::text as entity_type, receipt_id as entity_id
    from inventory_history_cross_entity_ties
    union
    select owner_id, 'count'::text, count_id
    from inventory_history_cross_entity_ties
  )
  update inventory_history_backfill_results as result
  set status = 'unverified',
      reason = concat_ws(' ', nullif(result.reason, ''),
        'A same-owner receipt/count event has the exact same effective timestamp; no deterministic cutoff order can be recovered.')
  from conflicted_entities as conflict
  where result.owner_id = conflict.owner_id
    and result.entity_type = conflict.entity_type
    and result.entity_id = conflict.entity_id;

  delete from inventory_history_backfill_events as event
  using inventory_history_cross_entity_ties as tie
  where event.owner_id = tie.owner_id
    and ((event.entity_type = 'receipt' and event.entity_id = tie.receipt_id)
      or (event.entity_type = 'count' and event.entity_id = tie.count_id));

  for v_event in
    select event.* from inventory_history_backfill_events as event
    order by event.effective_at, event.owner_id, event.entity_type, event.entity_id, event.event_order
  loop
    if v_event.entity_type = 'receipt' then
      perform private.append_inventory_receipt_snapshot(
        v_event.owner_id, v_event.entity_id, v_event.event_type, v_event.actor_id,
        v_event.reason, v_event.effective_at, v_event.state_snapshot
      );
    else
      perform private.append_inventory_count_snapshot(
        v_event.owner_id, v_event.entity_id, v_event.event_type, v_event.actor_id,
        v_event.reason, v_event.effective_at, v_event.state_snapshot
      );
    end if;
  end loop;

  insert into public.inventory_history_backfill_status (
    owner_id, entity_type, entity_id, status, reason, snapshots_created
  )
  select result.owner_id, result.entity_type, result.entity_id, result.status, result.reason,
    (select count(*)::integer from inventory_history_backfill_events as event
      where event.entity_type = result.entity_type and event.entity_id = result.entity_id)
  from inventory_history_backfill_results as result;
end;
$$;

create or replace function private.serialize_inventory_receipt_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_inventory_owner(new.owner_id);
  new.received_at := clock_timestamp();
  new.updated_at := new.received_at;
  return new;
end;
$$;
revoke all on function private.serialize_inventory_receipt_insert() from public, anon, authenticated, service_role;

create or replace function public.staff_create_inventory_receipt(p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_actor_label text;
  v_receipt_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select membership.owner_id, membership.display_name
  into v_owner_id, v_actor_label
  from public.store_memberships as membership
  where membership.user_id = v_actor and membership.active;
  if not found or not private.is_active_store_member(v_owner_id) then
    raise exception using errcode = '42501', message = 'Active store staff membership required';
  end if;

  insert into public.inventory_receipts (owner_id, created_by, created_by_label, updated_by)
  values (v_owner_id, v_actor, v_actor_label, v_actor)
  returning id into v_receipt_id;

  perform private.replace_inventory_receipt_lines(v_receipt_id, v_owner_id, p_lines);
  perform private.append_inventory_receipt_snapshot(
    v_owner_id, v_receipt_id, 'receipt_created', v_actor, null, null
  );
  return v_receipt_id;
end;
$$;
revoke all on function public.staff_create_inventory_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.staff_create_inventory_receipt(jsonb) to authenticated;

create or replace function private.apply_inventory_receipt_correction(
  p_receipt_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_lines jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor_label text;
  v_prior_lines jsonb;
  v_prior_item_ids uuid[];
  v_now timestamptz;
begin
  perform private.lock_inventory_owner(p_owner_id);
  v_now := clock_timestamp();
  if p_actor_id <> p_owner_id and exists (
    select 1
    from public.inventory_receipts as receipt
    join public.inventory_counts as count_sheet on count_sheet.owner_id = receipt.owner_id
    where receipt.id = p_receipt_id and receipt.owner_id = p_owner_id
      and count_sheet.status = 'finalized' and count_sheet.finalized_at >= receipt.received_at
  ) then
    raise exception using errcode = '42501', message = 'Receipt requires an owner correction after count finalization';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;

  select coalesce(nullif(trim(membership.display_name), ''), nullif(account.email, ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;

  select coalesce(jsonb_agg(to_jsonb(line) order by line.line_number), '[]'::jsonb),
    coalesce(array_agg(line.item_id), array[]::uuid[])
  into v_prior_lines, v_prior_item_ids
  from public.inventory_receipt_lines as line
  where line.owner_id = p_owner_id and line.receipt_id = p_receipt_id;

  insert into public.inventory_receipt_corrections (
    owner_id, receipt_id, corrected_at, corrected_by, corrected_by_label, reason, prior_lines
  ) values (
    p_owner_id, p_receipt_id, v_now, p_actor_id, coalesce(v_actor_label, p_actor_id::text), trim(p_reason), v_prior_lines
  );

  delete from public.inventory_receipt_lines where owner_id = p_owner_id and receipt_id = p_receipt_id;
  perform private.replace_inventory_receipt_lines(p_receipt_id, p_owner_id, p_lines, v_prior_item_ids);
  update public.inventory_receipts
  set updated_at = v_now, updated_by = p_actor_id
  where id = p_receipt_id and owner_id = p_owner_id;

  perform private.append_inventory_receipt_snapshot(
    p_owner_id, p_receipt_id, 'receipt_corrected', p_actor_id, trim(p_reason), v_now
  );
end;
$$;
revoke all on function private.apply_inventory_receipt_correction(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.staff_update_inventory_receipt(
  p_receipt_id uuid,
  p_lines jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_received_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select membership.owner_id into v_owner_id
  from public.store_memberships as membership
  where membership.user_id = v_actor and membership.active;
  if not found or not private.is_active_store_member(v_owner_id) then
    raise exception using errcode = '42501', message = 'Active store staff membership required';
  end if;

  perform private.lock_inventory_owner(v_owner_id);
  select receipt.received_at into v_received_at
  from public.inventory_receipts as receipt
  where receipt.id = p_receipt_id and receipt.owner_id = v_owner_id
  for update;
  if not found or (v_received_at at time zone 'Asia/Ho_Chi_Minh')::date <> private.current_business_date_vn() then
    raise exception using errcode = '42501', message = 'Receipt is not eligible for staff edit today';
  end if;
  if exists (
    select 1 from public.inventory_counts as count_sheet
    where count_sheet.owner_id = v_owner_id and count_sheet.status = 'finalized'
      and count_sheet.finalized_at >= v_received_at
  ) then
    raise exception using errcode = '42501', message = 'Receipt requires an owner correction after count finalization';
  end if;

  perform private.apply_inventory_receipt_correction(p_receipt_id, v_owner_id, v_actor, p_reason, p_lines);
  return p_receipt_id;
end;
$$;
revoke all on function public.staff_update_inventory_receipt(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.staff_update_inventory_receipt(uuid, jsonb, text) to authenticated;

create or replace function public.owner_correct_inventory_receipt(
  p_receipt_id uuid,
  p_lines jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  perform private.lock_inventory_owner(v_actor);
  perform 1 from public.inventory_receipts
  where id = p_receipt_id and owner_id = v_actor
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Receipt not found';
  end if;

  perform private.apply_inventory_receipt_correction(p_receipt_id, v_actor, v_actor, p_reason, p_lines);
  return p_receipt_id;
end;
$$;
revoke all on function public.owner_correct_inventory_receipt(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_correct_inventory_receipt(uuid, jsonb, text) to authenticated;

create or replace function public.finalize_inventory_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count public.inventory_counts%rowtype;
  v_finalized_at timestamptz;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select owner_id into v_owner_id from public.inventory_counts where id = p_count_id;
  if not found then raise exception using errcode = '22023', message = 'Inventory count not found'; end if;
  if not (private.is_store_owner() and v_owner_id = v_actor) then
    if private.staff_owner_id() is distinct from v_owner_id then
      raise exception using errcode = '42501', message = 'Inventory access denied';
    end if;
  end if;

  perform private.lock_inventory_owner(v_owner_id);
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception using errcode = '22023', message = 'Inventory count not found'; end if;
  if v_count.owner_id <> v_owner_id then raise exception using errcode = '42501', message = 'Inventory access denied'; end if;
  if v_count.business_date > private.current_business_date_vn() then
    raise exception using errcode = '22023', message = 'Inventory count date must not be in the future';
  end if;
  if not (private.is_store_owner() and v_owner_id = v_actor)
    and v_count.business_date <> private.current_business_date_vn() then
    raise exception using errcode = '42501', message = 'Staff can finalize today only';
  end if;
  if v_count.status <> 'draft' then raise exception using errcode = '22023', message = 'Inventory count is already finalized'; end if;
  if exists (
    select 1 from public.inventory_count_items
    where count_id = p_count_id and counted_at is null
  ) then
    raise exception using errcode = '22023', message = 'Inventory count has uncounted items';
  end if;
  if exists (
    select 1 from public.inventory_count_items
    where count_id = p_count_id and owner_id = v_owner_id
      and ((large_quantity is not null and large_quantity <> trunc(large_quantity))
        or (lower(trim(small_unit)) not in ('gr', 'ml')
          and small_quantity is not null and small_quantity <> trunc(small_quantity)))
  ) then
    raise exception using errcode = '22023', message = 'Inventory count has fractional package quantities';
  end if;

  -- The owner lock is acquired first so a concurrent receipt gets a later effective cutoff and sequence.
  v_finalized_at := clock_timestamp();
  if exists (
    select 1
    from public.inventory_receipts as receipt
    join public.inventory_receipt_lines as receipt_line
      on receipt_line.owner_id = receipt.owner_id and receipt_line.receipt_id = receipt.id
    join public.inventory_count_items as count_item
      on count_item.owner_id = receipt_line.owner_id and count_item.item_id = receipt_line.item_id
    where receipt.owner_id = v_owner_id and count_item.count_id = p_count_id
      and receipt.received_at <= v_finalized_at
      and greatest(receipt.received_at, receipt.updated_at) > count_item.counted_at
  ) then
    raise exception using errcode = '22023', message = 'Inventory items must be recounted after the latest receipt';
  end if;

  update public.inventory_counts set
    status = 'finalized', finalized_by = v_actor, finalized_at = v_finalized_at, updated_by = v_actor
  where id = p_count_id and owner_id = v_owner_id;
  perform private.append_inventory_count_snapshot(
    v_owner_id, p_count_id, 'count_finalized', v_actor, null, v_finalized_at
  );
end;
$$;
revoke all on function public.finalize_inventory_count(uuid) from public, anon, authenticated;
grant execute on function public.finalize_inventory_count(uuid) to authenticated;

create or replace function public.owner_correct_inventory_count(p_count_id uuid, p_quantities jsonb, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_count public.inventory_counts%rowtype;
  v_actor_label text;
  v_prior_items jsonb;
  v_updated_items jsonb;
  v_corrected_at timestamptz;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  select owner_id into v_owner_id from public.inventory_counts where id = p_count_id;
  if not found or v_owner_id <> v_actor then
    raise exception using errcode = '42501', message = 'Inventory count not found';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'A correction reason is required';
  end if;
  if p_quantities is null or jsonb_typeof(p_quantities) <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid count values';
  end if;

  perform private.lock_inventory_owner(v_owner_id);
  select * into v_count from public.inventory_counts where id = p_count_id for update;
  if not found or v_count.owner_id <> v_actor then
    raise exception using errcode = '42501', message = 'Inventory count not found';
  end if;
  if v_count.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only finalized counts can be corrected';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.item_id,
    'item_name', item.item_name,
    'large_unit', item.large_unit,
    'conversion_factor', item.conversion_factor::text,
    'small_unit', item.small_unit,
    'large_quantity', item.large_quantity::text,
    'small_quantity', item.small_quantity::text,
    'counted_quantity', item.counted_quantity::text
  ) order by item.item_name, item.item_id), '[]'::jsonb)
  into v_prior_items
  from public.inventory_count_items as item
  where item.owner_id = v_owner_id and item.count_id = p_count_id;

  update public.inventory_counts
  set status = 'draft', finalized_by = null, finalized_at = null
  where id = p_count_id and owner_id = v_owner_id;

  perform public.save_inventory_count_draft(p_count_id, p_quantities);

  if exists (
    select 1 from public.inventory_count_items
    where owner_id = v_owner_id and count_id = p_count_id and counted_quantity is null
  ) then
    raise exception using errcode = '22023', message = 'Corrected count must remain complete';
  end if;

  update public.inventory_counts
  set status = 'finalized', finalized_by = v_count.finalized_by,
      finalized_at = v_count.finalized_at, updated_by = v_actor
  where id = p_count_id and owner_id = v_owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.item_id,
    'item_name', item.item_name,
    'large_unit', item.large_unit,
    'conversion_factor', item.conversion_factor::text,
    'small_unit', item.small_unit,
    'large_quantity', item.large_quantity::text,
    'small_quantity', item.small_quantity::text,
    'counted_quantity', item.counted_quantity::text
  ) order by item.item_name, item.item_id), '[]'::jsonb)
  into v_updated_items
  from public.inventory_count_items as item
  where item.owner_id = v_owner_id and item.count_id = p_count_id;

  select coalesce(nullif(trim(account.email), ''), v_actor::text)
  into v_actor_label
  from auth.users as account
  where account.id = v_actor;

  -- Corrections are events now; do not reuse the original finalized_at as their effective time.
  v_corrected_at := clock_timestamp();
  insert into public.inventory_count_corrections (
    owner_id, count_id, corrected_at, corrected_by, corrected_by_label, reason, prior_items, updated_items
  ) values (
    v_owner_id, p_count_id, v_corrected_at, v_actor, coalesce(v_actor_label, v_actor::text),
    trim(p_reason), v_prior_items, v_updated_items
  );
  perform private.append_inventory_count_snapshot(
    v_owner_id, p_count_id, 'count_corrected', v_actor, trim(p_reason), v_corrected_at
  );

  return p_count_id;
end;
$$;
revoke all on function public.owner_correct_inventory_count(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.owner_correct_inventory_count(uuid, jsonb, text) to authenticated;
