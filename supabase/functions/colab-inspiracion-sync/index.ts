// Edge Function: colab-inspiracion-sync
// Pestaña "Inspiración" del panel de colaboradores: publicaciones de TikTok e Instagram que los
// influencers usan SOLO como referencia de formato. Secciones:
//   viral  → formatos que están funcionando
//   triple → Triple Protección (Infrarrojo + UV400 + Blue Cut), con el link a la landing
//   color  → moda con cristal ocre / naranja / rojo
// Cada publicación guarda sus datos crudos (vistas, me gusta, comentarios, compartidos, guardados,
// duración, seguidores del autor, audio, hashtags) y una ficha: de qué se trata, por qué es viral
// (apoyado en esos datos) y cómo hacerlo con Orbital. Para "de qué se trata" se leen los subtítulos
// de TikTok cuando existen (gratis; la transcripción paga NO se usa).
// Modos (body.modo):
//   (vacío)     búsqueda diaria con Apify plan gratis, ~USD 0,06 por corrida:
//               TikTok 1 búsqueda por sección (3 videos, última semana) · Instagram 1 hashtag (4 reels)
//               · TikTok Creative Center (top videos) día por medio
//   'completar' trae los datos de las publicaciones que todavía no los tienen (curadas y viejas)
//   'fichas'    regenera "de qué se trata" y "por qué es viral" con los datos guardados (sin Apify)
// Solo se guarda el LINK y el texto: nada se descarga ni se vuelve a subir.
// Ficha con Groq si hay GROQ_API_KEY (de a 3 publicaciones, reintenta si pide esperar o si una tanda
// vuelve con JSON inválido la parte de a una); si no, textos fijos.
// Auth (verify_jwt=false): x-cron-key == app_config.cron_key, o body.clave de Orbital.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Seccion = 'viral' | 'triple' | 'color'
type Fuente = 'tiktok' | 'instagram'
// deno-lint-ignore no-explicit-any
type Crudo = any
type Datos = {
  url: string; autor: string | null; texto: string | null
  vistas: number | null; likes: number | null; comentarios: number | null; compartidos: number | null; guardados: number | null
  duracion_seg: number | null; seguidores: number | null; audio: string | null; hashtags: string[] | null
  publicado_at: string | null
}
type Nuevo = Datos & { seccion: Seccion; fuente: Fuente; busqueda: string; subtitulos?: string | null; crudo?: Crudo }
type FichaIA = { i?: unknown; apto?: boolean; formato?: string; de_que_trata?: string; por_que?: string; como_orbital?: string; aviso?: string | null }

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
const TIKTOK_EXTRA = {
  shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadAvatars: false,
  shouldDownloadMusicCovers: false, shouldDownloadSlideshowImages: false,
  downloadSubtitlesOptions: 'DOWNLOAD_SUBTITLES',
}
// Piso para que "viral" sea viral de verdad
const MIN_VISTAS_TIKTOK = 3000
const MIN_LIKES_IG = 100

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
function fecha(v: unknown) {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const dormir = (seg: number) => new Promise((listo) => setTimeout(listo, seg * 1000))

async function apify(token: string, actor: string, input: unknown, maxItems: number): Promise<Crudo[]> {
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

const idVideo = (u: string) => u.split('/video/')[1]?.split('?')[0].split('/')[0] ?? null
function codigoIg(u: string) {
  const partes = u.split('?')[0].split('/').filter(Boolean)
  const k = partes.findIndex((p) => p === 'p' || p === 'reel' || p === 'reels')
  return k >= 0 ? partes[k + 1] ?? null : null
}

function deTikTok(x: Crudo): Datos {
  const m = x.musicMeta
  return {
    url: String(x.webVideoUrl).split('?')[0],
    autor: x.authorMeta?.name ?? null,
    texto: x.text ?? null,
    vistas: num(x.playCount), likes: num(x.diggCount), comentarios: num(x.commentCount),
    compartidos: num(x.shareCount), guardados: num(x.collectCount),
    duracion_seg: num(x.videoMeta?.duration), seguidores: num(x.authorMeta?.fans),
    audio: m ? (m.musicOriginal ? 'Audio original' : [m.musicName, m.musicAuthor].filter(Boolean).join(' · ') || null) : null,
    hashtags: (x.hashtags ?? []).map((h: Crudo) => h?.name).filter(Boolean).slice(0, 12),
    publicado_at: fecha(x.createTimeISO ?? x.createTime),
  }
}

function deInstagram(x: Crudo): Datos {
  const mi = x.musicInfo
  return {
    url: String(x.url).split('?')[0],
    autor: x.ownerUsername ?? null,
    texto: x.caption ?? null,
    vistas: num(x.videoPlayCount ?? x.igPlayCount), likes: num(x.likesCount), comentarios: num(x.commentsCount),
    compartidos: null, guardados: null,
    duracion_seg: num(x.videoDuration), seguidores: null,
    audio: mi ? (mi.uses_original_audio ? 'Audio original' : [mi.song_name, mi.artist_name].filter(Boolean).join(' · ') || null) : null,
    hashtags: Array.isArray(x.hashtags) ? x.hashtags.slice(0, 12) : null,
    publicado_at: fecha(x.timestamp),
  }
}

function deTendencia(x: Crudo): Datos {
  const met = (clave: string) => num((x['Metrics'] ?? []).find((m: Crudo) => String(m?.metric ?? '').toLowerCase().includes(clave))?.value)
  return {
    url: String(x['Video TikTok URL']).split('?')[0],
    autor: x['Author Handle'] ?? null,
    texto: x['Title'] ?? null,
    vistas: num(x['Views'] ?? x['Video Views']), likes: met('like'), comentarios: met('comment'), compartidos: met('share'), guardados: null,
    duracion_seg: null, seguidores: num(x['Followers']), audio: null, hashtags: null,
    publicado_at: fecha(x['Create Time']),
  }
}

async function subtitulos(x: Crudo) {
  const links: Crudo[] = x?.videoMeta?.subtitleLinks ?? []
  const idioma = (s: Crudo) => String(s?.language ?? '').toLowerCase()
  const l = links.find((s) => idioma(s).startsWith('es')) ?? links.find((s) => idioma(s).startsWith('en')) ?? links[0]
  const href = l?.downloadLink ?? l?.tiktokLink
  if (!href) return null
  try {
    const r = await fetch(href, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const lineas = (await r.text()).split('\n').map((ln) => ln.trim())
    const texto = lineas.filter((ln) => ln && !ln.startsWith('WEBVTT') && !ln.includes('-->') && !/^[0-9]+$/.test(ln)).join(' ')
    return texto.replace(/<[^>]+>/g, '').replace(/ {2,}/g, ' ').slice(0, 800) || null
  } catch {
    return null
  }
}

// Señales que ayudan a explicar por qué se hizo viral
function senales(d: Datos) {
  const sobreVistas = (v: number | null) => (v != null && d.vistas ? Math.round((v / d.vistas) * 1000) / 10 : null)
  const total = [d.likes, d.comentarios, d.compartidos, d.guardados].reduce<number>((s, v) => s + (v ?? 0), 0)
  return {
    interaccion_pct: d.vistas ? Math.round((total / d.vistas) * 1000) / 10 : null,
    guardados_pct: sobreVistas(d.guardados),
    compartidos_pct: sobreVistas(d.compartidos),
    comentarios_pct: sobreVistas(d.comentarios),
    vistas_por_seguidor: d.vistas && d.seguidores ? Math.round((d.vistas / d.seguidores) * 10) / 10 : null,
  }
}

function fichaFija(s: Seccion, modelosColor: string[], texto: string | null) {
  const de_que_trata = texto ? `Según el texto de la publicación: ${texto.slice(0, 160)}` : null
  if (s === 'triple') {
    return {
      formato: 'Protección en cámara', de_que_trata,
      por_que: 'Muestra en segundos para qué sirve el cristal, algo que no se ve en una foto.',
      como_orbital: `Contá las tres protecciones de los cristales de Orbital (Infrarrojo, UV400 y Blue Cut) y sumá el link ${LANDING_TRIPLE}`,
      aviso: null,
    }
  }
  if (s === 'color') {
    return {
      formato: 'Look con lente de color', de_que_trata,
      por_que: 'El cristal de color es el protagonista del look.',
      como_orbital: `Armá el mismo look con un Orbital de lente ocre, naranja o rojo${modelosColor.length ? ` (${modelosColor.slice(0, 3).join(', ')})` : ''}.`,
      aviso: 'No prometas beneficios para dormir ni para la salud, y no muestres anteojos de sol para manejar de noche.',
    }
  }
  return {
    formato: 'Referencia viral', de_que_trata,
    por_que: 'Tuvo mucho alcance: mirá el gancho de los primeros segundos y el ritmo de la edición.',
    como_orbital: 'Repetí la estructura con un anteojo de Orbital y cerrá con tu link.',
    aviso: null,
  }
}

const SISTEMA = `Sos el director creativo de Orbital Eyewear, marca argentina de anteojos.
Recibís publicaciones de TikTok e Instagram con sus datos reales. Los influencers de Orbital las usan SOLO como referencia de formato (no se copian).
Para cada publicación devolvé:
- i: el mismo número i que recibiste (número entero).
- apto: false si es sexual, violenta, política, religiosa, discriminatoria, si no sirve como idea para mostrar anteojos, o si no se entiende de qué trata.
- formato: 2 a 4 palabras EN ESPAÑOL, nunca en inglés (ej.: "Prueba en cámara", "POV en primera persona", "Antes y después", "Unboxing").
- de_que_trata: 1 o 2 oraciones en español: qué se ve o qué pasa en el video. Basate SOLO en texto, subtitulos, hashtags y audio; no inventes escenas. Si la información no alcanza, empezá con "Según el texto de la publicación,".
- por_que: la causa concreta de por qué es viral, en 1 o 2 oraciones, apoyada en los datos (interaccion_pct, guardados_pct, compartidos_pct, comentarios_pct, vistas_por_seguidor, duracion_seg, audio). Pistas: muchos guardados = contenido útil que se guarda para después; muchos compartidos = identificación o humor; muchos comentarios = debate o pregunta; vistas muy por encima de los seguidores = el algoritmo lo empujó por el gancho; video corto = se mira entero y se repite; audio en tendencia = se sumó a una tendencia. Usá solo números que figuran en los datos, redondeados.
- como_orbital: 1 o 2 oraciones en español rioplatense (voseo), cómo hacerlo con un anteojo de Orbital.
- aviso: 1 oración solo si hace falta una advertencia; si no, null.
Datos de Orbital: la Triple Protección de sus cristales = filtro Infrarrojo (bloquea la radiación que genera calor y fatiga visual bajo sol fuerte) + UV400 (100% de rayos UVA y UVB) + Blue Cut (filtra la luz azul de pantallas y LEDs). Se explica en ${LANDING_TRIPLE}.
Mencioná la Triple Protección y ese link SOLO en la sección "triple". En las secciones "viral" y "color" NO la menciones.
En la sección "color" sugerí modelos de la lista modelos_lente_color, sin inventar colores.
Reglas: nunca prometas beneficios para dormir ni para la salud (melatonina, dormir mejor, curar); nunca sugieras manejar de noche con anteojos de sol; no afirmes que un modelo puntual o todos los anteojos de Orbital tienen Triple Protección: hablá de "los cristales con Triple Protección de Orbital".
Respondé solo JSON: {"fichas":[{"i":0,"apto":true,"formato":"","de_que_trata":"","por_que":"","como_orbital":"","aviso":null}]}`

type ParaIA = { seccion: Seccion; fuente: Fuente; d: Datos; subtitulos?: string | null }

async function fichasIA(items: ParaIA[], modelosColor: string[]): Promise<{ fichas: Map<number, FichaIA> | null; errores: string[] }> {
  const key = Deno.env.get('GROQ_API_KEY')
  const errores: string[] = []
  if (!key) return { fichas: null, errores: ['sin GROQ_API_KEY'] }
  if (!items.length) return { fichas: null, errores }
  const out = new Map<number, FichaIA>()
  // De a 3 para no pasar el límite de tokens por minuto de la capa gratis de Groq.
  // Si una tanda vuelve con JSON inválido, se reintenta de a una publicación.
  const cola: number[][] = []
  for (let desde = 0; desde < items.length; desde += 3) cola.push(items.slice(desde, desde + 3).map((_, k) => desde + k))
  while (cola.length) {
    const indices = cola.shift()!
    const pedido = JSON.stringify({
      model: Deno.env.get('GROQ_MODEL') ?? 'llama-3.3-70b-versatile',
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SISTEMA },
        {
          role: 'user', content: JSON.stringify({
            modelos_lente_color: modelosColor,
            publicaciones: indices.map((i) => {
              const x = items[i]
              return {
                i, seccion: x.seccion, red: x.fuente, autor: x.d.autor,
                texto: (x.d.texto ?? '').slice(0, 500), subtitulos: x.subtitulos ?? null,
                hashtags: x.d.hashtags, audio: x.d.audio, duracion_seg: x.d.duracion_seg,
                vistas: x.d.vistas, me_gusta: x.d.likes, comentarios: x.d.comentarios,
                compartidos: x.d.compartidos, guardados: x.d.guardados, seguidores_autor: x.d.seguidores,
                ...senales(x.d),
              }
            }),
          }),
        },
      ],
    })
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: pedido,
        })
        if (r.status === 429) {
          const espera = Math.min(Number(r.headers.get('retry-after')) || 10, 25)
          errores.push(`publicaciones ${indices.join(',')}: Groq pidió esperar ${espera}s`)
          await dormir(espera)
          continue
        }
        if (!r.ok) {
          const t = await r.text()
          if (r.status === 400 && /validate json/i.test(t) && indices.length > 1) { indices.forEach((i) => cola.push([i])); break }
          errores.push(`publicaciones ${indices.join(',')}: Groq ${r.status} ${t.slice(0, 120)}`)
          break
        }
        const d = await r.json()
        const res = JSON.parse(d.choices?.[0]?.message?.content ?? '{}')
        const lista: FichaIA[] = Array.isArray(res) ? res : (res.fichas ?? res.publicaciones ?? [])
        if (!lista.length) errores.push(`publicaciones ${indices.join(',')}: respuesta sin fichas`)
        lista.forEach((f, k) => {
          const i = Number(f?.i)
          if (indices.includes(i)) out.set(i, f)
          else if (k < indices.length) out.set(indices[k], f)
        })
        break
      } catch (e) {
        errores.push(`publicaciones ${indices.join(',')}: ${String((e as Error)?.message ?? e).slice(0, 120)}`)
        break
      }
    }
  }
  return { fichas: out.size ? out : null, errores }
}

