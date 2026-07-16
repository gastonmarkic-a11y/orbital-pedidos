import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente, StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { fetchPaged } from '../../lib/fetchAll'
import { COND_ENTREGA, qtyClass } from './calc'

interface Cuota {
  dias: number
  pct: number
}

export default function NuevoPedido() {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()
  const location = useLocation()

  const [stock, setStock] = useState<StockItem[]>([])
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [sugerencias, setSugerencias] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(location.state?.cliente ?? null)
  const [busquedaStock, setBusquedaStock] = useState('')
  const [filtroModelo, setFiltroModelo] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroClasif, setFiltroClasif] = useState('')
  const [filtroTratam, setFiltroTratam] = useState('')
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [cart, setCart] = useState<Record<string, number>>({})
  const [condEntrega, setCondEntrega] = useState('')
  const [dtoFinanciero, setDtoFinanciero] = useState('')
  const [dtoComercial, setDtoComercial] = useState('')
  const [blancoPct, setBlancoPct] = useState(100)
  const [cuotas, setCuotas] = useState<Cuota[]>([{ dias: 0, pct: 100 }])
  const [wsp, setWsp] = useState('')
  const [mail, setMail] = useState('')
  const [obs, setObs] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [cdEditando, setCdEditando] = useState(false)
  const [cd, setCd] = useState({ direccion: '', telefono: '', email: '', contacto: '', horario: '' })
  const [cdSaving, setCdSaving] = useState(false)

  async function loadStock() {
    const data = await fetchPaged<StockItem>(() => supabase.from('stock').select('*').order('modelo'))
    setStock(data)
  }

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

  // Cliente preseleccionado desde Cartera / Agenda
  useEffect(() => {
    const c = location.state?.cliente as Cliente | undefined
    if (c) {
      setCliente(c)
      if (c.email) setMail(c.email)
      if (c.telefono) setWsp(c.telefono)
    }
  }, [location.state])

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
      return matchQ && matchM && matchTipo && matchClasif && matchTratam && p.cantidad > 0
    })
  }, [stock, busquedaStock, filtroModelo, filtroTipo, filtroClasif, filtroTratam])

  // Opciones de los filtros: solo de artículos con stock, y respetando los otros filtros ya elegidos (combinables)
  const conStock = useMemo(() => stock.filter((p) => p.cantidad > 0), [stock])
  const opciones = (campo: 'modelo' | 'tipo' | 'clasificacion' | 'tratamiento') =>
    [...new Set(conStock.map((p) => (p[campo] || '').trim()).filter(Boolean))].sort()
  const modelos = useMemo(() => opciones('modelo'), [conStock])
  const tipos = useMemo(() => opciones('tipo'), [conStock])
  const clasificaciones = useMemo(() => opciones('clasificacion'), [conStock])
  const tratamientos = useMemo(() => opciones('tratamiento'), [conStock])
  const grupos = useMemo(() => {
    const g: Record<string, StockItem[]> = {}
    for (const p of stockFiltrado) (g[p.modelo] = g[p.modelo] || []).push(p)
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
    if (inCart >= p.cantidad) {
      toast('Sin stock suficiente', 'error')
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
    } else if (nuevo > p.cantidad) {
      toast('Sin stock suficiente', 'error')
    } else {
      setCart({ ...cart, [codigo]: nuevo })
    }
  }

  const cartKeys = Object.keys(cart).filter((k) => cart[k] > 0)
  const totalUnidades = cartKeys.reduce((a, k) => a + cart[k], 0)
  const totalCuotas = cuotas.reduce((a, c) => a + (c.pct || 0), 0)

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
    if (!condEntrega) {
      toast('Seleccioná una condición de entrega', 'error')
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
      // Verificar stock actual
      const fresh = await fetchPaged<StockItem>(() => supabase.from('stock').select('*'))
      for (const k of cartKeys) {
        const p = fresh.find((x) => x.codigo === k)
        if (!p || p.cantidad < cart[k]) {
          toast(`Sin stock suficiente de ${p ? p.modelo : k}. Stock actual: ${p ? p.cantidad : 0}`, 'error')
          setStock(fresh)
          setConfirmando(false)
          return
        }
      }

      const items = cartKeys.map((k) => {
        const p = fresh.find((x) => x.codigo === k)!
        return { codigo: k, modelo: p.modelo, descripcion: p.descripcion, cantidad: cart[k] }
      })

      const negroPct = 100 - blancoPct
      let pagoLabel = getCuotasLabel() + (blancoPct < 100 ? ` | Blanco:${blancoPct}% Negro:${negroPct}%` : '')
      if (dtoFinanciero && parseFloat(dtoFinanciero) > 0) pagoLabel += ` | Dto. financiero: ${dtoFinanciero}%`
      if (dtoComercial && parseFloat(dtoComercial) > 0) pagoLabel += ` | Dto. comercial: ${dtoComercial}%`

      // Descontar stock
      for (const item of items) {
        const p = fresh.find((x) => x.codigo === item.codigo)!
        await supabase
          .from('stock')
          .update({ cantidad: p.cantidad - item.cantidad, updated_at: new Date().toISOString() })
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
        cond_entrega: condEntrega,
        cond_pago: pagoLabel,
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
      setCliente(null)
      setCondEntrega('')
      setDtoFinanciero('')
      setDtoComercial('')
      setBlancoPct(100)
      setCuotas([{ dias: 0, pct: 100 }])
      setWsp('')
      setMail('')
      setObs('')
      toast(`✓ Pedido confirmado — ${totalUnidades} unidades para ${cliente.razon}`, 'success')
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
                return (
                  <div key={modelo} className="border border-black/10 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleModelo(modelo)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-[#F1EDE4] text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span>{abierto ? '▾' : '▸'}</span>
                        <span className="font-semibold">{modelo}</span>
                        <span className="text-xs text-faint">
                          {items.length} color{items.length !== 1 ? 'es' : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {enCarrito > 0 && <span className="text-xs text-brandDark font-medium">{enCarrito} en pedido</span>}
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
                          return (
                            <div key={p.codigo} className="flex items-center justify-between px-3 py-2 gap-2">
                              <div className="min-w-0">
                                <p className="text-sm truncate">{p.descripcion || '—'}</p>
                                <p className="text-[10px] text-faint font-mono">{p.codigo}</p>
                                {(p.precio ?? 0) > 0 && (
                                  <p className="text-xs text-gold font-semibold">{formatPrecio(p.precio)}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${qtyClass(disp)}`}>
                                  {disp}
                                </span>
                                {inCart > 0 ? (
                                  <span className="flex items-center gap-1">
                                    <button
                                      onClick={() => changeQty(p.codigo, -1)}
                                      className="w-7 h-7 rounded border border-black/10 text-sm"
                                    >
                                      −
                                    </button>
                                    <span className="w-6 text-center text-sm font-semibold">{inCart}</span>
                                    <button
                                      onClick={() => changeQty(p.codigo, 1)}
                                      disabled={disp <= 0}
                                      className="w-7 h-7 rounded border border-black/10 text-sm disabled:opacity-30"
                                    >
                                      +
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => addToCart(p.codigo)}
                                    disabled={disp <= 0}
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
          </div>

          <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Condiciones</p>
            <label className="block text-xs text-muted">
              Condición de entrega
              <select
                value={condEntrega}
                onChange={(e) => setCondEntrega(e.target.value)}
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— Seleccioná —</option>
                {COND_ENTREGA.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <p className="text-xs text-muted mb-1">
                Cuotas de pago{' '}
                <span className={Math.abs(totalCuotas - 100) < 0.5 ? 'text-emerald-600' : 'text-red-600'}>
                  ({Math.round(totalCuotas)}%)
                </span>
              </p>
              <div className="space-y-1.5">
                {cuotas.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={c.dias}
                      min={0}
                      max={210}
                      onChange={(e) =>
                        setCuotas(cuotas.map((x, j) => (j === i ? { ...x, dias: parseFloat(e.target.value) || 0 } : x)))
                      }
                      className="w-16 border border-black/10 rounded-md px-2 py-1.5 text-xs"
                    />
                    <span className="text-[11px] text-faint">días</span>
                    <input
                      type="number"
                      value={c.pct}
                      min={0}
                      max={100}
                      step={0.1}
                      onChange={(e) =>
                        setCuotas(cuotas.map((x, j) => (j === i ? { ...x, pct: parseFloat(e.target.value) || 0 } : x)))
                      }
                      className="w-16 border border-black/10 rounded-md px-2 py-1.5 text-xs"
                    />
                    <span className="text-[11px] text-faint">%</span>
                    {cuotas.length > 1 && (
                      <button onClick={() => setCuotas(cuotas.filter((_, j) => j !== i))} className="text-red-600 px-1">
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setCuotas([...cuotas, { dias: 30, pct: 0 }])}
                className="mt-1.5 text-xs text-brandDark font-medium"
              >
                + Agregar cuota
              </button>
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
