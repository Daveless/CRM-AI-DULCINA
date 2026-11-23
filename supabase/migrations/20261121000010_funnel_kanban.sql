-- Tablero Kanban / embudo de ventas. Una conversación = una tarjeta del
-- embudo. El orden de los valores del enum ES el orden del embudo: Postgres
-- compara enums por su posición de declaración, así que basta comparar
-- "new.funnel_stage < old.funnel_stage" para detectar un retroceso, sin
-- necesitar una tabla de orden aparte.
create type funnel_stage as enum (
  'nuevo_contacto',         -- llegó el primer mensaje (Fase A)
  'cotizando',              -- eligiendo producto/hora/sector (Fases B-C)
  'esperando_pago',         -- se enviaron datos bancarios, falta el comprobante
  'pago_en_revision',       -- llegó el comprobante, pedido pendiente_confirmacion (Fase D)
  'confirmado',             -- el operador confirmó el pedido (Fase E — futuro, no implementado aún)
  'en_preparacion_entrega', -- recolectando detalles / en ruta (Fases F-G — futuro, no implementado aún)
  'perdido',                -- rechazado o cancelado — estado final
  'ganado'                  -- entregado — estado final
);

alter table conversations
  add column funnel_stage funnel_stage not null default 'nuevo_contacto',
  add column funnel_stage_changed_at timestamptz not null default now();

-- Bitácora de transiciones: alimenta el tablero Kanban en tiempo real
-- (Supabase Realtime, ver publicación al final de este archivo) y sirve de
-- auditoría de todo movimiento de tarjeta.
create table funnel_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id),
  order_id uuid references orders (id),
  from_stage funnel_stage,
  to_stage funnel_stage not null,
  reset boolean not null default false,
  created_at timestamptz not null default now()
);

create index funnel_events_conversation_idx on funnel_events (conversation_id, created_at);

-- Bloquea mover una tarjeta a un estado anterior del embudo, y bloquea
-- cualquier movimiento una vez que la tarjeta llegó a un estado final
-- (ganado/perdido). Único escape intencional: reset_funnel_for_new_deal()
-- más abajo, para reabrir el embudo con un cliente recurrente sin permitir
-- que un UPDATE cualquiera "retroceda" la tarjeta por accidente (p. ej. al
-- arrastrarla hacia atrás en el Kanban).
create or replace function enforce_funnel_stage_progression()
returns trigger
language plpgsql
as $$
declare
  v_allow_reset boolean := coalesce(current_setting('app.allow_funnel_reset', true), 'false')::boolean;
begin
  if new.funnel_stage is distinct from old.funnel_stage then
    if v_allow_reset then
      new.funnel_stage_changed_at := now();
      insert into funnel_events (conversation_id, order_id, from_stage, to_stage, reset)
      values (new.id, new.draft_order_id, old.funnel_stage, new.funnel_stage, true);
      return new;
    end if;

    if old.funnel_stage in ('ganado', 'perdido') then
      raise exception 'funnel_stage_locked: % ya es un estado final de esta conversación', old.funnel_stage;
    end if;

    if new.funnel_stage < old.funnel_stage then
      raise exception 'funnel_stage_regression: no se puede mover de % a % (retrocede en el embudo)', old.funnel_stage, new.funnel_stage;
    end if;

    new.funnel_stage_changed_at := now();
    insert into funnel_events (conversation_id, order_id, from_stage, to_stage)
    values (new.id, new.draft_order_id, old.funnel_stage, new.funnel_stage);
  end if;

  return new;
end;
$$;

create trigger conversations_funnel_stage_guard
  before update on conversations
  for each row execute function enforce_funnel_stage_progression();

