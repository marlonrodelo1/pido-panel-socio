# Auditoría a fondo — App del Socio (Pidoo)

Fecha: 2026-07-01 · Rama: `claude/partner-app-audit-blkg6f`

Auditoría exhaustiva de la app del socio (React 19 + Vite + Capacitor + Supabase)
cubriendo: geolocalización y ubicación en segundo plano, toggle en línea/fuera de
línea, asignación de pedidos (marketplace propio y por distancia), conexión con el
restaurante, comisiones/envío/liquidaciones, notificaciones push, configuración
nativa Android/iOS y rendimiento de carga.

Este documento tiene dos partes:

1. **Correcciones aplicadas** en esta rama (código cliente `src/`, que es lo que se
   compila y empaqueta en la app). Verificadas con build de producción.
2. **Pendientes de backend** (edge functions / RLS / esquema). **No** se tocaron de
   forma automática porque varias están **desincronizadas con producción** y mueven
   dinero: editarlas y desplegarlas revertiría producción a código viejo. Cada una
   lleva el parche recomendado para aplicarlo tú de forma deliberada.

---

## 1. CORRECCIONES APLICADAS (código cliente)

### 1.1 Geolocalización y tracking en segundo plano

| # | Problema | Archivo | Solución aplicada |
|---|----------|---------|-------------------|
| G1 | **Carrera start/stop del watcher**: pulsar "En línea" e "Offline" muy rápido dejaba el GPS + notificación "Pidoo en servicio" corriendo con el socio offline en DB (watcher huérfano). | `src/lib/riderGeo.js` | Token de generación (`startToken`): cualquier `addWatcher` que resuelva tras un `stopTracking()` se retira de inmediato. Añadida señal `pollingActive` explícita. |
| G2 | **Logout/sesión muerta no paraban el tracking**: al cerrar sesión el foreground service y los POST de ubicación seguían vivos (estado de módulo). | `src/context/SocioContext.jsx` (logout), `src/context/RiderContext.jsx` (cleanup + sessionDead) | `stopTracking()` + `riderOffline()` en logout; `useEffect(() => () => stopTracking(), [])` al desmontar el provider; `stopTracking()` en la rama de sesión muerta. |
| G3 | **GPS apagado/permiso revocado = watcher "muerto" tratado como vivo**: el socio quedaba "en línea" pero ciego, sin avisar; además abría Ajustes solo. | `src/lib/riderGeo.js`, `src/context/RiderContext.jsx` | Callback `onError` del watcher → enciende el banner `needsLocation`; ya **no** se abre Ajustes automáticamente. |
| G4 | **Auto-offline del cron apagaba la UI pero no el tracking** (offline en DB + GPS activo). | `src/context/RiderContext.jsx` | La rama de cambio externo a offline ahora llama `stopTracking()` + limpia `lastPosRef`. |
| G5 | **Doble toggle sin mutex** (dos toggles en pantallas distintas cruzaban estados). | `src/context/RiderContext.jsx` | Mutex `togglingRef`: un segundo `setOnline` en vuelo se ignora. |
| G6 | **Updates de ubicación sin timestamp** (escrituras fuera de orden, frescura falsa). | `src/lib/riderGeo.js` | Se incluye `timestamp: location.time` en el payload. *(Requiere que la edge lo use — ver §2.)* |
| G7 | **Sin throttling temporal**: en moto se posteaba cada 2-3s (spam a la edge/DB). | `src/lib/riderGeo.js` | Throttle de 10s entre POSTs (siempre gana el último fix); `distanceFilter` intacto. |
| G8 | **`lastPosRef` nunca se limpiaba**: el primer latido de un turno mandaba la posición del turno anterior. | `src/context/RiderContext.jsx` | `lastPosRef.current = null` al ir offline / parar tracking. |
| G9 | Optimista antes del consentimiento/permiso (mostraba "En línea" con el modal de disclosure abierto). | `src/context/RiderContext.jsx` | `setIsOnline(true)` se aplica tras resolver consentimiento + permiso. |
| G10 | Timeout de GPS frío de 6s (demasiado corto → `en_servicio` sin coordenadas). | `src/lib/riderGeo.js` | Subido a 12s. |

### 1.2 Recepción de pedidos (realtime + modal)

