// ── Orbital Vision Lab · leads del pretest ──────────────────────────────────────────
// Cada pretest terminado queda en `pretests` con su código ORB-XXXX-MMDD (la persona lo dice en
// la óptica). Se ve en tiempo real; acá se sigue el lead: contactado → turno → vendido.
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, QrCode, Copy, Check, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { PerfilCalce, PerfilRostro } from './perfil'
import { FORMAS } from './rostro/medidas'
import { nombreObraSocial } from './obras'

type Estado = 'nuevo' | 'contactado' | 'turno' | 'vendido' | 'descartado'
type Semaforo = 'verde' | 'amarillo' | 'rojo'
interface Lead {
  id: string; code: string; created_at: string; origen: string; optica_origen: string | null
  nombre: string | null; edad: number | null; usa: string | null; indice: number | null; semaforo: Semaforo | null
  ticket: string | null; localidad: string | null; obra_social: string | null
  /** Red (2026-10-05): oftalmólogo de la red al que se lo derivó y modelo que buscó en las ópticas. */
  oftalmologo_id?: number | null; modelo_buscado?: string | null
  optica_cod: string | null; optica_click_at: string | null; estado: Estado; nota: string | null
  /** Nota que deja la óptica desde Vision Lab Pro (catálogo). */
  nota_optica?: string | null
  extras: Extras | null
}

// Extras del pretest (2026-10-02): DP con tarjeta, duocromo, espejo, hábitos, cansancio por pantallas, ojo dominante.
interface Extras {
  dp?: { lejos: number; cerca: number }; espejo?: boolean; dominante?: 'R' | 'L'
  fatiga?: { parpadeos: number; sintomas: number }; sugerencias?: string[]
  /** Foto de la receta en el bucket privado `recetas`. */
  receta?: string
  /** Estudio de rostro (perfil visual): forma, talle y medidas para elegir el armazón. */
  rostro?: PerfilRostro
  /** Armazones que se midió en vivo (medición de calce). */
  calces?: PerfilCalce[]
}

const ESTADOS: { k: Estado; t: string }[] = [
  { k: 'nuevo', t: 'Nuevo' },
  { k: 'contactado', t: 'Contactado' },
  { k: 'turno', t: 'Con turno' },
  { k: 'vendido', t: 'Vendido' },
  { k: 'descartado', t: 'Descartado' },
]
const SEM: Record<Semaforo, { t: string; c: string }> = {
  rojo: { t: 'Urgente', c: 'bg-red-50 text-red-700' },
  amarillo: { t: 'Consulta', c: 'bg-amber-50 text-amber-700' },
  verde: { t: 'Bien', c: 'bg-emerald-50 text-emerald-700' },
}
const ORIGEN: Record<string, string> = { web: 'Web', tienda: 'Tienda', qr: 'QR óptica', suite: 'Suite', berabbit: 'beRabbit' }
// Link público principal: el perfil visual completo (rostro, calce y chequeo); cada prueba suelta va en los atajos.
const PUBLICO = `${window.location.origin}/lab`

