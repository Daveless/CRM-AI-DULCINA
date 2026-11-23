-- Auditoría de cada corrida de sincronización con WooCommerce (sección 7.6
-- y 9.4 del manual). La llama la Edge Function catalog-sync.
create table catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  fetched int not null default 0,
  upserted int not null default 0,
  deactivated int not null default 0,
  error text
);

create index catalog_sync_runs_started_idx on catalog_sync_runs (started_at desc);
