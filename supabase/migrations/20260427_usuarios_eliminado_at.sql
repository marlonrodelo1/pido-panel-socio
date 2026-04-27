-- Soft delete para cumplir Google Play / App Store data deletion.
-- usuarios.eliminado_at se rellena al eliminar cuenta; la fila se mantiene
-- por integridad referencial con pedidos/balances historicos.
--
-- Idempotente: misma migracion existe en pido-panel-restaurante. Solo aplicar
-- una vez en Supabase.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS eliminado_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_usuarios_eliminado_at
  ON usuarios (eliminado_at)
  WHERE eliminado_at IS NOT NULL;

COMMENT ON COLUMN usuarios.eliminado_at IS
  'Timestamp de eliminacion blanda. Si no es NULL, la cuenta esta marcada como eliminada y no debe poder iniciar sesion. La fila se mantiene para preservar la integridad de pedidos/balances historicos.';
