-- ============================================================================
-- SECURITY HARDENING — fix 5 RLS findings (socios, pedidos, pedido_items, establecimientos)
-- 2026-04-27
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) socios: bloquear lectura de columnas sensibles a anon + crear vista pública
-- ----------------------------------------------------------------------------

-- Drop policies que filtran fila completa (col sensibles incluidas) a anon
DROP POLICY IF EXISTS socios_public_read ON public.socios;
DROP POLICY IF EXISTS socios_public_read_slug ON public.socios;

-- Vista whitelist con SOLO columnas seguras (consumo público)
DROP VIEW IF EXISTS public.socios_publicos;
CREATE VIEW public.socios_publicos
WITH (security_invoker = true) AS
SELECT
  id,
  nombre_comercial,
  slug,
  logo_url,
  banner_url,
  color_primario,
  descripcion,
  redes,
  ciudad,
  marketplace_activo,
  en_servicio,
  activo,
  rating,
  total_resenas
FROM public.socios
WHERE COALESCE(activo, false) = true
  AND COALESCE(marketplace_activo, false) = true
  AND slug IS NOT NULL;

GRANT SELECT ON public.socios_publicos TO anon, authenticated;

-- Revocar columnas sensibles a anon en la tabla base (defense-in-depth, por si
-- alguien restaura una policy). Las edge functions con service role no se ven afectadas.
REVOKE SELECT (shipday_api_key, iban, nif, razon_social, direccion_fiscal,
               codigo_postal, stripe_subscription_multirider_id, stripe_customer_id,
               shipday_carrier_id, multirider_estado, multirider_proximo_pago,
               multirider_ultimo_check, facturacion_multirider_activa)
  ON public.socios FROM anon;

-- A authenticated también revocamos shipday_api_key/iban/nif por defecto: solo dueño y
-- superadmin lo necesitan, y ya tienen acceso vía socios_self_select / socios_superadmin_*
-- (RLS impide ver filas de otros). Sigue siendo legible vía las policies existentes.
-- NOTA: NO se revoca a authenticated; la policy socios_self_select limita la fila al dueño
-- y superadmin. Los authenticated que lean otros socios solo verán via socios_publicos.

-- ----------------------------------------------------------------------------
-- 2) pedidos: drop policies abiertas, crear policies por rol
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS pedidos_select_anon_by_codigo ON public.pedidos;
DROP POLICY IF EXISTS pedidos_select_all ON public.pedidos;
DROP POLICY IF EXISTS pedidos_update_all ON public.pedidos;
DROP POLICY IF EXISTS "Usuarios ven sus pedidos" ON public.pedidos;
-- pedidos_select_socio existe (filtra por socio_id) — lo mantenemos.

-- Cliente: ve sus pedidos
CREATE POLICY pedidos_select_cliente ON public.pedidos FOR SELECT
  TO authenticated
  USING (auth.uid() = usuario_id);

-- Restaurante: ve los pedidos de sus establecimientos
CREATE POLICY pedidos_select_restaurante ON public.pedidos FOR SELECT
  TO authenticated
  USING (
    establecimiento_id IN (
      SELECT id FROM public.establecimientos WHERE user_id = auth.uid()
    )
  );

-- Socio: ve pedidos de su marketplace O pedidos asignados a sus riders
CREATE POLICY pedidos_select_socio_amplio ON public.pedidos FOR SELECT
  TO authenticated
  USING (
    socio_id IN (SELECT id FROM public.socios WHERE user_id = auth.uid())
    OR rider_account_id IN (
      SELECT id FROM public.rider_accounts
      WHERE socio_id IN (SELECT id FROM public.socios WHERE user_id = auth.uid())
    )
  );

-- Superadmin: lee todo
CREATE POLICY pedidos_select_superadmin ON public.pedidos FOR SELECT
  TO authenticated
  USING (public.is_superadmin());

