// ── Vision Lab Pro: el Vision Lab de Orbital para cada óptica, dentro del catálogo mayorista ──
// Pacientes: los pretests que eligieron la óptica (WhatsApp / Cómo llegar) o salieron de su QR, con el mismo
// seguimiento que la Suite (estado compartido) y una nota propia. Herramientas: su QR del pretest (?o=<cod>,
// queda atribuido), estudio de rostro, medición de calce y el buscador de la red. Solo con la clave de la óptica:
// catalogo_pretests / catalogo_pretest_actualizar (supabase/sql/catalogo_pretests.sql).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { X, Copy, Check, Download, ExternalLink, ScanFace, Glasses, Eye, MapPin, MessageCircle, QrCode } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { PerfilCalce, PerfilRostro } from '../visionlab/perfil'
import { FORMAS } from '../visionlab/rostro/medidas'
import { nombreObraSocial } from '../visionlab/obras'

type Estado = 'nuevo' | 'contactado' | 'turno' | 'vendido' | 'descartado'
type Semaforo = 'verde' | 'amarillo' | 'rojo'
interface Paciente {
  id: string; code: string; created_at: string; origen: string
  nombre: string | null; edad: number | null; usa: string | null; indice: number | null; semaforo: Semaforo | null
  ticket: string | null; localidad: string | null; obra_social: string | null; modelo_buscado: string | null
  derivado: boolean; eligio: boolean; de_mi_qr: boolean; estado: Estado; nota_optica: string | null; con_receta: boolean
  extras: { dp?: { lejos: number; cerca: number }; dominante?: 'R' | 'L'; fatiga?: { parpadeos: number; sintomas: number }; sugerencias?: string[]; rostro?: PerfilRostro; calces?: PerfilCalce[] }
}

