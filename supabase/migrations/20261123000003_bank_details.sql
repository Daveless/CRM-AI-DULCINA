-- Datos bancarios para el abono (secciones 1.3 y 3, Fase C). Sin esto el
-- bot no tenía ninguna cuenta real que compartir al pedir el abono — el
-- manual original solo usaba el marcador [DATOS_BANCARIOS]. Editable desde
-- el panel (pestaña Configuración).
insert into app_settings (key, value, description) values
  ('bank_details', '{
    "banco": "PENDIENTE — completar en Configuración",
    "tipo_cuenta": "Ahorros",
    "numero_cuenta": "0000000000",
    "titular": "Dulcina",
    "identificacion": "0000000000001"
  }', 'Cuenta bancaria para el abono del 50%. Editar con los datos reales del negocio antes de producción.')
on conflict (key) do nothing;
