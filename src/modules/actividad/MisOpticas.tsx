import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RefreshCw, Search, Phone, MessageCircle, ChevronDown } from 'lucide-react'
import { parseTelefonos, abrirWhatsApp } from '../../lib/telefono'

// Mis ópticas — lo que ve el revendedor de los clientes que comparte con los vendedores (cliente_revendedor).
// Solo lectura: se mira, se toca para ver el contacto y se llama. Lo que pasó con cada óptica se marca
// en el grupo de Telegram (botones de Ojo), así queda como actividad y lo ve todo el equipo.
// Quien vende se la queda; si un vendedor la está trabajando, acá dice «no tocar».

interface Optica {
  cod: string
  nombre: string | null
  localidad: string | null
  provincia: string | null
  telefono: string | null
  vendedor: string | null
  ultima_compra: string | null
  ya_compro: boolean
  charla_vendedor: string | null
  charla_fecha: string | null
  hoy_orden: number | null
  hoy_motivo: string | null
  mi_resultado: string | null
  mi_resultado_fecha: string | null
}

type Filtro = 'todas' | 'libres' | 'no_tocar' | 'compraron'

const RESULTADO: Record<string, string> = {
  hablo: '📞 Hablaron',
  reunion: '📅 Reunión',
  pedido: '🛒 Va a comprar',
  no_interesa: '✖️ No le interesa',
  no_atiende: '🔕 No atiende',
}

const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const mmaa = (d: string | null) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
const SALUDO = 'Hola! Te escribo de parte de Orbital Eyewear, anteojos de fabricación nacional.'

export default function MisOpticas() {
  const [filas, setFilas] = useState<Optica[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('revendedor_compartidas')
    setError(error ? 'No pude traer tus ópticas. Probá de nuevo en un rato.' : null)
    setFilas((data as Optica[]) ?? [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const hoy = useMemo(() => filas.filter((f) => f.hoy_orden != null).sort((a, b) => (a.hoy_orden ?? 0) - (b.hoy_orden ?? 0)), [filas])
  const cuenta = useMemo(() => ({
    todas: filas.length,
    libres: filas.filter((f) => !f.charla_vendedor).length,
    no_tocar: filas.filter((f) => f.charla_vendedor).length,
    compraron: filas.filter((f) => f.ya_compro).length,
  }), [filas])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return filas.filter((f) => {
      if (filtro === 'libres' && f.charla_vendedor) return false
      if (filtro === 'no_tocar' && !f.charla_vendedor) return false
      if (filtro === 'compraron' && !f.ya_compro) return false
      if (!q) return true
      return `${f.nombre ?? ''} ${f.localidad ?? ''}`.toLowerCase().includes(q)
    })
  }, [filas, busca, filtro])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Mis ópticas</h1>
          <button onClick={cargar} className="p-2 rounded-lg border hover:bg-gray-50" aria-label="Actualizar">
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="text-sm text-gray-600">
          Ópticas de tu zona que compartís con los vendedores de Orbital. Quien le vende, se la queda.
          Lo que pase con cada una lo marcás en el grupo de Telegram.
        </p>
      </header>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

      {/* Hoy: las mismas que manda Ojo a la mañana */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Hoy te conviene hablar con</h2>
        {hoy.length === 0 ? (
          <p className="text-sm text-gray-500 border rounded-lg p-4">
            {cargando ? 'Cargando…' : 'Todavía no hay sugeridas para hoy. Salen de lunes a viernes a las 9.'}
          </p>
        ) : (
          <div className="grid gap-2">
            {hoy.map((f) => <Tarjeta key={f.cod} f={f} abierta={abierta === f.cod} onToggle={() => setAbierta(abierta === f.cod ? null : f.cod)} destacada />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Todas</h2>
        <div className="flex flex-wrap gap-2">
          {([
            ['todas', 'Todas'],
            ['libres', 'Libres'],
            ['no_tocar', 'Con vendedor'],
            ['compraron', 'Ya nos compraron'],
          ] as [Filtro, string][]).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`text-sm px-3 py-1.5 rounded-full border ${filtro === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50'}`}
            >
              {l} <span className="tabular-nums opacity-70">{cuenta[k]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-white">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            id="buscar-opticas"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre o localidad"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </label>
        <div className="grid gap-2">
          {lista.map((f) => <Tarjeta key={f.cod} f={f} abierta={abierta === f.cod} onToggle={() => setAbierta(abierta === f.cod ? null : f.cod)} />)}
          {!cargando && lista.length === 0 && <p className="text-sm text-gray-500 p-4 text-center">No hay ópticas con ese filtro.</p>}
        </div>
      </section>
    </div>
  )
}

function Tarjeta({ f, abierta, onToggle, destacada }: { f: Optica; abierta: boolean; onToggle: () => void; destacada?: boolean }) {
  const nums = parseTelefonos(f.telefono, true)
  const noTocar = !!f.charla_vendedor
  return (
    <div className={`border rounded-xl bg-white ${noTocar ? 'border-amber-300' : destacada ? 'border-blue-300' : ''}`}>
      <button onClick={onToggle} className="w-full text-left p-3 flex items-start gap-3" aria-expanded={abierta}>
        {destacada && f.hoy_orden != null && (
          <span className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold grid place-items-center">{f.hoy_orden}</span>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{f.nombre ?? f.cod}</p>
          <p className="text-sm text-gray-500 truncate">{[f.localidad, f.provincia].filter(Boolean).join(', ')}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {noTocar && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                No tocar · {f.charla_vendedor} habló el {ddmm(f.charla_fecha)}
              </span>
            )}
            {f.ya_compro && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Compró hasta {mmaa(f.ultima_compra)}</span>}
            {f.mi_resultado && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                {RESULTADO[f.mi_resultado] ?? f.mi_resultado} · {ddmm(f.mi_resultado_fecha)}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 mt-1 text-gray-400 transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>
      {abierta && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3 text-sm">
          {destacada && f.hoy_motivo && <p className="text-gray-700">{f.hoy_motivo}</p>}
          {noTocar && (
            <p className="text-amber-800 bg-amber-50 rounded-lg p-2">
              La está trabajando {f.charla_vendedor}. Esperá a que la suelte o preguntá en el grupo antes de contactarla.
            </p>
          )}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-gray-500">Vendedor</dt><dd>{f.vendedor ?? 'Sin asignar'}</dd>
            <dt className="text-gray-500">Teléfono</dt><dd className="break-all">{f.telefono ?? 'Sin teléfono'}</dd>
          </dl>
          {nums.length > 0 && !noTocar && (
            <div className="flex flex-wrap gap-2">
              {nums.map((n) => (
                <span key={n.nacional} className="flex gap-2">
                  <a href={n.telHref} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-gray-50">
                    <Phone className="w-4 h-4" /> Llamar
                  </a>
                  <button onClick={() => abrirWhatsApp(n.wa, SALUDO)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border hover:bg-gray-50">
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
