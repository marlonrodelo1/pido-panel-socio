-- Tracking publico sin PII: cada pedido lleva un UUID secreto que el cliente
-- usa para acceder a la pagina /seguir/<codigo>?t=<token>. Sin token valido la
-- edge function get-tracking-publico responde 404.
--
-- Antes: se exponia direccion_entrega + lat/lng del cliente porque el codigo
-- PD-XXXXX es bruteforce-able (solo 6 chars hex). Con token UUID v4
-- (122 bits) esa fuga queda sellada.
--
-- Garantia adicional: column tipo uuid con DEFAULT gen_random_uuid() y NOT
-- NULL. Index unico (codigo, tracking_token) acelera la verificacion en la
-- edge function.

-- 1) Anadir columna sin NOT NULL al inicio para no romper inserts antiguos
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS tracking_token uuid;

-- 2) Backfill de filas existentes
UPDATE pedidos
SET tracking_token = gen_random_uuid()
WHERE tracking_token IS NULL;

-- 3) Default + NOT NULL para futuros inserts
ALTER TABLE pedidos
  ALTER COLUMN tracking_token SET DEFAULT gen_random_uuid();

ALTER TABLE pedidos
  ALTER COLUMN tracking_token SET NOT NULL;

-- 4) Index unico en (codigo, tracking_token) para verificacion rapida
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_codigo_tracking_token
  ON pedidos (codigo, tracking_token);

-- 5) Trigger BEFORE INSERT: garantiza tracking_token aunque el insert lo
--    omita explicitamente (no confiar solo en DEFAULT, hay paths antiguos
--    que pasan { tracking_token: null }).
CREATE OR REPLACE FUNCTION ensure_pedido_tracking_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tracking_token IS NULL THEN
    NEW.tracking_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_ensure_tracking_token ON pedidos;
CREATE TRIGGER trg_pedidos_ensure_tracking_token
  BEFORE INSERT ON pedidos
  FOR EACH ROW
  EXECUTE FUNCTION ensure_pedido_tracking_token();

COMMENT ON COLUMN pedidos.tracking_token IS
  'Token secreto (UUID v4) para acceso publico a /seguir/<codigo>. La edge function get-tracking-publico verifica que (codigo, token) coincide antes de devolver datos. NUNCA exponer al cliente excepto a su propio dueño.';

-- 6) GRANTs por columna: el hardening de RLS revoca SELECT * y luego concede
--    columnas individualmente. tracking_token debe leerla solo el dueño/socio
--    /restaurante/superadmin (RLS lo limita por fila), NO anon (que no tiene
--    policy de SELECT en pedidos).
GRANT SELECT (tracking_token) ON public.pedidos TO authenticated;
-- A `anon` deliberadamente NO se le concede; aunque RLS no devolveria filas,
-- mantenemos defense-in-depth.
