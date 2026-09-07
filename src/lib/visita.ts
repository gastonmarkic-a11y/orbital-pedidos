import { useEffect } from 'react'
import { supabase } from './supabase'

// Registra que una óptica concreta abrió una landing.
//
// El link que le llega al cliente viene personalizado (…/canje?c=<token>). Sin ese
// token la visita es anónima y el sistema no puede saber quién interactuó — que es
// justamente el dato que necesita el vendedor antes de volver a escribir.
//
// El prospectador no hace nada: el click del cliente ES la señal. Al día siguiente
// el supervisor la lee y mueve la óptica de posta.
/**
 * El token con el que la óptica llegó a la landing (…/canje?c=xxx).
 * Sirve para que el botón al catálogo la deje entrar con SU acceso y sus
 * precios, en vez de mandarla a la pantalla de clave.
 */
export function tokenDeLaUrl(): string | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  return p.get('c') ?? p.get('k') ?? null
}

export function useRegistrarVisita(slug: 'bienvenida' | 'canje' | 'tripleproteccion') {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const token = p.get('c') ?? p.get('k') ?? ''
    // Sin token igual se registra: sirve para medir la landing aunque no sepamos quién.
    //
    // OJO: rpc() devuelve un builder PEREZOSO. Sin .then() no se ejecuta nunca —
    // `void supabase.rpc(...)` descarta el objeto sin llegar a mandar el request.
    supabase
      .rpc('registrar_visita_landing', { p_token: token, p_slug: slug })
      .then(({ error }) => { if (error) console.warn('no se pudo registrar la visita:', error.message) })
  }, [slug])
}
