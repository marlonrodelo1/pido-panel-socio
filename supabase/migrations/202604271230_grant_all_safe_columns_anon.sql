-- ============================================================================
-- HARDENING fase 3: GRANT a anon de TODAS las columnas excepto las realmente
-- sensibles. Mantiene compatibilidad con `select('*')` desde anon, pero impide
-- leer secrets/PII fiscal/finanzas internas.
-- 2026-04-27
-- ============================================================================

-- ESTABLECIMIENTOS — anon, whitelist amplia (todo menos secrets, finanzas, fiscal)
REVOKE SELECT ON public.establecimientos FROM anon;

GRANT SELECT (
  -- públicas (catálogo)
  id, nombre, tipo, categoria_padre, categoria, descripcion, logo_url, banner_url,
  direccion, latitud, longitud, radio_cobertura_km, activo, estado, horario,
  email, telefono, rating, total_resenas, created_at, slug,
  tiene_delivery, plan_pro, plan_pro_activado_en, tarifa_envio_fija,
  comision_reparto, comision_recogida, rechazo_motivo, usa_dispatcher_propio,
  -- ownership / FKs (necesarias para joins)
  user_id, captador_socio_id, rider_unico_id
  -- EXCLUIDAS (NO grant): shipday_api_key, stripe_customer_id, stripe_connect_account_id,
  -- stripe_connect_status, stripe_connect_onboarded_at, balance_card_acumulado,
  -- deuda_cash_acumulada, cash_bloqueado_por_deuda, limite_deuda_cash,
  -- ultima_liquidacion_at, razon_social, nif, direccion_fiscal, codigo_postal,
  -- ciudad_fiscal, provincia_fiscal
) ON public.establecimientos TO anon;

-- SOCIOS — anon, solo columnas públicas
REVOKE SELECT ON public.socios FROM anon;

GRANT SELECT (
  id, user_id, nombre_comercial, slug, logo_url, banner_url, color_primario,
  descripcion, redes, ciudad, marketplace_activo, en_servicio, activo,
  rating, total_resenas, modo_entrega, radio_km, tarifa_base, radio_tarifa_base_km,
  precio_km_adicional, latitud_actual, longitud_actual, created_at, nombre,
  limite_restaurantes, telefono, email, last_location_at, usa_dispatcher_propio
  -- EXCLUIDAS: shipday_api_key, iban, nif, razon_social, direccion_fiscal,
  -- codigo_postal, stripe_subscription_multirider_id, stripe_customer_id,
  -- shipday_carrier_id, multirider_estado, multirider_proximo_pago,
  -- multirider_ultimo_check, facturacion_multirider_activa, n_riders_actual
) ON public.socios TO anon;

-- IMPORTANTE: anon ya no tiene policy de SELECT en socios (drop en migración 1200).
-- Con esto, las lecturas via REST devuelven [] (RLS niega), pero los GRANTs están listos
-- por si en futuro se añade policy. La vista socios_publicos sigue siendo el canal correcto.
