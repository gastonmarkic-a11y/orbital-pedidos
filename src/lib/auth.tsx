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
  /** Cuentas que comparten el mismo login (mismo mail, distintos roles) */
  cuentas: Vendedor[]
  /** Cambiar la cuenta activa entre las que comparten el login */
  setCuenta: (codigo: string) => void
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [vendedor, setVendedor] = useState<Vendedor | null>(null)
  const [cuentas, setCuentas] = useState<Vendedor[]>([])
  const [loading, setLoading] = useState(true)
  const [viewAs, setViewAs] = useState<string | null>(null)

  // Elige la cuenta activa entre varias que comparten el login (recuerda la última elección)
  function elegirActiva(lista: Vendedor[]): Vendedor | null {
    if (lista.length === 0) return null
    const guardada = localStorage.getItem('orbital_cuenta')
    return lista.find((v) => v.codigo === guardada) ?? lista[0]
  }

  async function loadVendedor(userId: string) {
    try {
      await supabase.rpc('link_vendedor_on_login')
    } catch {
      /* rpc opcional */
    }
    // Puede haber más de una cuenta con el mismo mail (ej: Logística + Producción)
    const { data: vs } = await supabase.from('vendedores').select('*').eq('user_id', userId).order('id')
    let lista = (vs as Vendedor[]) ?? []
    if (lista.length === 0) {
      const { data: login } = await supabase
        .from('vendedor_logins')
        .select('codigo')
        .eq('user_id', userId)
        .maybeSingle()
      if (login) {
        const { data: v2 } = await supabase.from('vendedores').select('*').eq('codigo', login.codigo).maybeSingle()
        if (v2) lista = [v2 as Vendedor]
      }
    }
    setCuentas(lista)
    setVendedor(elegirActiva(lista))
  }

  function setCuenta(codigo: string) {
    const v = cuentas.find((x) => x.codigo === codigo)
    if (!v) return
    setVendedor(v)
    setViewAs(null)
    localStorage.setItem('orbital_cuenta', codigo)
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
      // El rol 'tienda' filtra sus pedidos por vendedor='Tienda'. Al ver como tienda,
      // el admin debe adoptar ese código; si no, la lista filtraría por el código del
      // admin y mostraría sus propios pedidos en vez de los de la tienda.
      if (rolEfectivo === 'tienda') codigoEfectivo = 'Tienda'
    }
  }

  return (
    <Ctx.Provider
      value={{
        session,
        vendedor,
        loading,
        rolEfectivo,
        codigoEfectivo,
        viewAs,
        setViewAs,
        cuentas,
        setCuenta,
        signInWithEmail,
        signOut,
      }}
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
