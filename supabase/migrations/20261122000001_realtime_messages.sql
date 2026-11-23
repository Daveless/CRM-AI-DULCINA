-- El panel de operador (chat view) necesita recibir mensajes nuevos en vivo;
-- se omitió de la migración 20261121000010 al publicar solo las tablas del
-- embudo/Kanban.
alter publication supabase_realtime add table messages;
