import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { Rol, Vendedor } from './types'

interface AuthCtx {
  session: Session | null
  vendedor: Vendedor | null
  loading: boolean
  /** Rol efectivo: el real, o el que el admin eligió en "Ver como" */
  rolEfectivo: Rol
  /** Código de vendedor efectivo (si el admin está viendo como un vendedor puntual) */
  codigoEfectivo: string
  viewAs: string | null
  setViewAs: (r: string | null) => void
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [vendedor, setVendedor] = useState<Vendedor | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewAs, setViewAs] = useState<string | null>(null)

  async function loadVendedor(userId: string) {
    try {
      await supabase.rpc('link_vendedor_on_login')
    } catch {
      /* rpc opcional */
    }
    const { data: v } = await supabase.from('vendedores').select('*').eq('user_id', userId).maybeSingle()
    if (v) {
      setVendedor(v as Vendedor)
      return
    }
    const { data: login } = await supabase
      .from('vendedor_logins')
      .select('codigo')
      .eq('user_id', userId)
      .maybeSingle()
    if (login) {
      const { data: v2 } = await supabase.from('vendedores').select('*').eq('codigo', login.codigo).maybeSingle()
      setVendedor((v2 as Vendedor) ?? null)
      return
    }
    setVendedor(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadVendedor(data.session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (s) loadVendedor(s.user.id)
      else setVendedor(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function signInWithEmail(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const rolReal = (vendedor?.rol ?? 'vendedor') as Rol
  let rolEfectivo: Rol = rolReal
  let codigoEfectivo = vendedor?.codigo ?? ''
  if (rolReal === 'admin' && viewAs) {
    if (viewAs.startsWith('vendedor:')) {
      rolEfectivo = 'vendedor'
      codigoEfectivo = viewAs.split(':')[1]
    } else {
      rolEfectivo = viewAs as Rol
    }
  }

  return (
    <Ctx.Provider
      value={{ session, vendedor, loading, rolEfectivo, codigoEfectivo, viewAs, setViewAs, signInWithEmail, signOut }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