| # | Problema | Archivo | Solución aplicada |
|---|----------|---------|-------------------|
| R1 | **El canal realtime no se recuperaba** tras caerse el websocket (WebView congelado en background) → el socio dejaba de recibir pedidos en silencio. | `src/context/RiderContext.jsx` | `subscribe((status) => …)` con refresh al reconectar + nuevo efecto que, al volver del segundo plano (`appStateChange` nativo / `visibilitychange` web), reconecta el socket y refresca asignaciones. |
| R2 | **Sesión muerta = deja de recibir pedidos sin aviso** (el latido fallaba en silencio, el cron lo apagaba). | `src/context/RiderContext.jsx` | El latido verifica la sesión (getSession/refreshSession); si está muerta, apaga, para el tracking y fuerza re-login con aviso. |
| R3 | **Dos pedidos a la vez**: el segundo pisaba el primero y reiniciaba su countdown. | `src/context/RiderContext.jsx` | El handler INSERT usa `prev => prev || nuevo` (no pisa la pendiente ya mostrada). |
| R4 | **Modal zombi**: tras timeout/rechazo fallido, reaparecía en bucle. | `src/context/RiderContext.jsx` | Set de ids descartados (`dismissedIdsRef`): no se re-muestran hasta que el backend los resuelva. |
| R5 | **El modal no se cerraba si el pedido se reasignaba/expiraba** en backend. | `src/context/RiderContext.jsx` | El handler UPDATE cierra el modal cuando la asignación deja de estar `esperando_aceptacion`. |
| R6 | **El timeout del countdown no cerraba la asignación en backend** (dependía 100% de un cron). | `src/components/ModalPedidoEntrante.jsx` | Al llegar a 0 se llama `riderRejectOrder(id, 'timeout')` para que se reasigne ya. Efecto sacado del updater de `setState` (evita el warning de StrictMode). Vibración repetida mientras el modal está abierto. |

### 1.3 Notificaciones push

| # | Problema | Archivo | Solución aplicada |
|---|----------|---------|-------------------|
| P1 | **Listeners `registration` nunca se removían**: tras logout→login (mismo dispositivo, otro usuario), un refresh de token asociaba el dispositivo al usuario anterior → push al equivocado. | `src/lib/pushNative.js` | `removeAllListeners()` al inicio del registro y en el `unregister`. |
| P2 | **El registro push no se reintentaba** si fallaba el primer intento (timeout de 5s/red lenta) → sin push toda la sesión. | `src/context/SocioContext.jsx` | El flag "registrado" solo se fija si el registro tuvo éxito (o el permiso fue denegado, caso terminal). |

### 1.4 Sesión / arranque / robustez

| # | Problema | Archivo | Solución aplicada |
|---|----------|---------|-------------------|
| S1 | **Fallo transitorio al cargar el socio mandaba a Onboarding** a un socio veterano (riesgo de sobrescribir datos). | `src/context/SocioContext.jsx` | Ante error de red/5xx **no** se borra el socio (solo se pone `null` cuando de verdad no existe la fila). |
| S2 | **`SIGNED_IN`/`TOKEN_REFRESHED` al recuperar el foco desmontaban toda la app** ("Cargando…") y refetcheaban todo → *"a veces tarda en cargar"*. | `src/context/SocioContext.jsx` | Solo se pone `loading=true` cuando cambia el **usuario**; no se refetchea el socio en `TOKEN_REFRESHED`. |

### 1.5 Rendimiento (el *"a veces tarda en cargar"*)

| # | Problema | Archivo | Solución aplicada |
|---|----------|---------|-------------------|
| C1 | **Cero code-splitting**: todo el bundle (admin + rider + tracking público) se descargaba y parseaba en el arranque. | `src/App.jsx` | `React.lazy` + `Suspense` por página. **Bundle principal: 404 kB → 192 kB (118 → 61 kB gzip).** Cada pantalla carga su chunk bajo demanda. |
| C2 | **Contexto sin `useMemo`**: cada INSERT realtime/toast/refresh re-renderizaba toda la app. | `src/context/SocioContext.jsx` | `useMemo` del value + `useCallback` en `updateSocio`/`logout`. |
| C3 | **Dashboard/Pedidos con dep `[socio]`** (objeto): refetch masivo en cada refresh de token. | `src/pages/Dashboard.jsx`, `src/pages/Pedidos.jsx` | Dependencia `[socio?.id]`; Dashboard fusiona 2 `Promise.all` en 1 (ahorra 1 RTT); guardas de cancelación. |
| C4 | **Pedidos: query de asignaciones sin límite ni fecha** → lista gigante de UUIDs en la URL del `.or(...)`. | `src/pages/Pedidos.jsx` | Acotada por rango de fecha + `limit(500)`; error ya no se traga como "sin pedidos". |
| C5 | **Fuente Google bloqueante** con rango variable completo + itálicas vía `@import` en CSS. | `index.html`, `src/index.css` | Movida a `<link>` con `preconnect` y solo los pesos usados (400/600/700/800). |
| C6 | **Dependencia `firebase` (~12 MB) instalada y jamás importada.** | `package.json` | Eliminada (73 paquetes menos en `npm install`). |
| C7 | **SeguirPedido: polling de 15s que no paraba** al entregarse/cancelarse el pedido. | `src/pages/SeguirPedido.jsx` | Se detiene el intervalo en estado final. |
| C8 | **Login Google nativo: spinner infinito** si el usuario cerraba el navegador. | `src/pages/Login.jsx` | `setLoading(false)` tras abrir el navegador (el login real vuelve por deep link). |

