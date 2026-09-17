// ── Links de las sucursales (solo la central del cliente) ────────────────────
// El administrador del cliente reparte un link por sucursal: cada uno es único, entra directo a esa
// sucursal (sin clave) y se puede instalar como app en la compu o el teléfono del local.
import { useEffect, useState } from 'react'
import { Copy, Check, Link2, Share2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

type Acceso = {
  sucursal_id: number; sucursal: string; direccion: string | null; localidad: string | null
  codigo: string | null; nombre: string | null
}

export default function LinksSucursales({ clave, cliente }: { clave: string; cliente: string }) {
  const toast = useToast()
  const [items, setItems] = useState<Acceso[] | null>(null)
  const [copiado, setCopiado] = useState<number | null>(null)
  const base = window.location.origin
  const link = (cod: string) => `${base}/consigna?k=${cod}`

  useEffect(() => {
    supabase.rpc('consigna_accesos', { p_k: clave }).then(({ data, error }) => {
      if (error) { toast('No se pudieron traer los links', 'error'); setItems([]); return }
      setItems(data as Acceso[])
    })
  }, [clave, toast])

  const copiar = async (a: Acceso) => {
    if (!a.codigo) return
    const texto = `Link de ${cliente} · ${a.sucursal}\n${link(a.codigo)}\n\nEs solo para esta sucursal. Se abre sin clave y se puede instalar como app en la compu o el celular del local.`
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(a.sucursal_id)
      setTimeout(() => setCopiado(null), 2000)
      toast('Link copiado', 'success')
    } catch { toast('Copialo a mano desde el cuadro', 'error') }
  }

  return (
    <section className="bg-white border border-black/10 rounded-lg">
      <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2 mr-auto"><Link2 size={16} className="text-gold" /> Links de las sucursales</h2>
        <span className="text-xs text-muted">Los reparte la central</span>
      </div>
      <div className="px-4 pt-3 text-xs text-muted leading-relaxed">
        Cada sucursal tiene <b className="text-ink">su propio link</b>, y entra directo a su tablero sin clave.
        Mandale a cada local el que le corresponde: con ese link ve su stock, marca lo que recibe, pide a Orbital
        y carga la postventa; lo que hace queda en línea para todos al instante. En el local conviene
        <b className="text-ink"> instalarlo como app</b> (botón "Instalar" arriba) para tenerlo a mano en la compu o el celular.
        No lo compartas fuera de la sucursal: quien tenga el link entra sin clave.
      </div>
      {items == null ? (
        <p className="text-sm text-muted px-4 py-6">Cargando…</p>
      ) : (
        <ul className="divide-y divide-black/5 mt-2">
          {items.map((a) => (
            <li key={a.sucursal_id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-[180px]">
                <div className="text-sm font-semibold">{a.sucursal}</div>
                <div className="text-xs text-muted">{[a.direccion, a.localidad].filter(Boolean).join(', ')}</div>
              </div>
              {a.codigo ? (
                <>
                  <input
                    readOnly
                    value={link(a.codigo)}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`Link de ${a.sucursal}`}
                    className="flex-1 min-w-[260px] text-xs border border-black/15 rounded-lg px-2.5 py-1.5 text-muted"
                  />
                  <button onClick={() => copiar(a)} className="text-xs bg-ink text-white rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5">
                    {copiado === a.sucursal_id ? <Check size={13} /> : <Copy size={13} />} Copiar
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Link de ${cliente} · ${a.sucursal}: ${link(a.codigo)} (es solo para esta sucursal; se puede instalar como app)`)}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs border border-black/15 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5"
                  >
                    <Share2 size={13} /> WhatsApp
                  </a>
                </>
              ) : (
                <span className="text-xs text-amber-700">Sin link todavía — lo genera Orbital.</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
