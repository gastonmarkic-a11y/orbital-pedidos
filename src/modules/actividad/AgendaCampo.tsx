import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Phone, ChevronDown, ChevronRight, Navigation, Plane, CalendarClock, X, ClipboardCheck, GripVertical, History, Flame, Sparkles, Trash2, Send } from 'lucide-react'
import DrillClientes, { DrillRow } from './DrillClientes'

// Agenda de CAMPO (Martín / Adrián): recorrido diario en Buenos Aires + GBA de sus
// clientes de canje + a recuperar (7 propios/día por zona) + los 5 turnos de prospección.
// Cada día es un bloque: se puede POSPONER el día completo (mover en bloque al final).
// El interior queda encapsulado aparte (viajes).

interface Row {
  dia_num: number; orden_en_dia: number; bloque: string; cohorte: string
  region: string | null; localidad: string | null; provincia: string | null; cod: string
  nombre: string | null; direccion: string | null; telefono: string | null; visitado: boolean; resultado: string | null; unidades: number
}
const RESULTADOS: Record<string, string> = { vendio: '🟢 Vendió', visito: '🔵 Visité', no_estaba: '🟠 No estaba', reagendar: '🟣 Reagendar' }

// Potencial por volumen histórico de compra: 🔥 rojo >200 · naranja 100-200 · azul 50-100
function fuegoDe(u: number): { color: string; tier: string } | null {
  if (u > 200) return { color: '#16a34a', tier: 'rojo' }
  if (u >= 100) return { color: '#ea580c', tier: 'naranja' }
  if (u >= 50) return { color: '#2563eb', tier: 'azul' }
  return null
}
function Fuego({ u }: { u: number }) {
  const f = fuegoDe(u); if (!f) return null
  return <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 inline-flex items-center gap-0.5" style={{ background: f.color + '1a', color: f.color }}><Flame size={11} color={f.color} fill={f.color} /> {u}</span>
}
// Conteo de fuegos con el ícono en color (rojo/naranja/azul), sin texto
function FuegosMini({ rojo, naranja, azul }: { rojo: number; naranja: number; azul: number }) {
  const items: [number, string][] = [[rojo, '#16a34a'], [naranja, '#ea580c'], [azul, '#2563eb']]
  return <>{items.filter(([n]) => n > 0).map(([n, c], i) => (
    <span key={i} className="inline-flex items-center gap-0.5 font-bold" style={{ color: c }}><Flame size={12} color={c} fill={c} />{n}</span>
  ))}</>
}

