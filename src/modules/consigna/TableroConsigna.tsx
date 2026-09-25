// ── Tablero de una consigna ─────────────────────────────────────────────────
// Qué se está mandando (pedidos de carga y lo que falta recibir), stock actual por sucursal,
// cómo rota, qué quedó trabado y acciones/promociones para moverlo.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

type Suc = { id: number; nombre: string }
type StockRow = { sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; devolver: number; en_camino: number; precio?: number | null }
type Mov = { sucursal_id: number; codigo: string; modelo: string | null; tipo: string; cantidad: number; fecha: string }
type Ped = { id: number; estado: string; total_units: number; created_at: string; direccion_entrega: string | null; nro_guia: string | null; fecha_entrega: string | null }

const fmt = (n: number) => Number(n || 0).toLocaleString('es-AR')
const pesos = (n: number) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR')
const DIA = 86400000
const dias = (s: string) => Math.floor((Date.now() - new Date(s).getTime()) / DIA)

const ESTADO: Record<string, [string, string]> = {
  pendiente: ['Pendiente de preparar', 'bg-amber-100 text-amber-800'],
  en_preparacion: ['En preparación', 'bg-sky-100 text-sky-800'],
  listo: ['Listo para salir', 'bg-indigo-100 text-indigo-800'],
  despachado: ['Despachado', 'bg-violet-100 text-violet-800'],
  entregado: ['Entregado', 'bg-emerald-100 text-emerald-800'],
  anulado: ['Anulado', 'bg-black/5 text-muted'],
}