const ESTADOS: { k: Estado; t: string }[] = [
  { k: 'nuevo', t: 'Nuevo' }, { k: 'contactado', t: 'Contactado' }, { k: 'turno', t: 'Con turno' },
  { k: 'vendido', t: 'Vendido' }, { k: 'descartado', t: 'Descartado' },
]
const SEM: Record<Semaforo, { t: string; c: string }> = {
  rojo: { t: 'Consultar pronto', c: 'bg-red-50 text-red-700' },
  amarillo: { t: 'Revisar en consulta', c: 'bg-amber-50 text-amber-700' },
  verde: { t: 'Sin alertas', c: 'bg-emerald-50 text-emerald-700' },
}
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function VisionLabPro({ clave, cod, onClose }: { clave: string; cod: string | null; onClose: () => void }) {
  const [solapa, setSolapa] = useState<'pacientes' | 'herramientas'>(cod ? 'pacientes' : 'herramientas')
  const [pacientes, setPacientes] = useState<Paciente[] | null>(null)
  const [fEst, setFEst] = useState<Estado | ''>('')
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    if (!cod) return
    supabase.rpc('catalogo_pretests', { p_clave: clave }).then(({ data }) => setPacientes((data as Paciente[]) ?? []))
  }, [clave, cod])

  const kpi = useMemo(() => {
    const l = pacientes ?? []
    const hace30 = Date.now() - 30 * 864e5
    return {
      total: l.length,
      mes: l.filter((x) => +new Date(x.created_at) >= hace30).length,
      urgentes: l.filter((x) => x.semaforo === 'rojo').length,
      abiertos: l.filter((x) => x.estado === 'nuevo').length,
      vendidos: l.filter((x) => x.estado === 'vendido').length,
    }
  }, [pacientes])
  const visibles = (pacientes ?? []).filter((p) => !fEst || p.estado === fEst)

  async function guardar(p: Paciente, cambios: { estado?: Estado; nota_optica?: string }) {
    setPacientes((ls) => ls?.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)) ?? null)
    await supabase.rpc('catalogo_pretest_actualizar', { p_clave: clave, p_id: p.id, p_estado: cambios.estado ?? null, p_nota: cambios.nota_optica ?? null })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col">
        <div className="px-4 pt-3 pb-2 border-b border-black/5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-[0.08em] flex items-center gap-2">
                Vision Lab <span className="text-[10px] tracking-widest rounded-full bg-[#0004FF] text-white px-2 py-0.5">PRO</span>
              </h2>
              <p className="text-[11px] text-neutral-500 font-sans">Pacientes que llegan a tu óptica con el pretest visual de Orbital, y las herramientas para atenderlos.</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5 shrink-0"><X size={20} /></button>
          </div>
          <div className="flex gap-1 mt-2">
            {([['pacientes', `Pacientes${pacientes ? ` · ${pacientes.length}` : ''}`], ['herramientas', 'Herramientas']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSolapa(k)}
                className={`whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full border ${solapa === k ? 'bg-[#0a0a0a] text-white border-transparent' : 'bg-white border-black/10 text-neutral-600'}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-4 font-sans">
          {solapa === 'herramientas' && <Herramientas cod={cod} />}

          {solapa === 'pacientes' && !cod && (
            <p className="text-sm text-neutral-600 leading-relaxed">Los pacientes son de cada óptica: se ven con <b>su link personal del catálogo</b>. Ahí aparecen los que la eligieron en el pretest o lo hicieron con su QR. En la Suite están todos en <b>Vision Lab</b>.</p>
          )}
          {solapa === 'pacientes' && cod && (
            <>
              {!pacientes && <p className="text-sm text-neutral-400 text-center py-10">Cargando…</p>}
              {pacientes && !pacientes.length && (
                <div className="rounded-xl border border-dashed border-black/20 p-6 text-center">
                  <QrCode size={26} className="mx-auto text-neutral-400" />
                  <p className="text-[14px] font-bold mt-2">Todavía no tenés pacientes del pretest</p>
                  <p className="text-[12px] text-neutral-600 mt-1 max-w-md mx-auto">Poné tu QR en el mostrador o mandá tu link por WhatsApp: la persona hace el chequeo visual en 5 minutos desde el celular y te llega acá, con su resultado, su rostro y los armazones que se midió.</p>
                  <button onClick={() => setSolapa('herramientas')} className="mt-3 bg-[#0004FF] text-white rounded-full px-4 py-2 text-[12px] font-semibold">Ver mi QR y mi link</button>
                </div>
              )}
              {pacientes && pacientes.length > 0 && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    {[
                      { t: 'Pacientes', v: kpi.total, s: `${kpi.mes} en 30 días` },
                      { t: 'Sin contactar', v: kpi.abiertos, s: 'estado Nuevo' },
                      { t: 'Consultar pronto', v: kpi.urgentes, s: 'resultado en rojo' },
                      { t: 'Vendidos', v: kpi.vendidos, s: kpi.total ? `${Math.round((kpi.vendidos / kpi.total) * 100)}% del total` : '—' },
                    ].map((k) => (
                      <div key={k.t} className="rounded-xl border border-black/10 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">{k.t}</div>
                        <div className="text-[22px] font-bold tabular-nums leading-tight">{k.v}</div>
                        <div className="text-[11px] text-neutral-500">{k.s}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <select value={fEst} onChange={(e) => setFEst(e.target.value as Estado | '')} className="rounded-lg border border-black/10 px-2 py-1.5 text-[12px]">
                      <option value="">Todos los estados</option>
                      {ESTADOS.map((e) => <option key={e.k} value={e.k}>{e.t}</option>)}
                    </select>
                    <span className="text-[11px] text-neutral-400">{visibles.length} de {kpi.total}</span>
                  </div>
                  <div className="space-y-2">
                    {visibles.map((p) => (
                      <div key={p.id} className="rounded-xl border border-black/10 p-3">
                        <div className="flex gap-3 items-start">
                          <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[13px] font-bold font-mono">{p.code}</span>
                              {p.semaforo && <span className={`text-[9px] uppercase font-bold rounded px-1.5 py-0.5 ${SEM[p.semaforo].c}`}>{SEM[p.semaforo].t}</span>}
                              <span className="text-[12px] font-bold tabular-nums">{p.indice ?? '—'}/100</span>
                              <span className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5 bg-neutral-100 text-neutral-500">{p.de_mi_qr ? 'Tu QR' : 'Te eligió'}</span>
                            </div>
                            <div className="text-[12px] text-neutral-700 mt-0.5">
                              {[p.nombre, p.edad ? `${p.edad} años` : null, p.usa === 'si' ? 'usa anteojos' : p.usa === 'viejos' ? 'anteojos viejos' : null, p.localidad, p.obra_social ? nombreObraSocial(p.obra_social) : null]
                                .filter(Boolean).join(' · ') || 'Sin datos personales'}
                            </div>
                            <div className="text-[11px] text-neutral-500 mt-0.5">{fecha(p.created_at)}{p.modelo_buscado && <> · buscó <b>{p.modelo_buscado}</b></>}</div>
                          </button>
                          <select value={p.estado} onChange={(e) => guardar(p, { estado: e.target.value as Estado })} className="rounded-lg border border-black/10 px-2 py-1 text-[12px]">
                            {ESTADOS.map((e) => <option key={e.k} value={e.k}>{e.t}</option>)}
                          </select>
                        </div>
                        {abierto === p.id && (
                          <div className="mt-3 space-y-2">
                            <div className="text-[12px] text-neutral-700 bg-[#F5F5F7] rounded-lg p-2 space-y-0.5">
                              {p.extras.rostro && <div><b>Rostro</b> {FORMAS[p.extras.rostro.forma]?.nombre.toLowerCase() ?? p.extras.rostro.forma} · talle {p.extras.rostro.talle} · frente ideal {p.extras.rostro.ideal} mm ({p.extras.rostro.rango[0]}–{p.extras.rostro.rango[1]})</div>}
                              {p.extras.calces?.length ? <div><b>Se midió</b> {p.extras.calces.map((c) => `${c.modelo} (calce ${c.calce} %)`).join(' · ')}</div> : null}
                              {p.extras.dp && <div><b>DP</b> {p.extras.dp.lejos} mm de lejos · {p.extras.dp.cerca} de cerca</div>}
                              {p.extras.dominante && <div><b>Ojo dominante</b> {p.extras.dominante === 'R' ? 'derecho' : 'izquierdo'}</div>}
                              {p.extras.fatiga && <div><b>Pantallas</b> {p.extras.fatiga.parpadeos} parpadeos/min · {p.extras.fatiga.sintomas}/3 síntomas de cansancio</div>}
                              {p.extras.sugerencias?.map((s) => <div key={s}>· {s}</div>)}
                              {p.derivado && <div>Derivado a un oftalmólogo de la red Orbital.</div>}
                              {p.con_receta && <div>Subió foto de su receta: pedísela cuando venga.</div>}
                            </div>
                            {p.ticket && <pre className="text-[11px] font-mono whitespace-pre-wrap bg-neutral-50 rounded-lg p-2 border border-black/5">{p.ticket}</pre>}
                            <textarea defaultValue={p.nota_optica ?? ''}
                              onBlur={(e) => { if (e.target.value !== (p.nota_optica ?? '')) guardar(p, { nota_optica: e.target.value }) }}
                              placeholder="Tu nota (cuándo vino, qué se llevó, a quién lo derivaste…)"
                              className="w-full rounded-lg border border-black/10 p-2 text-[12px]" rows={2} />
                            <p className="text-[10px] text-neutral-400">El pretest es orientativo, no reemplaza la consulta con el oftalmólogo.</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Herramientas para compartir: el pretest con el código de la óptica queda atribuido a ella.
function Herramientas({ cod }: { cod: string | null }) {
  const base = window.location.origin
  const pretest = `${base}/lab/pretest${cod ? `?o=${encodeURIComponent(cod)}` : ''}`
  const [qr, setQr] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(pretest, { margin: 1, width: 720, errorCorrectionLevel: 'M', color: { dark: '#050505', light: '#ffffff' } }).then(setQr).catch(() => setQr(null))
  }, [pretest])
  const copiar = (u: string) => { navigator.clipboard?.writeText(u); setCopiado(u); setTimeout(() => setCopiado(null), 1500) }
  const wa = `https://wa.me/?text=${encodeURIComponent(`Hacé el chequeo visual gratis desde el celu (5 minutos) y traelo a la óptica: ${pretest}`)}`
  const tools = [
    { ic: <Eye size={18} />, t: 'Pretest visual', d: 'Agudeza, contraste, astigmatismo, cerca y pantallas. 5 minutos.', u: pretest },
    { ic: <ScanFace size={18} />, t: 'Estudio de rostro', d: 'Forma del rostro, talle y los armazones que le van.', u: `${base}/lab/rostro` },
    { ic: <Glasses size={18} />, t: 'Medición de calce', d: 'Se pone el armazón y mide marco vs. rostro y la pupila en el lente.', u: `${base}/lab/calce` },
    { ic: <MapPin size={18} />, t: 'Red oftalmológica', d: 'Buscador de oftalmólogos y ópticas Orbital, por zona y obra social.', u: `${base}/lab/buscar` },
  ]
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#050505] text-white p-4 flex flex-col sm:flex-row gap-4 items-center">
        <div className="bg-white rounded-lg p-2 shrink-0">{qr ? <img src={qr} alt="QR del pretest" className="w-36 h-36" /> : <div className="w-36 h-36" />}</div>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <p className="text-[10px] font-mono tracking-widest opacity-60">{cod ? 'TU QR · QUEDA A NOMBRE DE TU ÓPTICA' : 'QR GENERAL'}</p>
          <p className="text-[17px] font-bold mt-1">Chequeo visual gratis en el mostrador</p>
          <p className="text-[12px] opacity-75 mt-1">{cod
            ? 'Imprimilo para la vidriera o el mostrador. Cada persona que lo escanea y termina el pretest te aparece en Pacientes.'
            : 'Link sin óptica asignada. Con el link personal de cada óptica, este QR sale a su nombre y los pacientes le llegan a ella.'}</p>
          <div className="flex flex-wrap gap-2 mt-3 justify-center sm:justify-start">
            {qr && <a href={qr} download="QR-pretest-Orbital.png" className="inline-flex items-center gap-1.5 bg-white text-black rounded-full px-3 py-1.5 text-[12px] font-semibold"><Download size={14} /> Bajar QR</a>}
            <button onClick={() => copiar(pretest)} className="inline-flex items-center gap-1.5 border border-white/30 rounded-full px-3 py-1.5 text-[12px] font-semibold">{copiado === pretest ? <Check size={14} /> : <Copy size={14} />} Copiar link</button>
            <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 border border-white/30 rounded-full px-3 py-1.5 text-[12px] font-semibold"><MessageCircle size={14} /> WhatsApp</a>
          </div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {tools.map((x) => <HerramientaLab key={x.t} {...x} />)}
      </div>
    </div>
  )
}

// Tarjeta de una herramienta del Vision Lab (también la usa el panel de colaboradores)
export function HerramientaLab({ ic, t, d, u }: { ic: ReactNode; t: string; d: string; u: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="rounded-xl border border-black/10 bg-white p-3 flex gap-3">
      <div className="w-9 h-9 rounded-lg bg-[#0004FF]/10 text-[#0004FF] flex items-center justify-center shrink-0">{ic}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">{t}</p>
        <p className="text-[11px] text-neutral-500 leading-snug">{d}</p>
        <div className="flex gap-3 mt-1.5">
          <a href={u} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#0004FF]"><ExternalLink size={12} /> Abrir</a>
          <button onClick={() => { navigator.clipboard?.writeText(u); setCopiado(true); setTimeout(() => setCopiado(false), 1500) }}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-neutral-600">{copiado ? <Check size={12} /> : <Copy size={12} />} Copiar link</button>
        </div>
      </div>
    </div>
  )
}
