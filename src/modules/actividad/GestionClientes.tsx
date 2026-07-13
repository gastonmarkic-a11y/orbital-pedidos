import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'
import { daysSince } from '../../lib/dates'

const ORIGEN_LABELS: Record<string, string> = {
  propio: '👤 Propio',
  asignado: '📌 Asignado',
  ex_vendedor: '⚡ Ex-vendedor',
  marketing_frio: '🌐 Marketing frío',
  con_nota: '📋 Con nota',
}

const CLASIF_LABELS: Record<string, string> = {
  sin_historial: '🔍 Contacto en frío (bienvenida)',
  activo: '✅ Cliente activo',
  fidelizacion: '⭐ Fidelizado (compra 2026)',
  '2024': '📋 A recuperar (última compra 2024)',
  '2022_2023': '📋 A recuperar (2022-23)',
  '2021_o_antes': '📋 A recuperar (2021 o antes)',
}

const DESTINOS = [
  { codigo: 'Adrian', label: 'Adrián' },
  { codigo: 'Martin', label: 'Martín' },
  { codigo: 'Corporativo', label: 'Corporativo' },
  { codigo: 'Marketing', label: 'Prospección (Luna)' },
  { codigo: 'ProspeccionVenta', label: 'Prosp. venta directa (Damián)' },
]

function origenDe(c: Cliente): string {
  const partes = [
    c.origen ? (ORIGEN_LABELS[c.origen] ?? c.origen) : null,
    c.clasificacion_recupero ? (CLASIF_LABELS[c.clasificacion_recupero] ?? c.clasificacion_recupero) : null,
    c.origen === 'ex_vendedor' && c.ex_vendedor_origen ? `ex-cartera de ${c.ex_vendedor_origen}` : null,
    c.ultima_compra_fecha ? `últ. compra ${c.ultima_compra_fecha}` : null,
  ].filter(Boolean)
  return partes.join(' · ')
}

type Seccion = 'nuevo' | 'reasignar' | 'prospeccion'

