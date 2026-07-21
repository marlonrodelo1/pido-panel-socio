import { supabase } from './supabase'
import { getPlatform, getPlugin } from './capacitor'

// Login con Google (OAuth). En web redirige al propio origen y Supabase
// (detectSessionInUrl) intercambia el ?code= al volver. En nativo abre el
// navegador y vuelve por deep link com.pidoo.socio://login → el handler de
// appUrlOpen en App.jsx hace exchangeCodeForSession.
export async function loginGoogle() {
  const platform = await getPlatform() // 'web' | 'android' | 'ios'
  const isNative = platform === 'android' || platform === 'ios'
  const redirectTo = isNative ? 'com.pidoo.socio://login' : `${window.location.origin}/`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: isNative },
  })
  if (error) throw error
  if (isNative && data?.url) {
    const Browser = (await getPlugin('Browser'))?.plugin
    if (Browser) await Browser.open({ url: data.url })
    else window.open(data.url, '_system')
  }
  // En web, signInWithOAuth ya redirige solo (skipBrowserRedirect=false).
}

// Nonce anti-replay para Sign in with Apple. REGLA DE ORO (verificada):
//   - a Apple va el nonce HASHEADO (SHA-256) → request.nonce del plugin nativo.
//   - a Supabase va el nonce RAW → Supabase lo re-hashea y compara con el claim
//     'nonce' del identityToken. Invertirlo = error 400 en signInWithIdToken.
function randomNonce() {
  const a = new Uint8Array(32)
  ;(globalThis.crypto || window.crypto).getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
async function sha256Hex(msg) {
  const data = new TextEncoder().encode(msg)
  const buf = await (globalThis.crypto || window.crypto).subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Login con Apple (OIDC). Blindaje del guideline 4.8 de Apple (permite ofrecer
// Google en iOS). En iOS usa el flujo NATIVO (ASAuthorization sheet, que es lo que
// el revisor de Apple espera ver); en web/Android usa OAuth web como Google.
export async function loginApple() {
  const platform = await getPlatform() // 'web' | 'android' | 'ios'

  if (platform === 'ios') {
    // iOS nativo: hoja de Apple → identityToken → signInWithIdToken.
    const AppleSignIn = (await getPlugin('AppleSignIn'))?.plugin
    if (!AppleSignIn) throw new Error('Sign in with Apple no está disponible en este dispositivo')
    const rawNonce = randomNonce()
    const hashedNonce = await sha256Hex(rawNonce)
    const { response } = await AppleSignIn.authorize({
      clientId: 'com.pidoo.socio', // Bundle ID = audience del identityToken
      scopes: 'name email',
      nonce: hashedNonce,          // HASHEADO → Apple
    })
    if (!response?.identityToken) throw new Error('Apple no devolvió el token de identidad')
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: response.identityToken, // el JWT identityToken
      nonce: rawNonce,               // RAW → Supabase
    })
    if (error) throw error
    // Apple SOLO entrega el nombre en la PRIMERA autorización → guardarlo ahora.
    const fullName = [response.givenName, response.familyName].filter(Boolean).join(' ').trim()
    if (fullName) {
      try { await supabase.auth.updateUser({ data: { full_name: fullName } }) } catch (_) {}
    }
    return
  }

  // Web / Android: OAuth web (abre appleid.apple.com), igual patrón que Google.
  const isNative = platform === 'android'
  const redirectTo = isNative ? 'com.pidoo.socio://login' : `${window.location.origin}/`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo, skipBrowserRedirect: isNative },
  })
  if (error) throw error
  if (isNative && data?.url) {
    const Browser = (await getPlugin('Browser'))?.plugin
    if (Browser) await Browser.open({ url: data.url })
    else window.open(data.url, '_system')
  }
}

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
