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
// iOS nativo: usa @capacitor-community/apple-sign-in con SDK nativo Apple
// (mejor UX, no abre browser). Genera nonce, lo hashea SHA-256, pasa el hash
// como `nonce` al plugin, y devuelve identityToken que se manda a Supabase
// con el nonce RAW (Supabase verifica el SHA-256 del nonce en el JWT Apple).
//
// Web / Android: signInWithOAuth provider='apple' con Services ID
// `com.pido.socio.signin` (configurado en Supabase).
export async function loginApple() {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') {
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in')
    // Generar nonce raw aleatorio (32 bytes)
    const rawNonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    // SHA-256 del nonce → es lo que pasamos al plugin (Apple verifica que el
    // sha256 del nonce raw enviado a Supabase coincida con el del JWT).
    const enc = new TextEncoder().encode(rawNonce)
    const hashBuf = await crypto.subtle.digest('SHA-256', enc)
    const hashedNonce = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    const result = await SignInWithApple.authorize({
      clientId: 'com.pido.socio',
      redirectURI: 'https://rmrbxrabngdmpgpfmjbo.supabase.co/auth/v1/callback',
      scopes: 'email name',
      state: '12345',
      nonce: hashedNonce,
    })
    const idToken = result?.response?.identityToken
    if (!idToken) throw new Error('No se obtuvo el token de Apple.')
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce: rawNonce,
    })
    if (error) throw error
    return data
  }

  // Web (y Android si llegase) → OAuth via browser
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
