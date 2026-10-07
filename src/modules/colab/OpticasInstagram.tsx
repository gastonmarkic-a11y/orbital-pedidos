// ── Ópticas de Instagram · bandeja de Orbital ───────────────────────────────────
// Ópticas que nos escribieron por DM en 2026 o que seguimos desde @orbital.eyewear, y
// (paso 2) las de nuestra base con el @ encontrado. Igual que Influencers: Meta no deja
// mandar el DM automático, así que «Escribir» copia el mensaje y abre el chat.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Check, ExternalLink, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, nAr } from './colabUtil'

type Estado = 'pendiente' | 'escrito' | 'respondio' | 'alta' | 'descartado'
type Fila = {
  usuario: string; nombre: string | null; seguidores: number | null; categoria: string | null; bio: string | null
  telefono: string | null; ciudad: string | null; ultimo_dm: string | null; lo_seguimos: boolean; origen: 'dm' | 'sigo' | 'base'
  cliente_cod: string | null; cliente_nombre: string | null; cliente_vendedor: string | null; cliente_compro: boolean
  cliente_posible: string | null; provincia: string | null
  estado: Estado; escrito_por: string | null
  respuesta: string | null; respondio_en: string | null; derivado_a: string | null
  cat_visitas: number | null; cat_ultima: string | null
}
type Abrio = { usuario: string; nombre: string | null; estado: Estado; visitas: number; ultima_visita: string }

// Hasta cuándo ya viste las aperturas del catálogo (para resaltar las nuevas)
const VISTO_KEY = 'opticas_ig_catalogo_visto'
const leerVisto = () => { try { return localStorage.getItem(VISTO_KEY) ?? '' } catch { return '' } }
const hace = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'recién'
  if (m < 60) return `hace ${m} min`
  if (m < 1440) return `hace ${Math.round(m / 60)} h`
  return new Date(iso).toLocaleDateString('es-AR')
}
// Las fechas vienen de Postgres con formato distinto a toISOString: se comparan como fecha, no como texto
const despues = (a: string | null, b: string) => !!a && (!b || new Date(a).getTime() > new Date(b).getTime())

