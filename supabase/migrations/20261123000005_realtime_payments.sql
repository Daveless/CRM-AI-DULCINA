-- El detalle de pedido en el panel necesita ver los pagos en vivo.
alter publication supabase_realtime add table payments;