---

## 2. PENDIENTES DE BACKEND (revisar y desplegar tú)

> **Por qué no se aplicaron aquí:** el repo está **desincronizado con producción**
> (p. ej. `enviar_push` es v25 en repo pero v28 en producción; `create-shipday-order`
> difiere; `dispatch-order` y `rider-accept-order` **no están en el repo**). Desplegar
> el repo tal cual revertiría producción. Además tocan dinero y no se pueden probar
> aquí contra la BD/Stripe reales. **Antes de aplicar cualquiera de estos, haz
> `supabase functions download` / `supabase db pull` para sincronizar el repo con lo
> desplegado.**

### CRÍTICOS (dinero / seguridad)

- **RLS de `pedidos` permite al cliente editar cualquier columna** (`total`, `estado`,
  `socio_id`…). Un cliente podría poner `total = 0.01` antes de pagar, o marcar
  `estado='entregado'`. Archivo: `supabase/migrations/202604271200_security_hardening_rls.sql:96`.
  **Fix:** `REVOKE UPDATE ON pedidos FROM authenticated;` y `GRANT UPDATE (stripe_payment_id)`
  al cliente; recalcular `total` en servidor antes del PaymentIntent. *(Requiere el
  esquema real de `pedidos` para no romper la aceptación de pedidos del restaurante —
  por eso no se escribió la migración a ciegas.)*

- **`liquidacion-semanal`**: resetea el balance del restaurante a 0 **aunque la
  transferencia Stripe falle** (dinero que desaparece del contador sin transferirse);
  read-modify-write no atómico (pedidos entregados durante la ejecución se pierden);
  sin idempotencia (doble ejecución = doble transferencia + factura duplicada).
  Archivo: `supabase/functions/liquidacion-semanal/index.ts:97-142`.
  **Fix:** resetear el balance **solo** si `transferStatus === 'created'`; decrementar
  atómicamente vía RPC SQL; `idempotencyKey: liq-<estId>-<periodo>` en la transfer +
  unique constraint `(establecimiento_id, periodo_inicio)`.

- **`auto-cancelar-pedidos-no-aceptados`**: reembolsa **antes** de marcar el pedido; si
  el update falla, en la siguiente pasada del cron **vuelve a reembolsar** (doble
  reembolso). Además `UPDATE ... WHERE id = ?` sin re-verificar estado → puede cancelar
  un pedido que el restaurante acaba de aceptar. Archivo: `.../auto-cancelar-pedidos-no-aceptados/index.ts:73-90`.
  **Fix:** primero UPDATE condicional (`WHERE estado='nuevo' AND aceptado_at IS NULL`)
  como "claim", comprobar filas afectadas, **después** reembolsar con
  `Idempotency-Key: refund-<pedido_id>`.

- **`assign-pedido-restaurante` rompe la regla del marketplace propio**: no lee
  `origen_pedido` y **sobrescribe `pedidos.socio_id`** → un pedido del marketplace del
  socio A puede reasignarse al socio B. Sin update condicional → puede quitarle un
  pedido a un rider ya en ruta; doble clic crea dos asignaciones abiertas.
  Archivo: `.../assign-pedido-restaurante/index.ts:34-97`.
  **Fix:** si `origen_pedido='marketplace_socio'`, exigir `socio_id === pedido.socio_id`
  y no sobrescribir la atribución; hacer el flujo en una función SQL transaccional con
  update condicional; índice único parcial `pedido_asignaciones(pedido_id) WHERE estado='esperando_aceptacion'`.

- **Edge functions sin autorización**: `reassign-pedido-v2`, `check-socio-availability-now`
  (¡puede poner offline a cualquier socio → DoS de negocio!) y `create-shipday-order`
  (crea órdenes con la API key del socio y reasigna `socio_id`) no validan JWT/rol/cron-secret.
  **Fix:** exigir `x-cron-secret`/service-role o JWT del dueño; retirar las que sean
  legacy de Shipday (como ya se hizo con `refresh-restaurant-drivers` → 410).

- **`enviar_push` autoriza con la anon key pública** (embebida en cada APK/IPA y
  publicada en docs) → cualquiera puede enviar push masivo a toda la base.
  Archivo: `.../enviar_push/index.ts:125-133`. **Fix:** exigir exclusivamente la
  service-role key (o `X-Push-Secret`); quitar la rama `token === anonKey`.
  *(Ojo: repo v25 ≠ prod v28 — sincronizar primero.)*

