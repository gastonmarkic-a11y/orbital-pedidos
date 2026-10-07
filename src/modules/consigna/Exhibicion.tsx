// ── Exhibición: el croquis del mueble de la sucursal ─────────────────────────────────────
// Para el local (y la central mirando un local): qué anteojo va en cada lugar del sector Orbital según
// stock y ventas, qué mover hoy y por cuál reemplazar cada uno si se vende. Con la foto de la vitrina
// la IA (edge exhibicion-foto) dice qué hay en cada lugar; si duda, pregunta y el local elige.
// La vitrina confirmada queda guardada (consigna_exhibicion) y es la base del plan siguiente.
// El cálculo está en vitrina.ts. `ExhibicionResumen` es la vista de la central con todas las sucursales.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, X, ArrowRight, ArrowUp, RefreshCw, Search, HelpCircle, Store, Images } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Miniatura } from './Foto'
import type { Sucursal } from './CentralConsigna'
import { planificar, faltantes, type LineaStock, type VentaCod, type Pos, type Accion } from './vitrina'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const KEY = 'sb_publishable_YhNbcs63Zx6na8pfEsQgCw_C3iKSk-A'

type FotoGuardada = { id: number; fecha: string; quien: string | null; foto: string | null; posiciones: Pos[] }
type Datos = { exhibidor: { filas: number; columnas: number; nota: string | null }; stock: LineaStock[]; ventas: VentaCod[]; fotos: FotoGuardada[] }
type Leido = { f: number; c: number; vacio: boolean; codigo: string | null; seguro: boolean; opciones: string[]; caja: number[] | null }
// Lo que el local está revisando: lo leído por la IA y lo que va confirmando lugar por lugar.
type Revision = { foto: string | null; ancho: number; alto: number; leido: Leido[]; nota: string | null; error: boolean; conf: Record<string, Pos & { ok: boolean }> }

