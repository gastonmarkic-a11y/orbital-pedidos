import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { formatPrecio } from '../../lib/format'
import { parseTelefonos, abrirWhatsApp } from '../../lib/telefono'
import { CuentaCobro, ESTADO_PAGO, Pago, mensajeCobro, copiar, mensajeMediosPago } from './cobros'

// /cobros: bandeja de pagos (a verificar / pendientes / cobrados) + cuentas de cobro.
// Verificar mueve el saldo de la cuenta en /finanzas y marca el pedido cobrado (RPC cobro_verificar).
type PagoPed = Pago & { pedidos: { wsp: string | null; vendedor: string | null } | null }
type Cuenta = CuentaCobro & { tipo: string; activo: boolean; cobro_activa: boolean; orden: number }

const ORIGENES = [
  ['transferencia', 'Transferencia'],
  ['mp_cvu', 'Transferencia a MP'],
  ['efectivo', 'Efectivo'],
  ['cheque', 'Cheque'],
  ['echeq', 'E-cheq'],
] as const

const dias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

function Verificar({ p, cuentas, onListo }: { p: PagoPed; cuentas: Cuenta[]; onListo: () => void }) {
  const toast = useToast()
  const [monto, setMonto] = useState(String(Math.round(p.monto_esperado)))
  const [cuenta, setCuenta] = useState<number | ''>(p.cuenta_id ?? '')
  const [origen, setOrigen] = useState('transferencia')
  const [comp, setComp] = useState<string | null>(null)

  useEffect(() => {
    if (p.comprobante_path)
      supabase.storage.from('comprobantes').createSignedUrl(p.comprobante_path, 600).then(({ data }) => setComp(data?.signedUrl ?? null))
  }, [p.comprobante_path])

  async function verificar() {
    if (!cuenta) return toast('Elegí la cuenta donde entró la plata', 'error')
    const { error } = await supabase.rpc('cobro_verificar', { p_id: p.id, p_monto: Number(monto), p_cuenta: cuenta, p_origen: origen, p_nota: null })
    if (error) return toast(error.message, 'error')
    toast('✅ Pago verificado', 'success')
    onListo()
  }
  async function rechazar() {
    const nota = window.prompt('¿Por qué se rechaza? (lo ve administración)')
    if (nota === null) return
    const { error } = await supabase.rpc('cobro_rechazar', { p_id: p.id, p_nota: nota })
    if (error) return toast(error.message, 'error')
    toast('Pago rechazado', 'success')
    onListo()
  }

  return (
    <div className="mt-2 space-y-2">
      {comp && (
        <a href={comp} target="_blank" rel="noreferrer" className="block text-xs text-brandDark underline">
          Ver comprobante
        </a>
      )}
      <div className="grid grid-cols-3 gap-2">
        <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ''))}
          className="rounded-md border border-black/10 px-2 py-1.5 text-sm" title="Monto recibido" />
        <select value={cuenta} onChange={(e) => setCuenta(e.target.value ? Number(e.target.value) : '')}
          className="rounded-md border border-black/10 px-2 py-1.5 text-sm">
          <option value="">Cuenta…</option>
          {cuentas.filter((c) => c.activo).map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}{c.razon_social ? ' · ' + c.razon_social : ''}</option>
          ))}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)} className="rounded-md border border-black/10 px-2 py-1.5 text-sm">
          {ORIGENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={verificar} className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-xs font-bold">✓ Verificar</button>
        <button onClick={rechazar} className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-xs font-semibold">Rechazar</button>
      </div>
    </div>
  )
}

