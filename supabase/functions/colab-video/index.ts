// Edge Function: colab-video  (pública, verify_jwt=false)
// El promotor sube el video de reacción de un link desde "Mis links". Valida su clave y que el
// link sea suyo, y devuelve una URL firmada para subir el archivo directo al bucket público
// colab-videos (hasta 50 MB, mp4 / mov / webm). Después el panel guarda la URL pública con la
// RPC colab_link_video, que la muestra en la landing de ese link.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => ({})) as { clave?: string; link_id?: number; tipo?: string }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: inf } = await db.from('colab_influencer')
    .select('id, activo, admin:colab_admin(activo)')
    .eq('clave', String(body.clave ?? '')).maybeSingle()
  // deno-lint-ignore no-explicit-any
  if (!inf || !inf.activo || !(inf as any).admin?.activo) return json({ error: 'no_autorizado' }, 401)

  const { data: link } = await db.from('colab_link').select('id, codigo')
    .eq('id', Number(body.link_id)).eq('influencer_id', inf.id).maybeSingle()
  if (!link) return json({ error: 'link_inexistente' }, 404)

  const ext = body.tipo === 'video/quicktime' ? 'mov' : body.tipo === 'video/webm' ? 'webm' : 'mp4'
  const path = `${link.codigo}/${Date.now()}.${ext}`
  const { data, error } = await db.storage.from('colab-videos').createSignedUploadUrl(path)
  if (error || !data) return json({ error: 'no_se_pudo', detalle: error?.message ?? null }, 500)
  const { data: pub } = db.storage.from('colab-videos').getPublicUrl(path)
  return json({ ok: true, path, token: data.token, url: pub.publicUrl })
})
