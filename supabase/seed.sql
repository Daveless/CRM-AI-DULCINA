-- Seed para desarrollo local del prototipo Dulcina Bot.
-- El catálogo YA NO se siembra a mano: lo trae la Edge Function
-- catalog-sync desde el sitio real (dulcinachocolates.com). Después de
-- `supabase db reset`, correr:
--   curl -X POST http://127.0.0.1:54321/functions/v1/catalog-sync
-- (requiere WOOCOMMERCE_SITE_URL, WOOCOMERCE_CONSUMIDOR, WOOCOMERCE_SECRET
-- en el env de la función).

-- Cobertura por nombre de sector (sección 1.2). Sin polígonos aún: se valida por palabras clave.
insert into coverage_zones (name, keywords) values
  ('Quito Norte', array['quito norte', 'norte de quito', 'carcelen', 'carapungo', 'calderon', 'cotocollao', 'la carolina', 'quito centro-norte']),
  ('Quito Centro', array['quito centro', 'centro historico', 'la mariscal', 'la floresta', 'san blas']),
  ('Quito Sur', array['quito sur', 'sur de quito', 'quitumbe', 'solanda', 'chillogallo']),
  ('Cumbaya', array['cumbaya']),
  ('Tumbaco', array['tumbaco']),
  ('Los Chillos', array['conocoto', 'alangasi', 'guangopolo', 'la merced', 'amaguana', 'sangolqui', 'san rafael', 'san pedro de taboada', 'rumiñahui', 'ruminahui', 'los chillos']);

-- Configuración (sección 9.4, claves v2.1)
insert into app_settings (key, value, description) values
  ('min_lead_hours', '3', 'Horas mínimas de anticipación desde el momento del pedido'),
  ('deposit_pct', '50', 'Porcentaje de abono requerido'),
  ('same_day_intake_start', '"06:00"', 'Hora desde la que se aceptan pedidos para el mismo día'),
  ('delivery_window_start', '"09:00"', 'Inicio de la ventana de entregas'),
  ('delivery_window_end', '"18:00"', 'Fin de la ventana de entregas'),
  ('timezone', '"America/Guayaquil"', 'Zona horaria de operación'),
  ('llm_confidence_threshold', '0.7', 'Umbral mínimo de confianza antes de escalar como DUDA_NO_RESUELTA');

-- Horario de entregas: todos los días 09:00-18:00 (sección 1.4)
insert into business_hours (kind, weekday, opens_at, closes_at)
select 'entregas', d, '09:00', '18:00' from generate_series(0, 6) d;

-- Horario de operadores: 09:00-13:00 y 14:00-18:00, todos los días (sección 1.4)
insert into business_hours (kind, weekday, opens_at, closes_at)
select 'operadores', d, '09:00', '13:00' from generate_series(0, 6) d;
insert into business_hours (kind, weekday, opens_at, closes_at)
select 'operadores', d, '14:00', '18:00' from generate_series(0, 6) d;
