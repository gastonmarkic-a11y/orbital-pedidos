import { FormEvent, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Cliente, Propuesta } from '../../lib/types'
import { clasificarVoz } from './voz'
import HistorialModal from './HistorialModal'

const VENDEDORES_CAMPO = [
  { codigo: 'Adrian', label: 'Adrián' },
  { codigo: 'Martin', label: 'Martín' },
]

export default function CargarActividad() {
  const { vendedor, rolEfectivo } = useAuth()
  const location = useLocation()
  const esAdmin = rolEfectivo === 'admin'
  const esProspeccion = vendedor?.codigo === 'Marketing'

  const [cartera, setCartera] = useState<Cliente[]>([])
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [propuestas, setPropuestas] = useState<Propuesta[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cliente, setCliente] = useState<Cliente | null>(location.state?.cliente ?? null)
  const [proximoPaso, setProximoPaso] = useState('')
  const [fechaAgenda, setFechaAgenda] = useState('')
  const [vozNota, setVozNota] = useState('')
  const [propuestaId, setPropuestaId] = useState('')
  const [huboVenta, setHuboVenta] = useState(false)
  const [unidades, setUnidades] = useState('')
  const [monto, setMonto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)
  const [derivarA, setDerivarA] = useState('')
  const [fechaVisita, setFechaVisita] = useState('')
  const [derivando, setDerivando] = useState(false)
  const [derivado, setDerivado] = useState(false)
  const [ventaDirectaSaving, setVentaDirectaSaving] = useState(false)
  const [ventaDirectaOk, setVentaDirectaOk] = useState(false)

  useEffect(() => {
    const c = location.state?.cliente
    if (c) setCliente(c)
  }, [location.state])

  useEffect(() => {
    if (!vendedor) return
    if (!esAdmin) {
      supabase
        .from('clientes')
        .select('*')
        .eq('vendedor_asignado', vendedor.codigo)
        .then(({ data }) => setCartera((data as Cliente[]) ?? []))
    }
    supabase
      .from('propuestas_julio')
      .select('*')
      .eq('activa', true)
      .order('orden')
      .then(({ data }) => setPropuestas((data as Propuesta[]) ?? []))
  }, [vendedor, esAdmin])

  useEffect(() => {
    if (!esAdmin) return
    const q = busqueda.trim()
    if (q.length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(() => {
      supabase
        .from('clientes')
        .select('*')
        .or(`nomcomerc.ilike.%${q}%,razon.ilike.%${q}%`)
        .limit(8)
        .then(({ data }) => setResultados((data as Cliente[]) ?? []))
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda, esAdmin])

  const sugerencias = esAdmin
    ? resultados
    : busqueda.trim()
      ? cartera
          .filter((c) => (c.nomcomerc || c.razon || '').toLowerCase().includes(busqueda.trim().toLowerCase()))
          .slice(0, 8)
      : []

  const vozTema = clasificarVoz(vozNota)
  const esDerivable = cliente?.vendedor_asignado === 'Marketing' || cliente?.vendedor_asignado == null
  const muestraDerivar = !!cliente && (esProspeccion || esAdmin) && esDerivable

  function limpiar() {
    setCliente(null)
    setBusqueda('')
    setProximoPaso('')
    setFechaAgenda('')
    setVozNota('')
    setPropuestaId('')
    setHuboVenta(false)
    setUnidades('')
    setMonto('')
    setDerivarA('')
    setFechaVisita('')
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!cliente || !vendedor) return
    setGuardando(true)
    const propNombre = propuestas.find((p) => String(p.id) === propuestaId)?.nombre
    const desarrollo = propNombre ? `Propuesta enviada: ${propNombre}` : huboVenta ? 'Venta' : 'Seguimiento / nota'
    await supabase.from('actividad_diaria').insert({
      vendedor: cliente.vendedor_asignado || vendedor.codigo,
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
      actividad_desarrollo: desarrollo,
      actividad_futura: proximoPaso || null,
      proximo_paso_fecha: fechaAgenda || null,
      voz_cliente_nota: vozNota || null,
      propuesta_enviada_id: propuestaId ? Number(propuestaId) : null,
      unidades_vendidas: huboVenta && unidades ? Number(unidades) : null,
      monto_vendido: huboVenta && monto ? Number(monto) : null,
    })
    await supabase
      .from('clientes')
      .update({
        proximo_paso: proximoPaso || null,
        proxima_agenda_fecha: fechaAgenda || null,
        nota: proximoPaso || cliente.nota,
      })
      .eq('cod', cliente.cod)
    setGuardando(false)
    setGuardado(true)
    limpiar()
    setTimeout(() => setGuardado(false), 3000)
  }

  async function derivar(e: FormEvent) {
    e.preventDefault()
    if (!cliente || !derivarA) return
    setDerivando(true)
    const label = VENDEDORES_CAMPO.find((v) => v.codigo === derivarA)?.label ?? derivarA
    const nota = fechaVisita
      ? `Visita coordinada por Prospección para el ${fechaVisita}`
      : 'Visita coordinada por Prospección'
    await supabase
      .from('clientes')
      .update({
        vendedor_asignado: derivarA,
        origen: 'asignado',
        proximo_paso: nota,
        proxima_agenda_fecha: fechaVisita || null,
        nota,
      })
      .eq('cod', cliente.cod)
    await supabase.from('actividad_diaria').insert({
      vendedor: 'Marketing',
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
      actividad_desarrollo: `Derivado a ${label} para visita comercial`,
      actividad_futura: nota,
      proximo_paso_fecha: fechaVisita || null,
      voz_cliente_nota: vozNota || null,
    })
    setDerivando(false)
    setDerivado(true)
    limpiar()
    setTimeout(() => setDerivado(false), 3000)
  }

  async function ventaDirecta() {
    if (!cliente) return
    setVentaDirectaSaving(true)
    await supabase
      .from('clientes')
      .update({ vendedor_asignado: 'ProspeccionVenta', origen: 'asignado' })
      .eq('cod', cliente.cod)
    await supabase.from('actividad_diaria').insert({
      vendedor: 'ProspeccionVenta',
      cod_cliente: cliente.cod,
      nombre_comercio: cliente.nomcomerc,
      contacto: cliente.contacto,
      telefono: cliente.whatsapp || cliente.telefono,
      localidad: cliente.localidad,
      email: cliente.email,
      actividad_desarrollo: 'Venta directa cerrada por Prospección (sin derivar a vendedor de campo)',
      voz_cliente_nota: vozNota || null,
    })
    setVentaDirectaSaving(false)
    setVentaDirectaOk(true)
    limpiar()
    setTimeout(() => setVentaDirectaOk(false), 3000)
  }

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">Cargar Actividad</h2>
      {guardado && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3">
          Actividad guardada ✓
        </div>
      )}
      {derivado && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3">
          Cliente derivado ✓ — ya no aparece en Prospección, quedó en la cartera del vendedor asignado.
        </div>
      )}
      {ventaDirectaOk && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3">
          Venta directa registrada ✓ — el cliente pasó a "Prospección (venta directa)".
        </div>
      )}

      {cliente ? (
        <>
          <form onSubmit={guardar} className="space-y-4 bg-white rounded-xl p-4 border border-black/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{cliente.nomcomerc || cliente.razon}</p>
                <p className="text-xs text-faint">
                  {cliente.cod} · {cliente.zona ?? cliente.localidad}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <button type="button" onClick={() => setCliente(null)} className="text-xs text-muted">
                  cambiar
                </button>
                <button type="button" onClick={() => setVerHistorial(true)} className="text-xs text-brandDark font-medium">
                  Historial
                </button>
              </div>
            </div>

            {cliente.nota && (
              <div className="bg-[#f7f7fa] rounded-lg p-2 text-xs text-muted">📝 Nota anterior: {cliente.nota}</div>
            )}

            <div>
              <p className="text-xs text-muted mb-2">¿Le enviaste alguna propuesta comercial?</p>
              <div className="grid grid-cols-2 gap-2">
                {propuestas.map((p) => {
                  const sel = propuestaId === String(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPropuestaId(sel ? '' : String(p.id))}
                      className={`relative text-left rounded-lg border px-3 py-2 text-xs font-medium ${
                        sel ? 'bg-brand/10 border-brand text-ink' : 'bg-white border-black/10 text-muted'
                      }`}
                    >
                      {sel && <span className="absolute top-1 right-1.5 text-emerald-600">✓</span>}
                      {p.nombre}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => setPropuestaId('')}
                className={`mt-2 text-xs ${propuestaId ? 'text-faint' : 'text-brandDark font-medium'}`}
              >
                No envié propuesta, solo dejo una nota / recordatorio
              </button>
            </div>

            <label className="block text-xs text-muted">
              Voz del cliente (qué dijo sobre precio, producto, competencia, etc.)
              <textarea
                value={vozNota}
                onChange={(e) => setVozNota(e.target.value)}
                placeholder='Ej: "Le pareció caro", "Pide marca blanca", "Compra a otro proveedor"...'
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint"
                rows={2}
              />
              {vozTema && (
                <span className="inline-block mt-1 text-[10px] text-brandDark bg-brand/10 rounded-full px-2 py-0.5">
                  {vozTema.label}
                </span>
              )}
            </label>

            <label className="block text-xs text-muted">
              Próximo paso / recordatorio
              <input
                value={proximoPaso}
                onChange={(e) => setProximoPaso(e.target.value)}
                placeholder='Ej: "Llamar mañana", "No estaba el gerente de compras"...'
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint"
              />
            </label>

            <label className="block text-xs text-muted">
              Fecha de próxima agenda
              <input
                type="date"
                value={fechaAgenda}
                onChange={(e) => setFechaAgenda(e.target.value)}
                className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={huboVenta} onChange={(e) => setHuboVenta(e.target.checked)} />
              Hubo venta
            </label>
            {huboVenta && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="Unidades"
                  type="number"
                  value={unidades}
                  onChange={(e) => setUnidades(e.target.value)}
                  className="bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                />
                <input
                  placeholder="Monto"
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={guardando}
              className="w-full rounded-lg bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar actividad'}
            </button>
          </form>

          {muestraDerivar && (
            <form onSubmit={derivar} className="space-y-3 bg-white rounded-xl p-4 border border-brand/30">
              <p className="text-sm font-semibold text-ink">Derivar a un vendedor</p>
              <p className="text-xs text-muted">
                Usalo cuando ya le mandaste la bienvenida y el catálogo, y coordinaste una visita — el cliente pasa a
                la cartera del vendedor elegido y deja de figurar en Prospección.
              </p>
              <label className="block text-xs text-muted">
                Vendedor
                <select
                  value={derivarA}
                  onChange={(e) => setDerivarA(e.target.value)}
                  className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                >
                  <option value="">Elegir vendedor...</option>
                  {VENDEDORES_CAMPO.map((v) => (
                    <option key={v.codigo} value={v.codigo}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted">
                Fecha de la visita coordinada
                <input
                  type="date"
                  value={fechaVisita}
                  onChange={(e) => setFechaVisita(e.target.value)}
                  className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                disabled={derivando || !derivarA}
                className="w-full rounded-lg bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
              >
                {derivando ? 'Derivando...' : 'Derivar y agendar visita'}
              </button>
              <div className="pt-2 border-t border-black/5">
                <p className="text-xs text-muted mb-2">¿O le vendiste vos directo, sin pasar por un vendedor de campo?</p>
                <button
                  type="button"
                  onClick={ventaDirecta}
                  disabled={ventaDirectaSaving}
                  className="w-full rounded-lg bg-white border border-brand text-brand py-2 text-sm font-medium disabled:opacity-50"
                >
                  {ventaDirectaSaving ? 'Guardando...' : 'Vendí yo directo'}
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <input
            placeholder={esAdmin ? 'Buscar cualquier cliente...' : 'Buscar en tu cartera...'}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-brand"
          />
          <div className="space-y-1">
            {sugerencias.map((c) => (
              <button
                key={c.cod}
                onClick={() => setCliente(c)}
                className="w-full text-left bg-white rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-brand/40"
              >
                <span className="font-medium text-ink">{c.nomcomerc || c.razon}</span>
                <span className="text-faint"> · {c.localidad}</span>
                {esAdmin && c.vendedor_asignado && <span className="text-brandDark"> · {c.vendedor_asignado}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {verHistorial && cliente && (
        <HistorialModal cliente={cliente} propuestas={propuestas} onClose={() => setVerHistorial(false)} />
      )}
    </div>
  )
}
