-- Extensiones necesarias
create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- Enums (subconjunto necesario para el prototipo Fases A-D)
create type order_status as enum (
  'borrador', 'pendiente_confirmacion', 'confirmado', 'en_ruta',
  'entregado', 'rechazado', 'cancelado'
);

create type payment_item_status as enum ('en_revision', 'verificado', 'rechazado');

create type conversation_mode as enum ('bot', 'humano');

create type conversation_state as enum (
  'inicio', 'asesoria', 'hora_y_sector', 'esperando_comprobante',
  'pedido_registrado', 'recolectando_detalles', 'postventa'
);

create type sender_type as enum ('cliente', 'bot', 'operador', 'sistema');

create type message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

-- Trigger genérico de updated_at
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
