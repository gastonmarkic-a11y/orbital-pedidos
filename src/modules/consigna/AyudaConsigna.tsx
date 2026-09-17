// ── /consigna/ayuda?k=… — el instructivo en su propia ventana ────────────────
// Se abre desde el botón "Ayuda · uso y alcance" del panel, en una pestaña nueva, para poder leerlo
// al lado del panel (o mandarle el link a alguien del local).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Instructivo from './Instructivo'
import type { Central } from './CentralConsigna'

const CLAVE_KEY = 'orbital_consigna_clave'

export default function AyudaConsigna() {
  const clave = new URLSearchParams(window.location.search).get('k')
    || (() => { try { return localStorage.getItem(CLAVE_KEY) } catch { return null } })()
  const [data, setData] = useState<Central | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!clave) { setError(true); return }
    supabase.rpc('consigna_central', { p_k: clave }).then(({ data, error }) => {
      if (error) { setError(true); return }
      setData(data as Central)
    })
  }, [clave])

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-ink">
      <header className="bg-white border-b border-black/10">
        <div className="max-w-[900px] mx-auto px-4 py-4 flex items-center gap-2">
          <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
          <span className="text-[9px] font-bold tracking-[0.28em] text-gold uppercase mt-0.5">Consigna</span>
          <a href={`/consigna${clave ? `?k=${clave}` : ''}`} className="ml-auto text-xs text-muted underline">Volver al panel</a>
        </div>
      </header>
      <main className="max-w-[900px] mx-auto px-4 py-4">
        {error || !clave ? (
          <p className="bg-white border border-black/10 rounded-lg text-sm text-muted px-4 py-6">
            Abrí esta ayuda desde tu panel de consigna: el link lleva tu acceso.
          </p>
        ) : !data ? (
          <p className="text-sm text-muted px-1 py-6">Cargando…</p>
        ) : (
          <Instructivo data={data} esCentral={data.acceso.sucursal_id == null} />
        )}
      </main>
    </div>
  )
}
