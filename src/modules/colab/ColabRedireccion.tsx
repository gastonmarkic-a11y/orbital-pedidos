// ── /r/<codigo> · lo que abre quien toca el link de un influencer ─────────────
// Pide a colab-click un código de descuento único para este visitante y lo manda
// al anteojo en la tienda con el código ya aplicado (/discount/<code>?redirect=…).
// Se genera desde el navegador: los bots que solo leen la vista previa no gastan códigos.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ACENTO, VISITANTE_KEY, kAr } from './colabUtil'

type Resp = {
  ok: boolean; code?: string; redirect: string; error?: string
  modelo?: string; color?: string | null; imagen?: string | null
  price?: number | null; compare_at?: number | null; pct?: number; influencer?: string
}

function visitante() {
  try {
    let v = localStorage.getItem(VISITANTE_KEY)
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(VISITANTE_KEY, v) }
    return v
  } catch { return null }
}

export default function ColabRedireccion() {
  const codigo = window.location.pathname.split('/')[2] ?? ''
  const [r, setR] = useState<Resp | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante() } }).then(({ data, error }) => {
      if (!vivo) return
      const d = (data as Resp) ?? { ok: false, redirect: 'https://www.orbitaleyewear.com.ar' }
      if (error && !data) d.redirect = 'https://www.orbitaleyewear.com.ar'
      setR(d)
      // Con código: se muestra un momento para que lo vea; sin código: directo a la tienda.
      setTimeout(() => window.location.replace(d.redirect), d.ok && d.code ? 2200 : 400)
    })
    return () => { vivo = false }
  }, [codigo])

  const precioCod = r?.price && r?.pct ? Math.round(r.price * (1 - r.pct / 100)) : null

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <img src="/logo-orbital.png" alt="Orbital" className="h-6 mx-auto mb-6" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        {!r && (
          <>
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-black/10 animate-spin" style={{ borderTopColor: ACENTO }} />
            <p className="text-sm text-neutral-500 mt-4">Preparando tu descuento exclusivo…</p>
          </>
        )}
        {r && r.ok && r.code && (
          <>
            {r.imagen && <img src={r.imagen} alt={r.modelo} className="w-full aspect-[4/3] object-contain mb-4" />}
            <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-400">{r.modelo}</div>
            <div className="text-[34px] font-bold leading-tight mt-1" style={{ color: ACENTO }}>{r.pct}% OFF</div>
            <p className="text-sm text-neutral-600">exclusivo para vos{r.influencer ? `, de parte de ${r.influencer}` : ''}</p>
            {precioCod && (
              <p className="text-sm mt-2">
                <span className="line-through text-neutral-400 mr-2">{kAr(r.price)}</span>
                <b>{kAr(precioCod)}</b>
              </p>
            )}
            <div className="mt-4 inline-block rounded-xl border-2 border-dashed px-5 py-2 font-mono text-lg font-bold tracking-widest" style={{ borderColor: ACENTO }}>
              {r.code}
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">Ya queda aplicado en la tienda. Es de un solo uso.</p>
            <a href={r.redirect} className="mt-5 block w-full rounded-xl text-white py-3 text-sm font-semibold" style={{ background: ACENTO }}>
              Ir a la tienda
            </a>
          </>
        )}
        {r && !(r.ok && r.code) && <p className="text-sm text-neutral-500">Te llevamos a la tienda…</p>}
      </div>
    </div>
  )
}
