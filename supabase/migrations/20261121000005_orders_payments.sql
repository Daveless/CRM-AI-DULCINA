create type payment_status as enum (
  'sin_comprobante', 'comprobante_en_revision', 'abonado_50',
  'saldo_en_revision', 'pagado_100', 'comprobante_rechazado'
);

-- Contador diario para el ID de pedido (sección 2.4)
create table order_counters (
  counter_date date primary key,
  last_value int not null default 0
);

create or replace function next_order_code()
returns text
language plpgsql
as $$
declare
  v_date date := (now() at time zone 'America/Guayaquil')::date;
  v_value int;
begin
  insert into order_counters (counter_date, last_value)
  values (v_date, 1)
  on conflict (counter_date)
  do update set last_value = order_counters.last_value + 1
  returning last_value into v_value;

  return 'PED-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_value::text, 3, '0');
end;
$$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique,
  customer_id uuid not null references customers (id),
  conversation_id uuid not null references conversations (id),
  recipient_id uuid references recipients (id),
  recipient_name text,
  recipient_phone text,
  status order_status not null default 'borrador',
  payment_status payment_status not null default 'sin_comprobante',
  occasion text,
  requested_at timestamptz,
  delivery_date date,
  delivery_deadline timestamptz,
  min_delivery_allowed timestamptz,
  declared_sector text,
  zone_id uuid references coverage_zones (id),
  zone_needs_review boolean not null default false,
  address_text text,
  address_references text,
  maps_url text,
  latitude numeric,
  longitude numeric,
  card_message text,
  is_anonymous boolean,
  sender_name text,
  wants_delivery_photo boolean,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  deposit_required numeric(10,2) not null default 0,
  amount_verified numeric(10,2) not null default 0,
  datos_completos boolean not null default false,
  details_requested_at timestamptz,
  details_completed_at timestamptz,
  details_deadline_at timestamptz,
  courier_id uuid,
  confirmed_at timestamptz,
  delivered_at timestamptz,
  rejected_reason text,
  cancelled_reason text,
  cancelled_at timestamptz,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

create index orders_status_idx on orders (status, delivery_deadline);
create index orders_customer_idx on orders (customer_id);
create index orders_recipient_idx on orders (recipient_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id),
  product_name text not null,
  unit_price numeric(10,2) not null,
  price_source text not null default 'catalogo' check (price_source in ('catalogo', 'anuncio', 'operador')),
  quantity int not null check (quantity > 0),
  line_total numeric(10,2) generated always as (unit_price * quantity) stored,
  card_message text,
  notes text,
  created_at timestamptz not null default now()
);

create index order_items_order_idx on order_items (order_id);

-- Trigger: recalcula subtotal/total/abono del pedido al cambiar sus ítems
create or replace function recalc_order_totals()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_subtotal numeric(10,2);
begin
  select coalesce(sum(line_total), 0) into v_subtotal
  from order_items where order_id = v_order_id;

  update orders
  set subtotal = v_subtotal,
      total = v_subtotal,
      deposit_required = ceil(v_subtotal / 2 * 100) / 100
  where id = v_order_id;

  return null;
end;
$$;

create trigger order_items_recalc_totals
  after insert or update or delete on order_items
  for each row execute function recalc_order_totals();

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id),
  kind text not null check (kind in ('abono', 'saldo', 'total', 'devolucion')),
  amount_declared numeric(10,2),
  amount_verified numeric(10,2),
  method text not null default 'transferencia',
  bank_reference text,
  receipt_message_id uuid references messages (id),
  receipt_path text,
  receipt_sha256 text,
  status payment_item_status not null default 'en_revision',
  verified_by uuid,
  verified_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index payments_order_idx on payments (order_id);
create index payments_receipt_hash_idx on payments (receipt_sha256);
