import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { excelTangoMB, remitoPdfMB } from './marcaBlancaDocs'

// ── Pedidos de marca blanca ──
// Los cierra el cliente desde la app pública ver.orbitaleyewear.com.ar/marca-blanca
// (edge function marca-blanca-pedido → tabla marca_blanca_pedidos + logo en el bucket
// marca-blanca-logos). No tienen SKU ni tocan stock: son producción a pedido con el logo del cliente.

interface Item {
  modelo: string; ref: string; color: string; cristal: string; logo: string
  cantidad: number; unit_usd: number; total_usd: number
  detalle?: string // desde v3: cristal del cliente + logo + packaging elegido
  terminacion?: string
}
interface Pedido {
  id: number; created_at: string; estado: string; marca: string; razon_social: string
  email: string; telefono: string; logo_path: string | null; logo_nombre: string | null
  cuenta: 'brubank' | 'plenorius' // 'brubank' = valor interno de efectivo / sin IVA
  items: Item[]; unidades: number
  subtotal_usd: number; iva_usd: number; total_usd: number
  dolar: number | null; dolar_fecha: string | null; total_ars: number | null
  obs: string | null; nota_interna: string | null
  // Administración: link privado de pago del cliente, comprobantes que sube y factura/remito que sube Orbital
  pago_token: string; adelanto_comp_path: string | null; adelanto_comp_at: string | null
  saldo_comp_path: string | null; saldo_comp_at: string | null
  doc_tipo: 'factura' | 'remito' | null; doc_path: string | null; doc_at: string | null
  cod_cliente_tango: string | null; exportado_tango_at: string | null
}
interface OrdenMB { id: number; estado: string; marca_blanca_id: number; fecha_entrega_estimada: string | null }

const ESTADOS = [
  { k: 'precarga', label: 'Precarga', cls: 'bg-blue-100 text-blue-700' },
  { k: 'confirmado', label: 'Confirmado (adelanto)', cls: 'bg-amber-100 text-amber-700' },
  { k: 'en_produccion', label: 'En producción', cls: 'bg-violet-100 text-violet-700' },
  { k: 'entregado', label: 'Entregado', cls: 'bg-emerald-100 text-emerald-700' },
  { k: 'anulado', label: 'Anulado', cls: 'bg-neutral-200 text-neutral-600' },
]
const SIGUIENTE: Record<string, string> = { precarga: 'confirmado', confirmado: 'en_produccion', en_produccion: 'entregado' }
const estadoInfo = (e: string) => ESTADOS.find((x) => x.k === e) ?? ESTADOS[0]
const usd = (n: number) => 'USD ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ars = (n: number) => '$ ' + Math.round(n).toLocaleString('es-AR')
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const esImagen = (n: string | null) => !!n && /\.(png|jpe?g|webp|svg)$/i.test(n)

