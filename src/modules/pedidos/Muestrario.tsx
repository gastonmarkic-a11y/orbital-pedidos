import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { fetchPaged } from '../../lib/fetchAll'
import { LectorCamara, pitido } from '../../lib/lector'
import { Lectura, normalizarTag, useLectorRfid } from '../../lib/rfid'
import { FotoProd } from '../catalogo/FotoProd'
import { getPrecioLista } from './calc'

// Muestrario RFID: el teléfono es el receptor de las etiquetas de la valija.
//  · Pedido: en la óptica se separan las piezas que quieren, se leen (NFC / lector Bluetooth /
//    cámara), solo se ponen cantidades y sale la precarga reservada. Además ofrece los colores
//    con stock de esos modelos que no están en la valija, para ampliar el pedido.
//  · Mi valija: el muestrario en línea con el stock libre: qué no ofrecer (sin stock), qué está
//    por agotarse, qué colores y modelos con stock le faltan a la valija.
//  · Cargar / control: alta de etiquetas (etiqueta → SKU) y control de que esté todo en la valija.

type Art = { codigo: string; modelo: string; descripcion: string | null; precio: number; fisico: number; libre: number; caliente: boolean; demanda: number }
type Pieza = { id: number; tag: string; codigo: string; estado: 'en_valija' | 'fuera'; ultima_lectura: string | null }
type Linea = { codigo: string; cantidad: number; origen: 'valija' | 'ampliar' }
type Tab = 'pedido' | 'valija' | 'cargar'
type Condiciones = {
  id: number; blanco_pct: number | null; negro_pct: number | null; cuotas_detalle: string | null; cond_entrega: string | null
  entrega_canal: string; entrega_pago: string | null; cond_pago: string | null; medios_pago: string[]; dto_comercial: string | null
  dto_financiero: string | null; wsp: string | null; mail: string | null; contacto_entrega: string | null; direccion_entrega: string | null; horario_entrega: string | null
}
type Promo = { modelo: string; codigo: string | null; precio: number; promo: string; desde: string; hasta: string }

// Etiquetas UHF grabadas con el SKU: el EPC viene en hex; si decodifica a texto legible, es el código.
function hexATexto(tag: string): string | null {
  if (!/^([0-9A-F]{2}){3,}$/.test(tag)) return null
  const s = tag.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('').replace(/\0+$/g, '').trim()
  return /^[\x20-\x7E]{3,}$/.test(s) ? s.toUpperCase() : null
}

const POCO = 3

