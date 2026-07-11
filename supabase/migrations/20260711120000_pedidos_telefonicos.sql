-- Feature "Pedido telefónico": el restaurante crea envíos manuales desde su panel.
-- Aplicada en prod el 11 jul 2026 (migración MCP `pedidos_telefonicos`).
-- 1) origen_pedido admite 'telefonico'
ALTER TABLE public.pedidos DROP CONSTRAINT pedidos_origen_pedido_check;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_origen_pedido_check
  CHECK (origen_pedido = ANY (ARRAY['pido'::text, 'tienda_publica'::text, 'marketplace_socio'::text, 'telefonico'::text]));

-- 2) Memoria de clientes telefónicos, particionada por restaurante (RGPD: cada negocio ve solo los suyos)
CREATE TABLE public.clientes_telefonicos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establecimiento_id   uuid NOT NULL REFERENCES public.establecimientos(id) ON DELETE CASCADE,
  telefono_normalizado text NOT NULL,
  telefono_raw         text,
  nombre               text,
  direccion            text,
  lat                  double precision,
  lng                  double precision,
  notas                text,
  pedidos_count        integer NOT NULL DEFAULT 0,
  last_pedido_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clientes_telefonicos_unq UNIQUE (establecimiento_id, telefono_normalizado)
);
CREATE INDEX clientes_telefonicos_est_last_idx
  ON public.clientes_telefonicos (establecimiento_id, last_pedido_at DESC);

ALTER TABLE public.clientes_telefonicos ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_select ON public.clientes_telefonicos FOR SELECT
  USING (public._user_owns_establecimiento(establecimiento_id) OR public.is_superadmin());
CREATE POLICY ct_insert ON public.clientes_telefonicos FOR INSERT
  WITH CHECK (public._user_owns_establecimiento(establecimiento_id) OR public.is_superadmin());
CREATE POLICY ct_update ON public.clientes_telefonicos FOR UPDATE
  USING (public._user_owns_establecimiento(establecimiento_id) OR public.is_superadmin())
  WITH CHECK (public._user_owns_establecimiento(establecimiento_id) OR public.is_superadmin());

REVOKE ALL ON public.clientes_telefonicos FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.clientes_telefonicos TO authenticated;

-- 3) Comisión fija de Pidoo por pedido telefónico (editable desde super-admin Configuración)
INSERT INTO public.configuracion_plataforma (clave, valor)
VALUES ('comision_pedido_telefonico_eur', '1')
ON CONFLICT (clave) DO NOTHING;
