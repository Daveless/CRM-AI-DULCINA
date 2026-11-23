create table conversations (
  id uuid primary key default gen_random_uuid(),
  wa_id text unique not null,
  customer_id uuid references customers (id),
  mode conversation_mode not null default 'bot',
  state conversation_state not null default 'inicio',
  state_data jsonb not null default '{}',
  draft_order_id uuid,
  paused_at timestamptz,
  paused_by text,
  pause_reason text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger conversations_set_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id),
  wa_message_id text unique,
  client_message_id uuid unique,
  direction text not null check (direction in ('in', 'out')),
  sender_type sender_type not null,
  msg_type text not null,
  body text,
  media_wa_id text,
  media_path text,
  media_mime text,
  media_sha256 text,
  latitude numeric,
  longitude numeric,
  template_name text,
  status message_status,
  error_code text,
  error_detail text,
  wa_timestamp timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);
create index messages_receipt_hash_idx on messages (media_sha256);

-- Bandeja idempotente de webhooks (sección 7.2)
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta',
  event_key text unique not null,
  event_type text,
  payload jsonb not null,
  signature_valid boolean not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'done', 'error', 'dead')),
  attempts int not null default 0,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);

create index webhook_events_status_idx on webhook_events (status, received_at);
