// Lectura de la vitrina por foto (panel de consigna → Exhibición).
//
// El local saca una foto del mueble; acá se guarda en el bucket «exhibicion» y la IA dice qué código
// hay en cada lugar del sector Orbital, comparando contra la foto de catálogo de cada código que la
// sucursal tiene en stock. Acá el COLOR importa: cada referencia es un color distinto del modelo.
// Si duda, lo marca (seguro=false) con hasta 3 opciones y el local elige en la pantalla.
//
// POST { k, suc, foto: <jpeg base64 sin prefijo> }
//  →   { foto: <url pública>, lugares: [{ f, c, vacio, codigo|null, seguro, opciones: codigo[], caja }], nota }
// caja = [x0, y0, x1, y1] del lugar en la foto (fracciones 0–1): la pantalla recorta ese anteojo para confirmar dudas.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const sb = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'content-type': 'application/json' } })

type Ref = { codigo: string; modelo: string | null; descripcion: string | null; imagen: string | null }
type Lugar = { f: number; c: number; vacio?: boolean; ref?: number | null; seguro?: boolean; opciones?: number[]; caja?: number[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST' }, 405)
  let body: { k?: string; suc?: number; foto?: string }
  try { body = await req.json() } catch { return json({ error: 'json' }, 400) }
  const foto = body.foto ?? ''
  if (!body.k || !body.suc || !foto || foto.length > 7_000_000) return json({ error: 'datos' }, 400)

  // Mismo control de acceso que el panel: el token tiene que poder ver esa sucursal.
  const { data: ex, error: exErr } = await sb.rpc('consigna_exhibicion', { p_k: body.k, p_suc: body.suc })
  if (exErr) return json({ error: exErr.message.includes('sin_exhibidor') ? 'sin_exhibidor' : 'acceso' }, 403)
  const { filas, columnas, nota } = ex.exhibidor as { filas: number; columnas: number; nota: string | null }
  const refs = (ex.stock as Ref[]).slice(0, 80)

  // La foto queda guardada aunque la IA falle: el local igual puede cargar la vitrina a mano.
  const path = `${body.suc}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.jpg`
  const bytes = Uint8Array.from(atob(foto), (ch) => ch.charCodeAt(0))
  const { error: upErr } = await sb.storage.from('exhibicion').upload(path, bytes, { contentType: 'image/jpeg' })
  const url = upErr ? null : `${SUPABASE_URL}/storage/v1/object/public/exhibicion/${path}`
  if (upErr) console.error('upload', upErr.message)

  if (!ANTHROPIC_API_KEY) return json({ foto: url, lugares: [], error: 'ia' })
  try {
    const imgs = await Promise.all(refs.map((r) => bajar(r.imagen)))
    const content: unknown[] = [
      { type: 'text', text: 'FOTO DE LA VITRINA:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: foto } },
      { type: 'text', text: `REFERENCIAS (${refs.length}): foto de catálogo de cada código que la sucursal tiene en stock.` },
    ]
    refs.forEach((r, i) => {
      const t = `Ref ${i + 1}: ${r.modelo ?? ''} — ${r.descripcion ?? ''}`
      if (imgs[i]) content.push({ type: 'text', text: t }, { type: 'image', source: { type: 'base64', media_type: imgs[i]!.tipo, data: imgs[i]!.b64 } })
      else content.push({ type: 'text', text: t + ' (sin foto: guiate por el nombre del color)' })
    })
    content.push({ type: 'text', text: consigna(filas, columnas, nota) })

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 6000, messages: [{ role: 'user', content }] }),
    })
    const data = await r.json()
    if (data?.error) { console.error('anthropic', JSON.stringify(data.error)); return json({ foto: url, lugares: [], error: 'ia' }) }
    const txt: string = data?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? ''
    const m = txt.match(/\{[\s\S]*\}/)
    const res = m ? JSON.parse(m[0]) as { lugares?: Lugar[]; nota?: string } : {}
    const cod = (n: unknown) => { const i = Number(n); return Number.isInteger(i) && i >= 1 && i <= refs.length ? refs[i - 1].codigo : null }

    const lugares = []
    for (let f = 1; f <= filas; f++) for (let c = 1; c <= columnas; c++) {
      const l = (res.lugares ?? []).find((x) => Number(x.f) === f && Number(x.c) === c)
      const codigo = l && !l.vacio ? cod(l.ref) : null
      const opciones = [...new Set((l?.opciones ?? []).map(cod).filter((x): x is string => !!x))].slice(0, 3)
      // Hay un anteojo que no reconoció: queda como duda para que el local diga cuál es.
      const vacio = !!l?.vacio
      const k = l?.caja
      const caja = Array.isArray(k) && k.length === 4 && k.every((n) => typeof n === 'number' && n >= 0 && n <= 1) && k[2] > k[0] && k[3] > k[1] ? k : null
      lugares.push({ f, c, vacio, codigo, seguro: !!l && (vacio || (!!codigo && l.seguro !== false)), opciones, caja })
    }
    return json({ foto: url, lugares, nota: res.nota ?? null })
  } catch (e) {
    console.error('exhibicion', String(e))
    return json({ foto: url, lugares: [], error: 'ia' })
  }
})

