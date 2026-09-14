// ── /r/<codigo> · landing exclusiva del link de un promotor ───────────────────
// Muestra el anteojo con el precio ya descontado, los colores con stock y de parte de quién.
// "Comprar" pide a colab-click un código único de un solo uso y manda:
//   · sol    → checkout directo con el anteojo en el carrito y el descuento aplicado
//   · receta → la ficha con el código aplicado (ahí se eligen las lentes)
// El código se crea recién al tocar Comprar: mirar la landing no gasta códigos.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ACENTO, VISITANTE_KEY, kAr } from './colabUtil'

type ColorLanding = {
  handle: string; color: string | null; imagen: string | null; imagenes: string[] | null
  price: number | null; compare_at: number | null; variant_id: number | null
  tipo: string | null; linea: string | null; descripcion: string | null
}
type Ver = {
  ok: boolean; error?: string; redirect?: string
  modelo?: string; influencer?: string; pct?: number; descuento_activo?: boolean
  seleccionado?: string | null; colores?: ColorLanding[]; tienda?: string
}

const TIENDA = 'https://www.orbitaleyewear.com.ar'

function visitante() {
  try {
    let v = localStorage.getItem(VISITANTE_KEY)
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(VISITANTE_KEY, v) }
    return v
  } catch { return null }
}

// Lo que describe el anteojo, sin la ficha técnica (primeras dos oraciones).
function intro(desc: string | null) {
  const cuerpo = (desc ?? '').replace(/\n/g, ' ').split(/Frente:|Medidas:/i)[0].trim()
  return cuerpo.split(/(?<=\.)\s+/).filter((s) => s.length > 20).slice(0, 2).join(' ') || null
}

