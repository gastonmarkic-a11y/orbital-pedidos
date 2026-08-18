// Arranca el OAuth de Mercado Libre. ML exige PKCE, asi que generamos el
// code_verifier aca y lo guardamos contra el state para que ml-oauth-callback
// lo pueda consumir.
//
// Abrir en el navegador:  https://<proyecto>.supabase.co/functions/v1/ml-oauth-start

import { db, json, ML_AUTH } from '../_shared/ml.ts'

function aleatorio(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(hash))
}

Deno.serve(async (req) => {
  try {
    const clientId = Deno.env.get('ML_CLIENT_ID')
    const redirectUri = Deno.env.get('ML_REDIRECT_URI')
    if (!clientId || !redirectUri) {
      return json({ error: 'Faltan los secrets ML_CLIENT_ID / ML_REDIRECT_URI' }, 500)
    }

    const state = aleatorio(16)
    const verifier = aleatorio(32)
    const sb = db()

    // Limpieza de states viejos: son de un solo uso y no sirven pasada una hora.
    await sb.from('ml_oauth_state')
      .delete()
      .lt('created_at', new Date(Date.now() - 3600_000).toISOString())

    const { error } = await sb.from('ml_oauth_state')
      .insert({ state, code_verifier: verifier })
    if (error) return json({ error: `No se pudo guardar el state: ${error.message}` }, 500)

    const url = new URL(`${ML_AUTH}/authorization`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', await challenge(verifier))
    url.searchParams.set('code_challenge_method', 'S256')

    // ?json=1 devuelve la URL en vez de redirigir, para poder probar sin navegador.
    if (new URL(req.url).searchParams.get('json')) return json({ url: url.toString() })

    return Response.redirect(url.toString(), 302)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
