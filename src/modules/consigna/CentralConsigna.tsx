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
import { colorSwatch } from '../catalogo/colorLegible'
import Postventa from './Postventa'
import Consultas from './Consultas'
import LinksSucursales from './LinksSucursales'
import EnviosRepos from './EnviosRepos'

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
type Vista = 'tablero' | 'devolucion' | 'stock' | 'pedir' | 'pedidos' | 'postventa' | 'consultas' | 'links' | 'camino' | 'repo'

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
      // Central arranca en el Total (todas); link de sucursal, en su sucursal.
      setSelSuc((s) => s ?? d.acceso.sucursal_id ?? null)
      if (d.acceso.sucursal_id == null) setVista((v) => (v === 'tablero' ? 'stock' : v))
      // Nombre precargado con el del link (se puede cambiar) para no bloquear la primera operación.
      setQuien((q) => q || (d.acceso.nombre ?? ''))
    })
  }, [clave])

  // Todas las acciones devuelven la central actualizada (null si falló).
  const operar = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const nombre = quien.trim()
    if (!nombre) { toast('Poné tu nombre arriba antes de operar', 'error'); return null }
    guardar(QUIEN_KEY, nombre)
    const { data, error } = await supabase.rpc(fn, { p_k: clave, p_quien: nombre, ...args })
    if (error) { toast(msgError(error), 'error'); return null }
    const d = data as Central
    setData(d)
    toast(ok, 'success')
    return d
  }

  if (!clave || (error && !data)) return <Ingreso error={error} onEntrar={(k) => { setError(null); setClave(k) }} />
  if (!data) return <div className="min-h-screen grid place-items-center bg-[#F6F4EF] text-muted text-sm">{cargando ? 'Cargando…' : ''}</div>

  const sucs = data.sucursales
  const miSuc = data.acceso.sucursal_id
  const esCentral = miSuc == null
  const puedeOperar = (id: number) => esCentral || miSuc === id
  const suc = sucs.find((s) => s.id === selSuc)
  const sumaSuc = (id: number, k: 'cantidad' | 'devolver' | 'en_camino') =>
    data.stock.filter((l) => l.sucursal_id === id).reduce((s, l) => s + l[k], 0)
  const tot = (k: 'cantidad' | 'devolver' | 'en_camino') => data.stock.reduce((s, l) => s + l[k], 0)
  const porAutorizar = data.pedidos.filter((p) => p.estado === 'solicitado').length
  const devPend = data.devoluciones.reduce((s, d) => s + d.cantidad - d.enviada - d.conservada - (d.vendida ?? 0), 0)

  // Devolución, por ahora, solo la central y solo en el Total: es el detalle general, no el de una sucursal.
  const tabs: [Vista, string, string][] = [
    ...(suc ? [['tablero', 'Sucursal', suc.nombre] as [Vista, string, string]] : []),
    ...(esCentral && !suc ? [['devolucion', 'Devolución', devPend ? `${fmt(devPend)} u` : ''] as [Vista, string, string]] : []),
    ['stock', 'Stock de todas', `${fmt(tot('cantidad'))} u`],
    ['camino', 'En camino', tot('en_camino') ? `${fmt(tot('en_camino'))} u` : ''],
    ['repo', 'Reposición por venta', ''],
    ['pedir', 'Stock online', ''],
    ['pedidos', esCentral ? 'Pedidos a autorizar' : 'Pedidos', porAutorizar ? `${porAutorizar}` : ''],
    ['postventa', 'Postventa', ''],
    ['consultas', 'Consultas IRIS', ''],
    ...(esCentral ? [['links', 'Links de sucursal', ''] as [Vista, string, string]] : []),
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
        <section className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          <button
            onClick={() => { setSelSuc(null); setVista((v) => (v === 'tablero' ? 'stock' : v)) }}
            title="Todas las sucursales"
            className={`text-left rounded-lg border px-3 py-2 transition-colors ${selSuc == null ? 'bg-ink text-white border-ink' : 'bg-[#FBF7EC] border-gold/60 hover:border-gold'}`}
          >
            <div className={`text-[11px] font-semibold uppercase tracking-wide ${selSuc == null ? 'text-white/70' : 'text-muted'}`}>Total · {sucs.length} suc.</div>
            <div className="text-lg font-semibold tabular-nums leading-tight">{fmt(tot('cantidad'))} u</div>
            <div className="text-[11px] tabular-nums flex gap-2 mt-0.5">
              {tot('devolver') > 0 && <span className={selSuc == null ? 'text-amber-300' : 'text-amber-700'}>↩ {fmt(tot('devolver'))}</span>}
              {tot('en_camino') > 0 && <span className={selSuc == null ? 'text-emerald-300' : 'text-emerald-700'}>+ {fmt(tot('en_camino'))}</span>}
            </div>
          </button>
          {sucs.map((s) => {
            const activa = selSuc === s.id
            const dev = sumaSuc(s.id, 'devolver')
            const cam = sumaSuc(s.id, 'en_camino')
            return (
              <button
                key={s.id}
                onClick={() => { setSelSuc(s.id); setVista('tablero') }}
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

        <nav className="flex flex-wrap gap-1.5">
          {tabs.map(([k, label, extra]) => {
            // La devolución va en ámbar: es otra cosa, no se mezcla con mirar stock o pedir.
            const dev = k === 'devolucion'
            return (
              <button
                key={k}
                onClick={() => setVista(k)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md border whitespace-nowrap transition-colors ${vista === k
                  ? dev ? 'bg-amber-700 text-white border-amber-700' : 'bg-ink text-white border-ink'
                  : dev ? 'bg-amber-50 text-amber-900 border-amber-300 hover:border-amber-600' : 'bg-white text-ink border-black/20 hover:border-gold'}`}
              >
                {label}
                {extra && <span className={`ml-1.5 font-medium ${vista === k ? (dev ? 'text-amber-100' : 'text-gold') : 'text-amber-700'}`}>{extra}</span>}
              </button>
            )
          })}
        </nav>

        {vista === 'tablero' && suc && (
          <Tablero data={data} suc={suc} editable={puedeOperar(suc.id)} operar={operar} />
        )}
        {vista === 'consultas' && <Consultas clave={clave} data={data} quien={quien} />}
        {(vista === 'camino' || vista === 'repo') && <EnviosRepos clave={clave} data={data} modo={vista === 'camino' ? 'camino' : 'repo'} />}
        {vista === 'links' && esCentral && <LinksSucursales clave={clave} cliente={data.madre?.nombre ?? 'Orbital'} />}
        {vista === 'devolucion' && esCentral && !suc && <DevolucionCentral data={data} esCentral={esCentral} operar={operar} />}
        {vista === 'stock' && <StockGeneral data={data} miSuc={miSuc} operar={operar} />}
        {vista === 'pedir' && (
          // Con link de sucursal el catálogo siempre pide para SU sucursal; la central ve el catálogo
          // siempre y elige el destino (la tarjeta elegida o el selector) — su pedido no espera autorización.
          <PedirOrbital
            clave={clave}
            suc={miSuc != null ? sucs.find((s) => s.id === miSuc) ?? null : suc ?? null}
            sucursales={sucs}
            esCentral={esCentral}
            editable
            operar={operar}
            onEnviado={() => setVista('pedidos')}
          />
        )}
        {vista === 'pedidos' && <Pedidos data={data} esCentral={esCentral} operar={operar} />}
        {vista === 'postventa' && !suc && (
          <div className="bg-white border border-black/10 rounded-lg px-4 py-5 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">¿De qué sucursal es la postventa?</span>
            <select
              id="consigna-suc-postventa"
              aria-label="Sucursal"
              defaultValue=""
              onChange={(e) => setSelSuc(Number(e.target.value))}
              className="text-sm border border-black/15 rounded-lg px-2.5 py-1.5"
            >
              <option value="" disabled>Elegí una sucursal</option>
              {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        {vista === 'postventa' && suc && (
          <Postventa clave={clave} data={data} suc={suc} editable={puedeOperar(suc.id)} quien={quien} />
        )}
      </main>
    </div>
  )
}

type Operar = (fn: string, args: Record<string, unknown>, ok: string) => Promise<Central | null>

// ── Tablero de una sucursal: qué tiene que devolver y qué le llega nuevo ────
function Tablero({ data, suc, editable, operar }: { data: Central; suc: Sucursal; editable: boolean; operar: Operar }) {
  const envio = data.stock.filter((l) => l.sucursal_id === suc.id && l.en_camino > 0)
    .sort((a, b) => (a.modelo ?? '').localeCompare(b.modelo ?? ''))
  const totCamino = envio.reduce((s, l) => s + l.en_camino, 0)
  const pedidos = data.pedidos.filter((p) => p.sucursal_id === suc.id)

  // La devolución ya no va por sucursal: se gestiona en la pestaña "Devolución a Orbital" de la central.
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <>
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
      </>
    </div>
  )
}

// ── Devolución a Orbital: centralizada en la central, consolidada por producto ─
// En esta etapa la registra SOLO la central (el link de sucursal la ve, no opera). La RPC reparte
// la cantidad entre las sucursales que tienen pendiente ese código.
type GrupoDev = {
  codigo: string; modelo: string; descripcion: string; motivos: string[]
  cantidad: number; pendiente: number; enviada: number; conservada: number; vendida: number
  porSuc: Record<number, number>
}

function DevolucionCentral({ data, esCentral, operar }: { data: Central; esCentral: boolean; operar: Operar }) {
  const [ocupado, setOcupado] = useState(false)
  const nombreSuc = (id: number) => data.sucursales.find((s) => s.id === id)?.nombre ?? `#${id}`
  const grupos = useMemo<GrupoDev[]>(() => {
    const m = new Map<string, GrupoDev>()
    for (const d of data.devoluciones) {
      let g = m.get(d.codigo)
      if (!g) {
        g = { codigo: d.codigo, modelo: d.modelo, descripcion: d.descripcion ?? '', motivos: [], cantidad: 0, pendiente: 0, enviada: 0, conservada: 0, vendida: 0, porSuc: {} }
        m.set(d.codigo, g)
      }
      const pend = d.cantidad - d.enviada - d.conservada - (d.vendida ?? 0)
      g.cantidad += d.cantidad; g.pendiente += pend; g.enviada += d.enviada; g.conservada += d.conservada; g.vendida += d.vendida ?? 0
      if (pend > 0) g.porSuc[d.sucursal_id] = (g.porSuc[d.sucursal_id] ?? 0) + pend
      if (d.motivo && !g.motivos.includes(d.motivo)) g.motivos.push(d.motivo)
    }
    return [...m.values()].sort((a, b) => b.pendiente - a.pendiente || a.modelo.localeCompare(b.modelo))
  }, [data.devoluciones])
  const tot = grupos.reduce((s, g) => ({ pend: s.pend + g.pendiente, dev: s.dev + g.enviada, queda: s.queda + g.conservada }), { pend: 0, dev: 0, queda: 0 })

  const devolverTodo = async () => {
    if (!window.confirm(`¿Confirmás que se devuelven a Orbital las ${tot.pend} u pendientes de todas las sucursales?`)) return
    setOcupado(true)
    await operar('consigna_devolucion_central', { p_codigo: null, p_devuelve: null, p_conserva: null }, 'Devolución registrada')
    setOcupado(false)
  }

  return (
    /* En ámbar: la devolución es otra cosa que mirar stock o pedir. */
    <section className="bg-amber-50/70 border border-amber-200 rounded-lg">
      <div className="px-4 py-3 border-b border-amber-200 flex flex-wrap items-center gap-x-5 gap-y-2">
        <h2 className="font-semibold flex items-center gap-2 mr-auto"><Undo2 size={16} className="text-amber-700" /> Devolución a Orbital · todas las sucursales</h2>
        <span className="text-xs text-muted tabular-nums">Pendiente <b className="text-amber-700">{tot.pend}</b> · devuelto <b>{tot.dev}</b> · se queda <b>{tot.queda}</b></span>
        {esCentral && tot.pend > 0 && (
          <button onClick={devolverTodo} disabled={ocupado} className="text-xs bg-amber-100 text-amber-900 font-medium rounded-lg px-3 py-1.5 disabled:opacity-50">
            Devolver todo lo pendiente
          </button>
        )}
      </div>
      <p className="text-xs text-muted px-4 pt-3">
        {esCentral
          ? 'La central junta lo de las sucursales y lo devuelve a Orbital. Se registra por producto (todo o una parte); lo que no se devuelve se marca "se queda" y pasa a stock normal.'
          : 'La devolución la gestiona la central. Acá ves qué tiene que juntar cada sucursal.'}
      </p>
      {grupos.length === 0 ? (
        <p className="text-sm text-muted px-4 py-6">Orbital no pidió devoluciones.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse mt-2">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="text-left font-medium px-4 py-2 border-b border-black/10">Modelo · color</th>
                <th className="text-left font-medium px-2 py-2 border-b border-black/10">Por qué</th>
                <th className="text-left font-medium px-2 py-2 border-b border-black/10">Dónde está</th>
                <th className="text-right font-medium px-2 py-2 border-b border-black/10">Pedido</th>
                <th className="text-right font-medium px-2 py-2 border-b border-black/10">Pendiente</th>
                <th className="text-left font-medium px-4 py-2 border-b border-black/10">{esCentral ? 'Registrar' : 'Estado'}</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <FilaDevolucion key={g.codigo} g={g} nombreSuc={nombreSuc} editable={esCentral} operar={operar} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function FilaDevolucion({ g, nombreSuc, editable, operar }: { g: GrupoDev; nombreSuc: (id: number) => string; editable: boolean; operar: Operar }) {
  const pendiente = g.pendiente
  const [cant, setCant] = useState(pendiente)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => setCant(pendiente), [pendiente])
  const valida = cant > 0 && cant <= pendiente

  const accion = async (devuelve: number, conserva: number, ok: string) => {
    setOcupado(true)
    await operar('consigna_devolucion_central', { p_codigo: g.codigo, p_devuelve: devuelve, p_conserva: conserva }, ok)
    setOcupado(false)
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-2 border-b border-black/5">
        <div className="text-[11px] font-semibold tracking-wide">{g.modelo}</div>
        <div className="text-xs text-muted">{g.descripcion}</div>
      </td>
      <td className="px-2 py-2 border-b border-black/5 text-xs min-w-[180px]">{g.motivos.join(' · ')}</td>
      <td className="px-2 py-2 border-b border-black/5 text-[11px] text-muted min-w-[160px]">
        {Object.entries(g.porSuc).map(([id, n]) => (
          <span key={id} className="inline-block mr-2 whitespace-nowrap">{nombreSuc(Number(id))} <b className="text-amber-700 tabular-nums">{n}</b></span>
        ))}
      </td>
      <td className="px-2 py-2 border-b border-black/5 text-right tabular-nums">{g.cantidad}</td>
      <td className={`px-2 py-2 border-b border-black/5 text-right tabular-nums font-semibold ${pendiente > 0 ? 'text-amber-700' : 'text-black/25'}`}>{pendiente}</td>
      <td className="px-4 py-2 border-b border-black/5 whitespace-nowrap">
        {pendiente > 0 && editable ? (
          <div className="flex items-center gap-1.5">
            <input
              id={`dev-cant-${g.codigo}`}
              type="number"
              min={1}
              max={pendiente}
              value={cant}
              onChange={(e) => setCant(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              aria-label="Cantidad"
              className="w-14 border border-black/15 rounded-md px-2 py-1 text-sm tabular-nums"
            />
            <button disabled={!valida || ocupado} onClick={() => accion(cant, 0, `Devueltas ${cant} u de ${g.modelo}`)}
              className="text-xs bg-ink text-white rounded-md px-2.5 py-1.5 disabled:opacity-40">Devolver</button>
            <button disabled={!valida || ocupado} onClick={() => accion(0, cant, `${cant} u de ${g.modelo} se quedan`)}
              className="text-xs border border-black/15 rounded-md px-2.5 py-1.5 disabled:opacity-40">Se queda</button>
          </div>
        ) : (
          <span className="text-xs text-muted">
            {[g.enviada > 0 && `Devolvió ${g.enviada}`, g.conservada > 0 && `Se queda ${g.conservada}`, g.vendida > 0 && `Vendió ${g.vendida}`, pendiente > 0 && 'Pendiente']
              .filter(Boolean).join(' · ')}
          </span>
        )}
        {editable && (g.enviada > 0 || g.conservada > 0) && pendiente > 0 && (
          <div className="text-[11px] text-faint mt-0.5">Devolvió {g.enviada} · se queda {g.conservada}</div>
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

// ── Catálogo Orbital: como el catálogo de las ópticas, con fotos, sin precios ni cantidades ──
type ColorCat = { codigo: string; descripcion: string | null; tipo: string | null; tratamiento: string | null; imagen: string | null }
type ModeloCat = { modelo: string; caliente: boolean; tipos: string[]; imagen: string | null; colores: ColorCat[] }

function FotoAnteojo({ src, alt, color }: { src: string | null; alt: string; color?: string | null }) {
  const [rota, setRota] = useState(false)
  if (src && !rota) return <img src={src} alt={alt} loading="lazy" onError={() => setRota(true)} className="w-full h-full object-contain" />
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#F0EEE8] to-[#E4E1D8]">
      <svg width="64" height="30" viewBox="0 0 64 30" fill="none" stroke={color ? colorSwatch(color) : '#B5AF9F'} strokeWidth="3">
        <circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14h12M4 12l4-3M60 12l-4-3" />
      </svg>
    </div>
  )
}

function PedirOrbital({ clave, suc, sucursales, esCentral, editable, operar, onEnviado }: {
  clave: string; suc: Sucursal | null; sucursales: Sucursal[]; esCentral: boolean
  editable: boolean; operar: Operar; onEnviado: () => void
}) {
  const [modelos, setModelos] = useState<ModeloCat[] | null>(null)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<'' | 'sol' | 'receta'>('')
  const [abierto, setAbierto] = useState<ModeloCat | null>(null)
  const [carrito, setCarrito] = useState<Record<string, number>>({})
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  // La central entra al catálogo sin sucursal elegida: el destino se elige acá.
  const [destinoSel, setDestinoSel] = useState<number | null>(null)
  const destino = sucursales.find((s) => s.id === (esCentral ? destinoSel ?? suc?.id ?? null : suc?.id)) ?? null

  useEffect(() => {
    supabase.rpc('consigna_catalogo', { p_k: clave }).then(({ data }) => setModelos((data as ModeloCat[]) ?? []))
  }, [clave])
  useEffect(() => { setCarrito({}); setDestinoSel(null) }, [suc?.id])

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (modelos ?? [])
      .map((m) => (tipo ? { ...m, colores: m.colores.filter((c) => c.tipo === tipo) } : m))
      .filter((m) => m.colores.length > 0)
      .filter((m) => !q || `${m.modelo} ${m.colores.map((c) => c.descripcion).join(' ')}`.toLowerCase().includes(q))
  }, [modelos, busca, tipo])

  const todos = useMemo(() => new Map((modelos ?? []).flatMap((m) => m.colores.map((c) => [c.codigo, { ...c, modelo: m.modelo }] as const))), [modelos])
  const lineas = Object.entries(carrito).filter(([, q]) => q > 0)
  const totalU = lineas.reduce((s, [, q]) => s + q, 0)
  const enModelo = (m: ModeloCat) => m.colores.reduce((s, c) => s + (carrito[c.codigo] ?? 0), 0)
  const cambiar = (codigo: string, delta: number) => setCarrito((c) => ({ ...c, [codigo]: Math.max(0, Math.min(99, (c[codigo] ?? 0) + delta)) }))

  const enviar = async () => {
    if (!destino) return
    setEnviando(true)
    const d = await operar('consigna_pedido_crear', {
      p_sucursal: destino.id,
      p_items: lineas.map(([codigo, cantidad]) => ({ codigo, cantidad })),
      p_nota: nota.trim() || null,
    }, esCentral ? `Pedido para ${destino.nombre} enviado a Orbital` : `Pedido de ${destino.nombre} enviado a la central para autorizar`)
    // La central es la que autoriza: su propio pedido sale derecho a Orbital.
    if (d && esCentral) {
      const nuevo = d.pedidos.filter((p) => p.estado === 'solicitado' && p.sucursal_id === destino.id)
        .sort((a, b) => b.id - a.id)[0]
      if (nuevo) await operar('consigna_pedido_resolver', { p_id: nuevo.id, p_autoriza: true, p_motivo: null }, 'Orbital ya tiene el pedido')
    }
    setEnviando(false)
    if (d) { setCarrito({}); setNota(''); onEnviado() }
  }

  if (!modelos) return <p className="text-sm text-muted">Cargando el catálogo de Orbital…</p>

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input id="catalogo-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo o color"
            className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm" />
        </label>
        <div className="flex gap-1 bg-black/5 rounded-lg p-1">
          {([['', 'Todos'], ['sol', 'Sol'], ['receta', 'Receta']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTipo(k)} className={`text-sm rounded-md px-3 py-1 ${tipo === k ? 'bg-white shadow-sm font-semibold' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
        {esCentral ? (
          <label className="text-xs text-muted ml-auto flex items-center gap-2">
            Pedido para
            <select
              id="pedido-destino"
              value={destino?.id ?? ''}
              onChange={(e) => setDestinoSel(e.target.value ? Number(e.target.value) : null)}
              className="text-sm text-ink bg-white border border-black/15 rounded-lg px-2.5 py-1.5"
            >
              <option value="">Elegí la sucursal</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        ) : (
          <span className="text-xs text-muted ml-auto">Pedido para <b className="text-ink">{destino?.nombre}</b> · lo autoriza la central</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {visibles.map((m) => {
          const q = enModelo(m)
          return (
            <button key={m.modelo} onClick={() => setAbierto(m)}
              className="text-left bg-white border border-black/10 rounded-xl overflow-hidden hover:border-gold transition-colors relative">
              <div className="aspect-[4/3] bg-white p-2"><FotoAnteojo src={m.imagen} alt={m.modelo} /></div>
              <div className="px-3 py-2 border-t border-black/5">
                <div className="text-sm font-semibold tracking-wide truncate">{m.modelo}</div>
                <div className="text-[11px] text-muted">{m.colores.length} {m.colores.length === 1 ? 'color' : 'colores'}{m.caliente ? ' · 🔥 más pedido' : ''}</div>
              </div>
              {q > 0 && <span className="absolute top-2 right-2 bg-ink text-white text-[11px] font-semibold rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center">{q}</span>}
            </button>
          )
        })}
      </div>
      {visibles.length === 0 && <p className="text-sm text-muted">No hay modelos con ese filtro.</p>}

      {abierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAbierto(null)}>
          <div className="bg-[#FBFAF7] w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-[#FBFAF7] border-b border-black/10 px-5 py-3 flex items-center justify-between">
              <h3 className="font-semibold tracking-wide">{abierto.modelo}</h3>
              <button onClick={() => setAbierto(null)} aria-label="Cerrar" className="text-muted"><X size={20} /></button>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(tipo ? abierto.colores.filter((c) => c.tipo === tipo) : abierto.colores).map((c) => {
                const q = carrito[c.codigo] ?? 0
                return (
                  <div key={c.codigo} className={`bg-white border rounded-xl overflow-hidden ${q ? 'border-ink' : 'border-black/10'}`}>
                    <div className="aspect-[4/3] p-2"><FotoAnteojo src={c.imagen} alt={`${abierto.modelo} ${c.descripcion ?? ''}`} color={c.descripcion} /></div>
                    <div className="px-3 pt-2 pb-3 border-t border-black/5 flex flex-col gap-2">
                      <div>
                        <div className="text-xs font-medium leading-snug">{c.descripcion}</div>
                        <div className="text-[10px] text-faint uppercase tracking-wide">{[c.tipo, c.tratamiento].filter(Boolean).join(' · ')}</div>
                      </div>
                      {editable && (
                        <div className="flex items-center justify-between">
                          <button onClick={() => cambiar(c.codigo, -1)} disabled={q === 0} aria-label="Menos" className="border border-black/15 rounded-md p-1 disabled:opacity-30"><Minus size={14} /></button>
                          <span className={`tabular-nums text-sm ${q ? 'font-semibold' : 'text-black/25'}`}>{q}</span>
                          <button onClick={() => cambiar(c.codigo, 1)} aria-label="Más" className="border border-black/15 rounded-md p-1"><Plus size={14} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sticky bottom-0 bg-[#FBFAF7] border-t border-black/10 px-5 py-3 flex justify-end">
              <button onClick={() => setAbierto(null)} className="bg-ink text-white text-sm font-medium rounded-lg px-4 py-2">Listo</button>
            </div>
          </div>
        </div>
      )}

      {totalU > 0 && !abierto && (
        <div className="fixed bottom-0 inset-x-0 bg-ink text-white px-4 pt-3 z-40" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center gap-3">
            <span className="text-sm">{destino?.nombre ?? 'Sin sucursal'} · <b className="tabular-nums">{totalU} u</b> en {lineas.length} productos</span>
            <span className="text-xs text-white/60 hidden md:inline truncate max-w-md">
              {lineas.slice(0, 3).map(([k, q]) => `${q} ${todos.get(k)?.modelo ?? ''}`).join(' · ')}{lineas.length > 3 ? '…' : ''}
            </span>
            <input id="pedido-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Para qué lo necesitás (opcional)"
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm placeholder:text-white/50 flex-1 min-w-[180px]" />
            <button onClick={() => setCarrito({})} className="text-sm text-white/70">Vaciar</button>
            <button onClick={enviar} disabled={enviando || !destino} title={destino ? '' : 'Elegí arriba para qué sucursal es'}
              className="bg-gold text-ink font-semibold text-sm rounded-lg px-4 py-1.5 flex items-center gap-2 disabled:opacity-50">
              <Send size={14} /> {esCentral ? 'Enviar a Orbital' : 'Enviar a la central'}
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
