import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, PedidoItem, StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { fetchPaged } from '../../lib/fetchAll'
import { ENTREGA_CANALES, ENTREGA_PAGOS, MEDIOS_PAGO, labelEntrega, labelMedios, qtyClass, calcImporte, calcFinanciero, netoUnitario, descuentoItemPct } from './calc'

interface Cuota {
  dias: number
  pct: number
}

// Plazos de pago habituales (días). Se tildan y el 100% se reparte en partes iguales.
const PLAZOS_FIJOS = [0, 30, 60, 90, 120, 150]

// Reparte 100% en partes iguales entre los plazos elegidos, ajustando el último
// para que la suma dé exactamente 100 (evita 33,33 × 3 = 99,99).
function repartirCuotas(dias: number[]): Cuota[] {
  const unicos = [...new Set(dias)].sort((a, b) => a - b)
  const n = unicos.length
  if (n === 0) return []
  const base = Math.floor((100 / n) * 10) / 10
  const cuotas = unicos.map((d) => ({ dias: d, pct: base }))
  cuotas[n - 1].pct = Math.round((100 - base * (n - 1)) * 100) / 100
  return cuotas
}

export default function NuevoPedido() {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()
  const location = useLocation()

  const [stock, setStock] = useState<StockItem[]>([])
  // Unidades en producción por SKU (stock_ingresos pendientes de que Depósito confirme)
  const [proyectado, setProyectado] = useState<Record<string, number>>({})
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [sugerencias, setSugerencias] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(location.state?.cliente ?? null)
  // Precios especiales del cliente (lista especial por cliente). Clave = modelo en MAYÚSCULAS.
  const [preciosEsp, setPreciosEsp] = useState<Record<string, number>>({})
  const [busquedaStock, setBusquedaStock] = useState('')
  const [filtroModelo, setFiltroModelo] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroClasif, setFiltroClasif] = useState('')
  const [filtroTratam, setFiltroTratam] = useState('')
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [cart, setCart] = useState<Record<string, number>>({})
  // Precargas de foto (IRIS leyó un pedido por WhatsApp → acá se activa).
  type Precarga = { conversacion_id: string; cod_cliente: string | null; cliente_razon: string | null; vendedor: string | null; items: { sku: string | null; modelo: string | null; color: string | null; cantidad: number; estado: string }[] }
  const [precargas, setPrecargas] = useState<Precarga[]>([])
  // SKUs para los que el vendedor eligió el precio de preventa
  const [preventaSel, setPreventaSel] = useState<Set<string>>(new Set())
  // SKUs marcados como regalo/bonificación (precio 0)
  const [regaloSel, setRegaloSel] = useState<Set<string>>(new Set())
  const [entregaCanal, setEntregaCanal] = useState('')
  const [entregaPago, setEntregaPago] = useState('')
  const [medios, setMedios] = useState<string[]>([])
  const [dtoFinanciero, setDtoFinanciero] = useState('')
  const [dtoComercial, setDtoComercial] = useState('')
  const [blancoPct, setBlancoPct] = useState(100)
  const [cuotas, setCuotas] = useState<Cuota[]>([{ dias: 0, pct: 100 }])
  const [otroPlazo, setOtroPlazo] = useState('')
  const [wsp, setWsp] = useState('')
  const [mail, setMail] = useState('')
  const [obs, setObs] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [cdEditando, setCdEditando] = useState(false)
  const [cd, setCd] = useState({ direccion: '', telefono: '', email: '', contacto: '', horario: '' })
  const [cdSaving, setCdSaving] = useState(false)
  // Alta de cliente provisorio (sin número): cualquiera puede cargarlo para poder armar el pedido.
  // Administración completa después el número real.
  const [provOpen, setProvOpen] = useState(false)
  const [prov, setProv] = useState({ razon: '', contacto: '', telefono: '', localidad: '' })
  const [provSaving, setProvSaving] = useState(false)

  async function loadStock() {
    const data = await fetchPaged<StockItem>(() => supabase.from('stock').select('*').order('modelo'))
    const ing = await fetchPaged<{
      codigo: string
      cantidad: number
      modelo: string | null
      descripcion: string | null
      precio: number | null
    }>(() =>
      supabase.from('stock_ingresos').select('codigo, cantidad, modelo, descripcion, precio').eq('estado', 'proyectado').order('id')
    )
    const m: Record<string, number> = {}
    for (const i of ing) m[i.codigo] = (m[i.codigo] ?? 0) + i.cantidad
    setProyectado(m)
    // Artículos que todavía no existen en depósito y solo están en producción: se pueden vender a futuro
    const existentes = new Set(data.map((s) => s.codigo))
    const vistos = new Set<string>()
    const virtuales: StockItem[] = []
    for (const i of ing) {
      if (existentes.has(i.codigo) || vistos.has(i.codigo)) continue
      vistos.add(i.codigo)
      virtuales.push({
        codigo: i.codigo,
        modelo: i.modelo || i.codigo,
        descripcion: i.descripcion,
        estuche: null,
        cantidad: 0,
        precio: i.precio ?? 0,
        clasificacion: null,
        tipo: null,
        tratamiento: null,
        demanda: 0,
        es_caliente: false,
        precio_preventa: null,
      })
    }
    setStock([...data, ...virtuales].sort((a, b) => (a.modelo || '').localeCompare(b.modelo || '')))
  }

  /** Máximo que se puede pedir de un SKU: lo que hay en depósito + lo que está en producción */
  const proyDe = (codigo: string) => proyectado[codigo] ?? 0
  const maxPedible = (p: { codigo: string; cantidad: number }) => p.cantidad + proyDe(p.codigo)

  useEffect(() => {
    loadStock()
  }, [])

  // Datos de entrega/contacto del cliente elegido
  useEffect(() => {
    if (cliente) {
      setCd({
        direccion: cliente.direccion ?? '',
        telefono: cliente.telefono ?? cliente.whatsapp ?? '',
        email: cliente.email ?? '',
        contacto: cliente.contacto ?? '',
        horario: (cliente as Cliente & { horario_entrega?: string | null }).horario_entrega ?? '',
      })
      setCdEditando(false)
    }
  }, [cliente?.cod])

  // Precios especiales del cliente (lista especial por cliente): reemplazan la lista al cotizar.
  useEffect(() => {
    if (!cliente?.cod) { setPreciosEsp({}); return }
    supabase.from('cliente_precio_especial').select('modelo, precio_neto').eq('cod_cliente', cliente.cod)
      .then(({ data }) => {
        const m: Record<string, number> = {}
        for (const r of (data as { modelo: string; precio_neto: number }[]) ?? []) m[r.modelo.trim().toUpperCase()] = Number(r.precio_neto)
        setPreciosEsp(m)
      })
  }, [cliente?.cod])

  // Cliente preseleccionado desde Cartera / Agenda
  useEffect(() => {
    const c = location.state?.cliente as Cliente | undefined
    if (c) {
      setCliente(c)
      if (c.email) setMail(c.email)
      if (c.telefono) setWsp(c.telefono)
    }
  }, [location.state])

  // Precargas de foto pendientes (IRIS leyó un pedido por WhatsApp y quedó listo para activar).
  useEffect(() => {
    supabase.from('bot_foto_pedido').select('conversacion_id, cod_cliente, cliente_razon, vendedor, items')
      .eq('estado', 'listo').order('updated_at', { ascending: false }).limit(10)
      .then(({ data }) => setPrecargas((data ?? []) as Precarga[]))
  }, [])

  // Carga una precarga en el formulario: fija el cliente y llena el carrito con lo que leyó IRIS.
  async function cargarPrecarga(p: Precarga) {
    if (p.cod_cliente) {
      const { data: c } = await supabase.from('clientes').select('*').eq('cod', p.cod_cliente).maybeSingle()
      if (c) { setCliente(c as Cliente); if ((c as Cliente).email) setMail((c as Cliente).email!); if ((c as Cliente).telefono) setWsp((c as Cliente).telefono!) }
    }
    const nuevo: Record<string, number> = {}
    let faltantes = 0
    for (const it of p.items || []) {
      if (it.sku) nuevo[it.sku] = (nuevo[it.sku] || 0) + (it.cantidad || 1)
      else faltantes++
    }
    setCart(nuevo)
    await supabase.from('bot_foto_pedido').update({ estado: 'cargado' }).eq('conversacion_id', p.conversacion_id)
    setPrecargas((prev) => prev.filter((x) => x.conversacion_id !== p.conversacion_id))
    toast(`📸 Precarga cargada${faltantes ? ` · ${faltantes} sin match (agregalos a mano)` : ''}. Revisá los sin stock, poné condiciones y confirmá.`, 'success')
  }
  async function descartarPrecarga(p: Precarga) {
    await supabase.from('bot_foto_pedido').update({ estado: 'descartado' }).eq('conversacion_id', p.conversacion_id)
    setPrecargas((prev) => prev.filter((x) => x.conversacion_id !== p.conversacion_id))
  }

  // Búsqueda de cliente
  useEffect(() => {
    const q = busquedaCliente.trim()
    if (q.length < 2 || cliente) {
      setSugerencias([])
      return
    }
    const t = setTimeout(async () => {
      const [porCod, porRazon, porNom] = await Promise.all([
        supabase.from('clientes').select('*').ilike('cod', `${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('razon', `%${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('nomcomerc', `%${q}%`).limit(5),
      ])
      const combined = [...(porCod.data ?? []), ...(porRazon.data ?? []), ...(porNom.data ?? [])] as Cliente[]
      const seen = new Set<string>()
      setSugerencias(
        combined
          .filter((c) => {
            if (!c || seen.has(c.cod)) return false
            seen.add(c.cod)
            return true
          })
          .slice(0, 8)
      )
    }, 300)
    return () => clearTimeout(t)
  }, [busquedaCliente, cliente])

  function elegirCliente(c: Cliente) {
    setCliente(c)
    setBusquedaCliente('')
    setSugerencias([])
    if (c.email) setMail(c.email)
    if (c.telefono) setWsp(c.telefono)
  }

  // Crea un cliente provisorio (código temporal TMP-…) y lo deja elegido para armar el pedido.
  // Administración le pone el número real más adelante desde Pedidos.
  async function crearProvisorio() {
    const razon = prov.razon.trim()
    if (!razon) {
      toast('Poné al menos el nombre o razón social', 'error')
      return
    }
    setProvSaving(true)
    const codTemporal = 'TMP-' + Date.now().toString().slice(-8)
    const nuevo = {
      cod: codTemporal,
      razon,
      nomcomerc: razon,
      contacto: prov.contacto.trim() || null,
      telefono: prov.telefono.trim() || null,
      whatsapp: prov.telefono.trim() || null,
      localidad: prov.localidad.trim() || null,
      origen: 'propio',
      vendedor_asignado: codigoEfectivo || (vendedor?.codigo ?? null),
      clasificacion_recupero: 'sin_historial',
      nro_lista: 5,
      nota: '⏳ Cliente provisorio sin N° — Administración completa el código.',
    }
    const { error } = await supabase.from('clientes').insert(nuevo)
    setProvSaving(false)
    if (error) {
      toast('No se pudo crear el cliente provisorio: ' + error.message, 'error')
      return
    }
    setProvOpen(false)
    setProv({ razon: '', contacto: '', telefono: '', localidad: '' })
    setBusquedaCliente('')
    setSugerencias([])
    elegirCliente(nuevo as unknown as Cliente)
    toast('✓ Cliente provisorio cargado — Administración le pone el número después', 'success')
  }

  // Stock agrupado — filtros combinables (búsqueda + modelo + tipo + clasificación + tratamiento)
  const stockFiltrado = useMemo(() => {
    const q = busquedaStock.toLowerCase().trim()
    return stock.filter((p) => {
      const matchQ =
        !q ||
        p.codigo.toLowerCase().includes(q) ||
        p.modelo.toLowerCase().includes(q) ||
        (p.descripcion || '').toLowerCase().includes(q)
      const matchM = !filtroModelo || p.modelo === filtroModelo
      const matchTipo = !filtroTipo || (p.tipo || '') === filtroTipo
      const matchClasif = !filtroClasif || (p.clasificacion || '') === filtroClasif
      const matchTratam = !filtroTratam || (p.tratamiento || '') === filtroTratam
      // Se muestran los que tienen stock real o unidades en producción (proyectado)
      const hayAlgo = p.cantidad > 0 || (proyectado[p.codigo] ?? 0) > 0
      return matchQ && matchM && matchTipo && matchClasif && matchTratam && hayAlgo
    })
  }, [stock, busquedaStock, filtroModelo, filtroTipo, filtroClasif, filtroTratam, proyectado])

  // Opciones de los filtros: solo de artículos con stock o proyectado, respetando los otros filtros (combinables)
  const conStock = useMemo(
    () => stock.filter((p) => p.cantidad > 0 || (proyectado[p.codigo] ?? 0) > 0),
    [stock, proyectado]
  )
  const opciones = (campo: 'modelo' | 'tipo' | 'clasificacion' | 'tratamiento') =>
    [...new Set(conStock.map((p) => (p[campo] || '').trim()).filter(Boolean))].sort()
  const modelos = useMemo(() => opciones('modelo'), [conStock])
  const tipos = useMemo(() => opciones('tipo'), [conStock])
  const clasificaciones = useMemo(() => opciones('clasificacion'), [conStock])
  const tratamientos = useMemo(() => opciones('tratamiento'), [conStock])
  const grupos = useMemo(() => {
    const g: Record<string, StockItem[]> = {}
    for (const p of stockFiltrado) (g[p.modelo] = g[p.modelo] || []).push(p)
    // Colores (descripción) ordenados alfabéticamente dentro de cada modelo
    for (const m of Object.keys(g))
      g[m].sort((a, b) => (a.descripcion || a.codigo).localeCompare(b.descripcion || b.codigo, 'es', { numeric: true }))
    return g
  }, [stockFiltrado])

  function toggleModelo(m: string) {
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  function addToCart(codigo: string) {
    const p = stock.find((x) => x.codigo === codigo)
    if (!p) return
    const inCart = cart[codigo] || 0
    if (inCart >= maxPedible(p)) {
      toast('Sin stock ni proyectado suficiente', 'error')
      return
    }
    setCart({ ...cart, [codigo]: inCart + 1 })
  }

  function changeQty(codigo: string, delta: number) {
    const p = stock.find((x) => x.codigo === codigo)
    if (!p) return
    const nuevo = (cart[codigo] || 0) + delta
    if (nuevo <= 0) {
      const { [codigo]: _omit, ...rest } = cart
      setCart(rest)
    } else if (nuevo > maxPedible(p)) {
      toast('Sin stock ni proyectado suficiente', 'error')
    } else {
      setCart({ ...cart, [codigo]: nuevo })
    }
  }

  const cartKeys = Object.keys(cart).filter((k) => cart[k] > 0)
  const totalUnidades = cartKeys.reduce((a, k) => a + cart[k], 0)
  // Monto REAL del pedido en vivo: usa el mismo cálculo que el remito (lista + descuentos,
  // preventa, sin cargo = $0). Así el resumen coincide exacto con lo que se factura/remite.
  // Precio especial del cliente para un modelo (o undefined si no tiene lista especial para ese modelo).
  const espDe = (modelo: string | null | undefined): number | undefined =>
    modelo ? preciosEsp[modelo.trim().toUpperCase()] : undefined

  const itemsPreview: PedidoItem[] = cartKeys.map((k) => {
    const info = stock.find((x) => x.codigo === k)
    const esRegalo = regaloSel.has(k)
    const esPreventa = !esRegalo && preventaSel.has(k) && info?.precio_preventa != null
    const esp = espDe(info?.modelo)
    return {
      codigo: k, modelo: info?.modelo ?? '', descripcion: info?.descripcion ?? null, cantidad: cart[k],
      ...(esRegalo ? { regalo: true, precio: 0 } : {}),
      ...(esPreventa ? { preventa: true, precio_pv: info!.precio_preventa! } : {}),
      ...(esp != null && !esRegalo ? { precio_esp: esp } : {}),
    }
  })
  const montoPreview = calcImporte(itemsPreview, stock, dtoComercial, dtoFinanciero, cliente?.nro_lista ?? 5)
  const financieroPreview = calcFinanciero(itemsPreview, stock, dtoComercial, dtoFinanciero, cliente?.nro_lista ?? 5)
  const dcN = parseFloat(dtoComercial || '') || 0
  const dfN = parseFloat(dtoFinanciero || '') || 0
  // Info por línea: precio neto unitario + etiqueta clara del descuento que aplicó el sistema.
  function lineaInfo(k: string): { net: number; total: number; tag: string } {
    const info = stock.find((x) => x.codigo === k)
    const esRegalo = regaloSel.has(k)
    const esPreventa = !esRegalo && preventaSel.has(k) && info?.precio_preventa != null
    const esp = espDe(info?.modelo)
    const item: PedidoItem = {
      codigo: k, modelo: info?.modelo ?? '', descripcion: info?.descripcion ?? null, cantidad: cart[k],
      ...(esRegalo ? { regalo: true, precio: 0 } : {}),
      ...(esPreventa ? { preventa: true, precio_pv: info!.precio_preventa! } : {}),
      ...(esp != null && !esRegalo ? { precio_esp: esp } : {}),
    }
    // El precio neto de la línea lleva SOLO el descuento comercial (el financiero es una NC condicional aparte).
    const net = netoUnitario(item, info?.precio || 0, cliente?.nro_lista ?? 5, dcN, dfN)
    const pct = descuentoItemPct(item, dcN, dfN) // comercial
    let tag: string
    if (esRegalo) tag = 'sin cargo (100% bonif.)'
    else if (esp != null) tag = '★ precio especial'
    else if (esPreventa) tag = 'preventa (precio fijo)'
    else tag = pct > 0 ? `−${pct}% comercial` : 'precio de lista'
    return { net, total: net * cart[k], tag }
  }
  const pendienteDe = (k: string) => Math.max(0, (cart[k] || 0) - (stock.find((x) => x.codigo === k)?.cantidad ?? 0))
  const pendientesCarrito = cartKeys.reduce((a, k) => a + pendienteDe(k), 0)
  const totalCuotas = cuotas.reduce((a, c) => a + (c.pct || 0), 0)

  // Los 6 plazos fijos + cualquier plazo extra que el usuario haya agregado y esté tildado.
  const plazosVisibles = [...new Set([...PLAZOS_FIJOS, ...cuotas.map((c) => c.dias)])].sort((a, b) => a - b)

  function togglePlazo(d: number) {
    const actuales = new Set(cuotas.map((c) => c.dias))
    if (actuales.has(d)) actuales.delete(d)
    else actuales.add(d)
    setCuotas(repartirCuotas([...actuales]))
  }

  function agregarOtroPlazo() {
    const d = parseInt(otroPlazo, 10)
    if (!Number.isFinite(d) || d < 0) return
    const actuales = new Set(cuotas.map((c) => c.dias))
    actuales.add(d)
    setCuotas(repartirCuotas([...actuales]))
    setOtroPlazo('')
  }

  function getCuotasLabel() {
    return cuotas.map((c) => `${c.dias}d-${c.pct}%`).join(' / ')
  }

  async function guardarDatosCliente() {
    if (!cliente) return
    setCdSaving(true)
    await supabase
      .from('clientes')
      .update({
        direccion: cd.direccion.trim() || null,
        telefono: cd.telefono.trim() || null,
        email: cd.email.trim() || null,
        contacto: cd.contacto.trim() || null,
        horario_entrega: cd.horario.trim() || null,
      })
      .eq('cod', cliente.cod)
    setCliente({
      ...cliente,
      direccion: cd.direccion.trim() || null,
      telefono: cd.telefono.trim() || null,
      email: cd.email.trim() || null,
      contacto: cd.contacto.trim() || null,
    })
    if (cd.email.trim()) setMail(cd.email.trim())
    if (cd.telefono.trim()) setWsp(cd.telefono.trim())
    setCdSaving(false)
    setCdEditando(false)
    toast('✓ Datos del cliente actualizados', 'success')
  }

  async function confirmar() {
    if (!cliente) {
      toast('Ingresá o buscá el número de cliente primero', 'error')
      return
    }
    if (!entregaCanal) {
      toast('Elegí por qué canal se entrega el pedido', 'error')
      return
    }
    if (!entregaPago) {
      toast('Elegí cuándo cobra: antes, contra entrega, después o cuenta corriente', 'error')
      return
    }
    if (!medios.length) {
      toast('Tildá al menos un tipo de pago (efectivo, transferencia, cheque o eCheck)', 'error')
      return
    }
    if (Math.abs(totalCuotas - 100) > 1) {
      toast(`Los porcentajes de cuotas suman ${Math.round(totalCuotas)}% — deben sumar 100%`, 'error')
      return
    }
    if (!cartKeys.length) {
      toast('El pedido está vacío', 'error')
      return
    }
    setConfirmando(true)
    try {
      // Verificar stock actual: se puede pedir hasta lo disponible + lo que está en producción
      const fresh = await fetchPaged<StockItem>(() => supabase.from('stock').select('*'))
      const freshDe = (k: string) => fresh.find((x) => x.codigo === k)
      for (const k of cartKeys) {
        const disponible = freshDe(k)?.cantidad ?? 0
        if (cart[k] > disponible + proyDe(k)) {
          const info = stock.find((x) => x.codigo === k)
          toast(
            `Sin stock suficiente de ${info?.modelo ?? k}. Disponible: ${disponible} · proyectado: ${proyDe(k)}`,
            'error'
          )
          setConfirmando(false)
          return
        }
      }

      // Lo que exceda el stock físico queda como "pendiente" (se cubre con el proyectado cuando ingrese)
      const items: PedidoItem[] = cartKeys.map((k) => {
        const p = freshDe(k)
        const info = stock.find((x) => x.codigo === k)
        const disponible = p?.cantidad ?? 0
        const pendiente = Math.max(0, cart[k] - disponible)
        const esRegalo = regaloSel.has(k)
        const esPreventa = !esRegalo && preventaSel.has(k) && info?.precio_preventa != null
        const esp = espDe(p?.modelo ?? info?.modelo)
        return {
          codigo: k,
          modelo: p?.modelo ?? info?.modelo ?? k,
          descripcion: p?.descripcion ?? info?.descripcion ?? null,
          cantidad: cart[k],
          ...(pendiente > 0 ? { pendiente } : {}),
          ...(esRegalo ? { regalo: true, precio: 0 } : {}),
          ...(esPreventa ? { preventa: true, precio_pv: info!.precio_preventa! } : {}),
          ...(esp != null && !esRegalo ? { precio_esp: esp } : {}),
        }
      })
      const totalPendiente = items.reduce((a, i) => a + (i.pendiente ?? 0), 0)

      const negroPct = 100 - blancoPct
      let pagoLabel = getCuotasLabel() + ` | ${labelMedios(medios)}`
      pagoLabel += blancoPct < 100 ? ` | Blanco:${blancoPct}% Negro:${negroPct}%` : ''
      if (dtoFinanciero && parseFloat(dtoFinanciero) > 0) pagoLabel += ` | Dto. financiero: ${dtoFinanciero}%`
      if (dtoComercial && parseFloat(dtoComercial) > 0) pagoLabel += ` | Dto. comercial: ${dtoComercial}%`

      // Descontar del stock solo las unidades que había físicamente (lo pendiente no se descuenta)
      for (const item of items) {
        const p = freshDe(item.codigo)
        if (!p) continue
        const aDescontar = item.cantidad - (item.pendiente ?? 0)
        if (aDescontar <= 0) continue
        await supabase
          .from('stock')
          .update({ cantidad: p.cantidad - aDescontar, updated_at: new Date().toISOString() })
          .eq('codigo', item.codigo)
      }

      // Crear pedido (el trigger de la base registra la actividad comercial automáticamente)
      await supabase.from('pedidos').insert({
        fecha: new Date().toLocaleString('es-AR'),
        vendedor: codigoEfectivo || (vendedor?.codigo ?? ''),
        nro_lista: cliente.nro_lista ?? 5,
        blanco_pct: blancoPct,
        negro_pct: negroPct,
        cuotas_detalle: JSON.stringify(cuotas),
        cod_cliente: cliente.cod,
        cliente: `${cliente.cod} - ${cliente.razon ?? ''}`,
        cond_entrega: labelEntrega(entregaCanal, entregaPago),
        entrega_canal: entregaCanal,
        entrega_pago: entregaPago,
        cond_pago: pagoLabel,
        medios_pago: medios,
        dto_comercial: dtoComercial,
        dto_financiero: dtoFinanciero,
        wsp,
        mail,
        obs,
        contacto_entrega: cd.contacto.trim() || null,
        direccion_entrega: cd.direccion.trim() || null,
        horario_entrega: cd.horario.trim() || null,
        items,
        total_units: totalUnidades,
        estado: 'pendiente',
      })

      // Registrar los datos de entrega/contacto también en la ficha del cliente
      await supabase
        .from('clientes')
        .update({
          contacto: cd.contacto.trim() || null,
          direccion: cd.direccion.trim() || null,
          horario_entrega: cd.horario.trim() || null,
          email: mail.trim() || null,
          whatsapp: wsp.trim() || null,
        })
        .eq('cod', cliente.cod)

      await loadStock()
      setCart({})
      setPreventaSel(new Set())
      setCliente(null)
      setEntregaCanal('')
      setEntregaPago('')
      setMedios([])
      setDtoFinanciero('')
      setDtoComercial('')
      setBlancoPct(100)
      setCuotas([{ dias: 0, pct: 100 }])
      setWsp('')
      setMail('')
      setObs('')
      toast(
        totalPendiente > 0
          ? `✓ Pedido confirmado — ${totalUnidades} u. para ${cliente.razon} · ${totalPendiente} u. quedan pendientes de producción`
          : `✓ Pedido confirmado — ${totalUnidades} unidades para ${cliente.razon}`,
        'success'
      )
    } catch (e) {
      console.error(e)
      toast('Error al confirmar el pedido. Probá de nuevo.', 'error')
    } finally {
      setConfirmando(false)
    }
  }

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">Nuevo Pedido</h2>

      {precargas.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-emerald-800">📸 Precargas de foto (leídas por IRIS)</p>
          {precargas.map((p) => (
            <div key={p.conversacion_id} className="flex items-center justify-between gap-2 bg-white rounded-lg border border-emerald-100 p-2">
              <div className="min-w-0 text-xs">
                <b>{p.cliente_razon ?? p.cod_cliente ?? 'Sin cliente'}</b> · {(p.items?.length ?? 0)} modelos
                {p.vendedor ? <span className="text-muted"> · {p.vendedor}</span> : null}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => cargarPrecarga(p)} className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5">Cargar</button>
                <button onClick={() => descartarPrecarga(p)} className="text-[11px] rounded-lg border border-black/10 px-2 py-1.5 text-muted">Descartar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CLIENTE */}
      <div className="bg-white rounded-xl p-4 border border-black/10 space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">Cliente</p>
        {cliente ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{cliente.razon}</p>
                <p className="text-xs text-muted">
                  {cliente.cod} · {cliente.localidad ?? ''} {cliente.cuit ? `· CUIT ${cliente.cuit}` : ''} · Lista{' '}
                  {cliente.nro_lista ?? 5}
                </p>
              </div>
              <button onClick={() => setCliente(null)} className="text-xs text-muted underline">
                cambiar
              </button>
            </div>
            {cliente.cod?.startsWith('TMP-') && (
              <div className="bg-amber-100 border border-amber-200 text-amber-800 rounded-lg p-2 text-[11px]">
                ⏳ Cliente <b>provisorio</b> (sin N° todavía). Podés cargar el pedido igual; Administración completa el
                número de cliente antes de facturar.
              </div>
            )}
            <div className="bg-[#F1EDE4] rounded-lg p-2.5 text-xs mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-muted uppercase tracking-wide text-[10px]">
                  Datos de entrega y contacto
                </span>
                {!cdEditando && (
                  <button type="button" onClick={() => setCdEditando(true)} className="text-brandDark font-medium">
                    ✏️ Editar
                  </button>
                )}
              </div>
              {cdEditando ? (
                <div className="space-y-1.5">
                  {(
                    [
                      ['direccion', 'Dirección de entrega'],
                      ['telefono', 'Teléfono'],
                      ['email', 'Mail'],
                      ['contacto', 'Nombre de contacto'],
                      ['horario', 'Horario de entrega (ej: Lun a Vie 9-13)'],
                    ] as const
                  ).map(([key, ph]) => (
                    <input
                      key={key}
                      value={cd[key]}
                      onChange={(e) => setCd({ ...cd, [key]: e.target.value })}
                      placeholder={ph}
                      className="w-full bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint"
                    />
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={guardarDatosCliente}
                      disabled={cdSaving}
                      className="flex-1 rounded-lg bg-brand text-white py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {cdSaving ? 'Guardando...' : 'Guardar datos'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCdEditando(false)}
                      className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-muted"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-muted space-y-0.5">
                  <p>📍 {cd.direccion || '— sin dirección —'}</p>
                  <p>
                    📞 {cd.telefono || '—'} · ✉️ {cd.email || '—'}
                  </p>
                  <p>
                    👤 {cd.contacto || '—'} · 🕒 {cd.horario || 'sin horario de entrega'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <input
              placeholder="Buscar por código, razón social o nombre comercial..."
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand"
            />
            <div className="space-y-1">
              {sugerencias.map((c) => (
                <button
                  key={c.cod}
                  onClick={() => elegirCliente(c)}
                  className="w-full text-left rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-brand/40"
                >
                  <b>{c.cod}</b> · {c.razon} <span className="text-faint">({c.localidad || ''})</span>
                </button>
              ))}
            </div>

            {!provOpen ? (
              <button
                onClick={() => {
                  setProv((p) => ({ ...p, razon: busquedaCliente.trim() }))
                  setProvOpen(true)
                }}
                className="w-full rounded-lg border border-dashed border-brand/50 text-brandDark py-2 text-xs font-medium"
              >
                ➕ Cliente nuevo sin número (provisorio)
              </button>
            ) : (
              <div className="rounded-lg border border-black/10 bg-[#F8F6F0] p-3 space-y-2">
                <p className="text-[11px] text-muted">
                  Cargá los datos para poder armar el pedido. Administración le pone el N° de cliente después.
                </p>
                {(
                  [
                    ['razon', 'Nombre o razón social *'],
                    ['contacto', 'Contacto'],
                    ['telefono', 'Teléfono / WhatsApp'],
                    ['localidad', 'Localidad'],
                  ] as const
                ).map(([k, ph]) => (
                  <input
                    key={k}
                    value={prov[k]}
                    onChange={(e) => setProv({ ...prov, [k]: e.target.value })}
                    placeholder={ph}
                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
                  />
                ))}
                <div className="flex gap-2">
                  <button
                    onClick={() => setProvOpen(false)}
                    className="rounded-lg border border-black/10 px-3 py-2 text-xs text-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={crearProvisorio}
                    disabled={provSaving}
                    className="flex-1 rounded-lg bg-brand text-white py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {provSaving ? 'Cargando...' : 'Usar este cliente provisorio'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        {/* STOCK */}
        <div className="bg-white rounded-xl p-4 border border-black/10 space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Stock disponible</p>
          <input
            placeholder="Buscar por código, modelo o descripción..."
            value={busquedaStock}
            onChange={(e) => setBusquedaStock(e.target.value)}
            className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
          />
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Modelo', filtroModelo, setFiltroModelo, modelos],
                ['Tipo', filtroTipo, setFiltroTipo, tipos],
                ['Clasificación', filtroClasif, setFiltroClasif, clasificaciones],
                ['Tratamiento', filtroTratam, setFiltroTratam, tratamientos],
              ] as [string, string, (v: string) => void, string[]][]
            ).map(([label, val, set, opts]) => (
              <select
                key={label}
                value={val}
                onChange={(e) => set(e.target.value)}
                className={`bg-white border rounded-lg px-2 py-2 text-sm ${val ? 'border-brand text-brandDark font-medium' : 'border-black/10'}`}
              >
                <option value="">{label}: todos</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ))}
          </div>
          {(filtroModelo || filtroTipo || filtroClasif || filtroTratam || busquedaStock) && (
            <button
              onClick={() => {
                setBusquedaStock('')
                setFiltroModelo('')
                setFiltroTipo('')
                setFiltroClasif('')
                setFiltroTratam('')
              }}
              className="text-[11px] text-brandDark font-medium"
            >
              ✕ Limpiar filtros ({stockFiltrado.length} artículos)
            </button>
          )}
          <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
            {Object.keys(grupos)
              .sort()
              .map((modelo) => {
                const items = grupos[modelo]
                const abierto = busquedaStock.trim() ? true : expandidos.has(modelo)
                const disponible = items.reduce((s, p) => s + Math.max(0, p.cantidad - (cart[p.codigo] || 0)), 0)
                const enCarrito = items.reduce((s, p) => s + (cart[p.codigo] || 0), 0)
                const proyGrupo = items.reduce((s, p) => s + proyDe(p.codigo), 0)
                return (
                  <div key={modelo} className="border border-black/10 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleModelo(modelo)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-[#F1EDE4] text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span>{abierto ? '▾' : '▸'}</span>
                        <span className="font-semibold">
                          {items.some((p) => p.es_caliente) && '🔥 '}
                          {modelo}
                        </span>
                        <span className="text-xs text-faint">
                          {items.length} color{items.length !== 1 ? 'es' : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {enCarrito > 0 && <span className="text-xs text-brandDark font-medium">{enCarrito} en pedido</span>}
                        {proyGrupo > 0 && (
                          <span
                            className="text-xs font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700"
                            title="Unidades en producción (proyectado)"
                          >
                            🏭 {proyGrupo}
                          </span>
                        )}
                        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${qtyClass(disponible)}`}>
                          {disponible}
                        </span>
                      </span>
                    </button>
                    {abierto && (
                      <div className="divide-y divide-black/5">
                        {items.map((p) => {
                          const inCart = cart[p.codigo] || 0
                          const disp = p.cantidad - inCart
                          const proy = proyDe(p.codigo)
                          const restante = maxPedible(p) - inCart
                          return (
                            <div key={p.codigo} className="flex items-center justify-between px-3 py-2 gap-2">
                              <div className="min-w-0">
                                <p className="text-sm truncate">
                                  {p.es_caliente && (
                                    <span title="Producto caliente — mucha demanda">🔥 </span>
                                  )}
                                  {p.descripcion || '—'}
                                </p>
                                <p className="text-[10px] text-faint font-mono">{p.codigo}</p>
                                {(p.precio ?? 0) > 0 && (
                                  <p className="text-xs text-gold font-semibold">{formatPrecio(p.precio)}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {proy > 0 && (
                                  <span
                                    className="text-xs font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700"
                                    title="En producción — se entrega cuando ingrese a depósito"
                                  >
                                    🏭 {proy}
                                  </span>
                                )}
                                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${qtyClass(Math.max(0, disp))}`}>
                                  {Math.max(0, disp)}
                                </span>
                                {inCart > 0 ? (
                                  <span className="flex items-center gap-1">
                                    <button
                                      onClick={() => changeQty(p.codigo, -1)}
                                      className="w-7 h-7 rounded border border-black/10 text-sm"
                                    >
                                      −
                                    </button>
                                    <span
                                      className={`w-6 text-center text-sm font-semibold ${disp < 0 ? 'text-violet-700' : ''}`}
                                      title={disp < 0 ? `${-disp} u. contra producción` : undefined}
                                    >
                                      {inCart}
                                    </span>
                                    <button
                                      onClick={() => changeQty(p.codigo, 1)}
                                      disabled={restante <= 0}
                                      className="w-7 h-7 rounded border border-black/10 text-sm disabled:opacity-30"
                                    >
                                      +
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => addToCart(p.codigo)}
                                    disabled={restante <= 0}
                                    className="text-xs font-medium bg-brand text-white rounded-lg px-2.5 py-1.5 disabled:opacity-30"
                                  >
                                    + Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            {Object.keys(grupos).length === 0 && (
              <p className="text-sm text-faint text-center py-6">Sin artículos con stock</p>
            )}
          </div>
        </div>

        {/* CARRITO + CONDICIONES */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 border border-black/10 space-y-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Pedido ({totalUnidades} unidades)
            </p>
            {cartKeys.length === 0 ? (
              <p className="text-sm text-faint text-center py-4">
                El pedido está vacío.
                <br />
                Agregá artículos desde el stock.
              </p>
            ) : (
              cartKeys.map((k) => {
                const p = stock.find((x) => x.codigo === k)
                if (!p) return null
                return (
                  <div key={k} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <b>{p.modelo}</b> <span className="text-muted text-xs">{p.descripcion || p.codigo}</span>
                      {pendienteDe(k) > 0 && (
                        <span className="block text-[10px] text-violet-700 font-medium">
                          🏭 {pendienteDe(k)} u. contra producción (se entregan cuando ingresen)
                        </span>
                      )}
                      {p.precio_preventa != null && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreventaSel((prev) => {
                              const n = new Set(prev)
                              if (n.has(k)) n.delete(k)
                              else n.add(k)
                              return n
                            })
                          }
                          className={`mt-0.5 inline-block text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                            preventaSel.has(k)
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'border-amber-300 text-amber-700'
                          }`}
                        >
                          {preventaSel.has(k) ? '✓ ' : ''}Preventa {formatPrecio(p.precio_preventa)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setRegaloSel((prev) => {
                            const n = new Set(prev)
                            if (n.has(k)) n.delete(k)
                            else n.add(k)
                            return n
                          })
                        }
                        className={`mt-0.5 ml-1 inline-block text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                          regaloSel.has(k) ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-300 text-emerald-700'
                        }`}
                        title="Marcar sin cargo (bonificación, precio 0)"
                      >
                        {regaloSel.has(k) ? '✓ ' : ''}Sin cargo
                      </button>
                      {(() => { const li = lineaInfo(k); return (
                        <p className="text-[10px] text-muted mt-0.5">
                          {formatPrecio(li.net)}/u · <span className="text-brandDark">{li.tag}</span> · <b className="text-ink">{formatPrecio(li.total)}</b>
                        </p>
                      )})()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => changeQty(k, -1)} className="w-6 h-6 rounded border border-black/10 text-xs">
                        −
                      </button>
                      <span className="w-6 text-center font-semibold">{cart[k]}</span>
                      <button onClick={() => changeQty(k, 1)} className="w-6 h-6 rounded border border-black/10 text-xs">
                        +
                      </button>
                      <button onClick={() => changeQty(k, -cart[k])} className="text-red-600 ml-1">
                        ×
                      </button>
                    </div>
                  </div>
                )
              })
            )}
            {cartKeys.length > 0 && (
              <div className="border-t border-black/10 pt-2 mt-1 space-y-0.5">
                {dcN > 0 && (
                  <>
                    <div className="flex items-center justify-between text-[11px] text-faint">
                      <span>Bruto (lista/preventa)</span><span>{formatPrecio(montoPreview.bruto)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-rose-600">
                      <span>− Dto comercial {dcN}%</span><span>− {formatPrecio(montoPreview.bruto - montoPreview.neto)}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>Neto a facturar{dcN > 0 ? ' (con dto. comercial)' : ''}</span>
                  <span className="text-gold">{formatPrecio(montoPreview.neto)}</span>
                </div>
                {dfN > 0 && financieroPreview > 0 && (
                  <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[10px] text-amber-900 leading-snug">
                    💳 <b>Dto financiero {dfN}%</b> = {formatPrecio(financieroPreview)} — <b>condicional al pago pactado</b> (efectivo/transferencia).
                    NO baja esta factura: Administración genera una <b>NC "Diferencia de Precios"</b> al confirmar el cobro.
                    <span className="block mt-0.5">Total con financiero si cumple: <b>{formatPrecio(montoPreview.neto - financieroPreview)}</b> · comercial + financiero no se suman.</span>
                  </div>
                )}
                <p className="text-[10px] text-faint">Neto sin IVA · coincide con el remito y Tango. Sin cargo = $0; el financiero va aparte como NC condicional.</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Condiciones</p>
            <div>
              <p className="text-xs text-muted mb-1.5">Forma de entrega — canal y cobranza se combinan</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] text-faint">
                  Por dónde se manda
                  <select
                    value={entregaCanal}
                    onChange={(e) => setEntregaCanal(e.target.value)}
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                  >
                    <option value="">— Seleccioná —</option>
                    {ENTREGA_CANALES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] text-faint">
                  Cuándo paga
                  <select
                    value={entregaPago}
                    onChange={(e) => setEntregaPago(e.target.value)}
                    className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                  >
                    <option value="">— Seleccioná —</option>
                    {ENTREGA_PAGOS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {entregaCanal && entregaPago && (
                <p className="text-[11px] text-muted mt-1.5">🚚 {labelEntrega(entregaCanal, entregaPago)}</p>
              )}
            </div>

            <div>
              <p className="text-xs text-muted mb-1.5">Tipo de pago — tildá todos los que apliquen</p>
              <div className="flex flex-wrap gap-1.5">
                {MEDIOS_PAGO.map((m) => {
                  const activo = medios.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setMedios((prev) => (activo ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        activo ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted hover:bg-[#F1EDE4]'
                      }`}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted mb-1.5">Plazos de pago — tildá los plazos (en días)</p>
              <div className="flex flex-wrap gap-1.5">
                {plazosVisibles.map((d) => {
                  const activo = cuotas.some((c) => c.dias === d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => togglePlazo(d)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        activo ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted hover:bg-[#F1EDE4]'
                      }`}
                    >
                      {d === 0 ? 'Contado' : `${d}d`}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  type="number"
                  value={otroPlazo}
                  min={1}
                  max={365}
                  placeholder="otro"
                  onChange={(e) => setOtroPlazo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && agregarOtroPlazo()}
                  className="w-20 border border-black/10 rounded-md px-2 py-1.5 text-xs"
                />
                <span className="text-[11px] text-faint">días</span>
                <button type="button" onClick={agregarOtroPlazo} className="text-xs text-brandDark font-medium">
                  + Agregar plazo
                </button>
              </div>
              {cuotas.length > 0 && (
                <p className="text-[11px] text-muted mt-2">
                  {cuotas.length === 1 && cuotas[0].dias === 0
                    ? 'Contado (100%)'
                    : cuotas
                        .map((c) => `${c.dias === 0 ? 'contado' : c.dias + 'd'}: ${c.pct}%`)
                        .join(' · ')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted">
                Dto. comercial %
                <input
                  type="number"
                  value={dtoComercial}
                  onChange={(e) => setDtoComercial(e.target.value)}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted">
                Dto. financiero %
                <input
                  type="number"
                  value={dtoFinanciero}
                  onChange={(e) => setDtoFinanciero(e.target.value)}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted">
                Blanco %
                <input
                  type="number"
                  value={blancoPct}
                  min={0}
                  max={100}
                  onChange={(e) => setBlancoPct(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted">
                Negro %
                <input
                  type="number"
                  value={100 - blancoPct}
                  disabled
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm bg-black/5"
                />
              </label>
            </div>

            <label className="block text-xs text-muted">
              Nombre de contacto
              <input
                value={cd.contacto}
                onChange={(e) => setCd({ ...cd, contacto: e.target.value })}
                placeholder="Quién recibe / decide"
                className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
            </label>
            <label className="block text-xs text-muted">
              Dirección de entrega
              <input
                value={cd.direccion}
                onChange={(e) => setCd({ ...cd, direccion: e.target.value })}
                placeholder="Calle, número, localidad"
                className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
            </label>
            <label className="block text-xs text-muted">
              Horario de entrega
              <input
                value={cd.horario}
                onChange={(e) => setCd({ ...cd, horario: e.target.value })}
                placeholder="Ej: Lun a Vie 9-13"
                className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted">
                WhatsApp
                <input
                  value={wsp}
                  onChange={(e) => setWsp(e.target.value)}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-muted">
                Mail
                <input
                  value={mail}
                  onChange={(e) => setMail(e.target.value)}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>

            <label className="block text-xs text-muted">
              Observaciones
              <input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Notas para depósito / administración"
                className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
              />
            </label>

            {pendientesCarrito > 0 && (
              <div className="bg-violet-50 border border-violet-200 text-violet-800 rounded-lg p-2.5 text-xs">
                🏭 <b>{pendientesCarrito} unidades</b> de este pedido están en producción y todavía no ingresaron a
                depósito. Depósito va a decidir si entrega lo disponible ahora o espera el pedido completo.
              </div>
            )}
            <button
              onClick={confirmar}
              disabled={confirmando || cartKeys.length === 0}
              className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {confirmando ? 'Confirmando…' : 'Confirmar Pedido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
