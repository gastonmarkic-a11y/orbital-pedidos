import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Avatar IA: orbe azul con carita de robot y glow (original, estilo tech)
function AiAvatar({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ filter: 'drop-shadow(0 0 6px rgba(56,189,248,0.7))' }}>
      <defs>
        <radialGradient id="aiorb" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="55%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#0b1e40" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="url(#aiorb)" stroke="#bae6fd" strokeWidth="1.5" />
      <line x1="24" y1="11" x2="24" y2="16" stroke="#e0f2fe" strokeWidth="2" />
      <circle cx="24" cy="10" r="2" fill="#e0f2fe" />
      <rect x="14.5" y="16" width="19" height="15" rx="4.5" fill="#ffffff" opacity="0.96" />
      <circle cx="20" cy="23" r="2.3" fill="#2563eb" />
      <circle cx="28" cy="23" r="2.3" fill="#2563eb" />
      <rect x="19" y="27.5" width="10" height="2" rx="1" fill="#93c5fd" />
    </svg>
  )
}

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
      <button onClick={traer} title="Mostrar asistente" className="fixed right-0 bottom-28 z-40 rounded-l-lg overflow-hidden shadow-lg">
        <AiAvatar size={30} />
      </button>
    )
  }

  // Cerrado → ícono flotante
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Preguntale al Asistente"
        className="fixed right-4 bottom-24 z-40 active:scale-95 transition-transform"
      >
        <AiAvatar size={52} />
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
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <AiAvatar size={22} /> Asistente
        </span>
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
