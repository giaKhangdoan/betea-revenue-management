-- Owner-only purchase advances. All mutations happen through narrow RPCs;
-- staff continue to use daily_expenses for shop-funded incidental costs.

-- Composite keys let every cross-table relationship prove store ownership.
alter table public.daily_expenses
  add constraint daily_expenses_owner_id_id_key unique (owner_id, id);
alter table public.inventory_items
  add constraint inventory_items_owner_id_id_key unique (owner_id, id);
alter table public.inventory_receipt_lines
  add constraint inventory_receipt_lines_owner_id_id_key unique (owner_id, id);
alter table public.inventory_receipt_lines
  add constraint inventory_receipt_lines_owner_receipt_id_id_key unique (owner_id, receipt_id, id);

create table public.owner_purchase_vouchers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  purchase_date date not null check (purchase_date >= date '2026-09-01'),
  vendor text check (vendor is null or length(btrim(vendor)) between 1 and 160),
  invoice_total_vnd bigint not null check (invoice_total_vnd between 1 and 9007199254740991),
  note text check (note is null or length(note) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'finalized', 'canceled')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users (id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  finalized_by uuid references auth.users (id) on delete restrict,
  finalized_at timestamptz,
  canceled_by uuid references auth.users (id) on delete restrict,
  canceled_at timestamptz,
  cancel_reason text,
  cancel_event_id uuid,
  linked_inventory_receipt_id uuid,
  inventory_receipt_created boolean not null default false,
  finalization_request jsonb,
  finalization_result jsonb,
  unique (owner_id, id),
  unique (owner_id, id, linked_inventory_receipt_id),
  foreign key (owner_id, linked_inventory_receipt_id)
    references public.inventory_receipts (owner_id, id) on delete restrict,
  check (
    (status = 'draft' and finalized_by is null and finalized_at is null
      and canceled_by is null and canceled_at is null and cancel_event_id is null
      and linked_inventory_receipt_id is null and not inventory_receipt_created
      and finalization_request is null and finalization_result is null and cancel_reason is null)
    or (status = 'finalized' and finalized_by is not null and finalized_at is not null
      and canceled_by is null and canceled_at is null and cancel_event_id is null
      and finalization_request is not null and finalization_result is not null and cancel_reason is null)
    or (status = 'canceled' and finalized_by is null and finalized_at is null
      and canceled_by is not null and canceled_at is not null and cancel_event_id is not null
      and linked_inventory_receipt_id is null and not inventory_receipt_created
      and finalization_request is null and finalization_result is null
      and length(btrim(coalesce(cancel_reason, ''))) > 0)
  ),
  check (not inventory_receipt_created or linked_inventory_receipt_id is not null)
);
create index owner_purchase_vouchers_owner_date_idx
  on public.owner_purchase_vouchers (owner_id, purchase_date desc, created_at desc);
create index owner_purchase_vouchers_owner_status_date_idx
  on public.owner_purchase_vouchers (owner_id, status, purchase_date desc);

create table public.owner_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  line_number integer not null check (line_number between 1 and 200),
  active boolean not null default true,
  description text not null check (length(btrim(description)) between 1 and 240),
  cost_class text not null check (cost_class in ('raw_material', 'non_ingredient')),
  inventory_class text not null check (inventory_class in ('stock', 'non_stock')),
  inventory_item_id uuid,
  item_name_snapshot text,
  category_snapshot text,
  large_unit_snapshot text,
  conversion_factor_snapshot numeric(14, 3),
  small_unit_snapshot text,
  large_quantity numeric(20, 3),
  loose_quantity numeric(20, 3),
  converted_quantity numeric(20, 3),
  unit_snapshot text,
  quantity_snapshot numeric(20, 3),
  line_amount_vnd bigint check (line_amount_vnd is null or line_amount_vnd between 0 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  unique (owner_id, voucher_id, id),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  foreign key (owner_id, inventory_item_id)
    references public.inventory_items (owner_id, id) on delete restrict,
  check (
    (inventory_class = 'stock'
      and inventory_item_id is not null
      and item_name_snapshot is not null
      and small_unit_snapshot is not null
      and conversion_factor_snapshot is not null
      and conversion_factor_snapshot > 0
      and large_quantity is not null and large_quantity >= 0 and large_quantity = trunc(large_quantity)
      and loose_quantity is not null and loose_quantity >= 0
      and converted_quantity is not null and converted_quantity > 0)
    or (inventory_class = 'non_stock'
      and inventory_item_id is null
      and item_name_snapshot is null
      and category_snapshot is null
      and large_unit_snapshot is null
      and conversion_factor_snapshot is null
      and small_unit_snapshot is null
      and large_quantity is null
      and loose_quantity is null
      and converted_quantity is null
      and unit_snapshot is not null and length(btrim(unit_snapshot)) between 1 and 80
      and quantity_snapshot is not null and quantity_snapshot >= 0)
  )
);
create unique index owner_purchase_lines_active_number_key
  on public.owner_purchase_lines (owner_id, voucher_id, line_number)
  where active;
create index owner_purchase_lines_owner_voucher_idx
  on public.owner_purchase_lines (owner_id, voucher_id, line_number)
  where active;

create table public.owner_purchase_stock_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  purchase_line_id uuid not null,
  receipt_id uuid not null,
  receipt_line_id uuid not null,
  linked_by uuid not null references auth.users (id) on delete restrict,
  linked_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  unique (owner_id, purchase_line_id),
  unique (owner_id, receipt_line_id),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, purchase_line_id)
    references public.owner_purchase_lines (owner_id, voucher_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, receipt_id)
    references public.owner_purchase_vouchers (owner_id, id, linked_inventory_receipt_id)
    on delete restrict deferrable initially deferred,
  foreign key (owner_id, receipt_id)
    references public.inventory_receipts (owner_id, id) on delete restrict,
  foreign key (owner_id, receipt_id, receipt_line_id)
    references public.inventory_receipt_lines (owner_id, receipt_id, id) on delete restrict
);
create index owner_purchase_stock_links_owner_voucher_idx
  on public.owner_purchase_stock_links (owner_id, voucher_id, linked_at desc);

create table public.owner_purchase_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  event_type text not null check (event_type in (
    'voucher_created', 'voucher_updated', 'voucher_finalized', 'voucher_canceled',
    'duplicate_resolved', 'voucher_corrected', 'reimbursement_recorded',
    'profit_posted', 'profit_reversed'
  )),
  actor_id uuid not null references auth.users (id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  reason text,
  before_state jsonb,
  after_state jsonb,
  related_id uuid,
  idempotency_key uuid,
  unique (owner_id, id),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  check (reason is null or length(reason) <= 1000)
);
create index owner_purchase_events_owner_voucher_time_idx
  on public.owner_purchase_events (owner_id, voucher_id, occurred_at desc, id desc);

create table public.owner_purchase_source_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  daily_expense_id uuid not null,
  voucher_id uuid not null,
  resolution text not null check (resolution in ('personal_paid', 'shop_cash', 'different_purchase')),
  before_state jsonb not null,
  request_payload jsonb not null,
  result_payload jsonb not null,
  idempotency_key uuid not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  unique (owner_id, daily_expense_id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, daily_expense_id)
    references public.daily_expenses (owner_id, id) on delete restrict,
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict
);
create index owner_purchase_source_links_owner_voucher_idx
  on public.owner_purchase_source_links (owner_id, voucher_id, created_at desc);

create table public.owner_purchase_reimbursements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  event_type text not null check (event_type in ('payment', 'reversal')),
  business_date date not null check (business_date >= date '2026-09-01'),
  amount_vnd bigint not null check (amount_vnd between 1 and 9007199254740991),
  note text check (note is null or length(note) <= 1000),
  reverses_event_id uuid,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  result_payload jsonb not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  constraint owner_purchase_reimbursements_owner_voucher_id_key
    unique (owner_id, voucher_id, id),
  unique (owner_id, voucher_id, idempotency_key),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, reverses_event_id)
    references public.owner_purchase_reimbursements (owner_id, voucher_id, id) on delete restrict,
  check ((event_type = 'payment' and reverses_event_id is null)
    or (event_type = 'reversal' and reverses_event_id is not null))
);
create index owner_purchase_reimbursements_owner_voucher_date_idx
  on public.owner_purchase_reimbursements (owner_id, voucher_id, business_date, created_at);

create table public.owner_purchase_profit_postings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  source_line_id uuid not null,
  posting_type text not null check (posting_type in ('post', 'reversal')),
  accounting_month date not null check (extract(day from accounting_month) = 1),
  amount_vnd bigint not null check (amount_vnd between 0 and 9007199254740991),
  reverses_posting_id uuid,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  source_snapshot jsonb not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  unique (owner_id, voucher_id, id),
  unique (owner_id, voucher_id, source_line_id, id),
  unique (owner_id, voucher_id, idempotency_key, source_line_id, posting_type),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, source_line_id)
    references public.owner_purchase_lines (owner_id, voucher_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, source_line_id, reverses_posting_id)
    references public.owner_purchase_profit_postings (owner_id, voucher_id, source_line_id, id) on delete restrict,
  check ((posting_type = 'post' and reverses_posting_id is null)
    or (posting_type = 'reversal' and reverses_posting_id is not null))
);
create unique index owner_purchase_profit_postings_once_per_line_idx
  on public.owner_purchase_profit_postings (owner_id, source_line_id)
  where posting_type = 'post';
create unique index owner_purchase_profit_postings_single_reversal_idx
  on public.owner_purchase_profit_postings (owner_id, reverses_posting_id)
  where reverses_posting_id is not null;
create index owner_purchase_profit_postings_owner_month_idx
  on public.owner_purchase_profit_postings (owner_id, accounting_month desc, created_at desc);

create table public.owner_purchase_profit_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  result_payload jsonb not null,
  actor_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict
);

create table public.owner_purchase_upload_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  caption text check (caption is null or length(caption) <= 500),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'attached', 'expired', 'deleted')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  check (split_part(object_path, '/', 1) = owner_id::text),
  check (split_part(object_path, '/', 2) = 'owner-advances-staging'),
  check (split_part(object_path, '/', 3) = voucher_id::text),
  check (array_length(string_to_array(object_path, '/'), 1) = 4)
);
alter table public.owner_purchase_upload_intents
  add constraint owner_purchase_upload_intents_owner_voucher_id_key
    unique (owner_id, voucher_id, id);
create index owner_purchase_upload_intents_expiry_idx
  on public.owner_purchase_upload_intents (expires_at)
  where status in ('pending', 'uploaded');

