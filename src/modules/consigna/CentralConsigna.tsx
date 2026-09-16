// ── Central de operaciones de consigna ──────────────────────────────────────
// Pantalla pública (sin login) para el cliente de consigna con sucursales. Acceso por token (?k=)
// de consigna_acceso:
//   · token de la madre (sucursal_id null) → opera todas las sucursales y AUTORIZA los pedidos.
//   · token de sucursal → ve todo, pero solo opera su sucursal (lo validan las RPC).
// Stock por sucursal (consigna_suc_stock):
//   cantidad  = unidades en el local (incluye lo marcado para devolver)
//   devolver  = parte de cantidad que Orbital pidió devolver; recién al devolverla baja cantidad
//   en_camino = envío nuevo de Orbital que la sucursal todavía no recibió
// Facturación y cobranza siguen siendo de la madre; nada de esta pantalla factura.
// Pedido particular: la sucursal pide sobre el depósito Orbital (sin precios) → la central autoriza
// → pasa a Orbital como precarga (catalogo_precarga), fuera de la reposición automática.
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Search, X, Store, History, PackageCheck, Undo2, Truck, Minus, Plus, Check, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import InstalarApp from '../../components/InstalarApp'
import Postventa from './Postventa'

const CLAVE_KEY = 'orbital_consigna_clave'
const QUIEN_KEY = 'orbital_consigna_quien'

export type Sucursal = { id: number; nombre: string; direccion: string | null; localidad: string | null }
type Linea = {
  sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null
  cantidad: number; devolver: number; en_camino: number; precio: number | null
}
type Mov = {
  id: number; fecha: string; tipo: string; codigo: string; modelo: string | null; descripcion: string | null
  cantidad: number; sucursal_id: number; contraparte_sucursal_id: number | null; nota: string | null; creado_por: string | null
}
type Devolucion = {
  id: number; sucursal_id: number; codigo: string; modelo: string; descripcion: string | null
  cantidad: number; enviada: number; conservada: number; vendida: number; recibida: number; vendio: number | null; motivo: string; ultimo_por: string | null
}
type ItemPedido = { codigo: string; modelo: string; descripcion: string; cantidad: number }
type Pedido = {
  id: number; sucursal_id: number; items: ItemPedido[]; total_units: number; nota: string | null
  estado: 'solicitado' | 'autorizado' | 'rechazado'; solicitado_por: string | null; autorizado_por: string | null
  motivo_rechazo: string | null; created_at: string; resuelto_at: string | null
}
export type Central = {
  madre: { cod: string; razon: string; nombre: string } | null
  acceso: { nombre: string | null; sucursal_id: number | null }
  sucursales: Sucursal[]
  stock: Linea[]
  movs: Mov[]
  devoluciones: Devolucion[]
  pedidos: Pedido[]
}
type Producto = {
  codigo: string; modelo: string; descripcion: string; precio: number
  local: Record<number, number>; devolver: Record<number, number>; camino: Record<number, number>; total: number
}
type ItemCatalogo = { codigo: string; modelo: string; descripcion: string | null; disponible: number; mas: boolean; tipo: string | null }
type Vista = 'tablero' | 'stock' | 'pedir' | 'pedidos' | 'postventa'

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sin storage */ } }
const fmt = (n: number) => n.toLocaleString('es-AR')
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const ERRORES: Record<string, string> = {
  acceso_invalido: 'El link no es válido o fue dado de baja.',
  stock_insuficiente: 'No hay esa cantidad disponible (lo marcado para devolver no se puede mover).',
  misma_sucursal: 'Elegí dos sucursales distintas.',
  cantidad_invalida: 'Revisá las cantidades.',
  sin_permiso: 'Con este link no podés hacer esa operación.',
  sucursal_invalida: 'La sucursal no pertenece a este cliente.',
  ya_resuelto: 'Ese pedido ya fue resuelto.',
}
const msgError = (e: { message?: string } | null) => {
  const k = Object.keys(ERRORES).find((x) => e?.message?.includes(x))
  return k ? ERRORES[k] : 'No se pudo completar. Probá de nuevo.'
}

