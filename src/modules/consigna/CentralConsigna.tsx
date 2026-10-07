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
import { ArrowRight, Search, X, Store, History, PackageCheck, Undo2, Truck, Minus, Plus, Check, Send, HelpCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import InstalarApp from '../../components/InstalarApp'
import { FotoAnteojo, Miniatura } from './Foto'
import Postventa from './Postventa'
import Consultas from './Consultas'
import LinksSucursales from './LinksSucursales'
import EnviosRepos from './EnviosRepos'
import Instructivo from './Instructivo'
import VentasConsigna from './VentasConsigna'
import MarketingConsigna from './MarketingConsigna'

const CLAVE_KEY = 'orbital_consigna_clave'
const DEV_KEY = 'orbital_consigna_dev'
const QUIEN_KEY = 'orbital_consigna_quien'

export type Sucursal = { id: number; nombre: string; direccion: string | null; localidad: string | null }
type Linea = {
  sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null
  cantidad: number; devolver: number; en_camino: number; precio: number | null; imagen?: string | null
}
type Mov = {
  id: number; fecha: string; tipo: string; codigo: string; modelo: string | null; descripcion: string | null
  cantidad: number; sucursal_id: number; contraparte_sucursal_id: number | null; nota: string | null; creado_por: string | null
}
type Devolucion = {
  id: number; sucursal_id: number; codigo: string; modelo: string; descripcion: string | null
  cantidad: number; enviada: number; conservada: number; vendida: number; recibida: number; vendio: number | null; motivo: string; ultimo_por: string | null; imagen?: string | null
}
type ItemPedido = { codigo: string; modelo: string; descripcion: string; cantidad: number }
type Pedido = {
  id: number; sucursal_id: number; items: ItemPedido[]; total_units: number; nota: string | null
  estado: 'solicitado' | 'autorizado' | 'rechazado'; solicitado_por: string | null; autorizado_por: string | null
  motivo_rechazo: string | null; created_at: string; resuelto_at: string | null
}
export type Central = {
  madre: { cod: string; razon: string; nombre: string } | null
  acceso: { nombre: string | null; sucursal_id: number | null; catalogo?: string | null; catalogo_central?: string | null }
  sucursales: Sucursal[]
  stock: Linea[]
  movs: Mov[]
  devoluciones: Devolucion[]
  pedidos: Pedido[]
}
type Producto = {
  codigo: string; modelo: string; descripcion: string; precio: number; imagen: string | null
  local: Record<number, number>; devolver: Record<number, number>; camino: Record<number, number>; total: number
}
type Vista = 'tablero' | 'devolucion' | 'stock' | 'pedir' | 'pedidos' | 'postventa' | 'consultas' | 'links' | 'camino' | 'repo' | 'ayuda' | 'ventas' | 'marketing'

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sin storage */ } }
const fmt = (n: number) => n.toLocaleString('es-AR')
// Id de esta terminal (por navegador). Si no hay storage, va sin id y el candado no aplica.
function deviceId(): string | null {
  const guardado = leer(DEV_KEY)
  if (guardado) return guardado
  const nuevo = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 24)
  guardar(DEV_KEY, nuevo)
  return leer(DEV_KEY)
}
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
  // ?suc=<id> con el link de la central abre directo el panel de esa sucursal (links del informe).
  const [selSuc, setSelSuc] = useState<number | null>(() => Number(params.get('suc')) || null)
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')
  const [dispo, setDispo] = useState<{ ok: boolean; habilitados?: number; tope?: number } | null>(null)

  // Candado de terminales: la central admite 8 y cada sucursal 4. Si se pasa, no se pide usuario ni
  // contraseña: queda pendiente, avisamos por Telegram y se activa desde la Suite.
  useEffect(() => {
    if (!clave) return
    supabase.rpc('consigna_dispositivo_ok', { p_k: clave, p_device: deviceId(), p_ua: navigator.userAgent })
      .then(({ data, error }) => { if (!error) setDispo(data as { ok: boolean; habilitados?: number; tope?: number }) })
  }, [clave])

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
      // Link de sucursal: queda fijo en su sucursal. Central: arranca en el Total (o en la ?suc= pedida).
      if (d.acceso.sucursal_id != null) setSelSuc(d.acceso.sucursal_id)
      else setSelSuc((s) => (s != null && d.sucursales.some((x) => x.id === s) ? s : null))
      if (d.acceso.sucursal_id == null && !Number(params.get('suc'))) setVista((v) => (v === 'tablero' ? 'ventas' : v))
      // Nombre precargado con el del link (se puede cambiar) para no bloquear la primera operación.
      setQuien((q) => q || (d.acceso.nombre ?? ''))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  if (dispo && !dispo.ok) return (
    <div className="min-h-screen grid place-items-center bg-[#F6F4EF] px-4">
      <div className="bg-white border border-black/10 rounded-lg max-w-md w-full px-5 py-6 text-center">
        <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital mx-auto" />
        <h1 className="text-lg font-semibold mt-3">Esta terminal está por habilitarse</h1>
        <p className="text-sm text-muted mt-2">
          Ya avisamos a Orbital para activarla. No hace falta usuario ni contraseña: en cuanto la habilitemos,
          recargá esta página y entrás.
        </p>
        <p className="text-xs text-faint mt-3">
          Terminales habilitadas: {dispo.habilitados ?? '—'} de {dispo.tope ?? '—'}. Si alguna no se usa más, la damos de baja y liberamos el lugar.
        </p>
        <button onClick={() => window.location.reload()} className="mt-4 text-xs bg-ink text-white rounded-lg px-3 py-1.5">Volver a probar</button>
      </div>
    </div>
  )
  if (!data) return <div className="min-h-screen grid place-items-center bg-[#F6F4EF] text-muted text-sm">{cargando ? 'Cargando…' : ''}</div>

  const sucs = data.sucursales
  const miSuc = data.acceso.sucursal_id
  const esCentral = miSuc == null
  const suc = sucs.find((s) => s.id === selSuc) ?? null
  // Lo que se muestra: con una sucursal elegida (link de sucursal o la central mirando una), solo lo de esa sucursal.
  const vis = suc ? soloSucursal(data, suc.id) : data
  const editable = suc ? esCentral || miSuc === suc.id : esCentral
  const sumaSuc = (id: number, k: 'cantidad' | 'devolver' | 'en_camino') =>
    data.stock.filter((l) => l.sucursal_id === id).reduce((s, l) => s + l[k], 0)
  const tot = (d: Central, k: 'cantidad' | 'devolver' | 'en_camino') => d.stock.reduce((s, l) => s + l[k], 0)
  const porAutorizar = vis.pedidos.filter((p) => p.estado === 'solicitado').length
  const devPend = data.devoluciones.reduce((s, d) => s + d.cantidad - d.enviada - d.conservada - (d.vendida ?? 0), 0)

  const elegirSuc = (id: number | null) => {
    setSelSuc(id)
    setVista(id == null ? (vista === 'tablero' ? 'ventas' : vista) : 'tablero')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Dos juegos de pestañas: el de una sucursal (lo que ve el local, y la central cuando entra a un local)
  // y el de la central en el Total. Devolución y links son solo de la central.
  const tabs: [Vista, string, string][] = suc
    ? [
        ['tablero', esCentral ? `Panel de ${suc.nombre}` : 'Mi local', `${fmt(tot(vis, 'cantidad'))} u`],
        ['pedir', 'Pedir a Orbital · stock virtual', ''],
        ['pedidos', 'Pedidos', porAutorizar ? `${porAutorizar}` : ''],
        ['camino', 'Envíos', tot(vis, 'en_camino') ? `${fmt(tot(vis, 'en_camino'))} u` : ''],
        ['ventas', 'Ventas', ''],
        ['postventa', 'Postventa', ''],
        ['consultas', 'Consultas IRIS', ''],
        ['marketing', '✦ Marketing y redes', ''],
      ]
    : [
        ['ventas', 'Resumen y ventas', ''],
        ['stock', 'Stock por sucursal', `${fmt(tot(data, 'cantidad'))} u`],
        ['devolucion', 'Devolución', devPend ? `${fmt(devPend)} u` : ''],
        ['camino', 'En camino', tot(data, 'en_camino') ? `${fmt(tot(data, 'en_camino'))} u` : ''],
        ['repo', 'Reposición por venta', ''],
        ['pedidos', 'Pedidos a autorizar', porAutorizar ? `${porAutorizar}` : ''],
        ['pedir', 'Stock virtual Orbital', ''],
        ['marketing', '✦ Marketing y redes', ''],
        ['postventa', 'Postventa', ''],
        ['consultas', 'Consultas IRIS', ''],
        ['links', 'Links de sucursal', ''],
      ]
  const vistaOk = tabs.some(([k]) => k === vista) ? vista : tabs[0][0]

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-ink">
      <header className="bg-white border-b border-black/10">
        <div className="max-w-[1400px] mx-auto px-4 py-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
              <span className="text-[9px] font-bold tracking-[0.28em] text-gold uppercase mt-0.5">Consigna</span>
              <span className="ml-2">
                <InstalarApp nombre="Orbital Consigna" que={esCentral ? 'la central' : 'tu sucursal'} urlParaInstalar={`/consigna?k=${clave}`}
                  bajada={esCentral ? 'Queda con el ícono de Orbital y entra directo a la central, sin clave.' : 'Queda con el ícono de Orbital en la compu o el teléfono del local y entra directo a tu sucursal.'} />
              </span>
              {/* Ayuda arriba, al lado de Instalar: es lo primero que busca alguien que entra por primera vez. */}
              <a
                href={`/consigna/ayuda?k=${clave}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold rounded-lg px-3 py-1.5 border inline-flex items-center gap-1.5 whitespace-nowrap bg-emerald-50 text-emerald-900 border-emerald-300 hover:border-emerald-600"
              >
                <HelpCircle size={14} /> Ayuda
              </a>
            </div>
            <h1 className="text-xl font-semibold mt-2 leading-tight">
              {data.madre?.nombre ?? 'Cliente'}
              {!esCentral && suc && <span className="text-muted font-normal"> · {suc.nombre}</span>}
            </h1>
            <p className="text-xs text-muted">
              {esCentral ? `Central de operaciones · ${sucs.length} sucursales` : 'Panel de la sucursal'}
            </p>
          </div>
          <label className="text-[10px] uppercase tracking-wider text-muted flex flex-col gap-0.5">
            Operando como
            <input
              id="consigna-quien"
              value={quien}
              onChange={(e) => setQuien(e.target.value)}
              onBlur={() => guardar(QUIEN_KEY, quien.trim() || null)}
              placeholder="Tu nombre"
              className="normal-case tracking-normal text-sm border border-black/15 rounded-lg px-2.5 py-1.5 w-44"
            />
          </label>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-4 flex flex-col gap-4">
        {/* Central: elegir el Total o entrar al panel de una sucursal. El link de sucursal no ve las otras. */}
        {esCentral && (
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <TarjetaSuc
              activa={!suc} titulo={`Todas · ${sucs.length} suc.`} sub="Central"
              cant={tot(data, 'cantidad')} dev={tot(data, 'devolver')} cam={tot(data, 'en_camino')}
              onClick={() => elegirSuc(null)} total
            />
            {sucs.map((s) => (
              <TarjetaSuc
                key={s.id} activa={suc?.id === s.id} titulo={s.nombre} sub={s.localidad ?? ''}
                cant={sumaSuc(s.id, 'cantidad')} dev={sumaSuc(s.id, 'devolver')} cam={sumaSuc(s.id, 'en_camino')}
                onClick={() => elegirSuc(s.id)}
              />
            ))}
          </section>
        )}

        {esCentral && suc && (
          <div className="flex flex-wrap items-center gap-3 bg-ink text-white rounded-lg px-4 py-2.5">
            <Store size={16} className="text-gold" />
            <span className="text-sm">Estás viendo el panel de <b>{suc.nombre}</b> tal como lo ve el local. Desde la central podés operar igual.</span>
            <button onClick={() => elegirSuc(null)} className="ml-auto text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-md px-3 py-1.5">← Volver a la central</button>
          </div>
        )}

        <nav className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 sm:flex-wrap sm:overflow-visible">
          {tabs.map(([k, label, extra]) => {
            // La devolución va en ámbar: es otra cosa, no se mezcla con mirar stock o pedir.
            const dev = k === 'devolucion'
            const act = vistaOk === k
            return (
              <button
                key={k}
                onClick={() => setVista(k)}
                className={`px-3 py-1.5 text-[13px] font-semibold rounded-lg border whitespace-nowrap transition-colors ${act
                  ? dev ? 'bg-amber-700 text-white border-amber-700' : 'bg-ink text-white border-ink'
                  : dev ? 'bg-amber-50 text-amber-900 border-amber-300 hover:border-amber-600' : 'bg-white text-ink border-black/15 hover:border-gold'}`}
              >
                {label}
                {extra && <span className={`ml-1.5 font-medium ${act ? (dev ? 'text-amber-100' : 'text-gold') : 'text-muted'}`}>{extra}</span>}
              </button>
            )
          })}
        </nav>

        {vistaOk === 'tablero' && suc && (
          <PanelSucursal data={vis} todas={data} suc={suc} editable={editable} operar={operar}
            onVista={setVista} />
        )}
        {vistaOk === 'ventas' && <VentasConsigna key={suc?.id ?? 'todas'} clave={clave} data={vis} fija={suc?.id} />}
        {vistaOk === 'marketing' && <MarketingConsigna data={vis} esCentral={esCentral && !suc} onVista={setVista} />}
        {vistaOk === 'consultas' && <Consultas clave={clave} data={vis} quien={quien} />}
        {(vistaOk === 'camino' || vistaOk === 'repo') && <EnviosRepos clave={clave} data={vis} modo={vistaOk === 'camino' ? 'camino' : 'repo'} />}
        {vistaOk === 'links' && esCentral && <LinksSucursales clave={clave} cliente={data.madre?.nombre ?? 'Orbital'} onVer={elegirSuc} />}
        {vistaOk === 'devolucion' && esCentral && !suc && <DevolucionCentral data={data} esCentral={esCentral} operar={operar} />}
        {vistaOk === 'stock' && !suc && <StockGeneral data={data} miSuc={miSuc} operar={operar} onVerSuc={elegirSuc} />}
        {vistaOk === 'pedir' && (
          // Con una sucursal elegida el pedido es para ella; la central en el Total elige el destino.
          // El pedido de la central no espera autorización.
          <PedirOrbital
            clave={clave}
            suc={suc}
            sucursales={sucs}
            esCentral={esCentral}
            editable={editable || esCentral}
            operar={operar}
            onEnviado={() => setVista('pedidos')}
          />
        )}
        {vistaOk === 'pedidos' && <Pedidos data={vis} esCentral={esCentral} operar={operar} />}
        {vistaOk === 'postventa' && !suc && (
          <div className="bg-white border border-black/10 rounded-lg px-4 py-5 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">¿De qué sucursal es la postventa?</span>
            <select
              id="consigna-suc-postventa"
              aria-label="Sucursal"
              defaultValue=""
              onChange={(e) => { setSelSuc(Number(e.target.value)); setVista('postventa') }}
              className="text-sm border border-black/15 rounded-lg px-2.5 py-1.5"
            >
              <option value="" disabled>Elegí una sucursal</option>
              {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}
        {vistaOk === 'postventa' && suc && (
          <Postventa clave={clave} data={data} suc={suc} editable={editable} quien={quien} />
        )}
      </main>
    </div>
  )
}

// Recorta la central a una sola sucursal (el link de un local, o la central mirando ese local).
function soloSucursal(d: Central, id: number): Central {
  return {
    ...d,
    sucursales: d.sucursales.filter((s) => s.id === id),
    stock: d.stock.filter((l) => l.sucursal_id === id),
    movs: d.movs.filter((m) => m.sucursal_id === id || m.contraparte_sucursal_id === id),
    devoluciones: d.devoluciones.filter((x) => x.sucursal_id === id),
    pedidos: d.pedidos.filter((p) => p.sucursal_id === id),
  }
}

function TarjetaSuc({ activa, titulo, sub, cant, dev, cam, onClick, total }: {
  activa: boolean; titulo: string; sub: string; cant: number; dev: number; cam: number; onClick: () => void; total?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${activa ? 'bg-ink text-white border-ink shadow-sm' : total ? 'bg-[#FBF7EC] border-gold/60 hover:border-gold' : 'bg-white border-black/10 hover:border-gold'}`}
    >
      <div className={`text-[12px] font-semibold truncate flex items-center gap-1 ${activa ? 'text-white' : 'text-ink'}`}>
        {!total && <Store size={12} className={activa ? 'text-gold' : 'text-muted'} />}{titulo}
      </div>
      {sub && <div className={`text-[10px] truncate ${activa ? 'text-white/60' : 'text-faint'}`}>{sub}</div>}
      <div className="text-xl font-semibold tabular-nums leading-tight mt-1">{fmt(cant)} <span className="text-xs font-normal opacity-60">u</span></div>
      <div className="text-[11px] tabular-nums flex gap-2.5 mt-0.5 min-h-[16px]">
        {cam > 0 && <span className={activa ? 'text-emerald-300' : 'text-emerald-700'} title="Llega de Orbital">+{fmt(cam)} llega</span>}
        {dev > 0 && <span className={activa ? 'text-amber-300' : 'text-amber-700'} title="Para devolver">↩ {fmt(dev)}</span>}
      </div>
    </button>
  )
}

