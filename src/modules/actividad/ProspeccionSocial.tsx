import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Copy, Check, ExternalLink, Send, Plus, Trash2 } from 'lucide-react'
import { RUBROS, mensajePara } from '../../lib/guiones'
import { CARGOS, linkedinSearchUrl, googleLinkedinUrl, googleWebUrl, webTeamUrl, linkedinEmpresaUrl, googleEmpresaUrl, type CargoCat } from '../../lib/cargos'

interface Persona { id: number; empresa_id: number; nombre: string | null; cargo: string | null; categoria: string | null; relevance_score: number | null; linkedin_url: string | null; estado: string }

// Cola de prospección social: cada contacto con su mensaje ya armado y un botón para marcar enviado.
// El sistema arma el mensaje; la persona copia, abre el perfil y envía (2 clics), y queda todo registrado.

interface Item {
  id: number; canal: 'ig' | 'linkedin'; nombre: string | null; perfil: string | null; url: string | null
  rubro: string | null; zona: string | null; mensaje: string | null; estado: string
  operador: string | null; proximo_toque: string | null; nota: string | null; created_at: string; enviado_at: string | null
  telefono: string | null; web: string | null; instagram: string | null
}

const ESTADOS: Record<string, { t: string; c: string }> = {
  nuevo: { t: 'A enviar', c: 'bg-amber-100 text-amber-700' },
  enviado: { t: 'Enviado', c: 'bg-blue-100 text-blue-700' },
  respondio: { t: 'Respondió', c: 'bg-emerald-100 text-emerald-700' },
  whatsapp: { t: 'En WhatsApp', c: 'bg-emerald-100 text-emerald-700' },
  cerrado: { t: 'Cerrado', c: 'bg-violet-100 text-violet-700' },
  descartado: { t: 'Descartado', c: 'bg-black/5 text-faint' },
}
const hoyMas = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }

export default function ProspeccionSocial() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'pend' | 'enviado' | 'respondio' | 'todos'>('pend')
  const [fZona, setFZona] = useState('')
  const [fWa, setFWa] = useState(false)
  const [fIg, setFIg] = useState(false)
  const [fWeb, setFWeb] = useState(false)
  const [personas, setPersonas] = useState<Record<number, Persona[]>>({})
  const [buscarOpen, setBuscarOpen] = useState<Set<number>>(new Set())
  const [copiado, setCopiado] = useState<number | null>(null)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nv, setNv] = useState({ canal: 'ig' as 'ig' | 'linkedin', nombre: '', perfil: '', url: '', rubro: 'opticas', zona: '' })
  const [guardando, setGuardando] = useState(false)
  const [dcCiudad, setDcCiudad] = useState('')
  const [dcRubro, setDcRubro] = useState('opticas')
  const [buscando, setBuscando] = useState(false)
  const [dcLimite, setDcLimite] = useState(30)
  const [buscandoApify, setBuscandoApify] = useState(false)
  const [gastoApify, setGastoApify] = useState<number | null>(null)
  const TOPE_APIFY = 4.5

  const msgDe = (it: Item) => it.mensaje ?? mensajePara(it.rubro ?? 'opticas', it.canal, it.nombre ?? undefined)
  // Link de WhatsApp con el mensaje ya cargado: 1 clic abre el chat listo para enviar.
  const waLink = (it: Item) => `https://wa.me/${(it.telefono ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(msgDe(it))}`

  async function buscarCiudad() {
    if (!dcCiudad.trim()) { toast('Poné una ciudad', 'error'); return }
    setBuscando(true)
    const { data, error } = await supabase.functions.invoke('descubridor-social', { body: { ciudad: dcCiudad.trim(), rubro: dcRubro } })
    setBuscando(false)
    const r = data as { insertados?: number; duplicados?: number; error?: string } | null
    if (error || r?.error) { toast(r?.error ?? 'No se pudo buscar', 'error'); return }
    toast(`✓ ${r?.insertados ?? 0} nuevos de ${dcCiudad} (${r?.duplicados ?? 0} ya estaban)`, 'success')
    setDcCiudad(''); cargar()
  }

  // Gasto Apify del mes en curso (para mostrar cuánto queda del crédito gratis ~$5).
  async function cargarGasto() {
    const inicio = new Date(); inicio.setUTCDate(1); inicio.setUTCHours(0, 0, 0, 0)
    const { data } = await supabase.from('apify_uso').select('costo_estimado_usd').gte('created_at', inicio.toISOString())
    const total = (data ?? []).reduce((a: number, r: { costo_estimado_usd: number }) => a + Number(r.costo_estimado_usd || 0), 0)
    setGastoApify(total)
  }

  // ApifyProvider: descubre por ciudad vía Apify (Google Maps). Cuesta crédito → tope + confirmación.
  async function buscarApify(confirmar = false) {
    if (!dcCiudad.trim()) { toast('Poné una ciudad', 'error'); return }
    setBuscandoApify(true)
    const { data, error } = await supabase.functions.invoke('apify-buscar', { body: { ciudad: dcCiudad.trim(), rubro: dcRubro, limite: dcLimite, confirmar } })
    setBuscandoApify(false)
    const r = data as { insertados?: number; duplicados?: number; error?: string; requiere_confirmacion?: boolean; motivo?: string; costo_corrida_usd?: number; gasto_mes_usd?: number } | null
    if (error) { toast('No se pudo conectar con Apify', 'error'); return }
    if (r?.requiere_confirmacion) {
      if (window.confirm(`${r.motivo}\n\n¿Igual la corro?`)) return buscarApify(true)
      return
    }
    if (r?.error) { toast(r.error, 'error'); cargarGasto(); return }
    toast(`✓ ${r?.insertados ?? 0} nuevos de ${dcCiudad} · gastaste ~$${(r?.costo_corrida_usd ?? 0).toFixed(2)} (mes: $${(r?.gasto_mes_usd ?? 0).toFixed(2)})`, 'success')
    setDcCiudad(''); cargar(); cargarGasto()
  }

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('prospeccion_social').select('*').order('created_at', { ascending: false }).limit(400)
    setItems((data as Item[]) ?? [])
    const { data: pers } = await supabase.from('prospecto_persona').select('id, empresa_id, nombre, cargo, categoria, relevance_score, linkedin_url, estado').neq('estado', 'descartado').order('relevance_score', { ascending: false })
    const map: Record<number, Persona[]> = {}
    for (const p of ((pers ?? []) as Persona[])) { (map[p.empresa_id] ??= []).push(p) }
    setPersonas(map)
    setLoading(false)
  }
  useEffect(() => { cargar(); cargarGasto() }, [])

  const ciudadDe = (it: Item) => (it.zona ?? '').split(',')[0].trim()
  function toggleBuscar(id: number) {
    setBuscarOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function agregarPersona(it: Item, cat: CargoCat, url: string) {
    const nombre = window.prompt(`¿Qué persona encontraste como ${cat.label} en ${it.nombre}? (nombre y apellido)`)
    if (!nombre || !nombre.trim()) return
    const { data, error } = await supabase.from('prospecto_persona').insert({
      empresa_id: it.id, nombre: nombre.trim(), cargo: cat.label, categoria: cat.id,
      relevance_score: cat.prioridad, fuente: 'manual', source_url: url, operador: codigoEfectivo, estado: 'nuevo',
    }).select('id, empresa_id, nombre, cargo, categoria, relevance_score, linkedin_url, estado').single()
    if (error) { toast('No se pudo guardar', 'error'); return }
    setPersonas((prev) => ({ ...prev, [it.id]: [...(prev[it.id] ?? []), data as Persona] }))
    toast(`✓ ${nombre.trim()} guardado como ${cat.label}`, 'success')
  }
  // Guardar desde la búsqueda general: pide nombre y cargo libre (el que viste en el perfil).
  async function agregarPersonaGeneral(it: Item, url: string) {
    const nombre = window.prompt(`¿Qué persona encontraste en ${it.nombre}? (nombre y apellido)`)
    if (!nombre || !nombre.trim()) return
    const cargo = (window.prompt('¿Qué cargo tiene? (ej: Dueño, Compras, Gerente…)') ?? '').trim() || 'Contacto'
    const { data, error } = await supabase.from('prospecto_persona').insert({
      empresa_id: it.id, nombre: nombre.trim(), cargo, categoria: 'general',
      relevance_score: 90, fuente: 'manual', source_url: url, operador: codigoEfectivo, estado: 'nuevo',
    }).select('id, empresa_id, nombre, cargo, categoria, relevance_score, linkedin_url, estado').single()
    if (error) { toast('No se pudo guardar', 'error'); return }
    setPersonas((prev) => ({ ...prev, [it.id]: [...(prev[it.id] ?? []), data as Persona] }))
    toast(`✓ ${nombre.trim()} guardado`, 'success')
  }
  async function descartarPersona(p: Persona) {
    await supabase.from('prospecto_persona').update({ estado: 'descartado' }).eq('id', p.id)
    setPersonas((prev) => ({ ...prev, [p.empresa_id]: (prev[p.empresa_id] ?? []).filter((x) => x.id !== p.id) }))
  }

  const zonas = useMemo(() => [...new Set(items.map((i) => i.zona).filter(Boolean))].sort() as string[], [items])

  const filtrados = useMemo(() => {
    let base = items.filter((i) => i.estado !== 'descartado')
    if (filtro === 'pend') base = base.filter((i) => i.estado === 'nuevo')
    else if (filtro === 'enviado') base = base.filter((i) => i.estado === 'enviado')
    else if (filtro === 'respondio') base = base.filter((i) => ['respondio', 'whatsapp'].includes(i.estado))
    if (fZona) base = base.filter((i) => (i.zona ?? '') === fZona)
    if (fWa) base = base.filter((i) => !!i.telefono?.trim())
    if (fIg) base = base.filter((i) => !!i.instagram?.trim())
    if (fWeb) base = base.filter((i) => !!i.web?.trim())
    return base
  }, [items, filtro, fZona, fWa, fIg, fWeb])

  const cuenta = (e: string) => items.filter((i) => (e === 'respondio' ? ['respondio', 'whatsapp'].includes(i.estado) : i.estado === e)).length

  async function agregar() {
    if (!nv.nombre.trim() && !nv.perfil.trim()) { toast('Poné al menos nombre o perfil', 'error'); return }
    setGuardando(true)
    const mensaje = mensajePara(nv.rubro, nv.canal === 'linkedin' ? 'linkedin' : 'ig', nv.nombre)
    const { error } = await supabase.from('prospeccion_social').insert({
      canal: nv.canal, nombre: nv.nombre.trim() || null, perfil: nv.perfil.trim() || null, url: nv.url.trim() || null,
      rubro: nv.rubro, zona: nv.zona.trim() || null, mensaje, estado: 'nuevo', operador: codigoEfectivo,
    })
    setGuardando(false)
    if (error) { toast('No se pudo agregar: ' + error.message, 'error'); return }
    toast('✓ Agregado a la cola', 'success')
    setNv({ canal: nv.canal, nombre: '', perfil: '', url: '', rubro: nv.rubro, zona: nv.zona })
    setNuevoOpen(false); cargar()
  }

  async function copiar(it: Item) {
    try { await navigator.clipboard.writeText(msgDe(it)); setCopiado(it.id); toast('✓ Mensaje copiado', 'success'); setTimeout(() => setCopiado(null), 1500) } catch { toast('No se pudo copiar', 'error') }
  }
  async function setEstado(it: Item, estado: string, extra: Partial<Item> = {}) {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, estado, ...extra } : x)))
    await supabase.from('prospeccion_social').update({ estado, ...extra }).eq('id', it.id)
  }
  const marcarEnviado = (it: Item) => setEstado(it, 'enviado', { enviado_at: new Date().toISOString(), proximo_toque: hoyMas(4) })

  const rubroLabel = (id: string | null) => RUBROS.find((r) => r.id === id)?.nombre ?? id ?? '—'

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">📣 Cola de prospección social</h1>
          <p className="text-xs text-muted">Cada contacto con su mensaje listo. Copiás, abrís el perfil y enviás — 2 clics.</p>
        </div>
        <button onClick={() => setNuevoOpen((o) => !o)} className="text-xs font-medium bg-brand text-white rounded-lg px-3 py-1.5 flex items-center gap-1"><Plus size={14} />Agregar</button>
      </div>

      {/* Descubridor: busca negocios por ciudad (Google Maps) y llena la cola solo */}
      <div className="bg-white rounded-2xl border border-black/10 p-3">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">🔎 Descubrir por ciudad (Google Maps)</p>
        <div className="flex flex-wrap gap-2">
          <input value={dcCiudad} onChange={(e) => setDcCiudad(e.target.value)} placeholder="Ciudad (ej: Mendoza, Santa Fe, San Juan)" className="flex-1 min-w-[160px] border border-black/10 rounded-lg px-3 py-2 text-sm" />
          <select value={dcRubro} onChange={(e) => setDcRubro(e.target.value)} className="border border-black/10 rounded-lg px-2 py-2 text-sm">
            {RUBROS.map((r) => <option key={r.id} value={r.id}>{r.emoji} {r.nombre}</option>)}
          </select>
          <button onClick={buscarCiudad} disabled={buscando} className="bg-ink text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">{buscando ? 'Buscando…' : 'Buscar (gratis · Google)'}</button>
        </div>
        <p className="text-[10px] text-faint mt-1.5">Trae los negocios del rubro en esa ciudad, con el mensaje listo. Cada uno queda en "A enviar".</p>

        {/* ApifyProvider: más lugares y mejor contacto. Usa crédito (tope ~$5/mes gratis). */}
        <div className="mt-3 pt-3 border-t border-black/10">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">⚡ Apify (más lugares + contacto)</p>
            {gastoApify !== null && (
              <span className={`text-[10px] font-medium ${gastoApify >= TOPE_APIFY ? 'text-red-600' : 'text-faint'}`}>
                crédito: ${gastoApify.toFixed(2)} / ${TOPE_APIFY.toFixed(2)} del mes
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-muted flex items-center gap-1">
              Cantidad
              <input type="number" min={5} max={120} value={dcLimite} onChange={(e) => setDcLimite(Math.max(5, Math.min(120, Number(e.target.value) || 30)))} className="w-16 border border-black/10 rounded-lg px-2 py-2 text-sm" />
            </label>
            <span className="text-[10px] text-faint">≈ ${(dcLimite * 0.007).toFixed(2)} esta corrida</span>
            <button onClick={() => buscarApify(false)} disabled={buscandoApify} className="bg-brandDark text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">{buscandoApify ? 'Buscando…' : 'Buscar con Apify'}</button>
          </div>
          <p className="text-[10px] text-faint mt-1.5">Usa el crédito gratis de Apify (~$5/mes). Tope duro: 120 por corrida y avisa antes de pasarte del mes.</p>
        </div>
      </div>

      {/* Alta manual (mientras el descubridor sea manual) */}
      {nuevoOpen && (
        <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted">Canal
              <select value={nv.canal} onChange={(e) => setNv({ ...nv, canal: e.target.value as 'ig' | 'linkedin' })} className="w-full mt-1 border border-black/10 rounded-lg px-2 py-2 text-sm">
                <option value="ig">📷 Instagram</option><option value="linkedin">💼 LinkedIn</option>
              </select>
            </label>
            <label className="text-[11px] text-muted">Rubro
              <select value={nv.rubro} onChange={(e) => setNv({ ...nv, rubro: e.target.value })} className="w-full mt-1 border border-black/10 rounded-lg px-2 py-2 text-sm">
                {RUBROS.map((r) => <option key={r.id} value={r.id}>{r.emoji} {r.nombre}</option>)}
              </select>
            </label>
            <input value={nv.nombre} onChange={(e) => setNv({ ...nv, nombre: e.target.value })} placeholder="Nombre / óptica" className="border border-black/10 rounded-lg px-3 py-2 text-sm" />
            <input value={nv.perfil} onChange={(e) => setNv({ ...nv, perfil: e.target.value })} placeholder="@usuario / perfil" className="border border-black/10 rounded-lg px-3 py-2 text-sm" />
            <input value={nv.url} onChange={(e) => setNv({ ...nv, url: e.target.value })} placeholder="Link al perfil (opcional)" className="border border-black/10 rounded-lg px-3 py-2 text-sm col-span-2" />
            <input value={nv.zona} onChange={(e) => setNv({ ...nv, zona: e.target.value })} placeholder="Zona (opcional)" className="border border-black/10 rounded-lg px-3 py-2 text-sm col-span-2" />
          </div>
          <div className="bg-[#F6F4EF] rounded-lg p-2.5 border border-black/5">
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Mensaje que se va a usar ({nv.canal === 'linkedin' ? 'LinkedIn' : 'Instagram'})</p>
            <p className="text-[12px] text-muted whitespace-pre-wrap">{mensajePara(nv.rubro, nv.canal, nv.nombre)}</p>
          </div>
          <button onClick={agregar} disabled={guardando} className="w-full bg-brand text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50">{guardando ? 'Agregando…' : '+ Sumar a la cola'}</button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {([['pend', `A enviar (${cuenta('nuevo')})`], ['enviado', `Enviados (${cuenta('enviado')})`], ['respondio', `Respondieron (${cuenta('respondio')})`], ['todos', 'Todos']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${filtro === k ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 text-muted'}`}>{l}</button>
        ))}
      </div>

      {/* Filtros por zona / contacto */}
      <div className="flex gap-1.5 items-center flex-wrap">
        <select value={fZona} onChange={(e) => setFZona(e.target.value)} className="shrink-0 text-[12px] rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-brandDark">
          <option value="">📍 Todas las zonas</option>
          {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <button onClick={() => setFWa(!fWa)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${fWa ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-black/10 text-muted'}`}>📲 WhatsApp</button>
        <button onClick={() => setFIg(!fIg)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${fIg ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 text-muted'}`}>📷 IG</button>
        <button onClick={() => setFWeb(!fWeb)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${fWeb ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 text-muted'}`}>🌐 Web</button>
        <span className="text-[11px] text-faint ml-auto shrink-0">{filtrados.length} contactos</span>
      </div>

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : filtrados.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Sin contactos en esta vista. Agregá targets o esperá al descubridor.</div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((it) => (
            <div key={it.id} className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{it.canal === 'ig' ? '📷' : '💼'} {it.nombre || it.perfil}</p>
                  <p className="text-[10px] text-faint">{[it.perfil && it.nombre ? it.perfil : null, rubroLabel(it.rubro), it.zona].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${ESTADOS[it.estado]?.c ?? 'bg-black/5'}`}>{ESTADOS[it.estado]?.t ?? it.estado}</span>
              </div>
              <p className="text-[12px] text-muted bg-[#F6F4EF] rounded-lg p-2 whitespace-pre-wrap">{msgDe(it)}</p>

              {/* Buscar contactos (decisores) — genera búsquedas, no scrapea */}
              <div>
                <button onClick={() => toggleBuscar(it.id)} className="text-[11px] font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 px-2.5 py-1.5">
                  🔎 Buscar contactos{personas[it.id]?.length ? ` · ${personas[it.id].length} guardados` : ''}
                </button>
                {(personas[it.id]?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {personas[it.id].map((p) => (
                      <span key={p.id} className="text-[11px] bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                        <b>{p.nombre}</b><span className="text-muted">· {p.cargo}</span>
                        <button onClick={() => descartarPersona(p)} className="text-red-400 font-bold ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
                {buscarOpen.has(it.id) && (
                  <div className="mt-2 bg-indigo-50/60 border border-indigo-100 rounded-lg p-2.5 space-y-2">
                    {/* Búsqueda GENERAL: un clic → toda la gente de la óptica */}
                    <p className="text-[10px] text-indigo-800 font-semibold">Abrí la gente de la óptica y guardá al que decide (no scrapea nada):</p>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <a href={linkedinEmpresaUrl(it.nombre ?? '', ciudadDe(it))} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg bg-[#0a66c2] text-white px-2.5 py-1.5">in · Ver equipo</a>
                      <a href={googleEmpresaUrl(it.nombre ?? '', ciudadDe(it))} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 text-brandDark">🔍 Google</a>
                      {webTeamUrl(it.web) && <a href={webTeamUrl(it.web)!} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 text-brandDark">🌐 Su web</a>}
                      <button onClick={() => agregarPersonaGeneral(it, linkedinEmpresaUrl(it.nombre ?? '', ciudadDe(it)))} className="text-[11px] font-semibold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 px-2.5 py-1.5">＋ guardar contacto</button>
                    </div>
                    {/* Por cargo puntual (opcional, plegado) */}
                    <details className="mt-1">
                      <summary className="text-[10px] text-indigo-700 cursor-pointer select-none">🎯 Buscar por cargo puntual (opcional)</summary>
                      <div className="mt-1.5 space-y-1.5">
                        {CARGOS.map((cat) => (
                          <div key={cat.id} className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-medium w-36 shrink-0">{cat.emoji} {cat.label}</span>
                            <a href={linkedinSearchUrl(it.nombre ?? '', cat, ciudadDe(it))} target="_blank" rel="noreferrer" className="text-[10px] rounded border border-black/10 px-2 py-1 text-brandDark">in</a>
                            <a href={googleLinkedinUrl(it.nombre ?? '', cat, ciudadDe(it))} target="_blank" rel="noreferrer" className="text-[10px] rounded border border-black/10 px-2 py-1 text-brandDark">G·in</a>
                            <a href={googleWebUrl(it.nombre ?? '', cat, ciudadDe(it))} target="_blank" rel="noreferrer" className="text-[10px] rounded border border-black/10 px-2 py-1 text-brandDark">G</a>
                            <button onClick={() => agregarPersona(it, cat, linkedinSearchUrl(it.nombre ?? '', cat, ciudadDe(it)))} className="text-[10px] rounded border border-emerald-300 text-emerald-700 px-2 py-1">＋ guardar</button>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => copiar(it)} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">{copiado === it.id ? <Check size={13} /> : <Copy size={13} />}{copiado === it.id ? 'Copiado' : 'Copiar'}</button>
                {it.telefono && (
                  <a href={waLink(it)} target="_blank" rel="noreferrer" onClick={() => { if (it.estado === 'nuevo') marcarEnviado(it) }}
                     className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 flex items-center gap-1"><Send size={13} />WhatsApp</a>
                )}
                {it.instagram && <a href={it.instagram} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">📷 IG</a>}
                {it.web && <a href={it.web} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">🌐 Web</a>}
                {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark"><ExternalLink size={13} />{it.url.includes('maps') ? 'Maps' : 'Perfil'}</a>}
                {it.estado === 'nuevo' && (
                  <>
                    <button onClick={() => marcarEnviado(it)} className="text-[11px] font-semibold rounded-lg bg-brand text-white px-2.5 py-1.5 flex items-center gap-1"><Send size={13} />Marqué enviado</button>
                    <button onClick={() => setEstado(it, 'descartado')} className="text-[11px] font-medium rounded-lg border border-red-200 text-red-600 px-2 py-1.5 flex items-center gap-1"><Trash2 size={12} />Descartar</button>
                  </>
                )}
                {it.estado === 'enviado' && (
                  <>
                    <button onClick={() => setEstado(it, 'respondio')} className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5">Respondió →</button>
                    {it.proximo_toque && <span className="text-[10px] text-faint self-center">Seguimiento: {it.proximo_toque}</span>}
                  </>
                )}
                {['respondio', 'whatsapp'].includes(it.estado) && (
                  <button onClick={() => setEstado(it, 'cerrado')} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 text-brandDark">Marcar cerrado</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint text-center">Los que responden pasan a WhatsApp, donde IRIS cotiza. Límite sugerido: ~20-30 envíos por día y por cuenta.</p>
    </div>
  )
}
