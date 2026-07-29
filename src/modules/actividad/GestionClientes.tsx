import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Cliente } from '../../lib/types'
import { daysSince, ymd } from '../../lib/dates'

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

type Seccion = 'resumen' | 'buscar' | 'nuevo' | 'reasignar' | 'prospeccion'

interface ContactoBusqueda {
  cod: string
  razon: string | null
  nomcomerc: string | null
  localidad: string | null
  zona: string | null
  whatsapp: string | null
  telefono: string | null
  vendedor_asignado: string | null
  clasificacion_recupero: string | null
  ultima_compra_fecha: string | null
}

interface FilaSemaforo {
  cod: string
  nombre: string | null
  zona: string | null
  whatsapp: string | null
  telefono: string | null
  vendedor_asignado: string | null
  derivado_por: string | null
  proxima_agenda_fecha: string | null
  ultima_actividad: string | null
  ultima_compra_fecha: string | null
}

export default function GestionClientes() {
  const { vendedor, codigoEfectivo } = useAuth()
  const toast = useToast()
  const [seccion, setSeccion] = useState<Seccion>('resumen')
  const esProsp = codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'

  // ── 0. Resumen / semáforo de la cartera ──
  const [filas, setFilas] = useState<FilaSemaforo[] | null>(null)
  const [resumenLoading, setResumenLoading] = useState(false)
  const [bucketSel, setBucketSel] = useState<string | null>(null)

  useEffect(() => {
    if (seccion !== 'resumen') return
    setResumenLoading(true)
    supabase.rpc('cartera_semaforo', { p_codigo: codigoEfectivo }).then(({ data, error }) => {
      setResumenLoading(false)
      if (error) {
        toast('No se pudo cargar el resumen: ' + error.message, 'error')
        setFilas([])
        return
      }
      setFilas((data as FilaSemaforo[]) ?? [])
    })
  }, [seccion, codigoEfectivo, toast])

  // Cada contacto cae en UN color, por prioridad: derivado > agenda vencida > por recencia de contacto
  const buckets = useMemo(() => {
    const hoyStr = ymd(new Date())
    const b: Record<string, FilaSemaforo[]> = { verde: [], amarillo: [], rojo: [], azul: [], rosa: [] }
    for (const f of filas ?? []) {
      const derivadoRelevante = esProsp ? f.derivado_por === codigoEfectivo : !!f.derivado_por
      if (derivadoRelevante) {
        b.rosa.push(f)
        continue
      }
      if (f.proxima_agenda_fecha && f.proxima_agenda_fecha < hoyStr) {
        b.azul.push(f)
        continue
      }
      const d = daysSince(f.ultima_actividad)
      if (d === null || d > 30) b.rojo.push(f)
      else if (d > 7) b.amarillo.push(f)
      else b.verde.push(f)
    }
    return b
  }, [filas, esProsp, codigoEfectivo])

  // ── 0b. Búsqueda general en toda la base ──
  const [busq, setBusq] = useState('')
  const [resultados, setResultados] = useState<ContactoBusqueda[] | null>(null)
  const [buscando, setBuscando] = useState(false)

  async function buscarGeneral(e?: FormEvent) {
    e?.preventDefault()
    const q = busq.trim()
    if (q.length < 2) {
      toast('Escribí al menos 2 caracteres', 'error')
      return
    }
    setBuscando(true)
    const { data, error } = await supabase.rpc('buscar_contactos', { q })
    setBuscando(false)
    if (error) {
      toast('No se pudo buscar: ' + error.message, 'error')
      return
    }
    setResultados((data as ContactoBusqueda[]) ?? [])
  }

  async function sumarDesdeBusqueda(c: ContactoBusqueda) {
    const { error } = await supabase
      .from('clientes')
      .update({
        vendedor_asignado: codigoEfectivo,
        nota: `➕ ${new Date().toLocaleDateString('es-AR')} — sumado a la cartera de ${codigoEfectivo} desde la búsqueda general.`,
      })
      .eq('cod', c.cod)
    if (error) {
      toast('No se pudo sumar: ' + error.message, 'error')
      return
    }
    setResultados((prev) => (prev ? prev.map((x) => (x.cod === c.cod ? { ...x, vendedor_asignado: codigoEfectivo } : x)) : prev))
    toast(`✓ ${c.nomcomerc || c.razon} sumado a tu cartera`, 'success')
  }

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
        codigoEfectivo === 'Marketing' || codigoEfectivo === 'Damian'
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
            ['resumen', '📊 Resumen'],
            ['buscar', '🔎 Buscar en la base'],
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

      {seccion === 'resumen' && (
        <div className="space-y-3">
          {resumenLoading ? (
            <p className="text-sm text-muted p-2">Cargando resumen...</p>
          ) : (
            (() => {
              const total = filas?.length ?? 0
              const contactados = buckets.verde.length + buckets.amarillo.length
              const tiles = [
                { key: 'verde', label: 'Contactado ≤7 días', dot: 'bg-emerald-500', ring: 'border-emerald-500', n: buckets.verde.length },
                { key: 'amarillo', label: 'Hasta 30 días', dot: 'bg-amber-500', ring: 'border-amber-500', n: buckets.amarillo.length },
                { key: 'rojo', label: '+30 días sin contacto', dot: 'bg-red-500', ring: 'border-red-500', n: buckets.rojo.length },
                { key: 'azul', label: 'Agenda vencida', dot: 'bg-blue-500', ring: 'border-blue-500', n: buckets.azul.length },
                { key: 'rosa', label: esProsp ? 'Derivados por vos' : 'Derivados de prospección', dot: 'bg-pink-500', ring: 'border-pink-500', n: buckets.rosa.length },
              ]
              return (
                <>
                  <p className="text-xs text-muted">
                    {total} contactos en tu cartera · <b className="text-emerald-600">{contactados} contactados</b> (≤30d) ·{' '}
                    <b className="text-red-600">{buckets.rojo.length} para retomar</b>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {tiles.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setBucketSel(bucketSel === t.key ? null : t.key)}
                        className={`bg-white border rounded-xl p-3 text-left ${bucketSel === t.key ? t.ring : 'border-black/10'}`}
                      >
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${t.dot} mb-1`} />
                        <p className="text-2xl font-bold">{t.n}</p>
                        <p className="text-[11px] text-muted leading-tight">{t.label}</p>
                      </button>
                    ))}
                  </div>
                  {bucketSel && (
                    <div className="space-y-1.5">
                      {(buckets[bucketSel] ?? []).slice(0, 100).map((f) => (
                        <div key={f.cod} className="bg-white border border-black/10 rounded-lg p-2.5 text-sm flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{f.nombre}</p>
                            <p className="text-[11px] text-muted">
                              {f.cod} · {f.zona || '—'}
                              {f.ultima_actividad ? ` · últ. contacto hace ${daysSince(f.ultima_actividad)}d` : ' · sin contacto registrado'}
                              {f.proxima_agenda_fecha ? ` · agenda ${f.proxima_agenda_fecha}` : ''}
                            </p>
                          </div>
                          {(f.whatsapp || f.telefono) && (
                            <span className="text-[11px] text-brandDark whitespace-nowrap">📞 {f.whatsapp || f.telefono}</span>
                          )}
                        </div>
                      ))}
                      {(buckets[bucketSel] ?? []).length > 100 && (
                        <p className="text-[11px] text-faint text-center">Mostrando 100 de {buckets[bucketSel].length}.</p>
                      )}
                    </div>
                  )}
                  {total === 0 && (
                    <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">
                      {vendedor?.rol === 'admin'
                        ? 'Usá el selector 👁 "ver como" un vendedor para ver su resumen.'
                        : 'No tenés contactos en tu cartera todavía.'}
                    </p>
                  )}
                </>
              )
            })()
          )}
        </div>
      )}

      {seccion === 'buscar' && (
        <div className="space-y-2">
          <div className="bg-white rounded-xl border border-black/10 p-4">
            <p className="text-sm font-semibold">🔎 Buscar en toda la base</p>
            <p className="text-xs text-faint mb-2">
              Busca en <b>todos</b> los contactos (aunque no sean tuyos) por nombre, razón social, código o teléfono.
            </p>
            <form onSubmit={buscarGeneral} className="flex gap-2">
              <input
                value={busq}
                onChange={(e) => setBusq(e.target.value)}
                placeholder="Nombre, código o teléfono..."
                className={inputCls + ' !mt-0'}
              />
              <button
                type="submit"
                disabled={buscando}
                className="rounded-lg bg-brand text-white px-4 text-sm font-semibold disabled:opacity-50 shrink-0"
              >
                {buscando ? '...' : 'Buscar'}
              </button>
            </form>
          </div>
          {resultados?.map((c) => {
            const mio = c.vendedor_asignado === codigoEfectivo
            const tomable = !c.vendedor_asignado || c.vendedor_asignado === 'Marketing'
            return (
              <div key={c.cod} className="bg-white rounded-xl border border-black/10 p-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">
                    {c.nomcomerc || c.razon} <span className="text-faint font-normal">· {c.cod}</span>
                  </p>
                  <p className="text-[11px] text-muted">
                    {c.zona || c.localidad || '—'}
                    {c.whatsapp ? ` · 📱 ${c.whatsapp}` : c.telefono ? ` · 📞 ${c.telefono}` : ''}
                    {c.ultima_compra_fecha ? ` · últ. compra ${c.ultima_compra_fecha}` : ''}
                  </p>
                  <p className="text-[11px] mt-0.5">
                    {mio ? (
                      <span className="text-emerald-700 font-medium">✓ En tu cartera</span>
                    ) : c.vendedor_asignado ? (
                      <span className="text-muted">
                        En cartera de <b>{c.vendedor_asignado}</b>
                      </span>
                    ) : (
                      <span className="text-amber-700">Sin asignar</span>
                    )}
                  </p>
                </div>
                {!mio && tomable && (
                  <button
                    onClick={() => sumarDesdeBusqueda(c)}
                    className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold shrink-0"
                  >
                    ➕ Sumar a mi cartera
                  </button>
                )}
              </div>
            )
          })}
          {resultados && resultados.length === 0 && (
            <p className="text-sm text-faint text-center py-6 bg-white rounded-xl border border-black/10">Sin resultados en toda la base.</p>
          )}
        </div>
      )}

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
