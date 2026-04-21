import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SocioContext = createContext(null)

export function SocioProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [socio, setSocio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  const fetchSocio = useCallback(async (uid) => {
    if (!uid) { setSocio(null); return }
    const { data, error } = await supabase
      .from('socios')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') {
      console.error('[SocioContext] error fetch socio', error)
    }
    setSocio(data || null)
  }, [])

  const refreshSocio = useCallback(async () => {
    if (user?.id) await fetchSocio(user.id)
  }, [user, fetchSocio])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(data.session)
      setUser(data.session?.user || null)
      if (data.session?.user) await fetchSocio(data.session.user.id)
      setLoading(false)
    })()

    const { data: listener } = supabase.auth.onAuthStateChange((_evt, newSession) => {
      setSession(newSession)
      setUser(newSession?.user || null)
      if (newSession?.user) fetchSocio(newSession.user.id)
      else setSocio(null)
    })

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [fetchSocio])

  const updateSocio = async (cambios) => {
    if (!socio?.id) return
    const { data, error } = await supabase
      .from('socios')
      .update(cambios)
      .eq('id', socio.id)
      .select()
      .single()
    if (error) throw error
    setSocio(data)
    return data
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setSocio(null)
  }

  return (
    <SocioContext.Provider value={{
      session, user, socio, loading,
      authError, setAuthError,
      refreshSocio, updateSocio, logout,
    }}>
      {children}
    </SocioContext.Provider>
  )
}

export function useSocio() {
  const ctx = useContext(SocioContext)
  if (!ctx) throw new Error('useSocio fuera de SocioProvider')
  return ctx
}
