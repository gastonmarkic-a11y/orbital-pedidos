import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Copy, Check, ExternalLink, Send, Plus, Trash2 } from 'lucide-react'
import { RUBROS, mensajePara } from '../../lib/guiones'
import { CARGOS, linkedinSearchUrl, googleLinkedinUrl, googleWebUrl, webTeamUrl, linkedinEmpresaUrl, googleEmpresaUrl, parseLinkedinContactos, type CargoCat } from '../../lib/cargos'
import { NOMBRE_OPERADOR } from '../../lib/operadores'

// Primer nombre "presentable" del lead (saca títulos y puntuación de la respuesta del formulario).
function primerNombre(n?: string | null): string {
  const limpio = (n || '').replace(/[^\p{L}\s]/gu, ' ').trim()
  const titulos = new Set(['lic', 'dr', 'dra', 'sr', 'sra', 'prof', 'ing'])
  const w = limpio.split(/\s+/).find((x) => x && !titulos.has(x.toLowerCase())) || ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
}
// Primera respuesta para leads de Meta: la óptica vio el video de Triple Protección y dejó sus datos.
function mensajeMetaLead(nombre: string | null, operador: string): string {
  const n = primerNombre(nombre)
  return `Hola${n ? ' ' + n : ''}, ¿cómo estás? Soy ${operador}, de Orbital.\n\n`
    + `Vi que te interesaste en nuestra marca y quería escribirte para conocerte un poco y saber qué estás buscando.\n\n`
    + `Estoy seguro de que tenemos una propuesta que puede ayudarte a diferenciarte con tus clientes. En un mercado con cada vez más marcas y opciones, Orbital no solo te ofrece una marca instalada y posicionada, sino también un producto realmente diferencial: la única línea de anteojos de sol en el mercado argentino con Triple Protección (UV400 + Infrarrojo + Blue Cut).\n\n`
    + `Más info: https://ver.orbitaleyewear.com.ar/tripleproteccion\n\n`
    + `La idea es que tengas algo distinto para ofrecer y una herramienta concreta para diferenciarte de tu competencia.\n\n`
    + `Contame un poco de ustedes, ¿cómo se llama la óptica y en qué zona están?\n\n`
    + `Si te parece, después coordinamos una llamada corta y te cuento más. Estoy seguro de que podemos hacer algo muy bueno juntos.`
}

interface LkRow { id: number; nombre: string; cargo: string | null; empresa: string | null; ubicacion: string | null; estado: string }

interface Persona { id: number; empresa_id: number; nombre: string | null; cargo: string | null; categoria: string | null; relevance_score: number | null; linkedin_url: string | null; estado: string }

// Cola de prospección social: cada contacto con su mensaje ya armado y un botón para marcar enviado.
// El sistema arma el mensaje; la persona copia, abre el perfil y envía (2 clics), y queda todo registrado.

interface Item {
  id: number; canal: 'ig' | 'linkedin' | 'meta_b2b'; nombre: string | null; perfil: string | null; url: string | null
  rubro: string | null; zona: string | null; mensaje: string | null; estado: string
  operador: string | null; proximo_toque: string | null; nota: string | null; created_at: string; enviado_at: string | null
  telefono: string | null; web: string | null; instagram: string | null; email: string | null; etapa: string
  cod_cliente: string | null
}