// La IA a veces pega la Triple Protección en cualquier sección: fuera de "triple" se descarta.
const sinTriple = (s: Seccion, t?: string | null) => (t && (s === 'triple' || !/triple protecci/i.test(t)) ? t : null)

// Trae los datos de las publicaciones que todavía no los tienen (curadas y cargadas antes).
async function completar(db: SupabaseClient, token: string, modelosColor: string[]) {
  const { data } = await db.from('colab_inspiracion').select('id, url, fuente, seccion, fijo')
    .is('datos_at', null).eq('activo', true).limit(30)
  const filas = (data ?? []) as { id: number; url: string; fuente: Fuente; seccion: Seccion; fijo: boolean }[]
  if (!filas.length) return { ok: true, modo: 'completar', filas: 0, completadas: 0 }

  const tt = filas.filter((f) => f.fuente === 'tiktok')
  const ig = filas.filter((f) => f.fuente === 'instagram' && codigoIg(f.url))
  const [rt, ri] = await Promise.allSettled([
    tt.length
      ? apify(token, 'clockworks~tiktok-scraper', { postURLs: tt.map((f) => f.url), resultsPerPage: 1, ...TIKTOK_EXTRA }, tt.length)
      : Promise.resolve([]),
    ig.length
      ? apify(token, 'apify~instagram-scraper', { directUrls: ig.map((f) => `https://www.instagram.com/p/${codigoIg(f.url)}/`), resultsType: 'posts', resultsLimit: 1 }, ig.length)
      : Promise.resolve([]),
  ])

  const errores: string[] = []
  const hallados: { fila: typeof filas[number]; d: Datos; subtitulos: string | null }[] = []
  if (rt.status === 'fulfilled') {
    for (const x of rt.value) {
      const id = idVideo(String(x?.webVideoUrl ?? x?.submittedVideoUrl ?? '')) ?? (x?.id ? String(x.id) : null)
      const fila = tt.find((f) => idVideo(f.url) === id)
      if (!fila || hallados.some((h) => h.fila.id === fila.id)) continue
      hallados.push({ fila, d: { ...deTikTok(x), url: fila.url }, subtitulos: await subtitulos(x) })
    }
  } else errores.push(String(rt.reason))
  if (ri.status === 'fulfilled') {
    for (const x of ri.value) {
      const fila = ig.find((f) => codigoIg(f.url) === x?.shortCode)
      if (!fila || hallados.some((h) => h.fila.id === fila.id)) continue
      hallados.push({ fila, d: { ...deInstagram(x), url: fila.url }, subtitulos: null })
    }
  } else errores.push(String(ri.reason))

  const { fichas: ia, errores: erroresIA } = await fichasIA(hallados.map((h) => ({ seccion: h.fila.seccion, fuente: h.fila.fuente, d: h.d, subtitulos: h.subtitulos })), modelosColor)
  const ahora = new Date().toISOString()
  for (const [i, h] of hallados.entries()) {
    const f = ia?.get(i)
    const { url: _url, autor, texto, ...numeros } = h.d
    const cambios: Record<string, unknown> = { ...numeros, datos_at: ahora }
    // En las curadas se mantiene la descripción en español que ya tienen
    if (!h.fila.fijo) { cambios.autor = autor; cambios.texto = texto }
    if (f?.de_que_trata) cambios.de_que_trata = f.de_que_trata
    if (f?.por_que) cambios.por_que = f.por_que
    await db.from('colab_inspiracion').update(cambios).eq('id', h.fila.id)
  }
  // Las que no aparecieron (borradas o privadas) no se reintentan solas.
  const sinDatos = filas.filter((f) => !hallados.some((h) => h.fila.id === f.id)).map((f) => f.id)
  if (sinDatos.length && !errores.length) await db.from('colab_inspiracion').update({ datos_at: ahora }).in('id', sinDatos)

  return { ok: true, modo: 'completar', filas: filas.length, completadas: hallados.length, sin_datos: sinDatos.length, ia: ia ? 'groq' : 'sin_ia', errores, errores_ia: erroresIA }
}

