import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPrecio } from '../../lib/format'
import { ChequeDeclarado, CuentaCobro, ESTADO_PAGO, EstadoPago, copiar, planPago } from './cobros'
import { CargarCheque, PlanPlazo } from './ChequesPlazo'

// Página pública /cobro/ORB-xxx: datos para transferir sin recargo + subir comprobante. Sin login.
// Si el pedido es a plazo (cheque / e-cheq), muestra el plan de vencimientos y la carga de cada cheque.
type Datos = {
  referencia: string
  monto: number
  estado: EstadoPago
  cliente: string
  comprobante: boolean
  cuentas: CuentaCobro[]
  cond_pago: string | null
  cuotas_detalle: string | null
  medios_pago: string[] | null
  fecha_base: string | null
  cheques: ChequeDeclarado[]
}

function Fila({ label, valor }: { label: string; valor: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={() => copiar(valor).then((r) => { setOk(r); setTimeout(() => setOk(false), 1500) })}
      className="w-full flex items-center justify-between gap-3 border border-black/10 rounded-lg px-3 py-2.5 text-left active:bg-black/5"
    >
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-muted">{label}</span>
        <span className="block font-jet text-sm break-all">{valor}</span>
      </span>
      <span className="text-xs font-semibold text-brandDark shrink-0">{ok ? 'Copiado ✓' : 'Copiar'}</span>
    </button>
  )
}

export default function CobroPublico() {
  const ref = decodeURIComponent(window.location.pathname.replace(/^\/cobro\/?/, '').split('/')[0] || '').toUpperCase()
  const [d, setD] = useState<Datos | null | undefined>(undefined)
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState('')

  const cargar = () =>
    supabase.rpc('cobro_publico', { p_ref: ref }).then(({ data }) => setD((data as Datos) ?? null))
  useEffect(() => {
    cargar()
  }, [ref])

  async function subir(f: File) {
    setSubiendo(true)
    setMsg('')
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `publico/${ref}/${Date.now()}.${ext}`
    const up = await supabase.storage.from('comprobantes').upload(path, f, { contentType: f.type || undefined })
    if (up.error) {
      setMsg('No se pudo subir. Probá con una foto o PDF de menos de 8 MB.')
    } else {
      const { data } = await supabase.rpc('cobro_comprobante', { p_ref: ref, p_path: path })
      setMsg(data ? '¡Recibido! Lo verificamos y te avisamos.' : 'No se pudo registrar el comprobante.')
      cargar()
    }
    setSubiendo(false)
  }

  if (d === undefined) return <div className="min-h-screen grid place-items-center text-sm text-muted">Cargando…</div>
  if (d === null)
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <p className="text-sm text-muted">No encontramos el pedido {ref}. Revisá el link o escribile a tu vendedor.</p>
      </div>
    )

  const est = ESTADO_PAGO[d.estado]
  const pagado = d.estado === 'verificado'
  const plan = planPago({ ...d, fecha_factura: d.fecha_base }, d.monto)

  const transferencia = (
    <>
      <div className="bg-goldSoft/60 border border-gold/40 rounded-xl p-3 text-sm">
        Poné <b className="font-jet">{d.referencia}</b> en el concepto de la transferencia. Así el pago se identifica solo.
      </div>

      {d.cuentas.length === 0 && (
        <p className="text-sm text-muted text-center">Pedile los datos de la cuenta a tu vendedor.</p>
      )}
      {d.cuentas.map((c) => (
        <div key={c.id} className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
          <p className="text-sm font-semibold px-1">{c.razon_social || c.nombre}</p>
          <Fila label="Concepto" valor={d.referencia} />
          <Fila label="Importe" valor={String(Math.round(d.monto))} />
          {c.alias && <Fila label="Alias" valor={c.alias} />}
          {c.cbu_cvu && <Fila label="CBU / CVU" valor={c.cbu_cvu} />}
          {c.titular && <Fila label={`Titular${c.cuit ? ' · CUIT' : ''}`} valor={`${c.titular}${c.cuit ? ' · ' + c.cuit : ''}`} />}
        </div>
      ))}

      <label className={`block w-full text-center rounded-xl bg-brand text-white py-3 text-sm font-semibold ${subiendo ? 'opacity-50' : 'cursor-pointer'}`}>
        {subiendo ? 'Subiendo…' : d.comprobante ? 'Subir otro comprobante' : 'Ya transferí · subir comprobante'}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          disabled={subiendo}
          onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
        />
      </label>
      {msg && <p className="text-sm text-center">{msg}</p>}
      <p className="text-[11px] text-muted text-center">El comprobante es opcional si pusiste la referencia en el concepto.</p>
    </>
  )

  return (
    <div className="min-h-screen bg-[#F6F4EF] px-4 py-6">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <img src="/logo-orbital.png" alt="Orbital" className="logo-orbital" />
          <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${est.cls}`}>{est.label}</span>
        </div>

        <div className="bg-white rounded-2xl border border-black/10 p-5 text-center">
          <p className="text-xs text-muted">{d.cliente ? `${d.cliente} · ` : ''}Pedido <span className="font-jet">{d.referencia}</span></p>
          <p className="text-4xl font-bold mt-2">{formatPrecio(d.monto)}</p>
          <p className="text-xs text-muted mt-1">{plan.aPlazo ? `A plazo · ${plan.medio}` : 'Transferencia bancaria · sin recargo'}</p>
        </div>

        {pagado ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-sm text-emerald-800 text-center">
            Pago recibido. ¡Gracias!
          </div>
        ) : (
          plan.aPlazo ? (
            <>
              <PlanPlazo plan={plan} cheques={d.cheques} cuenta={d.cuentas[0]} />
              <CargarCheque referencia={d.referencia} plan={plan} cheques={d.cheques} onListo={cargar} />
              <p className="text-[11px] text-muted text-center">
                Subí la foto de cada cheque (o la captura del e-cheq). Administración los imputa y te avisamos.
              </p>
              <details className="pt-2">
                <summary className="text-xs text-center text-brandDark underline cursor-pointer list-none">¿Preferís pagar por transferencia?</summary>
                <div className="space-y-4 pt-3">{transferencia}</div>
              </details>
            </>
          ) : (
            transferencia
          )
        )}
      </div>
    </div>
  )
}
