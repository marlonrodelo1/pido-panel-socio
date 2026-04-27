-- Bug 1 — backfill shipday_tracking_url para pedidos del dispatcher propio
-- que se quedaron sin URL antes del fix en dispatch-order.
-- Solo afecta pedidos con rider_account_id (asignados) y sin URL todavia.
-- Mantiene compatibilidad con pedidos legacy de Shipday: NO toca filas que ya
-- tengan una URL escrita.
UPDATE pedidos
SET shipday_tracking_url = 'https://socio.pidoo.es/seguir/' || codigo
WHERE rider_account_id IS NOT NULL
  AND shipday_tracking_url IS NULL
  AND codigo IS NOT NULL;
