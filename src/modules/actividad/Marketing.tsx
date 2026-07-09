import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'

const CATEGORIAS: Record<string, string> = {
  copy: '✏️ Copys',
  guion: '🎙️ Guiones y guías',
  propuesta: '📄 Propuestas',
  imagen: '🖼️ Imágenes',
  video: '🎬 Videos',
  catalogo: '📖 Catálogo',
  precios: '💲 Lista de precios',
}
const ORDEN = ['copy', 'guion', 'propuesta', 'imagen', 'video', 'catalogo', 'precios']

export default function Marketing() {
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [loading, setLoading] = useState(true)
  const [copiado, setCopiado] = useState<number | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)

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

  const grupos = ORDEN.map((cat) => ({ categoria: cat, items: piezas.filter((p) => p.categoria === cat && p.activa) })).filter(
    (g) => g.items.length > 0
  )

  return (
    <div className="space-y-5 text-ink">
      <h2 className="text-base font-semibold">Piezas de Marketing</h2>
      {grupos.length === 0 && (
        <p className="text-sm text-faint text-center py-10">
          Todavía no hay piezas cargadas. Pedile al admin que suba copys, propuestas, imágenes, videos, catálogo o
          lista de precios.
        </p>
      )}
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