// La agenda corre a partir de una fecha FIJA (11/8/2026). El día N es el N-ésimo día hábil
// desde ese inicio; la etiqueta se calcula relativa a HOY real (Hoy / Mañana / DíaSem d/m).
const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const INICIO_AGENDA: [number, number, number] = [2026, 7, 11] // 11/8/2026
function sumarHabiles(base: Date, k: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const paso = k >= 0 ? 1 : -1
  let rem = Math.abs(k)
  while (rem > 0) { d.setDate(d.getDate() + paso); if (d.getDay() !== 0 && d.getDay() !== 6) rem-- }
  return d
}
function fechaDeDia(n: number): Date {
  const b = new Date(INICIO_AGENDA[0], INICIO_AGENDA[1], INICIO_AGENDA[2])
  while (b.getDay() === 0 || b.getDay() === 6) b.setDate(b.getDate() + 1)
  return sumarHabiles(b, n - 1)
}
function hoy0(): Date { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function mismaFecha(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
const labelDia = (n: number) => {
  const f = fechaDeDia(n)
  const fmt = `${DIAS_SEM[f.getDay()]} ${f.getDate()}/${f.getMonth() + 1}`
  const h = hoy0(); const man = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  if (mismaFecha(f, h)) return `Hoy · ${fmt}`
  if (mismaFecha(f, man)) return `Mañana · ${fmt}`
  return fmt
}
interface Turno { id: number; vendedor: string; dia_num: number; cliente: string; telefono: string | null; localidad: string | null; cargado_por: string | null; nota: string | null; estado: string }
interface Bienv { cod: string; nombre: string | null; direccion: string | null; telefono: string | null; zona: string | null; dist: number | null }
interface Evento { id: number; dia_num: number; hora: string | null; lugar: string | null; cliente: string | null; nota: string | null }

const VEND = [{ cod: 'Adrian', label: 'Adrián' }, { cod: 'Martin', label: 'Martín' }]
const META_DIA = 12 // visitas objetivo por día (propios + prospección)
const soloDigitos = (t: string | null) => (t ? t.replace(/\D/g, '') : '')
const waLink = (t: string | null) => { const d = soloDigitos(t); return d ? `https://wa.me/${d.length <= 10 ? '54' + d : d}` : null }
const mapsLink = (dir: string | null, loc: string | null) => {
  const q = [dir, loc].filter(Boolean).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + ', Argentina')}` : null
}

function CohorteChip({ c }: { c: string }) {
  const canje = c === 'canje'
  return <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${canje ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{canje ? 'Canje' : 'A recuperar'}</span>
}

function ClienteCard({ r, onRegistrar, onHistorial }: { r: Row; onRegistrar: (r: Row) => void; onHistorial: (r: Row) => void }) {
  const wa = waLink(r.telefono)
  const maps = mapsLink(r.direccion, r.localidad)
  return (
    <div className={`bg-white rounded-xl border p-3 transition ${r.visitado ? 'border-emerald-200' : 'border-black/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${r.visitado ? 'text-muted' : 'text-ink'}`}>{r.nombre}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <CohorteChip c={r.cohorte} />
            <Fuego u={r.unidades} />
            {r.localidad && <span className="text-[10px] text-faint">{r.localidad}</span>}
            {r.visitado && <span className="text-[10px] font-medium text-emerald-700">{RESULTADOS[r.resultado ?? ''] ?? '✓ visitado'}</span>}
          </div>
          {r.direccion && <p className="text-[11px] text-muted mt-1 truncate">{r.direccion}</p>}
        </div>
      </div>
      <div className="flex gap-2 mt-2">
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-emerald-700">WhatsApp</a>}
        {r.telefono && <a href={`tel:${r.telefono}`} className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-ink flex items-center justify-center gap-1"><Phone size={12} />Llamar</a>}
        {maps && <a href={maps} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-brandDark flex items-center justify-center gap-1"><Navigation size={12} />Ruta</a>}
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={() => onRegistrar(r)} className={`flex-1 rounded-lg py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5 ${r.visitado ? 'border border-black/10 text-muted' : 'bg-ink text-white'}`}>
          <ClipboardCheck size={14} />{r.visitado ? 'Editar visita' : 'Registrar visita'}
        </button>
        <button onClick={() => onHistorial(r)} title="Historial de contactos" className="shrink-0 rounded-lg py-2 px-3 text-[12px] font-medium border border-black/10 text-brandDark flex items-center gap-1"><History size={14} />Historial</button>
      </div>
    </div>
  )
}

// Registro de visita (check-in + resultado + nota + próxima agenda), tipo Cartera.
function VisitaModal({ r, vendedor, onClose, onSaved, onCargarPedido }: {
  r: Row; vendedor: string; onClose: () => void; onSaved: (cod: string, resultado: string) => void; onCargarPedido: () => void
}) {
  const [resultado, setResultado] = useState<string>(r.resultado ?? 'visito')
  const [nota, setNota] = useState('')
  const [prox, setProx] = useState('')
  const [fecha, setFecha] = useState('')
  const [monto, setMonto] = useState('')
  const [uni, setUni] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    const hoy = new Date().toISOString().slice(0, 10)
    const vendio = resultado === 'vendio'
    await supabase.from('actividad_diaria').insert({
      fecha: hoy, vendedor, cod_cliente: r.cod, nombre_comercio: r.nombre,
      telefono: r.telefono, localidad: r.localidad, direccion: r.direccion,
      origen: 'agenda_campo', resultado_contacto: resultado,
      actividad_desarrollo: nota || RESULTADOS[resultado] || 'Visita de campo',
      actividad_futura: prox || null, proximo_paso_fecha: fecha || null,
      unidades_vendidas: vendio && uni ? Number(uni) : null,
      monto_vendido: vendio && monto ? Number(monto) : null,
    })
    await supabase.from('agenda_campo').update({ visitado: true, resultado }).eq('vendedor', vendedor).eq('cod_cliente', r.cod)
    setGuardando(false)
    onSaved(r.cod, resultado)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <div><h2 className="text-base font-bold truncate">{r.nombre}</h2><p className="text-[11px] text-faint">Registrar visita</p></div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted">Resultado</label>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              {Object.entries(RESULTADOS).map(([k, lbl]) => (
                <button key={k} onClick={() => setResultado(k)} className={`text-[12px] rounded-lg py-2 border font-medium ${resultado === k ? 'bg-ink text-white border-ink' : 'border-black/10 text-muted'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          {resultado === 'vendio' && (
            <>
              <button onClick={onCargarPedido} className="w-full bg-brand text-white rounded-lg py-2.5 text-sm font-medium">Cargar pedido →</button>
              <div className="grid grid-cols-2 gap-2">
                <input value={uni} onChange={(e) => setUni(e.target.value)} inputMode="numeric" placeholder="Unidades" className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
                <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="numeric" placeholder="Monto $" className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
            </>
          )}
          <div>
            <label className="text-[11px] font-medium text-muted">Nota de la visita</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" placeholder="Qué pasó, qué mostró, objeciones…" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted">Próxima agenda</label>
            <div className="flex gap-2 mt-1">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input value={prox} onChange={(e) => setProx(e.target.value)} placeholder="Próximo paso" className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
          </div>
          <button onClick={guardar} disabled={guardando} className="w-full bg-ink text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar visita'}</button>
        </div>
      </div>
    </div>
  )
}

// Historial de contactos + qué se le envió (sin salir de la agenda)
interface Act { id: number; fecha: string | null; vendedor: string | null; resultado_contacto: string | null; actividad_desarrollo: string | null; actividad_futura: string | null; proximo_paso_fecha: string | null; nota_contexto: string | null; monto_vendido: number | null; unidades_vendidas: number | null }
function HistorialModal({ r, onClose }: { r: Row; onClose: () => void }) {
  const [items, setItems] = useState<Act[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.from('actividad_diaria')
      .select('id,fecha,vendedor,resultado_contacto,actividad_desarrollo,actividad_futura,proximo_paso_fecha,nota_contexto,monto_vendido,unidades_vendidas')
      .eq('cod_cliente', r.cod).order('fecha', { ascending: false }).limit(60)
      .then(({ data }) => { setItems((data as Act[]) ?? []); setLoading(false) })
  }, [r.cod])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <div><h2 className="text-base font-bold truncate">{r.nombre}</h2><p className="text-[11px] text-faint">Historial de contactos y envíos</p></div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        <div className="p-3 space-y-2">
          {loading ? <p className="text-sm text-muted p-4 text-center">Cargando…</p> : items.length === 0 ? (
            <p className="text-sm text-faint text-center py-8">Sin contactos registrados todavía.</p>
          ) : items.map((a) => (
            <div key={a.id} className="bg-[#F6F4EF] rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold">{a.fecha}</span>
                <span className="text-[10px] text-faint">{a.vendedor ? (NOMBRE_OP[a.vendedor] || a.vendedor) : ''}{a.resultado_contacto ? ` · ${RESULTADOS[a.resultado_contacto] ?? a.resultado_contacto}` : ''}</span>
              </div>
              {a.actividad_desarrollo && <p className="text-[12px] mt-1">{a.actividad_desarrollo}</p>}
              {(a.monto_vendido || a.unidades_vendidas) ? <p className="text-[11px] text-emerald-700 mt-0.5">🟢 {a.unidades_vendidas ?? 0} u · {a.monto_vendido ? '$' + Math.round(a.monto_vendido).toLocaleString('es-AR') : ''}</p> : null}
              {a.actividad_futura && <p className="text-[11px] text-brandDark mt-0.5">→ {a.actividad_futura}{a.proximo_paso_fecha ? ` (${a.proximo_paso_fecha})` : ''}</p>}
              {a.nota_contexto && <p className="text-[11px] text-muted mt-0.5 italic">{a.nota_contexto}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
const NOMBRE_OP: Record<string, string> = { Marketing: 'Luna', ProspeccionVenta: 'Damián', Damian: 'Damián', Adrian: 'Adrián', Martin: 'Martín', Corporativo: 'Corporativo' }

// Asistente IA: reacomoda la agenda del vendedor por un pedido en lenguaje natural.
function AjusteIAAgenda({ ven, onAplicado }: { ven: string; onAplicado: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [msg, setMsg] = useState('')
  const [hist, setHist] = useState<{ role: string; content: string }[]>([])
  const [enviando, setEnviando] = useState(false)
  const [aplicado, setAplicado] = useState<string[]>([])

  async function enviar() {
    const texto = msg.trim(); if (!texto || enviando) return
    setEnviando(true); setMsg(''); setAplicado([])
    const nuevoHist = [...hist, { role: 'user', content: texto }]
    setHist(nuevoHist)
    try {
      const { data } = await supabase.functions.invoke('agenda-ajuste-ia', { body: { vendedor: ven, mensaje: texto, historial: hist } })
      const r = data as { reply?: string; aplicado?: string[] } | null
      setHist([...nuevoHist, { role: 'assistant', content: r?.reply ?? 'Listo.' }])
      const apl = r?.aplicado ?? []
      setAplicado(apl)
      if (apl.length) onAplicado()
    } catch { setHist([...nuevoHist, { role: 'assistant', content: 'No pude procesar el pedido, probá de nuevo.' }]) }
    setEnviando(false)
  }

  return (
    <div className="bg-gradient-to-br from-brand/10 to-white border border-brand/30 rounded-2xl overflow-hidden">
      <button onClick={() => setAbierto((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Sparkles size={18} className="text-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brandDark">Ajuste IA de agenda</p>
          <p className="text-[11px] text-muted truncate">Pedile reacomodar el día por una reunión, turno o imprevisto</p>
        </div>
        <ChevronDown size={18} className={`text-faint transition ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="px-4 pb-4 space-y-2">
          {hist.length > 0 && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {hist.map((m, i) => (
                <div key={i} className={`text-[13px] rounded-lg px-3 py-2 ${m.role === 'user' ? 'bg-ink text-white ml-8' : 'bg-white border border-black/10 mr-8'}`}>{m.content}</div>
              ))}
              {aplicado.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mr-8 text-[12px] text-emerald-800 space-y-0.5">
                  {aplicado.map((a, i) => <div key={i}>{a}</div>)}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') enviar() }}
              placeholder="Ej: el miércoles 13 tengo reunión 10hs en Haedo, reacomodá"
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            <button onClick={enviar} disabled={enviando} className="shrink-0 bg-brand text-white rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1 disabled:opacity-50">
              <Send size={14} />{enviando ? '…' : 'Enviar'}
            </button>
          </div>
          <p className="text-[10px] text-faint">Ejemplos: "movéme el día 5 al 8" · "el jueves 14 tengo turno 15hs en Quilmes con Óptica X". Si algo no está claro, te pregunta.</p>
        </div>
      )}
    </div>
  )
}

export default function AgendaCampo() {
  const { codigoEfectivo } = useAuth()
  const navigate = useNavigate()
  const [ven, setVen] = useState<string>(codigoEfectivo === 'Martin' ? 'Martin' : 'Adrian')
  const [rows, setRows] = useState<Row[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [verInterior, setVerInterior] = useState(false)
  const [posponiendo, setPosponiendo] = useState<number | null>(null)
  const [visitar, setVisitar] = useState<Row | null>(null)
  const [histCli, setHistCli] = useState<Row | null>(null)
  const [dragDia, setDragDia] = useState<number | null>(null)
  const [salv, setSalv] = useState<Record<number, Bienv[]>>({})
  const [salvLoad, setSalvLoad] = useState<number | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])

  async function cargar() {
    setLoading(true)
    const [{ data: plan }, { data: tur }, { data: evs }] = await Promise.all([
      supabase.rpc('agenda_campo_plan', { p_vendedor: ven }),
      supabase.from('agenda_turnos').select('*').eq('vendedor', ven),
      supabase.from('agenda_eventos').select('*').eq('vendedor', ven).order('dia_num'),
    ])
    setRows((plan as Row[]) ?? [])
    setTurnos((tur as Turno[]) ?? [])
    setEventos((evs as Evento[]) ?? [])
    setLoading(false)
  }
  const eventosDe = (d: number) => eventos.filter((e) => e.dia_num === d)
  async function borrarEvento(id: number) { await supabase.from('agenda_eventos').delete().eq('id', id); cargar() }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [ven])

  const baGba = useMemo(() => rows.filter((r) => r.bloque === 'ba_gba'), [rows])
  const interior = useMemo(() => rows.filter((r) => r.bloque === 'interior'), [rows])
  const dias = useMemo(() => Array.from(new Set(baGba.map((r) => r.dia_num))).sort((a, b) => a - b), [baGba])
  const hoy = useMemo(() => dias.find((d) => baGba.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1, [dias, baGba])
  // abrir "hoy" por defecto cuando cargan los datos
  useEffect(() => { if (!loading && abierto === null) setAbierto(hoy) /* eslint-disable-next-line */ }, [loading, hoy])

  const totalPend = baGba.filter((r) => !r.visitado).length

  function onVisitaSaved(cod: string, resultado: string) {
    setRows((rs) => rs.map((r) => (r.cod === cod ? { ...r, visitado: true, resultado } : r)))
    setVisitar(null)
  }
  async function posponer(dia: number) {
    setPosponiendo(dia)
    await supabase.rpc('posponer_dia_campo', { p_vendedor: ven, p_dia: dia })
    await cargar()
    setPosponiendo(null)
    setAbierto(null)
  }
  async function moverDia(desde: number, hasta: number) {
    if (desde === hasta) return
    await supabase.rpc('mover_dia_campo', { p_vendedor: ven, p_desde: desde, p_hasta: hasta })
    await cargar()
    setAbierto(null)
  }
  async function pedirBienvenida(d: number) {
    setSalvLoad(d)
    const { data } = await supabase.rpc('bienvenida_cerca', { p_vendedor: ven, p_dia: d, p_limit: 8 })
    setSalv((s) => ({ ...s, [d]: (data as Bienv[]) ?? [] }))
    setSalvLoad(null)
  }


  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Agenda de campo</h1>
          <p className="text-xs text-muted">Buenos Aires + GBA · canje y a recuperar · {dias.length} días · faltan {totalPend}</p>
        </div>
        <div className="flex gap-1 bg-white border border-black/10 rounded-lg p-0.5">
          {VEND.map((v) => (
            <button key={v.cod} onClick={() => { setVen(v.cod); setAbierto(null) }} className={`text-xs px-3 py-1.5 rounded-md font-medium ${ven === v.cod ? 'bg-brand text-white' : 'text-muted'}`}>{v.label}</button>
          ))}
        </div>
      </div>

      <AjusteIAAgenda ven={ven} onAplicado={cargar} />

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : dias.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">No hay plan de campo generado para {ven}.</p>
      ) : (
        <div className="space-y-2.5">
          {/* Resumen de performance del vendedor */}
          {(() => {
            const vis = baGba.filter((r) => r.visitado)
            const rc: Record<string, number> = { vendio: 0, visito: 0, no_estaba: 0, reagendar: 0 }
            vis.forEach((r) => { if (r.resultado && rc[r.resultado] != null) rc[r.resultado]++ })
            const conv = vis.length ? Math.round((rc.vendio / vis.length) * 100) : 0
            return (
              <div className="bg-ink text-white rounded-2xl p-4">
                <p className="text-[11px] uppercase tracking-wide text-white/60 mb-2">Tu performance de agenda</p>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-2 bg-white/15 rounded-full overflow-hidden"><div className="h-full bg-gold" style={{ width: `${baGba.length ? (vis.length / baGba.length) * 100 : 0}%` }} /></div>
                  <span className="text-sm font-bold">{vis.length}/{baGba.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full px-2 py-0.5 bg-emerald-500/20 text-emerald-300">🟢 {rc.vendio} vendió</span>
                  <span className="rounded-full px-2 py-0.5 bg-white/10">🔵 {rc.visito} visité</span>
                  <span className="rounded-full px-2 py-0.5 bg-white/10">🟠 {rc.no_estaba} no estaba</span>
                  <span className="rounded-full px-2 py-0.5 bg-white/10">🟣 {rc.reagendar} reagendar</span>
                  <span className="rounded-full px-2 py-0.5 bg-gold/20 text-gold">conv. {conv}%</span>
                </div>
              </div>
            )
          })()}
          {dias.map((d) => {
            const delDia = baGba.filter((r) => r.dia_num === d).sort((a, b) => a.orden_en_dia - b.orden_en_dia)
            const turnosDia = turnos.filter((t) => t.dia_num === d)
            const zona = Array.from(new Set(delDia.map((r) => r.localidad).filter(Boolean))).join(' · ')
            const hechos = delDia.filter((r) => r.visitado).length
            const completo = hechos === delDia.length
            const esHoy = d === hoy
            const open = abierto === d
            const canjeN = delDia.filter((r) => r.cohorte === 'canje').length
            const recupN = delDia.filter((r) => r.cohorte === 'recuperar').length
            const sugeridos = Math.max(0, META_DIA - delDia.length) // prospección sugerida para llegar a ~12/día
            const faltanPros = Math.max(0, sugeridos - turnosDia.length)
            const fuegos = { rojo: 0, naranja: 0, azul: 0 }
            delDia.forEach((r) => { const f = fuegoDe(r.unidades); if (f) fuegos[f.tier as 'rojo' | 'naranja' | 'azul']++ })
            const hayFuego = fuegos.rojo + fuegos.naranja + fuegos.azul > 0
            return (
              <div key={d}
                draggable
                onDragStart={() => setDragDia(d)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragDia) moverDia(dragDia, d); setDragDia(null) }}
                className={`rounded-2xl border overflow-hidden bg-white transition ${esHoy ? 'border-brand ring-1 ring-brand/20' : 'border-black/10'} ${dragDia === d ? 'opacity-40' : ''} ${dragDia && dragDia !== d ? 'border-dashed' : ''}`}>
                {/* Cabecera del día */}
                <button onClick={() => setAbierto(open ? null : d)} className="w-full text-left p-3.5 flex items-center justify-between gap-2">
                  <GripVertical size={16} className="text-faint shrink-0 cursor-grab" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${esHoy ? 'bg-ink text-white' : 'bg-black/5 text-muted'}`}>{labelDia(d)}</span>
                      {completo && <span className="text-[10px] text-emerald-600 font-medium">✓ completo</span>}
                    </div>
                    <p className="text-sm font-semibold mt-1 truncate">{zona || 'Zona'}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-black/5 text-muted">{delDia.length} clientes</span>
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700">{canjeN} canje</span>
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700">{recupN} recuperar</span>
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${faltanPros > 0 ? 'bg-[#8F6A34]/10 text-[#8F6A34]' : 'bg-emerald-100 text-emerald-700'}`}>{turnosDia.length}/{sugeridos} prospección</span>
                      {hayFuego && <span className="inline-flex items-center gap-1.5 text-[10px]"><FuegosMini {...fuegos} /></span>}
                      {eventosDe(d).length > 0 && <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-brand/15 text-brandDark inline-flex items-center gap-1"><CalendarClock size={11} />{eventosDe(d).length} turno{eventosDe(d).length === 1 ? '' : 's'} fijo{eventosDe(d).length === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                  {open ? <ChevronDown size={18} className="text-faint shrink-0" /> : <ChevronRight size={18} className="text-faint shrink-0" />}
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-3 border-t border-black/5 pt-3">
                    {/* Eventos fijos (reuniones/turnos puestos por el Ajuste IA) */}
                    {eventosDe(d).map((e) => (
                      <div key={e.id} className="flex items-start gap-2 bg-brand/5 border border-brand/20 rounded-xl p-2.5">
                        <CalendarClock size={15} className="text-brand shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1 text-[12px]">
                          <p className="font-semibold text-brandDark">{[e.hora, e.lugar].filter(Boolean).join(' · ') || 'Turno fijo'}</p>
                          {(e.cliente || e.nota) && <p className="text-muted">{[e.cliente, e.nota].filter(Boolean).join(' — ')}</p>}
                        </div>
                        <button onClick={() => borrarEvento(e.id)} className="shrink-0 text-faint hover:text-red-600 p-1"><Trash2 size={14} /></button>
                      </div>
                    ))}
                    {/* Mover el día en bloque */}
                    <button onClick={() => posponer(d)} disabled={posponiendo === d}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-brandDark border border-dashed border-brand/40 rounded-lg py-2 disabled:opacity-50">
                      <CalendarClock size={13} />{posponiendo === d ? 'Moviendo…' : 'Posponer este día (mover el bloque al final)'}
                    </button>

                    {/* Clientes propios */}
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Clientes de la zona ({delDia.length})</p>
                      <div className="text-[11px] text-brandDark bg-brand/5 rounded-lg px-2.5 py-2 space-y-0.5">
                        <p className="inline-flex items-center gap-1.5 flex-wrap"><b>Resumen del día:</b> {delDia.length} visitas · {canjeN} canje · {recupN} recuperar {hayFuego && <FuegosMini {...fuegos} />}</p>
                        {delDia.length > 1 && <p>🧭 Empezá por <b>{delDia[0].nombre}</b> · terminá en <b>{delDia[delDia.length - 1].nombre}</b></p>}
                        <p className="text-faint">Potencial del día: {delDia.reduce((s, r) => s + (r.unidades || 0), 0)} unidades históricas.</p>
                      </div>
                      {delDia.map((r) => <ClienteCard key={r.cod} r={r} onRegistrar={setVisitar} onHistorial={setHistCli} />)}
                    </div>

                    {/* Prospección */}
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">
                        Prospección ({turnosDia.length}/{sugeridos}) <span className="text-[10px] font-normal text-faint normal-case">— {ven === 'Adrian' ? 'Luna' : 'Damián'} · "va a pasar el vendedor"</span>
                      </p>
                      {turnosDia.length === 0 ? (
                        <p className="text-[11px] text-faint bg-[#F6F4EF] rounded-xl border border-dashed border-black/15 p-3">Faltan <b>{sugeridos}</b> turnos para llegar a {META_DIA} visitas del día. {ven === 'Adrian' ? 'Luna' : 'Damián'} los carga 2 días antes en esta zona.</p>
                      ) : turnosDia.map((t) => (
                        <div key={t.id} className="bg-[#F6F4EF] rounded-xl border border-black/10 p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{t.cliente}</p>
                            <p className="text-[11px] text-faint">{[t.localidad, t.nota].filter(Boolean).join(' · ')}</p>
                          </div>
                          {t.telefono && <a href={waLink(t.telefono) ?? `tel:${t.telefono}`} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-medium rounded-lg border border-black/10 bg-white py-1.5 px-3 text-emerald-700">Contactar</a>}
                        </div>
                      ))}
                    </div>

                    {/* Salvavidas: pedir más ópticas de bienvenida cerca */}
                    <div className="space-y-2">
                      {!salv[d] ? (
                        <button onClick={() => pedirBienvenida(d)} disabled={salvLoad === d}
                          className="w-full rounded-xl border border-dashed border-emerald-300 text-emerald-700 py-2.5 text-[12px] font-semibold disabled:opacity-50">
                          {salvLoad === d ? 'Buscando…' : '🆘 Terminé temprano — pedir más ópticas de bienvenida cerca'}
                        </button>
                      ) : (
                        <>
                          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Bienvenida cerca ({salv[d].length}) <span className="text-[10px] font-normal text-faint normal-case">— para sumar hoy</span></p>
                          {salv[d].length === 0 ? <p className="text-[11px] text-faint">No hay ópticas de bienvenida sin visitar en esta zona.</p> : salv[d].map((b) => (
                            <div key={b.cod} className="bg-emerald-50/50 rounded-xl border border-emerald-100 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium truncate">{b.nombre}</p>
                                {b.dist != null && <span className="text-[10px] text-faint shrink-0">{b.dist} km</span>}
                              </div>
                              <p className="text-[11px] text-muted">{[b.zona, b.direccion].filter(Boolean).join(' · ')}</p>
                              <div className="flex gap-2 mt-2">
                                {waLink(b.telefono) && <a href={waLink(b.telefono)!} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 bg-white py-1.5 text-emerald-700">WhatsApp</a>}
                                {mapsLink(b.direccion, b.zona) && <a href={mapsLink(b.direccion, b.zona)!} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 bg-white py-1.5 text-brandDark">Ruta</a>}
                              </div>
                            </div>
                          ))}
                          <button onClick={() => pedirBienvenida(d)} className="w-full text-[11px] text-emerald-700 font-medium py-1.5">↻ Buscar otras</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Interior encapsulado */}
          {interior.length > 0 && (
            <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
              <button onClick={() => setVerInterior((v) => !v)} className="w-full flex items-center justify-between p-3.5 text-sm font-medium">
                <span className="flex items-center gap-2"><Plane size={15} className="text-brandDark" />Interior — para viajes ({interior.length})</span>{verInterior ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {verInterior && (
                <div className="border-t border-black/5 p-3 space-y-3">
                  <p className="text-[11px] text-faint">Para viaje. Entrá por zona → provincia → ciudad.</p>
                  <DrillClientes rows={interior as unknown as DrillRow[]} renderItem={(r) => {
                    const wa = waLink(r.telefono as string | null)
                    return (
                      <div key={r.cod} className="flex items-center justify-between gap-2 bg-[#F6F4EF] rounded-lg px-2.5 py-2">
                        <div className="min-w-0"><span className="text-[12px] font-medium truncate block">{r.nombre}</span><span className="text-[10px] text-faint">{r.localidad as string}{r.cohorte ? ` · ${r.cohorte}` : ''}</span></div>
                        {wa && <a href={wa} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-medium rounded-lg border border-black/10 bg-white py-1 px-2.5 text-emerald-700">WhatsApp</a>}
                      </div>
                    )
                  }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {visitar && <VisitaModal r={visitar} vendedor={ven} onClose={() => setVisitar(null)} onSaved={onVisitaSaved} onCargarPedido={() => navigate('/pedidos/nuevo')} />}
      {histCli && <HistorialModal r={histCli} onClose={() => setHistCli(null)} />}
    </div>
  )
}
