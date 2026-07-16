import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { EstadoPedido, Pedido, PedidoItem, StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { addDias, formatFecha } from '../../lib/dates'
import { calcImporte, calcImporteConIVA, estadoLabel, ESTADO_COLORS, parseFP, qtyClass } from './calc'
import { aNacional, abrirWhatsApp, abrirMail } from '../../lib/telefono'
import { fetchPaged } from '../../lib/fetchAll'

const VENDEDOR_OPTS = ['Adrian', 'Martin', 'Marketing', 'Corporativo', 'Gaston']
const ESTADOS: EstadoPedido[] = [
  'pendiente',
  'en_preparacion',
  'observado',
  'listo',
  'facturado',
  'listo_despachar',
  'despachado',
]
const TRANSPORTES = ['Moto', 'Expreso / Transporte', 'Comisionista', 'Retira el cliente', 'Correo', 'Otro']

export default function Pedidos() {
  const { vendedor, rolEfectivo, codigoEfectivo } = useAuth()
  const toast = useToast()
  const rol = rolEfectivo
  const esAdmin = rol === 'admin'
  const esDeposito = rol === 'deposito'
  const esLogistica = rol === 'logistica'
  const esAdministracion = rol === 'administracion'
  const esVendedor = rol === 'vendedor'

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroVendedor, setFiltroVendedor] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())

  // Modales
  const [modalRemito, setModalRemito] = useState<Pedido | null>(null)
  const [nroRemito, setNroRemito] = useState('')
  const [modalFactura, setModalFactura] = useState<{ pedido: Pedido; importe: number } | null>(null)
  const [nroFactura, setNroFactura] = useState('')
  const [fechaFactura, setFechaFactura] = useState('')
  const [modalDespacho, setModalDespacho] = useState<Pedido | null>(null)
  const [tipoTransporte, setTipoTransporte] = useState('')
  const [nroGuia, setNroGuia] = useState('')
  const [modalEditar, setModalEditar] = useState<Pedido | null>(null)
  const [editItems, setEditItems] = useState<PedidoItem[]>([])
  const [editBusqueda, setEditBusqueda] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: peds }, st] = await Promise.all([
      supabase.from('pedidos').select('*').order('created_at', { ascending: false }),
      fetchPaged<StockItem>(() => supabase.from('stock').select('*')),
    ])
    setPedidos((peds as Pedido[]) ?? [])
    setStock(st)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
    const iv = setInterval(cargar, 15000)
    return () => clearInterval(iv)
  }, [cargar])

  const filtrados = useMemo(() => {
    let logs = [...pedidos]
    if (esVendedor) logs = logs.filter((l) => l.vendedor === codigoEfectivo)
    if (esLogistica) logs = logs.filter((l) => ['listo_despachar', 'despachado'].includes(l.estado ?? ''))
    if (esAdministracion) logs = logs.filter((l) => ['listo', 'facturado', 'listo_despachar', 'despachado'].includes(l.estado ?? ''))
    if (filtroVendedor) logs = logs.filter((l) => l.vendedor === filtroVendedor)
    if (filtroEstado) logs = logs.filter((l) => (l.estado ?? 'pendiente') === filtroEstado)
    const q = busqueda.toLowerCase().trim()
    if (q)
      logs = logs.filter(
        (l) =>
          (l.cliente || '').toLowerCase().includes(q) ||
          (l.items || []).some((i) => (i.modelo || '').toLowerCase().includes(q))
      )
    return logs
  }, [pedidos, esVendedor, esLogistica, esAdministracion, filtroVendedor, filtroEstado, busqueda, vendedor, codigoEfectivo])

  async function cambiarEstado(id: number, estado: EstadoPedido, extra: Record<string, unknown> = {}) {
    const { error } = await supabase.from('pedidos').update({ estado, ...extra }).eq('id', id)
    if (error) {
      toast('Error al actualizar el estado', 'error')
      return false
    }
    await cargar()
    return true
  }

  async function observar(p: Pedido) {
    const nota = window.prompt('Describí el problema o ajuste necesario:')
    if (nota === null || nota.trim() === '') return
    if (await cambiarEstado(p.id, 'observado', { obs_deposito: nota.trim() }))
      toast('⚠ Pedido observado — vendedor notificado', 'error')
  }

  async function confirmarRemito() {
    if (!modalRemito) return
    if (!nroRemito.trim()) {
      toast('Ingresá el número de remito', 'error')
      return
    }
    const nro = nroRemito.trim().toUpperCase()
    if (await cambiarEstado(modalRemito.id, 'listo', { nro_remito: nro })) {
      setModalRemito(null)
      toast(`✓ Listo para facturar — Remito ${nro}`, 'success')
    }
  }

  async function confirmarFactura() {
    if (!modalFactura) return
    if (!nroFactura.trim()) {
      toast('Ingresá el número de factura', 'error')
      return
    }
    if (
      await cambiarEstado(modalFactura.pedido.id, 'facturado', {
        nro_factura: nroFactura.trim(),
        fecha_factura: fechaFactura,
        importe_neto: modalFactura.importe,
      })
    ) {
      setModalFactura(null)
      toast(`📄 Factura ${nroFactura.trim()} registrada`, 'success')
    }
  }

  // Envía la factura al cliente por WhatsApp o Mail (el operador confirma el envío) y lo deja registrado
  async function enviarFactura(p: Pedido, canal: 'wa' | 'mail') {
    const nombreCliente = (p.cliente || '').replace(/^\d+ - /, '').trim()
    const msg = `Hola${nombreCliente ? ' ' + nombreCliente : ''}! Te enviamos la factura ${p.nro_factura ?? ''} de tu pedido en Orbital Eyewear${p.importe_neto ? ` por ${formatPrecio(p.importe_neto)}` : ''}. Cualquier duda quedamos a disposición. ¡Gracias!`
    if (canal === 'wa') {
      const tel = aNacional(p.wsp || '')
      if (tel.length < 10) {
        toast('El cliente no tiene un WhatsApp válido cargado en el pedido', 'error')
        return
      }
      abrirWhatsApp('549' + tel, msg)
    } else {
      if (!p.mail) {
        toast('El cliente no tiene mail cargado en el pedido', 'error')
        return
      }
      abrirMail(p.mail, `Factura ${p.nro_factura ?? ''} — Orbital Eyewear`, msg)
    }
    const { error } = await supabase
      .from('pedidos')
      .update({
        factura_enviada_at: new Date().toISOString(),
        factura_enviada_canal: canal === 'wa' ? 'WhatsApp' : 'Mail',
        factura_enviada_por: codigoEfectivo || vendedor?.codigo || '',
      })
      .eq('id', p.id)
    if (error) {
      toast('Se abrió el mensaje pero no se pudo registrar el envío', 'error')
      return
    }
    toast(`✓ Factura enviada por ${canal === 'wa' ? 'WhatsApp' : 'Mail'} y registrada`, 'success')
    cargar()
  }

  async function confirmarDespacho() {
    if (!modalDespacho) return
    if (!tipoTransporte) {
      toast('Seleccioná el tipo de transporte', 'error')
      return
    }
    if (
      await cambiarEstado(modalDespacho.id, 'despachado', {
        tipo_transporte: tipoTransporte,
        nro_guia: nroGuia.trim(),
      })
    ) {
      setModalDespacho(null)
      toast(`🚚 Despachado — ${tipoTransporte}${nroGuia ? ' · Guía: ' + nroGuia : ''}`, 'success')
    }
  }

  function abrirEditar(p: Pedido) {
    setModalEditar(p)
    setEditItems(JSON.parse(JSON.stringify(p.items ?? [])))
    setEditBusqueda('')
  }

  async function confirmarEdicion() {
    if (!modalEditar) return
    if (!editItems.length) {
      toast('El pedido no puede quedar vacío', 'error')
      return
    }
    const totalUnits = editItems.reduce((a, b) => a + b.cantidad, 0)
    try {
      // Devolver stock de los items originales y descontar los nuevos
      for (const oldItem of modalEditar.items ?? []) {
        const s = stock.find((x) => x.codigo === oldItem.codigo)
        if (s) {
          await supabase.from('stock').update({ cantidad: s.cantidad + oldItem.cantidad }).eq('codigo', oldItem.codigo)
          s.cantidad += oldItem.cantidad
        }
      }
      for (const newItem of editItems) {
        const s = stock.find((x) => x.codigo === newItem.codigo)
        if (s) {
          await supabase.from('stock').update({ cantidad: s.cantidad - newItem.cantidad }).eq('codigo', newItem.codigo)
          s.cantidad -= newItem.cantidad
        }
      }
      await supabase
        .from('pedidos')
        .update({ estado: 'pendiente', items: editItems, total_units: totalUnits, obs_deposito: null })
        .eq('id', modalEditar.id)
      setModalEditar(null)
      await cargar()
      toast('📤 Pedido reenviado a Depósito', 'success')
    } catch (e) {
      console.error(e)
      toast('Error al editar', 'error')
    }
  }

  async function togglePick(l: Pedido, codigo: string) {
    const actual = l.picking ?? []
    const nuevo = actual.includes(codigo) ? actual.filter((c) => c !== codigo) : [...actual, codigo]
    setPedidos((prev) => prev.map((x) => (x.id === l.id ? { ...x, picking: nuevo } : x)))
    const { error } = await supabase.from('pedidos').update({ picking: nuevo }).eq('id', l.id)
    if (error) {
      toast('No se pudo guardar el armado: ' + error.message, 'error')
      setPedidos((prev) => prev.map((x) => (x.id === l.id ? { ...x, picking: actual } : x)))
    }
  }

  function exportarDetalle() {
    let csv = 'Pedido;Fecha;Cliente;Estado;SKU;Modelo;Color;Cantidad\n'
    for (const l of filtrados) {
      for (const i of l.items ?? []) {
        csv += `${l.id};"${l.fecha ?? ''}";"${(l.cliente ?? '').replace(/"/g, "'")}";"${estadoLabel(l.estado)}";"${i.codigo}";"${i.modelo}";"${(i.descripcion ?? '').replace(/"/g, "'")}";${i.cantidad}\n`
      }
    }
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `pedidos_detalle_${filtroEstado || 'todos'}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    toast(`✓ Exportados ${filtrados.length} pedidos con su detalle`, 'success')
  }

  function toggleAbierto(id: number) {
    setAbiertos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const titulo = esDeposito
    ? '📦 Pedidos a preparar'
    : esLogistica
      ? '🚚 Entregas pendientes'
      : esAdministracion
        ? '📋 Por Facturar / Facturados'
        : esAdmin
          ? 'Todos los Pedidos'
          : 'Mis Pedidos'

  if (loading) return <p className="text-sm text-muted p-4">Cargando pedidos...</p>

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{titulo}</h2>
        <div className="flex items-center gap-3">
          {(esVendedor || esAdmin) && (
            <Link to="/pedidos/nuevo" className="text-xs font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5">
              + Nuevo Pedido
            </Link>
          )}
          {(esDeposito || esAdmin || esAdministracion) && (
            <button onClick={exportarDetalle} className="text-xs font-medium border border-black/10 rounded-lg px-3 py-1.5 text-muted">
              ⬇ Exportar detalle
            </button>
          )}
          <button onClick={cargar} className="text-xs text-brandDark font-medium">
            ⟳ Actualizar
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          placeholder="Buscar por cliente o modelo..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 min-w-[160px] bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
        />
        {!esVendedor && (
          <select
            value={filtroVendedor}
            onChange={(e) => setFiltroVendedor(e.target.value)}
            className="bg-white border border-black/10 rounded-lg px-2 py-2 text-sm"
          >
            <option value="">Todos los vendedores</option>
            {VENDEDOR_OPTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="bg-white border border-black/10 rounded-lg px-2 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {estadoLabel(e)}
            </option>
          ))}
        </select>
      </div>

      {filtrados.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">
          Sin pedidos para mostrar.
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((l) => {
            const estado = (l.estado ?? 'pendiente') as EstadoPedido
            const imp = calcImporte(l.items, stock, l.dto_comercial, l.dto_financiero, l.nro_lista)
            const impNeto = imp.neto || l.importe_neto || 0
            const abierto = abiertos.has(l.id)
            const color = ESTADO_COLORS[estado] ?? '#999'
            return (
              <div key={l.id} className="bg-white rounded-xl border border-black/10 overflow-hidden">
                <button onClick={() => toggleAbierto(l.id)} className="w-full text-left px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{l.cliente}</p>
                      <p className="text-xs text-muted">
                        {l.vendedor} · {l.fecha}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5 text-white"
                        style={{ background: color }}
                      >
                        {estadoLabel(estado)}
                      </span>
                      <span className="text-xs font-semibold">
                        {l.total_units ?? 0} uds{' '}
                        {impNeto > 0 && <span className="text-emerald-600">· {formatPrecio(impNeto)}</span>}
                      </span>
                    </div>
                  </div>
                </button>

                {abierto && (
                  <div className="px-3 pb-3 border-t border-black/5">
                    <div className="grid grid-cols-2 gap-2 text-xs py-2 border-b border-black/5 mb-2">
                      {l.nro_remito && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Remito</span>
                          <br />
                          <b>{l.nro_remito}</b>
                        </div>
                      )}
                      {l.nro_factura && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Factura</span>
                          <br />
                          <b>{l.nro_factura}</b>
                        </div>
                      )}
                      {l.tipo_transporte && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Transporte</span>
                          <br />
                          {l.tipo_transporte} {l.nro_guia ? `· Guía ${l.nro_guia}` : ''}
                        </div>
                      )}
                      {l.cond_entrega && (
                        <div className="col-span-2">
                          <span className="text-faint uppercase text-[10px] font-semibold">Entrega</span>
                          <br />
                          {l.cond_entrega}
                        </div>
                      )}
                      {(l.contacto_entrega || l.direccion_entrega || l.horario_entrega) && (
                        <div className="col-span-2">
                          <span className="text-faint uppercase text-[10px] font-semibold">Datos de entrega</span>
                          <br />
                          👤 {l.contacto_entrega || '—'} · 📍 {l.direccion_entrega || '—'} · 🕒 {l.horario_entrega || '—'}
                        </div>
                      )}
                      {l.cond_pago && (
                        <div className="col-span-2">
                          <span className="text-faint uppercase text-[10px] font-semibold">Pago</span>
                          <br />
                          {l.cond_pago}
                        </div>
                      )}
                      {(esDeposito || esAdmin || esAdministracion) && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Blanco / Negro</span>
                          <br />
                          <b>{l.blanco_pct ?? 100}%</b> blanco{(l.negro_pct ?? 0) > 0 ? <> · <b>{l.negro_pct}%</b> negro</> : ''}
                        </div>
                      )}
                      {imp.bruto > 0 && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Importe bruto</span>
                          <br />
                          {formatPrecio(imp.bruto)}
                        </div>
                      )}
                      {impNeto > 0 && (
                        <div>
                          <span className="text-faint uppercase text-[10px] font-semibold">Importe neto</span>
                          <br />
                          <b className="text-emerald-600">{formatPrecio(impNeto)}</b>
                        </div>
                      )}
                      {l.obs && (
                        <div className="col-span-2">
                          <span className="text-faint uppercase text-[10px] font-semibold">Obs vendedor</span>
                          <br />
                          {l.obs}
                        </div>
                      )}
                    </div>

                    {(esDeposito || esAdmin) && estado === 'en_preparacion' && (
                      <p className="text-[11px] font-semibold text-muted mb-1">
                        🛒 Armado en góndola: {(l.picking ?? []).length} / {(l.items ?? []).length} artículos tomados
                      </p>
                    )}
                    {(l.items ?? []).map((i) => {
                      const s = stock.find((x) => x.codigo === i.codigo)
                      const precio = s?.precio ?? 0
                      const picked = (l.picking ?? []).includes(i.codigo)
                      const conPicking = (esDeposito || esAdmin) && estado === 'en_preparacion'
                      return (
                        <div key={i.codigo} className={`flex justify-between items-center gap-2 text-xs py-1 ${picked && conPicking ? 'opacity-60' : ''}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            {conPicking && (
                              <input
                                type="checkbox"
                                checked={picked}
                                onChange={() => togglePick(l, i.codigo)}
                                className="w-4 h-4 shrink-0"
                                title="Tomado de góndola"
                              />
                            )}
                            <span className={`min-w-0 ${picked && conPicking ? 'line-through' : ''}`}>
                              <b>{i.modelo}</b> {i.descripcion || ''}
                              <span className="block text-[10px] font-mono text-faint">{i.codigo}</span>
                            </span>
                          </span>
                          <span className="shrink-0">
                            <b>{i.cantidad} uds</b>
                            {precio > 0 ? ' · ' + formatPrecio(precio * i.cantidad) : ''}
                          </span>
                        </div>
                      )
                    })}

                    <div className="mt-3 pt-2 border-t border-black/5 space-y-1.5">
                      {(esDeposito || esAdmin) && estado === 'pendiente' && (
                        <button
                          onClick={() => cambiarEstado(l.id, 'en_preparacion').then((ok) => ok && toast('🔧 En preparación', 'success'))}
                          className="w-full rounded-lg bg-[#1a7abf] text-white py-2 text-xs font-bold"
                        >
                          🔧 Iniciar preparación
                        </button>
                      )}
                      {(esDeposito || esAdmin) && estado === 'en_preparacion' && (
                        <>
                          <button
                            onClick={() => {
                              setModalRemito(l)
                              setNroRemito('')
                            }}
                            className="w-full rounded-lg bg-emerald-600 text-white py-2 text-xs font-bold"
                          >
                            ✓ Marcar Listo p/facturar
                          </button>
                          <button
                            onClick={() => observar(l)}
                            className="w-full rounded-lg bg-[#c0392b] text-white py-2 text-xs font-bold"
                          >
                            ⚠ Observar pedido
                          </button>
                        </>
                      )}
                      {(esDeposito || esAdmin) && estado === 'observado' && (
                        <>
                          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-xs">
                            ⚠ <b>Obs:</b> {l.obs_deposito || 'Sin detalle'}
                          </div>
                          <button
                            onClick={() => cambiarEstado(l.id, 'en_preparacion').then((ok) => ok && toast('↩ Retomada la preparación', 'success'))}
                            className="w-full rounded-lg bg-[#1a7abf] text-white py-2 text-xs font-bold"
                          >
                            ↩ Retomar preparación
                          </button>
                        </>
                      )}

                      {esVendedor && estado === 'observado' && (
                        <>
                          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-xs">
                            ⚠ <b>Requiere ajuste:</b> {l.obs_deposito || 'Consultá con depósito'}
                          </div>
                          <button
                            onClick={() => abrirEditar(l)}
                            className="w-full rounded-lg bg-[#e07020] text-white py-2 text-xs font-bold"
                          >
                            ✏️ Editar y reenviar a Depósito
                          </button>
                        </>
                      )}

                      {(esAdmin || esAdministracion) && estado === 'listo' && (
                        <>
                          <div className="bg-[#f0f4ff] rounded-lg p-2.5 text-[11px] space-y-0.5">
                            <p className="font-bold text-[#4a4adf]">💰 Para facturar</p>
                            {l.nro_remito && <p className="font-bold text-emerald-600">📋 Remito a buscar: {l.nro_remito}</p>}
                            <p>Precio s/IVA: {formatPrecio(imp.bruto)}</p>
                            <p className="font-bold text-emerald-600">Neto s/IVA: {formatPrecio(impNeto)}</p>
                            {(() => {
                              const iv = calcImporteConIVA(impNeto, l.blanco_pct ?? 100)
                              return iv.ivaImporte > 0 ? (
                                <>
                                  <p className="text-[#4a4adf]">+ IVA (blanco): {formatPrecio(iv.ivaImporte)}</p>
                                  <p className="font-bold text-[#4a4adf]">Total c/IVA: {formatPrecio(iv.conIVA)}</p>
                                </>
                              ) : null
                            })()}
                            <p className="text-muted pt-1">
                              Vencimientos estimados:
                              <br />
                              {parseFP(l.cond_pago, l.cuotas_detalle).map((v, i) => (
                                <span key={i}>
                                  {formatFecha(addDias(new Date().toLocaleDateString('es-AR'), v.dias))} —{' '}
                                  {formatPrecio(Math.round(impNeto * v.pct))}
                                  <br />
                                </span>
                              ))}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              setModalFactura({ pedido: l, importe: impNeto })
                              setNroFactura('')
                              setFechaFactura(new Date().toISOString().split('T')[0])
                            }}
                            className="w-full rounded-lg bg-[#4a4adf] text-white py-2 text-xs font-bold"
                          >
                            📄 Confirmar y Facturar
                          </button>
                        </>
                      )}

                      {(esAdmin || esAdministracion) && estado === 'facturado' && (
                        <>
                          {l.nro_factura && (
                            <p className="text-xs text-[#4a4adf]">
                              📄 Factura: <b>{l.nro_factura}</b>
                            </p>
                          )}
                          {l.factura_enviada_at ? (
                            <p className="text-[11px] text-emerald-700">
                              ✓ Factura enviada por {l.factura_enviada_canal} ·{' '}
                              {new Date(l.factura_enviada_at).toLocaleDateString('es-AR')}
                              {l.factura_enviada_por ? ` · ${l.factura_enviada_por}` : ''}
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted">Enviar factura al cliente (adjuntá el PDF antes de mandar):</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => enviarFactura(l, 'wa')}
                              className="flex-1 rounded-lg border border-emerald-500/40 text-emerald-700 py-2 text-xs font-medium"
                            >
                              💬 WhatsApp
                            </button>
                            <button
                              onClick={() => enviarFactura(l, 'mail')}
                              className="flex-1 rounded-lg border border-black/10 text-brandDark py-2 text-xs font-medium"
                            >
                              📧 Mail
                            </button>
                          </div>
                          <button
                            onClick={() => cambiarEstado(l.id, 'listo_despachar').then((ok) => ok && toast('📦 Habilitado para despacho', 'success'))}
                            className="w-full rounded-lg bg-[#7b2ff7] text-white py-2 text-xs font-bold"
                          >
                            📦 Habilitar para Despacho
                          </button>
                        </>
                      )}

                      {esLogistica && estado === 'listo_despachar' && (
                        <>
                          <div className="bg-[#F1EDE4] rounded-lg p-2.5 text-xs space-y-1">
                            <p className="font-bold">📦 Datos de entrega</p>
                            <p>
                              🏪 <b>{(l.cliente || '').replace(/^\d+ - /, '')}</b>
                            </p>
                            {l.cond_entrega && <p>🚚 {l.cond_entrega}</p>}
                            {l.direccion_entrega && <p>📍 {l.direccion_entrega}</p>}
                            {l.horario_entrega && <p>🕒 {l.horario_entrega}</p>}
                            {l.contacto_entrega && <p>👤 {l.contacto_entrega}</p>}
                            {l.nro_remito && (
                              <p>
                                📋 Remito: <b>{l.nro_remito}</b>
                              </p>
                            )}
                            {l.nro_factura && (
                              <p>
                                📄 Factura: <b>{l.nro_factura}</b>
                              </p>
                            )}
                            <p className="text-[11px] text-muted">Pago: {l.cond_pago || '—'}</p>
                          </div>
                          <button
                            onClick={() => {
                              setModalDespacho(l)
                              setTipoTransporte('')
                              setNroGuia('')
                            }}
                            className="w-full rounded-lg bg-[#7b2ff7] text-white py-2 text-xs font-bold"
                          >
                            🚚 Registrar Despacho
                          </button>
                        </>
                      )}

                      {(esAdmin || esAdministracion) && estado !== 'pendiente' && (
                        <button
                          onClick={() => cambiarEstado(l.id, 'pendiente').then((ok) => ok && toast('↩ Vuelto a pendiente', 'success'))}
                          className="w-full rounded-lg border border-black/10 text-muted py-1.5 text-xs font-medium"
                        >
                          ↩ Volver a Pendiente
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL REMITO */}
      {modalRemito && (
        <Modal onClose={() => setModalRemito(null)} titulo="✓ Cerrar preparación">
          <p className="text-xs text-muted mb-2">
            Ingresá el número de remito para que Administración pueda facturar el pedido.
          </p>
          <input
            value={nroRemito}
            onChange={(e) => setNroRemito(e.target.value)}
            placeholder="N° de remito"
            autoFocus
            className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button onClick={confirmarRemito} className="w-full rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold">
            Confirmar — Listo p/facturar
          </button>
        </Modal>
      )}

      {/* MODAL FACTURA */}
      {modalFactura && (
        <Modal onClose={() => setModalFactura(null)} titulo="📄 Registrar factura">
          <p className="text-xs text-muted mb-2">
            Importe neto: <b className="text-emerald-600">{formatPrecio(modalFactura.importe)}</b>
          </p>
          <input
            value={nroFactura}
            onChange={(e) => setNroFactura(e.target.value)}
            placeholder="N° de factura"
            autoFocus
            className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm mb-2"
          />
          <input
            type="date"
            value={fechaFactura}
            onChange={(e) => setFechaFactura(e.target.value)}
            className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button onClick={confirmarFactura} className="w-full rounded-lg bg-[#4a4adf] text-white py-2 text-sm font-semibold">
            Confirmar Factura
          </button>
        </Modal>
      )}

      {/* MODAL DESPACHO */}
      {modalDespacho && (
        <Modal onClose={() => setModalDespacho(null)} titulo="🚚 Registrar despacho">
          <label className="block text-xs text-muted mb-2">
            Tipo de transporte
            <select
              value={tipoTransporte}
              onChange={(e) => setTipoTransporte(e.target.value)}
              className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">— Seleccioná —</option>
              {TRANSPORTES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <input
            value={nroGuia}
            onChange={(e) => setNroGuia(e.target.value)}
            placeholder="N° de guía / seguimiento (opcional)"
            className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button onClick={confirmarDespacho} className="w-full rounded-lg bg-[#7b2ff7] text-white py-2 text-sm font-semibold">
            Confirmar Despacho
          </button>
        </Modal>
      )}

      {/* MODAL EDITAR (pedido observado) */}
      {modalEditar && (
        <Modal onClose={() => setModalEditar(null)} titulo="✏️ Editar pedido observado" ancho="max-w-2xl">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-xs mb-3">
            ⚠ <b>Nota de Depósito:</b> {modalEditar.obs_deposito || 'Sin detalle'}
          </div>

          <p className="text-xs font-semibold text-muted uppercase mb-1">Items del pedido</p>
          <div className="space-y-1.5 mb-3">
            {editItems.map((item, i) => {
              const s = stock.find((x) => x.codigo === item.codigo)
              const maxStock = s ? s.cantidad + item.cantidad : item.cantidad
              return (
                <div key={item.codigo} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <b>{item.modelo}</b> <span className="text-xs text-faint">{item.descripcion || ''}</span>
                  </div>
                  <button
                    onClick={() =>
                      setEditItems(editItems.map((x, j) => (j === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x)))
                    }
                    className="w-6 h-6 rounded border border-black/10 text-xs"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-semibold">{item.cantidad}</span>
                  <button
                    onClick={() =>
                      setEditItems(
                        editItems.map((x, j) => (j === i ? { ...x, cantidad: Math.min(maxStock, x.cantidad + 1) } : x))
                      )
                    }
                    disabled={item.cantidad >= maxStock}
                    className="w-6 h-6 rounded border border-black/10 text-xs disabled:opacity-30"
                  >
                    +
                  </button>
                  <button onClick={() => setEditItems(editItems.filter((_, j) => j !== i))} className="text-red-600 px-1">
                    ×
                  </button>
                </div>
              )
            })}
            {editItems.length === 0 && <p className="text-xs text-faint text-center py-3">Sin artículos</p>}
          </div>

          <p className="text-xs font-semibold text-muted uppercase mb-1">Agregar del stock</p>
          <input
            placeholder="Buscar artículo..."
            value={editBusqueda}
            onChange={(e) => setEditBusqueda(e.target.value)}
            className="w-full border border-black/10 rounded-lg px-3 py-2 text-sm mb-2"
          />
          <div className="max-h-48 overflow-y-auto space-y-1 mb-3">
            {stock
              .filter((p) => {
                const q = editBusqueda.toLowerCase().trim()
                return (
                  p.cantidad > 0 &&
                  (!q ||
                    p.codigo.toLowerCase().includes(q) ||
                    p.modelo.toLowerCase().includes(q) ||
                    (p.descripcion || '').toLowerCase().includes(q))
                )
              })
              .slice(0, 30)
              .map((p) => {
                const ya = editItems.find((x) => x.codigo === p.codigo)
                return (
                  <div key={p.codigo} className="flex items-center justify-between text-xs px-2 py-1.5 border border-black/5 rounded-lg">
                    <span className="min-w-0 truncate">
                      <b>{p.modelo}</b> {p.descripcion || ''}{' '}
                      <span className={`ml-1 rounded-full px-1.5 py-0.5 font-semibold ${qtyClass(p.cantidad)}`}>{p.cantidad}</span>
                    </span>
                    {ya ? (
                      <span className="text-emerald-600 font-medium shrink-0">✓ En el pedido</span>
                    ) : (
                      <button
                        onClick={() =>
                          setEditItems([
                            ...editItems,
                            { codigo: p.codigo, modelo: p.modelo, descripcion: p.descripcion, cantidad: 1 },
                          ])
                        }
                        className="text-brandDark font-medium shrink-0"
                      >
                        + Agregar
                      </button>
                    )}
                  </div>
                )
              })}
          </div>

          <button onClick={confirmarEdicion} className="w-full rounded-lg bg-[#e07020] text-white py-2 text-sm font-semibold">
            📤 Reenviar a Depósito
          </button>
        </Modal>
      )}
    </div>
  )
}

function Modal({
  children,
  onClose,
  titulo,
  ancho = 'max-w-sm',
}: {
  children: React.ReactNode
  onClose: () => void
  titulo: string
  ancho?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl border border-black/10 w-full ${ancho} max-h-[85vh] overflow-y-auto p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">{titulo}</p>
          <button onClick={onClose} className="text-sm text-muted">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