const fecha = (s: string) =>
  new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function VisionLabPanel() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [opticas, setOpticas] = useState<Record<string, string>>({})
  const [fSem, setFSem] = useState<Semaforo | ''>('')
  const [fEst, setFEst] = useState<Estado | ''>('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('pretests').select('*').order('created_at', { ascending: false }).limit(500)
    setLeads((data as Lead[]) ?? [])
  }
  useEffect(() => {
    cargar()
    const ch = supabase.channel('pretests-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'pretests' }, cargar).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  // Nombres de las ópticas elegidas / de origen
  useEffect(() => {
    const cods = [...new Set((leads ?? []).flatMap((l) => [l.optica_cod, l.optica_origen]).filter((c): c is string => !!c && !(c in opticas)))]
    if (!cods.length) return
    supabase.from('clientes').select('cod, nombre_publico, nomcomerc, razon, localidad').in('cod', cods).then(({ data }) => {
      const m: Record<string, string> = {}
      for (const c of data ?? []) m[c.cod] = `${c.nombre_publico || c.nomcomerc || c.razon}${c.localidad ? ' · ' + c.localidad : ''}`
      setOpticas((o) => ({ ...o, ...m }))
    })
  }, [leads]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const l = leads ?? []
    const hace7 = Date.now() - 7 * 864e5
    const hoy = new Date().toDateString()
    return {
      total: l.length,
      hoy: l.filter((x) => new Date(x.created_at).toDateString() === hoy).length,
      semana: l.filter((x) => +new Date(x.created_at) >= hace7).length,
      rojo: l.filter((x) => x.semaforo === 'rojo').length,
      amarillo: l.filter((x) => x.semaforo === 'amarillo').length,
      conOptica: l.filter((x) => x.optica_cod).length,
      vendidos: l.filter((x) => x.estado === 'vendido').length,
    }
  }, [leads])

  const visibles = (leads ?? []).filter((l) => (!fSem || l.semaforo === fSem) && (!fEst || l.estado === fEst))

  // La receta está en un bucket privado: se abre con un link firmado de 10 minutos.
  async function verReceta(path: string) {
    const w = window.open('', '_blank')
    const { data } = await supabase.storage.from('recetas').createSignedUrl(path, 600)
    if (data?.signedUrl && w) w.location.href = data.signedUrl
    else w?.close()
  }

  async function guardar(l: Lead, cambios: Partial<Pick<Lead, 'estado' | 'nota'>>) {
    setLeads((ls) => ls?.map((x) => (x.id === l.id ? { ...x, ...cambios } : x)) ?? null)
    await supabase.from('pretests').update(cambios).eq('id', l.id)
  }

  const pct = (n: number) => (kpi.total ? Math.round((n / kpi.total) * 100) + '%' : '—')

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start gap-3 justify-between">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Vision Lab · leads del pretest</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            Personas que hicieron el pretest visual. El código ORB lo dicen en la óptica; la óptica elegida es la que tocaron (WhatsApp o Cómo llegar).
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/vision-lab/perfil" className="rounded-lg bg-black text-white px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            <Sparkles size={12} /> Perfil visual completo
          </a>
          <span className="self-center text-[10px] uppercase tracking-widest text-neutral-400 px-1">Atajos</span>
          <a href="/lab/rostro" target="_blank" rel="noopener" className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            <ExternalLink size={12} /> Estudio de rostro
          </a>
          <a href="/vision-lab/calce" className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            Medición de calce
          </a>
          <a href="/vision-lab/red" className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            Red oftalmológica
          </a>
          <a href="/lab/pretest?src=suite" target="_blank" rel="noopener" className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            <ExternalLink size={12} /> Chequeo visual
          </a>
          <button
            onClick={() => { navigator.clipboard.writeText(PUBLICO).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
            className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
            {copiado ? <Check size={12} /> : <Copy size={12} />} Link del perfil visual
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { t: 'Pretests', v: kpi.total, s: `${kpi.hoy} hoy · ${kpi.semana} en 7 días` },
          { t: 'Urgentes', v: kpi.rojo, s: `${pct(kpi.rojo)} · consulta ${pct(kpi.amarillo)}` },
          { t: 'Eligieron óptica', v: kpi.conOptica, s: pct(kpi.conOptica) },
          { t: 'Vendidos', v: kpi.vendidos, s: pct(kpi.vendidos) },
        ].map((k) => (
          <div key={k.t} className="bg-white rounded-xl border border-black/10 p-3">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">{k.t}</div>
            <div className="text-[22px] font-bold tabular-nums leading-tight">{k.v}</div>
            <div className="text-[11px] text-neutral-500">{k.s}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select value={fSem} onChange={(e) => setFSem(e.target.value as Semaforo | '')} className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          <option value="">Todos los resultados</option>
          <option value="rojo">Urgentes</option>
          <option value="amarillo">Consulta</option>
          <option value="verde">Bien</option>
        </select>
        <select value={fEst} onChange={(e) => setFEst(e.target.value as Estado | '')} className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e.k} value={e.k}>{e.t}</option>)}
        </select>
        <span className="text-[11px] text-neutral-400">{visibles.length} de {kpi.total}</span>
      </div>

      {!leads && <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>}
      {leads && !leads.length && (
        <div className="rounded-xl border border-dashed border-black/20 bg-white p-6 text-center text-[12px] text-neutral-600">
          <QrCode size={20} className="mx-auto mb-2 text-neutral-400" />
          Todavía nadie hizo el pretest. Compartí el link público o poné el QR en las ópticas (con <code>?o=CODIGO</code> queda atribuido a esa óptica).
        </div>
      )}

      <div className="space-y-2">
        {visibles.map((l) => (
          <div key={l.id} className="bg-white rounded-xl border border-black/10 p-3">
            <div className="flex gap-3 items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setAbierto(abierto === l.id ? null : l.id)} className="text-[13px] font-bold font-mono hover:underline">{l.code}</button>
                  {l.semaforo && <span className={`text-[9px] uppercase font-bold rounded px-1.5 py-0.5 ${SEM[l.semaforo].c}`}>{SEM[l.semaforo].t}</span>}
                  <span className="text-[12px] font-bold tabular-nums">{l.indice ?? '—'}/100</span>
                  <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-500">{ORIGEN[l.origen] ?? l.origen}</span>
                </div>
                <div className="text-[12px] text-neutral-700 mt-0.5">
                  {[l.nombre, l.edad ? `${l.edad} años` : null, l.usa === 'si' ? 'usa anteojos' : l.usa === 'viejos' ? 'anteojos viejos' : null, l.localidad, l.obra_social ? nombreObraSocial(l.obra_social) : null]
                    .filter(Boolean).join(' · ') || 'Sin datos personales'}
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  {fecha(l.created_at)}
                  {l.optica_cod && <> · eligió <b>{opticas[l.optica_cod] ?? l.optica_cod}</b></>}
                  {l.optica_origen && <> · QR de {opticas[l.optica_origen] ?? l.optica_origen}</>}
                </div>
              </div>
              <select value={l.estado} onChange={(e) => guardar(l, { estado: e.target.value as Estado })} className="rounded-lg border border-black/10 px-2 py-1 text-[12px]">
                {ESTADOS.map((e) => <option key={e.k} value={e.k}>{e.t}</option>)}
              </select>
            </div>
            {abierto === l.id && (
              <div className="mt-3 space-y-2">
                {l.nota_optica && <div className="text-[12px] rounded-lg p-2 border border-[#0004FF]/20 bg-[#0004FF]/[0.04]"><b>Nota de la óptica</b> {l.nota_optica}</div>}
                {l.ticket && <pre className="text-[11px] font-mono whitespace-pre-wrap bg-neutral-50 rounded-lg p-2 border border-black/5">{l.ticket}</pre>}
                {l.extras && (l.extras.dp || l.extras.fatiga || l.extras.dominante || l.extras.sugerencias || l.extras.receta || l.extras.rostro || l.extras.calces?.length || l.modelo_buscado || l.oftalmologo_id) && (
                  <div className="text-[12px] text-neutral-700 bg-amber-50/60 rounded-lg p-2 border border-black/5 space-y-0.5">
                    {l.extras.rostro && <div><b>Rostro</b> {FORMAS[l.extras.rostro.forma]?.nombre.toLowerCase() ?? l.extras.rostro.forma} · talle {l.extras.rostro.talle} · frente ideal {l.extras.rostro.ideal} mm ({l.extras.rostro.rango[0]}–{l.extras.rostro.rango[1]}) · ancho de cara {l.extras.rostro.mm.pomulos} mm</div>}
                    {l.modelo_buscado && <div><b>Buscó en ópticas</b> {l.modelo_buscado}</div>}
                    {l.oftalmologo_id && <div><b>Derivado</b> a un oftalmólogo de la red (#{l.oftalmologo_id}) · <a href="/vision-lab/red" className="underline">ver red</a></div>}
                    {l.extras.calces?.length ? <div><b>Calce</b> {l.extras.calces.map((c) => `${c.modelo} ${c.calce} % (pupila ${c.pupila} %)`).join(' · ')}</div> : null}
                    {l.extras.dp && <div><b>DP</b> {l.extras.dp.lejos} mm de lejos · {l.extras.dp.cerca} de cerca (tarjeta en la frente): lista para venta online</div>}
                    {l.extras.espejo && <div>Visión de lejos hecha frente a un espejo</div>}
                    {l.extras.dominante && <div><b>Ojo dominante</b> {l.extras.dominante === 'R' ? 'derecho' : 'izquierdo'}</div>}
                    {l.extras.fatiga && <div><b>Pantallas</b> {l.extras.fatiga.parpadeos} parpadeos/min · {l.extras.fatiga.sintomas}/3 síntomas</div>}
                    {l.extras.sugerencias?.map((s) => <div key={s}>· {s}</div>)}
                    {l.extras.receta && <button onClick={() => verReceta(l.extras!.receta!)} className="mt-1 rounded-lg border border-black/15 bg-white px-2 py-1 text-[11px] font-semibold">Ver receta subida</button>}
                  </div>
                )}
                <textarea
                  defaultValue={l.nota ?? ''}
                  onBlur={(e) => { if (e.target.value !== (l.nota ?? '')) guardar(l, { nota: e.target.value }) }}
                  placeholder="Nota interna (a qué óptica se derivó, qué pasó…)"
                  className="w-full rounded-lg border border-black/10 p-2 text-[12px]" rows={2} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