- **Auto-claim de token push iOS sin device_id**: la fila huérfana no se liga al
  dispositivo, así que otro socio (o un atacante que inserte su token con la anon key)
  puede "reclamar" el token → push al teléfono equivocado.
  Archivos: `ios/App/App/AppDelegate.swift:55-77`, `src/lib/pushNative.js:76-84`.
  **Fix:** guardar `identifierForVendor` en la fila huérfana y que la RPC solo reclame
  filas de ese dispositivo; idealmente pasar el token FCM al JS y guardarlo ya autenticado.

### ALTOS

- **Pedido de marketplace pagado con dueño offline queda huérfano** (pagado, cocinado,
  sin repartidor, sin reembolso) tras `no_rider`. Añadir cron de reintento/auto-cancelación+reembolso.
- **Pedidos reembolsados siguen generando comisión/envío** (los agregadores filtran
  solo `estado='entregado'` sin excluir `stripe_refund_id`). Ver `generar-balances-socio`,
  `liquidacion-semanal`, `RestauranteDetalle.jsx:186`.
- **`generar-balances-socio` re-ejecutado machaca balances ya pagados** (fuerza
  `estado='pendiente'`) → doble pago. Anclar la ventana al lunes anterior y no tocar
  filas `estado != 'pendiente'`.
- **`shipday-webhook` sin token acepta cualquier request** y puede marcar
  entregado/cancelado; comparación no constant-time; sin validar transición de estado.
- **Desvincular hace `DELETE` físico** del vínculo → comisión pactada perdida y pedidos
  en curso huérfanos. Usar soft-delete conservando el snapshot de tarifa.
- **Asignación por distancia sin filtro de frescura** (`last_location_at`) ni radio
  máximo; "rider más cercano" es ficticio en socios multi-rider (todos comparten la
  misma coord). Ver `assign-pedido-restaurante/index.ts:54-74`.
- **Ventanas de tiempo incoherentes**: cron de timeout 45s vs countdown del modal 180s
  vs push "3 min". Unificar en una constante compartida.
- **El flujo de propuestas de comisión no está en el repo** (`solicitar-vinculacion-socio`,
  `responder-tarifa-pendiente`, `proponer-tarifa-socio`, `generar-factura-socio-restaurante`
  faltan). La única validación de rango (0-100%) es client-side, saltable. Traerlas al
  repo y validar servidor-side.

### MEDIOS / configuración nativa

- **iOS: `Info.plist` y `project.pbxproj` no están versionados** → no se puede
  garantizar que el binario lleva `NSLocationWhenInUseUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: [location, remote-notification]`
  ni la capability de Push. Un `npx cap add ios` produciría un plist por defecto que
  **crashea al pulsar "En línea"** (allowsBackgroundLocationUpdates sin background mode).
  Versionarlos (como ya se hizo con `App.entitlements`).
- **`ACCESS_BACKGROUND_LOCATION` declarado en el manifest pero nunca pedido en runtime**
  (el comentario de `riderGeo.js:62` afirma lo contrario). Decidir: pedirlo en flujo de
  dos pasos, o quitarlo del manifest y documentar estrategia FGS-only.
- **Mismatch de proyecto Firebase**: la app registra tokens en `pidoo-socio` pero
  `enviar_push` envía por `pidoo-push` (default) → `SENDER_ID_MISMATCH`. Unificar bajo
  un único proyecto Firebase.
- **Web Push (VAPID) nunca recibe nada**: `enviar_push` filtra solo `endpoint LIKE 'fcm:%'`.
  Añadir rama VAPID o retirar el flujo web para no engañar al usuario.
- **Aritmética de dinero en floats** en todo el pipeline de liquidaciones → descuadres
  de ±0,01-0,02 €. Trabajar en céntimos enteros.
- **Inyección de HTML en el email de invitación** (`socio-crear-restaurante`): escapar
  `socioNombre`/`restauranteNombre`.
- **Índices**: solo hay 1 `CREATE INDEX` en las migraciones. Auditar con `get_advisors`
  y crear los de los filtros calientes: `pedidos(socio_id, created_at)`,
  `pedido_asignaciones(socio_id, estado)`, `socio_establecimiento(socio_id)`, `socios(user_id)`, `socios(slug)`.

### Higiene ya aplicada

- **API key de Google Maps** retirada de `IOS_TESTFLIGHT_DEBUG.md`. **Debe rotarse** en
  Google Cloud (quedó en el historial de git) y restringirse por bundle id/dominio.

---

## 3. Verificación

- `npm run build` ✅ (bundle principal 192 kB / 61 kB gzip, páginas en chunks separados).
- `npm run lint` ❌ no ejecutable: **falta `eslint.config.js`** (ESLint 9 dejó de usar
  `.eslintrc`). Recomendado añadir uno para poder pasar lint en CI.
