// ── Anteojos · el panel operativo del influencer ──────────────────────────────
// Solo lo que la tienda tiene con stock (colab_catalogo). Por anteojo:
//   · la data real (sale de la descripción y la ficha de la tienda)
//   · copies listos: historia, posteo y guion de reel/tiktok
//   · "Generar mi link" por publicación (red + formato) → ver.orbitaleyewear.com.ar/r/<codigo>
import { useEffect, useMemo, useState } from 'react'
import { Search, X, Copy, Check, Link2, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, Modelo, REDES, FORMATOS, copiesDe, copiar, kAr, linkPublico, partesColor } from './colabUtil'

export function BotonCopiar({ texto, label = 'Copiar', grande }: { texto: string; label?: string; grande?: boolean }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={async () => { if (await copiar(texto)) { setOk(true); setTimeout(() => setOk(false), 1500) } }}
      className={`shrink-0 inline-flex items-center justify-center gap-1 rounded-lg font-bold ${grande ? 'px-3 py-2 text-[12px] text-white' : 'border border-black/10 bg-white px-2 py-1 text-[10px]'}`}
      style={grande ? { background: ok ? '#059669' : ACENTO } : undefined}>
      {ok ? <><Check size={grande ? 13 : 11} strokeWidth={3} />Copiado</> : <><Copy size={grande ? 13 : 11} />{label}</>}
    </button>
  )
}

function Foto({ src, alt }: { src: string | null; alt: string }) {
  return src
    ? <img src={src} alt={alt} className="w-full h-full object-contain" loading="lazy" />
    : <div className="w-full h-full bg-gradient-to-br from-[#F0F0F2] to-[#E4E4E8]" />
}

const FILTROS = ['Todos', 'Sol', 'Receta', 'Nuevos'] as const

