import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Aviso al entrar: pedidos hechos por las ópticas desde el catálogo web (origen='catalogo')
// que el vendedor todavía no vio. El vendedor ve los suyos; admin/administración ven todos.
// Al tocar "Ver" se marcan como vistos y se abre la lista de pedidos.
export default function BannerPedidosWeb() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const [count, setCount] = useState(0)
  const [oculto, setOculto] = useState(false)
  const navigate = useNavigate()

  const esVendedor = rolEfectivo === 'vendedor'
  const esGestion = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

  useEffect(() => {
    if (!esVendedor && !esGestion) return
    let vivo = true
    async function cargar() {
      let q = supabase.from('pedidos').select('id', { count: 'exact', head: true })
        .eq('origen', 'catalogo').eq('visto_vendedor', false)
      if (esVendedor && codigoEfectivo) q = q.eq('vendedor', codigoEfectivo)
      const { count: c } = await q
      if (vivo) setCount(c ?? 0)
    }
    cargar()
    const t = setInterval(cargar, 60000)
    const ch = supabase.channel('banner-web').on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, cargar).subscribe()
    return () => { vivo = false; clearInterval(t); supabase.removeChannel(ch) }
  }, [esVendedor, esGestion, codigoEfectivo])

  async function verYMarcar() {
    let q = supabase.from('pedidos').update({ visto_vendedor: true }).eq('origen', 'catalogo').eq('visto_vendedor', false)
    if (esVendedor && codigoEfectivo) q = q.eq('vendedor', codigoEfectivo)
    await q
    setOculto(true)
    navigate('/pedidos')
  }

  if (oculto || count === 0) return null
  return (
    <div className="bg-[#8F6A34] text-white px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">
        🛒 Tenés {count} pedido{count !== 1 ? 's' : ''} web nuevo{count !== 1 ? 's' : ''} de ópticas desde el catálogo.
      </span>
      <span className="flex items-center gap-3 shrink-0">
        <button onClick={verYMarcar} className="underline font-semibold">Ver ahora</button>
        <button onClick={() => setOculto(true)} className="text-white/80 hover:text-white" aria-label="Ocultar">✕</button>
      </span>
    </div>
  )
}
