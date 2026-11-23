-- Escalamiento mínimo para el prototipo: solo lo necesario para pausar el bot
-- y dejar registro cuando el LLM falla, tiene baja confianza, o el cliente pide
-- algo fuera del alcance de las Fases A-D (sección 5 y 7.2 "fallo seguro").
-- El panel de operadores y la matriz completa de recordatorios/guardia
-- (sección 5.3) quedan fuera de este prototipo.
create type escalation_reason as enum (
  'RETRASO', 'ERROR_PEDIDO', 'PROBLEMA_ENTREGA', 'RECLAMO_CALIDAD',
  'REEMBOLSO_CANCELACION', 'TERCERO', 'PERSONALIZACION', 'DUDA_NO_RESUELTA',
  'DATOS_INCOMPLETOS', 'SALDO_PENDIENTE', 'PRECIO_ANUNCIO'
);

create type escalation_priority as enum ('CRITICA', 'ALTA', 'MEDIA', 'NORMAL');
create type escalation_status as enum ('abierta', 'reconocida', 'resuelta');

create table escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id),
  order_id uuid references orders (id),
  reason escalation_reason not null,
  priority escalation_priority not null,
  status escalation_status not null default 'abierta',
  customer_text text,
  summary text,
  detected_by text not null default 'llm' check (detected_by in ('regla', 'llm', 'sistema')),
  confidence numeric,
  created_at timestamptz not null default now()
);

-- Nota: índice único NO parcial a propósito. Un índice parcial (where status <>
-- 'resuelta') no es compatible con el upsert "on_conflict=conversation_id,reason"
-- de PostgREST (Postgres exige que el conflict target coincida exactamente con
-- el predicado del índice). Para el prototipo esto es aceptable porque todavía
-- no existe el flujo que marca una escalación como "resuelta"; cuando se
-- implemente el panel de operadores (fases futuras) hay que revisar esta regla
-- para permitir reabrir el mismo motivo tras resolverlo.
create unique index escalations_open_unique_idx
  on escalations (conversation_id, reason);

create index escalations_status_idx on escalations (status, priority);