export default function Muestrario() {
  const { codigoEfectivo, vendedor } = useAuth()
  const yo = codigoEfectivo || vendedor?.codigo || ''
  const toast = useToast()
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('pedido')
  const tabRef = useRef(tab)
  tabRef.current = tab

  // ── Datos ──────────────────────────────────────────────────────────────
  const [stock, setStock] = useState<Map<string, Art>>(new Map())
  const [piezas, setPiezas] = useState<Pieza[]>([])
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [cliente, setCliente] = useState<Cliente | null>(null)

  async function cargarStock(codCliente: string | null) {
    const [filas, lib] = await Promise.all([
      fetchPaged<{ codigo: string; modelo: string | null; descripcion: string | null; precio: number | null; cantidad: number | null; es_caliente: boolean | null; demanda: number | null }>(
        () => supabase.from('stock').select('codigo, modelo, descripcion, precio, cantidad, es_caliente, demanda').order('codigo')),
      supabase.rpc('stock_libre', { p_cod_cliente: codCliente, p_excluir_precarga: null }),
    ])
    const libre = new Map(((lib.data ?? []) as { codigo: string; libre: number }[]).map((l) => [l.codigo, Number(l.libre)]))
    const m = new Map<string, Art>()
    for (const s of filas) m.set(s.codigo, {
      codigo: s.codigo, modelo: (s.modelo || s.codigo).trim(), descripcion: s.descripcion, precio: Number(s.precio ?? 0),
      fisico: s.cantidad ?? 0, libre: Math.max(0, libre.get(s.codigo) ?? s.cantidad ?? 0), caliente: !!s.es_caliente, demanda: Number(s.demanda ?? 0),
    })
    setStock(m)
    return m
  }

  async function cargarPiezas() {
    if (!yo) return []
    const { data, error } = await supabase.from('muestrario').select('id, tag, codigo, estado, ultima_lectura').eq('vendedor', yo).order('codigo')
    if (error) { toast('No pude leer tu valija: ' + error.message, 'error'); return [] }
    setPiezas((data ?? []) as Pieza[])
    return (data ?? []) as Pieza[]
  }

  // Fotos: primera imagen de cada SKU de los modelos que lleva (y de lo que se ofrece para ampliar).
  async function cargarFotos(codigos: string[]) {
    const faltan = codigos.filter((c) => !(c in fotos))
    const nuevas: Record<string, string> = {}
    for (let i = 0; i < faltan.length; i += 200) {
      const { data } = await supabase.from('producto_imagenes').select('codigo, url, orden').in('codigo', faltan.slice(i, i + 200)).not('url', 'ilike', '%packaging%').order('orden', { nullsFirst: false })
      for (const r of (data ?? []) as { codigo: string; url: string }[]) if (!nuevas[r.codigo]) nuevas[r.codigo] = r.url
    }
    for (const c of faltan) nuevas[c] ??= ''
    setFotos((p) => ({ ...p, ...nuevas }))
  }

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      const [m, ps] = await Promise.all([cargarStock(null), cargarPiezas()])
      if (!vivo) return
      setCargando(false)
      const modelos = new Set(ps.map((p) => m.get(p.codigo)?.modelo).filter(Boolean))
      cargarFotos([...m.values()].filter((a) => modelos.has(a.modelo)).map((a) => a.codigo))
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yo])

  // El libre depende del cliente (reservas de producción a su nombre).
  useEffect(() => { if (cliente) cargarStock(cliente.cod) }, [cliente?.cod]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cierre directo: condiciones del último pedido de la óptica + precios especiales y promos vigentes
  // (lo mismo que aplica Nuevo Pedido), así el pedido sale confirmado solo con cantidades.
  const [cond, setCond] = useState<Condiciones | null>(null)
  const [cambiarCond, setCambiarCond] = useState(false)
  const [preciosEsp, setPreciosEsp] = useState<Record<string, number>>({})
  const [promos, setPromos] = useState<Promo[]>([])
  useEffect(() => {
    supabase.from('promo_precio').select('modelo, codigo, precio, promo, desde, hasta').eq('activo', true)
      .then(({ data }) => setPromos(((data ?? []) as Promo[]).map((p) => ({ ...p, precio: Number(p.precio) }))))
  }, [])
  useEffect(() => {
    setCond(null); setCambiarCond(false); setPreciosEsp({})
    if (!cliente) return
    supabase.from('pedidos')
      .select('id, blanco_pct, negro_pct, cuotas_detalle, cond_entrega, entrega_canal, entrega_pago, cond_pago, medios_pago, dto_comercial, dto_financiero, wsp, mail, contacto_entrega, direccion_entrega, horario_entrega')
      .eq('cod_cliente', cliente.cod).is('origen', null).not('entrega_canal', 'is', null).not('medios_pago', 'is', null)
      .order('id', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setCond((data as Condiciones) ?? null))
    supabase.from('cliente_precio_especial').select('modelo, precio_neto').eq('cod_cliente', cliente.cod)
      .then(({ data }) => setPreciosEsp(Object.fromEntries(((data ?? []) as { modelo: string; precio_neto: number }[]).map((r) => [r.modelo.trim().toUpperCase(), Number(r.precio_neto)]))))
  }, [cliente?.cod]) // eslint-disable-line react-hooks/exhaustive-deps

  const enValija = useMemo(() => piezas.filter((p) => p.estado === 'en_valija'), [piezas])
  const codValija = useMemo(() => new Set(enValija.map((p) => p.codigo)), [enValija])
  const porModelo = useMemo(() => {
    const m = new Map<string, Art[]>()
    for (const a of stock.values()) { const l = m.get(a.modelo) ?? []; l.push(a); m.set(a.modelo, l) }
    return m
  }, [stock])

  // Etiqueta → SKU: primero la valija, después el texto grabado / el propio tag como SKU.
  function resolver(l: Lectura): { codigo: string | null; pieza: Pieza | null } {
    const pieza = piezas.find((p) => p.tag === l.tag) ?? null
    if (pieza) return { codigo: pieza.codigo, pieza }
    for (const c of [l.texto, l.tag, hexATexto(l.tag)]) {
      if (!c) continue
      const n = normalizarTag(c)
      if (stock.has(n)) return { codigo: n, pieza: null }
      const exacto = [...stock.keys()].find((k) => k.toUpperCase() === c.toUpperCase())
      if (exacto) return { codigo: exacto, pieza: null }
    }
    return { codigo: null, pieza: null }
  }

  // ── Lectura (un solo receptor para las tres solapas) ──────────────────────────
  const handlers = useRef<Record<Tab, (l: Lectura) => void>>({ pedido: () => {}, valija: () => {}, cargar: () => {} })
  const lector = useLectorRfid((l) => handlers.current[tabRef.current](l), !cargando)
  const [camara, setCamara] = useState(false)
  const [manual, setManual] = useState('')
  const leerManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manual.trim()) return
    lector.emitir({ tag: normalizarTag(manual), texto: manual.trim().toUpperCase(), via: 'manual' })
    setManual('')
  }

  // ── Pedido ────────────────────────────────────────────────────────────
  const [busqueda, setBusqueda] = useState('')
  const [sugerencias, setSugerencias] = useState<Cliente[]>([])
  const [lineas, setLineas] = useState<Linea[]>([])
  const [cantDefault, setCantDefault] = useState(1)
  const [resaltado, setResaltado] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecha, setHecha] = useState<{ id: number; confirmado: boolean; unidades: number; importe: number; pendientes: number; faltantes: { modelo: string; descripcion: string; pedido: number; libre: number }[] } | null>(null)
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2 || cliente) { setSugerencias([]); return }
    const t = setTimeout(async () => {
      const [a, b, c] = await Promise.all([
        supabase.from('clientes').select('*').ilike('cod', `${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('razon', `%${q}%`).limit(5),
        supabase.from('clientes').select('*').ilike('nomcomerc', `%${q}%`).limit(5),
      ])
      const vistos = new Set<string>()
      setSugerencias(([...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])] as Cliente[])
        .filter((x) => x && !vistos.has(x.cod) && vistos.add(x.cod)).slice(0, 8))
    }, 300)
    return () => clearTimeout(t)
  }, [busqueda, cliente])

  function sumar(codigo: string, origen: Linea['origen'], cant = cantDefault) {
    const a = stock.get(codigo)
    if (!a) return
    setLineas((prev) => prev.some((l) => l.codigo === codigo) ? prev : [{ codigo, cantidad: Math.min(cant, a.libre), origen }, ...prev])
    setResaltado(codigo)
    setTimeout(() => setResaltado((r) => (r === codigo ? '' : r)), 1600)
  }

  handlers.current.pedido = (l) => {
    if (!cliente) { pitido(false); toast('Primero elegí la óptica.', 'error'); return }
    const { codigo } = resolver(l)
    if (!codigo) { pitido(false); toast(`Etiqueta ${l.tag} sin registrar. Dala de alta en "Cargar / control".`, 'error'); return }
    const a = stock.get(codigo)!
    if (lineas.some((x) => x.codigo === codigo)) {
      pitido(true); setResaltado(codigo); qtyRefs.current[codigo]?.focus()
      toast(`${a.modelo} ${a.descripcion ?? ''} ya está: poné la cantidad.`, 'success')
      return
    }
    pitido(a.libre > 0)
    sumar(codigo, 'valija')
    if (a.libre <= 0) toast(`❌ ${a.modelo} ${a.descripcion ?? ''} sin stock. Abajo tenés los colores que sí hay.`, 'error')
  }

  function setCant(codigo: string, v: number) {
    const max = stock.get(codigo)?.libre ?? 0
    setLineas((p) => p.map((l) => (l.codigo === codigo ? { ...l, cantidad: Math.max(0, Math.min(isNaN(v) ? 0 : v, max)) } : l)))
  }

  // Colores con stock de los modelos pedidos que NO están en la valija (y todavía no se sumaron).
  const paraAmpliar = useMemo(() => {
    const enPedido = new Set(lineas.map((l) => l.codigo))
    const modelos = [...new Set(lineas.map((l) => stock.get(l.codigo)?.modelo).filter(Boolean) as string[])]
    return modelos.map((m) => ({
      modelo: m,
      colores: (porModelo.get(m) ?? []).filter((a) => a.libre > 0 && !codValija.has(a.codigo) && !enPedido.has(a.codigo)),
    })).filter((g) => g.colores.length)
  }, [lineas, porModelo, codValija, stock])

  useEffect(() => { cargarFotos(paraAmpliar.flatMap((g) => g.colores.map((c) => c.codigo))) }, [paraAmpliar]) // eslint-disable-line react-hooks/exhaustive-deps

  const conCant = lineas.filter((l) => l.cantidad > 0)
  const unidades = conCant.reduce((s, l) => s + l.cantidad, 0)
  const importe = conCant.reduce((s, l) => s + l.cantidad * (stock.get(l.codigo)?.precio ?? 0), 0)

  // Promo vigente del modelo, solo si baja lo que pagaría (lista o especial). Igual que Nuevo Pedido.
  function precioExtra(a: Art) {
    const m = a.modelo.trim().toUpperCase()
    const esp = preciosEsp[m]
    const ahora = new Date()
    const p = promos.find((x) => x.modelo === m && (!x.codigo || x.codigo === a.codigo) && ahora >= new Date(x.desde) && ahora < new Date(x.hasta))
    const base = esp ?? (a.precio ? getPrecioLista(a.precio, cliente?.nro_lista ?? 5) : 0)
    if (p && p.precio < base) return { precio_promo: p.precio, promo: p.promo }
    return esp != null ? { precio_esp: esp } : {}
  }

  async function cerrarDirecto(c: Condiciones) {
    if (!cliente) return
    setEnviando(true)
    const items = conCant.map((l) => {
      const a = stock.get(l.codigo)!
      const pendiente = Math.max(0, l.cantidad - a.fisico)
      return { codigo: a.codigo, modelo: a.modelo, descripcion: a.descripcion, cantidad: l.cantidad, ...(pendiente > 0 ? { pendiente } : {}), ...precioExtra(a) }
    })
    const pedidoRow = {
      fecha: new Date().toLocaleString('es-AR'),
      vendedor: yo,
      nro_lista: cliente.nro_lista ?? 5,
      blanco_pct: c.blanco_pct ?? 100,
      negro_pct: c.negro_pct ?? 100 - (c.blanco_pct ?? 100),
      cuotas_detalle: c.cuotas_detalle,
      cod_cliente: cliente.cod,
      cliente: `${cliente.cod} - ${cliente.razon ?? ''}`,
      cond_entrega: c.cond_entrega,
      entrega_canal: c.entrega_canal,
      entrega_pago: c.entrega_pago,
      cond_pago: c.cond_pago,
      medios_pago: c.medios_pago,
      dto_comercial: c.dto_comercial,
      dto_financiero: c.dto_financiero,
      wsp: c.wsp ?? cliente.telefono ?? null,
      mail: c.mail ?? cliente.email ?? null,
      obs: [`🧳 Muestrario RFID · condiciones del pedido #${c.id}`, obs.trim()].filter(Boolean).join(' · '),
      contacto_entrega: c.contacto_entrega,
      direccion_entrega: c.direccion_entrega,
      horario_entrega: c.horario_entrega,
      items,
      total_units: unidades,
      estado: 'pendiente',
    }
    const { data, error } = await supabase.rpc('pedido_guardar', { p_pedido: pedidoRow, p_precarga: null })
    setEnviando(false)
    if (error) {
      if (error.message === 'SIN_STOCK') {
        const falt = JSON.parse(error.details || '[]') as { codigo: string; disponible: number }[]
        for (const f of falt) setCant(f.codigo, f.disponible)
        await cargarStock(cliente.cod)
        toast(`${falt.length === 1 ? '1 artículo ya no alcanza' : `${falt.length} artículos ya no alcanzan`}: ajusté las cantidades a lo que hay. Revisá y generá de nuevo.`, 'error')
        return
      }
      toast('No se pudo confirmar: ' + error.message, 'error'); return
    }
    const r = data as { id: number; items: { cantidad: number; pendiente?: number }[] }
    setCamara(false)
    setHecha({
      id: r.id, confirmado: true, unidades,
      importe, faltantes: [], pendientes: (r.items ?? []).reduce((s, i) => s + (i.pendiente ?? 0), 0),
    })
  }

  async function generar() {
    if (!cliente || !conCant.length) return
    if (cond && !cambiarCond) return cerrarDirecto(cond)
    setEnviando(true)
    const { data, error } = await supabase.rpc('escaneo_precarga_crear', {
      p_cod: cliente.cod,
      p_items: conCant.map((l) => ({ codigo: l.codigo, cantidad: l.cantidad })),
      p_vendedor: yo || null,
      p_obs: ['🧳 Muestrario RFID', obs.trim()].filter(Boolean).join(' · '),
    })
    setEnviando(false)
    if (error) { toast('No se pudo generar: ' + error.message, 'error'); return }
    const r = data as { ok: boolean; error?: string; precarga_id?: number; total_units?: number; importe?: number; faltantes?: { modelo: string; descripcion: string; pedido: number; libre: number }[] }
    if (!r.ok) { toast(r.error === 'sin_stock' ? 'Se quedó sin stock todo lo pedido. Revisá la lista.' : 'No se pudo generar: ' + r.error, 'error'); return }
    setCamara(false)
    setHecha({ id: r.precarga_id!, confirmado: false, unidades: r.total_units!, importe: Number(r.importe), faltantes: r.faltantes ?? [], pendientes: 0 })
  }

  function otraOptica() { setHecha(null); setLineas([]); setObs(''); setCliente(null) }

  // ── Cargar / control ──────────────────────────────────────────────────────
  const [modoCarga, setModoCarga] = useState<'alta' | 'control'>('alta')
  const [pendiente, setPendiente] = useState<string | null>(null) // tag leído que no sé qué SKU es
  const [buscaSku, setBuscaSku] = useState('')
  const [leidos, setLeidos] = useState<Set<string>>(new Set())
  const [desconocidos, setDesconocidos] = useState<string[]>([])

  async function registrar(tag: string, codigo: string) {
    const { error } = await supabase.from('muestrario').upsert({ vendedor: yo, tag, codigo, estado: 'en_valija', ultima_lectura: new Date().toISOString() }, { onConflict: 'vendedor,tag' })
    if (error) { pitido(false); toast('No se pudo registrar: ' + error.message, 'error'); return }
    pitido(true)
    const a = stock.get(codigo)
    toast(`✅ ${a?.modelo ?? codigo} ${a?.descripcion ?? ''} en la valija`, 'success')
    setPendiente(null); setBuscaSku('')
    const ps = await cargarPiezas()
    const modelos = new Set(ps.map((p) => stock.get(p.codigo)?.modelo))
    cargarFotos([...stock.values()].filter((x) => modelos.has(x.modelo)).map((x) => x.codigo))
  }

  handlers.current.cargar = (l) => {
    if (modoCarga === 'control') {
      const p = piezas.find((x) => x.tag === l.tag)
      if (p) { pitido(true); setLeidos((s) => new Set(s).add(p.tag)) }
      else { pitido(false); setDesconocidos((d) => (d.includes(l.tag) ? d : [...d, l.tag])) }
      return
    }
    // Pendiente esperando SKU: la cámara sobre la etiqueta de código de barras completa el alta.
    if (pendiente && (l.via === 'camara' || l.via === 'manual')) {
      const { codigo } = resolver({ ...l, tag: '' })
      if (codigo) { registrar(pendiente, codigo); return }
      setBuscaSku(l.texto ?? l.tag); return
    }
    const { codigo, pieza } = resolver(l)
    if (pieza?.estado === 'en_valija') { pitido(true); const a = stock.get(pieza.codigo); toast(`Ya registrada: ${a?.modelo ?? pieza.codigo} ${a?.descripcion ?? ''}`, 'success'); return }
    if (codigo) { registrar(l.tag, codigo); return }
    pitido(false); setPendiente(l.tag); setBuscaSku('')
  }
  handlers.current.valija = (l) => {
    const { codigo } = resolver(l)
    if (!codigo) { pitido(false); toast(`Etiqueta ${l.tag} sin registrar.`, 'error'); return }
    pitido(true); setFiltro('todas'); setResaltado(codigo)
    setTimeout(() => document.getElementById('pz-' + codigo)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  const candidatosSku = useMemo(() => {
    const q = buscaSku.trim().toUpperCase()
    if (q.length < 2) return []
    return [...stock.values()].filter((a) => a.codigo.toUpperCase().includes(q) || a.modelo.toUpperCase().includes(q) || (a.descripcion ?? '').toUpperCase().includes(q)).slice(0, 12)
  }, [buscaSku, stock])

  async function terminarControl() {
    const leidas = enValija.filter((p) => leidos.has(p.tag))
    const faltan = enValija.filter((p) => !leidos.has(p.tag))
    if (faltan.length && !confirm(`${faltan.length} pieza(s) no aparecieron. ¿Marcarlas como fuera de la valija?`)) return
    const ahora = new Date().toISOString()
    if (leidas.length) await supabase.from('muestrario').update({ ultima_lectura: ahora }).in('id', leidas.map((p) => p.id))
    if (faltan.length) await supabase.from('muestrario').update({ estado: 'fuera' }).in('id', faltan.map((p) => p.id))
    toast(`Control guardado: ${leidas.length} en la valija${faltan.length ? `, ${faltan.length} fuera` : ''}.`, 'success')
    setLeidos(new Set()); setDesconocidos([])
    cargarPiezas()
  }

  async function quitar(p: Pieza) {
    const a = stock.get(p.codigo)
    if (!confirm(`¿Sacar ${a?.modelo ?? p.codigo} ${a?.descripcion ?? ''} de la valija?`)) return
    await supabase.from('muestrario').delete().eq('id', p.id)
    cargarPiezas()
  }

  // ── Mi valija ────────────────────────────────────────────────────────────
  const [filtro, setFiltro] = useState<'todas' | 'sin' | 'poco'>('todas')
  const resumen = useMemo(() => {
    const arts = enValija.map((p) => ({ p, a: stock.get(p.codigo) })).filter((x) => x.a) as { p: Pieza; a: Art }[]
    const sin = arts.filter((x) => x.a.libre <= 0)
    const poco = arts.filter((x) => x.a.libre > 0 && x.a.libre <= POCO)
    const modelosValija = new Set(arts.map((x) => x.a.modelo))
    const coloresFaltan = [...modelosValija].map((m) => ({ modelo: m, colores: (porModelo.get(m) ?? []).filter((a) => a.libre > 0 && !codValija.has(a.codigo)) })).filter((g) => g.colores.length)
    const modelosFaltan = [...porModelo.entries()]
      .filter(([m]) => !modelosValija.has(m))
      .map(([m, as]) => ({ modelo: m, libre: as.reduce((s, a) => s + a.libre, 0), colores: as.filter((a) => a.libre > 0).length, caliente: as.some((a) => a.caliente), demanda: as.reduce((s, a) => s + a.demanda, 0), ej: as.find((a) => a.libre > 0) }))
      .filter((x) => x.libre > 0)
      .sort((a, b) => Number(b.caliente) - Number(a.caliente) || b.demanda - a.demanda || b.libre - a.libre)
      .slice(0, 30)
    const grupos = new Map<string, { p: Pieza; a: Art }[]>()
    for (const x of arts) {
      if (filtro === 'sin' && x.a.libre > 0) continue
      if (filtro === 'poco' && !(x.a.libre > 0 && x.a.libre <= POCO)) continue
      const l = grupos.get(x.a.modelo) ?? []; l.push(x); grupos.set(x.a.modelo, l)
    }
    const sinRegistro = enValija.filter((p) => !stock.has(p.codigo))
    return { arts, sin, poco, modelosValija, coloresFaltan, modelosFaltan, grupos: [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)), sinRegistro, fuera: piezas.filter((p) => p.estado === 'fuera') }
  }, [enValija, piezas, stock, porModelo, codValija, filtro])

  useEffect(() => {
    if (tab === 'valija') cargarFotos([...resumen.coloresFaltan.flatMap((g) => g.colores.map((c) => c.codigo)), ...resumen.modelosFaltan.map((m) => m.ej?.codigo ?? '').filter(Boolean)])
  }, [tab, resumen.coloresFaltan.length, resumen.modelosFaltan.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI ───────────────────────────────────────────────────────────────
  const Estado = ({ a }: { a: Art }) => a.libre <= 0
    ? <span className="text-[10px] font-semibold rounded-full bg-red-100 text-red-700 px-2 py-0.5">sin stock</span>
    : a.libre <= POCO
      ? <span className="text-[10px] font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">quedan {a.libre}</span>
      : <span className="text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">{a.libre} libres</span>

  const Receptor = (
    <div className="rounded-xl border border-black/10 bg-white p-3 space-y-2">
      <div className="flex flex-wrap gap-2 text-xs">
        {lector.nfcSoportado && (
          <button onClick={lector.activarNfc} disabled={lector.nfc === 'escuchando'}
            className={`rounded-full px-3 py-1.5 font-semibold ${lector.nfc === 'escuchando' ? 'bg-emerald-100 text-emerald-800' : 'bg-ink text-white'}`}>
            {lector.nfc === 'escuchando' ? '📶 NFC escuchando: apoyá la pieza' : '📶 Activar NFC'}
          </button>
        )}
        <span className="rounded-full px-3 py-1.5 bg-[#F8F6F0] text-muted">🔫 Lector Bluetooth: gatillá cuando quieras</span>
        <button onClick={() => setCamara((c) => !c)} className="rounded-full px-3 py-1.5 border border-black/10">{camara ? 'Cerrar cámara' : '📷 Cámara'}</button>
      </div>
      {lector.errorNfc && <p className="text-[11px] text-red-700">{lector.errorNfc}</p>}
      {camara && <LectorCamara onCodigo={(c) => lector.emitir({ tag: c, texto: c, via: 'camara' })} onCerrar={() => setCamara(false)} />}
      <form onSubmit={leerManual} className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…o escribí la etiqueta o el código"
          className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
        <button className="rounded-lg border border-black/10 px-3 text-sm">Leer</button>
      </form>
    </div>
  )

  if (hecha) {
    return (
      <div className="max-w-md mx-auto space-y-3 text-ink">
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-50 p-4 space-y-1">
          <p className="text-lg font-semibold text-emerald-800">{hecha.confirmado ? `✅ Pedido #${hecha.id} confirmado` : `✅ Pedido #P${hecha.id} generado`}</p>
          <p className="text-sm">{cliente?.razon} · {hecha.unidades} u. · {formatPrecio(hecha.importe)} de lista</p>
          <p className="text-xs text-muted">
            {hecha.confirmado
              ? `Ya está en Pedidos con las condiciones de siempre de la óptica.${hecha.pendientes ? ` ${hecha.pendientes} u. quedan pendientes de producción.` : ''}`
              : 'El stock quedó reservado. Falta confirmar condiciones (lista, pago, entrega).'}
          </p>
        </div>
        {hecha.faltantes.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-xs space-y-1">
            <p className="font-semibold">Se ajustó por stock:</p>
            {hecha.faltantes.map((f, i) => <p key={i}>• {f.modelo} {f.descripcion}: pediste {f.pedido}, había {f.libre}</p>)}
          </div>
        )}
        <div className="flex gap-2">
          {hecha.confirmado
            ? <Link to="/pedidos" className="flex-1 text-center rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold">Ver en Pedidos</Link>
            : <button onClick={() => navigate('/pedidos/nuevo', { state: { cliente, precargaId: hecha.id } })}
                className="flex-1 rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold">Confirmar condiciones</button>}
          <button onClick={otraOptica} className="flex-1 rounded-lg border border-black/10 py-2.5 text-sm">Otra óptica</button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-3 text-ink pb-28">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">🧳 Muestrario RFID</h2>
        <Link to="/pedidos" className="text-xs text-muted underline">Pedidos</Link>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/5 p-1 text-xs font-semibold">
        {([['pedido', 'Tomar pedido'], ['valija', `Mi valija (${enValija.length})`], ['cargar', 'Cargar / control']] as [Tab, string][]).map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg py-2 ${tab === k ? 'bg-white shadow-sm' : 'text-muted'}`}>{t}</button>
        ))}
      </div>

      {cargando && <p className="text-sm text-muted">Cargando valija y stock…</p>}
      {!cargando && !yo && <p className="text-sm text-red-700">No sé de qué vendedor es la valija (entrá con tu usuario de vendedor).</p>}

      {/* ─── TOMAR PEDIDO ─── */}
      {!cargando && tab === 'pedido' && (
        <>
          {cliente ? (
            <div className="flex items-center justify-between rounded-lg border border-black/10 bg-white px-3 py-2 text-sm">
              <span><b>{cliente.cod}</b> · {cliente.razon}</span>
              <button onClick={() => { setCliente(null); setLineas([]) }} className="text-xs text-muted underline">cambiar</button>
            </div>
          ) : (
            <div className="space-y-1">
              <input autoFocus placeholder="¿En qué óptica estás? Código o nombre…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2.5 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
              {sugerencias.map((c) => (
                <button key={c.cod} onClick={() => { setCliente(c); setBusqueda('') }}
                  className="w-full text-left rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-brand/40">
                  <b>{c.cod}</b> · {c.razon} <span className="text-faint">({c.localidad || ''})</span>
                </button>
              ))}
            </div>
          )}

          {cliente && (
            <>
              {Receptor}
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Cada pieza leída entra con</span>
                {[1, 2, 3, 6].map((n) => (
                  <button key={n} onClick={() => setCantDefault(n)} className={`w-8 h-7 rounded-md border ${cantDefault === n ? 'bg-ink text-white border-ink' : 'border-black/10 bg-white'}`}>{n}</button>
                ))}
                <span>u.</span>
              </div>

              {!lineas.length && (
                <p className="rounded-xl border border-dashed border-black/15 p-4 text-sm text-muted text-center">
                  Separá las piezas que eligió la óptica y pasalas por el teléfono (o gatillá el lector). Solo vas a poner cantidades.
                </p>
              )}

              {lineas.length > 0 && (
                <div className="rounded-xl border border-black/10 bg-white divide-y divide-black/5">
                  {lineas.map((l) => {
                    const a = stock.get(l.codigo)!
                    const otros = a.libre <= 0 ? (porModelo.get(a.modelo) ?? []).filter((x) => x.libre > 0 && !lineas.some((y) => y.codigo === x.codigo)) : []
                    return (
                      <div key={l.codigo} className={`px-3 py-2 transition-colors ${resaltado === l.codigo ? 'bg-emerald-50' : ''}`}>
                        <div className="flex items-center gap-2">
                          <FotoProd src={fotos[l.codigo]} alt={a.modelo} className="w-12 h-12 rounded-md shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate"><b>{a.modelo}</b> {a.descripcion}</p>
                            <p className="text-[11px] text-faint flex items-center gap-1.5 flex-wrap">
                              {formatPrecio(a.precio)} <Estado a={a} />
                              {l.origen === 'ampliar' && <span className="text-[10px] text-sky-700">fuera de valija</span>}
                            </p>
                          </div>
                          <input ref={(el) => { qtyRefs.current[l.codigo] = el }} type="number" inputMode="numeric" min={0} max={a.libre}
                            value={l.cantidad || ''} disabled={a.libre <= 0} placeholder="0"
                            onChange={(e) => setCant(l.codigo, parseInt(e.target.value, 10))}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-16 h-10 text-center text-base font-semibold rounded-lg border border-black/15 focus:outline-none focus:border-brand disabled:bg-black/5" />
                          <button onClick={() => setLineas((p) => p.filter((x) => x.codigo !== l.codigo))} className="text-faint text-sm px-1" aria-label="Quitar">✕</button>
                        </div>
                        {otros.length > 0 && (
                          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                            <span className="text-[11px] text-muted self-center shrink-0">Hay en:</span>
                            {otros.map((x) => (
                              <button key={x.codigo} onClick={() => sumar(x.codigo, codValija.has(x.codigo) ? 'valija' : 'ampliar')}
                                className="shrink-0 rounded-full border border-emerald-600/40 bg-emerald-50 px-2.5 py-1 text-[11px]">
                                + {x.descripcion || x.codigo} <span className="text-muted">({x.libre})</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {paraAmpliar.length > 0 && (
                <div className="rounded-xl border border-sky-600/20 bg-sky-50/60 p-3 space-y-2">
                  <p className="text-sm font-semibold">➕ Ampliá el pedido: colores que no están en tu valija</p>
                  {paraAmpliar.map((g) => (
                    <div key={g.modelo}>
                      <p className="text-[11px] text-muted mb-1">{g.modelo}</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {g.colores.map((c) => (
                          <button key={c.codigo} onClick={() => { sumar(c.codigo, 'ampliar'); pitido(true) }}
                            className="shrink-0 w-24 rounded-lg bg-white border border-black/10 p-1 text-left">
                            <FotoProd src={fotos[c.codigo]} alt={c.modelo} className="w-full aspect-square rounded-md" />
                            <p className="text-[11px] mt-1 truncate">{c.descripcion || c.codigo}</p>
                            <p className="text-[10px] text-muted">{c.libre} libres · + agregar</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {lineas.length > 0 && (
                <>
                  <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observación (opcional)"
                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-brand" />
                  {cond && !cambiarCond ? (
                    <div className="rounded-xl border border-black/10 bg-[#F8F6F0] p-3 text-xs space-y-0.5">
                      <div className="flex justify-between gap-2">
                        <p className="font-semibold">Se confirma directo con las condiciones del pedido #{cond.id}</p>
                        <button onClick={() => setCambiarCond(true)} className="text-muted underline whitespace-nowrap">cambiar</button>
                      </div>
                      <p className="text-muted">{cond.cond_pago}</p>
                      <p className="text-muted">{cond.cond_entrega}{cond.dto_comercial && Number(cond.dto_comercial) > 0 ? ` · Dto. comercial ${cond.dto_comercial}%` : ''}</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted">
                      {cambiarCond ? 'Se genera reservado y elegís las condiciones en Nuevo Pedido.' : 'Esta óptica no tiene un pedido anterior con condiciones: se genera reservado y las elegís una sola vez en Nuevo Pedido.'}
                      {cambiarCond && cond && <button onClick={() => setCambiarCond(false)} className="ml-1 underline">usar las del #{cond.id}</button>}
                    </p>
                  )}
                  <div className="fixed bottom-16 inset-x-0 px-3 z-20">
                    <button onClick={generar} disabled={enviando || !unidades}
                      className="w-full max-w-md mx-auto block rounded-xl bg-emerald-600 text-white py-3.5 text-base font-semibold shadow-lg disabled:opacity-60">
                      {enviando ? 'Generando…' : unidades ? `${cond && !cambiarCond ? 'Confirmar pedido' : 'Generar pedido'} · ${unidades} u. · ${formatPrecio(importe)}` : 'Poné las cantidades'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ─── MI VALIJA ─── */}
      {!cargando && tab === 'valija' && (
        <>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              ['Piezas', enValija.length, 'todas'],
              ['Modelos', resumen.modelosValija.size, 'todas'],
              ['Sin stock', resumen.sin.length, 'sin'],
              ['Poco stock', resumen.poco.length, 'poco'],
            ].map(([t, n, f]) => (
              <button key={t as string} onClick={() => setFiltro(f as typeof filtro)}
                className={`rounded-xl border bg-white p-2 ${filtro === f && f !== 'todas' ? 'border-brand' : 'border-black/10'}`}>
                <p className={`text-lg font-semibold ${t === 'Sin stock' && n ? 'text-red-700' : t === 'Poco stock' && n ? 'text-amber-700' : ''}`}>{n as number}</p>
                <p className="text-[10px] text-muted">{t as string}</p>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint">Stock libre en línea (físico + producción − reservado). Leé una pieza para encontrarla en la lista.</p>

          {resumen.sin.length > 0 && filtro === 'todas' && (
            <div className="rounded-xl border border-red-600/30 bg-red-50 p-3 text-xs">
              <p className="font-semibold text-red-800 mb-1">❌ No las ofrezcas: sin stock ({resumen.sin.length})</p>
              <p className="text-red-900/80">{resumen.sin.map((x) => `${x.a.modelo} ${x.a.descripcion ?? ''}`.trim()).join(' · ')}</p>
            </div>
          )}

          {!enValija.length && <p className="rounded-xl border border-dashed border-black/15 p-4 text-sm text-muted text-center">Tu valija está vacía. Cargá las etiquetas en "Cargar / control".</p>}

          {resumen.grupos.map(([modelo, xs]) => (
            <div key={modelo} className="rounded-xl border border-black/10 bg-white">
              <p className="px-3 pt-2 text-xs font-semibold">{modelo} <span className="text-faint font-normal">· {xs.length} en valija de {(porModelo.get(modelo) ?? []).length} colores</span></p>
              <div className="divide-y divide-black/5">
                {xs.map(({ p, a }) => (
                  <div id={'pz-' + a.codigo} key={p.id} className={`flex items-center gap-2 px-3 py-2 ${resaltado === a.codigo ? 'bg-emerald-50' : ''}`}>
                    <FotoProd src={fotos[a.codigo]} alt={a.modelo} className="w-10 h-10 rounded-md shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{a.descripcion || a.codigo}</p>
                      <p className="text-[10px] text-faint">{a.codigo} · {formatPrecio(a.precio)}</p>
                    </div>
                    <Estado a={a} />
                    <button onClick={() => quitar(p)} className="text-faint text-xs px-1" aria-label="Sacar de la valija">✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {filtro === 'todas' && resumen.coloresFaltan.length > 0 && (
            <div className="rounded-xl border border-sky-600/20 bg-sky-50/60 p-3 space-y-2">
              <p className="text-sm font-semibold">🎨 Colores con stock que le faltan a tu valija</p>
              {resumen.coloresFaltan.map((g) => (
                <div key={g.modelo}>
                  <p className="text-[11px] text-muted mb-1">{g.modelo}</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {g.colores.map((c) => (
                      <div key={c.codigo} className="shrink-0 w-20 rounded-lg bg-white border border-black/10 p-1">
                        <FotoProd src={fotos[c.codigo]} alt={c.modelo} className="w-full aspect-square rounded-md" />
                        <p className="text-[10px] mt-1 truncate">{c.descripcion || c.codigo}</p>
                        <p className="text-[10px] text-muted">{c.libre} libres</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filtro === 'todas' && resumen.modelosFaltan.length > 0 && (
            <div className="rounded-xl border border-black/10 bg-white p-3 space-y-1">
              <p className="text-sm font-semibold">🧩 Modelos con stock que no llevás</p>
              <p className="text-[11px] text-faint mb-1">Primero los calientes y los de más demanda.</p>
              {resumen.modelosFaltan.map((m) => (
                <div key={m.modelo} className="flex items-center gap-2 py-1">
                  <FotoProd src={m.ej ? fotos[m.ej.codigo] : null} alt={m.modelo} className="w-9 h-9 rounded-md shrink-0" />
                  <p className="flex-1 text-sm truncate">{m.caliente && '🔥 '}<b>{m.modelo}</b></p>
                  <span className="text-[11px] text-muted whitespace-nowrap">{m.colores} colores · {m.libre} u.</span>
                </div>
              ))}
            </div>
          )}

          {filtro === 'todas' && (resumen.fuera.length > 0 || resumen.sinRegistro.length > 0) && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-xs space-y-1">
              {resumen.fuera.length > 0 && <p><b>{resumen.fuera.length} fuera de la valija</b> (no aparecieron en el último control): {resumen.fuera.map((p) => { const a = stock.get(p.codigo); return `${a?.modelo ?? p.codigo} ${a?.descripcion ?? ''}`.trim() }).join(' · ')}. Al volver a leerlas en "Cargar" vuelven a la valija.</p>}
              {resumen.sinRegistro.length > 0 && <p><b>{resumen.sinRegistro.length} pieza(s) con SKU que ya no está en stock:</b> {resumen.sinRegistro.map((p) => p.codigo).join(', ')}.</p>}
            </div>
          )}
        </>
      )}

      {/* ─── CARGAR / CONTROL ─── */}
      {!cargando && tab === 'cargar' && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 text-xs font-semibold">
            <button onClick={() => setModoCarga('alta')} className={`rounded-lg py-2 ${modoCarga === 'alta' ? 'bg-white shadow-sm' : 'text-muted'}`}>Alta de piezas</button>
            <button onClick={() => { setModoCarga('control'); setPendiente(null) }} className={`rounded-lg py-2 ${modoCarga === 'control' ? 'bg-white shadow-sm' : 'text-muted'}`}>Control de valija</button>
          </div>
          <p className="text-[11px] text-muted">
            {modoCarga === 'alta'
              ? 'Leé cada etiqueta. Si trae grabado el código del anteojo entra sola; si no, te pregunto qué anteojo es (escaneá el código de barras o buscalo).'
              : 'Leé toda la valija. Te muestro qué piezas no aparecieron y qué etiquetas no son tuyas.'}
          </p>
          {Receptor}

          {modoCarga === 'alta' && pendiente && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-50 p-3 space-y-2">
              <div className="flex justify-between gap-2">
                <p className="text-sm">Etiqueta nueva <b className="font-mono text-xs">{pendiente}</b>: ¿qué anteojo es?</p>
                <button onClick={() => setPendiente(null)} className="text-xs text-muted">✕</button>
              </div>
              <input autoFocus value={buscaSku} onChange={(e) => setBuscaSku(e.target.value)} placeholder="Modelo, color o código…"
                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
              {candidatosSku.map((a) => (
                <button key={a.codigo} onClick={() => registrar(pendiente, a.codigo)}
                  className="w-full text-left rounded-lg bg-white border border-black/10 px-3 py-2 text-sm flex justify-between gap-2">
                  <span><b>{a.modelo}</b> {a.descripcion}</span><span className="text-[11px] text-faint">{a.codigo}</span>
                </button>
              ))}
            </div>
          )}

          {modoCarga === 'control' && (
            <div className="rounded-xl border border-black/10 bg-white p-3 space-y-2">
              <p className="text-sm"><b>{enValija.filter((p) => leidos.has(p.tag)).length}</b> de {enValija.length} piezas leídas</p>
              <div className="h-2 rounded-full bg-black/5 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${enValija.length ? (100 * enValija.filter((p) => leidos.has(p.tag)).length) / enValija.length : 0}%` }} />
              </div>
              {leidos.size > 0 && (
                <>
                  <p className="text-xs font-semibold pt-1">Faltan:</p>
                  <div className="text-xs text-muted max-h-48 overflow-y-auto space-y-0.5">
                    {enValija.filter((p) => !leidos.has(p.tag)).map((p) => { const a = stock.get(p.codigo); return <p key={p.id}>• {a?.modelo ?? p.codigo} {a?.descripcion ?? ''}</p> })}
                  </div>
                </>
              )}
              {desconocidos.length > 0 && <p className="text-xs text-amber-800">⚠️ {desconocidos.length} etiqueta(s) que no están en tu valija: pasá a "Alta" para registrarlas.</p>}
              <div className="flex gap-2">
                <button onClick={terminarControl} disabled={!leidos.size} className="flex-1 rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50">Terminar control</button>
                <button onClick={() => { setLeidos(new Set()); setDesconocidos([]) }} className="rounded-lg border border-black/10 px-3 text-sm">Reiniciar</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
