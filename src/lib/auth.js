import { supabase } from './supabase'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

export async function loginEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
  return data
}

export async function registerEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  })
  if (error) throw error
  return data
}

// Sign in with Apple — exigido por Apple guideline 4.8 cuando la app
// ofrece login OAuth de terceros (Google).
//
// Implementacion via OAuth web flow (mismo patron que loginGoogle):
// - iOS nativo: skipBrowserRedirect + Browser.open (Safari embebido).
//   Apple acepta este flujo perfectamente para cumplir guideline 4.8.
//   Se evita la incompatibilidad del plugin nativo
//   @capacitor-community/apple-sign-in que requiere Capacitor 7.x mientras
//   el proyecto usa Capacitor 8.x.
// - Web/Android: signInWithOAuth con redirect al origen.
//
// Supabase tiene configurado provider Apple con Services ID
// `com.pido.socio.signin` y client_secret JWT generado con .p8/team
// XR7JH7A8ZY/key S7745K9TUV (expira oct 2026, regenerar antes).
export async function loginApple() {
  if (Capacitor.isNativePlatform()) {
    const { data } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: 'com.pido.socio://login',
        skipBrowserRedirect: true,
      },
    })
    if (data?.url) await Browser.open({ url: data.url })
    return
  }
  return supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
    },
  })
}

export async function loginGoogle() {
  if (Capacitor.isNativePlatform()) {
    const { data } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Debe coincidir con CFBundleURLSchemes en Info.plist (iOS) y
        // intent-filter en AndroidManifest.xml. El bundleId real es
        // com.pido.socio (sin "s" final, sin "o" en "pidoo"). Si esto no
        // coincide, Google OAuth no vuelve a la app pero NO causa pantalla
        // blanca al boot.
        redirectTo: 'com.pido.socio://login',
        skipBrowserRedirect: true,
      },
    })
    if (data?.url) await Browser.open({ url: data.url })
    return
  }
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/`,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw error
}

export async function logout() {
  await supabase.auth.signOut()
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}
