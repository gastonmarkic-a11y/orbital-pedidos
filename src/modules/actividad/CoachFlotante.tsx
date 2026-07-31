import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Asistente flotante: ícono chico siempre a mano; se abre en un panel, se puede
// ocultar (queda una pestañita en el borde para traerlo de vuelta).
export default function CoachFlotante() {
  const { codigoEfectivo, rolEfectivo } = useAuth()
  const [open, setOpen] = useState(false)
  const [oculto, setOculto] = useState(() => localStorage.getItem('coach_oculto') === '1')
  const [pregunta, setPregunta] = useState('')
  const [respuesta, setRespuesta] = useState<string | null>(null)
  const [pensando, setPensando] = useState(false)

  const mostrar = rolEfectivo === 'vendedor' || rolEfectivo === 'admin'
  if (!mostrar) return null

  function ocultar() {
    localStorage.setItem('coach_oculto', '1')
    setOculto(true)
    setOpen(false)
  }
  function traer() {
    localStorage.removeItem('coach_oculto')
    setOculto(false)
  }

  async function preguntar(q?: string) {
    const texto = (q ?? pregunta).trim()
    if (!texto) return
    setPregunta(texto)
    setPensando(true)
    setRespuesta(null)
    const { data, error } = await supabase.functions.invoke('asistente-coach', {
      body: { codigo: codigoEfectivo, pregunta: texto },
    })
    setPensando(false)
    let cuerpo = (data ?? {}) as { error?: string; detalle?: string; respuesta?: string }
    const ctx = (error as unknown as { context?: Response })?.context
    if (error && ctx && typeof ctx.json === 'function') {
      try {
        cuerpo = await ctx.json()
      } catch {
        /* deja lo que haya */
      }
    }
    if (error || cuerpo.error) {
      setRespuesta(
        cuerpo.error === 'falta_clave'
          ? '⚙️ Falta activar la IA (cargar la API key en Supabase).'
          : '❌ ' + (cuerpo.detalle || cuerpo.error || 'No se pudo consultar al coach.')
      )
      return
    }
    setRespuesta(cuerpo.respuesta ?? 'Sin respuesta.')
  }

  // Oculto → pestañita en el borde derecho
  if (oculto) {
    return (
      <button
        onClick={traer}
        title="Mostrar asistente"
        className="fixed right-0 bottom-28 z-40 bg-[#15151A] text-white rounded-l-lg px-1.5 py-2 text-sm shadow-lg"
      >
        🤖
      </button>
    )
  }

  // Cerrado → ícono flotante
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Preguntale al Asistente"
        className="fixed right-4 bottom-24 z-40 w-12 h-12 rounded-full bg-[#15151A] text-white text-xl shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      >
        🤖
      </button>
    )
  }

  // Abierto → panel
  return (
    <div
      className="fixed right-3 left-3 sm:left-auto bottom-24 sm:w-[360px] z-40 rounded-2xl shadow-2xl overflow-hidden"
      style={{ background: 'linear-gradient(160deg,#17171c,#0f0f13)' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-sm font-semibold text-white">🤖 Asistente</span>
        <div className="flex items-center gap-3">
          <button onClick={ocultar} className="text-[11px] text-white/50">
            ocultar
          </button>
          <button onClick={() => setOpen(false)} className="text-white/70 text-xl leading-none">
            ×
          </button>
        </div>
      </div>
      <div className="p-3 space-y-2 max-h-[55vh] overflow-y-auto">
        <div className="flex flex-wrap gap-1">
          {['¿A quién contacto hoy?', '¿Qué le mando?', 'Objeción: no me quiere comprar'].map((q) => (
            <button
              key={q}
              onClick={() => preguntar(q)}
              disabled={pensando}
              className="text-[11px] rounded-full px-2 py-1 text-white/70 border border-white/15 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        {pensando && <p className="text-xs text-white/50">Pensando…</p>}
        {respuesta && <div className="text-sm text-white bg-white/5 rounded-lg p-2.5 whitespace-pre-wrap">{respuesta}</div>}
      </div>
      <div className="flex gap-2 p-2 border-t border-white/10">
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && preguntar()}
          placeholder="Escribí tu pregunta..."
          className="flex-1 bg-white/5 text-white rounded-lg px-3 py-2 text-sm placeholder:text-white/40 focus:outline-none"
        />
        <button
          onClick={() => preguntar()}
          disabled={pensando || !pregunta.trim()}
          className="rounded-lg bg-[#7CF5A0] text-[#0f0f13] px-3 text-sm font-bold disabled:opacity-50"
        >
          →
        </button>
      </div>
    </div>
  )
}
