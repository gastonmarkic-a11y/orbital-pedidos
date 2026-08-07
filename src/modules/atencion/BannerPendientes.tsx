import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { esMia } from './ruteo'

// Banner al entrar: avisa a CADA usuario las derivaciones pendientes DE SU TEMA
// (envíos→Mauro, comercial→Prospección, pagos→Administración, general→Gastón).
// Administración ve todas. Se actualiza en vivo y se puede ocultar por sesión.
export default function BannerPendientes() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const [mias, setMias] = useState(0)
  const [total, setTotal] = useState(0)
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { data } = await supabase.from('derivaciones').select('motivo, tipo_cliente').eq('estado', 'pendiente')
      if (!vivo) return
      const rows = (data as { motivo: string; tipo_cliente: string | null }[]) ?? []
      setTotal(rows.length)
      setMias(rows.filter((d) => esMia(d.motivo, d.tipo_cliente, codigoEfectivo ?? null, rolEfectivo ?? null)).length)
    }
    cargar()
    const t = setInterval(cargar, 60000)
    const ch = supabase.channel('banner-pend').on('postgres_changes', { event: '*', schema: 'public', table: 'derivaciones' }, cargar).subscribe()
    return () => { vivo = false; clearInterval(t); supabase.removeChannel(ch) }
  }, [codigoEfectivo, rolEfectivo])

  if (oculto || mias === 0) return null
  const otras = total - mias
  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">
        🔔 Tenés {mias} conversación{mias !== 1 ? 'es' : ''} pendiente{mias !== 1 ? 's' : ''} de tu tema.
        {rolEfectivo === 'administracion' && otras > 0 ? '' : otras > 0 ? ` (${otras} de otros temas)` : ''}
      </span>
      <span className="flex items-center gap-3 shrink-0">
        <Link to="/conversaciones" className="underline font-semibold" onClick={() => setOculto(true)}>Ver ahora</Link>
        <button onClick={() => setOculto(true)} className="text-white/80 hover:text-white" aria-label="Ocultar">✕</button>
      </span>
    </div>
  )
}
