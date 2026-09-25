import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

// ── Pedidos de marca blanca ──
// Los cierra el cliente desde la app pública ver.orbitaleyewear.com.ar/marca-blanca
// (edge function marca-blanca-pedido → tabla marca_blanca_pedidos + logo en el bucket
// marca-blanca-logos). No tienen SKU ni tocan stock: son producción a pedido con el logo del cliente.

interface Item {
  modelo: string; ref: string; color: string; cristal: string; logo: string
  cantidad: number; unit_usd: number; total_usd: number
  detalle?: string // desde v3: cristal del cliente + logo + packaging elegido
}
interface Pedido {
  id: number; created_at: string; estado: string; marca: string; razon_social: string
  email: string; telefono: string; logo_path: string | null; logo_nombre: string | null
  cuenta: 'brubank' | 'plenorius'; items: Item[]; unidades: number
  subtotal_usd: number; iva_usd: number; total_usd: number
  dolar: number | null; dolar_fecha: string | null; total_ars: number | null
  obs: string | null; nota_interna: string | null
}

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

  async function cargar() {
    const { data, error } = await supabase.from('marca_blanca_pedidos').select('*').order('created_at', { ascending: false })
    if (error) toast('No se pudieron cargar los pedidos de marca blanca', 'error')
    setPedidos((data ?? []) as Pedido[])
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
                        <p><span className="text-muted">Pago:</span> directo por transferencia a {p.cuenta === 'plenorius' ? 'Plenorius S.A. (+IVA)' : 'Brubank ($)'} · 50 % adelanto / 50 % contra entrega</p>
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
                        <button disabled={guardando === p.id} onClick={() => actualizar(p, { estado: sig }, `#${p.id} → ${estadoInfo(sig).label}`)}
                          className="text-xs font-semibold rounded-lg bg-brand text-white px-3 py-1.5 disabled:opacity-50">
                          Pasar a {estadoInfo(sig).label.toLowerCase()}
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