// Baja la foto de catálogo en versión chica. Si no carga, la referencia va solo con el nombre.
async function bajar(src: string | null): Promise<{ b64: string; tipo: string } | null> {
  if (!src) return null
  const u = /cdn\.shopify\.com/.test(src) ? src + (src.includes('?') ? '&' : '?') + 'width=400' : src
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return null
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(tipo)) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (buf.length > 1_500_000) return null
    let s = ''
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { b64: btoa(s), tipo }
  } catch { return null }
}

const consigna = (filas: number, columnas: number, nota: string | null) =>
  `Sos el encargado de controlar la exhibición de anteojos Orbital en una vitrina de un local.\n` +
  (nota ? `Sobre este mueble: ${nota}\n` : '') +
  `El sector de Orbital tiene ${filas} estantes (fila 1 = el de ARRIBA, fila ${filas} = el de ABAJO) y ${columnas} lugares por estante ` +
  `(columna 1 = IZQUIERDA, columna ${columnas} = DERECHA, mirando la foto de frente). Cada lugar tiene un anteojo o está vacío.\n` +
  'Para cada lugar decidí qué referencia es. Comparalo con las fotos de referencia: forma del frente y de las lentes, puente, grosor, ' +
  'color del armazón y color de las lentes. Acá el COLOR importa: un mismo modelo aparece en varias referencias, una por color.\n' +
  'La luz de la vitrina, los reflejos y las etiquetas cambian un poco los colores respecto del catálogo: eso solo no es motivo de duda. ' +
  'Brillo y mate se distinguen mal en foto: si el modelo coincide y el resto del color también, elegí y seguí.\n' +
  'Reglas:\n' +
  '- Si el modelo coincide y entre los colores de ese modelo hay uno que claramente se parece más: "ref": número, "seguro": true.\n' +
  '- Duda SOLO si hay dos o más referencias realmente posibles (dos modelos que se confunden, o dos colores del mismo modelo igual de parecidos), ' +
  'o si el anteojo casi no se ve: poné la más probable en "ref", "seguro": false y hasta 3 candidatas en "opciones".\n' +
  '- Si hay un anteojo pero no coincide con ninguna referencia: "ref": null, "seguro": false, "opciones": [].\n' +
  '- Si el lugar está vacío: "vacio": true.\n' +
  'Es mejor marcar una duda que adivinar: el local confirma las dudas en la pantalla.\n' +
  '- En "caja" poné dónde está ese lugar en la FOTO DE LA VITRINA: [x0, y0, x1, y1] como fracciones del ancho y del alto (de 0 a 1), aunque esté vacío.\n' +
  `Respondé SOLO con JSON, con los ${filas * columnas} lugares: ` +
  '{"lugares":[{"f":1,"c":1,"vacio":false,"ref":12,"seguro":true,"opciones":[],"caja":[0.05,0.3,0.2,0.38]}, ...], "nota": "algo para avisar al local, o null"}'