export default function ColabAnteojos({ clave, pct, puedeLink, onLink }: {
  clave: string; pct: number; puedeLink: boolean; onLink?: () => void
}) {
  const [modelos, setModelos] = useState<Modelo[] | null>(null)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<typeof FILTROS[number]>('Todos')
  const [abierto, setAbierto] = useState<number | null>(null)

  useEffect(() => {
    supabase.rpc('colab_catalogo', { p_clave: clave }).then(({ data }) => setModelos((data as Modelo[]) ?? []))
  }, [clave])

  const lista = useMemo(() => (modelos ?? []).filter((m) => {
    if (q && !m.modelo.toLowerCase().includes(q.toLowerCase().trim())) return false
    if (filtro === 'Sol') return m.tipos.includes('SOL')
    if (filtro === 'Receta') return m.tipos.includes('RECETA')
    if (filtro === 'Nuevos') return m.nuevo
    return true
  }), [modelos, q, filtro])

  if (!modelos) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando anteojos…</p>

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Anteojos para promocionar</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Solo los que hay en stock en la tienda. Tocá uno para ver su data, los copies y
          {puedeLink ? ' generar tu link.' : ' los textos.'} Quien toque tu link tiene <b>{pct}% OFF extra</b> sobre el precio de la web.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo"
            className="w-full rounded-lg border border-black/10 bg-white pl-8 pr-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </div>
        {FILTROS.map((f) => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold border ${filtro === f ? 'text-white border-transparent' : 'bg-white border-black/10'}`}
            style={filtro === f ? { background: ACENTO } : undefined}>{f}</button>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {lista.map((m) => {
          const c0 = m.colores[0]
          const idx = modelos.indexOf(m)
          return (
            <button key={m.modelo} onClick={() => setAbierto(idx)} className="text-left bg-white rounded-xl border border-black/10 overflow-hidden hover:border-black/30">
              <div className="aspect-[4/3] bg-white p-2 relative">
                <Foto src={c0?.imagen} alt={m.modelo} />
                <div className="absolute top-1.5 left-1.5 flex gap-1">
                  {m.nuevo && <span className="rounded-full bg-black text-white text-[8px] font-bold px-1.5 py-0.5">NUEVO</span>}
                  {m.best && <span className="rounded-full text-white text-[8px] font-bold px-1.5 py-0.5" style={{ background: ACENTO }}>BEST SELLER</span>}
                </div>
              </div>
              <div className="px-2.5 py-2 border-t border-black/5">
                <div className="text-[12px] font-bold uppercase tracking-wide truncate">{m.modelo}</div>
                <div className="text-[10px] text-neutral-500">
                  {m.tipos.map((t) => (t === 'SOL' ? 'Sol' : 'Receta')).join(' · ')} · {m.colores.length} {m.colores.length === 1 ? 'color' : 'colores'}
                </div>
                {m.precio_desde && (
                  <div className="text-[11px] mt-0.5">
                    <span className="text-neutral-400 line-through mr-1">{kAr(m.precio_desde)}</span>
                    <b style={{ color: ACENTO }}>{kAr(m.precio_desde * (1 - pct / 100))}</b>
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {lista.length === 0 && <p className="text-sm text-neutral-500 py-10 text-center">Nada con ese filtro.</p>}

      {abierto != null && modelos[abierto] && (
        <Hoja key={abierto} m={modelos[abierto]} pct={pct} clave={clave} puedeLink={puedeLink} onLink={onLink}
          onClose={() => setAbierto(null)}
          onPrev={() => setAbierto((abierto - 1 + modelos.length) % modelos.length)}
          onNext={() => setAbierto((abierto + 1) % modelos.length)} />
      )}
    </>
  )
}

function Hoja({ m, pct, clave, puedeLink, onLink, onClose, onPrev, onNext }: {
  m: Modelo; pct: number; clave: string; puedeLink: boolean; onLink?: () => void
  onClose: () => void; onPrev: () => void; onNext: () => void
}) {
  const [ci, setCi] = useState(0)
  const c = m.colores[ci] ?? m.colores[0]
  const [red, setRed] = useState('instagram')
  const [formato, setFormato] = useState('historia')
  const [link, setLink] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'historia' | 'posteo' | 'guion'>('historia')

  // El link es de UNA publicación: si cambia el color, la red o el formato, hace falta otro.
  useEffect(() => { setLink(null); setErr(null) }, [ci, red, formato])
  const cp = useMemo(() => copiesDe(m, c, pct, link), [m, c, pct, link])
  const texto = tab === 'historia' ? cp.historia : tab === 'posteo' ? cp.posteo : cp.guion

  async function generar() {
    setCreando(true); setErr(null)
    const { data, error } = await supabase.rpc('colab_crear_link', { p_clave: clave, p_handle: c.handle, p_red: red, p_formato: formato })
    setCreando(false)
    if (error) { setErr(/sin_stock/.test(error.message) ? 'Este color se quedó sin stock. Elegí otro.' : 'No se pudo generar el link. Probá de nuevo.'); return }
    setLink(linkPublico((data as { codigo: string }).codigo))
    onLink?.()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#FAFAFA] w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-black/5 px-4 py-3 flex items-center gap-2">
          <button onClick={onPrev} className="p-1 rounded-md hover:bg-black/5" aria-label="Anterior"><ChevronLeft size={18} /></button>
          <div className="flex-1 min-w-0 text-center">
            <div className="text-[14px] font-bold uppercase tracking-wide truncate">{m.modelo}</div>
            <div className="text-[10px] text-neutral-500">{m.linea ?? ''} · {m.tipos.map((t) => (t === 'SOL' ? 'Sol' : 'Receta')).join(' · ')}</div>
          </div>
          <button onClick={onNext} className="p-1 rounded-md hover:bg-black/5" aria-label="Siguiente"><ChevronRight size={18} /></button>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Foto + colores */}
          <div className="bg-white rounded-xl border border-black/10 p-3">
            <div className="aspect-[16/9]"><Foto src={c.imagen} alt={m.modelo} /></div>
            <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
              {m.colores.map((x, i) => (
                <button key={x.product_id} onClick={() => setCi(i)} title={x.color ?? ''}
                  className="shrink-0 w-16 rounded-lg border-2 overflow-hidden bg-white"
                  style={{ borderColor: i === ci ? ACENTO : 'rgba(0,0,0,0.08)' }}>
                  <div className="h-10 p-0.5"><Foto src={x.imagen} alt={x.color ?? ''} /></div>
                </button>
              ))}
            </div>
            <div className="mt-2 text-[12px] font-semibold">{c.color}</div>
            <div className="flex flex-wrap items-baseline gap-x-3 mt-1">
              {cp.precioRef && <span className="text-[11px] text-neutral-400 line-through">{kAr(cp.precioRef)}</span>}
              {cp.precio && <span className="text-[12px]">Web <b>{kAr(cp.precio)}</b></span>}
              {cp.precioCodigo && <span className="text-[12px]" style={{ color: ACENTO }}>Con tu link <b>{kAr(cp.precioCodigo)}</b> (−{pct}%)</span>}
            </div>
          </div>

          {/* Tu link */}
          {puedeLink && (
            <div className="bg-white rounded-xl border-2 p-3" style={{ borderColor: ACENTO }}>
              <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide"><Link2 size={14} /> Tu link para esta publicación</div>
              <p className="text-[10px] text-neutral-500 mt-0.5 mb-2">
                Uno por publicación: así sabés cuál vende más. Pegalo en el sticker de enlace de la historia, o en la descripción / bio.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select value={red} onChange={(e) => setRed(e.target.value)} className="rounded-lg border border-black/10 px-2 py-2 text-[12px] bg-white">
                  {REDES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <select value={formato} onChange={(e) => setFormato(e.target.value)} className="rounded-lg border border-black/10 px-2 py-2 text-[12px] bg-white">
                  {FORMATOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              {!link ? (
                <button onClick={generar} disabled={creando} className="w-full mt-2 rounded-lg text-white py-2.5 text-[12px] font-semibold disabled:opacity-50" style={{ background: ACENTO }}>
                  {creando ? 'Generando…' : 'Generar mi link'}
                </button>
              ) : (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-2.5 py-2">
                  <span className="flex-1 truncate font-mono text-[12px] font-bold">{link.replace('https://', '')}</span>
                  <BotonCopiar texto={link} label="Copiar link" grande />
                </div>
              )}
              {err && <p className="text-[11px] text-red-600 mt-1.5">{err}</p>}
            </div>
          )}

          {/* Copies */}
          <div className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[12px] font-bold uppercase tracking-wide">Copies</div>
              <div className="flex rounded-lg border border-black/10 overflow-hidden text-[11px]">
                {(['historia', 'posteo', 'guion'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`px-2.5 py-1 font-semibold ${tab === t ? 'text-white' : ''}`}
                    style={tab === t ? { background: '#111827' } : undefined}>
                    {t === 'historia' ? 'Historia' : t === 'posteo' ? 'Posteo' : 'Guion'}
                  </button>
                ))}
              </div>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed rounded-lg bg-[#F5F5F7] p-3">{texto}</pre>
            <div className="flex justify-end mt-2"><BotonCopiar texto={texto} label="Copiar texto" /></div>
          </div>

          {/* Data del anteojo */}
          <div className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[12px] font-bold uppercase tracking-wide">Data del anteojo</div>
              <BotonCopiar texto={[`${m.modelo} · ${c.color ?? ''}`, ...cp.datos.map((d) => `• ${d}`)].join('\n')} />
            </div>
            <ul className="space-y-1 text-[12px]">
              {cp.datos.map((d) => <li key={d} className="flex gap-2"><span className="text-neutral-300">•</span><span>{d}</span></li>)}
            </ul>
            {cp.intro && <p className="text-[11px] text-neutral-600 mt-3 leading-relaxed border-t border-black/5 pt-2">{cp.intro}</p>}
            {partesColor(c.color).lente && /polariz/i.test(partesColor(c.color).lente!) && (
              <p className="text-[10px] text-neutral-500 mt-2">Tip: el polarizado corta el reflejo del agua, la ruta y el asfalto mojado. Mostralo al sol.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