export default function TableroConsigna({ cod, nombre, sucs, stock }: { cod: string; nombre: string; sucs: Suc[]; stock: StockRow[] }) {
  const [movs, setMovs] = useState<Mov[] | null>(null)
  const [peds, setPeds] = useState<Ped[]>([])

  useEffect(() => {
    supabase.from('consigna_suc_mov').select('sucursal_id, codigo, modelo, tipo, cantidad, fecha').eq('cod_madre', cod)
      .then(({ data }) => setMovs((data ?? []) as Mov[]))
    supabase.from('pedidos').select('id, estado, total_units, created_at, direccion_entrega, nro_guia, fecha_entrega')
      .eq('cod_cliente', cod).eq('origen', 'reposicion').neq('estado', 'anulado').order('id', { ascending: false }).limit(12)
      .then(({ data }) => setPeds((data ?? []) as Ped[]))
  }, [cod])

  const a = useMemo(() => {
    if (!movs) return null
    const ventas = movs.filter((m) => m.tipo === 'venta')
    const v90 = ventas.filter((m) => dias(m.fecha) <= 90)
    const v30 = ventas.filter((m) => dias(m.fecha) <= 30)
    const u = (ms: Mov[]) => ms.reduce((s, m) => s + Math.abs(m.cantidad), 0)
    const ultVenta = ventas.reduce<string | null>((mx, m) => (!mx || m.fecha > mx ? m.fecha : mx), null)

    // por sucursal
    const porSuc = sucs.map((s) => {
      const st = stock.filter((r) => r.sucursal_id === s.id)
      const local = st.reduce((x, r) => x + r.cantidad, 0)
      const devolver = st.reduce((x, r) => x + r.devolver, 0)
      const camino = st.reduce((x, r) => x + r.en_camino, 0)
      const valor = st.reduce((x, r) => x + (r.cantidad - r.devolver) * Number(r.precio || 0), 0)
      const vs = v90.filter((m) => m.sucursal_id === s.id)
      const vend90 = u(vs)
      const util = local - devolver
      const cobertura = vend90 > 0 ? util / (vend90 / 3) : null // meses
      const ult = vs.reduce<string | null>((mx, m) => (!mx || m.fecha > mx ? m.fecha : mx), null)
      return { ...s, local, devolver, camino, valor, vend90, cobertura, ult }
    })
    const totV90 = porSuc.reduce((x, s) => x + s.vend90, 0)

    // trabados: en el local (sin contar lo a devolver), llegó hace 45+ días, sin venta en 60 días en esa sucursal
    const llegada = new Map<string, string>()
    const ultPorSku = new Map<string, string>()
    for (const m of movs) {
      const k = `${m.sucursal_id}|${m.codigo}`
      if (m.tipo === 'inicial' || m.tipo === 'envio') { const p = llegada.get(k); if (!p || m.fecha < p) llegada.set(k, m.fecha) }
      if (m.tipo === 'venta') { const p = ultPorSku.get(k); if (!p || m.fecha > p) ultPorSku.set(k, m.fecha) }
    }
    const vendeModelo = new Map<string, Map<number, number>>() // modelo → sucursal → u 90d
    for (const m of v90) {
      const mod = m.modelo ?? ''
      if (!vendeModelo.has(mod)) vendeModelo.set(mod, new Map())
      const mm = vendeModelo.get(mod)!
      mm.set(m.sucursal_id, (mm.get(m.sucursal_id) ?? 0) + Math.abs(m.cantidad))
    }
    const trabados = stock
      .filter((r) => r.cantidad - r.devolver > 0)
      .map((r) => {
        const k = `${r.sucursal_id}|${r.codigo}`
        const desde = llegada.get(k)
        const ult = ultPorSku.get(k)
        const quieto = ult ? dias(ult) : desde ? dias(desde) : null
        const otras = [...(vendeModelo.get(r.modelo ?? '') ?? new Map()).entries()].filter(([sid]) => sid !== r.sucursal_id).sort((x, y) => y[1] - x[1])
        return { ...r, util: r.cantidad - r.devolver, quieto, destino: otras[0] ? sucs.find((s) => s.id === otras[0][0])?.nombre ?? null : null }
      })
      .filter((r) => r.quieto != null && r.quieto >= 45 && !(r.quieto < 60 && ultPorSku.has(`${r.sucursal_id}|${r.codigo}`)))
      .sort((x, y) => y.util - x.util || (y.quieto ?? 0) - (x.quieto ?? 0))

    // modelos que más venden (para empujar / reponer)
    const top = [...vendeModelo.entries()].map(([mod, m]) => [mod, [...m.values()].reduce((x, y) => x + y, 0)] as [string, number]).sort((x, y) => y[1] - x[1]).slice(0, 5)

    return { v30: u(v30), v90: totV90, ultVenta, porSuc, trabados, top, hayVentas: ventas.length > 0 }
  }, [movs, stock, sucs])

  if (!a) return <p className="text-sm text-muted">Cargando…</p>

  const local = a.porSuc.reduce((x, s) => x + s.local, 0)
  const devolver = a.porSuc.reduce((x, s) => x + s.devolver, 0)
  const camino = a.porSuc.reduce((x, s) => x + s.camino, 0)
  const valor = a.porSuc.reduce((x, s) => x + s.valor, 0)
  const cobertura = a.v90 > 0 ? (local - devolver) / (a.v90 / 3) : null
  const trabadoU = a.trabados.reduce((x, r) => x + r.util, 0)
  const abiertos = peds.filter((p) => p.estado !== 'entregado')

  // ── consejos a partir de los datos ──
  const consejos: { tono: 'rojo' | 'ambar' | 'verde'; titulo: string; detalle: string }[] = []
  if (!a.hayVentas) consejos.push({ tono: 'rojo', titulo: 'Sin ventas cargadas', detalle: `Pedile a ${nombre} el primer reporte de ventas y cargalo en Liquidación: sin eso no hay reposición ni se ve qué rota.` })
  else if (a.ultVenta && dias(a.ultVenta) > 35) consejos.push({ tono: 'ambar', titulo: `Última venta informada hace ${dias(a.ultVenta)} días`, detalle: 'Pedí la liquidación del período: lo vendido y no informado no se repone ni se factura.' })
  for (const p of abiertos) {
    const d = dias(p.created_at)
    if (p.estado === 'pendiente' && d >= 2) consejos.push({ tono: 'rojo', titulo: `Envío #${p.id} pendiente hace ${d} días`, detalle: `${fmt(p.total_units)} u sin preparar${p.direccion_entrega ? ` para ${p.direccion_entrega}` : ''}. Mientras no llega, la sucursal vende con el stock viejo.` })
    else if (p.estado === 'despachado' && d >= 7) consejos.push({ tono: 'ambar', titulo: `Envío #${p.id} despachado sin confirmar`, detalle: 'Pedí a la sucursal que marque la recepción en su panel.' })
  }
  const sobre = a.porSuc.filter((s) => s.cobertura != null && s.cobertura > 6)
  const corta = a.porSuc.filter((s) => s.cobertura != null && s.cobertura < 1.5)
  if (sobre.length) consejos.push({ tono: 'ambar', titulo: `Sobrestock en ${sobre.map((s) => s.nombre).join(', ')}`, detalle: `Más de 6 meses de venta en el local. Mover a ${[...a.porSuc].sort((x, y) => y.vend90 - x.vend90)[0]?.nombre ?? 'la sucursal que más vende'} o sumar a la devolución.` })
  if (corta.length) consejos.push({ tono: 'verde', titulo: `Se quedan cortas: ${corta.map((s) => s.nombre).join(', ')}`, detalle: 'Menos de 6 semanas de stock: armar reposición sugerida con lo que más venden.' })
  const lider = [...a.porSuc].sort((x, y) => y.vend90 - x.vend90)[0]
  if (lider && a.v90 > 0 && lider.vend90 / a.v90 > 0.6) consejos.push({ tono: 'ambar', titulo: `${lider.nombre} hace el ${Math.round((lider.vend90 / a.v90) * 100)}% de la venta`, detalle: 'Las otras sucursales venden poco: capacitar vendedores, exhibición y copiar el surtido de la que vende.' })
  if (trabadoU > 0) consejos.push({ tono: 'ambar', titulo: `${fmt(trabadoU)} u trabadas (45+ días sin venta)`, detalle: 'Ver la lista de abajo: primero mover a donde el modelo sí vende; si no vende en ningún lado, promo o devolución.' })

  const tonoCls = { rojo: 'border-red-200 bg-red-50', ambar: 'border-amber-200 bg-amber-50', verde: 'border-emerald-200 bg-emerald-50' }

  return (
    <div className="flex flex-col gap-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi t="En los locales" v={`${fmt(local - devolver)} u`} s={valor ? pesos(valor) : devolver ? `+ ${fmt(devolver)} a devolver` : ''} />
        <Kpi t="En camino" v={`${fmt(camino)} u`} s={abiertos.length ? `${abiertos.length} envío${abiertos.length > 1 ? 's' : ''} abierto${abiertos.length > 1 ? 's' : ''}` : 'nada pendiente'} />
        <Kpi t="Vendido 30 días" v={`${fmt(a.v30)} u`} s={a.ultVenta ? `últ. informe ${new Date(a.ultVenta).toLocaleDateString('es-AR')}` : 'sin reportes'} />
        <Kpi t="Vendido 90 días" v={`${fmt(a.v90)} u`} s={a.v90 ? `${fmt(Math.round(a.v90 / 3))} u/mes` : '—'} />
        <Kpi t="Cobertura" v={cobertura != null ? `${cobertura.toFixed(1)} meses` : '—'} s={cobertura == null ? 'falta venta' : cobertura > 6 ? 'sobrestock' : cobertura < 1.5 ? 'se queda corto' : 'sano'} alerta={cobertura != null && (cobertura > 6 || cobertura < 1.5)} />
        <Kpi t="Trabado" v={`${fmt(trabadoU)} u`} s={local - devolver > 0 ? `${Math.round((trabadoU / (local - devolver)) * 100)}% del stock` : '—'} alerta={trabadoU > 0} />
      </div>

      {/* Qué hacer */}
      {consejos.length > 0 && (
        <section className="grid md:grid-cols-2 gap-2">
          {consejos.map((c, i) => (
            <div key={i} className={`border rounded-xl px-4 py-2.5 ${tonoCls[c.tono]}`}>
              <div className="text-sm font-semibold">{c.titulo}</div>
              <div className="text-xs text-muted mt-0.5">{c.detalle}</div>
            </div>
          ))}
        </section>
      )}

      {/* Envíos */}
      <section className="bg-white border border-black/10 rounded-xl">
        <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Lo que se está mandando</h3>
        {peds.length === 0 ? <p className="text-sm text-muted px-4 py-4">No hay envíos de consigna.</p> : (
          <ul className="divide-y divide-black/5 text-sm">
            {peds.map((p) => {
              const [lbl, cls] = ESTADO[p.estado] ?? [p.estado, 'bg-black/5 text-muted']
              return (
                <li key={p.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">#{p.id}</span>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${cls}`}>{lbl}</span>
                  <span className="tabular-nums">{fmt(p.total_units)} u</span>
                  <span className="text-xs text-muted flex-1 min-w-0 truncate">{p.direccion_entrega ?? 'reparto por sucursal'}</span>
                  <span className="text-xs text-faint">{p.nro_guia ? `guía ${p.nro_guia} · ` : ''}hace {dias(p.created_at)} d</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Stock y rotación por sucursal */}
      <section className="bg-white border border-black/10 rounded-xl overflow-x-auto">
        <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Stock actual y rotación por sucursal</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted text-right">
              <th className="px-4 py-2 font-medium text-left">Sucursal</th><th className="px-2 py-2 font-medium">En local</th>
              <th className="px-2 py-2 font-medium">A devolver</th><th className="px-2 py-2 font-medium">En camino</th>
              <th className="px-2 py-2 font-medium">Vendido 90 d</th><th className="px-2 py-2 font-medium">Cobertura</th>
              <th className="px-4 py-2 font-medium text-left">Estado</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {a.porSuc.map((s) => {
              const est = s.local === 0 && s.camino === 0 ? ['Sin stock', 'text-muted']
                : s.vend90 === 0 ? (s.local > 0 ? ['Sin venta informada', 'text-amber-700'] : ['Esperando envío', 'text-sky-700'])
                : s.cobertura! > 6 ? ['Sobrestock', 'text-amber-700'] : s.cobertura! < 1.5 ? ['Reponer', 'text-red-600'] : ['Sano', 'text-emerald-700']
              return (
                <tr key={s.id} className="border-t border-black/5 text-right">
                  <td className="px-4 py-1.5 text-left">{s.nombre}</td>
                  <td className="px-2 py-1.5">{fmt(s.local - s.devolver)}</td>
                  <td className="px-2 py-1.5 text-muted">{s.devolver ? fmt(s.devolver) : '—'}</td>
                  <td className="px-2 py-1.5 text-sky-700">{s.camino ? `+${fmt(s.camino)}` : '—'}</td>
                  <td className="px-2 py-1.5">{s.vend90 ? fmt(s.vend90) : '—'}</td>
                  <td className="px-2 py-1.5">{s.cobertura != null ? `${s.cobertura.toFixed(1)} m` : '—'}</td>
                  <td className={`px-4 py-1.5 text-left text-xs ${est[1]}`}>{est[0]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        {/* Trabado */}
        <section className="bg-white border border-black/10 rounded-xl">
          <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Lo que se quedó trabado <span className="font-normal text-muted">· 45+ días sin venta</span></h3>
          {a.trabados.length === 0 ? <p className="text-sm text-muted px-4 py-4">{a.hayVentas ? 'Nada trabado: todo lo que está en los locales vendió en los últimos 60 días o llegó hace poco.' : 'Sin ventas informadas todavía: se mide cuando entre la primera liquidación.'}</p> : (
            <ul className="divide-y divide-black/5 text-sm max-h-[420px] overflow-y-auto">
              {a.trabados.slice(0, 40).map((r) => (
                <li key={`${r.sucursal_id}-${r.codigo}`} className="px-4 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div><b className="text-[11px] tracking-wide">{r.modelo}</b> <span className="text-xs text-muted">{r.descripcion}</span></div>
                    <div className="text-[11px] text-faint">
                      {sucs.find((s) => s.id === r.sucursal_id)?.nombre} · {r.quieto} d quieto · {r.destino ? <span className="text-emerald-700">mover a {r.destino} (ahí vende)</span> : 'no vende en la cadena → promo o devolver'}
                    </div>
                  </div>
                  <span className="tabular-nums font-medium">{r.util} u</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Impulsar */}
        <section className="bg-white border border-black/10 rounded-xl">
          <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Cómo impulsar la venta</h3>
          {a.top.length > 0 && (
            <p className="px-4 pt-3 text-xs text-muted">Lo que más sale en la cadena: {a.top.map(([m, n]) => `${m} (${n})`).join(' · ')}. Que esté SIEMPRE en todas las sucursales.</p>
          )}
          <ul className="px-4 py-3 flex flex-col gap-2.5 text-sm">
            {PROMOS.map((p) => (
              <li key={p.t}>
                <div className="font-medium">{p.t}</div>
                <div className="text-xs text-muted">{p.d}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

const PROMOS = [
  { t: '1 · Mover antes que rebajar', d: 'Lo trabado en un local pasa a la sucursal donde ese modelo vende. No cuesta margen y libera la vidriera.' },
  { t: '2 · Premio al vendedor del local', d: 'Un incentivo por unidad vendida de la lista de trabados, por 30 días. El que vende en el mostrador decide qué muestra.' },
  { t: '3 · Vidriera y exhibidor de la semana', d: 'Rotar 3–4 modelos trabados al frente con cartel propio. Lo que no se ve no se vende.' },
  { t: '4 · Segundo par / combo sol + receta', d: 'Precio especial en el segundo anteojo si uno es de la lista trabada. Sube ticket sin tocar los modelos que rotan.' },
  { t: '5 · Triple Protección como cierre', d: 'Ofrecerla en cada venta: agrega valor sin descuento y diferencia del resto del local.' },
  { t: '6 · IRIS y redes empujan a la sucursal', d: 'Consultas de la zona derivadas a esa sucursal + contenido de los modelos trabados desde Marketing y redes.' },
  { t: '7 · Si en 60 días no se mueve, se devuelve', d: 'Saldo o devolución y se reemplaza por lo más vendido: la consigna tiene que rotar, no acumular.' },
]

function Kpi({ t, v, s, alerta }: { t: string; v: string; s?: string; alerta?: boolean }) {
  return (
    <div className="bg-white border border-black/10 rounded-xl px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted">{t}</div>
      <div className={`text-lg font-semibold tabular-nums ${alerta ? 'text-amber-700' : ''}`}>{v}</div>
      {s && <div className="text-[11px] text-faint truncate">{s}</div>}
    </div>
  )
}
