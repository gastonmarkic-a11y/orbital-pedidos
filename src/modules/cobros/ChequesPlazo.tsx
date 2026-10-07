import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPrecio } from '../../lib/format'
import { ChequeDeclarado, CuentaCobro, PlanPago, fechaCorta } from './cobros'

// Pago a plazo: plan de vencimientos + cheques / e-cheq cargados + formulario para subir la copia.
// Lo usan la página pública (cliente) y el modal de cobro (vendedor). Las fotos van a comprobantes/publico/ORB-xxx/.

const ESTADO_CH: Record<ChequeDeclarado['estado'], [string, string]> = {
  declarado: ['A imputar', 'bg-amber-100 text-amber-800'],
  imputado: ['En cartera ✓', 'bg-emerald-100 text-emerald-800'],
  descartado: ['Descartado', 'bg-red-100 text-red-700'],
}

export function PlanPlazo({ plan, cheques, cuenta }: { plan: PlanPago; cheques: ChequeDeclarado[]; cuenta?: CuentaCobro }) {
  const vivos = cheques.filter((c) => c.estado !== 'descartado')
  const cargado = vivos.reduce((a, c) => a + Number(c.monto), 0)
  const total = plan.tramos.reduce((a, t) => a + t.monto, 0)
  return (
    <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold">Pago a plazo · {plan.medio}</p>
        <p className="text-[11px] text-muted">{plan.facturado ? 'desde la factura' : 'fechas estimadas'}</p>
      </div>
      {plan.tramos.map((t, i) => (
        <div key={i} className="flex items-center justify-between border border-black/10 rounded-lg px-3 py-2">
          <span className="text-sm">
            <b className="font-jet">{fechaCorta(t.fecha)}</b>{' '}
            <span className="text-muted text-xs">{t.dias === 0 ? 'contado' : `${t.dias} días`}</span>
          </span>
          <span className="text-sm font-semibold">{formatPrecio(t.monto)}</span>
        </div>
      ))}
      {cuenta?.titular && (
        <p className="text-xs text-muted px-1">
          A la orden de <b className="text-ink">{cuenta.titular}</b>{cuenta.cuit ? <> · CUIT <span className="font-jet">{cuenta.cuit}</span></> : null}
        </p>
      )}
      {vivos.length > 0 && (
        <div className="pt-1 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted px-1">Cheques cargados</p>
          {vivos.map((c, i) => (
            <div key={c.id ?? i} className="flex items-center justify-between gap-2 text-xs px-1">
              <span>
                {c.tipo === 'echeck' ? 'E-cheq' : 'Cheque'} {c.numero ? `…${String(c.numero).slice(-4)}` : ''} · vence {fechaCorta(c.fecha_vencimiento)}
              </span>
              <span className="flex items-center gap-2">
                <b>{formatPrecio(c.monto)}</b>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ESTADO_CH[c.estado][1]}`}>{ESTADO_CH[c.estado][0]}</span>
              </span>
            </div>
          ))}
          <p className={`text-xs px-1 font-semibold ${cargado >= total - 1 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {cargado >= total - 1 ? 'Cubre el total del pedido ✓' : `Falta cargar ${formatPrecio(total - cargado)}`}
          </p>
        </div>
      )}
    </div>
  )
}

/** Formulario para cargar un cheque / e-cheq con su foto. Sugiere monto y fecha del próximo tramo sin cubrir. */
export function CargarCheque({ referencia, plan, cheques, onListo, compacto }: {
  referencia: string
  plan: PlanPago
  cheques: ChequeDeclarado[]
  onListo: () => void
  compacto?: boolean
}) {
  const vivos = cheques.filter((c) => c.estado !== 'descartado')
  const proximo = plan.tramos[Math.min(vivos.length, plan.tramos.length - 1)]
  const tipoDefault = plan.medio.toLowerCase().startsWith('cheque') ? 'fisico' : 'echeck'
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<'fisico' | 'echeck'>(tipoDefault)
  const [f, setF] = useState({ monto: '', fecha: '', numero: '', banco: '', cuit: '', librador: '' })
  const [frente, setFrente] = useState<File | null>(null)
  const [dorso, setDorso] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')

  function abrir() {
    setF({ monto: proximo ? String(proximo.monto) : '', fecha: proximo?.fecha ?? '', numero: '', banco: '', cuit: '', librador: '' })
    setFrente(null)
    setDorso(null)
    setMsg('')
    setAbierto(true)
  }

  async function subirFoto(file: File, lado: string) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `publico/${referencia}/cheque-${Date.now()}-${lado}.${ext}`
    const { error } = await supabase.storage.from('comprobantes').upload(path, file, { contentType: file.type || undefined })
    return error ? null : path
  }

  async function enviar() {
    if (!frente) return setMsg(tipo === 'echeck' ? 'Subí la captura del e-cheq.' : 'Subí la foto del frente del cheque.')
    if (!(Number(f.monto) > 0) || !f.fecha) return setMsg('Completá monto y fecha de pago.')
    if (!f.numero.trim()) return setMsg(tipo === 'echeck' ? 'Poné el ID o número del e-cheq.' : 'Poné el número del cheque.')
    setEnviando(true)
    setMsg('')
    const pf = await subirFoto(frente, 'frente')
    const pd = dorso ? await subirFoto(dorso, 'dorso') : null
    if (!pf || (dorso && !pd)) {
      setEnviando(false)
      return setMsg('No se pudo subir la foto. Probá con una imagen o PDF de menos de 8 MB.')
    }
    const { data, error } = await supabase.rpc('cobro_cheque_declarar', {
      p_ref: referencia,
      p: {
        tipo,
        monto: Number(f.monto),
        fecha_vencimiento: f.fecha,
        numero: tipo === 'fisico' ? f.numero : null,
        echeq_id: tipo === 'echeck' ? f.numero : null,
        banco: f.banco,
        cuit_librador: f.cuit,
        nombre_librador: f.librador,
        foto_frente: pf,
        foto_dorso: pd,
      },
    })
    setEnviando(false)
    if (error || !data) return setMsg('No se pudo registrar. ' + (error?.message ?? ''))
    setAbierto(false)
    onListo()
  }

  const inp = 'w-full rounded-md border border-black/10 px-2 py-2 text-sm bg-white'
  if (!abierto)
    return (
      <button onClick={abrir}
        className={`w-full rounded-xl ${compacto ? 'border border-black/15 py-2 text-xs' : 'bg-brand text-white py-3 text-sm'} font-semibold`}>
        {vivos.length ? '+ Cargar otro cheque / e-cheq' : 'Cargar cheque / e-cheq'}
      </button>
    )

  return (
    <div className="bg-white rounded-2xl border border-gold/50 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-1 bg-black/5 rounded-lg p-1">
        {(['echeck', 'fisico'] as const).map((t) => (
          <button key={t} onClick={() => setTipo(t)}
            className={`rounded-md py-1.5 text-xs font-semibold ${tipo === t ? 'bg-white shadow-sm' : 'text-muted'}`}>
            {t === 'echeck' ? 'E-cheq' : 'Cheque físico'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">Monto
          <input className={inp} inputMode="numeric" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value.replace(/[^\d]/g, '') })} />
        </label>
        <label className="text-[11px] text-muted">Fecha de pago
          <input type="date" className={inp} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </label>
        <label className="text-[11px] text-muted">{tipo === 'echeck' ? 'ID / N° de e-cheq' : 'N° de cheque'}
          <input className={`${inp} font-jet`} value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
        </label>
        <label className="text-[11px] text-muted">Banco
          <input className={inp} value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} />
        </label>
        <label className="text-[11px] text-muted">Librador (quién lo emite)
          <input className={inp} value={f.librador} onChange={(e) => setF({ ...f, librador: e.target.value })} />
        </label>
        <label className="text-[11px] text-muted">CUIT del librador
          <input className={`${inp} font-jet`} inputMode="numeric" value={f.cuit} onChange={(e) => setF({ ...f, cuit: e.target.value })} />
        </label>
      </div>
      <div className={`grid gap-2 ${tipo === 'fisico' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <label className={`block text-center rounded-lg border border-dashed py-3 text-xs cursor-pointer ${frente ? 'border-emerald-400 text-emerald-700' : 'border-black/20 text-muted'}`}>
          {frente ? `✓ ${frente.name}` : tipo === 'echeck' ? '📷 Captura del e-cheq' : '📷 Foto del frente'}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFrente(e.target.files?.[0] ?? null)} />
        </label>
        {tipo === 'fisico' && (
          <label className={`block text-center rounded-lg border border-dashed py-3 text-xs cursor-pointer ${dorso ? 'border-emerald-400 text-emerald-700' : 'border-black/20 text-muted'}`}>
            {dorso ? `✓ ${dorso.name}` : '📷 Foto del dorso'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setDorso(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <div className="flex gap-2">
        <button onClick={() => setAbierto(false)} className="rounded-lg border border-black/10 px-3 py-2 text-xs">Cancelar</button>
        <button onClick={enviar} disabled={enviando} className="flex-1 rounded-lg bg-brand text-white py-2 text-xs font-bold disabled:opacity-50">
          {enviando ? 'Subiendo…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}