export default function MarcaBlancaPedidos() {
  const toast = useToast()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<string>('abiertos')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [logos, setLogos] = useState<Record<number, string>>({})
  const [notas, setNotas] = useState<Record<number, string>>({})
  const [guardando, setGuardando] = useState<number | null>(null)
  const [dolarHoy, setDolarHoy] = useState<number | null>(null)
  const [ordenes, setOrdenes] = useState<Record<number, OrdenMB>>({})

  async function cargar() {
    const { data, error } = await supabase.from('marca_blanca_pedidos').select('*').order('created_at', { ascending: false })
    if (error) toast('No se pudieron cargar los pedidos de marca blanca', 'error')
    setPedidos((data ?? []) as Pedido[])
    // Orden de producción que genera la base al aprobar el adelanto (trigger mb_orden_produccion)
    const { data: ords } = await supabase.from('pedidos_produccion').select('id, estado, marca_blanca_id, fecha_entrega_estimada')
      .not('marca_blanca_id', 'is', null).neq('estado', 'anulado')
    setOrdenes(Object.fromEntries(((ords ?? []) as OrdenMB[]).map((o) => [o.marca_blanca_id, o])))
    setLoading(false)
  }
  useEffect(() => {
    cargar()
    fetch('https://dolarapi.com/v1/dolares/oficial').then((r) => r.json()).then((j) => j?.venta > 0 && setDolarHoy(Number(j.venta))).catch(() => {})
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { abiertos: 0, todos: pedidos.length }
    for (const p of pedidos) {
      c[p.estado] = (c[p.estado] ?? 0) + 1
      if (p.estado !== 'entregado' && p.estado !== 'anulado') c.abiertos++
    }
    return c
  }, [pedidos])
  const visibles = useMemo(() => pedidos.filter((p) =>
    filtro === 'todos' ? true : filtro === 'abiertos' ? p.estado !== 'entregado' && p.estado !== 'anulado' : p.estado === filtro,
  ), [pedidos, filtro])

  async function abrir(p: Pedido) {
    if (abierto === p.id) { setAbierto(null); return }
    setAbierto(p.id)
    if (p.logo_path && !logos[p.id]) {
      const { data } = await supabase.storage.from('marca-blanca-logos').createSignedUrl(p.logo_path, 3600)
      if (data?.signedUrl) setLogos((m) => ({ ...m, [p.id]: data.signedUrl }))
    }
  }

  async function actualizar(p: Pedido, cambios: Partial<Pedido>, msg: string) {
    setGuardando(p.id)
    const { error } = await supabase.from('marca_blanca_pedidos').update(cambios).eq('id', p.id)
    setGuardando(null)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast(msg, 'success')
    setPedidos((ps) => ps.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)))
  }

  // Abre un archivo privado del bucket con URL firmada (la ventana se abre antes para que no la bloquee el navegador).
  async function verArchivo(path: string) {
    const w = window.open('', '_blank')
    const { data } = await supabase.storage.from('marca-blanca-logos').createSignedUrl(path, 3600)
    if (data?.signedUrl && w) w.location.href = data.signedUrl
    else { w?.close(); toast('No se pudo abrir el archivo', 'error') }
  }

  // Factura si paga a Plenorius; remito si es efectivo / sin IVA.
  async function subirDoc(p: Pedido, file: Blob, nombre: string) {
    const tipo = p.cuenta === 'plenorius' ? 'factura' : 'remito'
    setGuardando(p.id)
    const path = `documentos/${p.id}/${tipo}-${Date.now()}-${nombre.replace(/[^\w.\-]+/g, '_')}`
    const { error } = await supabase.storage.from('marca-blanca-logos').upload(path, file, { contentType: file.type || undefined })
    setGuardando(null)
    if (error) { toast('No se pudo subir: ' + error.message, 'error'); return }
    await actualizar(p, { doc_tipo: tipo, doc_path: path, doc_at: new Date().toISOString() }, `${tipo === 'factura' ? 'Factura' : 'Remito'} cargado · el cliente lo ve en su link`)
  }

  // Sin IVA (efectivo): remito PDF armado acá con los datos del pedido.
  async function generarRemito(p: Pedido) {
    try {
      const blob = await remitoPdfMB(p)
      await subirDoc(p, blob, `remito-MB${p.id}.pdf`)
    } catch (e) { toast('No se pudo generar el remito: ' + (e as Error).message, 'error') }
  }

  // Con IVA (Plenorius): Excel de Novedades para Tango, precio en pesos neto de IVA al dólar de hoy.
  async function exportarTango(p: Pedido) {
    const dolar = dolarHoy ?? p.dolar
    if (!dolar) { toast('No hay dólar del día para pasar a pesos', 'error'); return }
    const codCliente = (window.prompt(`Código de cliente en Tango para ${p.razon_social} (si no existe, darlo de alta en Tango primero):`, p.cod_cliente_tango ?? '') || '').trim()
    if (!codCliente) return
    const codArticulo = (window.prompt('Código de artículo genérico de marca blanca en Tango:', localStorage.getItem('tango_art_mb') || 'MARCABLANCA') || '').trim()
    if (!codArticulo) return
    localStorage.setItem('tango_art_mb', codArticulo)
    const codModelo = localStorage.getItem('tango_modelo') || 'WEB'
    try {
      await excelTangoMB(p, { codCliente, codArticulo, codModelo, dolar })
      await actualizar(p, { cod_cliente_tango: codCliente, exportado_tango_at: new Date().toISOString() },
        `Excel para Tango descargado (dólar ${ars(dolar)}) · facturá en Tango y subí la factura acá`)
    } catch (e) { toast('No se pudo armar el Excel: ' + (e as Error).message, 'error') }
  }

  async function avanzar(p: Pedido, sig: string) {
    if (sig === 'confirmado' && !window.confirm(`¿El adelanto de #${p.id} está cobrado?
Se genera sola la orden de producción (pendiente en Producción → Órdenes).`)) return
    await actualizar(p, { estado: sig }, sig === 'confirmado' ? `#${p.id} confirmado · orden de producción generada` : `#${p.id} → ${estadoInfo(sig).label}`)
    if (sig === 'confirmado') cargar()
    // Sin IVA: al entregar sale el remito solo si todavía no hay uno.
    if (sig === 'entregado' && p.cuenta === 'brubank' && !p.doc_path) generarRemito(p)
  }

  const linkPago = (p: Pedido) => `https://ver.orbitaleyewear.com.ar/marca-blanca?pago=${p.id}.${p.pago_token}`

  function whatsapp(tel: string) {
    let d = tel.replace(/\D/g, '')
    if (d.startsWith('0')) d = d.slice(1)
    if (!d.startsWith('54')) d = '549' + d
    return `https://wa.me/${d}`
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando pedidos de marca blanca…</p>

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">🏷️ Marca blanca</h2>
          <p className="text-xs text-muted">Pedidos que cierran los clientes en ver.orbitaleyewear.com.ar/marca-blanca</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="https://ver.orbitaleyewear.com.ar/marca-blanca" target="_blank" rel="noreferrer" className="text-xs text-brandDark font-medium">Abrir la app ↗</a>
          <button onClick={cargar} className="text-xs text-brandDark font-medium">Actualizar</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[{ k: 'abiertos', label: 'Abiertos' }, ...ESTADOS.map((e) => ({ k: e.k, label: e.label })), { k: 'todos', label: 'Todos' }].map((t) => (
          <button key={t.k} onClick={() => setFiltro(t.k)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${filtro === t.k ? 'bg-brand text-white border-transparent' : 'bg-white border-black/10 text-muted'}`}>
            {t.label} <span className="opacity-70">{counts[t.k] ?? 0}</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-muted text-center py-16">No hay pedidos acá.</p>
      ) : (
        <div className="space-y-2">
          {visibles.map((p) => {
            const info = estadoInfo(p.estado)
            const open = abierto === p.id
            const sig = SIGUIENTE[p.estado]
            const arsHoy = dolarHoy ? p.total_usd * dolarHoy : null
            return (
              <div key={p.id} className="bg-white rounded-xl border border-black/10 overflow-hidden">
                <button onClick={() => abrir(p)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">#{p.id} · {p.marca} <span className="text-muted font-normal">· {p.razon_social}</span></p>
                    <p className="text-xs text-muted truncate">{fecha(p.created_at)} · {p.unidades} u · <b>{usd(p.total_usd)}</b>{p.cuenta === 'plenorius' ? ' (con IVA)' : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!p.logo_path && <span title="No adjuntó logo" className="text-[10px]">⚠️</span>}
                    {p.adelanto_comp_at && <span title="Comprobante de adelanto" className="text-[10px] rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 font-semibold">💸 adelanto{p.saldo_comp_at ? ' + saldo' : ''}</span>}
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${info.cls}`}>{info.label}</span>
                    <span className="text-muted text-xs">{open ? '▾' : '▸'}</span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-black/5 px-4 py-3 space-y-4">
                    <div className="grid sm:grid-cols-[1fr_160px] gap-4">
                      <div className="space-y-1 text-sm">
                        <p><span className="text-muted">Mail:</span> <a className="text-brandDark" href={`mailto:${p.email}`}>{p.email}</a></p>
                        <p><span className="text-muted">Teléfono:</span> {p.telefono} · <a className="text-brandDark" href={whatsapp(p.telefono)} target="_blank" rel="noreferrer">WhatsApp ↗</a></p>
                        <p><span className="text-muted">Pago:</span> {p.cuenta === 'plenorius' ? 'transferencia a Plenorius S.A. (+IVA)' : 'efectivo / sin IVA (si transfiere, se define la cuenta)'} · 50 % adelanto / 50 % contra entrega</p>
                        {p.obs && <p className="text-xs bg-neutral-50 rounded-lg px-3 py-2">📝 {p.obs}</p>}
                      </div>
                      <div className="rounded-lg border border-black/10 bg-neutral-50 p-2 flex flex-col items-center justify-center gap-1 min-h-[100px]">
                        {!p.logo_path ? <span className="text-xs text-muted">Sin logo</span>
                          : logos[p.id] ? (
                            <>
                              {esImagen(p.logo_nombre) && <img src={logos[p.id]} alt={`Logo de ${p.marca}`} className="max-h-24 max-w-full object-contain" />}
                              <a href={logos[p.id]} target="_blank" rel="noreferrer" className="text-xs text-brandDark font-medium">Descargar logo ↗</a>
                              <span className="text-[10px] text-faint truncate max-w-full">{p.logo_nombre}</span>
                            </>
                          ) : <span className="text-xs text-muted">Cargando logo…</span>}
                      </div>
                    </div>

                    <div className="divide-y divide-black/5">
                      {(p.items || []).map((it, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                          <div className="min-w-0">
                            <p className="truncate"><b>{it.modelo}</b> <span className="text-[10px] text-faint font-mono">{it.ref}</span> · {it.color}</p>
                            <p className="text-xs text-muted truncate">{it.detalle ?? `${it.cristal} · logo ${it.logo} · estuche + franela`}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-xs">
                            <span className="font-semibold">×{it.cantidad}</span>
                            <span className="text-muted">{usd(it.unit_usd)} c/u</span>
                            <span className="w-24 text-right">{usd(it.total_usd)}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-neutral-50 px-3 py-2 space-y-0.5">
                        <p className="flex justify-between"><span className="text-muted">Subtotal</span><span>{usd(p.subtotal_usd)}</span></p>
                        {p.iva_usd > 0 && <p className="flex justify-between"><span className="text-muted">IVA 21 %</span><span>{usd(p.iva_usd)}</span></p>}
                        <p className="flex justify-between font-semibold"><span>Total</span><span>{usd(p.total_usd)}</span></p>
                      </div>
                      <div className="rounded-lg bg-neutral-50 px-3 py-2 space-y-0.5">
                        {p.total_ars != null && p.dolar != null && (
                          <p className="flex justify-between"><span className="text-muted">Al cerrar ({p.dolar_fecha?.split('-').reverse().join('/')}, {ars(p.dolar)})</span><span>{ars(p.total_ars)}</span></p>
                        )}
                        {arsHoy != null && dolarHoy != null && (
                          <p className="flex justify-between font-semibold"><span>Hoy ({ars(dolarHoy)})</span><span>{ars(arsHoy)}</span></p>
                        )}
                        {arsHoy != null && <p className="flex justify-between text-xs text-muted"><span>50 % adelanto hoy</span><span>{ars(arsHoy / 2)}</span></p>}
                      </div>
                    </div>

                    <div className="rounded-lg border border-black/10 px-3 py-2 space-y-2 text-sm">
                      <p className="text-xs font-semibold text-muted uppercase tracking-wide">Administración</p>
                      {([['Adelanto 50 %', p.adelanto_comp_path, p.adelanto_comp_at], ['Saldo contra entrega', p.saldo_comp_path, p.saldo_comp_at]] as const).map(([tit, path, at]) => (
                        <div key={tit} className="flex items-center justify-between gap-2">
                          <span>{tit} <span className="text-muted">· {usd(p.total_usd / 2)}{dolarHoy ? ` ≈ ${ars((p.total_usd / 2) * dolarHoy)} hoy` : ''}</span></span>
                          {path
                            ? <button onClick={() => verArchivo(path)} className="text-xs font-semibold text-emerald-700">✓ Comprobante {at ? fecha(at) : ''} · ver ↗</button>
                            : <span className="text-xs text-amber-700 font-semibold">Pendiente</span>}
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2">
                        <span>{p.cuenta === 'plenorius' ? 'Factura (Plenorius)' : 'Remito (efectivo, sin IVA)'}</span>
                        <span className="flex items-center gap-3">
                          {p.cuenta === 'plenorius' && (
                            <button disabled={guardando === p.id} onClick={() => exportarTango(p)} className="text-xs font-semibold text-brandDark disabled:opacity-40"
                              title={p.exportado_tango_at ? `Ya exportado ${fecha(p.exportado_tango_at)} (cliente ${p.cod_cliente_tango})` : 'Excel de Novedades para facturar en Tango'}>
                              {p.exportado_tango_at ? '↻ Excel Tango' : '⬇ Excel Tango'}
                            </button>
                          )}
                          {p.cuenta === 'brubank' && !p.doc_path && (
                            <button disabled={guardando === p.id} onClick={() => generarRemito(p)} className="text-xs font-semibold text-brandDark disabled:opacity-40">Generar remito</button>
                          )}
                          {p.doc_path && <button onClick={() => verArchivo(p.doc_path!)} className="text-xs font-semibold text-emerald-700">✓ {p.doc_at ? fecha(p.doc_at) : ''} · ver ↗</button>}
                          <label className="text-xs font-semibold text-brandDark cursor-pointer">
                            {p.doc_path ? 'Reemplazar' : `Subir ${p.cuenta === 'plenorius' ? 'factura' : 'remito'}`}
                            <input type="file" accept="application/pdf,image/*" className="hidden" disabled={guardando === p.id}
                              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) subirDoc(p, f, f.name) }} />
                          </label>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>Orden de producción</span>
                        {ordenes[p.id]
                          ? <Link to="/produccion/pedidos" className="text-xs font-semibold text-violet-700">🏭 #{ordenes[p.id].id} · {ordenes[p.id].estado}{ordenes[p.id].fecha_entrega_estimada ? ` · entrega ${ordenes[p.id].fecha_entrega_estimada!.split('-').reverse().join('/')}` : ''} ↗</Link>
                          : <span className="text-xs text-muted">Se genera sola al aprobar el adelanto</span>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted text-xs">Link de pago del cliente (ve datos, sube comprobantes y descarga {p.cuenta === 'plenorius' ? 'la factura' : 'el remito'})</span>
                        <button onClick={() => navigator.clipboard.writeText(linkPago(p)).then(() => toast('Link copiado', 'success'))} className="text-xs font-semibold text-brandDark shrink-0">Copiar link</button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-muted" htmlFor={`nota-${p.id}`}>Nota interna</label>
                      <div className="flex gap-2">
                        <input id={`nota-${p.id}`} className="flex-1 text-sm rounded-lg border border-black/10 px-3 py-1.5"
                          placeholder="Ej.: adelanto recibido 26/09, logo en 1 color blanco"
                          value={notas[p.id] ?? p.nota_interna ?? ''} onChange={(e) => setNotas((n) => ({ ...n, [p.id]: e.target.value }))} />
                        <button disabled={guardando === p.id || (notas[p.id] ?? p.nota_interna ?? '') === (p.nota_interna ?? '')}
                          onClick={() => actualizar(p, { nota_interna: (notas[p.id] ?? '').trim() || null }, 'Nota guardada')}
                          className="text-xs font-semibold rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40">Guardar</button>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {sig && (
                        <button disabled={guardando === p.id} onClick={() => avanzar(p, sig)}
                          className="text-xs font-semibold rounded-lg bg-brand text-white px-3 py-1.5 disabled:opacity-50">
                          {sig === 'confirmado' ? '✓ Adelanto cobrado · generar orden' : `Pasar a ${estadoInfo(sig).label.toLowerCase()}`}
                        </button>
                      )}
                      {p.estado !== 'anulado' && p.estado !== 'entregado' && (
                        <button disabled={guardando === p.id} onClick={() => actualizar(p, { estado: 'anulado' }, `#${p.id} anulado`)}
                          className="text-xs rounded-lg border border-black/10 px-3 py-1.5 text-muted disabled:opacity-50">Anular</button>
                      )}
                      {p.estado === 'anulado' && (
                        <button disabled={guardando === p.id} onClick={() => actualizar(p, { estado: 'precarga' }, `#${p.id} vuelve a precarga`)}
                          className="text-xs rounded-lg border border-black/10 px-3 py-1.5 text-muted disabled:opacity-50">Reabrir</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
