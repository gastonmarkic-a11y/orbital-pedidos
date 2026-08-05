import { FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'
import { TEMAS, TEMAS_ENGANCHE, metaTema } from './temasMarketing'

const CATEGORIAS = [
  { value: 'copy', label: '✏️ Copy (texto para enviar)' },
  { value: 'guion', label: '🎙️ Guión / guía' },
  { value: 'propuesta', label: '📄 Propuesta' },
  { value: 'imagen', label: '🖼️ Imagen' },
  { value: 'video', label: '🎬 Video' },
  { value: 'catalogo', label: '📖 Catálogo' },
  { value: 'precios', label: '💲 Lista de precios' },
]

const NUEVA = '__nueva__'

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
  const [temaNuevo, setTemaNuevo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [texto, setTexto] = useState('')
  const [link, setLink] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [editandoId, setEditandoId] = useState<number | null>(null)

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

  // Carpetas existentes: las conocidas (siempre) + las creadas por el equipo, con su nombre lindo y el conteo.
  const carpetas = useMemo(() => {
    const keys = [...new Set([...TEMAS.map((t) => t.key), ...piezas.map((p) => p.tema || 'general')])]
    const conocidas = TEMAS.map((t) => t.key)
    return keys
      .map((key) => ({ key, label: metaTema(key).label, n: piezas.filter((p) => (p.tema || 'general') === key).length }))
      .sort((a, b) => {
        const ia = conocidas.indexOf(a.key)
        const ib = conocidas.indexOf(b.key)
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
        return a.label.localeCompare(b.label)
      })
  }, [piezas])

  const temaEfectivo = tema === NUEVA ? temaNuevo.trim().toLowerCase() : tema

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!titulo.trim()) return
    if (tema === NUEVA && !temaNuevo.trim()) {
      setError('Poné un nombre para la carpeta nueva, o elegí una existente.')
      return
    }
    setGuardando(true)
    setError(null)
    let url: string | null = null
    if (archivo) {
      const path = `${temaEfectivo || 'general'}/${Date.now()}-${sanitize(archivo.name)}`
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
    let insErr = null
    if (editandoId) {
      const cambios: Record<string, unknown> = {
        categoria,
        tema: temaEfectivo || 'general',
        titulo: titulo.trim(),
        descripcion: descripcion.trim() || null,
        contenido_texto: texto.trim() || null,
      }
      if (url) cambios.url = url
      const { error } = await supabase.from('piezas_marketing').update(cambios).eq('id', editandoId)
      insErr = error
    } else {
      const orden = piezas.filter((p) => p.categoria === categoria).length + 1
      const { error } = await supabase.from('piezas_marketing').insert({
        categoria,
        tema: temaEfectivo || 'general',
        titulo: titulo.trim(),
        descripcion: descripcion.trim() || null,
        contenido_texto: texto.trim() || null,
        url,
        orden,
      })
      insErr = error
    }
    setGuardando(false)
    if (insErr) {
      setError(`No se pudo guardar: ${insErr.message}`)
      return
    }
    setOk(true)
    setEditandoId(null)
    if (tema === NUEVA) setTema(temaEfectivo) // deja la carpeta recién creada seleccionada
    setTemaNuevo('')
    setTitulo('')
    setDescripcion('')
    setTexto('')
    setLink('')
    setArchivo(null)
    recargar()
    setTimeout(() => setOk(false), 3000)
  }

  function editar(p: PiezaMarketing) {
    setEditandoId(p.id)
    setCategoria(p.categoria)
    setTema(p.tema ?? 'general')
    setTitulo(p.titulo)
    setDescripcion(p.descripcion ?? '')
    setTexto(p.contenido_texto ?? '')
    setLink(p.url && !p.url.startsWith('storage:') ? p.url : '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setTitulo('')
    setDescripcion('')
    setTexto('')
    setLink('')
    setArchivo(null)
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
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">{editandoId ? `✏️ Editando pieza #${editandoId}` : 'Agregar nueva pieza'}</p>
          {editandoId && (
            <button type="button" onClick={cancelarEdicion} className="text-xs text-muted underline">
              cancelar edición
            </button>
          )}
        </div>
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
          Carpeta
          <select
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink"
          >
            {carpetas.map((c) => (
              <option key={c.key} value={c.key}>
                {metaTema(c.key).icono} {c.label} ({c.n})
              </option>
            ))}
            <option value={NUEVA}>➕ Crear carpeta nueva…</option>
          </select>
        </label>
        {tema === NUEVA && (
          <label className="block text-xs text-muted -mt-1">
            Nombre de la carpeta nueva
            <input
              value={temaNuevo}
              onChange={(e) => setTemaNuevo(e.target.value.toLowerCase())}
              placeholder="ej: infrarrojo + blue cut, dia del padre..."
              className="w-full mt-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-faint"
            />
          </label>
        )}
        <p className="text-[10px] text-faint -mt-1">
          Para sumar a una carpeta que ya existe, elegila de la lista. Las carpetas{' '}
          <b>{TEMAS_ENGANCHE.join(' / ')}</b> se enganchan solas con los envíos de esa propuesta; cualquier otra queda como
          material del equipo.
        </p>
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
          {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Agregar pieza'}
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
              <p className="text-xs text-faint">
                {metaTema(p.tema || 'general').icono} {metaTema(p.tema || 'general').label} ·{' '}
                {CATEGORIAS.find((c) => c.value === p.categoria)?.label ?? p.categoria}
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <button onClick={() => editar(p)} className="text-xs font-medium text-brandDark">
                ✏️ Editar
              </button>
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
