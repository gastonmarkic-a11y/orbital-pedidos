// Edge Function: colab-inspiracion-sync
// Pestaña "Inspiración" del panel de colaboradores: todos los días busca publicaciones de
// TikTok e Instagram para que los influencers las usen SOLO como referencia de formato.
// Tres secciones:
//   viral  → formatos que están funcionando
//   triple → Triple Protección de Orbital (Infrarrojo + UV400 + Blue Cut), con el link a la landing
//   color  → moda con cristal ocre / naranja / rojo (de día y de noche con pantallas)
// Fuente: Apify con el plan gratis (USD 5/mes). Volumen chico y rotativo, ~USD 2-3/mes:
//   TikTok: 1 búsqueda por sección por día, 3 videos c/u, última semana
//   Instagram: 1 hashtag por día, 4 reels
//   TikTok Creative Center (top videos): día por medio, 4 videos
// Solo se guarda el LINK y el texto: nada se descarga ni se vuelve a subir.
// Ficha de cada publicación (formato / por qué funciona / cómo hacerlo con Orbital) con Groq
// si hay GROQ_API_KEY; si no, textos fijos por sección. La IA también descarta lo no apto.
// Auth (verify_jwt=false): x-cron-key == app_config.cron_key, o body.clave de Orbital (botón "Buscar ahora").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Seccion = 'viral' | 'triple' | 'color'
type Nuevo = {
  seccion: Seccion; fuente: 'tiktok' | 'instagram'; url: string; autor: string | null; texto: string | null
  vistas: number | null; likes: number | null; publicado_at: string | null; busqueda: string
}
type Ficha = { formato: string; por_que: string; como_orbital: string; aviso: string | null }

const LANDING_TRIPLE = 'https://ver.orbitaleyewear.com.ar/tripleproteccion'

const BUSQUEDAS_TIKTOK: Record<Seccion, string[]> = {
  viral: ['sunglasses outfit', 'lentes de sol', 'eyewear trend', 'anteojos de sol look'],
  triple: ['blue light glasses', 'anteojos luz azul', 'uv400 sunglasses test'],
  color: ['orange lens glasses', 'red tinted glasses', 'lentes naranjas', 'amber lens sunglasses'],
}
const HASHTAGS_IG: { h: string; s: Seccion }[] = [
  { h: 'sunglasses', s: 'viral' }, { h: 'orangelenses', s: 'color' }, { h: 'bluelightglasses', s: 'triple' },
  { h: 'lentesdesol', s: 'viral' }, { h: 'redlenses', s: 'color' }, { h: 'eyewear', s: 'viral' },
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}

