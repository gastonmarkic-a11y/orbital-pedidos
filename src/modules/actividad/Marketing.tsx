import { DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { PiezaMarketing } from '../../lib/types'
import { TEMAS, metaTema } from './temasMarketing'
import { RUBROS, mensajePara } from '../../lib/guiones'

const CATEGORIAS: Record<string, string> = {
  copy: '✏️ Copy', guion: '🎙️ Guión', propuesta: '📄 Propuesta', imagen: '🖼️ Imagen',
  video: '🎬 Video', catalogo: '📖 Catálogo', precios: '💲 Precios',
}
const ICONO_CAT: Record<string, string> = { copy: '✏️', guion: '🎙️', propuesta: '📄', imagen: '🖼️', video: '🎬', catalogo: '📖', precios: '💲' }

// Carpeta virtual de Guiones (unificada dentro de Marketing).
const TEMA_GUIONES = 'guiones-contacto'
const limpioEnvio = (t: string) => t.replace(/[«»]/g, '')

function catDeArchivo(f: File): string {
  const t = f.type
  if (t.startsWith('image/')) return 'imagen'
  if (t.startsWith('video/')) return 'video'
  if (t === 'application/pdf') return 'propuesta'
  return 'copy'
}
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9.\-_]/g, '_')

export default function Marketing() {
  const { vendedor } = useAuth()
  const toast = useToast()
  const puedeEditar = vendedor?.rol === 'admin'
  const [piezas, setPiezas] = useState<PiezaMarketing[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<string | null>(null) // 'pieza:<id>' | 'guion:<rubroId>'
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [subiendo, setSubiendo] = useState(false)
  const [dragTema, setDragTema] = useState<string | null>(null)
  const [copiado, setCopiado] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [editando, setEditando] = useState<PiezaMarketing | null>(null)
  const [edTitulo, setEdTitulo] = useState(''); const [edDesc, setEdDesc] = useState(''); const [edTexto, setEdTexto] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function recargar() {
    supabase.from('piezas_marketing').select('*').order('orden').then(({ data }) => {
      setPiezas((data as PiezaMarketing[]) ?? []); setLoading(false)
    })
  }
  useEffect(recargar, [])

  const activas = useMemo(() => piezas.filter((p) => p.activa), [piezas])
  const temaDe = (p: PiezaMarketing) => p.tema || 'general'

  // Carpetas: conocidas presentes + custom + la virtual de Guiones
  const carpetas = useMemo(() => {
    const conocidas = TEMAS.map((t) => t.key).filter((k) => activas.some((p) => temaDe(p) === k))
    const custom = [...new Set(activas.map(temaDe))].filter((k) => !TEMAS.some((t) => t.key === k)).sort()
    return [TEMA_GUIONES, ...conocidas, ...custom]
  }, [activas])

  const metaCarpeta = (key: string) => key === TEMA_GUIONES
    ? { icono: '🎙️', label: 'Guiones de contacto', desc: 'Mensajes por rubro (Triple Protección)' }
    : metaTema(key)

  function toggleCarpeta(key: string) {
    setAbiertos((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  async function seleccionar(key: string) {
    setSel(key); setPreviewUrl(null)
    if (key.startsWith('pieza:')) {
      const p = activas.find((x) => `pieza:${x.id}` === key)
      if (p?.url?.startsWith('storage:') && p.categoria === 'imagen') {
        const { data } = await supabase.storage.from('marketing').createSignedUrl(p.url.slice(8), 600)
        if (data) setPreviewUrl(data.signedUrl)
      }
    }
  }

  async function abrirArchivo(url: string) {
    if (!url.startsWith('storage:')) { window.open(url, '_blank', 'noreferrer'); return }
    const { data } = await supabase.storage.from('marketing').createSignedUrl(url.slice(8), 300)
    if (data) window.open(data.signedUrl, '_blank', 'noreferrer')
    else toast('No se pudo abrir el archivo', 'error')
  }

  async function subir(files: FileList | null, tema: string) {
    if (!files || !files.length) return
    setSubiendo(true)
    let ok = 0
    for (const f of Array.from(files)) {
      const path = `${tema}/${Date.now()}-${sanitize(f.name)}`
      const { error } = await supabase.storage.from('marketing').upload(path, f)
      if (error) { toast(`Error subiendo ${f.name}: ${error.message}`, 'error'); continue }
      await supabase.from('piezas_marketing').insert({ tema, categoria: catDeArchivo(f), titulo: f.name, url: `storage:${path}`, activa: true, orden: 999 })
      ok++
    }
    setSubiendo(false)
    if (ok) { toast(`✓ ${ok} archivo(s) subido(s) a ${metaCarpeta(tema).label}`, 'success'); recargar() }
  }
  function onDrop(e: DragEvent, tema: string) { e.preventDefault(); setDragTema(null); subir(e.dataTransfer.files, tema) }

  async function copiar(id: string, texto: string) { await navigator.clipboard.writeText(texto); setCopiado(id); setTimeout(() => setCopiado(''), 1500) }

  function abrirEdicion(p: PiezaMarketing) { setEditando(p); setEdTitulo(p.titulo); setEdDesc(p.descripcion ?? ''); setEdTexto(p.contenido_texto ?? '') }
  async function guardarEdicion() {
    if (!editando) return
    const cambios = { titulo: edTitulo.trim() || editando.titulo, descripcion: edDesc.trim() || null, contenido_texto: edTexto.trim() || null }
    const { error } = await supabase.from('piezas_marketing').update(cambios).eq('id', editando.id)
    if (error) { toast('No se pudo guardar', 'error'); return }
    setPiezas((prev) => prev.map((x) => (x.id === editando.id ? { ...x, ...cambios } : x)))
    setEditando(null); toast('✓ Guardado', 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando material…</p>

  // Ítems de la carpeta abierta (piezas reales o guiones virtuales)
  function itemsDe(key: string): { id: string; titulo: string; cat: string }[] {
    if (key === TEMA_GUIONES) return RUBROS.map((r) => ({ id: `guion:${r.id}`, titulo: `${r.emoji} ${r.nombre}`, cat: 'guion' }))
    return activas.filter((p) => temaDe(p) === key).map((p) => ({ id: `pieza:${p.id}`, titulo: p.titulo, cat: p.categoria }))
  }

  return (
    <div className="text-ink">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold">📚 Marketing</h2>
        {puedeEditar && (
          <button onClick={() => fileRef.current?.click()} disabled={subiendo} className="text-[12px] font-semibold rounded-lg bg-brand text-white px-3 py-1.5 disabled:opacity-50">
            {subiendo ? 'Subiendo…' : '⬆️ Subir archivo'}
          </button>
        )}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => subir(e.target.files, sel?.startsWith('pieza:') ? (activas.find((x) => `pieza:${x.id}` === sel)?.tema || 'general') : 'general')} />
      </div>

      <div className="grid md:grid-cols-[300px_1fr] gap-4">
        {/* Panel izquierdo: carpetas + títulos (estilo Office) */}
        <aside className={`${sel ? 'hidden md:block' : ''} space-y-1.5`}>
          {carpetas.map((key) => {
            const m = metaCarpeta(key); const abierto = abiertos.has(key); const items = itemsDe(key)
            const esGuiones = key === TEMA_GUIONES
            return (
              <div key={key} className={`rounded-xl border ${dragTema === key ? 'border-brand ring-1 ring-brand bg-brand/5' : 'border-black/10 bg-white'}`}
                onDragOver={(e) => { if (puedeEditar && !esGuiones) { e.preventDefault(); setDragTema(key) } }}
                onDragLeave={() => setDragTema(null)}
                onDrop={(e) => { if (puedeEditar && !esGuiones) onDrop(e, key) }}>
                <button onClick={() => toggleCarpeta(key)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                  <span className="text-lg">{m.icono}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate">{m.label}</span>
                    <span className="block text-[10px] text-faint truncate">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
                  </span>
                  <span className="text-faint text-xs">{abierto ? '▾' : '▸'}</span>
                </button>
                {abierto && (
                  <div className="pb-1.5">
                    {items.map((it) => (
                      <button key={it.id} onClick={() => seleccionar(it.id)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-[13px] ${sel === it.id ? 'bg-brand/10 text-brandDark font-medium' : 'hover:bg-black/[0.03] text-ink'}`}>
                        <span className="text-xs opacity-70">{ICONO_CAT[it.cat] ?? '📄'}</span>
                        <span className="truncate">{it.titulo}</span>
                      </button>
                    ))}
                    {puedeEditar && !esGuiones && (
                      <p className="text-[10px] text-faint px-3 pt-1">Arrastrá archivos acá para subir a esta carpeta</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </aside>

        {/* Panel derecho: vista del ítem seleccionado */}
        <main className={`${sel ? '' : 'hidden md:block'}`}>
          {sel && <button onClick={() => setSel(null)} className="md:hidden text-sm text-brandDark mb-2">← Volver</button>}
          {!sel ? (
            <div className="text-sm text-faint text-center py-16 bg-white rounded-xl border border-black/10">
              Elegí una carpeta y un material a la izquierda para verlo acá.
            </div>
          ) : sel.startsWith('guion:') ? (() => {
            const r = RUBROS.find((x) => `guion:${x.id}` === sel)
            if (!r) return null
            const ig = mensajePara(r.id, 'ig'); const li = mensajePara(r.id, 'linkedin')
            return (
              <div className="bg-white rounded-2xl border border-black/10 p-5 space-y-4">
                <h3 className="text-lg font-bold">{r.emoji} {r.nombre}</h3>
                <p className="text-xs text-muted">{r.angulo}</p>
                {([['📷 Instagram / WhatsApp', ig, 'ig'], ['💼 LinkedIn', li, 'li']] as const).map(([lbl, txt, k]) => (
                  <div key={k}>
                    <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">{lbl}</p>
                    <p className="text-[13px] text-ink bg-[#F1EDE4] rounded-lg p-3 whitespace-pre-wrap">{txt}</p>
                    <div className="flex gap-3 mt-1.5">
                      <button onClick={() => copiar(`${sel}-${k}`, txt)} className="text-xs font-medium text-brandDark">{copiado === `${sel}-${k}` ? '✓ Copiado' : 'Copiar'}</button>
                      <a href={`https://wa.me/?text=${encodeURIComponent(limpioEnvio(txt))}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-600">📲 WhatsApp</a>
                    </div>
                  </div>
                ))}
              </div>
            )
          })() : (() => {
            const p = activas.find((x) => `pieza:${x.id}` === sel)
            if (!p) return null
            return (
              <div className="bg-white rounded-2xl border border-black/10 p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-semibold text-faint uppercase">{CATEGORIAS[p.categoria] ?? p.categoria}</span>
                    <h3 className="text-lg font-bold">{p.titulo}</h3>
                    {p.descripcion && <p className="text-xs text-muted mt-0.5">{p.descripcion}</p>}
                  </div>
                  {puedeEditar && <button onClick={() => abrirEdicion(p)} className="text-xs font-medium text-amber-600 shrink-0">✏️ Editar</button>}
                </div>
                {previewUrl && <img src={previewUrl} alt={p.titulo} className="w-full max-h-[60vh] object-contain rounded-lg border border-black/10" />}
                {p.contenido_texto && (
                  <p className="text-[13px] text-ink bg-[#F1EDE4] rounded-lg p-3 whitespace-pre-wrap max-h-[50vh] overflow-y-auto">{p.contenido_texto}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  {p.contenido_texto && <button onClick={() => copiar(sel, p.contenido_texto!)} className="text-xs font-medium text-brandDark">{copiado === sel ? '✓ Copiado' : 'Copiar texto'}</button>}
                  {p.contenido_texto && <a href={`https://wa.me/?text=${encodeURIComponent(limpioEnvio(p.contenido_texto))}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-600">📲 WhatsApp</a>}
                  {p.contenido_texto && <a href={`mailto:?body=${encodeURIComponent(limpioEnvio(p.contenido_texto))}`} className="text-xs font-medium text-brandDark">✉️ Mail</a>}
                  {p.url && <button onClick={() => abrirArchivo(p.url!)} className="text-xs font-medium text-brandDark">Abrir / Descargar →</button>}
                </div>
              </div>
            )
          })()}
        </main>
      </div>

      {/* Modal de edición (admin) */}
      {editando && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><p className="text-sm font-semibold">✏️ Editar pieza</p><button onClick={() => setEditando(null)} className="text-muted">✕</button></div>
            <label className="block text-xs text-muted">Título<input value={edTitulo} onChange={(e) => setEdTitulo(e.target.value)} className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-muted">Descripción<input value={edDesc} onChange={(e) => setEdDesc(e.target.value)} className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-muted">Texto<textarea value={edTexto} onChange={(e) => setEdTexto(e.target.value)} rows={8} className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm" /></label>
            <div className="flex gap-2">
              <button onClick={() => setEditando(null)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">Cancelar</button>
              <button onClick={guardarEdicion} className="flex-1 rounded-lg bg-brand text-white py-2 text-sm font-semibold">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