-- Avanza la tarjeta solo si target queda por delante de la etapa actual
-- (GREATEST respeta el orden de declaración del enum). No toca conversaciones
-- ya cerradas (ganado/perdido): si el código del webhook intenta "avanzar"
-- una conversación cerrada, esto no hace nada en vez de reventar; el trigger
-- de arriba sigue siendo la barrera dura contra retrocesos explícitos.
create or replace function advance_funnel_stage(p_conversation_id uuid, p_target funnel_stage)
returns void
language sql
as $$
  update conversations
  set funnel_stage = greatest(funnel_stage, p_target)
  where id = p_conversation_id
    and funnel_stage not in ('ganado', 'perdido');
$$;

-- Única forma permitida de "retroceder": abrir un nuevo ciclo de venta sobre
-- la misma conversación (cliente recurrente) después de cerrar el anterior.
-- No la llama el LLM ni el webhook automáticamente; es una acción explícita
-- (futuro: botón del operador en el panel).
create or replace function reset_funnel_for_new_deal(p_conversation_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.allow_funnel_reset', 'true', true); -- true = solo esta transacción
  update conversations set funnel_stage = 'nuevo_contacto' where id = p_conversation_id;
  perform set_config('app.allow_funnel_reset', 'false', true);
end;
$$;

-- Redefine register_order (creado en 20261121000007) para que, al registrar
-- el pedido, la tarjeta avance a "pago_en_revision". Se redefine aquí (y no
-- en el archivo original) porque la columna funnel_stage todavía no existía
-- cuando esa migración corrió.
create or replace function register_order(p_conversation_id uuid)
returns text
language plpgsql
as $$
declare
  v_conv conversations;
  v_draft jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_code text;
  v_item jsonb;
  v_receipt_message_id uuid;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if v_conv is null then
    raise exception 'conversation_not_found';
  end if;

  v_draft := v_conv.state_data;
  v_customer_id := v_conv.customer_id;

  if v_customer_id is null then
    raise exception 'missing_customer';
  end if;
  if v_draft -> 'items' is null or jsonb_array_length(v_draft -> 'items') = 0 then
    raise exception 'missing_items';
  end if;
  if (v_draft ->> 'requested_at') is null or (v_draft ->> 'delivery_deadline') is null then
    raise exception 'missing_delivery_time';
  end if;
  if (v_draft ->> 'zone_id') is null then
    raise exception 'missing_zone';
  end if;
  if (v_draft ->> 'receipt_message_id') is null then
    raise exception 'missing_receipt';
  end if;

  v_receipt_message_id := (v_draft ->> 'receipt_message_id')::uuid;
  v_order_code := next_order_code();

  insert into orders (
    order_code, customer_id, conversation_id, status, payment_status,
    requested_at, delivery_date, delivery_deadline, min_delivery_allowed,
    declared_sector, zone_id
  ) values (
    v_order_code, v_customer_id, p_conversation_id, 'pendiente_confirmacion', 'comprobante_en_revision',
    (v_draft ->> 'requested_at')::timestamptz,
    (v_draft ->> 'delivery_date')::date,
    (v_draft ->> 'delivery_deadline')::timestamptz,
    (v_draft ->> 'min_delivery_allowed')::timestamptz,
    v_draft ->> 'declared_sector',
    (v_draft ->> 'zone_id')::uuid
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(v_draft -> 'items')
  loop
    insert into order_items (order_id, product_id, product_name, unit_price, price_source, quantity)
    values (
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name',
      (v_item ->> 'unit_price')::numeric,
      coalesce(v_item ->> 'price_source', 'catalogo'),
      (v_item ->> 'quantity')::int
    );
  end loop;

  insert into payments (order_id, kind, receipt_message_id, status)
  values (v_order_id, 'abono', v_receipt_message_id, 'en_revision');

  update conversations
  set state = 'pedido_registrado',
      draft_order_id = v_order_id,
      state_data = '{}'::jsonb,
      funnel_stage = 'pago_en_revision'
  where id = p_conversation_id;

  return v_order_code;
end;
$$;

-- Publicar en Supabase Realtime para que el tablero Kanban reciba los
-- movimientos de tarjeta en vivo (sección 9.10 del manual).
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table funnel_events;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table escalations;