-- UPDATE: cliente solo de los suyos (necesario para guardar stripe_payment_id);
-- restaurante de su establecimiento; superadmin todo
DROP POLICY IF EXISTS pedidos_update_cliente ON public.pedidos;
CREATE POLICY pedidos_update_cliente ON public.pedidos FOR UPDATE
  TO authenticated
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

DROP POLICY IF EXISTS pedidos_update_restaurante ON public.pedidos;
CREATE POLICY pedidos_update_restaurante ON public.pedidos FOR UPDATE
  TO authenticated
  USING (
    establecimiento_id IN (
      SELECT id FROM public.establecimientos WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    establecimiento_id IN (
      SELECT id FROM public.establecimientos WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS pedidos_update_superadmin ON public.pedidos;
CREATE POLICY pedidos_update_superadmin ON public.pedidos FOR UPDATE
  TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ----------------------------------------------------------------------------
-- 3) pedido_items: drop policy "qual=true", crear ownership-based
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Items visibles con el pedido" ON public.pedido_items;
DROP POLICY IF EXISTS pedido_items_select_all ON public.pedido_items;

CREATE POLICY pedido_items_select_owner ON public.pedido_items FOR SELECT
  TO authenticated
  USING (
    pedido_id IN (
      SELECT p.id
      FROM public.pedidos p
      LEFT JOIN public.establecimientos e ON e.id = p.establecimiento_id
      LEFT JOIN public.socios s ON s.id = p.socio_id
      WHERE p.usuario_id = auth.uid()
         OR e.user_id = auth.uid()
         OR s.user_id = auth.uid()
         OR p.rider_account_id IN (
              SELECT id FROM public.rider_accounts
              WHERE socio_id IN (SELECT id FROM public.socios WHERE user_id = auth.uid())
            )
         OR public.is_superadmin()
    )
  );

-- ----------------------------------------------------------------------------
-- 4) establecimientos: drop policies abiertas, crear safe + vista pública +
--    revoke columnas sensibles a anon
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Establecimientos visibles para todos" ON public.establecimientos;
DROP POLICY IF EXISTS establecimientos_select_all ON public.establecimientos;

-- Permitir lectura pública de FILAS (sigue dependiendo de los GRANT por columna abajo).
-- Mantengo el SELECT abierto para no romper Home.jsx (cliente anon lista activos),
-- pero las columnas sensibles quedan revocadas a anon.
CREATE POLICY establecimientos_select_safe ON public.establecimientos FOR SELECT
  TO public
  USING (true);

-- Vista pública con whitelist (uso recomendado a futuro)
DROP VIEW IF EXISTS public.establecimientos_publicos;
CREATE VIEW public.establecimientos_publicos
WITH (security_invoker = true) AS
SELECT
  id,
  nombre,
  tipo,
  categoria_padre,
  categoria,
  descripcion,
  logo_url,
  banner_url,
  direccion,
  latitud,
  longitud,
  radio_cobertura_km,
  activo,
  estado,
  horario,
  email,
  telefono,
  rating,
  total_resenas,
  created_at,
  slug,
  tiene_delivery,
  plan_pro,
  plan_pro_activado_en,
  tarifa_envio_fija,
  comision_reparto,
  comision_recogida
FROM public.establecimientos;

GRANT SELECT ON public.establecimientos_publicos TO anon, authenticated;

-- Revocar a anon las columnas sensibles (PII fiscal + tokens externos + finanzas internas)
REVOKE SELECT (shipday_api_key, stripe_customer_id, stripe_connect_account_id,
               stripe_connect_status, stripe_connect_onboarded_at,
               balance_card_acumulado, deuda_cash_acumulada, cash_bloqueado_por_deuda,
               limite_deuda_cash, ultima_liquidacion_at,
               razon_social, nif, direccion_fiscal,
               codigo_postal, ciudad_fiscal, provincia_fiscal,
               rider_unico_id, captador_socio_id)
  ON public.establecimientos FROM anon;