export default function ColabRedireccion() {
  const codigo = window.location.pathname.split('/')[2] ?? ''
  const [d, setD] = useState<Ver | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [foto, setFoto] = useState(0)
  const [yendo, setYendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const galeria = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante(), accion: 'ver' } }).then(({ data }) => {
      if (!vivo) return
      const r = (data as Ver) ?? { ok: false, redirect: TIENDA }
      if (!r.ok) { setD(r); setTimeout(() => window.location.replace(r.redirect || TIENDA), 1800); return }
      setD(r); setSel(r.seleccionado ?? null)
    })
    return () => { vivo = false }
  }, [codigo])

  useEffect(() => { setFoto(0); galeria.current?.scrollTo({ left: 0 }) }, [sel])

  if (!d) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
        <div className="w-8 h-8 rounded-full border-2 border-black/10 animate-spin" style={{ borderTopColor: ACENTO }} />
        <p className="text-sm text-neutral-500 mt-4">Preparando tu descuento exclusivo…</p>
      </div>
    )
  }
  if (!d.ok) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <img src="/logo-orbital.png" alt="Orbital" className="h-6 mb-6" />
        <p className="text-sm text-neutral-600">{d.error === 'link_inactivo' ? 'Esta promo ya no está activa.' : 'Este link no existe.'}</p>
        <p className="text-sm text-neutral-400 mt-1">Te llevamos a la tienda…</p>
      </div>
    )
  }

  const colores = d.colores ?? []
  const c = colores.find((x) => x.handle === sel) ?? colores[0]
  const pct = d.pct ?? 30
  const conDesc = !!d.descuento_activo
  const fotos = c ? (c.imagenes?.length ? c.imagenes : c.imagen ? [c.imagen] : []) : []
  // Siempre parte del precio tachado de la tienda (compare_at) y el final queda por debajo
  // del precio de venta de la web: precio web − pct%.
  const precioFinal = c?.price ? Math.round(c.price * (1 - (conDesc ? pct : 0) / 100)) : null
  const precioRef = c ? (c.compare_at && c.price && c.compare_at > c.price ? c.compare_at : c.price) : null
  const esReceta = c?.tipo === 'RECETA'
  const texto = intro(c?.descripcion ?? null)

  async function comprar() {
    if (!c) return
    if (!conDesc) { window.location.href = `${TIENDA}/products/${c.handle}`; return }
    setYendo(true); setFallo(null)
    const { data } = await supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante(), accion: 'comprar', handle: c.handle } })
    const r = data as { ok: boolean; redirect?: string; error?: string } | null
    if (r?.ok && r.redirect) { window.location.href = r.redirect; return }
    setYendo(false)
    setFallo(r?.redirect ?? `${TIENDA}/products/${c.handle}`)
  }

  return (
    <div className="min-h-screen bg-white pb-28">
      {/* Franja exclusiva */}
      <div className="text-white text-center text-[11px] font-semibold tracking-wide py-2 px-4" style={{ background: ACENTO }}>
        {conDesc ? `Precio exclusivo de parte de ${d.influencer}` : `Recomendado por ${d.influencer}`}
      </div>

      <header className="max-w-md mx-auto px-4 pt-4 flex items-center justify-between">
        <img src="/logo-orbital.png" alt="Orbital" className="h-5" />      </header>

      {!c ? (
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em]">{d.modelo}</div>
          <p className="text-sm text-neutral-500 mt-2">Por ahora no hay stock de este modelo.</p>
          <a href={d.tienda ?? TIENDA} className="mt-5 inline-block rounded-xl text-white px-5 py-3 text-sm font-semibold" style={{ background: ACENTO }}>Ver la tienda</a>
        </div>
      ) : (
        <main className="max-w-md mx-auto px-4">
          {/* Galería del color elegido */}
          <div className="mt-3 -mx-4 sm:mx-0">
            <div ref={galeria} className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]"
              onScroll={(e) => { const el = e.currentTarget; setFoto(Math.round(el.scrollLeft / el.clientWidth)) }}>
              {fotos.map((src, i) => (
                <div key={src} className="snap-center shrink-0 w-full aspect-[4/3] px-4 sm:px-0">
                  <img src={src} alt={`${d.modelo} ${c.color ?? ''}`} className="w-full h-full object-contain" loading={i ? 'lazy' : 'eager'} />
                </div>
              ))}
            </div>
            {fotos.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-2">
                {fotos.map((_, i) => <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === foto ? 16 : 6, background: i === foto ? ACENTO : '#D4D4D8' }} />)}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-neutral-400">
              {esReceta ? 'Armazón para receta' : 'Anteojo de sol'}{c.linea ? ` · ${c.linea}` : ''}
            </div>
            <h1 className="text-[26px] font-bold uppercase tracking-wide leading-tight mt-0.5">{d.modelo}</h1>
            {c.color && <div className="text-[13px] text-neutral-600">{c.color}</div>}
          </div>

          {c.price != null && (
            <div className="mt-3 flex items-end gap-3">
              <div className="text-[30px] font-bold leading-none tabular-nums" style={{ color: conDesc ? ACENTO : undefined }}>{kAr(precioFinal)}</div>
              {precioRef && precioRef > (precioFinal ?? 0) && <div className="text-[14px] text-neutral-400 line-through tabular-nums pb-0.5">{kAr(precioRef)}</div>}
            </div>
          )}
          {conDesc && c.price != null && (
            <p className="text-[11px] text-neutral-500 mt-1">
              Precio con tu código de descuento. Ya va aplicado al pagar.
            </p>
          )}

          {colores.length > 1 && (
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 mb-2">{colores.length} colores disponibles</div>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {colores.map((x) => (
                  <button key={x.handle} onClick={() => setSel(x.handle)} title={x.color ?? ''}
                    className="shrink-0 w-20 rounded-xl border-2 bg-white p-1 text-left"
                    style={{ borderColor: x.handle === c.handle ? ACENTO : 'rgba(0,0,0,0.08)' }}>
                    <div className="aspect-[4/3]">{x.imagen && <img src={x.imagen} alt={x.color ?? ''} className="w-full h-full object-contain" loading="lazy" />}</div>
                    <div className="text-[9px] leading-tight text-neutral-600 line-clamp-2 mt-0.5">{x.color}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {texto && <p className="text-[13px] text-neutral-600 leading-relaxed mt-5">{texto}</p>}

          <ul className="mt-5 space-y-1.5 text-[12px] text-neutral-600">
            {conDesc && <li>✔ Código único, solo para vos y de un solo uso</li>}
            {conDesc && <li>✔ {esReceta ? 'En la tienda elegís tus lentes con el descuento ya cargado' : 'Vas directo al pago con el descuento aplicado'}</li>}
            <li>✔ Compra segura en la tienda oficial de Orbital</li>
          </ul>
        </main>
      )}

      {/* Botón fijo */}
      {c && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-black/5 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="max-w-md mx-auto">
            {fallo && (
              <p className="text-[11px] text-red-600 mb-2 text-center">
                No pudimos generar tu descuento ahora. <button onClick={comprar} className="underline font-semibold">Reintentar</button> o <a href={fallo} className="underline">ver en la tienda</a>.
              </p>
            )}
            <button onClick={comprar} disabled={yendo}
              className="w-full rounded-xl text-white py-3.5 text-[15px] font-bold disabled:opacity-70" style={{ background: ACENTO }}>
              {yendo ? 'Aplicando tu descuento…'
                : conDesc ? `${esReceta ? 'Elegir lentes' : 'Comprar'}${precioFinal ? ` a ${kAr(precioFinal)}` : ''}`
                : 'Ver en la tienda'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