// Instagram devuelve -1 cuando el autor oculta los "me gusta": se toma como sin dato.
const num = (v: unknown) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
// Piso para que "viral" sea viral de verdad
const MIN_VISTAS_TIKTOK = 3000
const MIN_LIKES_IG = 100
function fecha(v: unknown) {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// deno-lint-ignore no-explicit-any
async function apify(token: string, actor: string, input: unknown, maxItems: number): Promise<any[]> {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=120&maxItems=${maxItems}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${actor} ${r.status}: ${t.slice(0, 200)}`)
  const d = JSON.parse(t)
  return Array.isArray(d) ? d : []
}

function fichaFija(s: Seccion, modelosColor: string[]): Ficha {
  if (s === 'triple') {
    return {
      formato: 'Protección en cámara',
      por_que: 'Muestra en segundos para qué sirve el cristal, algo que no se ve en una foto.',
      como_orbital: `Contá las tres protecciones de los cristales de Orbital (Infrarrojo, UV400 y Blue Cut) y sumá el link ${LANDING_TRIPLE}`,
      aviso: null,
    }
  }
  if (s === 'color') {
    return {
      formato: 'Look con lente de color',
      por_que: 'El cristal de color es el protagonista del look.',
      como_orbital: `Armá el mismo look con un Orbital de lente ocre, naranja o rojo${modelosColor.length ? ` (${modelosColor.slice(0, 3).join(', ')})` : ''}.`,
      aviso: 'No prometas beneficios para dormir ni para la salud, y no muestres anteojos de sol para manejar de noche.',
    }
  }
  return {
    formato: 'Referencia viral',
    por_que: 'Tuvo mucho alcance: mirá el gancho de los primeros segundos y el ritmo de la edición.',
    como_orbital: 'Repetí la estructura con un anteojo de Orbital y cerrá con tu link.',
    aviso: null,
  }
}

const SISTEMA = `Sos el director creativo de Orbital Eyewear, marca argentina de anteojos.
Recibís publicaciones de TikTok e Instagram que los influencers de Orbital van a usar SOLO como referencia de formato (no se copian).
Para cada publicación devolvé:
- apto: false si es sexual, violenta, política, religiosa, discriminatoria, si no sirve como idea para mostrar anteojos, o si no se entiende de qué trata.
- formato: 2 a 4 palabras EN ESPAÑOL, nunca en inglés (ej.: "Prueba en cámara", "POV en primera persona", "Antes y después", "Unboxing").
- por_que: 1 oración, por qué funciona.
- como_orbital: 1 o 2 oraciones en español rioplatense (voseo), cómo hacerlo con un anteojo de Orbital.
- aviso: 1 oración solo si hace falta una advertencia; si no, null.
Datos de Orbital: la Triple Protección de sus cristales = filtro Infrarrojo (bloquea la radiación que genera calor y fatiga visual bajo sol fuerte) + UV400 (100% de rayos UVA y UVB) + Blue Cut (filtra la luz azul de pantallas y LEDs). Se explica en ${LANDING_TRIPLE}.
Mencioná la Triple Protección y ese link SOLO en la sección "triple". En las secciones "viral" y "color" NO la menciones.
En la sección "color" sugerí modelos de la lista modelos_lente_color, sin inventar colores.
Reglas: nunca prometas beneficios para dormir ni para la salud (melatonina, dormir mejor, curar); nunca sugieras manejar de noche con anteojos de sol; no afirmes que un modelo puntual o todos los anteojos de Orbital tienen Triple Protección: hablá de "los cristales con Triple Protección de Orbital".
Respondé solo JSON: {"fichas":[{"i":0,"apto":true,"formato":"","por_que":"","como_orbital":"","aviso":null}]}`

async function fichasIA(items: Nuevo[], modelosColor: string[]) {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key || !items.length) return null
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('GROQ_MODEL') ?? 'llama-3.3-70b-versatile',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SISTEMA },
          {
            role: 'user', content: JSON.stringify({
              modelos_lente_color: modelosColor,
              publicaciones: items.map((x, i) => ({ i, seccion: x.seccion, red: x.fuente, autor: x.autor, vistas: x.vistas, texto: (x.texto ?? '').slice(0, 500) })),
            }),
          },
        ],
      }),
    })
    if (!r.ok) return null
    const d = await r.json()
    const out = JSON.parse(d.choices?.[0]?.message?.content ?? '{}')
    const m = new Map<number, { apto: boolean } & Partial<Ficha>>()
    for (const f of out.fichas ?? []) if (typeof f?.i === 'number') m.set(f.i, f)
    return m
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let ok = false
  const cronKey = req.headers.get('x-cron-key')
  if (cronKey) {
    const { data: cfg } = await db.from('app_config').select('valor').eq('clave', 'cron_key').maybeSingle()
    ok = !!cfg && cfg.valor === cronKey
  }
  if (!ok) {
    const body = await req.json().catch(() => ({})) as { clave?: string }
    if (body.clave) {
      const { data: o } = await db.from('colab_orbital').select('id').eq('clave', body.clave).eq('activo', true).maybeSingle()
      ok = !!o
    }
  }
  if (!ok) return json({ error: 'no_autorizado' }, 401)

  const token = Deno.env.get('APIFY_TOKEN')
  if (!token) return json({ error: 'falta_token', detalle: 'Cargar APIFY_TOKEN en los secrets de Edge Functions' }, 400)

  // Rotación diaria: cada día cambia la búsqueda de cada sección y el hashtag de Instagram.
  const dia = Math.floor(Date.now() / 86_400_000)
  const elegir = <T>(xs: T[], salto = 0) => xs[(dia + salto) % xs.length]
  const busq: Record<Seccion, string> = {
    viral: elegir(BUSQUEDAS_TIKTOK.viral),
    triple: elegir(BUSQUEDAS_TIKTOK.triple, 1),
    color: elegir(BUSQUEDAS_TIKTOK.color, 2),
  }
  const ig = elegir(HASHTAGS_IG)
  const conTendencias = dia % 2 === 0

  const tiktokDe = (q: string) => apify(token, 'clockworks~tiktok-scraper', {
    searchQueries: [q], searchSection: '/video', resultsPerPage: 3, videoSearchDateFilter: 'PAST_WEEK',
    shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false,
    shouldDownloadMusicCovers: false, shouldDownloadSlideshowImages: false,
  }, 3)

  const secciones = Object.keys(busq) as Seccion[]
  const resultados = await Promise.allSettled([
    ...secciones.map((s) => tiktokDe(busq[s])),
    apify(token, 'apify~instagram-hashtag-scraper', { hashtags: [ig.h], resultsType: 'reels', resultsLimit: 4 }, 4),
    conTendencias
      ? apify(token, 'data_xplorer~tiktok-trends', { trendType: 'videos', videoCountry: 'US', videoPeriod: '7', maxItems: 4, videoOrganicOnly: true }, 4)
      : Promise.resolve([]),
  ])

  const errores: string[] = []
  const nuevos: Nuevo[] = []

  secciones.forEach((s, k) => {
    const r = resultados[k]
    if (r.status !== 'fulfilled') { errores.push(String(r.reason)); return }
    r.value
      .filter((x) => x?.webVideoUrl && !x.isAd && (x.playCount ?? 0) >= MIN_VISTAS_TIKTOK)
      .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      .slice(0, 2)
      .forEach((x) => nuevos.push({
        seccion: s, fuente: 'tiktok', url: String(x.webVideoUrl).split('?')[0],
        autor: x.authorMeta?.name ?? null, texto: x.text ?? null,
        vistas: num(x.playCount), likes: num(x.diggCount), publicado_at: fecha(x.createTimeISO ?? x.createTime),
        busqueda: `TikTok: ${busq[s]}`,
      }))
  })

  const rIg = resultados[secciones.length]
  if (rIg.status === 'fulfilled') {
    rIg.value
      .filter((x) => x?.url && !x.error && ((x.likesCount ?? 0) >= MIN_LIKES_IG || (x.videoPlayCount ?? x.igPlayCount ?? 0) >= MIN_VISTAS_TIKTOK))
      .sort((a, b) => Math.max(b.likesCount ?? 0, 0) - Math.max(a.likesCount ?? 0, 0))
      .slice(0, 2)
      .forEach((x) => nuevos.push({
        seccion: ig.s, fuente: 'instagram', url: String(x.url).split('?')[0],
        autor: x.ownerUsername ?? null, texto: x.caption ?? null,
        vistas: num(x.videoPlayCount ?? x.igPlayCount), likes: num(x.likesCount), publicado_at: fecha(x.timestamp),
        busqueda: `Instagram: #${ig.h}`,
      }))
  } else errores.push(String(rIg.reason))

  const rTop = resultados[secciones.length + 1]
  if (rTop.status === 'fulfilled') {
    rTop.value
      .filter((x) => x?.['Video TikTok URL'])
      .sort((a, b) => (b['Views'] ?? 0) - (a['Views'] ?? 0))
      .slice(0, 2)
      .forEach((x) => nuevos.push({
        seccion: 'viral', fuente: 'tiktok', url: String(x['Video TikTok URL']).split('?')[0],
        autor: x['Author Handle'] ?? null, texto: x['Title'] ?? null,
        vistas: num(x['Views']), likes: null, publicado_at: fecha(x['Create Time']),
        busqueda: 'Tendencias TikTok (EE.UU.)',
      }))
  } else errores.push(String(rTop.reason))

  // Sin repetidos ni lo que ya salió otro día
  const unicos = [...new Map(nuevos.map((n) => [n.url, n])).values()]
  const { data: ya } = unicos.length
    ? await db.from('colab_inspiracion').select('url').in('url', unicos.map((n) => n.url))
    : { data: [] as { url: string }[] }
  const yaSet = new Set((ya ?? []).map((r: { url: string }) => r.url))
  const frescos = unicos.filter((n) => !yaSet.has(n.url))

  const { data: prods } = await db.from('colab_producto').select('modelo, color').eq('disponible', true)
  const modelosColor = [...new Set((prods ?? [])
    .filter((p: { color: string | null }) => /(ocre|naranja|rojo)/i.test((p.color ?? '').split('/')[1] ?? ''))
    .map((p: { modelo: string }) => p.modelo))].sort()

  const ia = await fichasIA(frescos, modelosColor)
  let descartados = 0
  const filas = []
  for (const [i, n] of frescos.entries()) {
    const f = ia?.get(i)
    if (f && f.apto === false) { descartados++; continue }
    const base = fichaFija(n.seccion, modelosColor)
    // Control final: fuera de "triple" no se habla de Triple Protección (no todos los modelos la llevan).
    const comoIA = f?.como_orbital && (n.seccion === 'triple' || !/triple protecci/i.test(f.como_orbital)) ? f.como_orbital : null
    filas.push({
      ...n,
      formato: f?.formato || base.formato,
      por_que: f?.por_que || base.por_que,
      como_orbital: comoIA || base.como_orbital,
      aviso: n.seccion === 'color' ? (f?.aviso ?? base.aviso) : f ? (f.aviso ?? null) : base.aviso,
    })
  }

  if (filas.length) {
    const { error } = await db.from('colab_inspiracion').upsert(filas, { onConflict: 'url', ignoreDuplicates: true })
    if (error) return json({ error: 'db_error', detalle: error.message }, 500)
  }

  return json({
    ok: true,
    busquedas: { ...busq, instagram: `#${ig.h}`, tendencias: conTendencias },
    encontrados: unicos.length,
    nuevos: filas.length,
    descartados,
    ia: ia ? 'groq' : 'textos_fijos',
    errores,
  })
})
