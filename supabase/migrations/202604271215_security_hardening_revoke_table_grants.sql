-- ============================================================================
-- HARDENING fase 2: REVOKE table-level SELECT a anon en establecimientos y socios,
-- y volver a GRANT SELECT solo de columnas seguras (whitelist).
-- 2026-04-27
-- ============================================================================

-- ESTABLECIMIENTOS — anon
REVOKE SELECT ON public.establecimientos FROM anon;

GRANT SELECT (
  id, nombre, tipo, categoria_padre, categoria, descripcion, logo_url, banner_url,
  direccion, latitud, longitud, radio_cobertura_km, activo, estado, horario,
  email, telefono, rating, total_resenas, created_at, slug, tiene_delivery,
  plan_pro, plan_pro_activado_en, tarifa_envio_fija, comision_reparto, comision_recogida,
  user_id, usa_dispatcher_propio, rechazo_motivo
) ON public.establecimientos TO anon;

-- Notas: NO se otorga acceso a anon en: shipday_api_key, stripe_*, balance_*, deuda_*,
-- limite_deuda_cash, ultima_liquidacion_at, razon_social, nif, direccion_fiscal,
-- codigo_postal, ciudad_fiscal, provincia_fiscal, rider_unico_id, captador_socio_id,
-- cash_bloqueado_por_deuda.

-- SOCIOS — anon
-- A nivel tabla, anon ya no tiene policy SELECT (drop en migración previa). Pero por
-- defensa en profundidad, revocamos SELECT de tabla y damos solo columnas públicas.
REVOKE SELECT ON public.socios FROM anon;

GRANT SELECT (
  id, nombre_comercial, slug, logo_url, banner_url, color_primario,
  descripcion, redes, ciudad, marketplace_activo, en_servicio, activo,
  rating, total_resenas
) ON public.socios TO anon;