create table public.owner_purchase_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owner_profiles (user_id) on delete cascade,
  voucher_id uuid not null,
  reimbursement_id uuid,
  upload_intent_id uuid not null,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  caption text check (caption is null or length(caption) <= 500),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (owner_id, id),
  foreign key (owner_id, voucher_id)
    references public.owner_purchase_vouchers (owner_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, reimbursement_id)
    references public.owner_purchase_reimbursements (owner_id, voucher_id, id) on delete restrict,
  foreign key (owner_id, voucher_id, upload_intent_id)
    references public.owner_purchase_upload_intents (owner_id, voucher_id, id) on delete restrict,
  check (split_part(object_path, '/', 1) = owner_id::text),
  check (split_part(object_path, '/', 2) = 'owner-advances'),
  check (split_part(object_path, '/', 3) = voucher_id::text),
  check (array_length(string_to_array(object_path, '/'), 1) = 4)
);
create unique index owner_purchase_evidence_intent_key
  on public.owner_purchase_evidence (owner_id, upload_intent_id);
create index owner_purchase_evidence_owner_voucher_idx
  on public.owner_purchase_evidence (owner_id, voucher_id, created_at desc);

alter table public.owner_purchase_vouchers
  add constraint owner_purchase_vouchers_cancel_event_fk
    foreign key (owner_id, cancel_event_id)
    references public.owner_purchase_events (owner_id, id) on delete restrict;

alter table public.owner_purchase_vouchers enable row level security;
alter table public.owner_purchase_lines enable row level security;
alter table public.owner_purchase_stock_links enable row level security;
alter table public.owner_purchase_events enable row level security;
alter table public.owner_purchase_source_links enable row level security;
alter table public.owner_purchase_reimbursements enable row level security;
alter table public.owner_purchase_profit_postings enable row level security;
alter table public.owner_purchase_profit_requests enable row level security;
alter table public.owner_purchase_upload_intents enable row level security;
alter table public.owner_purchase_evidence enable row level security;

revoke all on public.owner_purchase_vouchers, public.owner_purchase_lines,
  public.owner_purchase_events, public.owner_purchase_source_links,
  public.owner_purchase_stock_links,
  public.owner_purchase_reimbursements, public.owner_purchase_profit_postings,
  public.owner_purchase_profit_requests, public.owner_purchase_upload_intents,
  public.owner_purchase_evidence from public, anon, authenticated;
grant select on public.owner_purchase_vouchers, public.owner_purchase_lines,
  public.owner_purchase_events, public.owner_purchase_source_links,
  public.owner_purchase_stock_links,
  public.owner_purchase_reimbursements, public.owner_purchase_profit_postings,
  public.owner_purchase_profit_requests, public.owner_purchase_upload_intents,
  public.owner_purchase_evidence to authenticated;

create policy "owner reads own purchase vouchers"
  on public.owner_purchase_vouchers for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase lines"
  on public.owner_purchase_lines for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase events"
  on public.owner_purchase_events for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase source links"
  on public.owner_purchase_source_links for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase stock links"
  on public.owner_purchase_stock_links for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase reimbursements"
  on public.owner_purchase_reimbursements for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase profit postings"
  on public.owner_purchase_profit_postings for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase profit requests"
  on public.owner_purchase_profit_requests for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase upload intents"
  on public.owner_purchase_upload_intents for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));
create policy "owner reads own purchase evidence metadata"
  on public.owner_purchase_evidence for select to authenticated
  using (private.is_store_owner() and owner_id = (select auth.uid()));

create function private.reject_owner_purchase_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Purchase audit rows are append-only';
end;
$$;
revoke all on function private.reject_owner_purchase_append_only_mutation()
  from public, anon, authenticated, service_role;

create trigger owner_purchase_events_append_only
before update or delete on public.owner_purchase_events
for each row execute function private.reject_owner_purchase_append_only_mutation();
create trigger owner_purchase_source_links_append_only
before update or delete on public.owner_purchase_source_links
for each row execute function private.reject_owner_purchase_append_only_mutation();
create trigger owner_purchase_reimbursements_append_only
before update or delete on public.owner_purchase_reimbursements
for each row execute function private.reject_owner_purchase_append_only_mutation();
create trigger owner_purchase_profit_postings_append_only
before update or delete on public.owner_purchase_profit_postings
for each row execute function private.reject_owner_purchase_append_only_mutation();
create trigger owner_purchase_profit_requests_append_only
before update or delete on public.owner_purchase_profit_requests
for each row execute function private.reject_owner_purchase_append_only_mutation();
create trigger owner_purchase_evidence_append_only
before update or delete on public.owner_purchase_evidence
for each row execute function private.reject_owner_purchase_append_only_mutation();

create function private.reject_linked_purchase_receipt_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.owner_purchase_stock_links as source_link
    where source_link.owner_id = old.owner_id and source_link.receipt_line_id = old.id
  ) then
    raise exception using errcode = '42501', message = 'Receipt lines linked to owner purchases require the purchase correction flow';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.reject_linked_purchase_receipt_line_mutation()
  from public, anon, authenticated, service_role;
create trigger inventory_receipt_lines_reject_purchase_link_mutation
before update or delete on public.inventory_receipt_lines
for each row execute function private.reject_linked_purchase_receipt_line_mutation();

