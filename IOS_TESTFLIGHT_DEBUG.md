# Pidoo Socio — Debug pantalla blanca en TestFlight

Fecha: 29 abril 2026

> **Update 29 abr (tarde) — Mapa gris en "Órdenes en espera"**
>
> Si la app abre OK pero el mapa sale en gris/blanco vacío, casi seguro
> falta `VITE_GOOGLE_MAPS_API_KEY` en el `.env` de la Mac. Verifica que el
> `.env` contiene esa línea (la key correcta está más abajo en este mismo
> doc, sección "Verificar `.env`") y rebuild:
>
> ```bash
> cd ~/Desktop/pido-panel-socio
> grep VITE_GOOGLE_MAPS_API_KEY .env  # debe imprimir la línea con la key real
> npm run build && npx cap sync ios
> # Luego Xcode → Product → Archive → upload TestFlight
> ```
>
> Tras este commit, si la key falta o el script Maps no carga en 12s, la app
> muestra un overlay rojo con la lista textual de restaurantes (no más gris
> silencioso).


## TL;DR — apuesta principal

La app abre en **blanco** en TestFlight con altísima probabilidad porque al
hacer `npm run build` en la **Mac** no existía `.env` (o estaba vacío). Vite
sustituye `import.meta.env.VITE_*` por `undefined` literal en build time, y
`createClient(undefined, undefined, ...)` lanza una excepción al cargar el
módulo `src/lib/supabase.js`. Como ese módulo se importa al inicio de
`main.jsx` → toda la app explota antes del primer `createRoot.render()` → no
hay ErrorBoundary que valga, queda el `<div id="root">` vacío → splash
desaparece y se queda blanco.

## Cambios en código (este commit)

Hardening anti pantalla-blanca. Todo aditivo, no rompe lo existente.

| Archivo | Cambio | Qué hace |
|---|---|---|
| `src/lib/supabase.js` | Fail-soft + flag `SUPABASE_CONFIG_OK` | Si faltan VITE_* no crashea; usa stub o Proxy con error explicativo. |
| `src/main.jsx` | Validación + `ErrorBoundary` + listeners globales | Si faltan VITE_* renderiza `ConfigErrorScreen`. Si algo crashea en runtime → `ErrorBoundary` con mensaje + botón Reintentar. Logs de `window.error` y `unhandledrejection`. |
| `src/components/ErrorBoundary.jsx` | Nuevo | Pantalla legible con mensaje de error + stack + botones. |
| `src/components/ConfigErrorScreen.jsx` | Nuevo | "Pidoo Socio: configuración incompleta — falta VITE_…". |
| `src/lib/auth.js` | Fix scheme OAuth | `com.pidoo.socios://login` → `com.pido.socio://login` (matches `Info.plist`). No causaba pantalla blanca pero rompía Google OAuth en iOS/Android. |

Resultado: aunque falte el `.env` en la Mac, el TestFlight YA NO sale en
blanco. Sale una tarjeta blanca con texto naranja avisando exactamente qué
variable falta.

## Causas auditadas (todas revisadas)

- [x] **`import.meta.env.VITE_*` sin guard** → ARREGLADO con fail-soft + ConfigErrorScreen.
- [x] **localStorage/sessionStorage early access** → No hay reads tempranos problemáticos. Supabase JS lo usa internamente solo cuando se invoca `getSession()`.
- [x] **`<base href>` o paths absolutos rotos** → `index.html` usa rutas absolutas `/assets/...` que Capacitor sirve OK desde `capacitor://localhost`. Sin issues.
- [x] **`vite.config.js` con `base` exótico** → No define `base`, default `/` correcto para Capacitor.
- [x] **`BrowserRouter` vs `HashRouter`** → No usa react-router. Routing manual con `window.location.pathname`. Sin issues.
- [x] **`capacitor.config.ts` `webDir` y `server.url`** → `webDir: 'dist'` correcto, sin `server.url` (no apunta a dev server). OK.
- [x] **CSP / NSAppTransportSecurity** → `Info.plist` no restringe ATS, default permite HTTPS a Supabase. OK.
- [x] **Service worker `sw.js`** → Solo se registra desde `webPush.js` cuando hay VAPID key. En iOS Capacitor no se ejecuta SW (WKWebView no lo soporta). No causa blanco.
- [x] **Plugins Capacitor crasheando al boot** → `setupStatusBar()` ya tiene try/catch silencioso. SplashScreen se autohide. PushNotifications solo se inicializa post-login. OK.
- [x] **Mismatch `appId` vs URL scheme OAuth** → ARREGLADO (fix scheme `auth.js`).

## Hipótesis secundarias (si la pantalla sigue blanca tras el fix)

1. **`google-services.json` / `GoogleService-Info.plist` ausente o mal**
   en `ios/App/App/`. Existe en disco — verificar que está añadido al **target** en Xcode (Build Phases → Copy Bundle Resources).
2. **WKWebView sin acceso a `capacitor://localhost`** por una entitlement nueva. Probar en simulador iOS antes que TestFlight.
3. **Versión de iOS muy antigua** (< 14). Pidoo requiere WKWebView moderno.
4. **Cache CFNetwork**: desinstalar y reinstalar la app desde TestFlight.