type Operar = (fn: string, args: Record<string, unknown>, ok: string) => Promise<Central | null>

// ── Panel de una sucursal: todos los estados en una sola lista, con foto y filtros ────
// Cada producto del local en una fila: cuánto hay, cuánto llega y cuánto hay que devolver.
// Las tarjetas de arriba son también los filtros (En el local · Llega · Para devolver).
type FiltroSuc = 'todo' | 'local' | 'llega' | 'devolver'

function PanelSucursal({ data, todas, suc, editable, operar, onVista }: {
  data: Central; todas: Central; suc: Sucursal; editable: boolean; operar: Operar; onVista: (v: Vista) => void
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroSuc>('todo')
  const [mover, setMover] = useState<string | null>(null)
  const lineas = data.stock
  const totCamino = lineas.reduce((s, l) => s + l.en_camino, 0)
  const totLocal = lineas.reduce((s, l) => s + l.cantidad, 0)
  const totDev = lineas.reduce((s, l) => s + l.devolver, 0)
  const modelosN = new Set(lineas.filter((l) => l.cantidad > 0).map((l) => l.modelo)).size
  const pedidosPend = data.pedidos.filter((p) => p.estado === 'solicitado').length
  const cuenta = {
    todo: lineas.length,
    local: lineas.filter((l) => l.cantidad > 0).length,
    llega: lineas.filter((l) => l.en_camino > 0).length,
    devolver: lineas.filter((l) => l.devolver > 0).length,
  }

  // Agrupado por modelo; cada color en una fila con sus tres estados.
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const m = new Map<string, Linea[]>()
    for (const l of lineas) {
      if (q && !`${l.modelo} ${l.descripcion} ${l.codigo}`.toLowerCase().includes(q)) continue
      if (filtro === 'local' && l.cantidad <= 0) continue
      if (filtro === 'llega' && l.en_camino <= 0) continue
      if (filtro === 'devolver' && l.devolver <= 0) continue
      const k = l.modelo ?? '—'
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m.entries()].map(([modelo, ls]) => ({ modelo, ls: ls.sort((a, b) => (a.descripcion ?? '').localeCompare(b.descripcion ?? '')) }))
      .sort((a, b) => a.modelo.localeCompare(b.modelo))
  }, [lineas, busca, filtro])
  const filas = grupos.reduce((s, g) => s + g.ls.length, 0)

  // Para mover, los productos con el stock de todas las sucursales (destino) del cliente.
  const productos = useMemo<Producto[]>(() => {
    const m = new Map<string, Producto>()
    for (const l of todas.stock) {
      let p = m.get(l.codigo)
      if (!p) { p = { codigo: l.codigo, modelo: l.modelo ?? '—', descripcion: l.descripcion ?? '', precio: Number(l.precio ?? 0), imagen: l.imagen ?? null, local: {}, devolver: {}, camino: {}, total: 0 }; m.set(l.codigo, p) }
      p.local[l.sucursal_id] = l.cantidad; p.devolver[l.sucursal_id] = l.devolver; p.camino[l.sucursal_id] = l.en_camino; p.total += l.cantidad
    }
    return [...m.values()].filter((p) => (p.local[suc.id] ?? 0) - (p.devolver[suc.id] ?? 0) > 0)
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || a.descripcion.localeCompare(b.descripcion))
  }, [todas.stock, suc.id])

  const tarjetas: { k: FiltroSuc; label: string; valor: string; sub: string; tono: string; act: string }[] = [
    { k: 'todo', label: 'Todo', valor: `${cuenta.todo}`, sub: 'productos en el panel', tono: '', act: 'border-ink ring-1 ring-ink' },
    { k: 'local', label: 'En el local', valor: `${fmt(totLocal)} u`, sub: `${modelosN} modelos`, tono: '', act: 'border-ink ring-1 ring-ink' },
    { k: 'llega', label: 'Tiene que ingresar', valor: `${fmt(totCamino)} u`, sub: totCamino ? `${cuenta.llega} productos · marcalos al recibir` : 'Nada en camino', tono: 'text-emerald-700', act: 'border-emerald-600 ring-1 ring-emerald-600 bg-emerald-50/60' },
    { k: 'devolver', label: 'Para devolver', valor: `${fmt(totDev)} u`, sub: totDev ? `${cuenta.devolver} productos · lo junta la central` : 'Nada pendiente', tono: 'text-amber-700', act: 'border-amber-600 ring-1 ring-amber-600 bg-amber-50/60' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Las tarjetas son los filtros */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tarjetas.map((t) => (
          <button key={t.k} onClick={() => setFiltro(t.k)} aria-pressed={filtro === t.k}
            className={`text-left bg-white border rounded-xl px-4 py-3 transition-colors ${filtro === t.k ? t.act : 'border-black/10 hover:border-gold'}`}>
            <div className="text-[11px] uppercase tracking-wider text-muted flex items-center justify-between">
              {t.label}{filtro === t.k && <Check size={13} className="text-ink" />}
            </div>
            <div className={`text-2xl font-semibold tabular-nums leading-tight mt-0.5 ${t.tono}`}>{t.valor}</div>
            <div className="text-[11px] text-faint mt-0.5">{t.sub}</div>
          </button>
        ))}
      </div>

      <section className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold mr-auto">
            {{ todo: 'Todo el local', local: 'Lo que hay en el local', llega: 'Lo que tiene que ingresar', devolver: 'Lo que hay que devolver' }[filtro]}
            <span className="tabular-nums text-muted font-normal ml-2">{filas} {filas === 1 ? 'producto' : 'productos'}</span>
          </h2>
          <label className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input id="suc-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo o color"
              className="w-full bg-white border border-black/15 rounded-lg pl-8 pr-3 py-1.5 text-sm" />
          </label>
          {editable && filtro === 'llega' && totCamino > 0 && (
            <button
              onClick={() => operar('consigna_recibir_envio', { p_sucursal: suc.id, p_codigo: null }, `${suc.nombre} recibió el envío`)}
              className="text-xs bg-emerald-700 text-white font-semibold rounded-lg px-3 py-2 inline-flex items-center gap-1.5"
            >
              <Check size={14} /> Recibí todo ({fmt(totCamino)} u)
            </button>
          )}
          {pedidosPend > 0 && (
            <button onClick={() => onVista('pedidos')} className="text-xs text-amber-800 bg-amber-100 rounded-lg px-3 py-2">{pedidosPend} pedido{pedidosPend > 1 ? 's' : ''} esperando autorización →</button>
          )}
        </div>

        {/* Encabezado de columnas (en compu) */}
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_88px_88px_96px_76px] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted border-b border-black/5 bg-black/[0.02]">
          <span>Producto</span><span className="text-center">En el local</span><span className="text-center text-emerald-700">Ingresa</span><span className="text-center text-amber-700">Devolver</span><span />
        </div>

        {grupos.length === 0 ? (
          <p className="text-sm text-muted px-4 py-6">
            {busca ? 'No hay productos con esa búsqueda.' : { todo: 'Todavía no hay stock cargado en este local.', local: 'No hay stock en el local.', llega: 'No hay nada en camino. Cuando Orbital despache, aparece acá con foto para controlar la caja.', devolver: 'No hay nada para devolver.' }[filtro]}
          </p>
        ) : (
          <div>
            {grupos.map((g) => (
              <div key={g.modelo} className="border-b border-black/5 last:border-0">
                <div className="px-4 pt-3 pb-1 flex items-baseline gap-2">
                  <h3 className="text-[13px] font-semibold tracking-wide uppercase">{g.modelo}</h3>
                  <span className="text-[11px] text-muted">{g.ls.length} {g.ls.length === 1 ? 'color' : 'colores'}</span>
                </div>
                {g.ls.map((l) => {
                  const libre = l.cantidad - l.devolver
                  return (
                    <div key={l.codigo} className={`grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_88px_88px_96px_76px] items-center gap-x-2 gap-y-1 px-4 py-2 ${l.devolver > 0 && filtro !== 'llega' ? 'bg-amber-50/40' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Miniatura src={l.imagen} alt={`${l.modelo} ${l.descripcion ?? ''}`} color={l.descripcion} />
                        <div className="min-w-0">
                          <div className="text-sm leading-snug line-clamp-2" title={l.codigo}>{l.descripcion || l.codigo}</div>
                          {/* En celular los tres estados van debajo del nombre */}
                          <div className="md:hidden text-[11px] flex flex-wrap gap-x-3 mt-0.5 tabular-nums">
                            <span className={l.cantidad ? 'text-ink' : 'text-black/30'}>Local <b>{l.cantidad}</b></span>
                            {l.en_camino > 0 && <span className="text-emerald-700">Ingresa <b>+{l.en_camino}</b></span>}
                            {l.devolver > 0 && <span className="text-amber-700">Devolver <b>{l.devolver}</b></span>}
                          </div>
                        </div>
                      </div>
                      <Celda n={l.cantidad} />
                      <Celda n={l.en_camino} signo="+" tono="text-emerald-700" />
                      <Celda n={l.devolver} tono="text-amber-700" />
                      <div className="flex items-center justify-end gap-1.5">
                        {editable && l.en_camino > 0 && (
                          <button
                            onClick={() => operar('consigna_recibir_envio', { p_sucursal: suc.id, p_codigo: l.codigo }, `Recibido ${l.modelo}`)}
                            title="Marcar recibido" aria-label={`Marcar recibido ${l.modelo}`}
                            className="text-emerald-700 border border-emerald-300 bg-emerald-50 rounded-md p-1.5 hover:bg-emerald-100"
                          >
                            <Check size={15} />
                          </button>
                        )}
                        {editable && libre > 0 && todas.sucursales.length > 1 && (
                          <button onClick={() => setMover(l.codigo)} title="Mover a otra sucursal" aria-label={`Mover ${l.modelo}`}
                            className="text-muted hover:text-ink border border-black/10 rounded-md p-1.5">
                            <ArrowRight size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      {mover && (
        <MoverStock productos={productos} sucursales={todas.sucursales} inicial={{ codigo: mover, desde: suc.id }} miSuc={suc.id}
          onCerrar={() => setMover(null)}
          onMover={async (args, texto) => { if (await operar('consigna_transferir', args, texto)) setMover(null) }} />
      )}
    </div>
  )
}

function Celda({ n, signo = '', tono = '' }: { n: number; signo?: string; tono?: string }) {
  return (
    <span className={`hidden md:block text-center tabular-nums ${n ? `text-base font-semibold ${tono}` : 'text-black/20'}`}>
      {n ? `${signo}${n}` : '—'}
    </span>
  )
}

// ── Devolución a Orbital: centralizada en la central, consolidada por producto ─
// En esta etapa la registra SOLO la central (el link de sucursal la ve, no opera). La RPC reparte
// la cantidad entre las sucursales que tienen pendiente ese código.
type GrupoDev = {
  codigo: string; modelo: string; descripcion: string; imagen: string | null; motivos: string[]
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
        g = { codigo: d.codigo, modelo: d.modelo, descripcion: d.descripcion ?? '', imagen: d.imagen ?? null, motivos: [], cantidad: 0, pendiente: 0, enviada: 0, conservada: 0, vendida: 0, porSuc: {} }
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
        <div className="flex items-center gap-2.5">
          <Miniatura src={g.imagen} alt={`${g.modelo} ${g.descripcion}`} color={g.descripcion} />
          <div>
            <div className="text-[11px] font-semibold tracking-wide uppercase">{g.modelo}</div>
            <div className="text-xs text-muted">{g.descripcion}</div>
          </div>
        </div>
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
function StockGeneral({ data, miSuc, operar, onVerSuc }: { data: Central; miSuc: number | null; operar: Operar; onVerSuc: (id: number) => void }) {
  const [busca, setBusca] = useState('')
  const [mover, setMover] = useState<{ codigo: string; desde: number | null } | null>(null)
  const sucs = data.sucursales

  const productos = useMemo<Producto[]>(() => {
    const m = new Map<string, Producto>()
    for (const l of data.stock) {
      let p = m.get(l.codigo)
      if (!p) {
        p = { codigo: l.codigo, modelo: l.modelo ?? '—', descripcion: l.descripcion ?? '', precio: Number(l.precio ?? 0), imagen: l.imagen ?? null, local: {}, devolver: {}, camino: {}, total: 0 }
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
              <th className="sticky left-0 z-[1] bg-white text-left font-medium px-3 py-2 border-b border-black/10 min-w-[240px]">Modelo · color</th>
              {sucs.map((s) => (
                <th key={s.id} className="font-medium px-2 py-2 border-b border-black/10 text-center whitespace-nowrap">
                  <button onClick={() => onVerSuc(s.id)} title={`Abrir el panel de ${s.nombre}`} className="uppercase tracking-wide hover:text-ink underline decoration-dotted underline-offset-2">{s.nombre}</button>
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
                  <td className="sticky left-0 z-[1] bg-white px-3 py-1.5 border-b border-black/5">
                    <div className="flex items-center gap-2.5">
                      <Miniatura src={p.imagen} alt={`${p.modelo} ${p.descripcion}`} color={p.descripcion} size="sm" />
                      <div className="min-w-0">
                        {nuevoModelo && <div className="text-[11px] font-semibold tracking-wide uppercase">{p.modelo}</div>}
                        <div className="text-xs text-muted truncate max-w-[200px]" title={p.codigo}>{p.descripcion || p.codigo}</div>
                      </div>
                    </div>
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
  const elige = esCentral && !suc
  const destino = sucursales.find((s) => s.id === (elige ? destinoSel : suc?.id)) ?? null

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
        {elige ? (
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
          <span className="text-xs text-muted ml-auto">Pedido para <b className="text-ink">{destino?.nombre}</b>{esCentral ? ' · sale directo a Orbital' : ' · lo autoriza la central'}</span>
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
  const img = new Map(data.stock.map((l) => [l.codigo, l.imagen ?? null]))
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
              <li key={it.codigo} className="py-1.5 flex items-center gap-3">
                <Miniatura src={img.get(it.codigo)} alt={it.modelo} color={it.descripcion} size="sm" />
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
