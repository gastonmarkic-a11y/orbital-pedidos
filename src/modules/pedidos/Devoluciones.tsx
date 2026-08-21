import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

// Ingreso de mercadería por devolución (Plan Canje).
// Depósito carga la devolución (elige cliente + SKUs), reparte cada SKU entre
// depósito 03 (apto para venta) y 07 (fallados), y exporta el Excel para Tango.
// Administración después arma la Nota de Crédito (Fase 2).

interface ItemDev { sku: string; modelo: string; color: string; cant_03: number; cant_07: number }
interface Devol { id: number; cod_cliente: string | null; cliente_razon: string | null; fecha: string; estado: string; items: ItemDev[]; operador: string | null; origen?: string; created_at: string }
interface Cli { cod: string; razon: string }

const ESTADO: Record<string, { t: string; c: string }> = {
  borrador: { t: 'Borrador', c: 'bg-slate-100 text-slate-700' },
  cerrada: { t: 'Cerrada · lista p/NC', c: 'bg-sky-100 text-sky-700' },
  nc_hecha: { t: 'NC hecha', c: 'bg-emerald-100 text-emerald-700' },
}

export default function Devoluciones() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const toast = useToast()
  const esAdmin = rolEfectivo === 'admin' || rolEfectivo === 'administracion'
  const [lista, setLista] = useState<Devol[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [cli, setCli] = useState<Cli | null>(null)
  const [cliQuery, setCliQuery] = useState('')
  const [cliRes, setCliRes] = useState<Cli[]>([])
  const [items, setItems] = useState<ItemDev[]>([])
  const [skuInput, setSkuInput] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('devolucion').select('*').order('created_at', { ascending: false }).limit(100)
    setLista((data as Devol[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  async function buscarCliente(q: string) {
    setCliQuery(q)
    if (q.trim().length < 2) { setCliRes([]); return }
    const { data } = await supabase.from('clientes').select('cod, razon').or(`cod.ilike.%${q}%,razon.ilike.%${q}%`).limit(8)
    setCliRes((data as Cli[]) ?? [])
  }

  async function agregarSku() {
    const sku = skuInput.trim()
    if (!sku) return
    if (items.some((i) => i.sku === sku)) { toast('Ese SKU ya está en la lista', 'error'); return }
    const { data } = await supabase.from('stock').select('codigo, modelo, descripcion').eq('codigo', sku).maybeSingle()
    const s = data as { modelo: string; descripcion: string } | null
    setItems((prev) => [...prev, { sku, modelo: s?.modelo ?? '(sin catálogo)', color: s?.descripcion ?? '', cant_03: 1, cant_07: 0 }])
    setSkuInput('')
  }

  function setCant(sku: string, campo: 'cant_03' | 'cant_07', val: number) {
    setItems((prev) => prev.map((i) => (i.sku === sku ? { ...i, [campo]: Math.max(0, val || 0) } : i)))
  }
  function quitar(sku: string) { setItems((prev) => prev.filter((i) => i.sku !== sku)) }

  const totalUn = items.reduce((a, i) => a + i.cant_03 + i.cant_07, 0)
  const total03 = items.reduce((a, i) => a + i.cant_03, 0)
  const total07 = items.reduce((a, i) => a + i.cant_07, 0)

  function abrirParaCompletar(d: Devol) {
    setCli(d.cod_cliente ? { cod: d.cod_cliente, razon: d.cliente_razon ?? d.cod_cliente } : null)
    setCliQuery(''); setItems(d.items.map((i) => ({ ...i, cant_03: i.cant_03 || 0, cant_07: i.cant_07 || 0 })))
    setEditId(d.id); setNuevoOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function resetForm() { setNuevoOpen(false); setCli(null); setCliQuery(''); setItems([]); setEditId(null) }

  async function guardar() {
    if (!cli) { toast('Elegí el cliente', 'error'); return }
    const validos = items.filter((i) => i.sku && i.cant_03 + i.cant_07 > 0)
    if (!validos.length) { toast('Agregá al menos un artículo con cantidad', 'error'); return }
    setGuardando(true)
    const payload = { cod_cliente: cli.cod, cliente_razon: cli.razon, items: validos }
    const { error } = editId
      ? await supabase.from('devolucion').update(payload).eq('id', editId)
      : await supabase.from('devolucion').insert({ ...payload, estado: 'borrador', operador: codigoEfectivo })
    setGuardando(false)
    if (error) { toast('No se pudo guardar: ' + error.message, 'error'); return }
    toast(editId ? '✓ Devolución actualizada' : '✓ Devolución guardada', 'success')
    resetForm(); cargar()
  }

  async function exportarTango(d: Devol) {
    const XLSX = await import('xlsx')
    const cols = ['Código de artículo', 'Descripción', 'Depósito', 'Cantidad', 'Precio unitario', 'Observaciones']
    const rows: (string | number)[][] = [cols]
    for (const it of d.items) {
      const desc = `${it.modelo} ${it.color}`.trim()
      if (it.cant_03 > 0) rows.push([it.sku, desc, '03', it.cant_03, 0, ''])
      if (it.cant_07 > 0) rows.push([it.sku, desc, '07', it.cant_07, 0, ''])
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Novedades')
    XLSX.writeFile(wb, `Ingreso_devolucion_${d.cod_cliente}_${d.id}.xlsx`)
    toast('✓ Excel para Tango descargado', 'success')
  }

  async function cambiarEstado(d: Devol, estado: string) {
    const extra: Record<string, unknown> = { estado }
    if (estado === 'cerrada') extra.cerrada_at = new Date().toISOString()
    await supabase.from('devolucion').update(extra).eq('id', d.id)
    setLista((prev) => prev.map((x) => (x.id === d.id ? { ...x, estado } : x)))
  }

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">↩️ Ingreso por devolución</h2>
          <p className="text-xs text-muted">Depósito carga la devolución y reparte entre depósito 03 (venta) y 07 (fallados). Después se exporta a Tango.</p>
        </div>
        <button onClick={() => { if (nuevoOpen) { resetForm() } else { resetForm(); setNuevoOpen(true) } }} className="text-sm font-semibold rounded-lg bg-brand text-white px-3 py-2">{nuevoOpen ? 'Cerrar' : '+ Nueva devolución'}</button>
      </div>

      {/* Alta de devolución */}
      {nuevoOpen && (
        <div className="bg-white rounded-2xl border border-black/10 p-4 space-y-3">
          {/* Cliente */}
          {!cli ? (
            <div>
              <label className="text-[11px] text-muted">Cliente</label>
              <input value={cliQuery} onChange={(e) => buscarCliente(e.target.value)} placeholder="Buscar por código o razón social…" className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm" />
              {cliRes.length > 0 && (
                <div className="mt-1 border border-black/10 rounded-lg divide-y max-h-52 overflow-y-auto">
                  {cliRes.map((c) => (
                    <button key={c.cod} onClick={() => { setCli(c); setCliRes([]) }} className="w-full text-left px-3 py-2 text-sm hover:bg-black/[0.03]">
                      <b>{c.cod}</b> · {c.razon}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between bg-[#F6F4EF] rounded-lg px-3 py-2">
              <span className="text-sm"><b>{cli.cod}</b> · {cli.razon}</span>
              <button onClick={() => setCli(null)} className="text-xs text-red-500">cambiar</button>
            </div>
          )}

          {/* Agregar SKU */}
          <div className="flex gap-2">
            <input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') agregarSku() }} placeholder="Código de artículo (SKU)" className="flex-1 border border-black/10 rounded-lg px-3 py-2 text-sm" />
            <button onClick={agregarSku} className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium">+ Agregar</button>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_70px_70px_28px] gap-2 text-[10px] text-faint font-semibold uppercase px-1">
                <span>Artículo</span><span className="text-center">Apto (03)</span><span className="text-center">Fallado (07)</span><span></span>
              </div>
              {items.map((it) => (
                <div key={it.sku} className="grid grid-cols-[1fr_70px_70px_28px] gap-2 items-center">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{it.modelo}</p>
                    <p className="text-[10px] text-faint truncate">{it.sku}{it.color ? ` · ${it.color}` : ''}</p>
                  </div>
                  <input type="number" min={0} value={it.cant_03} onChange={(e) => setCant(it.sku, 'cant_03', +e.target.value)} className="border border-black/10 rounded-lg px-2 py-1.5 text-sm text-center" />
                  <input type="number" min={0} value={it.cant_07} onChange={(e) => setCant(it.sku, 'cant_07', +e.target.value)} className="border border-black/10 rounded-lg px-2 py-1.5 text-sm text-center" />
                  <button onClick={() => quitar(it.sku)} className="text-red-400 text-lg leading-none">×</button>
                </div>
              ))}
              <div className="flex justify-end gap-4 text-[11px] text-muted pt-1">
                <span>Apto (03): <b>{total03}</b></span><span>Fallado (07): <b>{total07}</b></span><span>Total: <b>{totalUn}</b></span>
              </div>
            </div>
          )}

          <button onClick={guardar} disabled={guardando} className="w-full bg-brand text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">{guardando ? 'Guardando…' : (editId ? 'Actualizar devolución' : 'Guardar devolución')}</button>
        </div>
      )}

      {/* Lista de devoluciones */}
      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : lista.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Todavía no hay devoluciones cargadas.</p>
      ) : (
        <div className="space-y-2">
          {lista.map((d) => {
            const t03 = d.items.reduce((a, i) => a + (i.cant_03 || 0), 0)
            const t07 = d.items.reduce((a, i) => a + (i.cant_07 || 0), 0)
            return (
              <div key={d.id} className="bg-white rounded-2xl border border-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      #{d.id} · {d.cod_cliente ? (d.cliente_razon || d.cod_cliente) : <span className="text-amber-600">⚠️ sin cliente — completar</span>}
                      {d.origen === 'iris' && <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5">📸 IRIS</span>}
                    </p>
                    <p className="text-[11px] text-faint">{d.items.length} artículos · 🟢 {t03} apto (03) · 🔴 {t07} fallado (07) · {new Date(d.created_at).toLocaleDateString('es-AR')}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${ESTADO[d.estado]?.c ?? 'bg-black/5'}`}>{ESTADO[d.estado]?.t ?? d.estado}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {d.estado === 'borrador' && <button onClick={() => abrirParaCompletar(d)} className="text-[11px] font-semibold rounded-lg bg-brand text-white px-2.5 py-1.5">✏️ {d.cod_cliente ? 'Editar' : 'Completar'}</button>}
                  <button onClick={() => exportarTango(d)} className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5">⬇️ Excel para Tango</button>
                  {d.estado === 'borrador' && d.cod_cliente && <button onClick={() => cambiarEstado(d, 'cerrada')} className="text-[11px] font-semibold rounded-lg bg-ink text-white px-2.5 py-1.5">Cerrar (lista p/NC)</button>}
                  {esAdmin && d.estado === 'cerrada' && <button onClick={() => cambiarEstado(d, 'nc_hecha')} className="text-[11px] font-semibold rounded-lg border border-emerald-300 text-emerald-700 px-2.5 py-1.5">Marcar NC hecha</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
