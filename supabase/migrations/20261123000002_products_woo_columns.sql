-- Columnas que faltaban para el sync real con WooCommerce (sección 9.4 del
-- manual las define; la migración original del catálogo (seed manual) no
-- las necesitaba).
alter table products
  add column stock_quantity int,
  add column woo_modified_at timestamptz,
  add column raw jsonb;
