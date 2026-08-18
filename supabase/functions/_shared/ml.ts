// Helpers compartidos de la integracion con Mercado Libre.
//
// Lo unico delicado de este archivo es getToken(): el access token de ML dura
// 6 horas y el refresh token es de UN SOLO USO (rota en cada refresh). Si se
// pide un refresh y no se guarda el par nuevo, la cuenta queda desconectada y
// hay que re-autorizar a mano desde el panel.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const ML_API = 'https://api.mercadolibre.com'
export const ML_AUTH = 'https://auth.mercadolibre.com.ar'

export function db(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

export interface MlConfig {
  markup_pct_propio: number
  markup_pct_full: number
  comision_estimada_pct: number
  envio_gratis_desde: number | null
  buffer_unidades: number
  precio_piso: number
  pausar_si_stock_cero: boolean
  modo_lectura: boolean
}

export async function getConfig(sb: SupabaseClient): Promise<MlConfig> {
  const { data, error } = await sb.from('ml_config').select('*').eq('id', 1).single()
  if (error) throw new Error(`ml_config: ${error.message}`)
  return data as MlConfig
}

/**
 * Devuelve un access token valido, refrescando si faltan menos de 10 minutos.
 *
 * El refresh y el guardado van juntos: si el UPDATE falla despues de que ML ya
 * roto el token, el refresh viejo quedo quemado y no sirve para reintentar. Por
 * eso ante un fallo de guardado marcamos la cuenta y cortamos, en vez de dejar
 * que el proximo llamado vuelva a intentar con un token que ML ya invalido.
 */
export async function getToken(sb: SupabaseClient): Promise<{ token: string; userId: string }> {
  const { data: cuenta, error } = await sb
    .from('ml_cuentas')
    .select('*')
    .eq('estado', 'activa')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !cuenta) throw new Error('No hay cuenta de ML conectada. Correr ml-oauth-start.')

  const margen = 10 * 60 * 1000
  const vence = cuenta.expires_at ? new Date(cuenta.expires_at).getTime() : 0
  if (cuenta.access_token && vence - Date.now() > margen) {
    return { token: cuenta.access_token, userId: cuenta.user_id }
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: Deno.env.get('ML_CLIENT_ID')!,
    client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
    refresh_token: cuenta.refresh_token,
  })

  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })

  if (!res.ok) {
    const detalle = await res.text()
    await sb.from('ml_cuentas')
      .update({ estado: 'desconectada', ultimo_error: `refresh ${res.status}: ${detalle}` })
      .eq('id', cuenta.id)
    throw new Error(`Refresh rechazado por ML (${res.status}). Hay que re-autorizar la cuenta.`)
  }

  const tok = await res.json()
  const { error: errGuardar } = await sb.from('ml_cuentas').update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    ultimo_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', cuenta.id)

  if (errGuardar) {
    // ML ya roto el refresh viejo: no se puede reintentar con el que teniamos.
    await sb.from('ml_cuentas')
      .update({ estado: 'desconectada', ultimo_error: `token nuevo no guardado: ${errGuardar.message}` })
      .eq('id', cuenta.id)
    throw new Error('Token refrescado pero no guardado. Re-autorizar la cuenta.')
  }

  return { token: tok.access_token, userId: cuenta.user_id }
}

export async function ml(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${ML_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Full lo administra ML: nunca se le empuja stock. */
export function esFull(logisticType: string | null | undefined): boolean {
  return logisticType === 'fulfillment'
}
