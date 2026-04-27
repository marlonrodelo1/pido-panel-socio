-- Bug 1 — backfill shipday_tracking_url para pedidos del dispatcher propio
-- que se quedaron sin URL antes del fix en dispatch-order.
-- Solo afecta pedidos con rider_account_id (asignados) y sin URL todavia.
-- Mantiene compatibilidad con pedidos legacy de Shipday: NO toca filas que ya
-- tengan una URL escrita.
--
-- NOTA: a partir de la migracion 20260427_pedidos_tracking_token.sql las URLs
-- llevan el token como ?t=<uuid>. Aqui solo rellena las URLs antiguas que se
-- quedaron sin token; el front ahora tira de tracking_token directo y no
-- depende de esta columna.
UPDATE pedidos
SET shipday_tracking_url = 'https://socio.pidoo.es/seguir/' || codigo
                            || '?t=' || tracking_token
WHERE rider_account_id IS NOT NULL
  AND shipday_tracking_url IS NULL
  AND codigo IS NOT NULL
  AND tracking_token IS NOT NULL;
