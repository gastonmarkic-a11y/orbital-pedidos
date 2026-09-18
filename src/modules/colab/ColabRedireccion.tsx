// ── /r/<codigo> · landing exclusiva del link de un promotor ───────────────────
// Diseño en negro, como la tienda: las fotos van sobre tarjetas claras.
// Muestra el anteojo con el precio ya descontado, los colores con stock y de parte de quién.
// Promotor común: banner de Orbital (o el suyo), el video de reacción si lo subió y "su catálogo"
// (sus otros anteojos promocionados): se cambia de anteojo sin salir de la página y la venta queda
// atribuida al link de ese anteojo.
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
type Elegido = { codigo: string; modelo: string; imagen: string | null; price: number | null; compare_at: number | null }
type Ver = {
  ok: boolean; error?: string; redirect?: string
  directo?: string   // promotor sin cupón: sin landing, derecho a la ficha de la tienda
  modelo?: string; influencer?: string; pct?: number; descuento_activo?: boolean
  seleccionado?: string | null; colores?: ColorLanding[]; tienda?: string; utm?: string
  ver_mas?: string | null  // promotor de una colección (cobranding ZN): la colección de la tienda con UTM
  banner?: { desktop: string | null; mobile: string | null; titulo: string | null; texto: string | null } | null
  coleccion?: { modelo: string; imagen: string | null; price: number | null; compare_at: number | null; url: string }[]
  catalogo?: Elegido[]     // promotor común: sus otros anteojos promocionados
  video?: { url: string; ejemplo: boolean } | null
}

const TIENDA = 'https://www.orbitaleyewear.com.ar'
const FONDO = '#0A0A0A'
const FOTO = '#E9E9E9'   // tarjeta clara de la foto, como en la tienda

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

const codigoDeLaUrl = () => window.location.pathname.split('/')[2] ?? ''

function Logo() {
  return <img src="/logo-orbital.png" alt="Orbital" className="h-5" style={{ filter: 'invert(1)' }} />
}

