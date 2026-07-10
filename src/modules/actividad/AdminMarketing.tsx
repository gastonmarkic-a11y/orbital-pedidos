import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'

const CATEGORIAS = [
  { value: 'copy', label: '✏️ Copy (texto para enviar)' },
  { value: 'guion', label: '🎙️ Guión / guía' },
  { value: 'propuesta', label: '📄 Propuesta' },
  { value: 'imagen', label: '🖼️ Imagen' },
  { value: 'video', label: '🎬 Video' },
  { value: 'catalogo', label: '📖 Catálogo' },
  { value: 'precios', label: '💲 Lista de precios' },
]

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export default function AdminMarketing() {
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoria, setCategoria] = useState('catalogo')
  const [tema, setTema] = useState('general')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [texto, setTexto] = useState('')
  const [link, setLink] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)

  function recargar() {
    supabase
      .from('piezas_marketing')
      .select('*')
      .order('categoria')
      .order('orden')
      .then(({ data }) => {
        setPiezas((data as PiezaMarketing[]) ?? [])
        setLoading(false)
      })
  }

  useEffect(recargar, [])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) return
    setGuardando(true)
    setError(null)
    let url: string | null = null
    if (archivo) {
      const path = `${categoria}/${Date.now()}-${sanitize(archivo.name)}`
      const { error: upErr } = await supabase.storage.from('marketing').upload(path, archivo)
      if (upErr) {
        setError(`No se pudo subir el archivo: ${upErr.message}`)
        setGuardando(false)
        return
      }
      url = `storage:${path}`
    } else if (link.trim()) {
      url = link.trim()
    }
    const orden = piezas.filter((p) => p.categoria === categoria).length + 1
    const { error: insErr } = await supabase.from('piezas_marketing').insert({
      categoria,
      tema,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      contenido_texto: texto.trim() || null,
      url,
      orden,
    })
    setGuardando(false)
    if (insErr) {
      setError(`No se pudo guardar: ${insErr.message}`)
      return
    }
    setOk(true)
    setTitulo('')
    setDescripcion('')
    setTexto('')
    setLink('')
    setArchivo(null)
    recargar()
    setTimeout(() => setOk(false), 3000)
  }

  async function toggle(p: PiezaMarketing) {
    await supabase.from('piezas_marketing').update({ activa: !p.activa }).eq('id', p.id)
    recargar()
  }

  async function eliminar(p: PiezaMarketing) {
    if (!window.confirm(`¿Eliminar "${p.titulo}"?`)) return
    if (p.url?.startsWith('storage:')) await supabase.storage.from('marketing').remove([p.url.slice(8)])
    await supabase.from('piezas_marketing').delete().eq('id', p.id)
    recargar()
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando...</p>

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">Gestionar Piezas de Marketing</h2>
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-lg p-3">
          Pieza guardada ✓
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <form onSubmit={agregar} className="space-y-3 bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold text-ink">Agregar nueva pieza</p>
        <label className="block text-xs text-muted">
          Categoría
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Tema (propuesta a la que pertenece)
          <select
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          >
            <option value="bienvenida">🤝 Propuesta Bienvenida</option>
            <option value="canje">↩ Plan Canje</option>
            <option value="preventa">🕶 Preventa Colección</option>
            <option value="recuperar">📋 Clientes a Recuperar</option>
            <option value="general">📚 Material general</option>
          </select>
        </label>
        <label className="block text-xs text-muted">
          Título
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            required
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Descripción (opcional)
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Texto para copiar / leer (opcional — usalo para copys y guiones)
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="block text-xs text-muted">
          Archivo (PDF, imagen, video — hasta 50MB)
          <input
            type="file"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="w-full mt-1 text-sm text-ink"
          />
        </label>
        {!archivo && (
          <label className="block text-xs text-muted">
            O link externo (Google Drive, Dropbox, etc. — para archivos de más de 50MB)
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://drive.google.com/..."
              className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={guardando}
          className="w-full rounded-lg bg-brand text-white py-2 text-sm font-medium disabled:opacity-50"
        >
          {guardando ? 'Guardando...' : 'Agregar pieza'}
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">Piezas cargadas ({piezas.length})</p>
        {piezas.map((p) => (
          <div key={p.id} className="bg-white border border-black/10 rounded-xl p-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-ink">
                {p.titulo} {!p.activa && <span className="text-[10px] text-faint">(oculta)</span>}
              </p>
              <p className="text-xs text-faint">{CATEGORIAS.find((c) => c.value === p.categoria)?.label ?? p.categoria}</p>
            </div>
            <div className="flex gap-3 shrink-0">
              <button onClick={() => toggle(p)} className="text-xs font-medium text-brandDark">
                {p.activa ? 'Ocultar' : 'Mostrar'}
              </button>
              <button onClick={() => eliminar(p)} className="text-xs font-medium text-red-600">
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
