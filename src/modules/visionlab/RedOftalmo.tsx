// ── Orbital Vision Lab · Red oftalmológica (Suite: /vision-lab/red) ───────────────────────────
// Estrategia: le hablamos al consumidor final (perfil visual) → le recomendamos un oftalmólogo de esta red (por zona y
// cartilla) → con la receta, la óptica cliente que tiene el modelo que eligió. Acá se arma la red y se ve qué mover:
//  · embudo de 90 días: consumidores → derivados a oftalmólogo → receta → óptica elegida → vendido;
//  · ranking de oftalmólogos por derivaciones y cartillas premium, para negociar acuerdos (prospecto → acuerdo → socio);
//  · ópticas cliente que más pacientes recibieron (para mostrarles el valor de la red);
//  · alta manual e importación pegando una planilla.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { OBRAS } from './obras'

type Nivel = 'prospecto' | 'contactado' | 'acuerdo' | 'socio' | 'descartado'
interface Oftalmologo {
  id: number; nombre: string; centro: string | null; subespecialidad: string | null; matricula: string | null
  direccion: string | null; barrio: string | null; localidad: string | null; provincia: string | null
  telefono: string | null; whatsapp: string | null; web: string | null; cartillas: string[]; particular: boolean
  rating: number | null; resenas: number | null; fuente: string | null; nivel: Nivel; publico: boolean; notas: string | null
  deriv_90d: number; deriv_total: number; cartillas_premium: number
}
interface Embudo { total: number; derivados: number; receta: number; optica: number; modelo: number; vendido: number }

const NIVELES: { k: Nivel; t: string; c: string }[] = [
  { k: 'prospecto', t: 'Prospecto', c: 'bg-neutral-100 text-neutral-700' },
  { k: 'contactado', t: 'Contactado', c: 'bg-sky-50 text-sky-800' },
  { k: 'acuerdo', t: 'Acuerdo', c: 'bg-emerald-50 text-emerald-800' },
  { k: 'socio', t: 'Socio', c: 'bg-amber-100 text-amber-900' },
  { k: 'descartado', t: 'Descartado', c: 'bg-neutral-50 text-neutral-400' },
]
const PREMIUM = ['osde', 'swiss', 'galeno', 'medife', 'omint', 'hospital-italiano', 'hospital-aleman', 'medicus', 'sancor', 'accord']
const nombreOs = (id: string) => OBRAS.find((o) => o.id === id)?.corto ?? OBRAS.find((o) => o.id === id)?.nombre ?? id
const VACIO = { nombre: '', centro: '', subespecialidad: '', direccion: '', barrio: '', localidad: '', provincia: '', telefono: '', whatsapp: '', web: '', fuente: '', cartillas: [] as string[] }

/** "OSDE | Swiss Medical" → ['osde','swiss'] (por id, nombre o nombre corto). */
function cartillasDe(txt: string) {
  return txt.split(/[|,/]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).map((x) =>
    OBRAS.find((o) => o.id === x || o.nombre.toLowerCase() === x || (o.corto ?? '').toLowerCase() === x || o.nombre.toLowerCase().startsWith(x))?.id ?? x)
}

