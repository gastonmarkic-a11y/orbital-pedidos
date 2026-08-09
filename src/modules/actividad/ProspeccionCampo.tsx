import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Target, Plus, Trash2, Check, ChevronDown, ChevronRight, PhoneCall } from 'lucide-react'

// Pantalla de PROSPECCIÓN de campo para Luna (Marketing) y Damián.
// Objetivo OBLIGATORIO del día: conseguir 5 turnos en la zona del próximo recorrido
// del vendedor que alimenta (Luna→Adrián, Damián→Martín) — "va a pasar el vendedor".
// En paralelo: cerrar/seguir los prospectos generados por ellos en julio.

interface Row { dia_num: number; bloque: string; localidad: string | null; region: string | null; visitado: boolean; cod: string }
interface Turno { id: number; vendedor: string; dia_num: number; cliente: string; telefono: string | null; localidad: string | null; cargado_por: string | null; nota: string | null }

// prospector code -> vendedor que alimenta
const FEED: Record<string, { vendedor: string; label: string; prospLabel: string }> = {
  Marketing: { vendedor: 'Adrian', label: 'Adrián', prospLabel: 'Luna' },
  Damian: { vendedor: 'Martin', label: 'Martín', prospLabel: 'Damián' },
}
const META = 5
const soloDigitos = (t: string) => t.replace(/\D/g, '')
const waLink = (t: string | null) => { if (!t) return null; const d = soloDigitos(t); return d ? `https://wa.me/${d.length <= 10 ? '54' + d : d}` : null }

export default function ProspeccionCampo() {
  const { codigoEfectivo } = useAuth()
  const feed = FEED[codigoEfectivo ?? ''] ?? FEED.Marketing
  const [rows, setRows] = useState<Row[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [diaSel, setDiaSel] = useState<number | null>(null)
  const [verJulio, setVerJulio] = useState(false)
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
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [codigoEfectivo])

  const dias = useMemo(() => Array.from(new Set(rows.map((r) => r.dia_num))).sort((a, b) => a - b), [rows])
  const hoyVendedor = useMemo(() => dias.find((d) => rows.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1, [dias, rows])
  // objetivo = 2 días adelante del recorrido del vendedor (se agenda con anticipación)
  const objetivo = useMemo(() => {
    const i = dias.indexOf(hoyVendedor)
    return dias[Math.min(i + 2, dias.length - 1)] ?? hoyVendedor
  }, [dias, hoyVendedor])
  const diaActivo = diaSel ?? objetivo

  const zonaDe = (d: number) => Array.from(new Set(rows.filter((r) => r.dia_num === d).map((r) => r.localidad).filter(Boolean)))
  const zonaActiva = zonaDe(diaActivo)
  const turnosDia = turnos.filter((t) => t.dia_num === diaActivo)
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
    setCli(''); setTel(''); setNota(''); setGuardando(false)
  }
  async function borrar(id: number) {
    setTurnos((t) => t.filter((x) => x.id !== id))
    await supabase.from('agenda_turnos').delete().eq('id', id)
  }

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h1 className="text-lg font-bold">Prospección de campo</h1>
        <p className="text-xs text-muted">Conseguí turnos en la zona del recorrido de {feed.label}</p>
      </div>

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : dias.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Todavía no hay recorrido de campo generado para {feed.label}.</p>
      ) : (
        <>
          {/* OBJETIVO OBLIGATORIO */}
          <div className="bg-ink text-white rounded-2xl p-4">
            <div className="flex items-center gap-2 text-gold">
              <Target size={16} /><span className="text-[11px] font-bold uppercase tracking-wide">Objetivo obligatorio de hoy</span>
            </div>
            <p className="text-base font-semibold mt-2 leading-snug">
              Conseguí <b>{META} turnos</b> en <b>{zonaActiva.slice(0, 3).join(' · ') || 'la zona'}</b> para pasarle a <b>{feed.label}</b>.
            </p>
            <p className="text-[11px] text-white/60 mt-1">Va a recorrer esa zona en el Día {diaActivo}. Avisales: "va a pasar {feed.label} a saludarte".</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 bg-white/15 rounded-full overflow-hidden">
                <div className="h-full bg-gold" style={{ width: `${(turnosDia.length / META) * 100}%` }} />
              </div>
              <span className="text-sm font-bold">{turnosDia.length}/{META}</span>
            </div>
            {faltan === 0 && <p className="text-[12px] text-emerald-300 font-medium mt-2 flex items-center gap-1"><Check size={14} />¡Objetivo cumplido!</p>}
          </div>

          {/* Selector de día del recorrido */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {dias.map((d) => {
              const n = turnos.filter((t) => t.dia_num === d).length
              return (
                <button key={d} onClick={() => setDiaSel(d)} className={`shrink-0 text-[11px] rounded-full px-3 py-1.5 border font-medium ${d === diaActivo ? 'bg-brand text-white border-brand' : 'bg-white border-black/10 text-muted'}`}>
                  Día {d} · {zonaDe(d)[0] ?? '—'} ({n}/{META})
                </button>
              )
            })}
          </div>

          {/* Alta de turno */}
          <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Cargar turno en {zonaActiva[0] ?? 'la zona'} (Día {diaActivo})</p>
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

          {/* Tarea paralela: prospectos de julio */}
          <div className="bg-white rounded-2xl border border-black/10 overflow-hidden">
            <button onClick={() => setVerJulio((v) => !v)} className="w-full flex items-center justify-between p-3.5 text-sm font-medium">
              <span>En paralelo · cerrar prospectos de julio</span>{verJulio ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {verJulio && (
              <div className="border-t border-black/5 p-3">
                <p className="text-[12px] text-muted">Seguimiento y cierre de los prospectos que generaste en julio (los de tu liquidación). Priorizá el interior del país para venta por catálogo.</p>
                <p className="text-[11px] text-faint mt-2">🔧 Listado en preparación — se conecta con tu liquidación de julio.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
