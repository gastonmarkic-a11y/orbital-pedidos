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
export function useRegistrarVisita(slug: 'bienvenida' | 'canje' | 'tripleproteccion') {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search)
    const token = p.get('c') ?? p.get('k') ?? ''
    // Sin token igual se registra: sirve para medir la landing aunque no sepamos quién.
    void supabase.rpc('registrar_visita_landing', { p_token: token, p_slug: slug })
  }, [slug])
}
