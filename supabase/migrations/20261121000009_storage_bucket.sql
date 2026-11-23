-- Bucket privado para comprobantes (sección 7.8). Fotos de entrega y chat-media
-- quedan para cuando se implementen las Fases F-G.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
