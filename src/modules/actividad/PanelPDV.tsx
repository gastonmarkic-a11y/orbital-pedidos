import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

// Panel "Puntos de venta" (administración): objetivo de visitas (5/día) y contactos (25/día) por vendedor,
// cada punto de venta visitado con la lectura de la foto (Orbital, exhibidor, marcas), participación de
// marcas, stock de material POP en la calle y materiales especiales de las cabezas de zona.
// Sale de panel_pdv(); solo admin / administración.

type Visita = { vendedor: string; fecha: string; visitas: number }
type Contacto = { vendedor: string; fecha: string; hechos: number; agendados: number; total: number }
type PDV = {
  id: number
  fecha: string
  vendedor: string
  cod: string
  nombre: string | null
  zona: string | null
  foto_url: string | null
  tiene_orbital: boolean | null
  tiene_exhibidor: boolean | null
  marcas: string[] | null
  participacion: { marca: string; porcentaje: number }[] | null
  espacio_vidriera: string | null
  nivel_local: string | null
  observaciones: string | null
  pop_sugerido: number | null
  kit_instalado: string | null
}
type Stock = { vendedor: string; material: string; nombre: string; saldo: number }
type Kits = { vendedor: string; exhibicion: number; presencia: number; instalados: number }
type Especial = { cod: string; vendedor: string; zona: string; tipo_sugerido: string; estado: string; motivo: string; medidas: string | null; nombre: string | null; direccion: string | null; foto_url: string | null }
type Datos = { desde: string; hasta: string; dias_habiles: number; visitas: Visita[]; contactos: Contacto[]; pdv: PDV[]; stock: Stock[]; kits: Kits[]; especiales: Especial[] }

const VEND = [{ cod: 'Lola', label: 'Lola' }, { cod: 'Bruno', label: 'Bruno' }, { cod: 'Adrian', label: 'Adrián' }]
const NOMBRE: Record<string, string> = { Lola: 'Lola', Bruno: 'Bruno', Adrian: 'Adrián' }
const ESTADOS_ESP = ['relevar', 'diseño', 'producción', 'instalado', 'descartado']
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const hoy = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
const restar = (f: string, d: number) => new Date(new Date(f + 'T12:00:00').getTime() - d * 86400000).toISOString().slice(0, 10)

