// ── Influencers de Instagram · bandeja de Orbital ───────────────────────────────
// Los que alguna vez nos escribieron por DM a @orbital.eyewear y tienen 5.000+ seguidores.
// Meta no deja mandar un DM a quien no nos escribió hace menos de 24 h, así que el envío
// es a mano: el botón copia el mensaje y abre el chat de esa persona en Instagram.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Check, ExternalLink, Search, BadgeCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, nAr } from './colabUtil'

type Estado = 'pendiente' | 'escrito' | 'respondio' | 'alta' | 'descartado'
type Fila = {
  usuario: string; pk: string | null; nombre: string | null; seguidores: number
  categoria: string | null; verificado: boolean; negocio: boolean; bio: string | null
  ultimo_dm: string | null; estado: Estado; notas: string | null; escrito_en: string | null
}

const ESTADOS: { k: Estado; t: string }[] = [
  { k: 'pendiente', t: 'Sin escribir' },
  { k: 'escrito', t: 'Escrito' },
  { k: 'respondio', t: 'Respondió' },
  { k: 'alta', t: 'Se sumó' },
  { k: 'descartado', t: 'Descartado' },
]

const MINIMOS = [5000, 10000, 50000, 100000, 500000]
const MSJ_KEY = 'colab_msj_influencer'
const MSJ_DEFECTO =
  'Hola {nombre}! Te escribimos de Orbital Eyewear 👋\n' +
  'Somos una marca argentina de anteojos y estamos armando un grupo chico de creadores para esta temporada.\n' +
  'Nos gustaría invitarte: elegís los modelos que van con vos y preparamos un descuento exclusivo para tu comunidad.\n' +
  '¿Te interesa que te cuente cómo sería?'

const primerNombre = (f: Fila) => (f.nombre ?? f.usuario).trim().split(/[\s·|,]/)[0] || f.usuario

// La misma pantalla vive en dos lados: en /colab entra con la clave de Orbital y en la
// Suite con el login de admin. Cambia sólo qué RPC llama; las de la Suite validan el rol.
export default function ColabInfluencers({ clave }: { clave?: string }) {
  const porClave = !!clave
  const rpc = {
    listar: porClave ? 'ig_infl_listar' : 'ig_infl_listar_admin',
    resumen: porClave ? 'ig_infl_resumen' : 'ig_infl_resumen_admin',
    marcar: porClave ? 'ig_infl_marcar' : 'ig_infl_marcar_admin',
  }
  return <Lista clave={clave} rpc={rpc} />
}

