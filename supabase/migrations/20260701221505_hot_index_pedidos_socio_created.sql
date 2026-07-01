-- Consulta caliente del panel del socio: pedidos por socio ordenados/filtrados por fecha.
create index if not exists idx_pedidos_socio_created on public.pedidos (socio_id, created_at desc);