export default function RedOftalmo() {
  const [lista, setLista] = useState<Oftalmologo[] | null>(null)
  const [emb, setEmb] = useState<Embudo | null>(null)
  const [opticas, setOpticas] = useState<{ cod: string; n: number }[]>([])
  const [filtro, setFiltro] = useState<Nivel | 'todos'>('todos')
  const [q, setQ] = useState('')
  const [alta, setAlta] = useState(false)
  const [form, setForm] = useState(VACIO)
  const [importar, setImportar] = useState(false)
  const [pegado, setPegado] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase.from('v_oftalmo_ranking').select('*').limit(1000)
    setLista((data as Oftalmologo[] | null) ?? [])
  }
  useEffect(() => {
    cargar()
    const desde = new Date(Date.now() - 90 * 864e5).toISOString()
    supabase.from('pretests').select('oftalmologo_id, optica_cod, modelo_buscado, estado, extras').gte('created_at', desde).limit(5000)
      .then(({ data }) => {
        const r = (data ?? []) as { oftalmologo_id: number | null; optica_cod: string | null; modelo_buscado: string | null; estado: string; extras: { receta?: string } | null }[]
        setEmb({
          total: r.length, derivados: r.filter((x) => x.oftalmologo_id).length, receta: r.filter((x) => x.extras?.receta).length,
          optica: r.filter((x) => x.optica_cod).length, modelo: r.filter((x) => x.modelo_buscado).length, vendido: r.filter((x) => x.estado === 'vendido').length,
        })
        const por = new Map<string, number>()
        r.forEach((x) => x.optica_cod && por.set(x.optica_cod, (por.get(x.optica_cod) ?? 0) + 1))
        setOpticas([...por.entries()].map(([cod, n]) => ({ cod, n })).sort((a, b) => b.n - a.n).slice(0, 8))
      })
  }, [])

  const vista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (lista ?? [])
      .filter((o) => filtro === 'todos' || o.nivel === filtro)
      .filter((o) => !t || [o.nombre, o.centro, o.localidad, o.barrio, o.provincia, o.subespecialidad].some((x) => (x ?? '').toLowerCase().includes(t)))
      .sort((a, b) => b.deriv_90d - a.deriv_90d || b.cartillas_premium - a.cartillas_premium || (b.rating ?? 0) - (a.rating ?? 0))
  }, [lista, filtro, q])

  async function cambiar(o: Oftalmologo, c: Partial<Oftalmologo>) {
    setLista((ls) => ls?.map((x) => (x.id === o.id ? { ...x, ...c } : x)) ?? null)
    await supabase.from('oftalmologos').update(c).eq('id', o.id)
  }

  const limpio = (v: string) => v.trim() || null
  async function guardarAlta() {
    if (!form.nombre.trim()) return
    const { error } = await supabase.from('oftalmologos').insert({
      nombre: form.nombre.trim(), centro: limpio(form.centro), subespecialidad: limpio(form.subespecialidad), direccion: limpio(form.direccion),
      barrio: limpio(form.barrio), localidad: limpio(form.localidad), provincia: limpio(form.provincia), telefono: limpio(form.telefono),
      whatsapp: limpio(form.whatsapp), web: limpio(form.web), fuente: limpio(form.fuente) ?? 'manual', cartillas: form.cartillas,
    })
    setMsg(error ? 'No se pudo guardar: ' + error.message : 'Oftalmólogo agregado.')
    if (!error) { setForm(VACIO); setAlta(false); cargar() }
  }

  // Planilla pegada (Excel / Google Sheets): nombre, centro, dirección, barrio, localidad, provincia, teléfono, whatsapp, web, cartillas (OSDE | Swiss…), fuente
  async function guardarImport() {
    const filas = pegado.split(/\r?\n/).map((l) => l.split(/\t|;/)).filter((c) => c[0]?.trim() && !/^nombre$/i.test(c[0].trim()))
    if (!filas.length) return
    const rows = filas.map((c) => ({
      nombre: c[0].trim(), centro: limpio(c[1] ?? ''), direccion: limpio(c[2] ?? ''), barrio: limpio(c[3] ?? ''), localidad: limpio(c[4] ?? ''),
      provincia: limpio(c[5] ?? ''), telefono: limpio(c[6] ?? ''), whatsapp: limpio(c[7] ?? ''), web: limpio(c[8] ?? ''),
      cartillas: cartillasDe(c[9] ?? ''), fuente: limpio(c[10] ?? '') ?? 'importación',
    }))
    const { error } = await supabase.from('oftalmologos').insert(rows)
    setMsg(error ? 'No se pudo importar: ' + error.message : `${rows.length} oftalmólogos importados.`)
    if (!error) { setPegado(''); setImportar(false); cargar() }
  }

  const pasos: [string, number][] = emb ? [
    ['Consumidores (perfil / chequeo)', emb.total], ['Derivados a oftalmólogo', emb.derivados], ['Subieron la receta', emb.receta],
    ['Eligieron óptica', emb.optica], ['Buscaron su modelo', emb.modelo], ['Vendidos', emb.vendido],
  ] : []
  const inp = 'rounded-lg border border-black/15 px-2 py-1.5 text-[12px] w-full'

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start gap-3 justify-between">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Vision Lab · red oftalmológica</h1>
          <p className="text-[11px] text-neutral-500 mt-1 max-w-xl">
            Consumidor final → oftalmólogo de la red (receta) → óptica cliente con su modelo. Cada derivación queda registrada: es la base para negociar acuerdos con oftalmólogos y mostrarle a cada óptica los pacientes que le mandamos.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/vision-lab" className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold">Leads</a>
          <button onClick={() => { setAlta(!alta); setImportar(false) }} className="rounded-lg bg-black text-white px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1"><Plus size={12} />Agregar</button>
          <button onClick={() => { setImportar(!importar); setAlta(false) }} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1"><Upload size={12} />Importar planilla</button>
        </div>
      </div>
      {msg && <div className="mb-3 text-[12px] rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">{msg}</div>}

      {/* Embudo */}
      <div className="rounded-xl border border-black/10 bg-white p-3 mb-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-2">Embudo · últimos 90 días</div>
        {!emb ? <div className="text-[12px] text-neutral-400">Cargando…</div> : (
          <div className="space-y-1.5">
            {pasos.map(([t, n]) => (
              <div key={t} className="grid grid-cols-[170px_1fr_70px] items-center gap-2 text-[12px]">
                <span className="text-neutral-700">{t}</span>
                <span className="h-3 rounded bg-neutral-100 overflow-hidden"><i className="block h-full rounded bg-[#a87a35]" style={{ width: `${emb.total ? Math.max(2, (n / emb.total) * 100) : 0}%` }} /></span>
                <span className="text-right tabular-nums font-semibold">{n}{emb.total ? <span className="text-neutral-400 font-normal"> · {Math.round((n / emb.total) * 100)}%</span> : null}</span>
              </div>
            ))}
          </div>
        )}
        {opticas.length > 0 && (
          <div className="mt-3 text-[11px] text-neutral-600"><b>Ópticas que más pacientes recibieron:</b> {opticas.map((o) => `${o.cod} (${o.n})`).join(' · ')}</div>
        )}
      </div>

      {alta && (
        <div className="rounded-xl border border-black/10 bg-white p-3 mb-4 grid grid-cols-2 gap-2">
          {([['nombre', 'Nombre y apellido *'], ['centro', 'Centro / clínica'], ['subespecialidad', 'Subespecialidad (retina, glaucoma…)'], ['direccion', 'Dirección'], ['barrio', 'Barrio'], ['localidad', 'Localidad'], ['provincia', 'Provincia'], ['telefono', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['web', 'Web o turnos online'], ['fuente', 'Fuente (cartilla OSDE, óptica X…)']] as const).map(([k, t]) => (
            <input key={k} className={inp} placeholder={t} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          ))}
          <div className="col-span-2">
            <div className="text-[11px] text-neutral-500 mb-1">Cartillas que atiende (las premium primero)</div>
            <div className="flex flex-wrap gap-1">
              {[...OBRAS].filter((o) => o.id !== 'otra' && o.id !== 'particular').sort((a, b) => Number(PREMIUM.includes(b.id)) - Number(PREMIUM.includes(a.id))).map((o) => {
                const on = form.cartillas.includes(o.id)
                return <button key={o.id} type="button" onClick={() => setForm({ ...form, cartillas: on ? form.cartillas.filter((x) => x !== o.id) : [...form.cartillas, o.id] })}
                  className={'rounded-full border px-2 py-0.5 text-[11px] ' + (on ? 'bg-black text-white border-black' : 'border-black/15')}>{o.corto ?? o.nombre}</button>
              })}
            </div>
          </div>
          <button onClick={guardarAlta} className="col-span-2 rounded-lg bg-black text-white py-2 text-[12px] font-semibold">Guardar</button>
        </div>
      )}

      {importar && (
        <div className="rounded-xl border border-black/10 bg-white p-3 mb-4">
          <p className="text-[11px] text-neutral-600 mb-2">Pegá filas copiadas de Excel o Google Sheets (separadas por tab o «;») en este orden: <b>nombre, centro, dirección, barrio, localidad, provincia, teléfono, whatsapp, web, cartillas</b> (ej.: <i>OSDE | Swiss Medical | Galeno</i>), <b>fuente</b>. La primera fila puede ser el encabezado.</p>
          <textarea className={inp + ' h-36 font-mono'} value={pegado} onChange={(e) => setPegado(e.target.value)} />
          <button onClick={guardarImport} className="mt-2 rounded-lg bg-black text-white px-3 py-2 text-[12px] font-semibold">Importar {pegado.trim() ? pegado.trim().split(/\r?\n/).length : 0} filas</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        {(['todos', ...NIVELES.map((n) => n.k)] as const).map((k) => (
          <button key={k} onClick={() => setFiltro(k)} className={'rounded-full border px-2.5 py-1 text-[11px] font-semibold ' + (filtro === k ? 'bg-black text-white border-black' : 'border-black/15')}>
            {k === 'todos' ? `Todos (${lista?.length ?? 0})` : `${NIVELES.find((n) => n.k === k)!.t} (${lista?.filter((o) => o.nivel === k).length ?? 0})`}
          </button>
        ))}
        <input className="rounded-lg border border-black/15 px-2 py-1 text-[12px] ml-auto" placeholder="Buscar nombre, zona…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {lista && lista.length === 0 && (
        <div className="rounded-xl border border-dashed border-black/20 p-6 text-center text-[12px] text-neutral-500">
          Todavía no hay oftalmólogos en la red. Cargalos a mano, importá una planilla (de las cartillas de OSDE, Swiss Medical, Galeno…, de Google Maps o de los que recomiendan las ópticas clientes) y marcá con quién hay acuerdo: esos aparecen primero en la web como «Recomendado por Orbital».
        </div>
      )}

      <div className="space-y-2">
        {vista.map((o) => (
          <div key={o.id} className="rounded-xl border border-black/10 bg-white p-3 text-[12px]">
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div>
                <div className="font-bold text-[13px]">{o.nombre}{o.subespecialidad && <span className="font-normal text-neutral-500"> · {o.subespecialidad}</span>}</div>
                <div className="text-neutral-500">{[o.centro, o.direccion, o.barrio, o.localidad, o.provincia].filter(Boolean).join(' · ')}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {o.cartillas.map((c) => <span key={c} className={'rounded px-1.5 py-0.5 text-[10px] font-semibold ' + (PREMIUM.includes(c) ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-600')}>{nombreOs(c)}</span>)}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums"><b className="text-[15px]">{o.deriv_90d}</b> <span className="text-neutral-500">derivaciones 90 d</span></div>
                <div className="text-neutral-400 tabular-nums">{o.deriv_total} en total · {o.cartillas_premium} cartillas premium{o.rating ? ` · ★ ${o.rating}` : ''}</div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <select value={o.nivel} onChange={(e) => cambiar(o, { nivel: e.target.value as Nivel })} className={'rounded-lg px-2 py-1 text-[11px] font-semibold border-0 ' + NIVELES.find((n) => n.k === o.nivel)!.c}>
                {NIVELES.map((n) => <option key={n.k} value={n.k}>{n.t}</option>)}
              </select>
              <label className="inline-flex items-center gap-1 text-[11px] text-neutral-600"><input type="checkbox" checked={o.publico} onChange={(e) => cambiar(o, { publico: e.target.checked })} />Se recomienda en la web</label>
              {(o.whatsapp || o.telefono) && <span className="text-neutral-500">{o.whatsapp || o.telefono}</span>}
              <input defaultValue={o.notas ?? ''} placeholder="Notas del acuerdo…" onBlur={(e) => e.target.value !== (o.notas ?? '') && cambiar(o, { notas: e.target.value || null })} className="flex-1 min-w-[160px] rounded-lg border border-black/10 px-2 py-1 text-[11px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
