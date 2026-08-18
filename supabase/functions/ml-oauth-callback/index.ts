// Recibe el code de ML, lo canjea por el par de tokens y deja la cuenta lista.
// Esta URL es la que va cargada como redirect_uri en el panel de desarrolladores.

import { db, json, ml, ML_API } from '../_shared/ml.ts'

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errorMl = url.searchParams.get('error')

    if (errorMl) return json({ error: `ML rechazo la autorizacion: ${errorMl}` }, 400)
    if (!code || !state) return json({ error: 'Faltan code o state' }, 400)

    const sb = db()

    // El state es de un solo uso: se lee y se borra en el mismo paso.
    const { data: fila, error: errState } = await sb
      .from('ml_oauth_state').select('*').eq('state', state).single()
    if (errState || !fila) return json({ error: 'State desconocido o vencido. Reintentar desde ml-oauth-start.' }, 400)
    await sb.from('ml_oauth_state').delete().eq('state', state)

    const res = await fetch(`${ML_API}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: Deno.env.get('ML_CLIENT_ID')!,
        client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
        code,
        redirect_uri: Deno.env.get('ML_REDIRECT_URI')!,
        code_verifier: fila.code_verifier,
      }),
    })

    if (!res.ok) return json({ error: `Canje rechazado (${res.status})`, detalle: await res.text() }, 400)
    const tok = await res.json()

    // Datos de la cuenta, incluido el official_store_id que despues sirve para
    // barrer solo nuestras publicaciones.
    const me = await ml('/users/me', tok.access_token).then((r) => r.json())

    const { error } = await sb.from('ml_cuentas').upsert({
      user_id: String(tok.user_id ?? me.id),
      nickname: me.nickname ?? null,
      site_id: me.site_id ?? 'MLA',
      official_store_id: me.official_store_id ? String(me.official_store_id) : null,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      scope: tok.scope ?? null,
      estado: 'activa',
      ultimo_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (error) return json({ error: `No se pudo guardar la cuenta: ${error.message}` }, 500)

    return new Response(
      `<!doctype html><meta charset="utf-8">
       <body style="font-family:system-ui;padding:40px;max-width:520px">
         <h2>Cuenta de Mercado Libre conectada</h2>
         <p><b>${me.nickname ?? me.id}</b>${me.official_store_id ? ` · tienda oficial ${me.official_store_id}` : ''}</p>
         <p>Ya se puede cerrar esta pestaña.</p>
       </body>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