export default function GestionClientes() {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()
  const [seccion, setSeccion] = useState<Seccion>('nuevo')

  // ── 1. Nuevo prospecto ──
  const [np, setNp] = useState({ nomcomerc: '', razon: '', contacto: '', telefono: '', email: '', localidad: '', zona: '', nota: '' })
  const [npSaving, setNpSaving] = useState(false)

  async function guardarProspecto(e: FormEvent) {
    e.preventDefault()
    if (!np.nomcomerc.trim() && !np.razon.trim()) return
    setNpSaving(true)
    const codTemporal = 'TMP-' + Date.now().toString().slice(-8)
    const { error } = await supabase.from('clientes').insert({
      cod: codTemporal,
      razon: np.razon.trim() || np.nomcomerc.trim(),
      nomcomerc: np.nomcomerc.trim() || null,
      contacto: np.contacto.trim() || null,
      telefono: np.telefono.trim() || null,
      whatsapp: np.telefono.trim() || null,
      email: np.email.trim() || null,
      localidad: np.localidad.trim() || null,
      zona: np.zona.trim() || null,
      origen: 'propio',
      vendedor_asignado: codigoEfectivo,
      clasificacion_recupero: 'sin_historial',
      nota: ('⏳ Código de cliente pendiente — pedir a Administración. Sin código no se pueden cargar pedidos. ' + np.nota.trim()).trim(),
    })
    setNpSaving(false)
    if (error) {
      toast('No se pudo crear: ' + error.message, 'error')
      return
    }
    setNp({ nomcomerc: '', razon: '', contacto: '', telefono: '', email: '', localidad: '', zona: '', nota: '' })
    toast('✓ Prospecto creado en tu cartera — Administración le asigna el código de cliente', 'success')
  }

  // ── 2. Reasignar ──
  const [busquedaMio, setBusquedaMio] = useState('')
  const [mios, setMios] = useState<Cliente[]>([])
  const [elegido, setElegido] = useState<Cliente | null>(null)
  const [destino, setDestino] = useState('')
  const [motivo, setMotivo] = useState('')
  const [reasignando, setReasignando] = useState(false)

  useEffect(() => {
    if (seccion !== 'reasignar') return
    const q = busquedaMio.trim()
    if (q.length < 2) {
      setMios([])
      return
    }
    const t = setTimeout(() => {
      let query = supabase
        .from('clientes')
        .select('*')
        .or(`nomcomerc.ilike.%${q}%,razon.ilike.%${q}%,cod.ilike.%${q}%`)
        .limit(8)
      query =
        codigoEfectivo === 'Marketing'
          ? query.or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
          : query.eq('vendedor_asignado', codigoEfectivo)
      query.then(({ data }) => setMios((data as Cliente[]) ?? []))
    }, 250)
    return () => clearTimeout(t)
  }, [busquedaMio, seccion, codigoEfectivo])

  async function reasignar(e: FormEvent) {
    e.preventDefault()
    if (!elegido || !destino) return
    setReasignando(true)
    const destinoLabel = DESTINOS.find((d) => d.codigo === destino)?.label ?? destino
    const { error } = await supabase
      .from('clientes')
      .update({
        vendedor_asignado: destino,
        origen: 'asignado',
        nota: `🔄 ${new Date().toLocaleDateString('es-AR')} — reasignado de ${codigoEfectivo} a ${destinoLabel}.${motivo.trim() ? ' Motivo: ' + motivo.trim() : ''}`,
      })
      .eq('cod', elegido.cod)
    if (error) {
      toast('No se pudo reasignar: ' + error.message, 'error')
      setReasignando(false)
      return
    }
    await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: elegido.cod,
      nombre_comercio: elegido.nomcomerc,
      localidad: elegido.localidad,
      actividad_desarrollo: `Cliente reasignado a ${destinoLabel} (estaba en cartera de ${codigoEfectivo})${motivo.trim() ? ' — ' + motivo.trim() : ''}`,
    })
    setReasignando(false)
    setElegido(null)
    setDestino('')
    setMotivo('')
    setBusquedaMio('')
    toast(`✓ ${elegido.nomcomerc || elegido.razon} pasó a la cartera de ${destinoLabel}`, 'success')
  }

  // ── 3. Prospección disponible ──
  const [pool, setPool] = useState<Cliente[]>([])
  const [poolCargado, setPoolCargado] = useState(false)
  const [busquedaPool, setBusquedaPool] = useState('')
  const [tomando, setTomando] = useState<string | null>(null)

  useEffect(() => {
    if (seccion !== 'prospeccion' || poolCargado) return
    async function cargar() {
      const rows = await fetchPaged<Cliente>(() =>
        supabase
          .from('clientes')
          .select('*')
          .or('vendedor_asignado.eq.Marketing,vendedor_asignado.is.null')
          .not('origen', 'is', null)
          .order('cod')
      )
      setPool(rows)
      setPoolCargado(true)
    }
    cargar()
  }, [seccion, poolCargado])

  const poolFiltrado = useMemo(() => {
    const q = busquedaPool.trim().toLowerCase()
    let base = pool
    if (q)
      base = base.filter(
        (c) =>
          (c.nomcomerc || c.razon || '').toLowerCase().includes(q) ||
          (c.zona || '').toLowerCase().includes(q) ||
          (c.localidad || '').toLowerCase().includes(q) ||
          (c.cod || '').toLowerCase().includes(q)
      )
    return base.slice(0, 40)
  }, [pool, busquedaPool])

  async function tomarCliente(c: Cliente) {
    setTomando(c.cod)
    const { error } = await supabase
      .from('clientes')
      .update({
        vendedor_asignado: codigoEfectivo,
        nota: `➕ ${new Date().toLocaleDateString('es-AR')} — tomado de Prospección por ${codigoEfectivo}. Venía como: ${origenDe(c) || 'sin datos'}`,
      })
      .eq('cod', c.cod)
    if (error) {
      toast('No se pudo sumar: ' + error.message, 'error')
      setTomando(null)
      return
    }
    await supabase.from('actividad_diaria').insert({
      vendedor: codigoEfectivo,
      cod_cliente: c.cod,
      nombre_comercio: c.nomcomerc,
      localidad: c.localidad,
      actividad_desarrollo: `Contacto tomado de Prospección — venía como: ${origenDe(c) || 'sin datos'}`,
    })
    setPool((prev) => prev.filter((x) => x.cod !== c.cod))
    setTomando(null)
    toast(`✓ ${c.nomcomerc || c.razon} sumado a tu cartera`, 'success')
  }

  const inputCls = 'w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint'

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">Gestión de clientes</h2>
      <p className="text-xs text-muted -mt-2">
        Operando como <b>{vendedor?.rol === 'admin' ? codigoEfectivo : vendedor?.nombre}</b>
      </p>

      <div className="flex gap-2 flex-wrap">
        {(
          [
            ['nuevo', '➕ Nuevo prospecto'],
            ['reasignar', '🔄 Reasignar un cliente'],
            ['prospeccion', '🔍 Ver Prospección'],
          ] as [Seccion, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSeccion(key)}
            className={`text-xs font-semibold px-4 py-2 rounded-full border ${
              seccion === key ? 'bg-brand border-brand text-white' : 'border-black/10 text-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {seccion === 'nuevo' && (
        <form onSubmit={guardarProspecto} className="bg-white rounded-xl border border-black/10 p-4 space-y-2 max-w-lg">
          <p className="text-sm font-semibold">➕ Nuevo prospecto</p>
          <p className="text-xs text-faint">
            Se crea en tu cartera con un código provisorio. <b>Administración debe pasarte el código de cliente definitivo</b>{' '}
            para poder operar (cargar pedidos).
          </p>
          {(
            [
              ['nomcomerc', 'Nombre del comercio *'],
              ['razon', 'Razón social'],
              ['contacto', 'Nombre de contacto'],
              ['telefono', 'Teléfono / WhatsApp'],
              ['email', 'Mail'],
              ['localidad', 'Localidad'],
              ['zona', 'Zona'],
              ['nota', 'Nota'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-xs text-muted">
              {label}
              <input value={np[key]} onChange={(e) => setNp({ ...np, [key]: e.target.value })} className={inputCls} />
            </label>
          ))}
          <button
            type="submit"
            disabled={npSaving || (!np.nomcomerc.trim() && !np.razon.trim())}
            className="w-full rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold disabled:opacity-40"
          >
            {npSaving ? 'Creando...' : '+ Crear prospecto'}
          </button>
        </form>
      )}

      {seccion === 'reasignar' && (
        <div className="bg-white rounded-xl border border-black/10 p-4 space-y-3 max-w-lg">
          <p className="text-sm font-semibold">🔄 Reasignar un cliente a otro vendedor</p>
          <p className="text-xs text-faint">
            Para cuando el cliente no es tuyo o no lo vas a desarrollar. Queda registrado quién lo pasó, a quién y de
            dónde venía.
          </p>
          {!elegido ? (
            <>
              <input
                placeholder="Buscar en tu cartera por nombre o código..."
                value={busquedaMio}
                onChange={(e) => setBusquedaMio(e.target.value)}
                className={inputCls}
              />
              <div className="space-y-1">
                {mios.map((c) => (
                  <button
                    key={c.cod}
                    onClick={() => setElegido(c)}
                    className="w-full text-left rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-gold/60"
                  >
                    <span className="font-medium">{c.nomcomerc || c.razon}</span>
                    <span className="text-faint"> · {c.cod}</span>
                    <span className="block text-[11px] text-muted">{origenDe(c)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form onSubmit={reasignar} className="space-y-3">
              <div className="bg-[#F1EDE4] rounded-lg p-3">
                <p className="text-sm font-semibold">{elegido.nomcomerc || elegido.razon}</p>
                <p className="text-[11px] text-muted">
                  {elegido.cod} · {elegido.localidad || '—'} · viene como: {origenDe(elegido) || 'sin datos'}
                </p>
                <button type="button" onClick={() => setElegido(null)} className="text-xs text-brandDark mt-1">
                  cambiar cliente
                </button>
              </div>
              <label className="block text-xs text-muted">
                Pasar a
                <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inputCls}>
                  <option value="">Elegir vendedor...</option>
                  {DESTINOS.filter((d) => d.codigo !== codigoEfectivo).map((d) => (
                    <option key={d.codigo} value={d.codigo}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-muted">
                Motivo (opcional)
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder='Ej: "es de su zona", "ya lo atiende él"...'
                  className={inputCls}
                />
              </label>
              <button
                type="submit"
                disabled={reasignando || !destino}
                className="w-full rounded-lg bg-brand text-white py-2 text-sm font-semibold disabled:opacity-40"
              >
                {reasignando ? 'Reasignando...' : 'Reasignar cliente'}
              </button>
            </form>
          )}
        </div>
      )}

      {seccion === 'prospeccion' && (
        <div className="space-y-2">
          <div className="bg-white rounded-xl border border-black/10 p-4">
            <p className="text-sm font-semibold">🔍 Contactos disponibles en Prospección</p>
            <p className="text-xs text-faint mb-2">
              {poolCargado ? `${pool.length} contactos sin dueño o en Prospección.` : 'Cargando...'} Cada uno muestra de
              dónde viene. Al sumarlo pasa a tu cartera y queda registrado.
            </p>
            <input
              placeholder="Buscar por nombre, zona, localidad o código..."
              value={busquedaPool}
              onChange={(e) => setBusquedaPool(e.target.value)}
              className={inputCls}
            />
          </div>
          {poolFiltrado.map((c) => {
            const dias = daysSince(null)
            void dias
            return (
              <div key={c.cod} className="bg-white rounded-xl border border-black/10 p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{c.nomcomerc || c.razon}</p>
                  <p className="text-[11px] text-faint">
                    {c.cod} · {c.zona || c.localidad || '—'} {c.whatsapp ? `· 📱 ${c.whatsapp}` : ''}
                  </p>
                  <p className="text-xs text-muted mt-0.5">Viene como: {origenDe(c) || 'sin datos de origen'}</p>
                  {c.nota && <p className="text-[11px] text-faint truncate">📝 {c.nota}</p>}
                </div>
                <button
                  onClick={() => tomarCliente(c)}
                  disabled={tomando === c.cod}
                  className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-40 shrink-0"
                >
                  {tomando === c.cod ? 'Sumando...' : '➕ Sumar a mi cartera'}
                </button>
              </div>
            )
          })}
          {poolCargado && poolFiltrado.length === 0 && (
            <p className="text-sm text-faint text-center py-6 bg-white rounded-xl border border-black/10">Sin resultados.</p>
          )}
          {poolFiltrado.length === 40 && (
            <p className="text-[11px] text-faint text-center">Mostrando 40 — usá el buscador para encontrar más.</p>
          )}
        </div>
      )}
    </div>
  )
}
