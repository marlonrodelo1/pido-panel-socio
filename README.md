# pido-panel-socio

Panel de socios de **Pidoo** — cada socio tiene su mini-marketplace público en `pidoo.es/s/<slug>` y usa este panel para:

- Activar / configurar su tienda (branding, redes, descripción).
- Vincular restaurantes al marketplace.
- Ver pedidos y ganancias.
- Descargar facturas semanales (placeholder: PDF próximamente).

## Stack

- React 19 + Vite 8
- Supabase JS (auth + DB + edge functions)
- Capacitor 8 (opcional para empaquetar como APK `com.pidoo.socios`)
- Light theme, Inter, primary `#FF6B2C`

## Arranque local

```bash
cp .env.example .env        # y rellena VITE_SUPABASE_URL + ANON_KEY
npm install
npm run dev                 # http://localhost:5174
```

Build de producción:

```bash
npm run build
npm run preview
```

## Variables de entorno

```
VITE_SUPABASE_URL=https://rmrbxrabngdmpgpfmjbo.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_APP_NAME=socios
```

## Deploy (Dokploy)

1. Push a la rama que Dokploy vigila (auto-deploy).
2. El Dockerfile es multi-stage (build con node, serve con nginx).
3. Configurar **Build Args** en Dokploy:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_NAME=socios`
4. Dominio sugerido: `socios.pidoo.es`.

## Estructura

```
src/
├── App.jsx                  (router por sección + SocioProvider)
├── main.jsx
├── index.css
├── lib/
│   ├── supabase.js          (cliente + FUNCTIONS_URL)
│   ├── uiStyles.js          (tokens compartidos con panel restaurante)
│   └── auth.js              (login email, Google OAuth, reset)
├── context/
│   └── SocioContext.jsx     (session + socio row + update/logout)
├── pages/
│   ├── Login.jsx            (email+password + Google + reset)
│   ├── Onboarding.jsx       (elige slug con debounce reserve-socio-slug)
│   ├── Dashboard.jsx
│   ├── MiMarketplace.jsx    (branding + toggle activar/desactivar)
│   ├── Restaurantes.jsx     (mis vinculados + buscar + solicitar)
│   ├── Pedidos.jsx
│   ├── Facturas.jsx
│   ├── Configuracion.jsx
│   └── Soporte.jsx
└── components/
    ├── HeaderNav.jsx        (nav desktop)
    ├── BottomNav.jsx        (móvil)
    ├── GoogleButton.jsx
    └── StatCard.jsx
```

## Flow de auth

1. Sin sesión → `Login`.
2. Con sesión y sin fila en `socios` → `Onboarding` (escoge slug con validación en vivo vía edge `reserve-socio-slug`).
3. Con sesión y fila `socios` → app con secciones navegables.

## Edge functions consumidas

- `POST /functions/v1/reserve-socio-slug` (Bearer) — `{slug, check_only?}` → `{disponible, slug}`
- `POST /functions/v1/solicitar-vinculacion-socio` (Bearer) — `{establecimiento_id}`
- `GET /functions/v1/get-socio-marketplace?slug=<slug>` (público) — preview

## Capacitor / Android

El proyecto declara `capacitor.config.ts` con `appId: com.pidoo.socios`. Para generar el proyecto nativo Android:

```bash
npx cap add android
npx cap sync
```

(No se incluye la carpeta `android/` por defecto — el comando la genera.)

## Pendiente / placeholders

- Descarga de PDF de facturas ("Próximamente").
- Integración real con panel de impresora (no aplica a socios).
- Estadísticas más avanzadas (gráficos por rango).