// Regenera "de qué se trata" y "por qué es viral" con los datos que ya están guardados (no usa Apify).
async function regenerarFichas(db: SupabaseClient, modelosColor: string[]) {
  const { data } = await db.from('colab_inspiracion')
    .select('id, seccion, fuente, url, autor, texto, vistas, likes, comentarios, compartidos, guardados, duracion_seg, seguidores, audio, hashtags, publicado_at')
    .eq('activo', true).is('de_que_trata', null).limit(9)
  const filas = (data ?? []) as (Datos & { id: number; seccion: Seccion; fuente: Fuente })[]
  if (!filas.length) return { ok: true, modo: 'fichas', filas: 0, actualizadas: 0 }
  const { fichas, errores } = await fichasIA(filas.map((f) => ({ seccion: f.seccion, fuente: f.fuente, d: f })), modelosColor)
  let actualizadas = 0
  for (const [i, f] of filas.entries()) {
    const x = fichas?.get(i)
    if (!x?.de_que_trata && !x?.por_que) continue
    const cambios: Record<string, unknown> = {}
    if (x.de_que_trata) cambios.de_que_trata = x.de_que_trata
    if (x.por_que) cambios.por_que = x.por_que
    await db.from('colab_inspiracion').update(cambios).eq('id', f.id)
    actualizadas++
  }
  return { ok: true, modo: 'fichas', filas: filas.length, actualizadas, errores_ia: errores }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({})) as { clave?: string; modo?: string }

  let ok = false
  const cronKey = req.headers.get('x-cron-key')
  if (cronKey) {
    const { data: cfg } = await db.from('app_config').select('valor').eq('clave', 'cron_key').maybeSingle()
    ok = !!cfg && cfg.valor === cronKey
  }
  if (!ok && body.clave) {
    const { data: o } = await db.from('colab_orbital').select('id').eq('clave', body.clave).eq('activo', true).maybeSingle()
    ok = !!o
  }
  if (!ok) return json({ error: 'no_autorizado' }, 401)

  const { data: prods } = await db.from('colab_producto').select('modelo, color').eq('disponible', true)
  const modelosColor = [...new Set((prods ?? [])
    .filter((p: { color: string | null }) => /(ocre|naranja|rojo)/i.test((p.color ?? '').split('/')[1] ?? ''))
    .map((p: { modelo: string }) => p.modelo))].sort()

  if (body.modo === 'fichas') return json(await regenerarFichas(db, modelosColor))

  const token = Deno.env.get('APIFY_TOKEN')
  if (!token) return json({ error: 'falta_token', detalle: 'Cargar APIFY_TOKEN en los secrets de Edge Functions' }, 400)

  if (body.modo === 'completar') return json(await completar(db, token, modelosColor))

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
    searchQueries: [q], searchSection: '/video', resultsPerPage: 3, videoSearchDateFilter: 'PAST_WEEK', ...TIKTOK_EXTRA,
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
      .forEach((x) => nuevos.push({ ...deTikTok(x), seccion: s, fuente: 'tiktok', busqueda: `TikTok: ${busq[s]}`, crudo: x }))
  })

  const rIg = resultados[secciones.length]
  if (rIg.status === 'fulfilled') {
    rIg.value
      .filter((x) => x?.url && !x.error && ((x.likesCount ?? 0) >= MIN_LIKES_IG || (x.videoPlayCount ?? x.igPlayCount ?? 0) >= MIN_VISTAS_TIKTOK))
      .sort((a, b) => Math.max(b.likesCount ?? 0, 0) - Math.max(a.likesCount ?? 0, 0))
      .slice(0, 2)
      .forEach((x) => nuevos.push({ ...deInstagram(x), seccion: ig.s, fuente: 'instagram', busqueda: `Instagram: #${ig.h}` }))
  } else errores.push(String(rIg.reason))

  const rTop = resultados[secciones.length + 1]
  if (rTop.status === 'fulfilled') {
    rTop.value
      .filter((x) => x?.['Video TikTok URL'])
      .sort((a, b) => (b['Views'] ?? 0) - (a['Views'] ?? 0))
      .slice(0, 2)
      .forEach((x) => nuevos.push({ ...deTendencia(x), seccion: 'viral', fuente: 'tiktok', busqueda: 'Tendencias TikTok (EE.UU.)' }))
  } else errores.push(String(rTop.reason))

  // Sin repetidos ni lo que ya salió otro día
  const unicos = [...new Map(nuevos.map((n) => [n.url, n])).values()]
  const { data: ya } = unicos.length
    ? await db.from('colab_inspiracion').select('url').in('url', unicos.map((n) => n.url))
    : { data: [] as { url: string }[] }
  const yaSet = new Set((ya ?? []).map((r: { url: string }) => r.url))
  const frescos = unicos.filter((n) => !yaSet.has(n.url))

  await Promise.all(frescos.map(async (n) => { if (n.crudo) n.subtitulos = await subtitulos(n.crudo) }))

  const { fichas: ia, errores: erroresIA } = await fichasIA(frescos.map((n) => ({ seccion: n.seccion, fuente: n.fuente, d: n, subtitulos: n.subtitulos })), modelosColor)
  const ahora = new Date().toISOString()
  let descartados = 0
  const filas = []
  for (const [i, n] of frescos.entries()) {
    const f = ia?.get(i)
    if (f && f.apto === false) { descartados++; continue }
    const base = fichaFija(n.seccion, modelosColor, n.texto)
    const { crudo: _crudo, subtitulos: _sub, ...fila } = n
    filas.push({
      ...fila,
      formato: f?.formato || base.formato,
      de_que_trata: f?.de_que_trata || base.de_que_trata,
      por_que: f?.por_que || base.por_que,
      como_orbital: sinTriple(n.seccion, f?.como_orbital) || base.como_orbital,
      aviso: n.seccion === 'color' ? (f?.aviso ?? base.aviso) : f ? (f.aviso ?? null) : base.aviso,
      datos_at: ahora,
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
    errores_ia: erroresIA,
  })
})