export default function CentralConsigna() {
  const toast = useToast()
  const params = new URLSearchParams(window.location.search)
  const [clave, setClave] = useState<string | null>(() => params.get('k') || leer(CLAVE_KEY))
  const [data, setData] = useState<Central | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('tablero')
  const [selSuc, setSelSuc] = useState<number | null>(null)
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')

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
      const d = data as Central
      setData(d)
      setSelSuc((s) => s ?? d.acceso.sucursal_id ?? d.sucursales[0]?.id ?? null)
    })
  }, [clave])

  // Todas las acciones devuelven la central actualizada.
  const operar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const nombre = quien.trim()
    if (!nombre) { toast('Poné tu nombre arriba antes de operar', 'error'); return false }
    guardar(QUIEN_KEY, nombre)
    const { data, error } = await supabase.rpc(fn, { p_k: clave, p_quien: nombre, ...args })
    if (error) { toast(msgError(error), 'error'); return false }
    setData(data as Central)
    toast(ok, 'success')
    return true
  }

  if (!clave || (error && !data)) return <Ingreso error={error} onEntrar={(k) => { setError(null); setClave(k) }} />
  if (!data || selSuc == null) return <div className="min-h-screen grid place-items-center bg-[#F6F4EF] text-muted text-sm">{cargando ? 'Cargando…' : ''}</div>

  const sucs = data.sucursales
  const miSuc = data.acceso.sucursal_id
  const esCentral = miSuc == null
  const puedeOperar = (id: number) => esCentral || miSuc === id
  const suc = sucs.find((s) => s.id === selSuc)
  const sumaSuc = (id: number, k: 'cantidad' | 'devolver' | 'en_camino') =>
    data.stock.filter((l) => l.sucursal_id === id).reduce((s, l) => s + l[k], 0)
  const tot = (k: 'cantidad' | 'devolver' | 'en_camino') => data.stock.reduce((s, l) => s + l[k], 0)
  const porAutorizar = data.pedidos.filter((p) => p.estado === 'solicitado').length

  const tabs: [Vista, string, string][] = [
    ['tablero', 'Tablero de sucursal', suc?.nombre ?? ''],
    ['stock', 'Stock de todas', `${fmt(tot('cantidad'))} u`],
    ['pedir', 'Catálogo Orbital', 'pedir sin precios'],
    ['pedidos', esCentral ? 'Pedidos a autorizar' : 'Pedidos', porAutorizar ? `${porAutorizar} esperando` : ''],
    ['postventa', 'Postventa y repuestos', ''],
  ]

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-ink">
      <header className="bg-white border-b border-black/10">
        <div className="max-w-[1400px] mx-auto px-4 py-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
              <span className="text-[9px] font-bold tracking-[0.28em] text-gold uppercase mt-0.5">Consigna</span>
              <span className="ml-2">
                <InstalarApp nombre="Orbital Consigna" que={esCentral ? 'la central' : 'tu sucursal'} urlParaInstalar={`/consigna?k=${clave}`}
                  bajada={esCentral ? 'Queda con el ícono de Orbital y entra directo a la central, sin clave.' : 'Queda con el ícono de Orbital en la compu o el teléfono del local y entra directo a tu sucursal.'} />
              </span>
            </div>
            <h1 className="text-xl font-semibold mt-2 leading-tight">{data.madre?.nombre ?? 'Cliente'}</h1>
            <p className="text-xs text-muted">
              {esCentral ? `Central de operaciones · ${sucs.length} sucursales` : `Sucursal ${sucs.find((s) => s.id === miSuc)?.nombre ?? ''}`}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-5">
            <Dato label="En los locales" valor={`${fmt(tot('cantidad'))} u`} />
            <Dato label="A devolver" valor={`${fmt(tot('devolver'))} u`} tono="text-amber-700" />
            <Dato label="Envío en camino" valor={`${fmt(tot('en_camino'))} u`} tono="text-emerald-700" />
            <label className="text-[10px] uppercase tracking-wider text-muted flex flex-col gap-0.5">
              Operando como
              <input
                id="consigna-quien"
                value={quien}
                onChange={(e) => setQuien(e.target.value)}
                onBlur={() => guardar(QUIEN_KEY, quien.trim() || null)}
                placeholder="Tu nombre"
                className="normal-case tracking-normal text-sm border border-black/15 rounded-lg px-2.5 py-1.5 w-40"
              />
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-4 flex flex-col gap-4">
        {/* Sucursales: elegir cuál mirar */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {sucs.map((s) => {
            const activa = selSuc === s.id
            const dev = sumaSuc(s.id, 'devolver')
            const cam = sumaSuc(s.id, 'en_camino')
            return (
              <button
                key={s.id}
                onClick={() => setSelSuc(s.id)}
                title={[s.direccion, s.localidad].filter(Boolean).join(', ')}
                className={`text-left rounded-lg border px-3 py-2 transition-colors ${activa ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 hover:border-gold'}`}
              >
                <div className={`text-[11px] truncate ${activa ? 'text-white/70' : 'text-muted'}`}>
                  <Store size={11} className="inline -mt-0.5 mr-1" />{s.nombre}{miSuc === s.id ? ' · vos' : ''}
                </div>
                <div className="text-lg font-semibold tabular-nums leading-tight">{fmt(sumaSuc(s.id, 'cantidad'))} u</div>
                <div className="text-[11px] tabular-nums flex gap-2 mt-0.5">
                  {dev > 0 && <span className={activa ? 'text-amber-300' : 'text-amber-700'}>↩ {dev}</span>}
                  {cam > 0 && <span className={activa ? 'text-emerald-300' : 'text-emerald-700'}>+ {cam}</span>}
                </div>
              </button>
            )
          })}
        </section>

        <nav className="flex flex-wrap gap-1 border-b border-black/10">
          {tabs.map(([k, label, extra]) => (
            <button
              key={k}
              onClick={() => setVista(k)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 whitespace-nowrap ${vista === k ? 'border-gold text-ink font-semibold' : 'border-transparent text-muted'}`}
            >
              {label}{extra && <span className="text-xs text-faint font-normal"> · {extra}</span>}
            </button>
          ))}
        </nav>

        {vista === 'tablero' && suc && (
          <Tablero data={data} suc={suc} editable={puedeOperar(suc.id)} operar={operar} />
        )}
        {vista === 'stock' && <StockGeneral data={data} miSuc={miSuc} operar={operar} />}
        {vista === 'pedir' && (miSuc != null ? sucs.find((s) => s.id === miSuc) : suc) && (
          // Con link de sucursal el catálogo siempre pide para SU sucursal; la central pide para la tarjeta elegida.
          <PedirOrbital clave={clave} suc={(miSuc != null ? sucs.find((s) => s.id === miSuc) : suc)!} editable operar={operar} onEnviado={() => setVista('pedidos')} />
        )}
        {vista === 'pedidos' && <Pedidos data={data} esCentral={esCentral} operar={operar} />}
        {vista === 'postventa' && suc && (
          <Postventa clave={clave} data={data} suc={suc} editable={puedeOperar(suc.id)} quien={quien} />
        )}
      </main>
    </div>
  )
}

type Operar = (fn: string, args: Record<string, unknown>, ok: string) => Promise<boolean>

// ── Tablero de una sucursal: qué tiene que devolver y qué le llega nuevo ────
function Tablero({ data, suc, editable, operar }: { data: Central; suc: Sucursal; editable: boolean; operar: Operar }) {
  const devs = data.devoluciones.filter((d) => d.sucursal_id === suc.id)
  const envio = data.stock.filter((l) => l.sucursal_id === suc.id && l.en_camino > 0)
    .sort((a, b) => (a.modelo ?? '').localeCompare(b.modelo ?? ''))
  const pend = (d: Devolucion) => d.cantidad - d.enviada - d.conservada - (d.vendida ?? 0)
  const totPend = devs.reduce((s, d) => s + pend(d), 0)
  const totDev = devs.reduce((s, d) => s + d.enviada, 0)
  const totQueda = devs.reduce((s, d) => s + d.conservada, 0)
  const totCamino = envio.reduce((s, l) => s + l.en_camino, 0)
  const pedidos = data.pedidos.filter((p) => p.sucursal_id === suc.id)
  const [ocupado, setOcupado] = useState(false)

  const devolverTodo = async () => {
    if (!window.confirm(`¿Confirmás que ${suc.nombre} devuelve las ${totPend} u pendientes?`)) return
    setOcupado(true)
    for (const d of devs.filter((x) => pend(x) > 0)) {
      const ok = await operar('consigna_devolucion_accion', { p_id: d.id, p_devuelve: pend(d), p_conserva: 0 }, `Devolución de ${suc.nombre} registrada`)
      if (!ok) break
    }
    setOcupado(false)
  }

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
      <section className="bg-white border border-black/10 rounded-lg">
        <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-x-5 gap-y-2">
          <h2 className="font-semibold flex items-center gap-2 mr-auto"><Undo2 size={16} className="text-amber-700" /> Tiene que devolver</h2>
          <span className="text-xs text-muted tabular-nums">Pendiente <b className="text-amber-700">{totPend}</b> · devolvió <b>{totDev}</b> · se queda <b>{totQueda}</b></span>
          {editable && totPend > 0 && (
            <button onClick={devolverTodo} disabled={ocupado} className="text-xs bg-amber-100 text-amber-900 font-medium rounded-lg px-3 py-1.5 disabled:opacity-50">
              Devolver todo lo pendiente
            </button>
          )}
        </div>
        <p className="text-xs text-muted px-4 pt-3">
          Siguen en el stock del local hasta que se devuelven. Se puede devolver todo o una parte; lo que no se devuelve se marca como "se queda" y pasa a stock normal.
        </p>
        {devs.length === 0 ? (
          <p className="text-sm text-muted px-4 py-6">Orbital no le pidió devoluciones a esta sucursal.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse mt-2">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="text-left font-medium px-4 py-2 border-b border-black/10">Modelo · color</th>
                  <th className="text-left font-medium px-2 py-2 border-b border-black/10">Por qué</th>
                  <th className="text-right font-medium px-2 py-2 border-b border-black/10">Pedido</th>
                  <th className="text-right font-medium px-2 py-2 border-b border-black/10">Pendiente</th>
                  <th className="text-left font-medium px-4 py-2 border-b border-black/10">{editable ? 'Registrar' : 'Estado'}</th>
                </tr>
              </thead>
              <tbody>
                {devs.map((d) => (
                  <FilaDevolucion key={d.id} d={d} pendiente={pend(d)} editable={editable} operar={operar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4">
        <section className="bg-white border border-black/10 rounded-lg">
          <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold flex items-center gap-2 mr-auto"><Truck size={16} className="text-emerald-700" /> Envío nuevo en camino</h2>
            <span className="text-xs text-muted tabular-nums"><b className="text-emerald-700">{totCamino}</b> u</span>
            {editable && totCamino > 0 && (
              <button
                onClick={() => operar('consigna_recibir_envio', { p_sucursal: suc.id, p_codigo: null }, `${suc.nombre} recibió el envío`)}
                className="text-xs bg-emerald-100 text-emerald-900 font-medium rounded-lg px-3 py-1.5"
              >
                Recibí todo
              </button>
            )}
          </div>
          {envio.length === 0 ? (
            <p className="text-sm text-muted px-4 py-6">No hay envíos en camino.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {envio.map((l) => (
                <li key={l.codigo} className="px-4 py-2 flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold tracking-wide">{l.modelo}</div>
                    <div className="text-xs text-muted truncate">{l.descripcion}</div>
                  </div>
                  <span className="font-semibold tabular-nums">+{l.en_camino}</span>
                  {editable && (
                    <button
                      onClick={() => operar('consigna_recibir_envio', { p_sucursal: suc.id, p_codigo: l.codigo }, `Recibido ${l.modelo}`)}
                      title="Marcar recibido"
                      aria-label={`Marcar recibido ${l.modelo}`}
                      className="text-emerald-700 border border-emerald-200 rounded-md p-1 hover:bg-emerald-50"
                    >
                      <Check size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-black/10 rounded-lg">
          <h2 className="font-semibold px-4 py-3 border-b border-black/10">Pedidos particulares</h2>
          {pedidos.length === 0 ? (
            <p className="text-sm text-muted px-4 py-4">Sin pedidos. Se arman desde "Pedir a Orbital".</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {pedidos.map((p) => (
                <li key={p.id} className="px-4 py-2 text-sm flex items-center gap-3">
                  <span className="text-xs text-muted w-24 shrink-0">{fecha(p.created_at)}</span>
                  <span className="flex-1 tabular-nums">{p.total_units} u · {p.items.length} productos</span>
                  <EstadoPedido e={p.estado} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function FilaDevolucion({ d, pendiente, editable, operar }: { d: Devolucion; pendiente: number; editable: boolean; operar: Operar }) {
  const [cant, setCant] = useState(pendiente)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => setCant(pendiente), [pendiente])
  const valida = cant > 0 && cant <= pendiente

  const accion = async (devuelve: number, conserva: number, ok: string) => {
    setOcupado(true)
    await operar('consigna_devolucion_accion', { p_id: d.id, p_devuelve: devuelve, p_conserva: conserva }, ok)
    setOcupado(false)
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-2 border-b border-black/5">
        <div className="text-[11px] font-semibold tracking-wide">{d.modelo}</div>
        <div className="text-xs text-muted">{d.descripcion}</div>
      </td>
      <td className="px-2 py-2 border-b border-black/5 text-xs min-w-[180px]">{d.motivo}</td>
      <td className="px-2 py-2 border-b border-black/5 text-right tabular-nums">{d.cantidad}</td>
      <td className={`px-2 py-2 border-b border-black/5 text-right tabular-nums font-semibold ${pendiente > 0 ? 'text-amber-700' : 'text-black/25'}`}>{pendiente}</td>
      <td className="px-4 py-2 border-b border-black/5 whitespace-nowrap">
        {pendiente > 0 && editable ? (
          <div className="flex items-center gap-1.5">
            <input
              id={`dev-cant-${d.id}`}
              type="number"
              min={1}
              max={pendiente}
              value={cant}
              onChange={(e) => setCant(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              aria-label="Cantidad"
              className="w-14 border border-black/15 rounded-md px-2 py-1 text-sm tabular-nums"
            />
            <button disabled={!valida || ocupado} onClick={() => accion(cant, 0, `Devueltas ${cant} u de ${d.modelo}`)}
              className="text-xs bg-ink text-white rounded-md px-2.5 py-1.5 disabled:opacity-40">Devolver</button>
            <button disabled={!valida || ocupado} onClick={() => accion(0, cant, `${cant} u de ${d.modelo} se quedan`)}
              className="text-xs border border-black/15 rounded-md px-2.5 py-1.5 disabled:opacity-40">Se queda</button>
          </div>
        ) : (
          <span className="text-xs text-muted">
            {d.enviada > 0 && <>Devolvió {d.enviada}</>}
            {d.enviada > 0 && d.conservada > 0 && ' · '}
            {d.conservada > 0 && <>Se queda {d.conservada}</>}
            {d.vendida > 0 && <>{(d.enviada > 0 || d.conservada > 0) && ' · '}Vendió {d.vendida}</>}
            {pendiente > 0 && 'Pendiente'}
          </span>
        )}
        {(d.enviada > 0 || d.conservada > 0) && pendiente > 0 && (
          <div className="text-[11px] text-faint mt-0.5">Devolvió {d.enviada} · se queda {d.conservada}</div>
        )}
      </td>
    </tr>
  )
}

// ── Stock de todas las sucursales + mover entre sucursales ───────────────────
function StockGeneral({ data, miSuc, operar }: { data: Central; miSuc: number | null; operar: Operar }) {
  const [busca, setBusca] = useState('')
  const [mover, setMover] = useState<{ codigo: string; desde: number | null } | null>(null)
  const sucs = data.sucursales

  const productos = useMemo<Producto[]>(() => {
    const m = new Map<string, Producto>()
    for (const l of data.stock) {
      let p = m.get(l.codigo)
      if (!p) {
        p = { codigo: l.codigo, modelo: l.modelo ?? '—', descripcion: l.descripcion ?? '', precio: Number(l.precio ?? 0), local: {}, devolver: {}, camino: {}, total: 0 }
        m.set(l.codigo, p)
      }
      p.local[l.sucursal_id] = l.cantidad
      p.devolver[l.sucursal_id] = l.devolver
      p.camino[l.sucursal_id] = l.en_camino
      p.total += l.cantidad
    }
    return [...m.values()].sort((a, b) => a.modelo.localeCompare(b.modelo) || a.descripcion.localeCompare(b.descripcion))
  }, [data])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return productos.filter((p) => !q || `${p.modelo} ${p.descripcion} ${p.codigo}`.toLowerCase().includes(q))
  }, [productos, busca])

  const nombreSuc = (id: number | null) => sucs.find((s) => s.id === id)?.nombre ?? '—'
  let ultimoModelo = ''

  const MOV_TXT: Record<string, (m: Mov) => string> = {
    transferencia_sale: (m) => `${nombreSuc(m.sucursal_id)} → ${nombreSuc(m.contraparte_sucursal_id)}`,
    devolucion: (m) => `${nombreSuc(m.sucursal_id)} devolvió a Orbital`,
    conserva: (m) => `${nombreSuc(m.sucursal_id)} se lo queda`,
    recepcion: (m) => `${nombreSuc(m.sucursal_id)} recibió envío`,
    venta: (m) => `${nombreSuc(m.sucursal_id)} vendió (liquidación)`,
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input id="consigna-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo o color"
            className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm" />
        </label>
        <span className="text-xs text-muted flex gap-3">
          <span><b className="text-amber-700">↩</b> a devolver</span><span><b className="text-emerald-700">+</b> en camino</span>
        </span>
        <button onClick={() => setMover({ codigo: filtrados[0]?.codigo ?? '', desde: miSuc })}
          className="ml-auto bg-ink text-white text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-2">
          Mover stock <ArrowRight size={15} />
        </button>
      </div>

      <section className="bg-white border border-black/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-[1] bg-white text-left font-medium px-3 py-2 border-b border-black/10 min-w-[190px]">Modelo · color</th>
              {sucs.map((s) => <th key={s.id} className="font-medium px-2 py-2 border-b border-black/10 text-center whitespace-nowrap">{s.nombre}</th>)}
              <th className="font-semibold px-3 py-2 border-b border-black/10 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const nuevoModelo = p.modelo !== ultimoModelo
              ultimoModelo = p.modelo
              return (
                <tr key={p.codigo} className={nuevoModelo ? 'border-t border-black/15' : ''}>
                  <td className="sticky left-0 z-[1] bg-white px-3 py-1.5 border-b border-black/5">
                    {nuevoModelo && <div className="text-[11px] font-semibold tracking-wide">{p.modelo}</div>}
                    <div className="text-xs text-muted truncate max-w-[220px]" title={p.codigo}>{p.descripcion || p.codigo}</div>
                  </td>
                  {sucs.map((s) => {
                    const q = p.local[s.id] ?? 0
                    const dv = p.devolver[s.id] ?? 0
                    const cm = p.camino[s.id] ?? 0
                    const libre = q - dv
                    return (
                      <td key={s.id} className="border-b border-black/5 text-center p-0">
                        <button
                          onClick={() => libre > 0 && setMover({ codigo: p.codigo, desde: s.id })}
                          disabled={libre <= 0}
                          title={libre > 0 ? 'Mover a otra sucursal' : undefined}
                          className={`w-full py-1.5 tabular-nums leading-tight ${libre > 0 ? 'hover:bg-goldSoft' : 'cursor-default'}`}
                        >
                          <span className={q === 0 ? 'text-black/20' : 'font-medium'}>{q}</span>
                          {(dv > 0 || cm > 0) && (
                            <span className="block text-[10px]">
                              {dv > 0 && <span className="text-amber-700">↩{dv}</span>}
                              {dv > 0 && cm > 0 && ' '}
                              {cm > 0 && <span className="text-emerald-700">+{cm}</span>}
                            </span>
                          )}
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

      <section className="bg-white border border-black/10 rounded-lg">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-black/10 flex items-center gap-2"><History size={15} /> Últimos movimientos</h2>
        {data.movs.length === 0 ? (
          <p className="text-sm text-muted px-4 py-4">Todavía no hubo movimientos.</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {data.movs.map((m) => (
              <li key={m.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5 items-baseline">
                <span className="text-xs text-muted tabular-nums w-24 shrink-0">{fecha(m.fecha)}</span>
                <span className="font-medium tabular-nums">{Math.abs(m.cantidad)} u</span>
                <span>{m.modelo} <span className="text-muted">{m.descripcion}</span></span>
                <span className="text-muted">{MOV_TXT[m.tipo]?.(m) ?? m.tipo}</span>
                {m.creado_por && <span className="text-xs text-faint">{m.creado_por}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mover && (
        <MoverStock productos={productos} sucursales={sucs} inicial={mover} miSuc={miSuc}
          onCerrar={() => setMover(null)}
          onMover={async (args, texto) => { if (await operar('consigna_transferir', args, texto)) setMover(null) }} />
      )}
    </div>
  )
}

function MoverStock({ productos, sucursales, inicial, miSuc, onCerrar, onMover }: {
  productos: Producto[]; sucursales: Sucursal[]; inicial: { codigo: string; desde: number | null }; miSuc: number | null
  onCerrar: () => void; onMover: (args: Record<string, unknown>, texto: string) => Promise<void>
}) {
  const [codigo, setCodigo] = useState(inicial.codigo)
  const [desde, setDesde] = useState<number | null>(inicial.desde)
  const [hacia, setHacia] = useState<number | null>(null)
  const [cant, setCant] = useState(1)
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  const prod = productos.find((p) => p.codigo === codigo)
  const libre = (id: number) => (prod?.local[id] ?? 0) - (prod?.devolver[id] ?? 0)
  const disponible = desde != null ? libre(desde) : 0
  const nombre = (id: number | null) => sucursales.find((s) => s.id === id)?.nombre ?? ''
  const permiso = miSuc == null || desde === miSuc || hacia === miSuc
  const valido = !!prod && desde != null && hacia != null && desde !== hacia && cant > 0 && cant <= disponible && permiso
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
            {productos.map((p) => <option key={p.codigo} value={p.codigo}>{p.modelo} · {p.descripcion} ({p.total})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="text-xs text-muted flex flex-col gap-1">
            Desde
            <select id="mover-desde" value={desde ?? ''} onChange={(e) => setDesde(e.target.value ? Number(e.target.value) : null)} className={campo}>
              <option value="">Elegir…</option>
              {sucursales.map((s) => <option key={s.id} value={s.id} disabled={libre(s.id) <= 0}>{s.nombre} ({Math.max(0, libre(s.id))})</option>)}
            </select>
          </label>
          <ArrowRight size={16} className="mb-2.5 text-muted" />
          <label className="text-xs text-muted flex flex-col gap-1">
            Hacia
            <select id="mover-hacia" value={hacia ?? ''} onChange={(e) => setHacia(e.target.value ? Number(e.target.value) : null)} className={campo}>
              <option value="">Elegir…</option>
              {sucursales.filter((s) => s.id !== desde).map((s) => <option key={s.id} value={s.id}>{s.nombre} ({prod?.local[s.id] ?? 0})</option>)}
            </select>
          </label>
        </div>
        <label className="text-xs text-muted flex flex-col gap-1">
          Cantidad {desde != null && <span className="text-faint">· disponible para mover {Math.max(0, disponible)}</span>}
          <input id="mover-cant" type="number" min={1} max={disponible || undefined} value={cant}
            onChange={(e) => setCant(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={campo} />
        </label>
        <label className="text-xs text-muted flex flex-col gap-1">
          Motivo (opcional)
          <input id="mover-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: lo pidió un cliente" className={campo} />
        </label>
        {!permiso && desde != null && hacia != null && (
          <p className="text-xs text-red-600">Con el link de {nombre(miSuc)} solo podés mover desde o hacia tu sucursal.</p>
        )}
        <button
          onClick={async () => {
            if (!valido || !prod) return
            setEnviando(true)
            await onMover({ p_codigo: codigo, p_desde: desde, p_hacia: hacia, p_cant: cant, p_nota: nota.trim() || null }, `Movidas ${cant} u de ${prod.modelo} a ${nombre(hacia)}`)
            setEnviando(false)
          }}
          disabled={!valido || enviando}
          className="bg-ink text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
        >
          {enviando ? 'Moviendo…' : valido ? `Mover ${cant} u a ${nombre(hacia)}` : 'Mover'}
        </button>
      </div>
    </div>
  )
}

// ── Pedir a Orbital: depósito Orbital sin precios ────────────────────────────
function PedirOrbital({ clave, suc, editable, operar, onEnviado }: {
  clave: string; suc: Sucursal; editable: boolean; operar: Operar; onEnviado: () => void
}) {
  const [items, setItems] = useState<ItemCatalogo[] | null>(null)
  const [busca, setBusca] = useState('')
  const [carrito, setCarrito] = useState<Record<string, number>>({})
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    supabase.rpc('consigna_catalogo', { p_k: clave }).then(({ data }) => setItems((data as ItemCatalogo[]) ?? []))
  }, [clave])
  useEffect(() => setCarrito({}), [suc.id])

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const m = new Map<string, ItemCatalogo[]>()
    for (const it of items ?? []) {
      if (q && !`${it.modelo} ${it.descripcion ?? ''}`.toLowerCase().includes(q)) continue
      m.set(it.modelo, [...(m.get(it.modelo) ?? []), it])
    }
    return [...m.entries()]
  }, [items, busca])

  const lineas = (items ?? []).filter((it) => (carrito[it.codigo] ?? 0) > 0)
  const totalU = lineas.reduce((s, it) => s + carrito[it.codigo], 0)
  const cambiar = (it: ItemCatalogo, delta: number) => {
    const n = Math.max(0, Math.min(it.disponible, (carrito[it.codigo] ?? 0) + delta))
    setCarrito({ ...carrito, [it.codigo]: n })
  }

  const enviar = async () => {
    setEnviando(true)
    const ok = await operar('consigna_pedido_crear', {
      p_sucursal: suc.id,
      p_items: lineas.map((it) => ({ codigo: it.codigo, cantidad: carrito[it.codigo] })),
      p_nota: nota.trim() || null,
    }, `Pedido de ${suc.nombre} enviado a la central para autorizar`)
    setEnviando(false)
    if (ok) { setCarrito({}); setNota(''); onEnviado() }
  }

  if (!items) return <p className="text-sm text-muted">Cargando el depósito de Orbital…</p>

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="bg-white border border-black/10 rounded-lg px-4 py-3 text-sm text-muted">
        Stock disponible hoy en el depósito de Orbital, <b className="text-ink">solo informativo</b>. Pedido para <b className="text-ink">{suc.nombre}</b>:
        lo autoriza la central y después Orbital lo envía, aparte de la reposición automática.
        {!editable && <span className="block text-red-600 mt-1">Con este link no podés pedir para {suc.nombre}.</span>}
      </div>
      <label className="relative max-w-md">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input id="catalogo-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo o color"
          className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm" />
      </label>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {grupos.map(([modelo, its]) => (
          <section key={modelo} className="bg-white border border-black/10 rounded-lg">
            <h3 className="text-sm font-semibold tracking-wide px-3 py-2 border-b border-black/10">{modelo}</h3>
            <ul className="divide-y divide-black/5">
              {its.map((it) => {
                const q = carrito[it.codigo] ?? 0
                return (
                  <li key={it.codigo} className="px-3 py-1.5 flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 text-xs truncate" title={it.descripcion ?? ''}>{it.descripcion}</span>
                    <span className="text-[11px] text-muted tabular-nums w-10 text-right">{it.disponible}{it.mas ? '+' : ''}</span>
                    {editable && (
                      <span className="flex items-center gap-1">
                        <button onClick={() => cambiar(it, -1)} disabled={q === 0} aria-label="Menos" className="border border-black/15 rounded p-0.5 disabled:opacity-30"><Minus size={12} /></button>
                        <span className={`w-5 text-center tabular-nums ${q ? 'font-semibold' : 'text-black/25'}`}>{q}</span>
                        <button onClick={() => cambiar(it, 1)} disabled={q >= it.disponible} aria-label="Más" className="border border-black/15 rounded p-0.5 disabled:opacity-30"><Plus size={12} /></button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {totalU > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-ink text-white px-4 pt-3 z-40" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center gap-3">
            <span className="text-sm">{suc.nombre} · <b className="tabular-nums">{totalU} u</b> en {lineas.length} productos</span>
            <input id="pedido-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Para qué lo necesitás (opcional)"
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm placeholder:text-white/50 flex-1 min-w-[180px]" />
            <button onClick={() => setCarrito({})} className="text-sm text-white/70">Vaciar</button>
            <button onClick={enviar} disabled={enviando} className="bg-gold text-ink font-semibold text-sm rounded-lg px-4 py-1.5 flex items-center gap-2 disabled:opacity-50">
              <Send size={14} /> Enviar a la central
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pedidos particulares: la central autoriza ────────────────────────────────
function Pedidos({ data, esCentral, operar }: { data: Central; esCentral: boolean; operar: Operar }) {
  const nombreSuc = (id: number) => data.sucursales.find((s) => s.id === id)?.nombre ?? '—'
  const [ocupado, setOcupado] = useState<number | null>(null)

  if (data.pedidos.length === 0) return <p className="text-sm text-muted bg-white border border-black/10 rounded-lg px-4 py-6">Todavía no hay pedidos particulares.</p>

  const resolver = async (p: Pedido, autoriza: boolean) => {
    let motivo: string | null = null
    if (!autoriza) {
      motivo = window.prompt('¿Por qué lo rechazás? (lo ve la sucursal)') ?? null
      if (motivo === null) return
    }
    setOcupado(p.id)
    await operar('consigna_pedido_resolver', { p_id: p.id, p_autoriza: autoriza, p_motivo: motivo },
      autoriza ? `Autorizado: Orbital ya tiene el pedido de ${nombreSuc(p.sucursal_id)}` : 'Pedido rechazado')
    setOcupado(null)
  }

  return (
    <div className="grid md:grid-cols-2 gap-3 items-start">
      {data.pedidos.map((p) => (
        <section key={p.id} className="bg-white border border-black/10 rounded-lg">
          <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <div className="font-semibold">{nombreSuc(p.sucursal_id)}</div>
              <div className="text-xs text-muted">{fecha(p.created_at)} · pidió {p.solicitado_por ?? '—'}</div>
            </div>
            <EstadoPedido e={p.estado} />
          </div>
          <ul className="px-4 py-2 text-sm divide-y divide-black/5">
            {p.items.map((it) => (
              <li key={it.codigo} className="py-1 flex gap-3">
                <span className="flex-1 min-w-0"><b className="text-[11px] tracking-wide">{it.modelo}</b> <span className="text-xs text-muted">{it.descripcion}</span></span>
                <span className="tabular-nums font-medium">{it.cantidad}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="mr-auto tabular-nums">Total {p.total_units} u{p.nota ? ` · "${p.nota}"` : ''}</span>
            {p.estado !== 'solicitado' && (
              <span>{p.estado === 'autorizado' ? 'Autorizó' : 'Rechazó'} {p.autorizado_por}{p.motivo_rechazo ? `: ${p.motivo_rechazo}` : ''}</span>
            )}
            {p.estado === 'solicitado' && esCentral && (
              <>
                <button onClick={() => resolver(p, false)} disabled={ocupado === p.id} className="border border-black/15 rounded-md px-3 py-1.5 text-ink disabled:opacity-40">Rechazar</button>
                <button onClick={() => resolver(p, true)} disabled={ocupado === p.id} className="bg-ink text-white rounded-md px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
                  <PackageCheck size={14} /> Autorizar y pasar a Orbital
                </button>
              </>
            )}
            {p.estado === 'solicitado' && !esCentral && <span>Esperando que la central lo autorice</span>}
          </div>
        </section>
      ))}
    </div>
  )
}

function EstadoPedido({ e }: { e: Pedido['estado'] }) {
  const m = {
    solicitado: ['Esperando autorización', 'bg-amber-100 text-amber-800'],
    autorizado: ['Autorizado · en Orbital', 'bg-emerald-100 text-emerald-800'],
    rechazado: ['Rechazado', 'bg-black/5 text-muted'],
  }[e]
  return <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${m[1]}`}>{m[0]}</span>
}

function Dato({ label, valor, tono = '' }: { label: string; valor: string; tono?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold tabular-nums leading-tight ${tono}`}>{valor}</div>
    </div>
  )
}

function Ingreso({ error, onEntrar }: { error: string | null; onEntrar: (k: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="min-h-screen grid place-items-center bg-[#F6F4EF] px-4">
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onEntrar(v.trim()) }}
        className="bg-white border border-black/10 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3">
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
