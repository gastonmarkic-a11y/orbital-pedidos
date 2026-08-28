import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Puente: el revendedor entra al catálogo con SU login (no con un token compartido).
// Toma su ficha de cliente vinculada (vendedores.cod_cliente), genera el acceso y abre
// el catálogo a precio normal EN UNA PESTAÑA NUEVA (el Suite queda en la pestaña original).
// El pedido que arme cae en la cola de su vendedor (Adrián).
export default function MiCatalogo() {
  const { vendedor } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState('Preparando tu catálogo…')
  const abierto = useRef(false)

  function abrir(u: string) {
    window.open(u, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    const cod = (vendedor as { cod_cliente?: string | null } | null)?.cod_cliente
    if (!cod) { setMsg('Todavía no tenés una ficha de cliente asociada. Avisale a Orbital para activarla.'); return }
    supabase.rpc('catalogo_link_revendedor', { p_cod_cliente: cod }).then(({ data }) => {
      const r = data as { ok?: boolean; codigo?: string } | null
      if (r?.ok && r.codigo) {
        const u = 'https://ver.orbitaleyewear.com.ar/catalogo?k=' + r.codigo
        setUrl(u)
        setMsg('Tu catálogo se abre en una pestaña nueva.')
        // Intento de apertura automática (puede bloquearlo el navegador → queda el botón).
        if (!abierto.current) { abierto.current = true; abrir(u) }
      } else setMsg('No se pudo abrir el catálogo. Probá de nuevo o avisá a Orbital.')
    })
  }, [vendedor])

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted">{msg}</p>
      {url && (
        <button
          onClick={() => abrir(url)}
          className="rounded-xl bg-brand text-white text-sm font-semibold px-5 py-3"
        >
          Abrir catálogo ↗
        </button>
      )}
    </div>
  )
}
