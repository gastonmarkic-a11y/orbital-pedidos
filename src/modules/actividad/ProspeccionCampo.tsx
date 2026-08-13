import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Target, Plus, Trash2, Check, ChevronDown, ChevronRight, PhoneCall, Send } from 'lucide-react'
import DrillClientes, { DrillRow } from './DrillClientes'
import PreparacionEnvio from '../envios/PreparacionEnvio'
import { Cliente, ObjetivoMes } from '../../lib/types'
import { monthKey, habilesDelMes, habilesTranscurridos } from '../../lib/dates'
import LlamarBtn from '../../lib/LlamarBtn'

// Pantalla de PROSPECCIÓN de campo para Luna (Marketing) y Damián.
// Objetivo OBLIGATORIO del día: conseguir 5 turnos en la zona del próximo recorrido
// del vendedor que alimenta (Luna→Adrián, Damián→Martín) — "va a pasar el vendedor".
// En paralelo: cerrar/seguir los prospectos generados por ellos en julio.

interface Row { dia_num: number; bloque: string; localidad: string | null; region: string | null; visitado: boolean; cod: string }
interface Turno { id: number; vendedor: string; dia_num: number; cliente: string; cod_cliente?: string | null; telefono: string | null; localidad: string | null; cargado_por: string | null; nota: string | null }
interface PJ { id: number; nombre: string | null; codigo: string | null; compartido: boolean; cerrado: boolean; conflicto: boolean; region: string | null; provincia: string | null; localidad: string | null; telefono: string | null; es_interior: boolean }
interface Bienv { cod: string; nombre: string | null; direccion: string | null; telefono: string | null; whatsapp: string | null; zona: string | null; dist: number | null }
interface Nuevo { cod: string; nombre: string | null; telefono: string | null; whatsapp: string | null; zona: string | null; localidad: string | null }

// prospector code -> vendedor que alimenta
const FEED: Record<string, { vendedor: string; label: string; prospLabel: string }> = {
  Marketing: { vendedor: 'Adrian', label: 'Adrián', prospLabel: 'Luna' },
  Damian: { vendedor: 'Martin', label: 'Martín', prospLabel: 'Damián' },
}
const META_DIA = 12 // visitas objetivo por día (propios + prospección)
const META_NUEVOS_MES = 150 // prospectos nuevos (bienvenida) por mes — objetivo de largo plazo
// Turnos de zona PAUSADOS para Adrián/Martín: el objetivo se muestra en gris al final, sin poder activarlo.
// Poné en false para reactivarlo.
const PAUSA_TURNOS = true
// Feriados nacionales AR (editar según calendario oficial).
const FERIADOS_AR = ['2026-08-17', '2026-10-12', '2026-11-20', '2026-12-08', '2026-12-25']
// Días hábiles que quedan en el mes (desde hoy inclusive), sin sáb/dom ni feriados.
function diasHabilesRestantes(): number {
  const now = new Date(); const y = now.getFullYear(), mo = now.getMonth()
  const fin = new Date(y, mo + 1, 0).getDate()
  let c = 0
  for (let d = now.getDate(); d <= fin; d++) {
    const dow = new Date(y, mo, d).getDay()
    if (dow === 0 || dow === 6) continue
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (FERIADOS_AR.includes(iso)) continue
    c++
  }
  return Math.max(1, c)
}
const DIAS_SEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const INICIO_AGENDA: [number, number, number] = [2026, 7, 11] // 11/8/2026 (fijo, igual que AgendaCampo)
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
const soloDigitos = (t: string) => t.replace(/\D/g, '')
const waLink = (t: string | null) => { if (!t) return null; const d = soloDigitos(t); return d ? `https://wa.me/${d.length <= 10 ? '54' + d : d}` : null }

