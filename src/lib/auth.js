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