function Cuentas({ cuentas, onCambio }: { cuentas: Cuenta[]; onCambio: () => void }) {
  const toast = useToast()
  const [edit, setEdit] = useState<Partial<Cuenta> | null>(null)

  async function guardar() {
    if (!edit) return
    const fila = {
      nombre: edit.nombre?.trim(),
      tipo: edit.tipo || 'banco',
      razon_social: edit.razon_social || null,
      alias: edit.alias?.trim() || null,
      cbu_cvu: edit.cbu_cvu?.replace(/\s/g, '') || null,
      titular: edit.titular?.trim() || null,
      cuit: edit.cuit?.trim() || null,
      cobro_activa: !!edit.cobro_activa,
    }
    if (!fila.nombre) return toast('Poné un nombre (ej. Credicoop Plenorius)', 'error')
    const q = edit.id
      ? supabase.from('cuentas_financieras').update(fila).eq('id', edit.id)
      : supabase.from('cuentas_financieras').insert({ ...fila, saldo_actual: 0, activo: true })
    const { error } = await q
    if (error) return toast(error.message, 'error')
    toast('Cuenta guardada', 'success')
    setEdit(null)
    onCambio()
  }

  const inp = 'w-full rounded-md border border-black/10 px-2 py-1.5 text-sm'
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Las cuentas con <b>“Mostrar al cliente”</b> aparecen en la página de cobro, en el catálogo y en el WhatsApp. Son las mismas cuentas de /finanzas.
      </p>
      {cuentas.map((c) => (
        <div key={c.id} className="bg-white border border-black/10 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{c.nombre} <span className="text-faint">· {c.razon_social || '—'} · {c.tipo}</span></p>
            <p className="text-xs font-jet text-muted truncate">{c.alias || 'sin alias'} · {c.cbu_cvu || 'sin CBU/CVU'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.cobro_activa && <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">Visible</span>}
            <button onClick={() => setEdit(c)} className="text-xs text-brandDark font-semibold">Editar</button>
          </div>
        </div>
      ))}
      {edit ? (
        <div className="bg-white border border-gold/50 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Nombre (ej. Credicoop)" value={edit.nombre ?? ''} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} />
            <select className={inp} value={edit.razon_social ?? ''} onChange={(e) => setEdit({ ...edit, razon_social: e.target.value })}>
              <option value="">Empresa…</option>
              <option>Plenorius</option>
              <option>Ejemplar</option>
              <option>Plastic</option>
            </select>
            <select className={inp} value={edit.tipo ?? 'banco'} onChange={(e) => setEdit({ ...edit, tipo: e.target.value })}>
              <option value="banco">Banco</option>
              <option value="mp">Billetera (CVU)</option>
              <option value="efectivo">Efectivo</option>
            </select>
            <input className={inp} placeholder="Alias" value={edit.alias ?? ''} onChange={(e) => setEdit({ ...edit, alias: e.target.value })} />
            <input className={`${inp} col-span-2 font-jet`} placeholder="CBU / CVU (22 dígitos)" value={edit.cbu_cvu ?? ''} onChange={(e) => setEdit({ ...edit, cbu_cvu: e.target.value })} />
            <input className={inp} placeholder="Titular" value={edit.titular ?? ''} onChange={(e) => setEdit({ ...edit, titular: e.target.value })} />
            <input className={inp} placeholder="CUIT" value={edit.cuit ?? ''} onChange={(e) => setEdit({ ...edit, cuit: e.target.value })} />
          </div>
          {edit.cbu_cvu && edit.cbu_cvu.replace(/\D/g, '').length !== 22 && (
            <p className="text-xs text-amber-700">El CBU/CVU tiene {edit.cbu_cvu.replace(/\D/g, '').length} dígitos (deberían ser 22).</p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!edit.cobro_activa} onChange={(e) => setEdit({ ...edit, cobro_activa: e.target.checked })} />
            Mostrar al cliente para cobrar
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="text-sm text-muted px-3">Cancelar</button>
            <button onClick={guardar} className="rounded-lg bg-brand text-white px-4 py-1.5 text-sm font-semibold">Guardar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEdit({ tipo: 'banco', cobro_activa: true })} className="w-full rounded-lg border border-dashed border-black/20 py-2 text-sm text-muted">
          + Nueva cuenta de cobro
        </button>
      )}
    </div>
  )
}

