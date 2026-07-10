import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'

const CATEGORIAS: Record<string, string> = {
  copy: '✏️ Copys',
  guion: '🎙️ Guiones y guías',
  propuesta: '📄 Propuestas',
  imagen: '🖼️ Imágenes',
  video: '🎬 Videos',
  catalogo: '📖 Catálogos',
  precios: '💲 Lista de precios',
}
const ORDEN_CAT = ['propuesta', 'copy', 'guion', 'catalogo', 'video', 'imagen', 'precios']

const TEMAS: { key: string; icono: string; label: string; desc: string }[] = [
  { key: 'bienvenida', icono: '🤝', label: 'Propuesta Bienvenida', desc: 'Todo para sumar ópticas nuevas: copy, guión, propuesta y video' },
  { key: 'canje', icono: '↩', label: 'Plan Canje', desc: 'Material para clientes activos con stock parado' },
  { key: 'preventa', icono: '🕶', label: 'Preventa Colección', desc: 'Copy, guión y catálogo de la preventa 2026' },
  { key: 'recuperar', icono: '📋', label: 'Clientes a Recuperar', desc: 'Guías de diagnóstico y propuesta segmentada' },
  { key: 'general', icono: '📚', label: 'Material general', desc: 'Listas de precios, catálogos, imágenes y videos' },
]

export default function Marketing() {
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [loading, setLoading] = useState(true)
  const [copiado, setCopiado] = useState<number | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)
  const [tema, setTema] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('piezas_marketing')
      .select('*')
      .order('orden')
      .then(({ data }) => {
        setPiezas((data as PiezaMarketing[]) ?? [])
        setLoading(false)
      })
  }, [])

  async function copiar(id: number, texto: string) {
    await navigator.clipboard.writeText(texto)
    setCopiado(id)
    setTimeout(() => setCopiado(null), 2000)
  }

  async function abrir(id: number, url: string) {
    if (!url.startsWith('storage:')) {
      window.open(url, '_blank', 'noreferrer')
      return
    }
    setAbriendo(id)
    const path = url.slice(8)
    const { data, error } = await supabase.storage.from('marketing').createSignedUrl(path, 300)
    setAbriendo(null)
    if (error || !data) {
      window.alert('No se pudo abrir el archivo. Avisale al admin.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noreferrer')
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando piezas de marketing...</p>

  const activas = piezas.filter((p) => p.activa)
  const temaDe = (p: PiezaMarketing) => p.tema || 'general'

  // Paso 1: elegir el tema
  if (!tema) {
    return (
      <div className="space-y-4 text-ink">
        <h2 className="text-base font-semibold">Piezas de Marketing</h2>
        <p className="text-xs text-muted">Elegí el tema y vas a ver todo el material relacionado, listo para usar.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEMAS.map((t) => {
            const n = activas.filter((p) => temaDe(p) === t.key).length
            if (n === 0) return null
            return (
              <button
                key={t.key}
                onClick={() => setTema(t.key)}
                className="bg-white border border-black/10 rounded-2xl p-4 text-left hover:border-brand/50 transition-colors flex items-start gap-3"
              >
                <span className="text-3xl">{t.icono}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className="block text-xs text-muted mt-0.5">{t.desc}</span>
                  <span className="block text-[11px] text-brandDark font-medium mt-1">
                    {n} pieza{n !== 1 ? 's' : ''} →
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {activas.length === 0 && (
          <p className="text-sm text-faint text-center py-10">Todavía no hay piezas cargadas. Pedile al admin que suba material.</p>
        )}
      </div>
    )
  }

  // Paso 2: material del tema, agrupado por tipo
  const temaInfo = TEMAS.find((t) => t.key === tema)
  const delTema = activas.filter((p) => temaDe(p) === tema)
  const grupos = ORDEN_CAT.map((cat) => ({ categoria: cat, items: delTema.filter((p) => p.categoria === cat) })).filter(
    (g) => g.items.length > 0
  )

  return (
    <div className="space-y-5 text-ink">
      <div className="flex items-center gap-3">
        <button onClick={() => setTema(null)} className="text-sm text-brandDark font-medium">
          ← Temas
        </button>
        <h2 className="text-base font-semibold">
          {temaInfo?.icono} {temaInfo?.label}
        </h2>
      </div>
      {grupos.map((g) => (
        <div key={g.categoria} className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">{CATEGORIAS[g.categoria]}</p>
          <div className="space-y-2">
            {g.items.map((p) => (
              <div key={p.id} className="bg-white border border-black/10 rounded-xl p-3">
                <p className="text-sm font-medium text-ink">{p.titulo}</p>
                {p.descripcion && <p className="text-xs text-muted mt-0.5">{p.descripcion}</p>}
                {p.contenido_texto && (
                  <p className="text-xs text-ink bg-[#f7f7fa] rounded-lg p-2 mt-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {p.contenido_texto}
                  </p>
                )}
                <div className="flex gap-3 mt-2">
                  {p.contenido_texto && (
                    <button onClick={() => copiar(p.id, p.contenido_texto!)} className="text-xs font-medium text-brandDark">
                      {copiado === p.id ? '✓ Copiado' : 'Copiar texto'}
                    </button>
                  )}
                  {p.url && (
                    <button
                      onClick={() => abrir(p.id, p.url!)}
                      disabled={abriendo === p.id}
                      className="text-xs font-medium text-brandDark disabled:opacity-50"
                    >
                      {abriendo === p.id ? 'Abriendo...' : 'Abrir / Descargar →'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