export default function PanelPDV() {
  const toast = useToast()
  const [tab, setTab] = useState<'visitas' | 'marcas' | 'pdv' | 'pop' | 'especial'>('visitas')
  const [desde, setDesde] = useState(restar(hoy(), 30))
  const [hasta, setHasta] = useState(hoy())
  const [vendF, setVendF] = useState('')
  const [d, setD] = useState<Datos | null>(null)
  const [loading, setLoading] = useState(true)

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase.rpc('panel_pdv', { p_desde: desde, p_hasta: hasta })
    if (error) toast('No se pudo cargar: ' + error.message, 'error')
    setD((data as Datos) ?? null)
    setLoading(false)
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [desde, hasta])

  const pdv = useMemo(() => (d?.pdv ?? []).filter((p) => !vendF || p.vendedor === vendF), [d, vendF])

  // Participación: presencia (% de puntos de venta donde aparece) y share de exhibición (promedio de la lectura).
  const marcas = useMemo(() => {
    const m = new Map<string, { presencia: number; share: number; conShare: number }>()
    const conPart = pdv.filter((p) => (p.participacion ?? []).length > 0).length
    for (const p of pdv) {
      const vistas = new Set<string>()
      for (const x of p.marcas ?? []) vistas.add(x.trim())
      if (p.tiene_orbital) vistas.add('Orbital')
      for (const x of p.participacion ?? []) vistas.add(x.marca.trim())
      for (const k of vistas) {
        const o = m.get(k) ?? { presencia: 0, share: 0, conShare: 0 }
        o.presencia++
        m.set(k, o)
      }
      for (const x of p.participacion ?? []) {
        const o = m.get(x.marca.trim())!
        o.share += Number(x.porcentaje) || 0
        o.conShare++
      }
    }
    return [...m.entries()]
      .map(([marca, o]) => ({ marca, presencia: o.presencia, presenciaPct: pct(o.presencia, pdv.length), sharePct: conPart ? Math.round(o.share / conPart) : null }))
      .sort((a, b) => (a.marca === 'Orbital' ? -1 : b.marca === 'Orbital' ? 1 : b.presencia - a.presencia))
  }, [pdv])

  async function cambiarEspecial(e: Especial, estado: string) {
    let medidas: string | null = null
    if (estado === 'diseño') medidas = window.prompt('Medidas relevadas (ancho × alto de la vidriera y del espacio libre):', e.medidas ?? '')
    const { error } = await supabase.rpc('pdp_especial_estado', { p_cod: e.cod, p_estado: estado, p_medidas: medidas, p_notas: null })
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast('✓ Guardado', 'success')
    cargar()
  }

  async function cargarStock(vendedor: string, s: Stock) {
    const r = window.prompt(`${s.nombre} para ${NOMBRE[vendedor] ?? vendedor}\nCantidad que recibe (negativo para ajustar a la baja):`, '')
    const n = Number(r)
    if (!r || !Number.isInteger(n) || n === 0) return
    const { error } = await supabase.rpc('pop_cargar', { p_vendedor: vendedor, p_material: s.material, p_cantidad: n, p_motivo: n > 0 ? (s.saldo > 0 ? 'reposicion' : 'carga') : 'ajuste' })
    if (error) { toast('No se pudo cargar: ' + error.message, 'error'); return }
    toast('✓ Stock actualizado', 'success')
    cargar()
  }

  const tabs: { k: typeof tab; label: string }[] = [
    { k: 'visitas', label: 'Visitas y contactos' },
    { k: 'marcas', label: 'Participación de marcas' },
    { k: 'pdv', label: 'Puntos de venta (fotos)' },
    { k: 'pop', label: 'Stock POP' },
    { k: 'especial', label: 'Material especial' },
  ]

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Puntos de venta</h1>
          <p className="text-xs text-muted">Visitas contra el objetivo, cómo está la marca en cada óptica, POP en la calle y material especial</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-black/10 rounded-lg px-2 py-1" />
          <span className="text-faint">a</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-black/10 rounded-lg px-2 py-1" />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-black/10 pb-px">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${tab === t.k ? 'text-brandDark border-brand' : 'text-muted border-transparent'}`}>{t.label}</button>
        ))}
      </div>

      {loading || !d ? <p className="text-sm text-muted p-4">Cargando…</p> : (
        <>
          {(tab === 'marcas' || tab === 'pdv') && (
            <div className="flex gap-1 bg-white border border-black/10 rounded-lg p-0.5 w-fit">
              {[{ cod: '', label: 'Todos' }, ...VEND].map((v) => (
                <button key={v.cod || 'todos'} onClick={() => setVendF(v.cod)} className={`text-xs px-3 py-1.5 rounded-md font-medium ${vendF === v.cod ? 'bg-brand text-white' : 'text-muted'}`}>{v.label}</button>
              ))}
            </div>
          )}

          {tab === 'visitas' && (
            <div className="space-y-3">
              <div className="grid md:grid-cols-3 gap-2">
                {VEND.map((v) => {
                  const vis = d.visitas.filter((x) => x.vendedor === v.cod).reduce((s, x) => s + x.visitas, 0)
                  const con = d.contactos.filter((x) => x.vendedor === v.cod)
                  const hechos = con.reduce((s, x) => s + x.hechos, 0)
                  const agend = con.reduce((s, x) => s + x.agendados, 0)
                  const metaV = d.dias_habiles * 5, metaC = d.dias_habiles * 25
                  const pdvV = d.pdv.filter((p) => p.vendedor === v.cod)
                  return (
                    <div key={v.cod} className="bg-white border border-black/10 rounded-xl p-3 space-y-1.5">
                      <p className="font-bold">{v.label}</p>
                      <Barra label="Visitas" v={vis} meta={metaV} color="bg-emerald-500" />
                      <Barra label="Contactos para agendar" v={hechos} meta={metaC} color="bg-sky-500" />
                      <p className="text-[11px] text-muted">📅 {agend} visitas agendadas · 📸 {pdvV.length} ópticas con foto · {pdvV.filter((p) => p.tiene_orbital).length} con Orbital</p>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-faint">Objetivo: 5 visitas y 25 contactos por día hábil ({d.dias_habiles} días hábiles en el período). Visitas = check-ins confirmados + visitas cargadas en la agenda (una por óptica por día).</p>
              <div className="bg-white border border-black/10 rounded-xl p-3 overflow-x-auto">
                <p className="text-sm font-bold mb-2">Visitas por día</p>
                <table className="text-[12px]">
                  <thead><tr className="text-[10px] uppercase text-faint"><th className="pr-3 text-left">Fecha</th>{VEND.map((v) => <th key={v.cod} className="pr-3 text-right">{v.label}</th>)}</tr></thead>
                  <tbody>
                    {[...new Set(d.visitas.map((x) => x.fecha))].sort().reverse().map((f) => (
                      <tr key={f} className="border-t border-black/5">
                        <td className="pr-3">{ddmm(f)}</td>
                        {VEND.map((v) => {
                          const n = d.visitas.find((x) => x.fecha === f && x.vendedor === v.cod)?.visitas ?? 0
                          return <td key={v.cod} className={`pr-3 text-right tabular-nums ${n >= 5 ? 'text-emerald-700 font-semibold' : n ? '' : 'text-faint'}`}>{n}/5</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'marcas' && (
            <div className="bg-white border border-black/10 rounded-xl p-3 space-y-2">
              <p className="text-sm font-bold">Participación de marcas en {pdv.length} puntos de venta con foto</p>
              <p className="text-[11px] text-faint">Presencia: en qué % de las ópticas aparece la marca. Share de exhibición: qué parte de la vidriera ocupa en promedio (lo estima la lectura de la foto; disponible en las fotos nuevas).</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#F7F5F0] rounded-lg p-2"><p className="text-lg font-bold">{pct(pdv.filter((p) => p.tiene_orbital).length, pdv.length)}%</p><p className="text-[10px] text-muted">con Orbital</p></div>
                <div className="bg-[#F7F5F0] rounded-lg p-2"><p className="text-lg font-bold">{pct(pdv.filter((p) => p.tiene_exhibidor).length, pdv.length)}%</p><p className="text-[10px] text-muted">con exhibidor Orbital</p></div>
                <div className="bg-[#F7F5F0] rounded-lg p-2"><p className="text-lg font-bold">{pct(pdv.filter((p) => p.tiene_orbital && !p.tiene_exhibidor).length, pdv.length)}%</p><p className="text-[10px] text-muted">Orbital sin exhibidor (Kit Exhibición)</p></div>
              </div>
              <table className="w-full text-[12px]">
                <thead><tr className="text-[10px] uppercase text-faint text-left"><th className="py-1">Marca</th><th className="text-right">Ópticas</th><th className="text-right">Presencia</th><th className="text-right">Share exhibición</th><th className="pl-3">Presencia</th></tr></thead>
                <tbody>
                  {marcas.map((m) => (
                    <tr key={m.marca} className={`border-t border-black/5 ${m.marca === 'Orbital' ? 'font-semibold' : ''}`}>
                      <td className="py-1">{m.marca}</td>
                      <td className="text-right tabular-nums">{m.presencia}</td>
                      <td className="text-right tabular-nums">{m.presenciaPct}%</td>
                      <td className="text-right tabular-nums">{m.sharePct != null ? `${m.sharePct}%` : '—'}</td>
                      <td className="pl-3 w-1/3"><div className="h-1.5 bg-black/5 rounded-full overflow-hidden"><div className={`h-full ${m.marca === 'Orbital' ? 'bg-brand' : 'bg-black/30'}`} style={{ width: `${m.presenciaPct}%` }} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!marcas.length && <p className="text-[12px] text-faint">Todavía no hay fotos analizadas en el período.</p>}
            </div>
          )}

          {tab === 'pdv' && (
            <div className="grid md:grid-cols-2 gap-2">
              {pdv.map((p) => (
                <div key={p.id} className="bg-white border border-black/10 rounded-xl p-3 flex gap-3">
                  {p.foto_url && <a href={p.foto_url} target="_blank" rel="noreferrer"><img src={p.foto_url} alt="" className="w-24 h-24 object-cover rounded-lg" /></a>}
                  <div className="text-[12px] space-y-0.5 min-w-0">
                    <p className="font-semibold truncate">{p.nombre} <span className="text-faint font-normal">· {p.cod}</span></p>
                    <p className="text-muted">{NOMBRE[p.vendedor] ?? p.vendedor} · {ddmm(p.fecha)} · {p.zona}</p>
                    <p>{p.tiene_orbital ? '🟢 Orbital' : '🔴 Sin Orbital'}{p.tiene_exhibidor ? ' · con exhibidor' : p.tiene_orbital ? ' · sin exhibidor' : ''}{p.kit_instalado ? ` · 🧰 ${p.kit_instalado.toLowerCase()}` : ''}</p>
                    {!!(p.participacion ?? []).length && <p className="text-muted">📊 {(p.participacion ?? []).map((x) => `${x.marca} ${x.porcentaje}%`).join(' · ')}</p>}
                    {!(p.participacion ?? []).length && !!(p.marcas ?? []).length && <p className="text-muted">👓 {(p.marcas ?? []).join(', ')}</p>}
                    <p className="text-muted">Vidriera: espacio {p.espacio_vidriera ?? '—'} · local {p.nivel_local ?? '—'} · POP sugerido {p.pop_sugerido ?? '—'}</p>
                    {p.observaciones && <p className="text-faint">{p.observaciones}</p>}
                  </div>
                </div>
              ))}
              {!pdv.length && <p className="text-sm text-faint">No hay fotos en el período.</p>}
            </div>
          )}

          {tab === 'pop' && (
            <div className="space-y-2">
              <div className="grid md:grid-cols-3 gap-2">
                {d.kits.map((k) => (
                  <div key={k.vendedor} className="bg-white border border-black/10 rounded-xl p-3 text-[12px] space-y-1">
                    <p className="font-bold text-sm">{NOMBRE[k.vendedor] ?? k.vendedor}</p>
                    <p>🧰 Kits Exhibición disponibles: <b className={k.exhibicion < 5 ? 'text-red-600' : ''}>{k.exhibicion}</b></p>
                    <p>🏷 Kits Presencia disponibles: <b className={k.presencia < 5 ? 'text-red-600' : ''}>{k.presencia}</b></p>
                    <p className="text-muted">Instalados en el período: {k.instalados}</p>
                    <div className="border-t border-black/5 pt-1 text-muted space-y-0.5">
                      {d.stock.filter((s) => s.vendedor === k.vendedor).map((s) => (
                        <div key={s.material} className="flex items-center justify-between gap-2">
                          <span>{s.nombre}: <b className="text-ink">{s.saldo}</b></span>
                          <button onClick={() => cargarStock(k.vendedor, s)} className="text-[10px] px-1.5 py-0.5 rounded border border-black/10 text-brandDark">+ cargar</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-faint">Meta: 5 POP por día por vendedor. Kit Exhibición = exhibidor de mostrador + sticker + 10 folletos (ópticas con Orbital sin exhibidor). Kit Presencia = sticker + 20 folletos + display chico (sin Orbital). Las cargas y reposiciones las registra administración.</p>
            </div>
          )}

          {tab === 'especial' && (
            <div className="bg-white border border-black/10 rounded-xl p-3 overflow-x-auto">
              <p className="text-sm font-bold mb-1">Material especial en cabezas de zona ({d.especiales.length})</p>
              <p className="text-[11px] text-faint mb-2">Anclas con más volumen de cada vendedor. Flujo: relevar (foto frontal + medidas) → diseño → producción → instalado.</p>
              <table className="w-full text-[12px]">
                <thead><tr className="text-[10px] uppercase text-faint text-left"><th>Óptica</th><th>Vendedor</th><th>Zona</th><th>Material sugerido</th><th>Medidas</th><th>Estado</th></tr></thead>
                <tbody>
                  {d.especiales.map((e) => (
                    <tr key={e.cod} className="border-t border-black/5 align-top">
                      <td className="py-1 pr-2"><b>{e.nombre}</b> <span className="text-faint">· {e.cod}</span><br /><span className="text-faint">{e.direccion}</span>{e.foto_url && <> · <a href={e.foto_url} target="_blank" rel="noreferrer" className="text-brandDark">foto</a></>}</td>
                      <td className="pr-2">{NOMBRE[e.vendedor] ?? e.vendedor}</td>
                      <td className="pr-2">{e.zona}</td>
                      <td className="pr-2">{e.tipo_sugerido}<br /><span className="text-faint">{e.motivo}</span></td>
                      <td className="pr-2">{e.medidas ?? '—'}</td>
                      <td>
                        <select value={e.estado} onChange={(ev) => cambiarEspecial(e, ev.target.value)} className="border border-black/10 rounded px-1 py-0.5">
                          {ESTADOS_ESP.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Barra({ label, v, meta, color }: { label: string; v: number; meta: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]"><span className="text-muted">{label}</span><span className="tabular-nums font-semibold">{v}/{meta} · {pct(v, meta)}%</span></div>
      <div className="h-1.5 bg-black/5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct(v, meta))}%` }} /></div>
    </div>
  )
}
