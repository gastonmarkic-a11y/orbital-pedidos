import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Banner al entrar a la app: avisa si hay derivaciones/conversaciones pendientes de atender.
// Solo para quienes gestionan atención (admin/administración). Se puede ocultar por sesión.
export default function BannerPendientes() {
  const { rolEfectivo } = useAuth()
  const gestiona = rolEfectivo === 'admin' || rolEfectivo === 'administracion'
  const [pend, setPend] = useState(0)
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    if (!gestiona) return
    let vivo = true
    async function cargar() {
      const { count } = await supabase.from('derivaciones').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
      if (vivo) setPend(count ?? 0)
    }
    cargar()
    const t = setInterval(cargar, 60000)
    // realtime: si entra una derivación nueva, actualizar el contador
    const ch = supabase.channel('banner-pend').on('postgres_changes', { event: '*', schema: 'public', table: 'derivaciones' }, cargar).subscribe()
    return () => { vivo = false; clearInterval(t); supabase.removeChannel(ch) }
  }, [gestiona])

  if (!gestiona || oculto || pend === 0) return null
  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">🔔 Tenés {pend} conversación{pend !== 1 ? 'es' : ''} pendiente{pend !== 1 ? 's' : ''} de atender.</span>
      <span className="flex items-center gap-3 shrink-0">
        <Link to="/conversaciones" className="underline font-semibold" onClick={() => setOculto(true)}>Ver ahora</Link>
        <button onClick={() => setOculto(true)} className="text-white/80 hover:text-white" aria-label="Ocultar">✕</button>
      </span>
    </div>
  )
}