const k = (f: number, c: number) => `${f}-${c}`
const lugar = (f: number, c: number) => `Estante ${f} · lugar ${c}`
const fechaCorta = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Exhibicion({ clave, suc, editable, quien }: { clave: string; suc: Sucursal; editable: boolean; quien: string }) {
  const toast = useToast()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'plan' | 'hoy'>('plan')
  const [hechas, setHechas] = useState<Set<number>>(new Set())
  const [leyendo, setLeyendo] = useState(false)
  const [rev, setRev] = useState<Revision | null>(null)
  const [verFoto, setVerFoto] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const cargar = () => supabase.rpc('consigna_exhibicion', { p_k: clave, p_suc: suc.id }).then(({ data, error }) => {
    if (error) { setError(error.message.includes('sin_exhibidor') ? 'Todavía no relevamos el mueble de esta sucursal.' : 'No se pudo cargar la exhibición.'); return }
    setDatos(data as Datos)
    setHechas(new Set())
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [clave, suc.id])

  const info = useMemo(() => new Map((datos?.stock ?? []).map((s) => [s.codigo, s])), [datos])
  const ultima = datos?.fotos[0] ?? null
  const plan = useMemo(() => datos && planificar(datos.exhibidor.filas, datos.exhibidor.columnas, datos.stock, datos.ventas, ultima?.posiciones ?? null), [datos, ultima])
  const ventas = useMemo(() => new Map((datos?.ventas ?? []).map((v) => [v.codigo, v])), [datos])

  if (error) return <p className="bg-white border border-black/10 rounded-lg px-4 py-6 text-sm text-muted">{error}</p>
  if (!datos || !plan) return <p className="text-sm text-muted px-1">Cargando la vitrina…</p>
  const { filas, columnas } = datos.exhibidor
  const r = plan.resumen

  async function sacarFoto(archivo: File) {
    setLeyendo(true)
    try {
      const { b64, ancho, alto } = await achicar(archivo)
      const res = await fetch(`${SB}/functions/v1/exhibicion-foto`, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY },
        body: JSON.stringify({ k: clave, suc: suc.id, foto: b64 }),
      }).then((x) => x.json()).catch(() => null) as { foto?: string | null; lugares?: Leido[]; nota?: string | null; error?: string } | null
      const leido = res?.lugares ?? []
      const conf: Revision['conf'] = {}
      for (let f = 1; f <= filas; f++) for (let c = 1; c <= columnas; c++) {
        const l = leido.find((x) => x.f === f && x.c === c)
        conf[k(f, c)] = { f, c, codigo: l?.vacio ? null : l?.codigo ?? null, desconocido: !!l && !l.vacio && !l.codigo, ok: !!l?.seguro }
      }
      // Si la IA ve un código en más lugares que las unidades que hay en el local, todos esos lugares pasan a duda.
      for (const c of excedidos(conf, info)) for (const p of Object.values(conf)) if (p.codigo === c) p.ok = false
      setRev({ foto: res?.foto ?? null, ancho, alto, leido, nota: res?.nota ?? null, error: !res || !!res.error || !leido.length, conf })
    } finally {
      setLeyendo(false)
      if (input.current) input.current.value = ''
    }
  }

  async function confirmar(r: Revision) {
    const posiciones = Object.values(r.conf).map(({ f, c, codigo, desconocido }) => ({ f, c, codigo, ...(desconocido ? { desconocido: true } : {}) }))
    const { error } = await supabase.rpc('consigna_exhibicion_guardar', {
      p_k: clave, p_quien: quien.trim() || null, p_suc: suc.id, p_foto: r.foto, p_posiciones: posiciones, p_leido: r.leido.length ? r.leido : null,
    })
    if (error) { toast('No se pudo guardar la vitrina. Probá de nuevo.', 'error'); return }
    toast('Vitrina guardada: el plan ya está actualizado', 'success')
    setRev(null)
    setVista('plan')
    cargar()
  }

  const nombre = (c: string | null) => (c ? `${info.get(c)?.modelo ?? c} · ${info.get(c)?.descripcion ?? ''}` : 'vacío')
  const acciones = plan.acciones
  const hoy = new Map((ultima?.posiciones ?? []).map((p) => [k(p.f, p.c), p]))

  return (
    <div className="flex flex-col gap-4">
      {/* Cuenta del local: cuánto hay y cuánto entra */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <Kpi label="Stock en el local" valor={`${r.unidades} u`} sub={`${r.codigos} códigos disponibles${r.paraDevolver ? ` · ${r.paraDevolver} u para devolver` : ''}`} />
        <Kpi label="Lugares en la vitrina" valor={`${r.lugares}`} sub={`${filas} estantes × ${columnas} lugares`} />
        <Kpi label="En la vitrina" valor={`${r.enVitrina}`} sub={r.enVitrina < r.lugares ? `faltan ${r.lugares - r.enVitrina} códigos para llenarla` : 'vitrina completa'} tono={r.enVitrina < r.lugares ? 'text-amber-700' : ''} />
        <Kpi label="En reserva" valor={`${r.enReserva} u`} sub={r.sinLugar ? `${r.sinLugar} códigos no entran en la vitrina` : 'todo lo disponible está exhibido'} />
        <Kpi label="Última foto" valor={ultima ? fechaCorta(ultima.fecha) : 'Sin foto'} sub={ultima ? `por ${ultima.quien ?? '—'}` : 'sacala para comparar'} tono={ultima ? '' : 'text-amber-700'} />
      </div>

      {editable && (
        <section className="bg-ink text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <Camera size={18} className="text-gold" />
          <div className="mr-auto min-w-0">
            <div className="text-sm font-semibold">Sacá la foto de la vitrina</div>
            <div className="text-[12px] text-white/70">De frente, con todo el sector Orbital en el cuadro. La IA reconoce cada anteojo y, si tiene dudas, te pregunta.</div>
          </div>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" id="exhibicion-foto"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) sacarFoto(f) }} />
          <button disabled={leyendo} onClick={() => input.current?.click()}
            className="text-sm font-semibold bg-gold text-ink rounded-lg px-4 py-2 inline-flex items-center gap-2 disabled:opacity-60">
            {leyendo ? <><RefreshCw size={15} className="animate-spin" /> Reconociendo… (≈30 s)</> : <><Camera size={15} /> Sacar foto</>}
          </button>
          <button disabled={leyendo} onClick={() => setRev(revisionManual(filas, columnas, ultima?.posiciones ?? null))}
            className="text-xs text-white/80 underline underline-offset-2">Cargar a mano</button>
        </section>
      )}

      {!ultima && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3">
          Todavía no hay foto de la vitrina. Abajo va el armado recomendado desde cero. Con la primera foto te decimos qué cambiar de lo que ya está.
        </p>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        {/* Croquis del mueble */}
        <section className="bg-white border border-black/10 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold mr-auto">Croquis · sector Orbital</h2>
            <div className="flex rounded-lg border border-black/15 overflow-hidden text-xs font-semibold">
              <button onClick={() => setVista('plan')} className={`px-3 py-1.5 ${vista === 'plan' ? 'bg-ink text-white' : 'bg-white'}`}>Cómo tiene que quedar</button>
              <button onClick={() => setVista('hoy')} disabled={!ultima} className={`px-3 py-1.5 border-l border-black/15 disabled:opacity-40 ${vista === 'hoy' ? 'bg-ink text-white' : 'bg-white'}`}>Cómo está (última foto)</button>
            </div>
          </div>
          <div className="p-3 sm:p-4 bg-[#EDEAE2]">
            <div className="mx-auto max-w-[640px] rounded-lg overflow-hidden border-[5px] border-[#C9A961] shadow-sm">
              <div className="bg-[#2E3B40] text-[#EDE6D3] text-center font-bold tracking-[0.2em] py-2 text-lg">ORBITAL</div>
              <div className="bg-white/95 divide-y-2 divide-[#C9A961]/60">
                {Array.from({ length: filas }, (_, i) => i + 1).map((f) => (
                  <div key={f} className="grid gap-1.5 px-1.5 py-1.5 relative" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
                    {Array.from({ length: columnas }, (_, j) => j + 1).map((c) => {
                      if (vista === 'hoy') {
                        const p = hoy.get(k(f, c))
                        return <CeldaVitrina key={c} f={f} c={c} codigo={p?.codigo ?? null} desconocido={p?.desconocido} info={info} ventas={ventas} />
                      }
                      const l = plan.lugares.find((x) => x.f === f && x.c === c)!
                      return <CeldaVitrina key={c} f={f} c={c} codigo={l.codigo} cambia={l.cambia} antes={hoy.get(k(f, c)) ?? null} siSeVende={l.siSeVende} info={info} ventas={ventas} />
                    })}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-muted text-center mt-2">Estante 1 = arriba. Los de arriba se ven primero: ahí van los que más venden.</p>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {/* Movimientos del día */}
          <section className="bg-white border border-black/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-black/10">
              <h2 className="font-semibold">{ultima ? 'Movimientos para hoy' : 'Cómo armarla'}</h2>
              <p className="text-[11px] text-muted mt-0.5">{acciones.length ? `${hechas.size} de ${acciones.length} hechos. Al terminar, sacá una foto nueva.` : 'La vitrina está como tiene que estar.'}</p>
            </div>
            {acciones.length === 0 ? (
              <p className="px-4 py-5 text-sm text-emerald-800 flex items-center gap-2"><Check size={16} /> Nada para cambiar. Si se vende algo, reponé según el croquis.</p>
            ) : (
              <ol className="divide-y divide-black/5">
                {acciones.map((a, i) => (
                  <li key={i} className={`px-4 py-2.5 flex gap-3 items-start ${hechas.has(i) ? 'opacity-50' : ''}`}>
                    <button aria-label="Marcar hecho" onClick={() => setHechas((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                      className={`mt-0.5 w-5 h-5 shrink-0 rounded border grid place-items-center ${hechas.has(i) ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-black/25'}`}>
                      {hechas.has(i) && <Check size={13} />}
                    </button>
                    <TextoAccion a={a} nombre={nombre} info={info} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Reserva */}
          <section className="bg-white border border-black/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-black/10">
              <h2 className="font-semibold">En reserva <span className="text-muted font-normal tabular-nums">{r.enReserva} u</span></h2>
              <p className="text-[11px] text-muted mt-0.5">Lo disponible que no está exhibido, de lo que más vende a lo que menos. De acá salen los reemplazos.</p>
            </div>
            {plan.reserva.length === 0 ? <p className="px-4 py-4 text-sm text-muted">No queda reserva: todo lo disponible está en la vitrina.</p> : (
              <ul className="divide-y divide-black/5 max-h-[360px] overflow-y-auto">
                {plan.reserva.map((x) => {
                  const s = info.get(x.codigo)
                  const v = ventas.get(x.codigo)
                  return (
                    <li key={x.codigo} className="px-4 py-2 flex items-center gap-3">
                      <Miniatura src={s?.imagen} alt={s?.modelo ?? ''} color={s?.descripcion} size="sm" />
                      <div className="min-w-0 mr-auto">
                        <div className="text-[13px] font-semibold truncate">{s?.modelo}</div>
                        <div className="text-[11px] text-muted truncate">{s?.descripcion}</div>
                      </div>
                      <div className="text-right text-[11px] tabular-nums">
                        <div className="font-semibold text-sm">{x.unidades} u</div>
                        <div className="text-faint">{v?.u90 ? `${v.u90} vend. 90 d` : 'sin ventas'}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {datos.fotos.length > 0 && (
            <section className="bg-white border border-black/10 rounded-xl px-4 py-3">
              <h2 className="font-semibold text-sm flex items-center gap-2"><Images size={15} /> Fotos de la vitrina</h2>
              <div className="flex gap-2 overflow-x-auto mt-2 pb-1">
                {datos.fotos.map((x) => (
                  <button key={x.id} onClick={() => x.foto && setVerFoto(x.foto)} className="shrink-0 text-left">
                    <div className="w-20 h-24 rounded-md bg-black/5 overflow-hidden border border-black/10">
                      {x.foto ? <img src={x.foto} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[10px] text-faint">a mano</div>}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">{fechaCorta(x.fecha)}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {rev && <Revisar rev={rev} setRev={setRev} filas={filas} columnas={columnas} stock={datos.stock} info={info}
        antes={ultima?.posiciones ?? null} onConfirmar={confirmar} />}
      {verFoto && (
        <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4" onClick={() => setVerFoto(null)}>
          <img src={verFoto} alt="Foto de la vitrina" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

function Kpi({ label, valor, sub, tono = '' }: { label: string; valor: string; sub: string; tono?: string }) {
  return (
    <div className="bg-white border border-black/10 rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-tight mt-0.5 ${tono}`}>{valor}</div>
      <div className="text-[11px] text-faint mt-0.5">{sub}</div>
    </div>
  )
}

function CeldaVitrina({ f, c, codigo, desconocido, cambia, antes, siSeVende, info, ventas }: {
  f: number; c: number; codigo: string | null; desconocido?: boolean; cambia?: boolean; antes?: Pos | null
  siSeVende?: { codigo: string; mismo: boolean } | null; info: Map<string, LineaStock>; ventas: Map<string, VentaCod>
}) {
  const s = codigo ? info.get(codigo) : null
  const v = codigo ? ventas.get(codigo) : null
  const sig = siSeVende && !siSeVende.mismo ? info.get(siSeVende.codigo) : null
  const sale = antes?.codigo ? info.get(antes.codigo) : null
  return (
    <div title={lugar(f, c)} className={`rounded-md px-1.5 py-1.5 min-w-0 flex flex-col items-center text-center ${cambia ? 'bg-[#FBF3DC] ring-2 ring-gold' : desconocido ? 'bg-red-50 ring-1 ring-red-300' : ''}`}>
      <div className="w-full flex justify-between text-[9px] text-faint tabular-nums leading-none">
        <span>{f}·{c}</span>
        {cambia && <span className="font-bold text-[#8A6A1E] uppercase">cambiar</span>}
        {!cambia && v?.u90 ? <span>{v.u90} vend.</span> : null}
      </div>
      {/* Lo que hay que sacar de este lugar (según la última foto) */}
      {cambia && (
        <div className="w-full mt-1 mb-0.5 flex items-center gap-1 rounded bg-red-50 border border-red-200 px-1 py-0.5 text-left">
          {sale && <Miniatura src={sale.imagen} alt="" color={sale.descripcion} size="sm" />}
          <div className="min-w-0 text-[9.5px] leading-tight text-red-800">
            <b className="uppercase">Sacá</b>{' '}
            {antes?.desconocido ? 'el que no está en stock' : sale ? <span className="line-clamp-2">{sale.modelo} · {sale.descripcion}</span> : 'nada (está vacío)'}
          </div>
        </div>
      )}
      {cambia && s && <div className="w-full text-left text-[9.5px] font-bold uppercase text-emerald-800 mt-0.5">Poné</div>}
      {s ? (
        <>
          <Miniatura src={s.imagen} alt={s.modelo ?? ''} color={s.descripcion} />
          <div className="text-[11px] font-semibold leading-tight mt-0.5 w-full truncate">{s.modelo}</div>
          <div className="text-[10px] text-muted leading-tight w-full truncate">{s.descripcion}</div>
        </>
      ) : (
        <div className="h-[62px] w-full grid place-items-center text-[10px] text-faint">{desconocido ? 'no está en el stock' : codigo ? codigo : 'vacío'}</div>
      )}
      {siSeVende !== undefined && s && (
        <div className="text-[9.5px] leading-tight mt-1 w-full border-t border-black/5 pt-1 text-muted line-clamp-2" title="Si se vende, reponé con este">
          {siSeVende == null ? 'Si se vende: no queda reserva' : siSeVende.mismo ? '↻ Si se vende: el mismo' : <>↻ Si se vende: <b className="text-ink">{sig?.modelo}</b> {sig?.descripcion}</>}
        </div>
      )}
    </div>
  )
}

function TextoAccion({ a, nombre, info }: { a: Accion; nombre: (c: string | null) => string; info: Map<string, LineaStock> }) {
  const img = (c: string | null) => c ? <Miniatura src={info.get(c)?.imagen} alt="" color={info.get(c)?.descripcion} size="sm" /> : null
  if (a.tipo === 'mover') return (
    <div className="text-[13px] leading-snug min-w-0">
      <div className="flex items-center gap-1.5 font-semibold"><ArrowUp size={14} className="text-gold" /> Intercambiá {lugar(a.a.f, a.a.c)} ↔ {lugar(a.b.f, a.b.c)}</div>
      <div className="text-[12px] text-muted mt-0.5">Sube <b className="text-ink">{nombre(a.sube)}</b> (vende más) y baja {nombre(a.baja)}.</div>
    </div>
  )
  if (a.tipo === 'poner') return (
    <div className="text-[13px] leading-snug min-w-0 flex items-center gap-2">
      {img(a.codigo)}
      <div><div className="font-semibold">{lugar(a.f, a.c)}: poné {nombre(a.codigo)}</div><div className="text-[12px] text-muted">Está vacío. Sacalo de la reserva.</div></div>
    </div>
  )
  if (a.tipo === 'cambiar') return (
    <div className="text-[13px] leading-snug min-w-0 flex items-center gap-2">
      {img(a.entra)}
      <div>
        <div className="font-semibold">{lugar(a.f, a.c)}: poné {nombre(a.entra)}</div>
        <div className="text-[12px] text-muted">Sale {nombre(a.sale)}: {a.motivo}.</div>
      </div>
    </div>
  )
  return (
    <div className="text-[13px] leading-snug min-w-0 flex items-center gap-2">
      {img(a.entra)}
      <div>
        <div className="font-semibold">{lugar(a.f, a.c)}: sacá {a.sale ? nombre(a.sale) : 'el anteojo que está ahí'}{a.entra ? <> y poné {nombre(a.entra)}</> : null}</div>
        <div className="text-[12px] text-muted">{a.motivo}.{!a.entra && ' Queda vacío: no hay más stock disponible para exhibir.'}</div>
      </div>
    </div>
  )
}

// ── Revisión de lo que leyó la IA: el local confirma las dudas y guarda ──────────────────
function Revisar({ rev, setRev, filas, columnas, stock, info, antes, onConfirmar }: {
  rev: Revision; setRev: (r: Revision | null) => void; filas: number; columnas: number; stock: LineaStock[]
  info: Map<string, LineaStock>; antes: Pos[] | null; onConfirmar: (r: Revision) => Promise<void>
}) {
  const [elegir, setElegir] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  // No hace falta confirmar uno por uno: «guardar» acepta lo que propone la IA en todo lo que no se tocó.
  // Las dudas quedan marcadas solo para que el local mire esas primero (y las elige con un toque).
  const total = filas * columnas
  const dudas = Object.values(rev.conf).filter((p) => !p.ok).length
  const repetidos = excedidos(rev.conf, info)
  const ahora = Object.values(rev.conf)
  const faltan = faltantes(antes, ahora)
  const poner = (key: string, p: Partial<Pos>) => setRev({ ...rev, conf: { ...rev.conf, [key]: { ...rev.conf[key], codigo: null, desconocido: false, ...p, ok: true } } })
  const guardar = async () => {
    setGuardando(true)
    await onConfirmar({ ...rev, conf: Object.fromEntries(Object.entries(rev.conf).map(([key, p]) => [key, { ...p, ok: true }])) })
    setGuardando(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-[#F6F4EF] w-full sm:max-w-3xl max-h-[95vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-black/10 px-4 py-3 flex items-center gap-3">
          <div className="mr-auto min-w-0">
            <h2 className="font-semibold">Así leyó la IA tu vitrina</h2>
            <p className="text-[12px] text-muted">
              {rev.error ? 'La IA no pudo leer la foto: tocá cada lugar para cargarlo.' : `Reconoció ${total - dudas} de ${total} lugares sin dudas.`}
            </p>
          </div>
          <button onClick={() => setRev(null)} aria-label="Cerrar" className="p-1.5 rounded-md hover:bg-black/5"><X size={18} /></button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {!rev.error && (
            <div className="bg-white border border-black/10 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="mr-auto min-w-0 text-[13px] leading-snug">
                <b>¿Se parece a lo que hay en la vitrina?</b> Guardá así y listo.
                <div className="text-[12px] text-muted">{dudas ? `Si querés, corregí antes los ${dudas} marcados en ámbar: tocá la opción correcta dentro de la tarjeta.` : 'Si algo no coincide, tocá ese lugar para corregirlo.'}</div>
              </div>
              <button disabled={guardando} onClick={guardar}
                className="text-sm font-semibold bg-emerald-700 text-white rounded-lg px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-50">
                <Check size={16} /> {guardando ? 'Guardando…' : 'Está bien, guardar todo'}
              </button>
            </div>
          )}
          {rev.nota && <p className="text-[12px] bg-white border border-black/10 rounded-lg px-3 py-2"><b>La IA avisa:</b> {rev.nota}</p>}
          {faltan.length > 0 && (
            <p className="text-[12px] bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-3 py-2">
              <b>Desde la foto anterior ya no están:</b> {faltan.map((c) => `${info.get(c)?.modelo ?? c} ${info.get(c)?.descripcion ?? ''}`).join(' · ')}. Si se vendieron, el croquis ya te dice con qué reponer.
            </p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
            {Array.from({ length: filas * columnas }, (_, i) => {
              const f = Math.floor(i / columnas) + 1, c = (i % columnas) + 1
              const p = rev.conf[k(f, c)]
              const l = rev.leido.find((x) => x.f === f && x.c === c)
              const s = p.codigo ? info.get(p.codigo) : null
              // Opciones de un toque: lo que propuso la IA y sus alternativas.
              const ops = !p.ok ? [...new Set([...(l?.codigo ? [l.codigo] : []), ...(l?.opciones ?? [])])].filter((x) => info.has(x)).slice(0, 3) : []
              return (
                <div key={i} className={`bg-white rounded-lg border p-1.5 flex flex-col gap-1 ${p.ok ? 'border-black/10' : 'border-amber-500 ring-2 ring-amber-300'}`}>
                  <button onClick={() => setElegir(k(f, c))} className="text-left flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-muted"><span>{f}·{c}</span>{!p.ok && <span className="font-bold text-amber-700 flex items-center gap-0.5"><HelpCircle size={11} /> {p.codigo && repetidos.has(p.codigo) ? `repetido (hay ${info.get(p.codigo)?.cantidad ?? 0})` : 'duda'}</span>}</div>
                    <div className="flex gap-1">
                      {rev.foto && l?.caja && <Recorte foto={rev.foto} caja={l.caja} ancho={rev.ancho} alto={rev.alto} />}
                      {s && !ops.length && <Miniatura src={s.imagen} alt="" color={s.descripcion} size="sm" />}
                    </div>
                    <div className="text-[11px] leading-tight">
                      {s ? <><b>{s.modelo}</b> <span className="text-muted">{s.descripcion}</span></> : <span className="text-muted">{p.desconocido ? 'No está en el stock' : 'Vacío'}</span>}
                    </div>
                  </button>
                  {ops.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-t border-black/5 pt-1">
                      {ops.map((x) => {
                        const o = info.get(x)!
                        return (
                          <button key={x} onClick={() => poner(k(f, c), { codigo: x })} title={`${o.modelo} · ${o.descripcion}`}
                            className={`rounded-md border p-0.5 ${p.codigo === x ? 'border-ink ring-1 ring-ink' : 'border-black/10 hover:border-gold'}`}>
                            <Miniatura src={o.imagen} alt={o.modelo ?? ''} color={o.descripcion} size="sm" />
                          </button>
                        )
                      })}
                      <button onClick={() => setElegir(k(f, c))} className="text-[10px] text-muted underline px-1">otro</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-black/10 px-4 py-3 flex items-center gap-3">
          <span className="text-[12px] text-muted mr-auto">{dudas ? `${dudas} en ámbar: se guardan como propuso la IA` : 'Listo para guardar'}</span>
          <button disabled={guardando} onClick={guardar}
            className="text-sm font-semibold bg-emerald-700 text-white rounded-lg px-4 py-2 inline-flex items-center gap-2 disabled:opacity-40">
            <Check size={15} /> {guardando ? 'Guardando…' : 'Guardar vitrina'}
          </button>
        </div>
      </div>

      {elegir && (() => {
        const p = rev.conf[elegir]
        const l = rev.leido.find((x) => x.f === p.f && x.c === p.c)
        return <Elegir titulo={lugar(p.f, p.c)} actual={p} opciones={[...new Set([...(l?.codigo ? [l.codigo] : []), ...(l?.opciones ?? [])])]} stock={stock}
          foto={rev.foto && l?.caja ? { url: rev.foto, caja: l.caja, ancho: rev.ancho, alto: rev.alto } : null}
          onCerrar={() => setElegir(null)} onElegir={(x) => { poner(elegir, x); setElegir(null) }} />
      })()}
    </div>
  )
}

function Elegir({ titulo, actual, opciones, stock, foto, onCerrar, onElegir }: {
  titulo: string; actual: Pos; opciones: string[]; stock: LineaStock[]
  foto: { url: string; caja: number[]; ancho: number; alto: number } | null
  onCerrar: () => void; onElegir: (p: Partial<Pos>) => void
}) {
  const [q, setQ] = useState('')
  const cand = opciones.map((c) => stock.find((s) => s.codigo === c)).filter((s): s is LineaStock => !!s)
  const resto = stock.filter((s) => !opciones.includes(s.codigo) && (!q || `${s.modelo} ${s.descripcion}`.toLowerCase().includes(q.toLowerCase())))
  const Fila = ({ s, destacada }: { s: LineaStock; destacada?: boolean }) => (
    <button onClick={() => onElegir({ codigo: s.codigo })}
      className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border ${actual.codigo === s.codigo ? 'border-ink bg-ink/5' : destacada ? 'border-gold/60 bg-[#FBF7EC]' : 'border-black/10 bg-white'} hover:border-gold`}>
      <Miniatura src={s.imagen} alt="" color={s.descripcion} />
      <div className="min-w-0"><div className="text-[13px] font-semibold">{s.modelo}</div><div className="text-[11px] text-muted">{s.descripcion}</div></div>
      {actual.codigo === s.codigo && <Check size={16} className="ml-auto text-ink" />}
    </button>
  )
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onCerrar}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#F6F4EF] w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {foto && <Recorte foto={foto.url} caja={foto.caja} ancho={foto.ancho} alto={foto.alto} grande />}
          <div className="mr-auto"><h3 className="font-semibold">{titulo}</h3><p className="text-[12px] text-muted">¿Qué anteojo hay en este lugar?</p></div>
          <button onClick={onCerrar} aria-label="Cerrar" className="p-1.5 rounded-md hover:bg-black/5"><X size={18} /></button>
        </div>
        {cand.length > 0 && <div className="flex flex-col gap-1.5"><div className="text-[11px] uppercase tracking-wider text-muted">Lo que cree la IA</div>{cand.map((s) => <Fila key={s.codigo} s={s} destacada />)}</div>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onElegir({ codigo: null })} className="text-[13px] bg-white border border-black/10 rounded-lg px-3 py-2 hover:border-gold">Está vacío</button>
          <button onClick={() => onElegir({ codigo: null, desconocido: true })} className="text-[13px] bg-white border border-black/10 rounded-lg px-3 py-2 hover:border-gold">No está en la lista</button>
        </div>
        <label className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input id="exhibicion-busca" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el stock del local"
            className="w-full bg-white border border-black/15 rounded-lg pl-8 pr-3 py-1.5 text-sm" />
        </label>
        <div className="flex flex-col gap-1.5">{resto.map((s) => <Fila key={s.codigo} s={s} />)}</div>
      </div>
    </div>
  )
}

// Recorte del lugar en la foto (la caja que marcó la IA, con un margen).
function Recorte({ foto, caja, ancho, alto, grande }: { foto: string; caja: number[]; ancho: number; alto: number; grande?: boolean }) {
  const m = 0.012
  const x0 = Math.max(0, caja[0] - m), y0 = Math.max(0, caja[1] - m), x1 = Math.min(1, caja[2] + m), y1 = Math.min(1, caja[3] + m)
  const w = x1 - x0, h = y1 - y0
  const ancho0 = grande ? 120 : 64
  const altoPx = Math.min(ancho0 * ((h * alto) / (w * ancho)), ancho0 * 1.2)
  return (
    <div className="shrink-0 rounded-md overflow-hidden border border-black/10 bg-black/5" style={{
      width: ancho0, height: altoPx,
      backgroundImage: `url(${foto})`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${100 / w}% ${100 / h}%`,
      backgroundPosition: `${w < 1 ? (x0 / (1 - w)) * 100 : 0}% ${h < 1 ? (y0 / (1 - h)) * 100 : 0}%`,
    }} />
  )
}

// Códigos que aparecen en más lugares que las unidades que tiene el local.
function excedidos(conf: Revision['conf'], info: Map<string, LineaStock>) {
  const n = new Map<string, number>()
  for (const p of Object.values(conf)) if (p.codigo) n.set(p.codigo, (n.get(p.codigo) ?? 0) + 1)
  return new Set([...n].filter(([c, v]) => v > (info.get(c)?.cantidad ?? 0)).map(([c]) => c))
}

function revisionManual(filas: number, columnas: number, antes: Pos[] | null): Revision {
  const conf: Revision['conf'] = {}
  for (let f = 1; f <= filas; f++) for (let c = 1; c <= columnas; c++) {
    const p = antes?.find((x) => x.f === f && x.c === c)
    conf[k(f, c)] = { f, c, codigo: p?.codigo ?? null, desconocido: p?.desconocido, ok: true }
  }
  return { foto: null, ancho: 1, alto: 1, leido: [], nota: null, error: false, conf }
}

// La foto del celular se achica a 1800 px de lado mayor antes de subirla.
async function achicar(archivo: File): Promise<{ b64: string; ancho: number; alto: number }> {
  const bmp = await createImageBitmap(archivo)
  const esc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const url = cv.toDataURL('image/jpeg', 0.85)
  return { b64: url.slice(url.indexOf(',') + 1), ancho: cv.width, alto: cv.height }
}

// ── Central: el estado de la vitrina de cada sucursal con mueble cargado ──────────────────
export type ExhibidorSuc = { sucursal_id: number; filas: number; columnas: number; ultima: { fecha: string; quien: string | null; foto: string | null } | null }

export function ExhibicionResumen({ exhibidores, sucursales, onVer }: { exhibidores: ExhibidorSuc[]; sucursales: Sucursal[]; onVer: (id: number) => void }) {
  const dias = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / 86400000)
  return (
    <section className="bg-white border border-black/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-black/10">
        <h2 className="font-semibold">Exhibición por sucursal</h2>
        <p className="text-[12px] text-muted mt-0.5">Cada local saca la foto de su vitrina; la IA la reconoce y le dice qué anteojo va en cada lugar según su stock y sus ventas.</p>
      </div>
      <ul className="divide-y divide-black/5">
        {exhibidores.map((e) => {
          const s = sucursales.find((x) => x.id === e.sucursal_id)
          const d = e.ultima ? dias(e.ultima.fecha) : null
          return (
            <li key={e.sucursal_id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-14 h-16 rounded-md bg-black/5 overflow-hidden border border-black/10 shrink-0">
                {e.ultima?.foto ? <img src={e.ultima.foto} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><Store size={16} className="text-faint" /></div>}
              </div>
              <div className="min-w-0 mr-auto">
                <div className="font-semibold text-sm">{s?.nombre ?? `Sucursal ${e.sucursal_id}`}</div>
                <div className="text-[12px] text-muted">{e.filas * e.columnas} lugares · {e.ultima ? `última foto ${fechaCorta(e.ultima.fecha)}${e.ultima.quien ? ` por ${e.ultima.quien}` : ''}` : 'todavía sin foto'}</div>
                {(d == null || d >= 2) && <div className="text-[11px] text-amber-700 mt-0.5">{d == null ? 'Pedile al local la primera foto' : `Hace ${d} días que no actualiza la vitrina`}</div>}
              </div>
              <button onClick={() => onVer(e.sucursal_id)} className="text-xs font-semibold border border-black/15 rounded-lg px-3 py-1.5 inline-flex items-center gap-1 hover:border-gold">
                Ver croquis <ArrowRight size={13} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