export default function ColabRedireccion() {
  const [codigo, setCodigo] = useState(codigoDeLaUrl)
  const [d, setD] = useState<Ver | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [foto, setFoto] = useState(0)
  const [yendo, setYendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [cant, setCant] = useState(1)
  const galeria = useRef<HTMLDivElement>(null)

  // Volver atrás desde otro anteojo del catálogo
  useEffect(() => {
    const onPop = () => setCodigo(codigoDeLaUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let vivo = true
    setD(null); setFallo(null); setYendo(false)
    supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante(), accion: 'ver' } }).then(({ data }) => {
      if (!vivo) return
      const r = (data as Ver) ?? { ok: false, redirect: TIENDA }
      if (!r.ok) { setD(r); setTimeout(() => window.location.replace(r.redirect || TIENDA), 1800); return }
      // Sin cupón no hay nada que mostrar acá: el link lleva a la ficha del anteojo.
      if (r.directo) { window.location.replace(r.directo); return }
      setD(r); setSel(r.seleccionado ?? null)
    })
    return () => { vivo = false }
  }, [codigo])

  useEffect(() => { setFoto(0); setCant(1); galeria.current?.scrollTo({ left: 0 }) }, [sel])

  // Otro anteojo del catálogo del promotor, sin salir de la página
  function irA(otro: string) {
    window.history.pushState(null, '', `/r/${otro}`)
    window.scrollTo({ top: 0 })
    setCodigo(otro)
  }

  if (!d) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-white" style={{ background: FONDO }}>
        <div className="w-8 h-8 rounded-full border-2 border-white/15 animate-spin" style={{ borderTopColor: ACENTO }} />
        <p className="text-sm text-white/60 mt-4">Un segundo…</p>
      </div>
    )
  }
  if (!d.ok) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center text-white" style={{ background: FONDO }}>
        <div className="mb-6"><Logo /></div>
        <p className="text-sm text-white/80">{d.error === 'link_inactivo' ? 'Esta promo ya no está activa.' : 'Este link no existe.'}</p>
        <p className="text-sm text-white/50 mt-1">Te llevamos a la tienda…</p>
      </div>
    )
  }

  const colores = d.colores ?? []
  const c = colores.find((x) => x.handle === sel) ?? colores[0]
  const pct = d.pct ?? 30
  const conDesc = !!d.descuento_activo
  const utm = d.utm
  const fotosBase = c ? (c.imagenes?.length ? c.imagenes : c.imagen ? [c.imagen] : []) : []
  // Cobranding ZN: primero las fotos del anteojo, después la "en cara" (Zaira con el anteojo
  // puesto) y al final el aplique de marca y el packaging.
  const enCara = (u: string) => /en[_-]?cara/i.test(u)
  const extra = (u: string) => /aplicacion|aplique|packaging/i.test(u)
  const fotos = d.ver_mas
    ? [
        ...fotosBase.filter((u) => !enCara(u) && !extra(u)),
        ...fotosBase.filter(enCara),
        ...fotosBase.filter((u) => !enCara(u) && extra(u)),
      ]
    : fotosBase
  // Siempre parte del precio tachado de la tienda (compare_at) y el final queda por debajo
  // del precio de venta de la web: precio web − pct%.
  const precioFinal = c?.price ? Math.round(c.price * (1 - (conDesc ? pct : 0) / 100)) : null
  const precioRef = c ? (c.compare_at && c.price && c.compare_at > c.price ? c.compare_at : c.price) : null
  // Lo que el promotor le da a su comunidad: contra el tachado, siempre redondeado para arriba
  // (199.000 → 143.650 = 27,8% → 28%). El -1e-9 evita que un 28,0 exacto pase a 29 por decimales.
  const offPublico = conDesc && precioRef && precioFinal && precioRef > precioFinal ? Math.ceil((1 - precioFinal / precioRef) * 100 - 1e-9) : null
  const esReceta = c?.tipo === 'RECETA'
  const texto = intro(c?.descripcion ?? null)
  // Sin cupón y de sol: se elige la cantidad y va directo al checkout con el carrito armado.
  const conCantidad = !conDesc && !esReceta && !!c?.variant_id
  const catalogo = d.catalogo ?? []
  const destinoBanner = d.ver_mas ?? (catalogo.length ? '#elegidos' : d.tienda ?? TIENDA)

  async function comprar() {
    if (!c) return
    // Sin descuento el link igual lleva su UTM: con eso se atribuye el pedido (promotor sin cupón).
    if (!conDesc) {
      window.location.href = conCantidad
        ? `${TIENDA}/cart/${c.variant_id}:${cant}${utm ? `?${utm}` : ''}`
        : `${TIENDA}/products/${c.handle}${utm ? `?${utm}` : ''}`
      return
    }
    setYendo(true); setFallo(null)
    const { data } = await supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante(), accion: 'comprar', handle: c.handle } })
    const r = data as { ok: boolean; redirect?: string; error?: string } | null
    if (r?.ok && r.redirect) { window.location.href = r.redirect; return }
    setYendo(false)
    setFallo(r?.redirect ?? `${TIENDA}/products/${c.handle}`)
  }

  return (
    <div className={`min-h-screen text-white ${d.ver_mas ? 'pb-44' : 'pb-28'}`} style={{ background: FONDO }}>
      {/* Franja exclusiva */}
      <div className="text-white text-center font-mono text-[11px] font-semibold tracking-wide py-2 px-4" style={{ background: ACENTO }}>
        {conDesc ? `${offPublico ? `${offPublico}% OFF exclusivo` : 'Precio exclusivo'} de parte de ${d.influencer}` : `Recomendado por ${d.influencer}`}
      </div>

      <header className="max-w-md mx-auto px-4 pt-4 flex items-center justify-between">
        <Logo />
      </header>

      {/* Banner: el de la colección, el del promotor o el de Orbital */}
      {d.banner && (d.banner.desktop || d.banner.mobile) && (
        <a href={destinoBanner} className="block max-w-md mx-auto px-4 mt-3">
          <div className="relative overflow-hidden rounded-2xl bg-neutral-900">
            <img src={d.banner.desktop ?? d.banner.mobile ?? ''} alt={d.banner.titulo ?? ''} className="block w-full h-auto" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
            <div className="absolute inset-y-0 left-0 w-[64%] flex flex-col justify-center pl-4 text-white">
              <div className="font-mono text-[9px] tracking-[0.2em] opacity-80">■ ORBITAL</div>
              {d.banner.titulo && <div className="font-mono text-[19px] font-bold uppercase leading-none mt-1">{d.banner.titulo}</div>}
              {d.banner.texto && <p className="text-[11px] leading-snug opacity-90 mt-1.5">{d.banner.texto}</p>}
              <span className="mt-2 self-start rounded-full text-white font-mono text-[10px] px-3 py-1" style={{ background: ACENTO }}>[ VER LOS ELEGIDOS ]</span>
            </div>
          </div>
        </a>
      )}

      {!c ? (
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="text-[13px] font-bold uppercase tracking-[0.2em]">{d.modelo}</div>
          <p className="text-sm text-white/60 mt-2">Por ahora no hay stock de este modelo.</p>
          <a href={d.ver_mas ?? d.tienda ?? TIENDA} className="mt-5 inline-block rounded-full text-white px-5 py-3 text-sm font-semibold" style={{ background: ACENTO }}>Ver la tienda</a>
        </div>
      ) : (
        <main className="max-w-md mx-auto px-4">
          {/* Galería del color elegido */}
          <div className="mt-4">
            <div ref={galeria} className="flex overflow-x-auto snap-x snap-mandatory rounded-2xl [scrollbar-width:none]" style={{ background: FOTO }}
              onScroll={(e) => { const el = e.currentTarget; setFoto(Math.round(el.scrollLeft / el.clientWidth)) }}>
              {fotos.map((src, i) => (
                <div key={src} className="snap-center shrink-0 w-full aspect-square p-4">
                  <img src={src} alt={`${d.modelo} ${c.color ?? ''}`} className="w-full h-full object-contain" loading={i ? 'lazy' : 'eager'} />
                </div>
              ))}
            </div>
            {fotos.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-2">
                {fotos.map((_, i) => <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === foto ? 16 : 6, background: i === foto ? '#FFFFFF' : 'rgba(255,255,255,0.25)' }} />)}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">
              {esReceta ? 'Armazón para receta' : 'Anteojo de sol'}{c.linea ? ` · ${c.linea}` : ''}
            </div>
            <h1 className="text-[28px] font-bold uppercase tracking-wide leading-tight mt-0.5">{d.modelo}</h1>
            {c.color && <div className="text-[13px] text-white/60">{c.color}</div>}
          </div>

          {c.price != null && (
            <div className="mt-3 flex items-end gap-3">
              <div className="text-[30px] font-bold leading-none tabular-nums">{kAr(precioFinal)}</div>
              {precioRef && precioRef > (precioFinal ?? 0) && <div className="font-mono text-[13px] text-white/40 line-through tabular-nums pb-0.5">{kAr(precioRef)}</div>}
              {offPublico && <div className="rounded-full text-white text-[12px] font-bold px-2.5 py-0.5 mb-0.5" style={{ background: ACENTO }}>{offPublico}% OFF</div>}
            </div>
          )}
          {conDesc && c.price != null && (
            <p className="text-[11px] text-white/50 mt-1">
              Precio con tu código de descuento. Ya va aplicado al pagar.
            </p>
          )}

          {conCantidad && (
            <div className="mt-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2">Cantidad</div>
              <div className="inline-flex items-center rounded-full border-2 border-white/30">
                <button onClick={() => setCant((n) => Math.max(1, n - 1))} disabled={cant <= 1} aria-label="Menos"
                  className="w-11 h-10 text-[20px] font-bold disabled:opacity-30">−</button>
                <span className="w-8 text-center font-mono text-[15px] font-bold tabular-nums">{cant}</span>
                <button onClick={() => setCant((n) => Math.min(10, n + 1))} disabled={cant >= 10} aria-label="Más"
                  className="w-11 h-10 text-[20px] font-bold disabled:opacity-30">+</button>
              </div>
            </div>
          )}

          {colores.length > 1 && (
            <div className="mt-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50 mb-2">{colores.length} colores disponibles</div>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {colores.map((x) => (
                  <button key={x.handle} onClick={() => setSel(x.handle)} title={x.color ?? ''}
                    className="shrink-0 w-20 text-left">
                    <div className="aspect-square rounded-lg border-2 p-1" style={{ background: FOTO, borderColor: x.handle === c.handle ? ACENTO : 'transparent' }}>
                      {x.imagen && <img src={x.imagen} alt={x.color ?? ''} className="w-full h-full object-contain" loading="lazy" />}
                    </div>
                    <div className="text-[9px] leading-tight text-white/60 line-clamp-2 mt-1">{x.color}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Video de reacción del promotor */}
          {d.video?.url && (
            <div className="mt-6">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">La reacción de {d.influencer}</div>
                {d.video.ejemplo && <span className="rounded bg-amber-400 text-black font-mono text-[10px] font-bold px-1.5 py-0.5">VIDEO DE EJEMPLO</span>}
              </div>
              <video src={d.video.url} className="w-full max-h-[70vh] rounded-2xl bg-black" controls playsInline muted autoPlay loop />
            </div>
          )}

          {texto && <p className="text-[13px] text-white/70 leading-relaxed mt-5">{texto}</p>}

          {/* Su catálogo: los otros anteojos que promociona, sin salir de la página */}
          {catalogo.length > 0 && (
            <div id="elegidos" className="mt-7 scroll-mt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50 mb-3">Más elegidos por {d.influencer}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                {catalogo.map((x) => {
                  const fin = x.price != null ? Math.round(x.price * (1 - (conDesc ? pct : 0) / 100)) : null
                  const ref = x.compare_at && x.price && x.compare_at > x.price ? x.compare_at : x.price
                  return (
                    <button key={x.codigo} onClick={() => irA(x.codigo)} className="text-left group">
                      <div className="aspect-square rounded-md p-2" style={{ background: FOTO }}>
                        {x.imagen && <img src={x.imagen} alt={x.modelo} className="w-full h-full object-contain" loading="lazy" />}
                      </div>
                      <div className="text-[13px] font-bold uppercase tracking-wide truncate mt-2">{x.modelo}</div>
                      {fin != null && (
                        <div className="flex items-baseline gap-1.5 tabular-nums">
                          <b className="text-[13px]">{kAr(fin)}</b>
                          {ref != null && ref > fin && <span className="font-mono text-[10px] text-white/40 line-through">{kAr(ref)}</span>}
                        </div>
                      )}
                      <div className="font-mono text-[10px] tracking-wide mt-1.5 text-white/60 group-hover:text-white">[ VER MODELO ]</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Cobranding: el resto de la colección, un anteojo por modelo (con el UTM del link) */}
          {(d.coleccion?.length ?? 0) > 0 && (
            <div className="mt-7">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">Más de la colección</div>
                {d.ver_mas && <a href={d.ver_mas} className="font-mono text-[11px] font-semibold underline text-white">Ver todos</a>}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                {(d.coleccion ?? []).map((x) => (
                  <a key={x.modelo} href={x.url} className="block group">
                    <div className="aspect-square rounded-md p-2" style={{ background: FOTO }}>
                      {x.imagen && <img src={x.imagen} alt={x.modelo} className="w-full h-full object-contain" loading="lazy" />}
                    </div>
                    <div className="text-[13px] font-bold uppercase tracking-wide truncate mt-2">{x.modelo}</div>
                    {x.price != null && (
                      <div className="text-[12px] tabular-nums">
                        <b>{kAr(x.price)}</b>
                        {x.compare_at != null && x.compare_at > x.price && <span className="font-mono text-white/40 line-through ml-1">{kAr(x.compare_at)}</span>}
                      </div>
                    )}
                    <div className="font-mono text-[10px] tracking-wide mt-1.5 text-white/60 group-hover:text-white">[ VER MODELO ]</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <ul className="mt-6 space-y-1.5 text-[12px] text-white/60">
            {conDesc && <li>✔ Código único, solo para vos y de un solo uso</li>}
            {conDesc && <li>✔ {esReceta ? 'En la tienda elegís tus lentes con el descuento ya cargado' : 'Vas directo al pago con el descuento aplicado'}</li>}
            <li>✔ Compra segura en la tienda oficial de Orbital</li>
          </ul>
        </main>
      )}

      {/* Botón fijo */}
      {c && (
        <div className="fixed bottom-0 inset-x-0 backdrop-blur border-t border-white/10 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]" style={{ background: 'rgba(10,10,10,0.92)' }}>
          <div className="max-w-md mx-auto">
            {fallo && (
              <p className="text-[11px] text-red-400 mb-2 text-center">
                No pudimos generar tu descuento ahora. <button onClick={comprar} className="underline font-semibold">Reintentar</button> o <a href={fallo} className="underline">ver en la tienda</a>.
              </p>
            )}
            <button onClick={comprar} disabled={yendo}
              className="w-full rounded-full text-white py-3.5 font-mono text-[14px] font-bold disabled:opacity-70" style={{ background: ACENTO }}>
              {yendo ? 'Aplicando tu descuento…'
                : conDesc ? `[ ${esReceta ? 'ELEGIR LENTES' : 'COMPRAR'}${offPublico ? ` CON ${offPublico}% OFF` : ''}${precioFinal ? ` · ${kAr(precioFinal)}` : ''} ]`
                : `[ COMPRAR${conCantidad && precioFinal ? ` · ${kAr(precioFinal * cant)}` : ''} ]`}
            </button>
            {d.ver_mas && (
              <a href={d.ver_mas} className="block w-full text-center mt-2 rounded-full border-2 py-3 font-mono text-[13px] font-bold text-white border-white/40">
                [ VER MÁS MODELOS DE LA COLECCIÓN ]
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
