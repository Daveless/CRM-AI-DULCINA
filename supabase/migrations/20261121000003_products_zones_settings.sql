-- Catálogo (espejo de WooCommerce; para el prototipo se alimenta con seed manual)
create table products (
  id uuid primary key default gen_random_uuid(),
  woo_product_id bigint unique,
  sku text,
  name text not null,
  description text,
  price numeric(10,2) not null,
  regular_price numeric(10,2),
  sale_price numeric(10,2),
  stock_status text default 'instock',
  occasions text[] not null default '{}',
  image_url text,
  permalink text,
  is_active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

create index products_occasions_idx on products using gin (occasions);
create index products_active_idx on products (is_active);

-- Cobertura por nombre de sector (los polígonos exactos aún no existen, sección 9.4)
create table coverage_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  keywords text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger coverage_zones_set_updated_at
  before update on coverage_zones
  for each row execute function set_updated_at();

-- Configuración de la app (sección 9.4)
create table app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- Horario de operadores y de entregas (sección 9.4)
create table business_hours (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('operadores', 'entregas')),
  weekday int not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  is_active boolean not null default true
);