// Embudo PECA: etapas + cadencia (días hasta el próximo toque al avanzar).
const EMBUDO: { id: string; label: string; emoji: string; c: string; dias: number }[] = [
  { id: 'presentacion', label: 'Presentación', emoji: '1️⃣', c: 'bg-slate-100 text-slate-700', dias: 3 },
  { id: 'interaccion', label: 'Interacción', emoji: '2️⃣', c: 'bg-sky-100 text-sky-700', dias: 2 },
  { id: 'evaluacion', label: 'Evaluación', emoji: '3️⃣', c: 'bg-amber-100 text-amber-700', dias: 3 },
  { id: 'conversion', label: 'Conversión', emoji: '4️⃣', c: 'bg-orange-100 text-orange-700', dias: 2 },
  { id: 'cliente', label: 'Cliente', emoji: '✅', c: 'bg-emerald-100 text-emerald-700', dias: 30 },
]
const etapaIdx = (id: string) => Math.max(0, EMBUDO.findIndex((e) => e.id === id))

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
  const [fMeta, setFMeta] = useState(false)
  const [personas, setPersonas] = useState<Record<number, Persona[]>>({})
  const [buscarOpen, setBuscarOpen] = useState<Set<number>>(new Set())
  const [copiado, setCopiado] = useState<number | null>(null)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nv, setNv] = useState({ canal: 'ig' as 'ig' | 'linkedin', nombre: '', perfil: '', url: '', rubro: 'opticas', zona: '' })
  const [guardando, setGuardando] = useState(false)
  const [dcCiudad, setDcCiudad] = useState('')
  const [dcRubro, setDcRubro] = useState('opticas')
  const [dcLimite, setDcLimite] = useState(30)
  const [buscandoApify, setBuscandoApify] = useState(false)
  const [gastoApify, setGastoApify] = useState<number | null>(null)
  const [enriqueciendo, setEnriqueciendo] = useState(false)
  const [completando, setCompletando] = useState(false)
  const [fEtapa, setFEtapa] = useState('')
  const [campanaLista, setCampanaLista] = useState<Item[]>([])
  const [campanaIdx, setCampanaIdx] = useState(0)
  const [campanaOpen, setCampanaOpen] = useState(false)
  const [expandido, setExpandido] = useState<Set<number>>(new Set())
  const [ordenPrioridad, setOrdenPrioridad] = useState(true)
  const [lkOpen, setLkOpen] = useState(false)
  const [lkTexto, setLkTexto] = useState('')
  const [lkRows, setLkRows] = useState<LkRow[]>([])
  const [lkGuardando, setLkGuardando] = useState(false)
  const TOPE_APIFY = 4.5

  const nombreOperador = NOMBRE_OPERADOR[codigoEfectivo] ?? codigoEfectivo ?? 'Orbital'
  const msgDe = (it: Item) => it.canal === 'meta_b2b'
    ? mensajeMetaLead(it.nombre, nombreOperador)
    : it.mensaje ?? mensajePara(it.rubro ?? 'opticas', it.canal === 'linkedin' ? 'linkedin' : 'ig', it.nombre ?? undefined)
  // Link de WhatsApp con el mensaje ya cargado: 1 clic abre el chat listo para enviar.
  const waLink = (it: Item) => `https://wa.me/${(it.telefono ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(msgDe(it))}`

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

  // Robot GRATIS: entra a la web de las ópticas pendientes y trae email + WhatsApp + IG solo.
  async function traerContactos() {
    setEnriqueciendo(true)
    const { data, error } = await supabase.functions.invoke('enriquecer-web', { body: { limite: 40 } })
    setEnriqueciendo(false)
    const r = data as { procesados?: number; con_email?: number; error?: string; mensaje?: string } | null
    if (error || r?.error) { toast(r?.error ?? 'No se pudo', 'error'); return }
    if (r?.mensaje) { toast(r.mensaje, 'success'); return }
    toast(`🤖 ${r?.con_email ?? 0} emails nuevos de ${r?.procesados ?? 0} ópticas leídas`, 'success')
    cargar()
  }

  // Pegá lo copiado de LinkedIn → el sistema lo separa y lo guarda (vos copiás, no scrapea nada).
  async function procesarLinkedin() {
    const cs = parseLinkedinContactos(lkTexto)
    if (!cs.length) { toast('No encontré contactos. Copiá los resultados de LinkedIn (nombre + cargo) y pegalos.', 'error'); return }
    setLkGuardando(true)
    const { error } = await supabase.from('contacto_linkedin').insert(cs.map((c) => ({ ...c, operador: codigoEfectivo, estado: 'nuevo' })))
    setLkGuardando(false)
    if (error) { toast('No se pudo guardar', 'error'); return }
    toast(`✓ ${cs.length} contactos guardados en la base`, 'success')
    setLkTexto(''); cargarLk()
  }
  async function cargarLk() {
    const { data } = await supabase.from('contacto_linkedin').select('id, nombre, cargo, empresa, ubicacion, estado').neq('estado', 'descartado').order('created_at', { ascending: false }).limit(200)
    setLkRows((data as LkRow[]) ?? [])
  }
  async function descartarLk(id: number) {
    await supabase.from('contacto_linkedin').update({ estado: 'descartado' }).eq('id', id)
    setLkRows((prev) => prev.filter((x) => x.id !== id))
  }

  // UN botón: descubre las ópticas de la ciudad (gratis) y después el robot les completa el email.
  async function buscarYCompletar() {
    if (!dcCiudad.trim()) { toast('Poné una ciudad', 'error'); return }
    setCompletando(true)
    const { data: d1, error: e1 } = await supabase.functions.invoke('descubridor-social', { body: { ciudad: dcCiudad.trim(), rubro: dcRubro } })
    const r1 = d1 as { insertados?: number; duplicados?: number; error?: string } | null
    if (e1 || r1?.error) { setCompletando(false); toast(r1?.error ?? 'No se pudo buscar', 'error'); return }
    // El robot completa el email de las nuevas (y de cualquier pendiente).
    const { data: d2 } = await supabase.functions.invoke('enriquecer-web', { body: { limite: 40 } })
    const r2 = d2 as { con_email?: number } | null
    setCompletando(false)
    toast(`✓ ${r1?.insertados ?? 0} ópticas nuevas de ${dcCiudad} · ${r2?.con_email ?? 0} con email`, 'success')
    setDcCiudad(''); cargar()
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
  useEffect(() => { cargar(); cargarGasto(); cargarLk() }, [])

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

  function toggleExpandido(id: number) {
    setExpandido((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  // Fase 3 — puntaje simple para priorizar a quién contactar primero (más contacto = más prioridad).
  function scoreDe(it: Item): number {
    let s = 0
    if (it.telefono?.trim()) s += 40
    if (it.email?.trim()) s += 25
    if (it.web?.trim()) s += 15
    if (it.instagram?.trim()) s += 10
    if (it.rubro === 'opticas') s += 10
    if ((personas[it.id]?.length ?? 0) > 0) s += 15
    return s
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
    if (fMeta) base = base.filter((i) => i.canal === 'meta_b2b')
    if (fEtapa) base = base.filter((i) => (i.etapa || 'presentacion') === fEtapa)
    if (ordenPrioridad) base = [...base].sort((a, b) => scoreDe(b) - scoreDe(a))
    return base
  }, [items, filtro, fZona, fWa, fIg, fWeb, fMeta, fEtapa, ordenPrioridad, personas])

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

  // Registra el descubrimiento como prospecto real en el sistema (tabla clientes), a nombre del operador.
  const [registrando, setRegistrando] = useState<number | null>(null)
  async function registrar(it: Item) {
    if (it.cod_cliente) return
    if (!it.nombre?.trim()) { toast('Este contacto no tiene nombre para registrar', 'error'); return }
    if (!window.confirm(`¿Registrar "${it.nombre}" como prospecto en el sistema?\n\nQueda en tu cartera como prospecto de bienvenida.`)) return
    setRegistrando(it.id)
    const { data, error } = await supabase.rpc('prospeccion_social_a_cliente', { p_id: it.id, p_operador: codigoEfectivo })
    setRegistrando(null)
    const r = data as any
    if (error || !r?.ok) { toast(r?.error || 'No se pudo registrar', 'error'); return }
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, cod_cliente: r.cod, etapa: 'cliente' } : x)))
    toast(`✓ Registrado en el sistema (${r.cod})`, 'success')
  }

  // Campaña asistida: recorre las ópticas con WhatsApp sin enviar, de a una, 1 toque cada una.
  function iniciarCampana() {
    const lista = filtrados.filter((i) => i.telefono?.trim() && i.estado === 'nuevo')
    if (!lista.length) { toast('No hay ópticas con WhatsApp sin enviar en esta vista', 'error'); return }
    setCampanaLista(lista); setCampanaIdx(0); setCampanaOpen(true)
  }
  function siguienteCampana(nuevoIdx: number) {
    if (nuevoIdx >= campanaLista.length) { setCampanaOpen(false); toast('✓ Campaña terminada', 'success'); return }
    setCampanaIdx(nuevoIdx)
  }
  function campanaEnviar() {
    const it = campanaLista[campanaIdx]
    if (!it) return
    window.open(waLink(it), '_blank', 'noreferrer')
    marcarEnviado(it)
    siguienteCampana(campanaIdx + 1)
  }

  // Mueve la óptica de etapa del embudo y agenda el próximo toque según la cadencia PECA.
  async function moverEtapa(it: Item, etapaId: string) {
    const meta = EMBUDO.find((e) => e.id === etapaId)
    const px = meta ? hoyMas(meta.dias) : null
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, etapa: etapaId, proximo_toque: px } : x)))
    await supabase.from('prospeccion_social').update({ etapa: etapaId, proximo_toque: px }).eq('id', it.id)
  }

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

      {/* Buscar ópticas: UN botón hace todo (descubre + robot completa el email). */}
      <div className="bg-white rounded-2xl border border-black/10 p-3">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">🔎 Buscar ópticas por ciudad</p>
        <div className="flex flex-wrap gap-2">
          <input value={dcCiudad} onChange={(e) => setDcCiudad(e.target.value)} placeholder="Ciudad (ej: Mendoza, Santa Fe, San Juan)" className="flex-1 min-w-[160px] border border-black/10 rounded-lg px-3 py-2 text-sm" />
          <select value={dcRubro} onChange={(e) => setDcRubro(e.target.value)} className="border border-black/10 rounded-lg px-2 py-2 text-sm">
            {RUBROS.map((r) => <option key={r.id} value={r.id}>{r.emoji} {r.nombre}</option>)}
          </select>
          <button onClick={buscarYCompletar} disabled={completando} className="bg-ink text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{completando ? 'Buscando y completando…' : '🔎 Buscar ópticas'}</button>
        </div>
        <p className="text-[10px] text-faint mt-1.5">Un solo botón: busca las ópticas de esa ciudad <b>y les completa el email/WhatsApp solo</b>. Quedan en "A enviar". Es gratis.</p>

        {/* Más opciones (avanzado): Apify para traer más resultados. Usa crédito. */}
        <details className="mt-3 pt-3 border-t border-black/10">
          <summary className="text-[11px] text-muted cursor-pointer select-none flex items-center justify-between">
            <span>⚙️ ¿Pocos resultados? Traer más con Apify (usa crédito)</span>
            {gastoApify !== null && <span className={`text-[10px] font-medium ${gastoApify >= TOPE_APIFY ? 'text-red-600' : 'text-faint'}`}>crédito: ${gastoApify.toFixed(2)} / ${TOPE_APIFY.toFixed(2)}</span>}
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] text-muted flex items-center gap-1">
              Cantidad
              <input type="number" min={5} max={120} value={dcLimite} onChange={(e) => setDcLimite(Math.max(5, Math.min(120, Number(e.target.value) || 30)))} className="w-16 border border-black/10 rounded-lg px-2 py-2 text-sm" />
            </label>
            <span className="text-[10px] text-faint">≈ ${(dcLimite * 0.007).toFixed(2)}</span>
            <button onClick={() => buscarApify(false)} disabled={buscandoApify} className="bg-brandDark text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">{buscandoApify ? 'Buscando…' : 'Traer más con Apify'}</button>
            <button onClick={traerContactos} disabled={enriqueciendo} className="text-[11px] rounded-lg border border-emerald-300 text-emerald-700 px-2.5 py-2 font-medium disabled:opacity-50">{enriqueciendo ? 'Leyendo…' : '🤖 Reintentar emails'}</button>
          </div>
          <p className="text-[10px] text-faint mt-1.5">Apify trae más lugares (hasta 120) usando el crédito gratis ~$5/mes. El robot de emails igual corre solo cada hora.</p>
        </details>
      </div>

      {/* Pegar contactos de LinkedIn: vos copiás los resultados, el sistema los ordena y guarda (no scrapea). */}
      <div className="bg-white rounded-2xl border border-black/10 p-3">
        <button onClick={() => setLkOpen((v) => !v)} className="w-full flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">📋 Pegar contactos de LinkedIn{lkRows.length ? ` · ${lkRows.length} en la base` : ''}</span>
          <span className="text-[11px] text-faint">{lkOpen ? '▲' : '▼'}</span>
        </button>
        {lkOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-muted">Buscá las ópticas en LinkedIn, <b>seleccioná los resultados y copiálos</b> (Ctrl+C), y pegá acá. El sistema separa nombre · cargo · empresa solo. <span className="text-faint">No entra a LinkedIn ni scrapea: solo ordena lo que copiaste.</span></p>
            <textarea value={lkTexto} onChange={(e) => setLkTexto(e.target.value)} rows={5} placeholder={'Pegá acá lo copiado de LinkedIn, ej:\nHernan Gabriel Staszczuk • 2º\nJefe de logística en Ópticas LAM\nBuenos Aires y alrededores'} className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm font-mono" />
            <button onClick={procesarLinkedin} disabled={lkGuardando || !lkTexto.trim()} className="bg-[#0a66c2] text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50">{lkGuardando ? 'Guardando…' : 'Procesar y guardar'}</button>
            {lkRows.length > 0 && (
              <div className="mt-1 border-t border-black/10 pt-2 space-y-1 max-h-72 overflow-y-auto">
                {lkRows.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-2 text-[12px]">
                    <div>
                      <b>{c.nombre}</b>
                      {c.cargo && <span className="text-muted"> · {c.cargo}</span>}
                      {c.empresa && <span className="text-brandDark"> · {c.empresa}</span>}
                      {c.ubicacion && <span className="text-faint"> · {c.ubicacion}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/in "${c.nombre}" ${c.empresa ?? ''}`)}`} target="_blank" rel="noreferrer" className="text-[10px] rounded border border-black/10 px-1.5 py-0.5 text-brandDark">buscar</a>
                      <button onClick={() => descartarLk(c.id)} className="text-red-400 font-bold">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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

      {/* Embudo PECA: cuántas ópticas en cada etapa (tocá para filtrar) */}
      <div className="bg-white rounded-2xl border border-black/10 p-2.5">
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">🎯 Embudo</p>
        <div className="grid grid-cols-5 gap-1.5">
          {EMBUDO.map((e) => {
            const n = items.filter((i) => i.estado !== 'descartado' && (i.etapa || 'presentacion') === e.id).length
            const activo = fEtapa === e.id
            return (
              <button key={e.id} onClick={() => setFEtapa(activo ? '' : e.id)}
                className={`rounded-xl px-1.5 py-2 text-center border transition-colors ${activo ? 'border-ink ring-1 ring-ink' : 'border-black/10'} ${e.c}`}>
                <div className="text-base font-bold leading-none">{n}</div>
                <div className="text-[9px] font-medium mt-1 leading-tight">{e.emoji} {e.label}</div>
              </button>
            )
          })}
        </div>
        {fEtapa && <button onClick={() => setFEtapa('')} className="text-[10px] text-brandDark mt-1.5">✕ Ver todas las etapas</button>}
      </div>

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
        <button onClick={() => setFMeta(!fMeta)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${fMeta ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-white border-fuchsia-300 text-fuchsia-700'}`}>📣 Meta ({items.filter((i) => i.canal === 'meta_b2b' && i.estado !== 'descartado').length})</button>
        <button onClick={() => setOrdenPrioridad(!ordenPrioridad)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${ordenPrioridad ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-black/10 text-muted'}`}>🔝 Prioridad</button>
        <button onClick={iniciarCampana} className="shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-semibold bg-brand text-white border-brand">📣 Enviar campaña</button>
        <span className="text-[11px] text-faint ml-auto shrink-0">{filtrados.length} contactos</span>
      </div>

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : filtrados.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Sin contactos en esta vista. Agregá targets o esperá al descubridor.</div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((it) => (
            <div key={it.id} className={`rounded-2xl border p-3 space-y-2 ${it.canal === 'meta_b2b' ? 'bg-fuchsia-50/50 border-fuchsia-200 border-l-4 border-l-fuchsia-500' : 'bg-white border-black/10'}`}>
              <button onClick={() => toggleExpandido(it.id)} className="w-full flex items-center justify-between gap-2 text-left">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{it.canal === 'ig' ? '📷' : it.canal === 'meta_b2b' ? '📣' : '💼'} {it.nombre || it.perfil}</p>
                  <p className="text-[10px] text-faint">{[it.perfil && it.nombre ? it.perfil : null, rubroLabel(it.rubro), it.zona].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {it.canal === 'meta_b2b' && <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-fuchsia-100 text-fuchsia-700">Meta</span>}
                  {ordenPrioridad && <span className="text-[10px] font-bold text-amber-600" title="prioridad">{scoreDe(it)}</span>}
                  <span className="text-[11px] tracking-tight">{it.telefono ? '📲' : ''}{it.email ? '✉️' : ''}{it.instagram ? '📷' : ''}{it.web ? '🌐' : ''}</span>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${ESTADOS[it.estado]?.c ?? 'bg-black/5'}`}>{ESTADOS[it.estado]?.t ?? it.estado}</span>
                  <span className="text-faint text-[11px]">{expandido.has(it.id) ? '▲' : '▼'}</span>
                </div>
              </button>
              {expandido.has(it.id) && (<>
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

              <div className="flex items-center gap-1 flex-wrap bg-[#F6F4EF] rounded-lg px-2 py-1.5">
                <span className="text-[10px] text-faint mr-0.5">Etapa:</span>
                {EMBUDO.map((e) => (
                  <button key={e.id} onClick={() => moverEtapa(it, e.id)} title={e.label}
                    className={`text-[11px] rounded px-1.5 py-1 border ${(it.etapa || 'presentacion') === e.id ? `${e.c} border-transparent font-bold` : 'border-black/10 text-muted'}`}>{e.emoji}</button>
                ))}
                <span className="text-[10px] text-muted ml-1">{EMBUDO[etapaIdx(it.etapa || 'presentacion')].label}{it.proximo_toque ? ` · próx. ${it.proximo_toque}` : ''}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {it.cod_cliente ? (
                  <span className="text-[11px] font-semibold rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1.5 flex items-center gap-1"><Check size={13} />En el sistema · {it.cod_cliente}</span>
                ) : (
                  <button onClick={() => registrar(it)} disabled={registrando === it.id}
                    className="text-[11px] font-semibold rounded-lg bg-brandDark text-white px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50">
                    {registrando === it.id ? 'Registrando…' : '➕ Registrar en el sistema'}
                  </button>
                )}
                <button onClick={() => copiar(it)} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">{copiado === it.id ? <Check size={13} /> : <Copy size={13} />}{copiado === it.id ? 'Copiado' : 'Copiar'}</button>
                {it.telefono && (
                  <a href={waLink(it)} target="_blank" rel="noreferrer" onClick={() => { if (it.estado === 'nuevo') marcarEnviado(it) }}
                     className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5 flex items-center gap-1"><Send size={13} />WhatsApp</a>
                )}
                {it.email && <a href={`mailto:${it.email}`} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">✉️ {it.email}</a>}
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
              </>)}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint text-center">Los que responden pasan a WhatsApp, donde IRIS cotiza. Límite sugerido: ~20-30 envíos por día y por cuenta.</p>

      {/* Modo campaña: enviar de a una, 1 toque cada óptica */}
      {campanaOpen && campanaLista[campanaIdx] && (() => {
        const it = campanaLista[campanaIdx]
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-3" onClick={() => setCampanaOpen(false)}>
            <div className="bg-white rounded-2xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-brand uppercase tracking-wide">📣 Campaña · {campanaIdx + 1} de {campanaLista.length}</p>
                <button onClick={() => setCampanaOpen(false)} className="text-muted text-lg leading-none">✕</button>
              </div>
              <div className="h-1.5 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-brand" style={{ width: `${(campanaIdx / campanaLista.length) * 100}%` }} /></div>
              <div>
                <p className="text-sm font-semibold">{it.nombre}</p>
                <p className="text-[11px] text-faint">{[rubroLabel(it.rubro), it.zona].filter(Boolean).join(' · ')} · 📲 {it.telefono}</p>
              </div>
              <p className="text-[12px] text-muted bg-[#F6F4EF] rounded-lg p-2.5 whitespace-pre-wrap max-h-52 overflow-y-auto">{msgDe(it)}</p>
              <div className="flex gap-2">
                <button onClick={() => siguienteCampana(campanaIdx + 1)} className="flex-1 rounded-lg border border-black/10 py-2.5 text-sm font-medium text-muted">Saltar →</button>
                <button onClick={campanaEnviar} className="flex-[2] rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold flex items-center justify-center gap-1"><Send size={15} />Enviar por WhatsApp</button>
              </div>
              <p className="text-[10px] text-faint text-center">Se abre WhatsApp con el mensaje puesto, se marca enviada y pasa a la siguiente. Mandá ~20-30 por día para cuidar el número.</p>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