function Lista({ clave, rpc }: { clave?: string; rpc: { listar: string; resumen: string; marcar: string } }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [resumen, setResumen] = useState<Record<string, number>>({})
  const [min, setMin] = useState(5000)
  const [estado, setEstado] = useState<Estado | ''>('pendiente')
  const [buscar, setBuscar] = useState('')
  const [q, setQ] = useState('')
  const [msj, setMsj] = useState(() => localStorage.getItem(MSJ_KEY) ?? MSJ_DEFECTO)
  const [editando, setEditando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const conClave = clave ? { p_clave: clave } : {}

  async function cargar() {
    const [{ data }, { data: r }] = await Promise.all([
      supabase.rpc(rpc.listar, {
        ...conClave, p_min: min, p_estado: estado || null, p_buscar: q || null, p_limite: 300,
      }),
      supabase.rpc(rpc.resumen, { ...conClave, p_min: min }),
    ])
    setFilas((data as Fila[]) ?? [])
    setResumen((r as Record<string, number>) ?? {})
  }
  useEffect(() => { setFilas(null); cargar() }, [clave, min, estado, q])

  const total = useMemo(() => Object.values(resumen).reduce((a, b) => a + b, 0), [resumen])

  function textoDe(f: Fila) {
    return msj.replace(/\{nombre\}/g, primerNombre(f)).replace(/\{usuario\}/g, f.usuario)
  }

  async function copiar(f: Fila) {
    await navigator.clipboard.writeText(textoDe(f))
    setCopiado(f.usuario)
    setTimeout(() => setCopiado((c) => (c === f.usuario ? null : c)), 2500)
  }

  async function marcar(f: Fila, e: Estado) {
    setOcupado(f.usuario)
    await supabase.rpc(rpc.marcar, { ...conClave, p_usuario: f.usuario, p_estado: e })
    setFilas((prev) => (prev ? prev.map((x) => (x.usuario === f.usuario ? { ...x, estado: e } : x)) : prev))
    supabase.rpc(rpc.resumen, { ...conClave, p_min: min }).then(({ data }) => setResumen((data as Record<string, number>) ?? {}))
    setOcupado(null)
  }

  // Copiar + abrir el chat en un solo toque: es el camino normal de trabajo.
  async function escribir(f: Fila) {
    await copiar(f)
    window.open(`https://ig.me/m/${f.usuario}`, '_blank', 'noopener,noreferrer')
    if (f.estado === 'pendiente') await marcar(f, 'escrito')
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Influencers de Instagram</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Gente que nos escribió por DM y tiene 5.000 seguidores o más. Instagram no deja mandarlo automático:
          «Escribir» copia el mensaje y te abre el chat, vos pegás y enviás.
        </p>
      </div>

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
        <select value={min} onChange={(e) => setMin(Number(e.target.value))}
          className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          {MINIMOS.map((m) => <option key={m} value={m}>desde {nAr(m)} seguidores</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQ(buscar.trim()) }} className="flex-1 min-w-[180px] relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar @, nombre o bio"
            className="w-full rounded-lg border border-black/10 pl-7 pr-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </form>
        <button onClick={() => setEditando((v) => !v)} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold">
          {editando ? 'Listo' : 'Editar mensaje'}
        </button>
      </div>

      {editando && (
        <div className="mb-4 rounded-xl border border-black/10 bg-white p-3">
          <p className="text-[10px] text-neutral-500 mb-1.5">
            {'{nombre}'} se reemplaza por el nombre de cada uno y {'{usuario}'} por su @. Se guarda en este dispositivo.
          </p>
          <textarea value={msj} onChange={(e) => { setMsj(e.target.value); localStorage.setItem(MSJ_KEY, e.target.value) }}
            rows={6} className="w-full rounded-lg border border-black/10 p-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
        </div>
      )}

      {!filas && <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>}
      {filas && filas.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center text-[12px] text-neutral-600">
          No hay nadie con ese filtro.
        </div>
      )}

      <div className="space-y-2">
        {filas?.map((f) => (
          <div key={f.usuario} className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex gap-3 items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <a href={`https://instagram.com/${f.usuario}`} target="_blank" rel="noopener noreferrer"
                    className="text-[13px] font-bold truncate hover:underline">@{f.usuario}</a>
                  {f.verificado && <BadgeCheck size={13} style={{ color: ACENTO }} />}
                  <span className="text-[12px] font-bold tabular-nums" style={{ color: ACENTO }}>{nAr(f.seguidores)}</span>
                  {f.estado !== 'pendiente' && (
                    <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-600">
                      {ESTADOS.find((e) => e.k === f.estado)?.t}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-600 truncate">
                  {f.nombre ?? '—'}{f.categoria ? ` · ${f.categoria}` : ''}
                  {f.ultimo_dm ? ` · último DM ${new Date(f.ultimo_dm).toLocaleDateString('es-AR')}` : ''}
                </div>
                {f.bio && <div className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2 whitespace-pre-line">{f.bio}</div>}
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
                <button key={e.k} onClick={() => marcar(f, e.k)} disabled={ocupado === f.usuario}
                  className="rounded-md border border-black/10 px-2 py-0.5 text-[10px] text-neutral-600 disabled:opacity-50">{e.t}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
