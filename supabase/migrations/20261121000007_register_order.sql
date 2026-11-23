-- register_order: transacción que registra el pedido (Fase D) a partir del borrador
-- acumulado en conversations.state_data. Requiere que el borrador ya tenga
-- items, hora válida, sector válido y el comprobante (receipt_message_id).
-- El LLM nunca llama esto directamente: la tool "registrar_pedido" del
-- orquestador invoca esta función vía supabase-js.
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
      state_data = '{}'::jsonb
  where id = p_conversation_id;

  return v_order_code;
end;
$$;
