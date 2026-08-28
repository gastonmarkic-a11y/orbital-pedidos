import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Puente: el revendedor entra al catálogo con SU login (no con un token compartido).
// Toma su ficha de cliente vinculada (vendedores.cod_cliente), genera el acceso y abre
// el catálogo a precio normal. El pedido que arme cae en la cola de su vendedor (Adrián).
export default function MiCatalogo() {
  const { vendedor } = useAuth()
  const [msg, setMsg] = useState('Abriendo tu catálogo…')

  useEffect(() => {
    const cod = (vendedor as { cod_cliente?: string | null } | null)?.cod_cliente
    if (!cod) { setMsg('Todavía no tenés una ficha de cliente asociada. Avisale a Orbital para activarla.'); return }
    supabase.rpc('catalogo_link_revendedor', { p_cod_cliente: cod }).then(({ data }) => {
      const r = data as { ok?: boolean; codigo?: string } | null
      if (r?.ok && r.codigo) window.location.href = '/catalogo?k=' + r.codigo
      else setMsg('No se pudo abrir el catálogo. Probá de nuevo o avisá a Orbital.')
    })
  }, [vendedor])

  return (
    <div className="min-h-[50vh] flex items-center justify-center px-6">
      <p className="text-sm text-muted text-center">{msg}</p>
    </div>
  )
}
