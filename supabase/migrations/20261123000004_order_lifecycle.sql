-- Columnas de orders que el diseño original (sección 9.7) documentaba pero
-- nunca se crearon: cierre del pedido, foto de entrega, y devoluciones.
alter table orders
  add column closed_at timestamptz,
  add column delivery_photo_path text,
  add column prepared_at timestamptz,
  add column refund_amount numeric(10,2),
  add column refund_status text not null default 'no_aplica' check (refund_status in ('no_aplica', 'pendiente', 'realizado'));

-- Ciclo de vida del pedido: bloquea retrocesos de estado (mismo truco que
-- funnel_stage: el orden de declaración del enum order_status ES el orden
-- del ciclo), y exige abono/pago verificado antes de pasar a confirmado.
create or replace function enforce_order_status_progression()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if old.status in ('rechazado', 'cancelado', 'entregado') and new.status not in ('rechazado', 'cancelado') then
      -- entregado puede ir a rechazado/cancelado solo en casos administrativos
      -- excepcionales; en la práctica el panel no ofrece ese botón, pero no
      -- lo bloqueamos aquí para no inventar una regla que el manual no pide.
      null;
    end if;

    if new.status < old.status then
      raise exception 'order_status_regression: no se puede mover de % a % (retrocede)', old.status, new.status;
    end if;

    if new.status = 'confirmado' and new.payment_status not in ('abonado_50', 'pagado_100') then
      raise exception 'order_confirmation_requires_payment: el pago debe estar abonado_50 o pagado_100 antes de confirmar (estado actual: %)', new.payment_status;
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_status_guard
  before update on orders
  for each row execute function enforce_order_status_progression();

-- Recalcula orders.payment_status a partir de los pagos verificados
-- (sección 9.7 — documentado en el diseño original pero nunca implementado
-- hasta ahora). Corre después de cualquier cambio en payments.
create or replace function recalc_order_payment_status()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_order orders;
  v_verified numeric(10,2);
  v_has_pending boolean;
  v_has_rejected boolean;
  v_new_status payment_status;
begin
  select * into v_order from orders where id = v_order_id for update;

  select coalesce(sum(amount_verified), 0) into v_verified
  from payments where order_id = v_order_id and status = 'verificado';

  select exists(select 1 from payments where order_id = v_order_id and status = 'en_revision') into v_has_pending;
  select exists(select 1 from payments where order_id = v_order_id and status = 'rechazado') into v_has_rejected;

  if v_verified >= v_order.total and v_order.total > 0 then
    v_new_status := 'pagado_100';
  elsif v_verified >= v_order.deposit_required and v_order.deposit_required > 0 then
    v_new_status := 'abonado_50';
  elsif v_has_pending then
    v_new_status := case when v_order.status = 'entregado' then 'saldo_en_revision' else 'comprobante_en_revision' end;
  elsif v_has_rejected then
    v_new_status := 'comprobante_rechazado';
  else
    v_new_status := 'sin_comprobante';
  end if;

  update orders
  set payment_status = v_new_status,
      amount_verified = v_verified,
      closed_at = case when v_new_status = 'pagado_100' and v_order.status = 'entregado' then now() else closed_at end
  where id = v_order_id;

  return null;
end;
$$;

create trigger payments_recalc_order_status
  after insert or update or delete on payments
  for each row execute function recalc_order_payment_status();