export default function PanelCobros() {
  const { rolEfectivo } = useAuth()
  const toast = useToast()
  const puedeVerificar = ['admin', 'administracion', 'financiero'].includes(rolEfectivo ?? '')
  const [pagos, setPagos] = useState<PagoPed[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])
  const [cuentasVisibles, setCuentasVisibles] = useState<CuentaCobro[]>([])
  const [tab, setTab] = useState<'verificar' | 'pendientes' | 'cobrados' | 'cuentas'>('verificar')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [mes, setMes] = useState(new Date().toISOString().slice(0, 7))

  const cargar = useCallback(async () => {
    const [{ data: ps }, { data: cs }, { data: vis }] = await Promise.all([
      supabase.from('pagos').select('*, pedidos(wsp, vendedor)').order('created_at', { ascending: false }).limit(1000),
      puedeVerificar
        ? supabase.from('cuentas_financieras').select('id, tipo, nombre, razon_social, alias, cbu_cvu, titular, cuit, activo, cobro_activa, orden').order('orden').order('id')
        : Promise.resolve({ data: [] }),
      supabase.rpc('cobro_cuentas'),
    ])
    setPagos((ps as PagoPed[]) ?? [])
    setCuentas((cs as Cuenta[]) ?? [])
    setCuentasVisibles((vis as CuentaCobro[]) ?? [])
  }, [puedeVerificar])

  useEffect(() => {
    cargar()
    const ch = supabase
      .channel('cobros-pagos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, () => cargar())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [cargar])

  const aVerificar = pagos.filter((p) => p.estado === 'comprobante' || p.estado === 'detectado')
  const pendientes = pagos.filter((p) => p.estado === 'pendiente' || p.estado === 'rechazado')
  const cobrados = useMemo(
    () => pagos.filter((p) => p.estado === 'verificado' && (p.verificado_en ?? '').slice(0, 7) === mes),
    [pagos, mes],
  )
  const suma = (xs: Pago[], k: 'monto_esperado' | 'monto_recibido') => xs.reduce((a, p) => a + Number(p[k] || 0), 0)

  function exportar() {
    const filas = [['referencia', 'cliente', 'fecha', 'origen', 'cuenta', 'monto'].join(';')]
    for (const p of cobrados)
      filas.push([p.referencia, (p.cliente || '').replace(/;/g, ','), (p.verificado_en || '').slice(0, 10), p.origen || '',
        cuentas.find((c) => c.id === p.cuenta_id)?.nombre || '', String(p.monto_recibido ?? '')].join(';'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\n')], { type: 'text/csv' }))
    a.download = `cobros-${mes}.csv`
    a.click()
  }

  const Tab = ({ id, label, n }: { id: typeof tab; label: string; n?: number }) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${tab === id ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'}`}>
      {label}{n ? ` · ${n}` : ''}
    </button>
  )

  const lista = tab === 'verificar' ? aVerificar : tab === 'pendientes' ? pendientes : cobrados

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] tracking-[0.25em] text-gold font-bold">[ COBROS ]</p>
        <h1 className="text-lg font-semibold">Cobros sin intermediarios</h1>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ['A verificar', aVerificar.length, suma(aVerificar, 'monto_esperado')],
          ['Pendiente', pendientes.length, suma(pendientes, 'monto_esperado')],
          ['Cobrado en el mes', cobrados.length, suma(cobrados, 'monto_recibido')],
        ].map(([l, n, m]) => (
          <div key={l as string} className="bg-white border border-black/10 rounded-xl px-3 py-2">
            <p className="text-[11px] text-muted">{l}</p>
            <p className="text-base font-bold">{formatPrecio(m as number) || '$ 0'}</p>
            <p className="text-[10px] text-faint">{n} pago{n === 1 ? '' : 's'}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab id="verificar" label="A verificar" n={aVerificar.length} />
        <Tab id="pendientes" label="Pendientes" n={pendientes.length} />
        <Tab id="cobrados" label="Cobrados" />
        {puedeVerificar && <Tab id="cuentas" label="Cuentas" />}
        {puedeVerificar && cuentasVisibles.length > 0 && (
          <button onClick={() => copiar(mensajeMediosPago(cuentasVisibles)).then((ok) => ok && toast('Medios de pago copiados', 'success'))}
            className="ml-auto text-xs text-brandDark underline">Copiar medios de pago</button>
        )}
      </div>

      {tab === 'cuentas' ? (
        <Cuentas cuentas={cuentas} onCambio={cargar} />
      ) : (
        <>
          {tab === 'cobrados' && (
            <div className="flex items-center gap-2">
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-md border border-black/10 px-2 py-1 text-sm" />
              <button onClick={exportar} className="text-xs border border-black/10 rounded-lg px-3 py-1.5">Exportar CSV</button>
            </div>
          )}
          {lista.length === 0 ? (
            <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Nada por acá.</div>
          ) : (
            <div className="space-y-1.5">
              {lista.map((p) => {
                const est = ESTADO_PAGO[p.estado]
                const wa = parseTelefonos(p.pedidos?.wsp, true)[0]?.wa
                const nombre = (p.cliente || '').replace(/^\d+ - /, '')
                return (
                  <div key={p.id} className="bg-white border border-black/10 rounded-xl px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <button className="flex-1 min-w-0 text-left" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                        <p className="text-sm font-medium truncate">{nombre} <span className="font-jet text-faint text-xs">{p.referencia}</span></p>
                        <p className="text-xs text-faint">
                          {p.pedidos?.vendedor || ''} · hace {dias(p.created_at)} d
                          {p.notas ? ` · ${p.notas}` : ''}
                        </p>
                      </button>
                      <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${est.cls}`}>{est.label}</span>
                      <p className="text-sm font-bold shrink-0">{formatPrecio(p.estado === 'verificado' ? p.monto_recibido : p.monto_esperado)}</p>
                    </div>
                    {abierto === p.id && (
                      <>
                        {tab === 'pendientes' && (
                          <button disabled={!wa}
                            onClick={() => wa && abrirWhatsApp(wa, mensajeCobro(p.referencia, p.monto_esperado,
                              p.cuenta_id ? cuentasVisibles.filter((c) => c.id === p.cuenta_id) : cuentasVisibles, nombre.split(' ')[0]))}
                            className="mt-2 w-full rounded-lg bg-[#25D366] text-white py-2 text-xs font-bold disabled:opacity-40">
                            Reenviar datos por WhatsApp
                          </button>
                        )}
                        {puedeVerificar && tab !== 'cobrados' && <Verificar p={p} cuentas={cuentas} onListo={cargar} />}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
