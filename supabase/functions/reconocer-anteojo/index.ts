// Reconocimiento de anteojos por cámara (/reconocer): segunda opinión.
//
// El celular ya preseleccionó los modelos más parecidos (DINOv2 en el navegador contra
// public/ar/embeddings.json) y arma UN collage: a la izquierda el cuadro de la cámara,
// a la derecha una foto de referencia de cada candidato con su número.
// Acá la IA decide qué número es el mismo armazón — o ninguno.
// Importa el MODELO, no el color: las referencias pueden estar en otro color.
//
// POST { collage: <jpeg base64 sin prefijo>, modelos: string[] }  (máx. 6, en el orden del collage)
//  →   { modelo: string | null, hay_anteojo: boolean }

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'content-type': 'application/json' } })

const consigna = (n: number) =>
  `La imagen es un collage. A la izquierda, con el rótulo CÁMARA, hay una foto tomada con el celular. ` +
  `A la derecha hay ${n} fotos de referencia de modelos del catálogo, numeradas del 1 al ${n}. ` +
  'Decidí si el anteojo de la CÁMARA es el mismo MODELO de armazón que alguna referencia. ' +
  'Ignorá el color del armazón y de las lentes: las referencias pueden estar en otro color. Compará la forma del frente y de las lentes, ' +
  'el puente, el grosor, las bisagras, las patillas y los detalles. Si en la CÁMARA no hay un anteojo, o no coincide claramente con ninguna referencia, la referencia es null. ' +
  'Respondé SOLO con JSON: {"hay_anteojo": true|false, "referencia": <número o null>}'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)
  let body: { collage?: string; modelos?: string[] }
  try { body = await req.json() } catch { return json({ error: 'json' }, 400) }
  const collage = body.collage ?? ''
  const modelos = (body.modelos ?? []).slice(0, 6).map(String)
  if (!collage || collage.length > 900_000) return json({ error: 'collage' }, 400)
  if (!modelos.length) return json({ modelo: null, hay_anteojo: false })

  try {
    // Sin IA disponible devuelve error: el celular cae a «¿Es alguno de estos?»
    const txt = ANTHROPIC_API_KEY ? await claude(collage, consigna(modelos.length)) : null
    if (txt === null) return json({ error: 'ia' }, 502)
    const m = txt.match(/\{[^{}]*\}(?![\s\S]*\{)/)
    const res = m ? JSON.parse(m[0]) : {}
    const n = Number(res.referencia)
    const modelo = Number.isInteger(n) && n >= 1 && n <= modelos.length ? modelos[n - 1] : null
    return json({ modelo, hay_anteojo: !!res.hay_anteojo })
  } catch (e) {
    console.error('reconocer', String(e))
    return json({ error: 'ia' }, 502)
  }
})

async function claude(b64: string, texto: string): Promise<string | null> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 2000, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: texto }] }] }),
  })
  const data = await r.json()
  if (data?.error) { console.error('anthropic', JSON.stringify(data.error)); return null }
  return data?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
}