create function private.owner_purchase_snapshot(p_owner_id uuid, p_voucher_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'voucher', to_jsonb(voucher),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(line) order by line.line_number, line.id)
      from public.owner_purchase_lines as line
      where line.owner_id = voucher.owner_id and line.voucher_id = voucher.id and line.active
    ), '[]'::jsonb),
    'stock_links', coalesce((
      select jsonb_agg(to_jsonb(source_link) order by source_link.purchase_line_id)
      from public.owner_purchase_stock_links as source_link
      where source_link.owner_id = voucher.owner_id and source_link.voucher_id = voucher.id
    ), '[]'::jsonb)
  )
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = p_owner_id and voucher.id = p_voucher_id;
$$;
revoke all on function private.owner_purchase_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.append_owner_purchase_event(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_reason text,
  p_before_state jsonb,
  p_after_state jsonb,
  p_related_id uuid default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  insert into public.owner_purchase_events (
    owner_id, voucher_id, event_type, actor_id, reason, before_state, after_state,
    related_id, idempotency_key
  ) values (
    p_owner_id, p_voucher_id, p_event_type, p_actor_id, nullif(btrim(p_reason), ''),
    p_before_state, p_after_state, p_related_id, p_idempotency_key
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;
revoke all on function private.append_owner_purchase_event(uuid, uuid, text, uuid, text, jsonb, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.write_owner_purchase_lines(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_lines jsonb,
  p_preserve_ids boolean default false
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_line_id uuid;
  v_item_id uuid;
  v_number integer := 0;
  v_seen_ids uuid[] := array[]::uuid[];
  v_description text;
  v_cost_class text;
  v_inventory_class text;
  v_large_text text;
  v_loose_text text;
  v_unit text;
  v_quantity_text text;
  v_large numeric(20, 3);
  v_loose numeric(20, 3);
  v_converted numeric(20, 3);
  v_quantity numeric(20, 3);
  v_amount bigint;
  v_amount_text text;
  v_max_quantity constant numeric := 99999999999999999.999;
begin
  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 200 then
    raise exception using errcode = '22023', message = 'A purchase voucher needs between 1 and 200 lines';
  end if;

  -- Clear active line numbers first so corrections can safely reorder existing rows
  -- under the partial unique (voucher, line_number) index.
  update public.owner_purchase_lines
  set active = false, updated_at = clock_timestamp()
  where owner_id = p_owner_id and voucher_id = p_voucher_id and active;

  for v_line in select value from jsonb_array_elements(p_lines) as lines(value)
  loop
    v_number := v_number + 1;
    if jsonb_typeof(v_line) is distinct from 'object'
      or jsonb_typeof(v_line -> 'description') is distinct from 'string'
      or jsonb_typeof(v_line -> 'cost_class') is distinct from 'string'
      or jsonb_typeof(v_line -> 'inventory_class') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Invalid purchase line';
    end if;
    v_description := btrim(v_line ->> 'description');
    v_cost_class := v_line ->> 'cost_class';
    v_inventory_class := v_line ->> 'inventory_class';
    if length(v_description) not between 1 and 240
      or v_cost_class not in ('raw_material', 'non_ingredient')
      or v_inventory_class not in ('stock', 'non_stock') then
      raise exception using errcode = '22023', message = 'Invalid purchase line classification';
    end if;

    v_amount := null;
    if v_line ? 'line_amount_vnd' and jsonb_typeof(v_line -> 'line_amount_vnd') <> 'null' then
      v_amount_text := v_line ->> 'line_amount_vnd';
      if jsonb_typeof(v_line -> 'line_amount_vnd') not in ('number', 'string')
        or v_amount_text !~ '^[0-9]{1,16}$' then
        raise exception using errcode = '22023', message = 'Invalid purchase line amount';
      end if;
      v_amount := v_amount_text::bigint;
      if v_amount > 9007199254740991 then
        raise exception using errcode = '22003', message = 'Purchase line amount is out of range';
      end if;
    end if;

    v_line_id := null;
    if p_preserve_ids and v_line ? 'line_id' and jsonb_typeof(v_line -> 'line_id') = 'string' then
      begin
        v_line_id := (v_line ->> 'line_id')::uuid;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid purchase line id';
      end;
      if v_line_id = any(v_seen_ids) then
        raise exception using errcode = '22023', message = 'Duplicate purchase line id';
      end if;
      if not exists (
        select 1 from public.owner_purchase_lines as existing
        where existing.owner_id = p_owner_id and existing.voucher_id = p_voucher_id
          and existing.id = v_line_id
      ) then
        raise exception using errcode = '22023', message = 'Purchase line does not belong to this voucher';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_line_id);
    elsif p_preserve_ids and v_line ? 'line_id' and jsonb_typeof(v_line -> 'line_id') <> 'null' then
      raise exception using errcode = '22023', message = 'Invalid purchase line id';
    end if;

    if v_inventory_class = 'stock' then
      if jsonb_typeof(v_line -> 'inventory_item_id') is distinct from 'string'
        or jsonb_typeof(v_line -> 'large_quantity') is distinct from 'string'
        or jsonb_typeof(v_line -> 'loose_quantity') is distinct from 'string' then
        raise exception using errcode = '22023', message = 'Stock purchase lines require an item and canonical quantities';
      end if;
      v_large_text := v_line ->> 'large_quantity';
      v_loose_text := v_line ->> 'loose_quantity';
      if length(v_large_text) > 17 or length(v_loose_text) > 21
        or v_large_text !~ '^[0-9]+$'
        or v_loose_text !~ '^[0-9]+([.][0-9]{1,3})?$' then
        raise exception using errcode = '22023', message = 'Invalid stock purchase quantity';
      end if;
      begin
        v_item_id := (v_line ->> 'inventory_item_id')::uuid;
        v_large := v_large_text::numeric;
        v_loose := v_loose_text::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid stock purchase quantity';
      end;
      if v_large > v_max_quantity or v_loose > v_max_quantity then
        raise exception using errcode = '22003', message = 'Stock purchase quantity is out of range';
      end if;
      select * into v_item from public.inventory_items
      where id = v_item_id and owner_id = p_owner_id and active
      for share;
      if not found then
        raise exception using errcode = '22023', message = 'Inventory item is not active for this owner';
      end if;
      if v_item.conversion_factor is null or v_item.conversion_factor <= 0
        or v_item.small_unit is null or length(btrim(v_item.small_unit)) = 0 then
        raise exception using errcode = '22023', message = 'Stock purchase requires a verified inventory conversion';
      end if;
      if lower(btrim(v_item.small_unit)) not in ('gr', 'ml') and v_loose <> trunc(v_loose) then
        raise exception using errcode = '22023', message = 'This unit does not allow fractional loose quantities';
      end if;
      if v_item.large_unit is null then
        if v_large <> 0 then
          raise exception using errcode = '22023', message = 'This item has no purchase-unit conversion';
        end if;
        v_converted := v_loose;
      else
        v_converted := v_large * v_item.conversion_factor + v_loose;
      end if;
      if v_converted > v_max_quantity then
        raise exception using errcode = '22003', message = 'Converted stock quantity is out of range';
      end if;
      if v_converted <= 0 then
        raise exception using errcode = '22023', message = 'Stock purchase quantity must be greater than zero';
      end if;
      if v_line_id is null then v_line_id := gen_random_uuid(); end if;
      if p_preserve_ids and not (v_line_id = any(v_seen_ids)) then
        v_seen_ids := array_append(v_seen_ids, v_line_id);
      end if;
      if p_preserve_ids and exists (
        select 1 from public.owner_purchase_lines as existing
        where existing.owner_id = p_owner_id and existing.voucher_id = p_voucher_id
          and existing.id = v_line_id
      ) then
        update public.owner_purchase_lines set
          line_number = v_number, active = true, description = v_description,
          cost_class = v_cost_class, inventory_class = 'stock', inventory_item_id = v_item.id,
          item_name_snapshot = v_item.name, category_snapshot = v_item.category,
          large_unit_snapshot = v_item.large_unit, conversion_factor_snapshot = v_item.conversion_factor,
          small_unit_snapshot = v_item.small_unit, large_quantity = v_large,
          loose_quantity = v_loose, converted_quantity = v_converted,
          unit_snapshot = null, quantity_snapshot = null, line_amount_vnd = v_amount,
          updated_at = clock_timestamp()
        where owner_id = p_owner_id and voucher_id = p_voucher_id and id = v_line_id;
      else
        insert into public.owner_purchase_lines (
          id, owner_id, voucher_id, line_number, description, cost_class, inventory_class,
          inventory_item_id, item_name_snapshot, category_snapshot, large_unit_snapshot,
          conversion_factor_snapshot, small_unit_snapshot, large_quantity, loose_quantity,
          converted_quantity, line_amount_vnd
        ) values (
          v_line_id, p_owner_id, p_voucher_id, v_number, v_description, v_cost_class, 'stock',
          v_item.id, v_item.name, v_item.category, v_item.large_unit, v_item.conversion_factor,
          v_item.small_unit, v_large, v_loose, v_converted, v_amount
        );
      end if;
    else
      if v_line ? 'inventory_item_id' and jsonb_typeof(v_line -> 'inventory_item_id') <> 'null' then
        raise exception using errcode = '22023', message = 'Non-stock purchase lines cannot link to inventory';
      end if;
      if jsonb_typeof(v_line -> 'unit_snapshot') is distinct from 'string'
        or jsonb_typeof(v_line -> 'quantity_snapshot') is distinct from 'string' then
        raise exception using errcode = '22023', message = 'Non-stock lines require a unit and quantity';
      end if;
      v_unit := btrim(v_line ->> 'unit_snapshot');
      v_quantity_text := v_line ->> 'quantity_snapshot';
      if length(v_unit) not between 1 and 80 or length(v_quantity_text) > 21
        or v_quantity_text !~ '^[0-9]+([.][0-9]{1,3})?$' then
        raise exception using errcode = '22023', message = 'Invalid non-stock quantity';
      end if;
      begin v_quantity := v_quantity_text::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid non-stock quantity';
      end;
      if v_quantity > v_max_quantity then
        raise exception using errcode = '22003', message = 'Non-stock quantity is out of range';
      end if;
      if v_line_id is null then v_line_id := gen_random_uuid(); end if;
      if p_preserve_ids and not (v_line_id = any(v_seen_ids)) then
        v_seen_ids := array_append(v_seen_ids, v_line_id);
      end if;
      if p_preserve_ids and exists (
        select 1 from public.owner_purchase_lines as existing
        where existing.owner_id = p_owner_id and existing.voucher_id = p_voucher_id
          and existing.id = v_line_id
      ) then
        update public.owner_purchase_lines set
          line_number = v_number, active = true, description = v_description,
          cost_class = v_cost_class, inventory_class = 'non_stock', inventory_item_id = null,
          item_name_snapshot = null, category_snapshot = null, large_unit_snapshot = null,
          conversion_factor_snapshot = null, small_unit_snapshot = null, large_quantity = null,
          loose_quantity = null, converted_quantity = null, unit_snapshot = v_unit,
          quantity_snapshot = v_quantity, line_amount_vnd = v_amount, updated_at = clock_timestamp()
        where owner_id = p_owner_id and voucher_id = p_voucher_id and id = v_line_id;
      else
        insert into public.owner_purchase_lines (
          id, owner_id, voucher_id, line_number, description, cost_class, inventory_class,
          unit_snapshot, quantity_snapshot, line_amount_vnd
        ) values (
          v_line_id, p_owner_id, p_voucher_id, v_number, v_description, v_cost_class, 'non_stock',
          v_unit, v_quantity, v_amount
        );
      end if;
    end if;
  end loop;

  if p_preserve_ids then
    update public.owner_purchase_lines
    set active = false, updated_at = clock_timestamp()
    where owner_id = p_owner_id and voucher_id = p_voucher_id and active
      and not (id = any(v_seen_ids));
  end if;
end;
$$;
revoke all on function private.write_owner_purchase_lines(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- Phase 01 snapshots include the owner-only source link without exposing it on
-- receipt lines, which remain directly readable by current-week staff.
create or replace function private.append_inventory_receipt_snapshot(
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
      'purchase_line_id', source_link.purchase_line_id,
      'created_at', line.created_at
    ) order by line.line_number, line.id), '[]'::jsonb)
    into v_lines_snapshot
    from public.inventory_receipt_lines as line
    left join public.owner_purchase_stock_links as source_link
      on source_link.owner_id = line.owner_id and source_link.receipt_line_id = line.id
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

create function private.assert_owner_purchase_stock_snapshots(p_owner_id uuid, p_voucher_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.owner_purchase_lines as line
    left join public.inventory_items as item
      on item.id = line.inventory_item_id and item.owner_id = line.owner_id
    where line.owner_id = p_owner_id and line.voucher_id = p_voucher_id
      and line.active and line.inventory_class = 'stock'
      and (item.id is null or not item.active
        or item.name is distinct from line.item_name_snapshot
        or item.category is distinct from line.category_snapshot
        or item.large_unit is distinct from line.large_unit_snapshot
        or item.conversion_factor is distinct from line.conversion_factor_snapshot
        or item.small_unit is distinct from line.small_unit_snapshot
        or item.conversion_factor is null)
  ) then
    raise exception using errcode = '22023', message = 'Inventory item or unit conversion changed after this draft; refresh the draft before finalizing';
  end if;
end;
$$;
revoke all on function private.assert_owner_purchase_stock_snapshots(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.finalize_owner_purchase_voucher_impl(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_actor_id uuid,
  p_existing_receipt_id uuid,
  p_receipt_line_links jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_receipt public.inventory_receipts%rowtype;
  v_line record;
  v_link jsonb;
  v_purchase_line_id uuid;
  v_receipt_line_id uuid;
  v_receipt_id uuid;
  v_actor_label text;
  v_stock_count integer;
  v_link_count integer := 0;
  v_seen_purchase_ids uuid[] := array[]::uuid[];
  v_seen_receipt_ids uuid[] := array[]::uuid[];
  v_line_links jsonb;
  v_request jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_receipt_lines jsonb;
begin
  if p_receipt_line_links is null then
    v_line_links := '[]'::jsonb;
  else
    v_line_links := p_receipt_line_links;
  end if;
  if jsonb_typeof(v_line_links) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Receipt line links must be an array';
  end if;
  v_request := jsonb_build_object(
    'existing_receipt_id', p_existing_receipt_id,
    'receipt_line_links', v_line_links
  );

  perform private.lock_inventory_owner(p_owner_id);
  select * into v_voucher
  from public.owner_purchase_vouchers
  where owner_id = p_owner_id and id = p_voucher_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Purchase voucher not found';
  end if;
  if v_voucher.status = 'finalized' then
    if v_voucher.finalization_request is distinct from v_request then
      raise exception using errcode = '22023', message = 'Voucher was already finalized with a different stock-link request';
    end if;
    return v_voucher.finalization_result;
  end if;
  if v_voucher.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Only a draft voucher can be finalized';
  end if;

  perform private.assert_owner_purchase_stock_snapshots(p_owner_id, p_voucher_id);
  select count(*)::integer into v_stock_count
  from public.owner_purchase_lines
  where owner_id = p_owner_id and voucher_id = p_voucher_id and active and inventory_class = 'stock';

  v_before := private.owner_purchase_snapshot(p_owner_id, p_voucher_id);
  if v_stock_count = 0 then
    if p_existing_receipt_id is not null or jsonb_array_length(v_line_links) <> 0 then
      raise exception using errcode = '22023', message = 'A voucher without stock lines cannot link an inventory receipt';
    end if;
    v_receipt_id := null;
  elsif p_existing_receipt_id is null then
    if jsonb_array_length(v_line_links) <> 0 then
      raise exception using errcode = '22023', message = 'Receipt line links require an existing receipt';
    end if;
    select coalesce(nullif(btrim(account.email), ''), p_actor_id::text)
    into v_actor_label
    from auth.users as account where account.id = p_actor_id;
    if v_actor_label is null then
      raise exception using errcode = '42501', message = 'Owner account was not found';
    end if;
    insert into public.inventory_receipts (owner_id, created_by, created_by_label, updated_by)
    values (p_owner_id, p_actor_id, v_actor_label, p_actor_id)
    returning id into v_receipt_id;

    select jsonb_agg(jsonb_build_object(
      'item_id', line.inventory_item_id::text,
      'large_quantity', trunc(line.large_quantity)::text,
      'loose_quantity', line.loose_quantity::text
    ) order by line.line_number, line.id)
    into v_receipt_lines
    from public.owner_purchase_lines as line
    where line.owner_id = p_owner_id and line.voucher_id = p_voucher_id
      and line.active and line.inventory_class = 'stock';
    perform private.replace_inventory_receipt_lines(v_receipt_id, p_owner_id, v_receipt_lines);

    for v_line in
      select line.id, row_number() over (order by line.line_number, line.id)::integer as receipt_line_number
      from public.owner_purchase_lines as line
      where line.owner_id = p_owner_id and line.voucher_id = p_voucher_id
        and line.active and line.inventory_class = 'stock'
      order by line.line_number, line.id
    loop
      insert into public.owner_purchase_stock_links (
        owner_id, voucher_id, purchase_line_id, receipt_id, receipt_line_id, linked_by
      )
      select p_owner_id, p_voucher_id, v_line.id, line.receipt_id, line.id, p_actor_id
      from public.inventory_receipt_lines as line
      where line.owner_id = p_owner_id and line.receipt_id = v_receipt_id
        and line.line_number = v_line.receipt_line_number;
      if not found then
        raise exception using errcode = '22023', message = 'Could not link a created receipt line to its purchase line';
      end if;
    end loop;
    perform private.append_inventory_receipt_snapshot(
      p_owner_id, v_receipt_id, 'receipt_created', p_actor_id, null, null
    );
  else
    if jsonb_array_length(v_line_links) <> v_stock_count then
      raise exception using errcode = '22023', message = 'Every stock purchase line must link to exactly one existing receipt line';
    end if;
    select * into v_receipt
    from public.inventory_receipts
    where owner_id = p_owner_id and id = p_existing_receipt_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Existing inventory receipt not found';
    end if;
    v_receipt_id := v_receipt.id;

    for v_link in select value from jsonb_array_elements(v_line_links) as links(value)
    loop
      if jsonb_typeof(v_link) is distinct from 'object'
        or jsonb_typeof(v_link -> 'purchase_line_id') is distinct from 'string'
        or jsonb_typeof(v_link -> 'receipt_line_id') is distinct from 'string' then
        raise exception using errcode = '22023', message = 'Invalid receipt line link';
      end if;
      begin
        v_purchase_line_id := (v_link ->> 'purchase_line_id')::uuid;
        v_receipt_line_id := (v_link ->> 'receipt_line_id')::uuid;
      exception when others then
        raise exception using errcode = '22023', message = 'Invalid receipt line link';
      end;
      if v_purchase_line_id = any(v_seen_purchase_ids) or v_receipt_line_id = any(v_seen_receipt_ids) then
        raise exception using errcode = '22023', message = 'Receipt links must be one-to-one';
      end if;
      v_seen_purchase_ids := array_append(v_seen_purchase_ids, v_purchase_line_id);
      v_seen_receipt_ids := array_append(v_seen_receipt_ids, v_receipt_line_id);

      select * into v_line
      from public.owner_purchase_lines as line
      where line.owner_id = p_owner_id and line.voucher_id = p_voucher_id
        and line.id = v_purchase_line_id and line.active and line.inventory_class = 'stock'
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'Purchase stock line does not belong to this voucher';
      end if;
      perform 1
      from public.inventory_receipt_lines as receipt_line
      where receipt_line.owner_id = p_owner_id and receipt_line.receipt_id = v_receipt_id
        and receipt_line.id = v_receipt_line_id
        and receipt_line.item_id = v_line.inventory_item_id
        and receipt_line.converted_quantity is not distinct from v_line.converted_quantity
        and not exists (
          select 1 from public.owner_purchase_stock_links as source_link
          where source_link.owner_id = p_owner_id and source_link.receipt_line_id = receipt_line.id
        )
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'Existing receipt line does not exactly match or is already linked';
      end if;
      insert into public.owner_purchase_stock_links (
        owner_id, voucher_id, purchase_line_id, receipt_id, receipt_line_id, linked_by
      ) values (
        p_owner_id, p_voucher_id, v_purchase_line_id, v_receipt_id, v_receipt_line_id, p_actor_id
      );
      v_link_count := v_link_count + 1;
    end loop;
    if v_link_count <> v_stock_count then
      raise exception using errcode = '22023', message = 'Not every stock line was linked';
    end if;
    perform private.append_inventory_receipt_snapshot(
      p_owner_id, v_receipt_id, 'receipt_corrected', p_actor_id,
      'Linked to owner purchase voucher ' || p_voucher_id::text, clock_timestamp()
    );
  end if;

  v_result := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'status', 'finalized',
    'inventory_receipt_id', v_receipt_id
  );
  update public.owner_purchase_vouchers
  set status = 'finalized', finalized_by = p_actor_id, finalized_at = clock_timestamp(),
      linked_inventory_receipt_id = v_receipt_id,
      inventory_receipt_created = (v_stock_count > 0 and p_existing_receipt_id is null),
      finalization_request = v_request, finalization_result = v_result,
      updated_by = p_actor_id, updated_at = clock_timestamp()
  where owner_id = p_owner_id and id = p_voucher_id;
  v_after := private.owner_purchase_snapshot(p_owner_id, p_voucher_id);
  perform private.append_owner_purchase_event(
    p_owner_id, p_voucher_id, 'voucher_finalized', p_actor_id, null,
    v_before, v_after, v_receipt_id, null
  );
  return v_result;
end;
$$;
revoke all on function private.finalize_owner_purchase_voucher_impl(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.owner_create_purchase_voucher(
  p_purchase_date date,
  p_vendor text,
  p_invoice_total_vnd bigint,
  p_note text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher_id uuid;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_purchase_date is null or p_purchase_date < date '2026-09-01'
    or p_invoice_total_vnd is null or p_invoice_total_vnd not between 1 and 9007199254740991
    or (p_vendor is not null and length(btrim(p_vendor)) not between 1 and 160)
    or (p_note is not null and length(p_note) > 4000) then
    raise exception using errcode = '22023', message = 'Invalid purchase voucher';
  end if;

  insert into public.owner_purchase_vouchers (
    owner_id, purchase_date, vendor, invoice_total_vnd, note,
    created_by, updated_by
  ) values (
    v_actor, p_purchase_date, nullif(btrim(p_vendor), ''), p_invoice_total_vnd, nullif(btrim(p_note), ''),
    v_actor, v_actor
  ) returning id into v_voucher_id;
  perform private.write_owner_purchase_lines(v_actor, v_voucher_id, p_lines, false);
  perform private.append_owner_purchase_event(
    v_actor, v_voucher_id, 'voucher_created', v_actor, null, null,
    private.owner_purchase_snapshot(v_actor, v_voucher_id), null, null
  );
  return v_voucher_id;
end;
$$;
revoke all on function public.owner_create_purchase_voucher(date, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.owner_create_purchase_voucher(date, text, bigint, text, jsonb)
  to authenticated;

create function public.owner_update_purchase_voucher(
  p_voucher_id uuid,
  p_purchase_date date,
  p_vendor text,
  p_invoice_total_vnd bigint,
  p_note text,
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
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_before jsonb;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_purchase_date is null or p_purchase_date < date '2026-09-01'
    or p_invoice_total_vnd is null or p_invoice_total_vnd not between 1 and 9007199254740991
    or (p_vendor is not null and length(btrim(p_vendor)) not between 1 and 160)
    or (p_note is not null and length(p_note) > 4000) then
    raise exception using errcode = '22023', message = 'Invalid purchase voucher update';
  end if;
  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Only a draft voucher can be edited';
  end if;
  v_before := private.owner_purchase_snapshot(v_actor, p_voucher_id);
  update public.owner_purchase_vouchers set
    purchase_date = p_purchase_date,
    vendor = nullif(btrim(p_vendor), ''),
    invoice_total_vnd = p_invoice_total_vnd,
    note = nullif(btrim(p_note), ''),
    updated_by = v_actor,
    updated_at = clock_timestamp()
  where owner_id = v_actor and id = p_voucher_id;
  perform private.write_owner_purchase_lines(v_actor, p_voucher_id, p_lines, false);
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'voucher_updated', v_actor, btrim(p_reason),
    v_before, private.owner_purchase_snapshot(v_actor, p_voucher_id), null, null
  );
  return p_voucher_id;
end;
$$;
revoke all on function public.owner_update_purchase_voucher(uuid, date, text, bigint, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.owner_update_purchase_voucher(uuid, date, text, bigint, text, jsonb, text)
  to authenticated;

create function public.owner_cancel_purchase_voucher(p_voucher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_event_id uuid := gen_random_uuid();
  v_now timestamptz;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'A cancellation reason is required';
  end if;
  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Only a draft voucher can be canceled';
  end if;
  v_now := clock_timestamp();
  v_before := private.owner_purchase_snapshot(v_actor, p_voucher_id);
  v_after := jsonb_set(jsonb_set(v_before, '{voucher,status}', '"canceled"'::jsonb),
    '{voucher,cancel_reason}', to_jsonb(btrim(p_reason)), true);
  insert into public.owner_purchase_events (
    id, owner_id, voucher_id, event_type, actor_id, occurred_at, reason,
    before_state, after_state
  ) values (
    v_event_id, v_actor, p_voucher_id, 'voucher_canceled', v_actor, v_now, btrim(p_reason),
    v_before, v_after
  );
  update public.owner_purchase_vouchers set
    status = 'canceled', canceled_by = v_actor, canceled_at = v_now,
    cancel_reason = btrim(p_reason), cancel_event_id = v_event_id,
    updated_by = v_actor, updated_at = v_now
  where owner_id = v_actor and id = p_voucher_id;
end;
$$;
revoke all on function public.owner_cancel_purchase_voucher(uuid, text)
  from public, anon, authenticated;
grant execute on function public.owner_cancel_purchase_voucher(uuid, text)
  to authenticated;

create function public.owner_finalize_purchase_voucher(
  p_voucher_id uuid,
  p_existing_receipt_id uuid default null,
  p_receipt_line_links jsonb default '[]'::jsonb
)
returns jsonb
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
  return private.finalize_owner_purchase_voucher_impl(
    v_actor, p_voucher_id, v_actor, p_existing_receipt_id, p_receipt_line_links
  );
end;
$$;
revoke all on function public.owner_finalize_purchase_voucher(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.owner_finalize_purchase_voucher(uuid, uuid, jsonb)
  to authenticated;

create function public.owner_resolve_purchase_duplicate(
  p_voucher_id uuid,
  p_daily_expense_id uuid,
  p_resolution text,
  p_reason text,
  p_existing_receipt_id uuid,
  p_receipt_line_links jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_expense public.daily_expenses%rowtype;
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_existing public.owner_purchase_source_links%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_before_expense jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
  v_finalization jsonb;
  v_now timestamptz;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_idempotency_key is null
    or p_resolution is null or p_resolution not in ('personal_paid', 'shop_cash', 'different_purchase')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_receipt_line_links is null or jsonb_typeof(p_receipt_line_links) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid duplicate resolution';
  end if;
  v_request := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'daily_expense_id', p_daily_expense_id,
    'resolution', p_resolution,
    'reason', btrim(p_reason),
    'existing_receipt_id', p_existing_receipt_id,
    'receipt_line_links', p_receipt_line_links
  );

  perform private.lock_inventory_owner(v_actor);
  select * into v_existing from public.owner_purchase_source_links
  where owner_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different duplicate decision';
    end if;
    return v_existing.result_payload;
  end if;
  select * into v_existing from public.owner_purchase_source_links
  where owner_id = v_actor and daily_expense_id = p_daily_expense_id;
  if found then
    raise exception using errcode = '22023', message = 'This daily expense already has a recorded source decision';
  end if;

  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'draft' then
    raise exception using errcode = '22023', message = 'Duplicate review requires an owner purchase draft';
  end if;
  select * into v_expense from public.daily_expenses
  where owner_id = v_actor and id = p_daily_expense_id for update;
  if not found or v_expense.deleted_at is not null then
    raise exception using errcode = '22023', message = 'Daily expense is missing or already inactive';
  end if;

  v_now := clock_timestamp();
  v_before_expense := to_jsonb(v_expense);
  v_before_state := jsonb_build_object(
    'voucher', private.owner_purchase_snapshot(v_actor, p_voucher_id),
    'daily_expense', v_before_expense
  );
  if p_resolution = 'personal_paid' then
    v_finalization := private.finalize_owner_purchase_voucher_impl(
      v_actor, p_voucher_id, v_actor, p_existing_receipt_id, p_receipt_line_links
    );
    update public.daily_expenses set
      deleted_at = v_now,
      deleted_by = v_actor,
      updated_at = v_now
    where owner_id = v_actor and id = p_daily_expense_id and deleted_at is null;
    if not found then
      raise exception using errcode = '40001', message = 'Daily expense changed during duplicate resolution';
    end if;
  elsif p_resolution = 'shop_cash' then
    if p_existing_receipt_id is not null or jsonb_array_length(p_receipt_line_links) <> 0 then
      raise exception using errcode = '22023', message = 'A shop-funded duplicate cannot create or link owner stock';
    end if;
    perform public.owner_cancel_purchase_voucher(p_voucher_id, btrim(p_reason));
    v_finalization := null;
  else
    v_finalization := private.finalize_owner_purchase_voucher_impl(
      v_actor, p_voucher_id, v_actor, p_existing_receipt_id, p_receipt_line_links
    );
  end if;

  select * into v_expense from public.daily_expenses
  where owner_id = v_actor and id = p_daily_expense_id;
  v_result := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'daily_expense_id', p_daily_expense_id,
    'resolution', p_resolution,
    'voucher_result', v_finalization,
    'expense_deleted', v_expense.deleted_at is not null
  );
  insert into public.owner_purchase_source_links (
    owner_id, daily_expense_id, voucher_id, resolution, before_state,
    request_payload, result_payload, idempotency_key, actor_id
  ) values (
    v_actor, p_daily_expense_id, p_voucher_id, p_resolution, v_before_expense,
    v_request, v_result, p_idempotency_key, v_actor
  );
  v_after_state := jsonb_build_object(
    'voucher', private.owner_purchase_snapshot(v_actor, p_voucher_id),
    'daily_expense', to_jsonb(v_expense),
    'resolution', p_resolution
  );
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'duplicate_resolved', v_actor, btrim(p_reason),
    v_before_state, v_after_state, p_daily_expense_id, p_idempotency_key
  );
  return v_result;
end;
$$;
revoke all on function public.owner_resolve_purchase_duplicate(uuid, uuid, text, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_resolve_purchase_duplicate(uuid, uuid, text, text, uuid, jsonb, uuid)
  to authenticated;

create function public.owner_record_purchase_reimbursement(
  p_voucher_id uuid,
  p_event_type text,
  p_business_date date,
  p_amount_vnd bigint,
  p_note text,
  p_idempotency_key uuid,
  p_reverses_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_existing public.owner_purchase_reimbursements%rowtype;
  v_original public.owner_purchase_reimbursements%rowtype;
  v_request jsonb;
  v_result jsonb;
  v_event_id uuid := gen_random_uuid();
  v_net_paid bigint;
  v_reversed_for_event bigint;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_event_type is null or p_event_type not in ('payment', 'reversal')
    or p_business_date is null or p_business_date < date '2026-09-01'
    or p_amount_vnd is null or p_amount_vnd not between 1 and 9007199254740991
    or p_idempotency_key is null
    or (p_note is not null and length(p_note) > 1000)
    or (p_event_type = 'payment' and p_reverses_event_id is not null)
    or (p_event_type = 'reversal' and p_reverses_event_id is null) then
    raise exception using errcode = '22023', message = 'Invalid reimbursement event';
  end if;
  v_request := jsonb_build_object(
    'event_type', p_event_type,
    'business_date', p_business_date,
    'amount_vnd', p_amount_vnd,
    'note', nullif(btrim(p_note), ''),
    'reverses_event_id', p_reverses_event_id
  );

  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only a finalized purchase can receive a reimbursement';
  end if;
  select * into v_existing from public.owner_purchase_reimbursements
  where owner_id = v_actor and voucher_id = p_voucher_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different reimbursement';
    end if;
    return v_existing.result_payload;
  end if;

  select coalesce(sum(case when event_type = 'payment' then amount_vnd else -amount_vnd end), 0)::bigint
  into v_net_paid
  from public.owner_purchase_reimbursements
  where owner_id = v_actor and voucher_id = p_voucher_id;
  if p_event_type = 'payment' then
    if v_net_paid + p_amount_vnd > v_voucher.invoice_total_vnd then
      raise exception using errcode = '22023', message = 'Reimbursements cannot exceed the amount personally advanced';
    end if;
    v_net_paid := v_net_paid + p_amount_vnd;
  else
    select * into v_original from public.owner_purchase_reimbursements
    where owner_id = v_actor and voucher_id = p_voucher_id
      and id = p_reverses_event_id and event_type = 'payment'
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'Reversal must reference a payment on this voucher';
    end if;
    select coalesce(sum(amount_vnd), 0)::bigint into v_reversed_for_event
    from public.owner_purchase_reimbursements
    where owner_id = v_actor and reverses_event_id = p_reverses_event_id;
    if v_reversed_for_event + p_amount_vnd > v_original.amount_vnd or v_net_paid < p_amount_vnd then
      raise exception using errcode = '22023', message = 'Reimbursement reversal exceeds the unreversed payment';
    end if;
    v_net_paid := v_net_paid - p_amount_vnd;
  end if;
  if v_net_paid < 0 then
    raise exception using errcode = '22023', message = 'Reimbursement balance cannot be negative';
  end if;

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'reimbursed_vnd', v_net_paid,
    'outstanding_vnd', v_voucher.invoice_total_vnd - v_net_paid
  );
  insert into public.owner_purchase_reimbursements (
    id, owner_id, voucher_id, event_type, business_date, amount_vnd, note,
    reverses_event_id, idempotency_key, request_payload, result_payload, actor_id
  ) values (
    v_event_id, v_actor, p_voucher_id, p_event_type, p_business_date, p_amount_vnd,
    nullif(btrim(p_note), ''), p_reverses_event_id, p_idempotency_key,
    v_request, v_result, v_actor
  );
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'reimbursement_recorded', v_actor, null,
    null, v_result, v_event_id, p_idempotency_key
  );
  return v_result;
end;
$$;
revoke all on function public.owner_record_purchase_reimbursement(uuid, text, date, bigint, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_record_purchase_reimbursement(uuid, text, date, bigint, text, uuid, uuid)
  to authenticated;

create function public.owner_post_purchase_costs(
  p_voucher_id uuid,
  p_line_ids uuid[],
  p_accounting_month date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_request_record public.owner_purchase_profit_requests%rowtype;
  v_line public.owner_purchase_lines%rowtype;
  v_selected_ids uuid[];
  v_request jsonb;
  v_result jsonb;
  v_posted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_accounting_month date;
  v_posting_id uuid;
  v_event_id uuid;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_idempotency_key is null or (p_accounting_month is not null and extract(day from p_accounting_month) <> 1)
    or (p_line_ids is not null and cardinality(p_line_ids) = 0)
    or (p_line_ids is not null and exists (select 1 from unnest(p_line_ids) as id where id is null)) then
    raise exception using errcode = '22023', message = 'Invalid profit posting request';
  end if;
  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only finalized purchases can affect profit';
  end if;
  v_accounting_month := coalesce(p_accounting_month, date_trunc('month', v_voucher.purchase_date)::date);

  if p_line_ids is null then
    select coalesce(array_agg(line.id order by line.id), array[]::uuid[])
    into v_selected_ids
    from public.owner_purchase_lines as line
    where line.owner_id = v_actor and line.voucher_id = p_voucher_id
      and line.active and line.cost_class = 'non_ingredient';
    v_request := jsonb_build_object(
      'voucher_id', p_voucher_id, 'mode', 'all_eligible',
      'line_ids', to_jsonb(v_selected_ids), 'accounting_month', v_accounting_month
    );
  else
    select array_agg(selected.id order by selected.id)
    into v_selected_ids
    from (select distinct id from unnest(p_line_ids) as ids(id)) as selected;
    if cardinality(v_selected_ids) <> cardinality(p_line_ids) then
      raise exception using errcode = '22023', message = 'A profit posting request cannot repeat line IDs';
    end if;
    v_request := jsonb_build_object(
      'voucher_id', p_voucher_id, 'mode', 'selected',
      'line_ids', to_jsonb(v_selected_ids), 'accounting_month', v_accounting_month
    );
  end if;

  select * into v_request_record from public.owner_purchase_profit_requests
  where owner_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_request_record.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different profit request';
    end if;
    return v_request_record.result_payload;
  end if;

  if cardinality(v_selected_ids) > 0 and exists (
    select 1 from unnest(v_selected_ids) as selected(id)
    left join public.owner_purchase_lines as line
      on line.owner_id = v_actor and line.voucher_id = p_voucher_id and line.id = selected.id
    where line.id is null or not line.active or line.cost_class <> 'non_ingredient'
  ) then
    raise exception using errcode = '22023', message = 'Selected lines must be active non-ingredient lines on this voucher';
  end if;
  if cardinality(v_selected_ids) > 0 and exists (
    select 1 from public.owner_purchase_profit_postings as posting
    where posting.owner_id = v_actor and posting.source_line_id = any(v_selected_ids)
      and posting.posting_type = 'post'
  ) then
    raise exception using errcode = '22023', message = 'A selected purchase line was already posted to profit';
  end if;

  for v_line in
    select * from public.owner_purchase_lines as line
    where line.owner_id = v_actor and line.voucher_id = p_voucher_id
      and line.id = any(v_selected_ids) and line.active
    order by line.id
    for update
  loop
    if v_line.line_amount_vnd is null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'line_id', v_line.id, 'description', v_line.description, 'reason', 'missing_line_amount'
      ));
    else
      v_posting_id := gen_random_uuid();
      insert into public.owner_purchase_profit_postings (
        id, owner_id, voucher_id, source_line_id, posting_type, accounting_month,
        amount_vnd, idempotency_key, request_payload, source_snapshot, actor_id
      ) values (
        v_posting_id, v_actor, p_voucher_id, v_line.id, 'post', v_accounting_month,
        v_line.line_amount_vnd, p_idempotency_key, v_request, to_jsonb(v_line), v_actor
      );
      v_posted := v_posted || jsonb_build_array(jsonb_build_object(
        'posting_id', v_posting_id, 'line_id', v_line.id, 'amount_vnd', v_line.line_amount_vnd
      ));
    end if;
  end loop;
  v_result := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'accounting_month', v_accounting_month,
    'posted', v_posted,
    'skipped', v_skipped
  );
  insert into public.owner_purchase_profit_requests (
    owner_id, voucher_id, idempotency_key, request_payload, result_payload, actor_id
  ) values (
    v_actor, p_voucher_id, p_idempotency_key, v_request, v_result, v_actor
  );
  v_event_id := private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'profit_posted', v_actor, null,
    null, v_result, null, p_idempotency_key
  );
  return v_result;
end;
$$;
revoke all on function public.owner_post_purchase_costs(uuid, uuid[], date, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_post_purchase_costs(uuid, uuid[], date, uuid)
  to authenticated;

create function public.owner_reverse_purchase_cost_posting(
  p_posting_id uuid,
  p_accounting_month date,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_original public.owner_purchase_profit_postings%rowtype;
  v_existing_request public.owner_purchase_profit_requests%rowtype;
  v_request jsonb;
  v_accounting_month date;
  v_reversal_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_idempotency_key is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or (p_accounting_month is not null and extract(day from p_accounting_month) <> 1) then
    raise exception using errcode = '22023', message = 'Invalid profit reversal';
  end if;
  perform private.lock_inventory_owner(v_actor);
  select * into v_original from public.owner_purchase_profit_postings
  where owner_id = v_actor and id = p_posting_id and posting_type = 'post';
  if not found then
    raise exception using errcode = '22023', message = 'Profit posting was not found';
  end if;
  perform 1 from public.owner_purchase_vouchers
  where owner_id = v_actor and id = v_original.voucher_id and status = 'finalized'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Profit posting voucher is not finalized';
  end if;
  select * into v_original from public.owner_purchase_profit_postings
  where owner_id = v_actor and id = p_posting_id and posting_type = 'post'
  for update;
  v_accounting_month := coalesce(p_accounting_month, date_trunc('month', private.current_business_date_vn())::date);
  v_request := jsonb_build_object(
    'posting_id', p_posting_id,
    'accounting_month', v_accounting_month,
    'reason', btrim(p_reason)
  );
  select * into v_existing_request from public.owner_purchase_profit_requests
  where owner_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_existing_request.request_payload is distinct from v_request then
      raise exception using errcode = '22023', message = 'Idempotency key was already used with a different profit request';
    end if;
    return (v_existing_request.result_payload ->> 'posting_id')::uuid;
  end if;
  if exists (
    select 1 from public.owner_purchase_profit_postings
    where owner_id = v_actor and reverses_posting_id = p_posting_id
  ) then
    raise exception using errcode = '22023', message = 'Profit posting was already reversed';
  end if;
  insert into public.owner_purchase_profit_postings (
    id, owner_id, voucher_id, source_line_id, posting_type, accounting_month,
    amount_vnd, reverses_posting_id, idempotency_key, request_payload, source_snapshot, actor_id
  ) values (
    v_reversal_id, v_actor, v_original.voucher_id, v_original.source_line_id, 'reversal',
    v_accounting_month, v_original.amount_vnd, v_original.id,
    p_idempotency_key, v_request, v_original.source_snapshot, v_actor
  );
  v_result := jsonb_build_object('posting_id', v_reversal_id, 'reversed_posting_id', p_posting_id);
  insert into public.owner_purchase_profit_requests (
    owner_id, voucher_id, idempotency_key, request_payload, result_payload, actor_id
  ) values (
    v_actor, v_original.voucher_id, p_idempotency_key, v_request, v_result, v_actor
  );
  perform private.append_owner_purchase_event(
    v_actor, v_original.voucher_id, 'profit_reversed', v_actor, btrim(p_reason),
    to_jsonb(v_original), v_result, v_reversal_id, p_idempotency_key
  );
  return v_reversal_id;
end;
$$;
revoke all on function public.owner_reverse_purchase_cost_posting(uuid, date, text, uuid)
  from public, anon, authenticated;
grant execute on function public.owner_reverse_purchase_cost_posting(uuid, date, text, uuid)
  to authenticated;

create function private.correct_shared_owner_purchase_receipt(
  p_owner_id uuid,
  p_voucher_id uuid,
  p_actor_id uuid,
  p_receipt_id uuid,
  p_reason text,
  p_effective_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_receipt public.inventory_receipts%rowtype;
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_purchase_line public.owner_purchase_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_old_link jsonb;
  v_old_links jsonb;
  v_prior_lines jsonb;
  v_actor_label text;
  v_old_receipt_line_id uuid;
  v_receipt_line_id uuid;
  v_old_purchase_line_id uuid;
  v_line_number integer;
  v_expected_converted numeric(20, 3);
  v_max_quantity constant numeric := 99999999999999999.999;
begin
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_effective_at is null then
    raise exception using errcode = '22023', message = 'A stock correction reason and effective time are required';
  end if;
  perform private.lock_inventory_owner(p_owner_id);
  select * into v_voucher
  from public.owner_purchase_vouchers as voucher
  where voucher.owner_id = p_owner_id and voucher.id = p_voucher_id
  for update;
  if not found or v_voucher.status <> 'finalized'
    or v_voucher.linked_inventory_receipt_id is distinct from p_receipt_id then
    raise exception using errcode = '42501', message = 'Receipt is not linked to this finalized owner purchase';
  end if;
  select * into v_receipt
  from public.inventory_receipts
  where owner_id = p_owner_id and id = p_receipt_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Linked inventory receipt was not found';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', receipt_line.id,
      'receipt_id', receipt_line.receipt_id,
      'line_number', receipt_line.line_number,
      'item_id', receipt_line.item_id,
      'item_name', receipt_line.item_name,
      'category', receipt_line.category,
      'large_unit', receipt_line.large_unit,
      'large_quantity', receipt_line.large_quantity::text,
      'conversion_factor', receipt_line.conversion_factor::text,
      'small_unit', receipt_line.small_unit,
      'loose_quantity', receipt_line.loose_quantity::text,
      'converted_quantity', receipt_line.converted_quantity::text,
      'source_voucher_id', source_link.voucher_id,
      'purchase_line_id', source_link.purchase_line_id,
      'created_at', receipt_line.created_at
    ) order by receipt_line.line_number, receipt_line.id
  ), '[]'::jsonb)
  into v_prior_lines
  from public.inventory_receipt_lines as receipt_line
  left join public.owner_purchase_stock_links as source_link
    on source_link.owner_id = receipt_line.owner_id
    and source_link.receipt_line_id = receipt_line.id
  where receipt_line.owner_id = p_owner_id and receipt_line.receipt_id = p_receipt_id;
  if jsonb_array_length(v_prior_lines) = 0 and not exists (
    select 1 from public.inventory_receipt_corrections as correction
    where correction.owner_id = p_owner_id and correction.receipt_id = p_receipt_id
  ) then
    raise exception using errcode = '22023', message = 'An empty receipt needs an earlier audited correction before it can be corrected again';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'purchase_line_id', source_link.purchase_line_id,
    'receipt_line_id', source_link.receipt_line_id
  ) order by source_link.purchase_line_id), '[]'::jsonb)
  into v_old_links
  from public.owner_purchase_stock_links as source_link
  where source_link.owner_id = p_owner_id and source_link.voucher_id = p_voucher_id
    and source_link.receipt_id = p_receipt_id;

  if exists (
    select 1 from public.owner_purchase_stock_links as source_link
    where source_link.owner_id = p_owner_id and source_link.voucher_id = p_voucher_id
      and source_link.receipt_id <> p_receipt_id
  ) then
    raise exception using errcode = '22023', message = 'Voucher source links do not match the linked receipt';
  end if;

  select coalesce(nullif(btrim(membership.display_name), ''), nullif(btrim(account.email), ''), p_actor_id::text)
  into v_actor_label
  from auth.users as account
  left join public.store_memberships as membership
    on membership.owner_id = p_owner_id and membership.user_id = p_actor_id
  where account.id = p_actor_id;
  insert into public.inventory_receipt_corrections (
    owner_id, receipt_id, corrected_at, corrected_by, corrected_by_label, reason, prior_lines
  ) values (
    p_owner_id, p_receipt_id, p_effective_at, p_actor_id,
    coalesce(v_actor_label, p_actor_id::text), btrim(p_reason), v_prior_lines
  );

  -- Remove only this voucher's source links before touching linked rows, so the
  -- mutation guard continues to protect all other receipts and all unrelated lines.
  delete from public.owner_purchase_stock_links
  where owner_id = p_owner_id and voucher_id = p_voucher_id;

  for v_old_link in select value from jsonb_array_elements(v_old_links) as links(value)
  loop
    v_old_purchase_line_id := (v_old_link ->> 'purchase_line_id')::uuid;
    v_old_receipt_line_id := (v_old_link ->> 'receipt_line_id')::uuid;
    if not exists (
      select 1 from public.owner_purchase_lines as purchase_line
      where purchase_line.owner_id = p_owner_id and purchase_line.voucher_id = p_voucher_id
        and purchase_line.id = v_old_purchase_line_id and purchase_line.active
        and purchase_line.inventory_class = 'stock'
    ) then
      delete from public.inventory_receipt_lines as receipt_line
      where receipt_line.owner_id = p_owner_id and receipt_line.receipt_id = p_receipt_id
        and receipt_line.id = v_old_receipt_line_id;
      if not found then
        raise exception using errcode = '22023', message = 'Removed purchase source row is no longer in the linked receipt';
      end if;
    end if;
  end loop;

  for v_purchase_line in
    select purchase_line.*
    from public.owner_purchase_lines as purchase_line
    where purchase_line.owner_id = p_owner_id and purchase_line.voucher_id = p_voucher_id
      and purchase_line.active and purchase_line.inventory_class = 'stock'
    order by purchase_line.line_number, purchase_line.id
    for update
  loop
    select (links.value ->> 'receipt_line_id')::uuid
    into v_receipt_line_id
    from jsonb_array_elements(v_old_links) as links(value)
    where (links.value ->> 'purchase_line_id')::uuid = v_purchase_line.id;

    select * into v_item
    from public.inventory_items as item
    where item.owner_id = p_owner_id and item.id = v_purchase_line.inventory_item_id
      and item.active
    for share;
    if not found or v_item.conversion_factor is null or v_item.conversion_factor <= 0
      or v_item.small_unit is null or length(btrim(v_item.small_unit)) = 0
      or v_item.name is distinct from v_purchase_line.item_name_snapshot
      or v_item.category is distinct from v_purchase_line.category_snapshot
      or v_item.large_unit is distinct from v_purchase_line.large_unit_snapshot
      or v_item.conversion_factor is distinct from v_purchase_line.conversion_factor_snapshot
      or v_item.small_unit is distinct from v_purchase_line.small_unit_snapshot then
      raise exception using errcode = '22023', message = 'Stock item or conversion changed; refresh the purchase line before correcting its receipt';
    end if;
    if v_purchase_line.large_quantity is null or v_purchase_line.large_quantity < 0
      or v_purchase_line.large_quantity <> trunc(v_purchase_line.large_quantity)
      or v_purchase_line.loose_quantity is null or v_purchase_line.loose_quantity < 0 then
      raise exception using errcode = '22023', message = 'Invalid stock purchase quantity';
    end if;
    if v_item.large_unit is null then
      if v_purchase_line.large_quantity <> 0 then
        raise exception using errcode = '22023', message = 'This item has no purchase-unit conversion';
      end if;
      v_expected_converted := v_purchase_line.loose_quantity;
    else
      v_expected_converted := v_purchase_line.large_quantity * v_item.conversion_factor
        + v_purchase_line.loose_quantity;
    end if;
    if lower(btrim(v_item.small_unit)) not in ('gr', 'ml')
      and v_purchase_line.loose_quantity <> trunc(v_purchase_line.loose_quantity) then
      raise exception using errcode = '22023', message = 'This unit does not allow fractional loose quantities';
    end if;
    if v_expected_converted <= 0 or v_expected_converted > v_max_quantity
      or v_expected_converted is distinct from v_purchase_line.converted_quantity then
      raise exception using errcode = '22023', message = 'Corrected stock quantity must be positive and match its saved conversion';
    end if;

    if v_receipt_line_id is not null then
      select receipt_line.line_number into v_line_number
      from public.inventory_receipt_lines as receipt_line
      where receipt_line.owner_id = p_owner_id and receipt_line.receipt_id = p_receipt_id
        and receipt_line.id = v_receipt_line_id
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'A retained purchase source line is missing from its receipt';
      end if;
      update public.inventory_receipt_lines
      set item_id = v_item.id,
        item_name = v_item.name,
        category = v_item.category,
        large_unit = v_item.large_unit,
        large_quantity = v_purchase_line.large_quantity,
        conversion_factor = v_item.conversion_factor,
        small_unit = v_item.small_unit,
        loose_quantity = v_purchase_line.loose_quantity,
        converted_quantity = v_expected_converted
      where owner_id = p_owner_id and receipt_id = p_receipt_id and id = v_receipt_line_id;
    else
      select slot.line_number into v_line_number
      from generate_series(1, 200) as slot(line_number)
      where not exists (
        select 1 from public.inventory_receipt_lines as receipt_line
        where receipt_line.owner_id = p_owner_id and receipt_line.receipt_id = p_receipt_id
          and receipt_line.line_number = slot.line_number
      )
      order by slot.line_number
      limit 1;
      if not found then
        raise exception using errcode = '22023', message = 'Shared receipt has no free line slot for a new purchase item';
      end if;
      insert into public.inventory_receipt_lines (
        owner_id, receipt_id, line_number, item_id, item_name, category, large_unit,
        large_quantity, conversion_factor, small_unit, loose_quantity, converted_quantity
      ) values (
        p_owner_id, p_receipt_id, v_line_number, v_item.id, v_item.name, v_item.category,
        v_item.large_unit, v_purchase_line.large_quantity, v_item.conversion_factor,
        v_item.small_unit, v_purchase_line.loose_quantity, v_expected_converted
      ) returning id into v_receipt_line_id;
    end if;

    insert into public.owner_purchase_stock_links (
      owner_id, voucher_id, purchase_line_id, receipt_id, receipt_line_id, linked_by
    ) values (
      p_owner_id, p_voucher_id, v_purchase_line.id, p_receipt_id, v_receipt_line_id, p_actor_id
    );
  end loop;

  update public.inventory_receipts
  set updated_at = p_effective_at, updated_by = p_actor_id
  where owner_id = p_owner_id and id = p_receipt_id;
  perform private.append_inventory_receipt_snapshot(
    p_owner_id, p_receipt_id, 'receipt_corrected', p_actor_id, btrim(p_reason), p_effective_at
  );
end;
$$;
revoke all on function private.correct_shared_owner_purchase_receipt(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

create function public.owner_correct_purchase_voucher(
  p_voucher_id uuid,
  p_purchase_date date,
  p_vendor text,
  p_invoice_total_vnd bigint,
  p_note text,
  p_lines jsonb,
  p_existing_receipt_id uuid,
  p_receipt_line_links jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_voucher public.owner_purchase_vouchers%rowtype;
  v_line record;
  v_link jsonb;
  v_receipt public.inventory_receipts%rowtype;
  v_purchase_line_id uuid;
  v_receipt_line_id uuid;
  v_stock_count integer;
  v_link_count integer := 0;
  v_links jsonb;
  v_before jsonb;
  v_after jsonb;
  v_request jsonb;
  v_result jsonb;
  v_receipt_lines jsonb;
  v_actor_label text;
  v_reimbursed bigint;
  v_active_postings integer;
  v_now timestamptz;
begin
  if v_actor is null or not private.is_store_owner() then
    raise exception using errcode = '42501', message = 'Store owner access required';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_purchase_date is null or p_purchase_date < date '2026-09-01'
    or p_invoice_total_vnd is null or p_invoice_total_vnd not between 1 and 9007199254740991
    or (p_vendor is not null and length(btrim(p_vendor)) not between 1 and 160)
    or (p_note is not null and length(p_note) > 4000)
    or (p_lines is not null and jsonb_typeof(p_lines) is distinct from 'array') then
    raise exception using errcode = '22023', message = 'Invalid purchase voucher correction';
  end if;
  v_links := coalesce(p_receipt_line_links, '[]'::jsonb);
  if jsonb_typeof(v_links) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Receipt line links must be an array';
  end if;

  perform private.lock_inventory_owner(v_actor);
  select * into v_voucher from public.owner_purchase_vouchers
  where owner_id = v_actor and id = p_voucher_id for update;
  if not found or v_voucher.status <> 'finalized' then
    raise exception using errcode = '22023', message = 'Only a finalized voucher can be corrected';
  end if;
  if v_voucher.linked_inventory_receipt_id is not null and (
    (p_existing_receipt_id is not null
      and p_existing_receipt_id is distinct from v_voucher.linked_inventory_receipt_id)
    or jsonb_array_length(v_links) <> 0
  ) then
    raise exception using errcode = '22023', message = 'A linked receipt correction cannot change receipt identity or supply remapped source links';
  end if;

  -- Lock and validate the old shared-receipt mapping before purchase lines are
  -- rewritten. These source links are the only authority to edit receipt rows;
  -- the caller cannot supply replacement mappings for this correction path.
  if p_lines is not null and v_voucher.linked_inventory_receipt_id is not null then
    if p_existing_receipt_id is not null
      and p_existing_receipt_id is distinct from v_voucher.linked_inventory_receipt_id then
      raise exception using errcode = '22023', message = 'A shared receipt correction must retain its linked receipt and use its saved source links';
    end if;
    select * into v_receipt from public.inventory_receipts
    where owner_id = v_actor and id = v_voucher.linked_inventory_receipt_id for update;
    if not found then
      raise exception using errcode = '22023', message = 'Linked inventory receipt was not found';
    end if;
    if exists (
      select 1 from public.owner_purchase_stock_links as source_link
      where source_link.owner_id = v_actor and source_link.voucher_id = p_voucher_id
        and source_link.receipt_id <> v_receipt.id
    ) or exists (
      select 1 from public.owner_purchase_lines as purchase_line
      left join public.owner_purchase_stock_links as source_link
        on source_link.owner_id = purchase_line.owner_id
        and source_link.voucher_id = purchase_line.voucher_id
        and source_link.purchase_line_id = purchase_line.id
        and source_link.receipt_id = v_receipt.id
      where purchase_line.owner_id = v_actor and purchase_line.voucher_id = p_voucher_id
        and purchase_line.active and purchase_line.inventory_class = 'stock'
        and source_link.id is null
    ) or exists (
      select 1 from public.owner_purchase_stock_links as source_link
      left join public.owner_purchase_lines as purchase_line
        on purchase_line.owner_id = source_link.owner_id
        and purchase_line.voucher_id = source_link.voucher_id
        and purchase_line.id = source_link.purchase_line_id
        and purchase_line.active and purchase_line.inventory_class = 'stock'
      where source_link.owner_id = v_actor and source_link.voucher_id = p_voucher_id
        and (source_link.receipt_id <> v_receipt.id or purchase_line.id is null)
    ) then
      raise exception using errcode = '22023', message = 'Existing shared receipt source links are incomplete or inconsistent';
    end if;
  end if;
  v_now := clock_timestamp();
  select coalesce(sum(case when event_type = 'payment' then amount_vnd else -amount_vnd end), 0)::bigint
  into v_reimbursed
  from public.owner_purchase_reimbursements
  where owner_id = v_actor and voucher_id = p_voucher_id;
  if v_reimbursed > p_invoice_total_vnd then
    raise exception using errcode = '22023', message = 'Corrected invoice total cannot be lower than reimbursements already recorded';
  end if;
  select count(*)::integer into v_active_postings
  from public.owner_purchase_profit_postings as posting
  where posting.owner_id = v_actor and posting.voucher_id = p_voucher_id
    and posting.posting_type = 'post'
    and not exists (
      select 1 from public.owner_purchase_profit_postings as reversal
      where reversal.owner_id = posting.owner_id and reversal.reverses_posting_id = posting.id
    );
  if v_active_postings > 0 and (
    p_lines is not null or p_invoice_total_vnd is distinct from v_voucher.invoice_total_vnd
  ) then
    raise exception using errcode = '22023', message = 'Reverse active profit postings before correcting purchase lines or invoice total';
  end if;

  v_before := private.owner_purchase_snapshot(v_actor, p_voucher_id);
  if p_lines is not null then
    perform private.write_owner_purchase_lines(v_actor, p_voucher_id, p_lines, true);
    perform private.assert_owner_purchase_stock_snapshots(v_actor, p_voucher_id);
  end if;
  select count(*)::integer into v_stock_count
  from public.owner_purchase_lines
  where owner_id = v_actor and voucher_id = p_voucher_id and active and inventory_class = 'stock';
  if p_lines is not null and v_voucher.linked_inventory_receipt_id is not null then
    perform private.correct_shared_owner_purchase_receipt(
      v_actor, p_voucher_id, v_actor, v_voucher.linked_inventory_receipt_id,
      btrim(p_reason), v_now
    );
  elsif p_lines is not null and v_stock_count > 0 then
    if p_existing_receipt_id is null then
      if jsonb_array_length(v_links) <> 0 then
        raise exception using errcode = '22023', message = 'Receipt line links require an existing receipt';
      end if;
      select coalesce(nullif(btrim(account.email), ''), v_actor::text)
      into v_actor_label from auth.users as account where account.id = v_actor;
      insert into public.inventory_receipts (owner_id, created_by, created_by_label, updated_by)
      values (v_actor, v_actor, v_actor_label, v_actor)
      returning id into v_voucher.linked_inventory_receipt_id;
      select jsonb_agg(jsonb_build_object(
        'item_id', line.inventory_item_id::text,
        'large_quantity', trunc(line.large_quantity)::text,
        'loose_quantity', line.loose_quantity::text
      ) order by line.line_number, line.id)
      into v_receipt_lines from public.owner_purchase_lines as line
      where line.owner_id = v_actor and line.voucher_id = p_voucher_id
        and line.active and line.inventory_class = 'stock';
      perform private.replace_inventory_receipt_lines(v_voucher.linked_inventory_receipt_id, v_actor, v_receipt_lines);
      for v_line in
        select line.id, row_number() over (order by line.line_number, line.id)::integer as receipt_line_number
        from public.owner_purchase_lines as line
        where line.owner_id = v_actor and line.voucher_id = p_voucher_id
          and line.active and line.inventory_class = 'stock'
        order by line.line_number, line.id
      loop
        insert into public.owner_purchase_stock_links (
          owner_id, voucher_id, purchase_line_id, receipt_id, receipt_line_id, linked_by
        )
        select v_actor, p_voucher_id, v_line.id, line.receipt_id, line.id, v_actor
        from public.inventory_receipt_lines as line
        where line.owner_id = v_actor and line.receipt_id = v_voucher.linked_inventory_receipt_id
          and line.line_number = v_line.receipt_line_number;
        if not found then
          raise exception using errcode = '22023', message = 'Could not link new receipt line';
        end if;
      end loop;
      perform private.append_inventory_receipt_snapshot(
        v_actor, v_voucher.linked_inventory_receipt_id, 'receipt_created', v_actor, null, null
      );
      v_voucher.inventory_receipt_created := true;
    else
      if jsonb_array_length(v_links) <> v_stock_count then
        raise exception using errcode = '22023', message = 'Every stock purchase line must link to exactly one existing receipt line';
      end if;
      select * into v_receipt from public.inventory_receipts
      where owner_id = v_actor and id = p_existing_receipt_id for update;
      if not found then
        raise exception using errcode = '22023', message = 'Existing inventory receipt not found';
      end if;
      for v_link in select value from jsonb_array_elements(v_links) as links(value)
      loop
        if jsonb_typeof(v_link) is distinct from 'object'
          or jsonb_typeof(v_link -> 'purchase_line_id') is distinct from 'string'
          or jsonb_typeof(v_link -> 'receipt_line_id') is distinct from 'string' then
          raise exception using errcode = '22023', message = 'Invalid receipt line link';
        end if;
        v_purchase_line_id := (v_link ->> 'purchase_line_id')::uuid;
        v_receipt_line_id := (v_link ->> 'receipt_line_id')::uuid;
        select * into v_line from public.owner_purchase_lines as line
        where line.owner_id = v_actor and line.voucher_id = p_voucher_id
          and line.id = v_purchase_line_id and line.active and line.inventory_class = 'stock'
        for update;
        if not found then
          raise exception using errcode = '22023', message = 'Purchase stock line does not belong to this voucher';
        end if;
        perform 1 from public.inventory_receipt_lines as receipt_line
        where receipt_line.owner_id = v_actor and receipt_line.receipt_id = v_receipt.id
          and receipt_line.id = v_receipt_line_id and receipt_line.item_id = v_line.inventory_item_id
          and receipt_line.converted_quantity is not distinct from v_line.converted_quantity
          and not exists (select 1 from public.owner_purchase_stock_links as source_link
            where source_link.owner_id = v_actor and source_link.receipt_line_id = receipt_line.id)
        for update;
        if not found then
          raise exception using errcode = '22023', message = 'Existing receipt line does not exactly match or is already linked';
        end if;
        insert into public.owner_purchase_stock_links (
          owner_id, voucher_id, purchase_line_id, receipt_id, receipt_line_id, linked_by
        ) values (v_actor, p_voucher_id, v_purchase_line_id, v_receipt.id, v_receipt_line_id, v_actor);
        v_link_count := v_link_count + 1;
      end loop;
      if v_link_count <> v_stock_count then
        raise exception using errcode = '22023', message = 'Not every stock line was linked';
      end if;
      perform private.append_inventory_receipt_snapshot(
        v_actor, v_receipt.id, 'receipt_corrected', v_actor,
        'Linked to owner purchase voucher ' || p_voucher_id::text, v_now
      );
      v_voucher.linked_inventory_receipt_id := v_receipt.id;
      v_voucher.inventory_receipt_created := false;
    end if;
  elsif p_lines is not null and v_stock_count = 0 and p_existing_receipt_id is not null then
    raise exception using errcode = '22023', message = 'A voucher without stock lines cannot link an inventory receipt';
  end if;

  select count(*)::integer into v_link_count
  from public.owner_purchase_stock_links
  where owner_id = v_actor and voucher_id = p_voucher_id;

  v_request := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'purchase_date', p_purchase_date,
    'vendor', nullif(btrim(p_vendor), ''),
    'invoice_total_vnd', p_invoice_total_vnd,
    'note', nullif(btrim(p_note), ''),
    'line_correction_requested', p_lines is not null,
    'reason', btrim(p_reason),
    'stock_link_count', v_link_count
  );
  update public.owner_purchase_vouchers set
    purchase_date = p_purchase_date,
    vendor = nullif(btrim(p_vendor), ''),
    invoice_total_vnd = p_invoice_total_vnd,
    note = nullif(btrim(p_note), ''),
    linked_inventory_receipt_id = coalesce(v_voucher.linked_inventory_receipt_id, linked_inventory_receipt_id),
    inventory_receipt_created = v_voucher.inventory_receipt_created,
    updated_by = v_actor,
    updated_at = v_now
  where owner_id = v_actor and id = p_voucher_id;
  v_after := private.owner_purchase_snapshot(v_actor, p_voucher_id);
  perform private.append_owner_purchase_event(
    v_actor, p_voucher_id, 'voucher_corrected', v_actor, btrim(p_reason),
    v_before, v_after || jsonb_build_object('correction_request', v_request),
    v_voucher.linked_inventory_receipt_id, null
  );
  v_result := jsonb_build_object(
    'voucher_id', p_voucher_id,
    'status', 'finalized',
    'inventory_receipt_id', v_voucher.linked_inventory_receipt_id,
    'corrected_at', v_now
  );
  return v_result;
end;
$$;
revoke all on function public.owner_correct_purchase_voucher(uuid, date, text, bigint, text, jsonb, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.owner_correct_purchase_voucher(uuid, date, text, bigint, text, jsonb, uuid, jsonb, text)
  to authenticated;

-- Empty receipt snapshots are a valid state only after an audited correction
-- removes the receipt's last line. Counts still require at least one item.
create or replace function private.inventory_history_snapshot_state_key(
  p_entity_type text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  if p_entity_type is null or p_entity_type not in ('receipt', 'count')
    or jsonb_typeof(p_snapshot) is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(p_snapshot) = 0 then
    if p_entity_type = 'receipt' then return '[]'::jsonb; end if;
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

-- An empty before-state proves a correction only when a previous valid
-- correction could have emptied the receipt. This leaves legacy empty receipts
-- without correction evidence unverified by the original backfill.
create or replace function private.inventory_receipt_correction_history_problem(
  p_owner_id uuid,
  p_receipt_id uuid
)
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
    if private.inventory_history_snapshot_state_key('receipt', v_correction.prior_lines) is null
      or (jsonb_array_length(v_correction.prior_lines) = 0 and v_previous_at is null) then
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

