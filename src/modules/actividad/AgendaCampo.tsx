import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Phone, Check, ChevronDown, ChevronRight, Navigation, Plane, CalendarClock } from 'lucide-react'

// Agenda de CAMPO (Martín / Adrián): recorrido diario en Buenos Aires + GBA de sus
// clientes de canje + a recuperar (7 propios/día por zona) + los 5 turnos de prospección.
// Cada día es un bloque: se puede POSPONER el día completo (mover en bloque al final).
// El interior queda encapsulado aparte (viajes).

interface Row {
  dia_num: number; orden_en_dia: number; bloque: string; cohorte: string
  region: string | null; localidad: string | null; cod: string
  nombre: string | null; direccion: string | null; telefono: string | null; visitado: boolean
}
interface Turno { id: number; vendedor: string; dia_num: number; cliente: string; telefono: string | null; localidad: string | null; cargado_por: string | null; nota: string | null; estado: string }

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

function ClienteCard({ r, onToggle }: { r: Row; onToggle: (cod: string, v: boolean) => void }) {
  const wa = waLink(r.telefono)
  const maps = mapsLink(r.direccion, r.localidad)
  return (
    <div className={`bg-white rounded-xl border p-3 transition ${r.visitado ? 'border-emerald-200 opacity-60' : 'border-black/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${r.visitado ? 'line-through text-muted' : 'text-ink'}`}>{r.nombre}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <CohorteChip c={r.cohorte} />
            {r.localidad && <span className="text-[10px] text-faint">{r.localidad}</span>}
          </div>
          {r.direccion && <p className="text-[11px] text-muted mt-1 truncate">{r.direccion}</p>}
        </div>
        <button onClick={() => onToggle(r.cod, !r.visitado)} title="Marcar visitado"
          className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center border ${r.visitado ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-black/15 text-faint'}`}>
          <Check size={18} />
        </button>
      </div>
      <div className="flex gap-2 mt-2">
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-emerald-700">WhatsApp</a>}
        {r.telefono && <a href={`tel:${r.telefono}`} className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-ink flex items-center justify-center gap-1"><Phone size={12} />Llamar</a>}
        {maps && <a href={maps} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-brandDark flex items-center justify-center gap-1"><Navigation size={12} />Ruta</a>}
      </div>
    </div>
  )
}

export default function AgendaCampo() {
  const { codigoEfectivo } = useAuth()
  const [ven, setVen] = useState<string>(codigoEfectivo === 'Martin' ? 'Martin' : 'Adrian')
  const [rows, setRows] = useState<Row[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [verInterior, setVerInterior] = useState(false)
  const [posponiendo, setPosponiendo] = useState<number | null>(null)

  async function cargar() {
    setLoading(true)
    const [{ data: plan }, { data: tur }] = await Promise.all([
      supabase.rpc('agenda_campo_plan', { p_vendedor: ven }),
      supabase.from('agenda_turnos').select('*').eq('vendedor', ven),
    ])
    setRows((plan as Row[]) ?? [])
    setTurnos((tur as Turno[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [ven])

  const baGba = useMemo(() => rows.filter((r) => r.bloque === 'ba_gba'), [rows])
  const interior = useMemo(() => rows.filter((r) => r.bloque === 'interior'), [rows])
  const dias = useMemo(() => Array.from(new Set(baGba.map((r) => r.dia_num))).sort((a, b) => a - b), [baGba])
  const hoy = useMemo(() => dias.find((d) => baGba.some((r) => r.dia_num === d && !r.visitado)) ?? dias[0] ?? 1, [dias, baGba])
  // abrir "hoy" por defecto cuando cargan los datos
  useEffect(() => { if (!loading && abierto === null) setAbierto(hoy) /* eslint-disable-next-line */ }, [loading, hoy])

  const totalPend = baGba.filter((r) => !r.visitado).length

  async function toggle(cod: string, v: boolean) {
    setRows((rs) => rs.map((r) => (r.cod === cod ? { ...r, visitado: v } : r)))
    await supabase.from('agenda_campo').update({ visitado: v }).eq('vendedor', ven).eq('cod_cliente', cod)
  }
  async function posponer(dia: number) {
    setPosponiendo(dia)
    await supabase.rpc('posponer_dia_campo', { p_vendedor: ven, p_dia: dia })
    await cargar()
    setPosponiendo(null)
    setAbierto(null)
  }

  const interiorPorRegion = useMemo(() => {
    const m: Record<string, Row[]> = {}
    for (const r of interior) { const k = r.region ?? 'Otros'; (m[k] ??= []).push(r) }
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [interior])

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

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : dias.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">No hay plan de campo generado para {ven}.</p>
      ) : (
        <div className="space-y-2.5">
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
            return (
              <div key={d} className={`rounded-2xl border overflow-hidden ${esHoy ? 'border-brand ring-1 ring-brand/20' : 'border-black/10'} bg-white`}>
                {/* Cabecera del día */}
                <button onClick={() => setAbierto(open ? null : d)} className="w-full text-left p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${esHoy ? 'bg-ink text-white' : 'bg-black/5 text-muted'}`}>{esHoy ? 'Hoy' : `Día ${d}`}</span>
                      {completo && <span className="text-[10px] text-emerald-600 font-medium">✓ completo</span>}
                    </div>
                    <p className="text-sm font-semibold mt-1 truncate">{zona || 'Zona'}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-black/5 text-muted">{delDia.length} clientes</span>
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700">{canjeN} canje</span>
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-blue-100 text-blue-700">{recupN} recuperar</span>
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${faltanPros > 0 ? 'bg-[#8F6A34]/10 text-[#8F6A34]' : 'bg-emerald-100 text-emerald-700'}`}>{turnosDia.length}/{sugeridos} prospección</span>
                    </div>
                  </div>
                  {open ? <ChevronDown size={18} className="text-faint shrink-0" /> : <ChevronRight size={18} className="text-faint shrink-0" />}
                </button>

                {open && (
                  <div className="px-3 pb-3 space-y-3 border-t border-black/5 pt-3">
                    {/* Mover el día en bloque */}
                    <button onClick={() => posponer(d)} disabled={posponiendo === d}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-brandDark border border-dashed border-brand/40 rounded-lg py-2 disabled:opacity-50">
                      <CalendarClock size={13} />{posponiendo === d ? 'Moviendo…' : 'Posponer este día (mover el bloque al final)'}
                    </button>

                    {/* Clientes propios */}
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">Clientes de la zona ({delDia.length})</p>
                      {delDia.length > 1 && (
                        <p className="text-[11px] text-brandDark bg-brand/5 rounded-lg px-2.5 py-1.5">
                          🧭 Empezá por <b>{delDia[0].nombre}</b> · terminá en <b>{delDia[delDia.length - 1].nombre}</b>
                        </p>
                      )}
                      {delDia.map((r) => <ClienteCard key={r.cod} r={r} onToggle={toggle} />)}
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
                  <p className="text-[11px] text-faint">No entran en el recorrido diario. Se cubren con viajes concentrados o vía prospección/catálogo.</p>
                  {interiorPorRegion.map(([reg, rs]) => (
                    <div key={reg}>
                      <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">{reg} ({rs.length})</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {rs.map((r) => (
                          <div key={r.cod} className="flex items-center justify-between gap-2 bg-[#F6F4EF] rounded-lg px-2.5 py-1.5">
                            <span className="text-[12px] truncate">{r.nombre}</span>
                            <span className="text-[10px] text-faint shrink-0">{r.localidad}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
