// ── Fichas · la página del anteojo para publicar (la misma que abre el reconocimiento por cámara) ──
// Por anteojo: "Obtener link" crea un link del influencer (colab_crear_link, red/formato "otra/otro")
// y arma /modelo/<MODELO>?sku=&r=<codigo>. En la ficha, "Comprar" pasa por /r/<codigo>:
// da el código del influencer (o atribuye la venta si no tiene cupón, como ZN).
// El link se crea recién al tocar el botón: abrir la pestaña no gasta links.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ACENTO, Modelo, linkFicha } from './colabUtil'
import { BotonCopiar } from './ColabAnteojos'

type Estado = { link?: string; creando?: boolean; error?: string }

export default function ColabFichas({ clave, onLink }: { clave: string; onLink?: () => void }) {
  const [modelos, setModelos] = useState<Modelo[] | null>(null)
  const [est, setEst] = useState<Record<string, Estado>>({})

  useEffect(() => {
    supabase.rpc('colab_catalogo', { p_clave: clave }).then(({ data }) => setModelos((data as Modelo[]) ?? []))
  }, [clave])

  async function obtener(m: Modelo) {
    const c = m.colores.find((x) => x.imagen) ?? m.colores[0]
    const set = (e: Estado) => setEst((s) => ({ ...s, [m.modelo]: e }))
    set({ creando: true })
    const { data: ficha } = await supabase.rpc('modelo_landing', { p_modelo: m.modelo, p_sku: c.sku })
    if (!ficha) { set({ error: 'Sin stock para mostrar la ficha' }); return }
    const { data, error } = await supabase.rpc('colab_crear_link', { p_clave: clave, p_handle: c.handle, p_red: 'otra', p_formato: 'otro' })
    if (error) { set({ error: 'No se pudo crear el link. Probá de nuevo.' }); return }
    set({ link: linkFicha(m.modelo, c.sku, (data as { codigo: string }).codigo) })
    onLink?.()
  }

  if (!modelos) return <p className="text-[12px] text-neutral-400 py-10 text-center">Cargando…</p>

  return (
    <div>
      <div className="rounded-xl bg-white border border-black/10 p-4 mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">📷 Cámara</h1>
        <p className="text-[12px] text-neutral-500 mt-1">
          La página de cada anteojo para tu comunidad: fotos, colores, dónde probárselo cerca y compra online.
          Es la misma que se abre al reconocer el anteojo con la cámara. Al comprar, pasan por tu link.
        </p>
        <a href={`/reconocer?colab=${encodeURIComponent(clave)}`}
          className="mt-3 flex items-center justify-center gap-2 w-full rounded-xl text-white font-bold py-3.5 text-[14px]" style={{ background: ACENTO }}>
          📷 Reconocer con la cámara
        </a>
        <p className="text-[11px] text-neutral-400 mt-1.5 text-center">Apuntás a uno de tus anteojos y te da el link listo para copiar.</p>
      </div>
      {modelos.length === 0 && <p className="text-[12px] text-neutral-400 py-10 text-center">Todavía no tenés anteojos.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {modelos.map((m) => {
          const e = est[m.modelo] ?? {}
          const foto = m.colores.find((x) => x.imagen)?.imagen
          return (
            <div key={m.modelo} className="rounded-xl bg-white border border-black/10 p-3 flex gap-3">
              <div className="w-24 h-16 shrink-0 rounded-lg bg-white">
                {foto && <img src={foto} alt={m.modelo} className="w-full h-full object-contain" loading="lazy" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold uppercase truncate">{m.modelo}</div>
                <div className="text-[10px] text-neutral-500">{m.colores.length} {m.colores.length === 1 ? 'color' : 'colores'}</div>
                {e.link ? (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-2 py-1.5">
                    <span className="flex-1 truncate font-mono text-[11px] font-bold">{e.link.replace('https://', '')}</span>
                    <BotonCopiar texto={e.link} label="Copiar" grande />
                  </div>
                ) : e.error ? (
                  <p className="mt-2 text-[11px] text-neutral-400">{e.error}</p>
                ) : (
                  <button onClick={() => obtener(m)} disabled={e.creando}
                    className="mt-2 rounded-lg text-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: ACENTO }}>
                    {e.creando ? 'Creando…' : 'Obtener link'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
