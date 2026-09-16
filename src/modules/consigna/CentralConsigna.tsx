// ── Central de operaciones de consigna ──────────────────────────────────────
// Pantalla pública (sin login) para el cliente de consigna con sucursales.
// Acceso por token (?k=) de consigna_acceso:
//   · token de la madre (sucursal_id null) → ve y mueve stock entre todas sus sucursales.
//   · token de sucursal → ve todo, pero solo mueve desde/hacia su sucursal (lo valida la RPC).
// El stock es por sucursal (consigna_suc_stock); la facturación y la cobranza siguen siendo
// de la madre. Los movimientos entre sucursales no facturan ni tocan el central.
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Search, X, Store, History, Undo2, PackageCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

const CLAVE_KEY = 'orbital_consigna_clave'
const QUIEN_KEY = 'orbital_consigna_quien'

type Sucursal = { id: number; nombre: string; direccion: string | null; localidad: string | null }
type Linea = { sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; precio: number | null }
type Mov = {
  id: number; fecha: string; tipo: string; codigo: string; modelo: string | null; descripcion: string | null
  cantidad: number; sucursal_id: number; contraparte_sucursal_id: number | null; nota: string | null; creado_por: string | null
}
type Devolucion = {
  id: number; sucursal_id: number | null; codigo: string | null; modelo: string; descripcion: string | null
  cantidad: number; vendio: number | null; motivo: string; estado: 'pendiente' | 'enviada' | 'recibida'
  enviada_at: string | null; enviada_por: string | null; recibida_at: string | null
}
type Central = {
  madre: { cod: string; razon: string; nombre: string } | null
  acceso: { nombre: string | null; sucursal_id: number | null }
  sucursales: Sucursal[]
  stock: Linea[]
  movs: Mov[]
  devoluciones: Devolucion[]
}
type Producto = { codigo: string; modelo: string; descripcion: string; precio: number; porSuc: Record<number, number>; total: number }

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* sin storage */ } }
const fmt = (n: number) => n.toLocaleString('es-AR')
const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

const ERRORES: Record<string, string> = {
  acceso_invalido: 'El link no es válido o fue dado de baja.',
  stock_insuficiente: 'La sucursal de origen no tiene esa cantidad.',
  misma_sucursal: 'Elegí dos sucursales distintas.',
  cantidad_invalida: 'La cantidad tiene que ser mayor a cero.',
  sin_permiso: 'Desde esta sucursal solo podés mover stock propio.',
  sucursal_invalida: 'La sucursal no pertenece a este cliente.',
}
const msgError = (e: { message?: string } | null) => {
  const k = Object.keys(ERRORES).find((x) => e?.message?.includes(x))
  return k ? ERRORES[k] : 'No se pudo completar. Probá de nuevo.'
}

