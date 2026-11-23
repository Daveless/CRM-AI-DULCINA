create table customers (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique not null,
  phone_e164 text,
  full_name text,
  email text,
  consent_at timestamptz,
  consent_version text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on customers
  for each row execute function set_updated_at();

create table recipients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_e164 text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger recipients_set_updated_at
  before update on recipients
  for each row execute function set_updated_at();

create index recipients_phone_idx on recipients (phone_e164);
