import { createClient, processLock } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

function esAppNativa() {
  try { return Capacitor.isNativePlatform() } catch (_) { return false }
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Indicador global de configuracion. main.jsx lo lee para mostrar
// pantalla de error en vez de quedarse en blanco si falto el .env
// al hacer `npm run build` (caso típico: build en Mac sin copiar .env).
export const SUPABASE_CONFIG_OK = !!(url && key)

if (!SUPABASE_CONFIG_OK) {
  // Log muy visible en consola Safari Web Inspector / Logcat
  // eslint-disable-next-line no-console
  console.error(
    '[Pidoo] Build mal configurado: faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
    'La app no podra contactar con Supabase. Revisa .env antes de `npm run build`.'
  )
}

// Si faltan variables creamos un cliente "stub" con strings vacios para que
// los imports no crasheen al cargar (el bundle entero entra en modulos JS al
// boot — un throw aqui = pantalla blanca total). main.jsx ya intercepta y
// muestra pantalla de error legible cuando SUPABASE_CONFIG_OK=false.
function createSafeClient() {
  if (SUPABASE_CONFIG_OK) {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // v307 (5-oct-2026): candado de sesión DENTRO del proceso en vez del del navegador
        // (navigator.locks). La app es una sola pestaña (WebView); con el candado del
        // navegador, cuando una petición lo retenía más de 5 s (renovar el token con el
        // WebView frenado en segundo plano) la siguiente lo "robaba" y saltaba
        // "Lock broken by another request with the 'steal' option": 883 envíos de ubicación
        // perdidos en 3 días (riderApi.rider-update-location en push_debug_logs).
        // En la web (socio.pidoo.es, varias pestañas) se deja el del navegador.
        ...(esAppNativa() ? { lock: processLock } : {}),
      },
    })
  }
  try {
    return createClient(
      'https://placeholder.invalid',
      'placeholder-anon-key-not-real-do-not-use-fake-but-long-enough-to-not-trip-validators',
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    )
  } catch (e) {
    // Como ultimo recurso, devolvemos un proxy que tira errores explicativos
    // en vez de undefined.
    const reason = 'Supabase client no inicializado: faltan variables VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY'
    const handler = {
      get() { throw new Error(reason) },
      apply() { throw new Error(reason) },
    }
    return new Proxy(function () {}, handler)
  }
}

export const supabase = createSafeClient()

export const FUNCTIONS_URL = `${url || ''}/functions/v1`