export default function CentralConsigna() {
  const toast = useToast()
  const [clave, setClave] = useState<string | null>(() => new URLSearchParams(window.location.search).get('k') || leer(CLAVE_KEY))
  const [data, setData] = useState<Central | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [soloSuc, setSoloSuc] = useState<number | null>(null)
  const [mover, setMover] = useState<{ codigo: string; desde: number | null } | null>(null)
  const [vista, setVista] = useState<'stock' | 'devoluciones'>(() => (new URLSearchParams(window.location.search).get('v') === 'devoluciones' ? 'devoluciones' : 'stock'))

  useEffect(() => {
    if (!clave) return
    setCargando(true)
    supabase.rpc('consigna_central', { p_k: clave }).then(({ data, error }) => {
      setCargando(false)
      if (error) {
        setError(msgError(error))
        if (error.message?.includes('acceso_invalido')) guardar(CLAVE_KEY, null)
        return
      }
      guardar(CLAVE_KEY, clave)
      setError(null)
      setData(data as Central)
    })
  }, [clave])

  const productos = useMemo<Producto[]>(() => {
    if (!data) return []
    const m = new Map<string, Producto>()
    for (const l of data.stock) {
      let p = m.get(l.codigo)
      if (!p) {
        p = { codigo: l.codigo, modelo: l.modelo ?? '—', descripcion: l.descripcion ?? '', precio: Number(l.precio ?? 0), porSuc: {}, total: 0 }
        m.set(l.codigo, p)
      }
      p.porSuc[l.sucursal_id] = (p.porSuc[l.sucursal_id] ?? 0) + l.cantidad
      p.total += l.cantidad
    }
    return [...m.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.descripcion.localeCompare(b.descripcion))
  }, [data])

  const totSuc = useMemo(() => {
    const t: Record<number, number> = {}
    for (const l of data?.stock ?? []) t[l.sucursal_id] = (t[l.sucursal_id] ?? 0) + l.cantidad
    return t
  }, [data])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return productos.filter((p) =>
      (!q || `${p.modelo} ${p.descripcion} ${p.codigo}`.toLowerCase().includes(q)) &&
      (soloSuc == null || (p.porSuc[soloSuc] ?? 0) > 0),
    )
  }, [productos, busca, soloSuc])

  if (!clave || (error && !data)) return <Ingreso error={error} onEntrar={(k) => { setError(null); setClave(k) }} />
  if (!data) return <div className="min-h-screen grid place-items-center bg-[#F6F4EF] text-muted text-sm">{cargando ? 'Cargando…' : ''}</div>

  const sucs = data.sucursales
  const nombreSuc = (id: number | null) => sucs.find((s) => s.id === id)?.nombre ?? '—'
  const totalU = productos.reduce((s, p) => s + p.total, 0)
  const totalValor = productos.reduce((s, p) => s + p.total * p.precio, 0)
  const modelos = new Set(productos.map((p) => p.modelo)).size
  const miSuc = data.acceso.sucursal_id
  const devPend = (data.devoluciones ?? []).filter((d) => d.estado === 'pendiente').reduce((s, d) => s + d.cantidad, 0)

  let ultimoModelo = ''

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-ink">
      <header className="bg-white border-b border-black/10">
        <div className="max-w-[1400px] mx-auto px-4 py-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
              <span className="text-[9px] font-bold tracking-[0.28em] text-gold uppercase mt-0.5">Consigna</span>
            </div>
            <h1 className="text-xl font-semibold mt-2 leading-tight">{data.madre?.nombre ?? 'Cliente'}</h1>
            <p className="text-xs text-muted">
              Central de operaciones · {sucs.length} sucursales{miSuc ? ` · estás en ${nombreSuc(miSuc)}` : ''}
            </p>
          </div>
          <div className="flex gap-5 text-right">
            <Dato label="Unidades" valor={fmt(totalU)} />
            <Dato label="Modelos" valor={fmt(modelos)} />
            <Dato label="Valor lista" valor={pesos(totalValor)} />
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-4 flex flex-col gap-4">
        <nav className="flex flex-wrap gap-1 border-b border-black/10 -mt-1">
          {([
            ['stock', 'Stock por sucursal', `${fmt(totalU)} u`],
            ['devoluciones', 'Devoluciones', `${fmt(devPend)} u para devolver`],
          ] as const).map(([k, label, extra]) => (
            <button
              key={k}
              onClick={() => setVista(k)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${vista === k ? 'border-gold text-ink font-semibold' : 'border-transparent text-muted'}`}
            >
              {label} <span className="text-xs text-faint font-normal">· {extra}</span>
            </button>
          ))}
        </nav>

        {vista === 'devoluciones' ? (
          <Devoluciones clave={clave} items={data.devoluciones ?? []} onData={setData} />
        ) : (<>
        {/* Sucursales */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {sucs.map((s) => {
            const activa = soloSuc === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSoloSuc(activa ? null : s.id)}
                title={[s.direccion, s.localidad].filter(Boolean).join(', ')}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                  activa ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 hover:border-gold'
                }`}
              >
                <div className={`text-[11px] truncate ${activa ? 'text-white/70' : 'text-muted'}`}>
                  <Store size={11} className="inline -mt-0.5 mr-1" />
                  {s.nombre}
                </div>
                <div className="text-lg font-semibold tabular-nums leading-tight">{fmt(totSuc[s.id] ?? 0)} u</div>
              </button>
            )
          })}
        </section>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              id="consigna-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar modelo o color"
              className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm"
            />
          </label>
          {soloSuc != null && (
            <button onClick={() => setSoloSuc(null)} className="text-xs bg-white border border-black/10 rounded-full px-3 py-1.5 flex items-center gap-1">
              Con stock en {nombreSuc(soloSuc)} <X size={12} />
            </button>
          )}
          <button
            onClick={() => setMover({ codigo: filtrados[0]?.codigo ?? '', desde: soloSuc ?? miSuc })}
            className="ml-auto bg-ink text-white text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-2"
          >
            Mover stock <ArrowRight size={15} />
          </button>
        </div>
        <p className="text-xs text-muted -mt-2">Tocá una celda para mover unidades de esa sucursal a otra.</p>

        {/* Matriz */}
        <section className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="sticky left-0 bg-white text-left font-medium px-3 py-2 border-b border-black/10 min-w-[190px]">Modelo · color</th>
                {sucs.map((s) => (
                  <th key={s.id} className={`font-medium px-2 py-2 border-b border-black/10 text-center whitespace-nowrap ${soloSuc === s.id ? 'text-ink' : ''}`}>
                    {s.nombre}
                  </th>
                ))}
                <th className="font-semibold px-3 py-2 border-b border-black/10 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => {
                const nuevoModelo = p.modelo !== ultimoModelo
                ultimoModelo = p.modelo
                return (
                  <tr key={p.codigo} className={nuevoModelo ? 'border-t border-black/15' : ''}>
                    <td className="sticky left-0 bg-white px-3 py-1.5 border-b border-black/5">
                      {nuevoModelo && <div className="text-[11px] font-semibold tracking-wide">{p.modelo}</div>}
                      <div className="text-xs text-muted truncate max-w-[220px]" title={p.codigo}>{p.descripcion || p.codigo}</div>
                    </td>
                    {sucs.map((s) => {
                      const q = p.porSuc[s.id] ?? 0
                      return (
                        <td key={s.id} className={`border-b border-black/5 text-center p-0 ${soloSuc === s.id ? 'bg-goldSoft/40' : ''}`}>
                          <button
                            onClick={() => q > 0 && setMover({ codigo: p.codigo, desde: s.id })}
                            disabled={q === 0}
                            className={`w-full py-1.5 tabular-nums ${q === 0 ? 'text-black/20 cursor-default' : 'hover:bg-goldSoft font-medium'}`}
                          >
                            {q}
                          </button>
                        </td>
                      )
                    })}
                    <td className="border-b border-black/5 text-right px-3 font-semibold tabular-nums">{p.total}</td>
                  </tr>
                )
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={sucs.length + 2} className="text-center text-muted text-sm py-8">No hay productos con ese filtro.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Movimientos */}
        <section className="bg-white border border-black/10 rounded-lg">
          <h2 className="text-sm font-semibold px-4 py-3 border-b border-black/10 flex items-center gap-2">
            <History size={15} /> Últimos movimientos entre sucursales
          </h2>
          {data.movs.length === 0 ? (
            <p className="text-sm text-muted px-4 py-4">Todavía no hubo movimientos.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {data.movs.map((m) => (
                <li key={m.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                  <span className="text-xs text-muted tabular-nums w-28 shrink-0">
                    {new Date(m.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium tabular-nums">{Math.abs(m.cantidad)} u</span>
                  <span>{m.modelo} <span className="text-muted">{m.descripcion}</span></span>
                  <span className="text-muted">
                    {nombreSuc(m.sucursal_id)} → {nombreSuc(m.contraparte_sucursal_id)}
                  </span>
                  {(m.creado_por || m.nota) && (
                    <span className="text-xs text-faint">{[m.creado_por, m.nota].filter(Boolean).join(' · ')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        </>)}
      </main>

      {mover && (
        <MoverStock
          clave={clave}
          productos={productos}
          sucursales={sucs}
          inicial={mover}
          miSuc={miSuc}
          onCerrar={() => setMover(null)}
          onListo={(d, texto) => { setData(d); setMover(null); toast(texto, 'success') }}
          onError={(t) => toast(t, 'error')}
        />
      )}
    </div>
  )
}

const ESTADO_DEV: Record<Devolucion['estado'], { label: string; cls: string }> = {
  pendiente: { label: 'Para devolver', cls: 'bg-amber-100 text-amber-800' },
  enviada: { label: 'Enviada', cls: 'bg-sky-100 text-sky-800' },
  recibida: { label: 'Recibida por Orbital', cls: 'bg-emerald-100 text-emerald-800' },
}

function Devoluciones({ clave, items, onData }: { clave: string; items: Devolucion[]; onData: (d: Central) => void }) {
  const toast = useToast()
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')
  const [enviando, setEnviando] = useState(false)

  const suma = (e: Devolucion['estado']) => items.filter((d) => d.estado === e).reduce((s, d) => s + d.cantidad, 0)
  const porModelo = useMemo(() => {
    const m = new Map<string, Devolucion[]>()
    for (const d of items) m.set(d.modelo, [...(m.get(d.modelo) ?? []), d])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])
  const selU = items.filter((d) => sel.has(d.id)).reduce((s, d) => s + d.cantidad, 0)

  const marcar = async (ids: number[], enviada: boolean) => {
    if (enviada && !quien.trim()) return toast('Poné tu nombre para marcar el envío', 'error')
    setEnviando(true)
    guardar(QUIEN_KEY, quien.trim())
    const { data, error } = await supabase.rpc('consigna_devolucion_marcar', { p_k: clave, p_ids: ids, p_enviada: enviada, p_quien: quien.trim() || null })
    setEnviando(false)
    if (error) return toast(msgError(error), 'error')
    onData(data as Central)
    setSel(new Set())
    toast(enviada ? 'Marcado como enviado' : 'Vuelto a pendiente', 'success')
  }

  if (items.length === 0) return <p className="text-sm text-muted bg-white border border-black/10 rounded-lg px-4 py-6">No hay devoluciones pedidas.</p>

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-black/10 rounded-lg px-4 py-3 flex flex-wrap gap-x-8 gap-y-3 items-end">
        <p className="text-sm text-muted max-w-xl basis-full lg:basis-auto lg:flex-1">
          Estas son las unidades que Orbital te pide devolver para dejar lugar a lo que rota y a lo nuevo. Cada línea dice por qué.
          Cuando las despaches, elegilas y marcalas como enviadas.
        </p>
        <Dato label="Para devolver" valor={`${fmt(suma('pendiente'))} u`} />
        <Dato label="Enviadas" valor={`${fmt(suma('enviada'))} u`} />
        <Dato label="Recibidas" valor={`${fmt(suma('recibida'))} u`} />
      </section>

      <section className="bg-white border border-black/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="w-8 px-3 py-2 border-b border-black/10" />
              <th className="text-left font-medium px-2 py-2 border-b border-black/10">Modelo · color</th>
              <th className="text-right font-medium px-2 py-2 border-b border-black/10">Devolver</th>
              <th className="text-right font-medium px-2 py-2 border-b border-black/10 whitespace-nowrap">Vendió dic–ago</th>
              <th className="text-left font-medium px-2 py-2 border-b border-black/10">Por qué</th>
              <th className="text-left font-medium px-3 py-2 border-b border-black/10">Estado</th>
            </tr>
          </thead>
          <tbody>
            {porModelo.map(([modelo, ds]) =>
              ds.map((d, i) => {
                const est = ESTADO_DEV[d.estado]
                return (
                  <tr key={d.id} className={i === 0 ? 'border-t border-black/15' : ''}>
                    <td className="px-3 py-1.5 border-b border-black/5">
                      {d.estado === 'pendiente' && (
                        <input
                          id={`dev-${d.id}`}
                          type="checkbox"
                          checked={sel.has(d.id)}
                          onChange={(e) => {
                            const n = new Set(sel)
                            if (e.target.checked) n.add(d.id)
                            else n.delete(d.id)
                            setSel(n)
                          }}
                          aria-label={`Elegir ${modelo} ${d.descripcion ?? ''}`}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 border-b border-black/5">
                      {i === 0 && <div className="text-[11px] font-semibold tracking-wide">{modelo}</div>}
                      <div className="text-xs text-muted">{d.descripcion}</div>
                    </td>
                    <td className="px-2 py-1.5 border-b border-black/5 text-right font-semibold tabular-nums">{d.cantidad}</td>
                    <td className="px-2 py-1.5 border-b border-black/5 text-right tabular-nums text-muted">{d.vendio ?? '—'}</td>
                    <td className="px-2 py-1.5 border-b border-black/5 text-xs min-w-[220px]">{d.motivo}</td>
                    <td className="px-3 py-1.5 border-b border-black/5 whitespace-nowrap">
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${est.cls}`}>{est.label}</span>
                      {d.estado === 'enviada' && (
                        <button onClick={() => marcar([d.id], false)} disabled={enviando} title="Volver a pendiente" aria-label="Volver a pendiente" className="ml-2 text-faint hover:text-ink align-middle">
                          <Undo2 size={13} />
                        </button>
                      )}
                      {d.estado === 'enviada' && d.enviada_por && <div className="text-[10px] text-faint">{d.enviada_por}</div>}
                    </td>
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      </section>

      {sel.size > 0 && (
        <div className="sticky bottom-3 bg-ink text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 shadow-lg">
          <span className="text-sm">{sel.size} líneas · <b className="tabular-nums">{selU} u</b></span>
          <input
            id="dev-quien"
            value={quien}
            onChange={(e) => setQuien(e.target.value)}
            placeholder="Tu nombre"
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm placeholder:text-white/50 flex-1 min-w-[140px]"
          />
          <button onClick={() => setSel(new Set())} className="text-sm text-white/70">Cancelar</button>
          <button
            onClick={() => marcar([...sel], true)}
            disabled={enviando}
            className="bg-gold text-ink font-semibold text-sm rounded-lg px-4 py-1.5 flex items-center gap-2 disabled:opacity-50"
          >
            <PackageCheck size={15} /> Marcar como enviadas
          </button>
        </div>
      )}
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight">{valor}</div>
    </div>
  )
}

function MoverStock({ clave, productos, sucursales, inicial, miSuc, onCerrar, onListo, onError }: {
  clave: string
  productos: Producto[]
  sucursales: Sucursal[]
  inicial: { codigo: string; desde: number | null }
  miSuc: number | null
  onCerrar: () => void
  onListo: (d: Central, texto: string) => void
  onError: (t: string) => void
}) {
  const [codigo, setCodigo] = useState(inicial.codigo)
  const [desde, setDesde] = useState<number | null>(inicial.desde)
  const [hacia, setHacia] = useState<number | null>(null)
  const [cant, setCant] = useState(1)
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  const prod = productos.find((p) => p.codigo === codigo)
  const disponible = desde != null ? prod?.porSuc[desde] ?? 0 : 0
  const nombre = (id: number | null) => sucursales.find((s) => s.id === id)?.nombre ?? ''
  const valido = !!prod && desde != null && hacia != null && desde !== hacia && cant > 0 && cant <= disponible && quien.trim() !== ''

  const confirmar = async () => {
    if (!valido || !prod) return
    setEnviando(true)
    guardar(QUIEN_KEY, quien.trim())
    const { data, error } = await supabase.rpc('consigna_transferir', {
      p_k: clave, p_codigo: codigo, p_desde: desde, p_hacia: hacia, p_cant: cant, p_quien: quien.trim(), p_nota: nota.trim() || null,
    })
    setEnviando(false)
    if (error) return onError(msgError(error))
    onListo(data as Central, `Movidas ${cant} u de ${prod.modelo} a ${nombre(hacia)}`)
  }

  const campo = 'w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onCerrar}>
      <div className="bg-[#FBFAF7] w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Mover stock entre sucursales</h3>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-muted"><X size={18} /></button>
        </div>

        <label className="text-xs text-muted flex flex-col gap-1">
          Producto
          <select id="mover-producto" value={codigo} onChange={(e) => setCodigo(e.target.value)} className={campo}>
            {productos.map((p) => (
              <option key={p.codigo} value={p.codigo}>{p.modelo} · {p.descripcion} ({p.total})</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="text-xs text-muted flex flex-col gap-1">
            Desde
            <select id="mover-desde" value={desde ?? ''} onChange={(e) => setDesde(e.target.value ? Number(e.target.value) : null)} className={campo}>
              <option value="">Elegir…</option>
              {sucursales.map((s) => {
                const q = prod?.porSuc[s.id] ?? 0
                return <option key={s.id} value={s.id} disabled={q === 0}>{s.nombre} ({q})</option>
              })}
            </select>
          </label>
          <ArrowRight size={16} className="mb-2.5 text-muted" />
          <label className="text-xs text-muted flex flex-col gap-1">
            Hacia
            <select id="mover-hacia" value={hacia ?? ''} onChange={(e) => setHacia(e.target.value ? Number(e.target.value) : null)} className={campo}>
              <option value="">Elegir…</option>
              {sucursales.filter((s) => s.id !== desde).map((s) => (
                <option key={s.id} value={s.id}>{s.nombre} ({prod?.porSuc[s.id] ?? 0})</option>
              ))}
            </select>
          </label>
        </div>

        <label className="text-xs text-muted flex flex-col gap-1">
          Cantidad {desde != null && <span className="text-faint">· disponible {disponible}</span>}
          <input id="mover-cant" type="number" min={1} max={disponible || undefined} value={cant}
            onChange={(e) => setCant(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={campo} />
        </label>

        <label className="text-xs text-muted flex flex-col gap-1">
          Quién lo mueve
          <input id="mover-quien" value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="Tu nombre" className={campo} />
        </label>

        <label className="text-xs text-muted flex flex-col gap-1">
          Motivo (opcional)
          <input id="mover-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: lo pidió un cliente" className={campo} />
        </label>

        {miSuc != null && desde !== miSuc && hacia !== miSuc && desde != null && hacia != null && (
          <p className="text-xs text-red-600">Desde esta sucursal solo podés mover stock desde o hacia {nombre(miSuc)}.</p>
        )}

        <button
          onClick={confirmar}
          disabled={!valido || enviando}
          className="bg-ink text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {enviando ? 'Moviendo…' : valido ? `Mover ${cant} u a ${nombre(hacia)}` : 'Mover'}
        </button>
      </div>
    </div>
  )
}

function Ingreso({ error, onEntrar }: { error: string | null; onEntrar: (k: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="min-h-screen grid place-items-center bg-[#F6F4EF] px-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (v.trim()) onEntrar(v.trim()) }}
        className="bg-white border border-black/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
      >
        <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital self-start" />
        <h1 className="font-semibold">Central de consigna</h1>
        <p className="text-sm text-muted">Ingresá la clave que te pasó Orbital.</p>
        <input id="consigna-clave" value={v} onChange={(e) => setV(e.target.value)} placeholder="Clave" className="border border-black/15 rounded-lg px-3 py-2 text-sm" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button className="bg-ink text-white rounded-lg py-2 text-sm font-medium">Entrar</button>
      </form>
    </div>
  )
}