const PROVINCIAS = ['CABA', 'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy',
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán', 'Exterior']

const ESTADOS: { k: Estado; t: string }[] = [
  { k: 'pendiente', t: 'Sin escribir' },
  { k: 'escrito', t: 'Escrito' },
  { k: 'respondio', t: 'Respondió' },
  { k: 'alta', t: 'Compró' },
  { k: 'descartado', t: 'Descartado' },
]
const ORIGENES = [
  { k: '', t: 'Todos los orígenes' },
  { k: 'dm', t: 'Nos escribieron (2026)' },
  { k: 'sigo', t: 'Las seguimos' },
  { k: 'base', t: 'De nuestra base' },
]
const CLIENTES = [
  { k: 'no', t: 'No son clientes' },
  { k: 'si', t: 'Ya son clientes' },
  { k: '', t: 'Clientes y no clientes' },
]

// Uno para las que todavía no nos compran y otro para clientes. Sin precios ni fechas.
const MSJ: Record<'prospecto' | 'cliente', { key: string; t: string; defecto: string }> = {
  prospecto: {
    key: 'opticas_ig_msj_prospecto_v3', t: 'Ópticas que no son clientes',
    defecto:
      'Hola, ¿cómo estás? Hay algo que ninguna otra óptica de tu zona puede ofrecer todavía. Lanzamos Triple Protección: los únicos cristales en Argentina contra UV, luz azul e infrarrojo.\n' +
      'Además, cada óptica que trabaja con nosotros accede a un panel online donde tenés:\n' +
      '🕶️ Catálogo con stock real, para ver los modelos y pedir cuando quieras, incluso a demanda de tus clientes.\n' +
      '🪞 Probador virtual: tus clientes se prueban los anteojos desde el celular, y los destacados se ven en 3D.\n' +
      '📸 Todo el contenido de cada anteojo listo para publicar en tus redes, sin producir nada.\n' +
      '🤝 Postventa integrada en el mismo lugar, con respuesta rápida y precisa.\n\n' +
      'Mirá el catálogo acá 👉 {link}\n' +
      '¿Te gustaría sumarte? Te cuento cómo arrancar en dos minutos.',
  },
  cliente: {
    key: 'opticas_ig_msj_cliente', t: 'Ópticas que ya son clientes',
    defecto:
      'Hola {nombre}! Te escribimos de Orbital Eyewear 👋\n' +
      'Entraron modelos nuevos y queríamos que los vieras antes que nadie.\n' +
      '¿Te paso el catálogo actualizado?',
  },
}

const primerNombre = (f: Fila) => {
  const n = (f.nombre ?? f.cliente_nombre ?? f.usuario).replace(/[|·•].*$/, '').trim()
  return n || f.usuario
}

export default function OpticasInstagram() {
  const [vista, setVista] = useState<'bandeja' | 'base'>('bandeja')
  return (
    <>
      <div className="flex gap-1.5 mb-4">
        {([['bandeja', 'Bandeja'], ['base', 'Base sin Instagram']] as const).map(([k, t]) => (
          <button key={k} onClick={() => setVista(k)} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold border"
            style={vista === k ? { background: ACENTO, color: '#FFF', borderColor: ACENTO } : { borderColor: 'rgba(0,0,0,.15)' }}>{t}</button>
        ))}
      </div>
      {vista === 'bandeja' ? <Bandeja /> : <BaseSinInstagram />}
    </>
  )
}

function Bandeja() {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [resumen, setResumen] = useState<Record<string, number>>({})
  const [estado, setEstado] = useState<Estado | ''>('pendiente')
  const [cliente, setCliente] = useState('no')
  const [origen, setOrigen] = useState('')
  const [provincia, setProvincia] = useState('')
  const [provincias, setProvincias] = useState<{ provincia: string; n: number }[]>([])
  const [buscar, setBuscar] = useState('')
  const [q, setQ] = useState('')
  const [msjs, setMsjs] = useState(() => ({
    prospecto: localStorage.getItem(MSJ.prospecto.key) ?? MSJ.prospecto.defecto,
    cliente: localStorage.getItem(MSJ.cliente.key) ?? MSJ.cliente.defecto,
  }))
  const guardarMsj = (k: 'prospecto' | 'cliente', v: string) => {
    setMsjs((p) => ({ ...p, [k]: v }))
    localStorage.setItem(MSJ[k].key, v)
  }
  const [editando, setEditando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  // «Respondió»: se carga lo que contestó y se pasa al grupo de Ventas (vendedor de la zona)
  const [respondiendo, setRespondiendo] = useState<{ usuario: string; texto: string; provincia: string; error?: string } | null>(null)

  // Ópticas que abrieron el catálogo del DM (campaña ig_organico): aviso arriba, se refresca cada minuto
  const [abrieron, setAbrieron] = useState<Abrio[]>([])
  const [visto, setVisto] = useState(leerVisto)
  useEffect(() => {
    const cargar = () => supabase.rpc('ig_opt_abrieron').then(({ data }) => setAbrieron((data as Abrio[]) ?? []))
    cargar()
    const t = setInterval(cargar, 60000)
    return () => clearInterval(t)
  }, [])
  const nuevas = abrieron.filter((a) => despues(a.ultima_visita, visto))
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = nuevas.length ? `(${nuevas.length}) ${base}` : base
    return () => { document.title = document.title.replace(/^\(\d+\) /, '') }
  }, [nuevas.length])
  const marcarVisto = () => {
    const v = new Date().toISOString()
    try { localStorage.setItem(VISTO_KEY, v) } catch { /* sin storage */ }
    setVisto(v)
  }
  const verOptica = (u: string) => { setEstado(''); setCliente(''); setOrigen(''); setProvincia(''); setBuscar(u); setQ(u) }

  const filtros ={ p_cliente: cliente || null, p_origen: origen || null }
  const cargarResumen = () =>
    supabase.rpc('ig_opt_resumen', { ...filtros, p_provincia: provincia || null })
      .then(({ data }) => setResumen((data as Record<string, number>) ?? {}))

  useEffect(() => {
    setFilas(null)
    supabase.rpc('ig_opt_listar', { ...filtros, p_provincia: provincia || null, p_estado: estado || null, p_buscar: q || null, p_limite: 300 })
      .then(({ data }) => setFilas((data as Fila[]) ?? []))
    cargarResumen()
  }, [estado, cliente, origen, provincia, q])

  // Provincia deducida de la bio/nombre/@; los conteos respetan los demás filtros
  const cargarProvincias = () =>
    supabase.rpc('ig_opt_provincias', { ...filtros, p_estado: estado || null })
      .then(({ data }) => setProvincias((data as { provincia: string; n: number }[]) ?? []))
  useEffect(() => { cargarProvincias() }, [estado, cliente, origen])

  async function corregirProvincia(f: Fila, p: string) {
    await supabase.rpc('ig_opt_set_provincia', { p_usuario: f.usuario, p_provincia: p })
    setFilas((prev) => (prev ? prev.map((x) => (x.usuario === f.usuario ? { ...x, provincia: p || null } : x)) : prev))
    cargarProvincias()
  }

  const total = useMemo(() => Object.values(resumen).reduce((a, b) => a + b, 0), [resumen])

  // {link}: catálogo personal de cada óptica (el de cliente si está en la base; si no, uno de prospecto)
  async function textoDe(f: Fila) {
    let t = msjs[f.cliente_compro ? 'cliente' : 'prospecto'].replace(/\{nombre\}/g, primerNombre(f)).replace(/\{usuario\}/g, f.usuario)
    if (t.includes('{link}')) {
      const { data } = await supabase.rpc('ig_opt_link', { p_usuario: f.usuario })
      t = t.replace(/\{link\}/g, data ? `https://ver.orbitaleyewear.com.ar/catalogo?k=${data}` : 'https://ver.orbitaleyewear.com.ar/catalogo')
    }
    return t
  }

  async function copiar(f: Fila) {
    await navigator.clipboard.writeText(await textoDe(f))
    setCopiado(f.usuario)
    setTimeout(() => setCopiado((c) => (c === f.usuario ? null : c)), 2500)
  }

  async function marcar(f: Fila, e: Estado) {
    setOcupado(f.usuario)
    await supabase.rpc('ig_opt_marcar', { p_usuario: f.usuario, p_estado: e })
    setFilas((prev) => (prev ? prev.map((x) => (x.usuario === f.usuario ? { ...x, estado: e, escrito_por: e === 'pendiente' ? null : 'vos' } : x)) : prev))
    cargarResumen()
    setOcupado(null)
  }

  async function guardarRespuesta(f: Fila) {
    if (!respondiendo) return
    if (!respondiendo.texto.trim()) { setRespondiendo({ ...respondiendo, error: 'Pegá lo que respondió' }); return }
    setOcupado(f.usuario)
    const { data, error } = await supabase.rpc('ig_opt_respondio', {
      p_usuario: f.usuario, p_respuesta: respondiendo.texto, p_provincia: respondiendo.provincia || null,
    })
    setOcupado(null)
    const r = data as { ok: boolean; error?: string; vendedor?: string } | null
    if (error || !r?.ok) { setRespondiendo({ ...respondiendo, error: r?.error ?? 'No se pudo guardar' }); return }
    setFilas((prev) => (prev ? prev.map((x) => (x.usuario === f.usuario
      ? { ...x, estado: 'respondio', respuesta: respondiendo.texto.trim(), respondio_en: new Date().toISOString(),
          derivado_a: r.vendedor ?? null, provincia: respondiendo.provincia || x.provincia }
      : x)) : prev))
    setRespondiendo(null)
    cargarResumen()
  }

  async function escribir(f: Fila) {
    await copiar(f)
    window.open(`https://ig.me/m/${f.usuario}`, '_blank', 'noopener,noreferrer')
    if (f.estado === 'pendiente') await marcar(f, 'escrito')
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Ópticas de Instagram</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Ópticas que nos escribieron por DM este año, las que seguimos y las de nuestra base. Instagram no deja mandarlo
          automático: «Escribir» copia el mensaje y te abre el chat, vos pegás y enviás.
        </p>
      </div>

      {abrieron.length > 0 && (
        <div className={`mb-4 rounded-xl border-2 p-3 ${nuevas.length ? 'border-amber-400 bg-amber-50' : 'border-black/10 bg-white'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            {nuevas.length > 0 && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
            )}
            <span className="text-[13px] font-bold">
              {nuevas.length
                ? `${nuevas.length} ${nuevas.length === 1 ? 'óptica abrió' : 'ópticas abrieron'} tu catálogo`
                : `${abrieron.length} ${abrieron.length === 1 ? 'óptica abrió' : 'ópticas abrieron'} el catálogo`}
            </span>
            <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-fuchsia-100 text-fuchsia-700">Campaña ig_organico</span>
            {nuevas.length > 0 && (
              <button onClick={marcarVisto} className="ml-auto rounded-md border border-black/15 bg-white px-2 py-0.5 text-[10px] font-semibold">
                Ya las vi
              </button>
            )}
          </div>
          <p className="text-[10px] text-neutral-600 mt-1">
            Leyeron tu DM: fijate en Instagram si te contestaron y, si sí, marcá «Respondió».
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {abrieron.map((a) => (
              <button key={a.usuario} onClick={() => verOptica(a.usuario)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${despues(a.ultima_visita, visto) ? 'bg-amber-400 border-amber-500 text-black' : 'bg-white border-black/10 text-neutral-700'}`}>
                @{a.usuario} <span className="opacity-70 font-normal">· {a.visitas} {a.visitas === 1 ? 'vez' : 'veces'} · {hace(a.ultima_visita)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {ESTADOS.map((e) => (
          <button key={e.k} onClick={() => setEstado(estado === e.k ? '' : e.k)}
            className="rounded-full px-3 py-1 text-[11px] font-semibold border"
            style={estado === e.k ? { background: ACENTO, color: '#FFF', borderColor: ACENTO } : { borderColor: 'rgba(0,0,0,.15)' }}>
            {e.t} <span className="tabular-nums opacity-70">{resumen[e.k] ?? 0}</span>
          </button>
        ))}
        <span className="text-[11px] text-neutral-400 self-center ml-1">{nAr(total)} en total</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select value={cliente} onChange={(e) => setCliente(e.target.value)}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          {CLIENTES.map((c) => <option key={c.k} value={c.k}>{c.t}</option>)}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          {ORIGENES.map((o) => <option key={o.k} value={o.k}>{o.t}</option>)}
        </select>
        <select value={provincia} onChange={(e) => setProvincia(e.target.value)}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          <option value="">Todas las provincias</option>
          {provincias.map((p) => (
            <option key={p.provincia} value={p.provincia}>{p.provincia === '-' ? 'Sin provincia' : p.provincia} ({nAr(p.n)})</option>
          ))}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQ(buscar.trim()) }} className="flex-1 min-w-[180px] relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar @, nombre, bio o ciudad"
            className="w-full rounded-lg border border-black/10 pl-7 pr-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </form>
        <button onClick={() => setEditando((v) => !v)} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold">
          {editando ? 'Listo' : 'Editar mensajes'}
        </button>
      </div>

      {editando && (
        <div className="mb-4 rounded-xl border border-black/10 bg-white p-3">
          <p className="text-[10px] text-neutral-500 mb-1.5">
            {'{nombre}'} se reemplaza por el nombre de la óptica, {'{usuario}'} por su @ y {'{link}'} por su catálogo personal. Se guarda en este dispositivo.
            «Escribir» usa el de cliente o el de no cliente según corresponda.
          </p>
          {(['prospecto', 'cliente'] as const).map((k, i) => (
            <div key={k} className={i ? 'mt-3' : ''}>
              <div className="text-[11px] font-bold mb-1">{MSJ[k].t}</div>
              <textarea value={msjs[k]} onChange={(e) => guardarMsj(k, e.target.value)} rows={5}
                className="w-full rounded-lg border border-black/10 p-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
            </div>
          ))}
        </div>
      )}

      {!filas && <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>}
      {filas && filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center text-[12px] text-neutral-600">
          No hay ninguna con ese filtro.
        </div>
      )}

      <div className="space-y-2">
        {filas?.map((f) => (
          <div key={f.usuario} className={`bg-white rounded-xl p-3 ${f.cat_visitas
            ? (despues(f.cat_ultima, visto) ? 'border-2 border-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,.18)]' : 'border-2 border-amber-200')
            : 'border border-black/10'}`}>
            <div className="flex gap-3 items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a href={`https://instagram.com/${f.usuario}`} target="_blank" rel="noopener noreferrer"
                    className="text-[13px] font-bold truncate hover:underline">@{f.usuario}</a>
                  {f.seguidores != null && <span className="text-[12px] font-bold tabular-nums" style={{ color: ACENTO }}>{nAr(f.seguidores)}</span>}
                  {f.cliente_cod && (
                    <span className={`text-[9px] uppercase font-bold rounded px-1.5 py-0.5 ${f.cliente_compro ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
                      {f.cliente_compro ? 'Cliente' : 'En la base'} {f.cliente_cod}{f.cliente_vendedor ? ` · ${f.cliente_vendedor}` : ''}
                    </span>
                  )}
                  {!f.cliente_cod && f.cliente_posible && (
                    <span title={`Mismo nombre que: ${f.cliente_posible}`}
                      className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-amber-50 text-amber-700 max-w-[260px] truncate">
                      Ya nos compra · {f.cliente_posible}
                    </span>
                  )}
                  <select value={f.provincia ?? ''} onChange={(e) => corregirProvincia(f, e.target.value)}
                    title="Provincia (deducida de la bio; se puede corregir)"
                    className={`text-[9px] uppercase font-bold rounded px-1 py-0.5 border-0 ${f.provincia ? 'bg-neutral-100 text-neutral-600' : 'bg-rose-50 text-rose-600'}`}>
                    <option value="">Sin provincia</option>
                    {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {!!f.cat_visitas && (
                    <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-amber-400 text-black">
                      Abrió el catálogo · {f.cat_visitas} {f.cat_visitas === 1 ? 'vez' : 'veces'}{f.cat_ultima ? ` · ${hace(f.cat_ultima)}` : ''}
                    </span>
                  )}
                  {!!f.cat_visitas && (
                    <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-fuchsia-100 text-fuchsia-700">Campaña ig_organico</span>
                  )}
                  {f.lo_seguimos && <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-500">La seguimos</span>}
                  {f.estado !== 'pendiente' && (
                    <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-600">
                      {ESTADOS.find((e) => e.k === f.estado)?.t}{f.escrito_por ? ` · ${f.escrito_por}` : ''}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-600 truncate">
                  {f.cliente_nombre ?? f.nombre ?? '—'}{f.categoria ? ` · ${f.categoria}` : ''}{f.ciudad ? ` · ${f.ciudad}` : ''}
                  {f.ultimo_dm ? ` · último DM ${new Date(f.ultimo_dm).toLocaleDateString('es-AR')}` : ''}
                </div>
                {f.bio && <div className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2 whitespace-pre-line">{f.bio}</div>}
                {f.respuesta && (
                  <div className="mt-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-900">
                    <span className="font-bold">Respondió{f.respondio_en ? ` el ${new Date(f.respondio_en).toLocaleDateString('es-AR')}` : ''}:</span>{' '}
                    «{f.respuesta}»
                    <span className="block text-[10px] text-emerald-700 mt-0.5">
                      {f.derivado_a ? `Pasada a ${f.derivado_a} en el grupo de Ventas` : 'Sin vendedor: falta la provincia'}
                    </span>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col gap-1.5 items-end">
                <button onClick={() => escribir(f)} disabled={ocupado === f.usuario}
                  className="inline-flex items-center gap-1 rounded-md text-white px-2.5 py-1 text-[11px] font-bold disabled:opacity-50" style={{ background: ACENTO }}>
                  <ExternalLink size={12} />Escribir
                </button>
                <button onClick={() => copiar(f)}
                  className="inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-semibold">
                  {copiado === f.usuario ? <><Check size={12} />Copiado</> : <><Copy size={12} />Copiar</>}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-black/5">
              {ESTADOS.filter((e) => e.k !== f.estado).map((e) => (
                <button key={e.k} disabled={ocupado === f.usuario}
                  onClick={() => (e.k === 'respondio'
                    ? setRespondiendo({ usuario: f.usuario, texto: f.respuesta ?? '', provincia: f.provincia ?? '' })
                    : marcar(f, e.k))}
                  className="rounded-md border border-black/10 px-2 py-0.5 text-[10px] text-neutral-600 disabled:opacity-50">{e.t}</button>
              ))}
              {f.estado === 'respondio' && respondiendo?.usuario !== f.usuario && (
                <button onClick={() => setRespondiendo({ usuario: f.usuario, texto: f.respuesta ?? '', provincia: f.provincia ?? '' })}
                  className="rounded-md border border-black/10 px-2 py-0.5 text-[10px] text-neutral-600">
                  {f.respuesta ? 'Nueva respuesta' : 'Cargar respuesta'}
                </button>
              )}
            </div>
            {respondiendo?.usuario === f.usuario && (
              <div className="mt-2 rounded-lg border border-black/10 bg-neutral-50 p-2">
                <div className="text-[11px] font-bold mb-1">¿Qué respondió?</div>
                <textarea autoFocus value={respondiendo.texto} rows={3}
                  onChange={(e) => setRespondiendo({ ...respondiendo, texto: e.target.value, error: undefined })}
                  placeholder="Pegá la respuesta de la óptica"
                  className="w-full rounded-lg border border-black/10 p-2 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <select value={respondiendo.provincia} onChange={(e) => setRespondiendo({ ...respondiendo, provincia: e.target.value })}
                    title="Con la provincia se elige el vendedor de la zona"
                    className="rounded-lg border border-black/10 px-2 py-1 text-[11px] bg-white">
                    <option value="">Provincia…</option>
                    {PROVINCIAS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <button onClick={() => guardarRespuesta(f)} disabled={ocupado === f.usuario}
                    className="rounded-md text-white px-2.5 py-1 text-[11px] font-bold disabled:opacity-50" style={{ background: ACENTO }}>
                    Guardar y pasar a Ventas
                  </button>
                  <button onClick={() => setRespondiendo(null)} className="text-[11px] text-neutral-500">Cancelar</button>
                  {respondiendo.error && <span className="text-[11px] text-rose-600">{respondiendo.error}</span>}
                </div>
                <p className="text-[10px] text-neutral-500 mt-1">
                  Se avisa en el grupo de Ventas al vendedor de la zona (o al suyo si ya es cliente), con la respuesta y el catálogo.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Paso 2: clientes de la base a los que todavía no les tenemos el Instagram ──────
// «Buscar» abre la búsqueda en Google con el nombre y la localidad; se pega el @ y pasa a la bandeja.
type Pendiente = {
  cod: string; nombre: string; razon: string; localidad: string | null; provincia: string | null
  vendedor: string | null; ultima_compra: string | null; total: number
}

function BaseSinInstagram() {
  const [filas, setFilas] = useState<Pendiente[] | null>(null)
  const [soloCompraron, setSoloCompraron] = useState(true)
  const [buscar, setBuscar] = useState('')
  const [q, setQ] = useState('')
  const [pagina, setPagina] = useState(0)
  const [arroba, setArroba] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const POR_PAGINA = 50

  useEffect(() => {
    setFilas(null)
    supabase.rpc('ig_opt_base_pendientes', { p_buscar: q || null, p_solo_compraron: soloCompraron, p_limite: POR_PAGINA, p_offset: pagina * POR_PAGINA })
      .then(({ data }) => setFilas((data as Pendiente[]) ?? []))
  }, [q, soloCompraron, pagina])

  const total = filas?.[0]?.total ?? 0
  const quitar = (cod: string) => setFilas((prev) => (prev ? prev.filter((x) => x.cod !== cod) : prev))

  function buscarEnGoogle(p: Pendiente) {
    const nombre = p.nombre.replace(/\?/g, 'ó')
    const q = `site:instagram.com "${nombre}" ${p.localidad ?? p.provincia ?? ''}`
    window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener,noreferrer')
  }

  async function guardar(p: Pendiente) {
    const u = (arroba[p.cod] ?? '').trim()
    if (!u) return
    setOcupado(p.cod); setError(null)
    const { error } = await supabase.rpc('ig_opt_base_asignar', { p_cod: p.cod, p_usuario: u })
    setOcupado(null)
    if (error) { setError(`${p.nombre}: ${error.message}`); return }
    quitar(p.cod)
  }

  async function noTiene(p: Pendiente) {
    setOcupado(p.cod)
    await supabase.rpc('ig_opt_base_no_tiene', { p_cod: p.cod })
    setOcupado(null)
    quitar(p.cod)
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Base sin Instagram</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Clientes de la Suite a los que todavía no les tenemos el Instagram. «Buscar» abre Google con el nombre y la
          localidad; pegás el @ y la óptica pasa a la bandeja marcada como cliente.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select value={soloCompraron ? 'si' : 'no'} onChange={(e) => { setPagina(0); setSoloCompraron(e.target.value === 'si') }}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          <option value="si">Sólo los que nos compraron</option>
          <option value="no">Toda la base (con prospectos)</option>
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setPagina(0); setQ(buscar.trim()) }} className="flex-1 min-w-[180px] relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar cliente, localidad o código"
            className="w-full rounded-lg border border-black/10 pl-7 pr-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </form>
        <span className="text-[11px] text-neutral-400">{nAr(total)} sin Instagram</span>
      </div>

      {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}
      {!filas && <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>}
      {filas && filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center text-[12px] text-neutral-600">
          No queda ninguno con ese filtro.
        </div>
      )}

      <div className="space-y-2">
        {filas?.map((p) => (
          <div key={p.cod} className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold truncate">{p.nombre}</div>
                <div className="text-[10px] text-neutral-600 truncate">
                  {p.cod}{p.razon !== p.nombre ? ` · ${p.razon}` : ''}{p.localidad ? ` · ${p.localidad}` : ''}
                  {p.vendedor ? ` · ${p.vendedor}` : ''}
                  {p.ultima_compra ? ` · compró ${new Date(p.ultima_compra + 'T12:00:00').toLocaleDateString('es-AR')}` : ''}
                </div>
              </div>
              <button onClick={() => buscarEnGoogle(p)}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-[11px] font-semibold">
                <Search size={12} />Buscar
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); guardar(p) }} className="flex gap-1.5 mt-2 pt-2 border-t border-black/5">
              <input value={arroba[p.cod] ?? ''} onChange={(e) => setArroba((a) => ({ ...a, [p.cod]: e.target.value }))}
                placeholder="@usuario o link de Instagram"
                className="flex-1 min-w-0 rounded-md border border-black/10 px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              <button type="submit" disabled={ocupado === p.cod || !(arroba[p.cod] ?? '').trim()}
                className="rounded-md text-white px-2.5 py-1 text-[11px] font-bold disabled:opacity-40" style={{ background: ACENTO }}>Guardar</button>
              <button type="button" onClick={() => noTiene(p)} disabled={ocupado === p.cod}
                className="rounded-md border border-black/10 px-2 py-1 text-[10px] text-neutral-600 disabled:opacity-50">No tiene</button>
            </form>
          </div>
        ))}
      </div>

      {total > POR_PAGINA && (
        <div className="flex justify-center gap-2 mt-4 text-[12px]">
          <button disabled={pagina === 0} onClick={() => setPagina((n) => n - 1)} className="rounded-md border border-black/15 px-3 py-1 disabled:opacity-40">Anterior</button>
          <span className="self-center text-neutral-500">{pagina + 1} de {Math.ceil(total / POR_PAGINA)}</span>
          <button disabled={(pagina + 1) * POR_PAGINA >= total} onClick={() => setPagina((n) => n + 1)} className="rounded-md border border-black/15 px-3 py-1 disabled:opacity-40">Siguiente</button>
        </div>
      )}
    </>
  )
}