export default function ProspeccionCampo() {
  const { codigoEfectivo } = useAuth()
  const feed = FEED[codigoEfectivo ?? ''] ?? FEED.Marketing
  const [rows, setRows] = useState<Row[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [diaSel, setDiaSel] = useState<number | null>(null)
  const [verZona, setVerZona] = useState(true)
  const [verJulio, setVerJulio] = useState(false)
  const [verNuevos, setVerNuevos] = useState(false)
  const [julio, setJulio] = useState<PJ[]>([])
  const [zonaProsp, setZonaProsp] = useState<Bienv[]>([])
  const [nuevos, setNuevos] = useState<Nuevo[]>([])
  // form
  const [cli, setCli] = useState('')
  const [tel, setTel] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setLoading(true)
    const [{ data: plan }, { data: tur }] = await Promise.all([
      supabase.rpc('agenda_campo_plan', { p_vendedor: feed.vendedor }),
      supabase.from('agenda_turnos').select('*').eq('vendedor', feed.vendedor),
    ])
    setRows(((plan as Row[]) ?? []).filter((r) => r.bloque === 'ba_gba'))
    setTurnos((tur as Turno[]) ?? [])
    setLoading(false)
  }
  async function cargarJulio() {
    // Cada prospector ve LO SUYO: Luna (Marketing) sus contactos, Damián los suyos.
    const { data } = await supabase.rpc('prospectos_julio_lista', { p_prospector: codigoEfectivo ?? null })
    setJulio((data as PJ[]) ?? [])
  }
  // Pool de bienvenida (fríos sin ventas) a contactar, ya excluidos los activados y los contactados.
  async function cargarNuevos() {
    const { data } = await supabase.rpc('bienvenida_a_llamar', { p_limit: 60 })
    setNuevos((data as Nuevo[]) ?? [])
  }
  useEffect(() => { cargar(); cargarJulio(); cargarNuevos() /* eslint-disable-next-line */ }, [codigoEfectivo])

  async function cerrarJulio(id: number, v: boolean) {
    setJulio((js) => js.map((j) => (j.id === id ? { ...j, cerrado: v } : j)))
    await supabase.from('prospectos_julio').update({ cerrado: v }).eq('id', id)
  }
  // Conflicto: no atiende / número incorrecto → sale de la lista de hoy y entra el siguiente.
  // Queda registrado como actividad para que también se refleje en la Cartera.
  async function marcarConflicto(j: PJ) {
    setJulio((js) => js.map((x) => (x.id === j.id ? { ...x, conflicto: true } : x)))
    await supabase.from('prospectos_julio').update({ conflicto: true }).eq('id', j.id)
    await registrarActividad({ cod: j.codigo ?? String(j.id), nombre: j.nombre, telefono: j.telefono, localidad: j.localidad, origen: 'prospeccion_julio', desarrollo: 'Conflicto: no atiende / número incorrecto', resultado: 'conflicto' })
  }

  // Performance del prospector: objetivo del mes + acumulado + objetivo diario.
  const [obj, setObj] = useState<ObjetivoMes | null>(null)
  const [perf, setPerf] = useState<{ mesTot: number; mesProp: number; hoyTot: number }>({ mesTot: 0, mesProp: 0, hoyTot: 0 })
  useEffect(() => {
    const mes = monthKey()
    const hoyStr = new Date().toISOString().slice(0, 10)
    ;(async () => {
      const [{ data: o }, { data: act }] = await Promise.all([
        supabase.from('objetivos_mes').select('*').eq('vendedor', codigoEfectivo).eq('mes_anio', mes).maybeSingle(),
        supabase.from('actividad_diaria').select('fecha, propuesta_enviada_id').eq('vendedor', codigoEfectivo).gte('fecha', `${mes}-01`),
      ])
      setObj(o as ObjetivoMes | null)
      const rows = (act ?? []) as { fecha: string; propuesta_enviada_id: number | null }[]
      setPerf({ mesTot: rows.length, mesProp: rows.filter((r) => r.propuesta_enviada_id != null).length, hoyTot: rows.filter((r) => r.fecha === hoyStr).length })
    })()
  }, [codigoEfectivo])

  // Registro de actividad SIEMPRE (envíos, turnos, confirmaciones) → actividad_diaria.
  async function registrarActividad(p: { cod: string; nombre: string | null; telefono: string | null; localidad: string | null; origen: string; desarrollo: string; resultado?: string }) {
    const hoy = new Date().toISOString().slice(0, 10)
    await supabase.from('actividad_diaria').insert({
      fecha: hoy, vendedor: codigoEfectivo ?? 'prospeccion', cod_cliente: p.cod, nombre_comercio: p.nombre,
      telefono: p.telefono, localidad: p.localidad, origen: p.origen,
      resultado_contacto: p.resultado ?? 'contacto', actividad_desarrollo: p.desarrollo,
    })
  }
  // "Enviar" abre el modal de acción (PreparacionEnvio, el mismo de Cartera): propuesta +
  // material + mensaje + WhatsApp/Llamar/Mail/Recordatorio/Reunión, y registra la actividad.
  const [enviarCli, setEnviarCli] = useState<Cliente | null>(null)
  function abrirEnvio(j: PJ) {
    setEnviarCli({
      cod: j.codigo ?? String(j.id), nomcomerc: j.nombre, razon: j.nombre,
      whatsapp: j.telefono, telefono: j.telefono, email: null, contacto: null,
      localidad: j.localidad, provincia: j.provincia,
      clasificacion_recupero: 'sin_historial', unidades_2025: 0,
    } as unknown as Cliente)
  }
  function abrirEnvioNuevo(n: Nuevo) {
    setEnviarCli({
      cod: n.cod, nomcomerc: n.nombre, razon: n.nombre,
      whatsapp: n.whatsapp ?? n.telefono, telefono: n.telefono, email: null, contacto: null,
      localidad: n.localidad, provincia: null,
      clasificacion_recupero: 'sin_historial', unidades_2025: 0,
    } as unknown as Cliente)
  }
  // Conflicto en un frío nuevo: registra actividad (lo saca del pool en la próxima carga) y lo quita ya.
  async function marcarConflictoNuevo(n: Nuevo) {
    setNuevos((ns) => ns.filter((x) => x.cod !== n.cod))
    await registrarActividad({ cod: n.cod, nombre: n.nombre, telefono: n.telefono ?? n.whatsapp, localidad: n.localidad, origen: 'prospeccion_bienvenida', desarrollo: 'Conflicto: no atiende / número incorrecto', resultado: 'conflicto' })
  }

  const dias = useMemo(() => Array.from(new Set(rows.map((r) => r.dia_num))).sort((a, b) => a - b), [rows])
  const hoyVendedor = useMemo(() => dias.find((d) => rows.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1, [dias, rows])
  // objetivo = 2 días adelante del recorrido del vendedor (se agenda con anticipación)
  const objetivo = useMemo(() => {
    const i = dias.indexOf(hoyVendedor)
    return dias[Math.min(i + 2, dias.length - 1)] ?? hoyVendedor
  }, [dias, hoyVendedor])
  const diaActivo = diaSel ?? objetivo

  useEffect(() => {
    if (!diaActivo) return
    supabase.rpc('bienvenida_cerca', { p_vendedor: feed.vendedor, p_dia: diaActivo, p_limit: 12 }).then(({ data }) => setZonaProsp((data as Bienv[]) ?? []))
  }, [diaActivo, feed.vendedor])

  async function confirmarTurno(b: Bienv) {
    const { data } = await supabase.from('agenda_turnos').insert({
      vendedor: feed.vendedor, dia_num: diaActivo, cliente: b.nombre, cod_cliente: b.cod,
      telefono: b.telefono, localidad: b.zona, cargado_por: codigoEfectivo, nota: 'Confirmado: va a pasar el vendedor',
    }).select().single()
    if (data) setTurnos((t) => [...t, data as Turno])
    await registrarActividad({ cod: b.cod, nombre: b.nombre, telefono: b.telefono, localidad: b.zona, origen: 'prospeccion_turno', desarrollo: `Confirmado: va a pasar ${feed.label}` })
    // NO se oculta: queda visible en verde como "Confirmado" (agenda activada), con opción de deshacer.
  }
  // Deshacer una confirmación (por si el operador se equivocó): borra el turno y su registro de hoy.
  async function desconfirmarTurno(b: Bienv) {
    const t = turnos.find((x) => x.cod_cliente === b.cod && x.dia_num === diaActivo)
    if (t) {
      await supabase.from('agenda_turnos').delete().eq('id', t.id)
      setTurnos((ts) => ts.filter((x) => x.id !== t.id))
    }
    const hoyStr = new Date().toISOString().slice(0, 10)
    await supabase.from('actividad_diaria').delete().eq('cod_cliente', b.cod).eq('origen', 'prospeccion_turno').eq('fecha', hoyStr).ilike('actividad_desarrollo', '%va a pasar%')
  }

  const zonaDe = (d: number) => Array.from(new Set(rows.filter((r) => r.dia_num === d).map((r) => r.localidad).filter(Boolean)))
  const zonaActiva = zonaDe(diaActivo)
  const turnosDia = turnos.filter((t) => t.dia_num === diaActivo)
  const ownDia = rows.filter((r) => r.dia_num === diaActivo).length
  const META = Math.max(0, META_DIA - ownDia) // dinámico: completa hasta 12 según clientes propios del día
  const faltan = Math.max(0, META - turnosDia.length)

  async function agregar() {
    if (!cli.trim()) return
    setGuardando(true)
    const { data } = await supabase.from('agenda_turnos').insert({
      vendedor: feed.vendedor, dia_num: diaActivo, cliente: cli.trim(),
      telefono: tel.trim() || null, localidad: zonaActiva[0] ?? null,
      cargado_por: codigoEfectivo, nota: nota.trim() || null,
    }).select().single()
    if (data) setTurnos((t) => [...t, data as Turno])
    await registrarActividad({ cod: cli.trim(), nombre: cli.trim(), telefono: tel.trim() || null, localidad: zonaActiva[0] ?? null, origen: 'prospeccion_turno', desarrollo: `Turno cargado para ${feed.label}${nota.trim() ? ' — ' + nota.trim() : ''}` })
    setCli(''); setTel(''); setNota(''); setGuardando(false)
  }
  async function borrar(id: number) {
    setTurnos((t) => t.filter((x) => x.id !== id))
    await supabase.from('agenda_turnos').delete().eq('id', id)
  }

  // Cupos diarios de los TRES objetivos (mensual ÷ días hábiles restantes). Los 5 turnos de zona
  // ya son "agenda activada" y van aparte — NO entran en la prospección nueva de bienvenida.
  const julioAbiertos = julio.filter((j) => !j.cerrado && !j.conflicto).length
  const diasRest = diasHabilesRestantes()
  const julioDia = Math.max(1, Math.ceil(julioAbiertos / diasRest))
  const nuevosDia = Math.ceil(META_NUEVOS_MES / diasRest)
  // Lista puntual "a llamar hoy": el cupo del día tomando los abiertos sin conflicto, interior/zona primero (orden de la RPC).
  const julioHoy = julio.filter((j) => !j.cerrado && !j.conflicto).slice(0, julioDia)
  const nuevosHoy = nuevos.slice(0, nuevosDia)

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h1 className="text-lg font-bold">Prospección de campo</h1>
        <p className="text-xs text-muted">Conseguí turnos en la zona del recorrido de {feed.label}</p>
      </div>

      {/* Performance del prospector: objetivo diario + mensual + acumulado */}
      {(() => {
        const objMes = obj?.objetivo_propuestas ?? 0
        const habMes = habilesDelMes(); const habT = habilesTranscurridos()
        const objDia = objMes > 0 && habMes > 0 ? Math.ceil(objMes / habMes) : META
        const proy = habT > 0 ? Math.round((perf.mesProp / habT) * habMes) : 0
        const pctMes = objMes > 0 ? Math.min(100, Math.round((perf.mesProp / objMes) * 100)) : 0
        const enLinea = objMes > 0 && proy >= objMes
        return (
          <div className="bg-ink text-white rounded-2xl p-4">
            <p className="text-[11px] uppercase tracking-wide text-white/60 mb-2">Tu performance de agenda · {feed.prospLabel}</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-2xl font-bold text-gold">{perf.hoyTot}<span className="text-sm text-white/50">/{objDia}</span></p><p className="text-[10px] text-white/60">acciones hoy · objetivo diario</p></div>
              <div><p className="text-2xl font-bold">{perf.mesProp}<span className="text-sm text-white/50">/{objMes || '—'}</span></p><p className="text-[10px] text-white/60">propuestas del mes</p></div>
              <div><p className={`text-2xl font-bold ${enLinea ? 'text-emerald-300' : 'text-white'}`}>{proy}</p><p className="text-[10px] text-white/60">proyección a fin de mes</p></div>
            </div>
            {objMes > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-2 bg-white/15 rounded-full overflow-hidden"><div className={`h-full ${enLinea ? 'bg-emerald-400' : 'bg-gold'}`} style={{ width: `${pctMes}%` }} /></div>
                <span className="text-sm font-bold">{pctMes}%</span>
              </div>
            )}
            <p className="text-[10px] text-white/40 mt-1.5">Acumulado del mes: {perf.mesTot} acciones · {perf.mesProp} propuestas enviadas{objMes ? ` · objetivo mensual ${objMes}` : ' · sin objetivo mensual cargado'}.</p>
          </div>
        )
      })()}

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : dias.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Todavía no hay recorrido de campo generado para {feed.label}.</p>
      ) : (
        <>
          {/* OBJETIVO 1 · Turnos de visita — PAUSADO (se muestra en gris al final) */}
          {!PAUSA_TURNOS && (
          <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
            <button onClick={() => setVerZona((v) => !v)} className="w-full flex items-center justify-between gap-2 p-3.5 text-sm font-medium text-left">
              <span className="min-w-0 flex items-center gap-1.5"><Target size={15} className="text-gold shrink-0" /><span>Turnos de visita para {feed.label}
                <span className="block text-[11px] text-faint font-normal">Hoy: conseguí <b className="text-ink">{META}</b> en {zonaActiva.slice(0, 2).join(' · ') || 'la zona'} · llevás <b className="text-ink">{turnosDia.length}/{META}</b>{faltan === 0 ? ' ✓' : ''}</span>
              </span></span>{verZona ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
            </button>
            {verZona && (
              <div className="border-t border-black/5 p-3 space-y-3">
                <div className="bg-ink text-white rounded-xl p-3">
                  <p className="text-sm font-semibold leading-snug">Conseguí <b>{META} turnos</b> en <b>{zonaActiva.slice(0, 3).join(' · ') || 'la zona'}</b> para pasarle a <b>{feed.label}</b>.</p>
                  <p className="text-[11px] text-white/60 mt-1">Va a recorrer esa zona el {labelDia(diaActivo)}. Avisales: "va a pasar {feed.label} a saludarte".</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-white/15 rounded-full overflow-hidden"><div className="h-full bg-gold" style={{ width: `${(turnosDia.length / META) * 100}%` }} /></div>
                    <span className="text-sm font-bold">{turnosDia.length}/{META}</span>
                  </div>
                  {faltan === 0 && <p className="text-[12px] text-emerald-300 font-medium mt-2 flex items-center gap-1"><Check size={14} />¡Objetivo cumplido!</p>}
                </div>

          {/* Selector de día del recorrido */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {dias.map((d) => {
              const n = turnos.filter((t) => t.dia_num === d).length
              const tgt = Math.max(0, META_DIA - rows.filter((r) => r.dia_num === d).length)
              return (
                <button key={d} onClick={() => setDiaSel(d)} className={`shrink-0 text-[11px] rounded-full px-3 py-1.5 border font-medium ${d === diaActivo ? 'bg-brand text-white border-brand' : 'bg-white border-black/10 text-muted'}`}>
                  {labelDia(d)} · {zonaDe(d)[0] ?? "—"} ({n}/{tgt})
                </button>
              )
            })}
          </div>

          {/* Ópticas de prospección EN ESA ZONA para confirmar la visita */}
          <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Ópticas de la zona para confirmar ({zonaProsp.length})</p>
            <p className="text-[11px] text-faint -mt-1">Llamá, confirmá que va a pasar {feed.label}, y tocá "Confirmar turno".</p>
            {zonaProsp.length === 0 ? <p className="text-[11px] text-faint">No hay ópticas de prospección sin agendar en esta zona.</p> : zonaProsp.map((b) => {
              const confirmado = turnos.some((t) => t.cod_cliente === b.cod && t.dia_num === diaActivo)
              return (
              <div key={b.cod} className={`rounded-xl border p-2.5 ${confirmado ? 'border-emerald-300 bg-emerald-50/40' : 'border-black/10'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="text-[13px] font-medium truncate">{b.nombre}</p><p className="text-[10px] text-faint">{[b.zona, b.direccion].filter(Boolean).join(' · ')}{b.dist != null ? ` · ${b.dist}km` : ''}{confirmado ? ' · ✓ agenda activada' : ''}</p></div>
                </div>
                <div className="flex gap-2 mt-2">
                  {waLink(b.telefono) && <a href={waLink(b.telefono)!} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-emerald-700">WhatsApp</a>}
                  <LlamarBtn telefono={b.telefono} whatsapp={b.whatsapp} className="flex-1" />
                  {confirmado ? (
                    <div className="flex-1 flex gap-1.5">
                      <span className="flex-1 text-center text-[11px] font-semibold rounded-lg bg-emerald-600 text-white py-1.5 flex items-center justify-center gap-1"><Check size={13} />Confirmado</span>
                      <button onClick={() => desconfirmarTurno(b)} title="Deshacer la confirmación (por si te equivocaste)" className="shrink-0 text-[11px] font-medium rounded-lg border border-black/15 text-muted px-2.5 py-1.5">Deshacer</button>
                    </div>
                  ) : (
                    <button onClick={() => confirmarTurno(b)} className="flex-1 text-[11px] font-semibold rounded-lg bg-brand text-white py-1.5">✓ Confirmar turno</button>
                  )}
                </div>
              </div>
            )})}
          </div>

          {/* Alta de turno manual (otro contacto) */}
          <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Otro contacto (manual) — {zonaActiva[0] ?? 'la zona'} ({labelDia(diaActivo)})</p>
            <input value={cli} onChange={(e) => setCli(e.target.value)} placeholder="Óptica / contacto *" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            <div className="grid grid-cols-2 gap-2">
              <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Teléfono / WhatsApp" className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (horario, etc.)" className="rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <button onClick={agregar} disabled={guardando || !cli.trim()} className="w-full bg-brand text-white rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50">
              <Plus size={16} />Agregar turno
            </button>
          </div>

          {/* Turnos cargados del día */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Turnos cargados ({turnosDia.length})</p>
            {turnosDia.length === 0 ? <p className="text-[11px] text-faint">Todavía no cargaste turnos para este día.</p> : turnosDia.map((t) => (
              <div key={t.id} className="bg-white rounded-xl border border-black/10 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.cliente}</p>
                  <p className="text-[11px] text-faint">{[t.localidad, t.nota].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {waLink(t.telefono) && <a href={waLink(t.telefono)!} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-lg border border-black/10 flex items-center justify-center text-emerald-700"><PhoneCall size={14} /></a>}
                  <button onClick={() => borrar(t.id)} className="w-8 h-8 rounded-lg text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
              </div>
            )}
          </div>
          )}

          {/* OBJETIVO 2 · Potenciá el contacto generado en julio */}
          <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
            <button onClick={() => setVerJulio((v) => !v)} className="w-full flex items-center justify-between gap-2 p-3.5 text-sm font-medium text-left">
              <span className="min-w-0">🔥 Potenciá el contacto generado en julio
                <span className="block text-[11px] text-faint font-normal">Hoy: contactá <b className="text-ink">{julioDia}</b> para cerrar tus contactos de julio ({julioAbiertos} abiertos)</span>
              </span>{verJulio ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
            </button>
            {verJulio && (
              <div className="border-t border-black/5 p-3 space-y-2">
                <p className="text-[12px] text-muted">Contactá <b>{julioDia} por día</b> ({julioAbiertos} abiertos ÷ {diasRest} días hábiles) para cerrar julio este mes. Entrá por zona → provincia → ciudad. <b>Interior primero</b> (catálogo). Cada "Enviar" queda registrado como actividad.</p>

                {/* A LLAMAR HOY: el cupo del día, elegido por zona/relevancia. Conflicto → sale y entra el siguiente. */}
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-2.5 space-y-1.5">
                  <p className="text-[11px] font-semibold text-brandDark uppercase tracking-wide">🎯 A llamar hoy · {julioHoy.length}/{julioDia}</p>
                  {julioHoy.length === 0 ? <p className="text-[11px] text-faint">Sin contactos de julio pendientes 🎉</p> : julioHoy.map((j) => (
                    <div key={j.id} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white p-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium truncate">{j.nombre}</p>
                        <p className="text-[10px] text-faint">{[j.localidad, j.provincia].filter(Boolean).join(' · ')}{j.es_interior ? ' · INT' : ''}</p>
                      </div>
                      <LlamarBtn telefono={j.telefono} whatsapp={j.telefono} className="w-20 shrink-0" />
                      <button onClick={() => abrirEnvio(j)} className="shrink-0 rounded-lg px-2.5 h-7 text-[11px] font-medium flex items-center gap-1 bg-brand text-white"><Send size={12} />Enviar</button>
                      <button onClick={() => marcarConflicto(j)} title="No atiende / número incorrecto" className="shrink-0 rounded-lg px-2 h-7 text-[11px] font-medium border border-red-200 text-red-600">⚠</button>
                    </div>
                  ))}
                  <p className="text-[10px] text-faint">Tocá ⚠ si no atiende o el número está mal → sale de hoy y entra el siguiente. Abajo tenés toda tu base por zona.</p>
                </div>

                {julio.length === 0 ? <p className="text-[11px] text-faint">Sin base de julio cargada.</p> : (
                  <DrillClientes rows={julio.filter((j) => !j.conflicto).map((j) => ({ ...j, cod: j.codigo ?? String(j.id) })) as unknown as DrillRow[]} renderItem={(r) => {
                    const j = r as unknown as PJ
                    return (
                      <div key={j.id} className={`flex items-center gap-2 rounded-xl border p-2 ${j.cerrado ? 'border-emerald-200 opacity-60' : 'border-black/10'}`}>
                        <button onClick={() => cerrarJulio(j.id, !j.cerrado)} className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border ${j.cerrado ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-black/15 text-faint'}`}><Check size={15} /></button>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-medium truncate ${j.cerrado ? 'line-through text-muted' : ''}`}>{j.nombre}</p>
                          <p className="text-[10px] text-faint">{j.codigo}{j.localidad ? ` · ${j.localidad}` : ''}{j.compartido ? ' · ½ compartido' : ''}</p>
                        </div>
                        <button onClick={() => abrirEnvio(j)} className="shrink-0 rounded-lg px-2.5 h-7 text-[11px] font-medium flex items-center gap-1 bg-brand text-white"><Send size={12} />Enviar</button>
                        {j.es_interior && <span className="shrink-0 text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-[#8F6A34]/10 text-[#8F6A34]">INT</span>}
                      </div>
                    )
                  }} />
                )}
              </div>
            )}
          </div>

          {/* OBJETIVO 3 · Prospectos nuevos (Paquete de Bienvenida) — aparte de los 5 turnos de zona */}
          <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
            <button onClick={() => setVerNuevos((v) => !v)} className="w-full flex items-center justify-between gap-2 p-3.5 text-sm font-medium text-left">
              <span className="min-w-0">🆕 Prospectos nuevos · Paquete de Bienvenida
                <span className="block text-[11px] text-faint font-normal">Hoy: enviá <b className="text-ink">{nuevosDia}</b> propuestas de bienvenida a nuevos contactos ({META_NUEVOS_MES}/mes)</span>
              </span>{verNuevos ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
            </button>
            {verNuevos && (
              <div className="border-t border-black/5 p-3 space-y-2">
                <p className="text-[12px] text-muted">Fríos <b>sin ventas</b> a los que enviarles la bienvenida por WhatsApp. Objetivo de largo plazo: cubrir <b>todos</b>. <b>Aparte</b> de los 5 turnos de zona (esos ya son agenda activada).</p>
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-2.5 space-y-1.5">
                  <p className="text-[11px] font-semibold text-brandDark uppercase tracking-wide">🎯 A contactar hoy · {nuevosHoy.length}/{nuevosDia}</p>
                  {nuevosHoy.length === 0 ? <p className="text-[11px] text-faint">No hay fríos nuevos pendientes en tu pool 🎉</p> : nuevosHoy.map((n) => (
                    <div key={n.cod} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white p-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium truncate">{n.nombre ?? n.cod}</p>
                        <p className="text-[10px] text-faint">{[n.zona, n.localidad].filter(Boolean).join(' · ')}</p>
                      </div>
                      <LlamarBtn telefono={n.telefono} whatsapp={n.whatsapp} className="w-20 shrink-0" />
                      <button onClick={() => abrirEnvioNuevo(n)} className="shrink-0 rounded-lg px-2.5 h-7 text-[11px] font-medium flex items-center gap-1 bg-brand text-white"><Send size={12} />Enviar</button>
                      <button onClick={() => marcarConflictoNuevo(n)} title="No atiende / número incorrecto" className="shrink-0 rounded-lg px-2 h-7 text-[11px] font-medium border border-red-200 text-red-600">⚠</button>
                    </div>
                  ))}
                  <p className="text-[10px] text-faint">"Enviar" manda la bienvenida y lo saca del pool. ⚠ = no atiende/número malo → entra otro. Ordenados por zona; todo se refleja en la Cartera.</p>
                </div>
              </div>
            )}
          </div>
          {/* OBJETIVO PAUSADO · Turnos de zona — al final, en gris, no accionable */}
          {PAUSA_TURNOS && (
            <div className="bg-black/[.03] border border-black/10 rounded-2xl p-3.5 opacity-70 select-none cursor-not-allowed" title="Objetivo pausado — no disponible por ahora" aria-disabled="true">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex items-center gap-2"><Target size={15} className="text-faint shrink-0" /><span className="font-medium text-muted">Turnos de visita para {feed.label}
                  <span className="block text-[11px] text-faint font-normal">⏸ En pausa — por ahora enfocate en Julio y Bienvenida</span>
                </span></span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-black/10 text-muted">En pausa</span>
              </div>
            </div>
          )}
        </>
      )}

      {enviarCli && <PreparacionEnvio cliente={enviarCli} onClose={() => setEnviarCli(null)} onListo={() => { setEnviarCli(null); cargarJulio(); cargarNuevos() }} />}
    </div>
  )
}