## Guía paso a paso para Marlon en la Mac

### 1. Verificar `.env`

```bash
cd ~/Desktop/pido-panel-socio
ls -la .env
cat .env
```

Debe contener (copiado del Windows):

```
VITE_SUPABASE_URL=https://rmrbxrabngdmpgpfmjbo.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtcmJ4cmFibmdkbXBncGZtamJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMzAyNTksImV4cCI6MjA4OTYwNjI1OX0.Aj2VoA6XWcokJDJdhBwfNXnLCUEOlQfTdB0std1SNWE
VITE_APP_NAME=socios
VITE_GOOGLE_MAPS_API_KEY=AIzaSyBS19f7Y7iNSPYP3mdfdETEymVX2jCJkc0
```

Si **no existe** o está vacío: créalo con el contenido de arriba.

### 2. Build limpio

```bash
cd ~/Desktop/pido-panel-socio
rm -rf dist node_modules/.vite
git pull --rebase
npm install
npm run build
```

### 3. Verificar que las VITE_ están embebidas

```bash
grep -o "rmrbxrabngdmpgpfmjbo" dist/assets/*.js | head
# Debe imprimir al menos 1 línea. Si imprime 0 → el .env NO se aplicó.

grep -c "Build mal configurado" dist/assets/*.js
# Debe imprimir al menos 1 (es el log de fail-soft de supabase.js).
```

### 4. Sync a iOS

```bash
npx cap sync ios
```

### 5. Probar PRIMERO en simulador iOS (antes de TestFlight)

```bash
npx cap open ios
```

En Xcode:
1. Selecciona simulador "iPhone 15".
2. Pulsa Run (▶).
3. Si la app abre **bien en simulador** y blanco en TestFlight → es problema
   de `Info.plist` / entitlements / código firmado / push capability.
4. Si abre **blanco en simulador también** → es problema de bundle/build.
   Sigue al paso 6.

### 6. Ver consola JS en vivo (Safari Web Inspector)

**Funciona en simulador y en iPhone físico conectado por cable.**

1. Mac → Safari → Preferencias → Avanzado → activar "Mostrar menú Desarrollar".
2. Conecta iPhone por cable (o usa simulador).
3. Abre Pidoo Socio en el dispositivo.
4. En Mac Safari → menú **Desarrollar → [Tu iPhone] → Pidoo Socio**.
5. Aparece DevTools. Abre la pestaña **Consola**.
6. Busca logs que empiezan por `[Pidoo`:
   - `[Pidoo] Build mal configurado: ...` → confirma que faltan VITE_* en el bundle.
   - `[Pidoo window.error] ...` → un error JS no capturado.
   - `[Pidoo unhandledrejection] ...` → una promesa rechazada sin catch.
   - `[Pidoo ErrorBoundary] ...` → un error en render React.

### 7. Si Web Inspector dice "no hay nada"

La app probablemente murió antes de tener tiempo de loguear. Mira en el panel
**Recursos** de Web Inspector si `assets/index-XXXX.js` carga (status 200) o
falla (404). Si falla 404 → el `dist/` no se sincronizó con `npx cap sync ios`.

### 8. TestFlight

Cuando el simulador funcione, repite Archive + Upload + esperar build en App
Store Connect.

**IMPORTANTE**: si subes una build con el mismo `CFBundleVersion`, TestFlight
la rechaza. Bumpea el build number en Xcode (Targets → App → General →
Build).

## Cómo verificar a posteriori que el fix fue suficiente

Cuando la app abra correctamente en TestFlight:

1. Logout / login.
2. Open/close varias veces.
3. Desinstalar y reinstalar.

Si en algún momento aparece la **pantalla blanca clásica** otra vez, ya no
debería pasar — saldrá la pantalla naranja del `ErrorBoundary` o la pantalla
naranja de "Configuración incompleta", con texto que explica qué pasa.

## Checklist final pre-Archive

- [ ] `.env` existe en la Mac y contiene las 4 VITE_* correctas.
- [ ] `npm run build` ejecutado sin errores.
- [ ] `grep "rmrbxrabngdmpgpfmjbo" dist/assets/*.js` devuelve coincidencias.
- [ ] `npx cap sync ios` ejecutado tras el build.
- [ ] App abre OK en simulador iOS antes de Archive.
- [ ] `Info.plist` NO incluye `com.pidoo.socios` como URL scheme (es `com.pido.socio`).
- [ ] `GoogleService-Info.plist` está en target App (Build Phases → Copy Bundle Resources).
- [ ] Build number bumpeado.

## Cambios visibles vs internos

- **Internos (no afectan UI nominal)**: fail-soft Supabase, listeners globales, fix scheme OAuth.
- **Visibles solo en caso de error**: `ErrorBoundary` (pantalla naranja con mensaje), `ConfigErrorScreen` (pantalla naranja "config incompleta"). Si todo va bien, el usuario nunca las ve.

Tras subir nueva build de panel-socio, recordar bumpear `CFBundleVersion`
(iOS) y `versionCode` (Android) si vas a actualizar también el AAB.
