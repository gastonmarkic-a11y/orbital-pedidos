#!/usr/bin/env node
// Suite de conversaciones de IRIS (bot-central).
// Reproduce las transcripciones que fallaron en producción y verifica que ya no fallen.
//
//   node tests/test-bot.mjs                      → crea su conversación (necesita SUPABASE_SERVICE_ROLE_KEY)
//   node tests/test-bot.mjs --conv <id> --contacto <id>   → usa una conversación ya creada
//   node tests/test-bot.mjs --solo saul          → corre un solo escenario
//
// Cada caso declara qué DEBE y qué NO DEBE aparecer en la respuesta.
// Los `no_debe` son las fallas reales del relevamiento del 3/9: si alguno vuelve, el test se pone rojo.

const PROJECT = 'towcgvphxeqilpdnboki'
const FN = `https://${PROJECT}.supabase.co/functions/v1/bot-central`
const REST = `https://${PROJECT}.supabase.co/rest/v1`
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TEL_TEST = '5490000000'   // prefijo reservado para los tests

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const soloUno = arg('--solo')

// ── Escenarios ───────────────────────────────────────────────────────────────
const ESCENARIOS = [
  {
    id: 'saul',
    titulo: 'Acceso al catálogo — el caso Saul Apfelberg (1/9)',
    seed: 'optica_con_token',                              // óptica de prueba con token vivo
    turnos: [
      { yo: 'Hola! Soy Saul Apfelberg. Quiero abrir mi catálogo Orbital desde este dispositivo, ¿me lo habilitás?',
        debe: ['ver.orbitaleyewear.com.ar/catalogo?k=', 'Ulises'],
        no_debe: ['óptica/comercio o consumidor', 'De qué modelo'],
        porque: 'F6 · el mensaje lo genera la propia app y antes caía en el cotizador' },
    ],
  },
  {
    id: 'pedido4447',
    titulo: 'Posventa — el caso #4447 (17/8, terminó en Defensa del Consumidor)',
    turnos: [
      { yo: 'Hola! Quisiera hacer una consulta sobre el pedido que realicé la semana pasada.',
        debe: ['número de pedido'],
        no_debe: ['óptica/comercio o consumidor'],
        porque: 'F1+F2 · pisaba la consulta real con la pregunta de segmento' },
      { yo: 'El número de pedido es 4447 y compré porque puse polarizados en el buscador',
        debe: ['4447'],
        no_debe: ['óptica/comercio o consumidor', 'De qué modelo'],
        porque: 'F2 · extraía el número pero no lo buscaba' },
      { yo: 'No los quiero',
        no_debe: ['De qué modelo', 'pedido de cotización'],
        porque: 'F4 · le cotizaba a quien estaba pidiendo la devolución' },
      { yo: 'Ya me lo preguntaron y ya lo respondí 3 veces',
        debe: ['erdon'],
        no_debe: ['óptica/comercio o consumidor'],
        porque: 'F8 · antes repreguntaba; ahora se disculpa, prioriza y para' },
    ],
  },
  {
    id: 'b2b_link',
    titulo: 'B2B nunca va al canal minorista',
    turnos: [
      { yo: 'Hola, tengo una óptica y quiero trabajar la marca', debe: [] },
      { yo: 'Contame de la línea Triple Protección y qué me conviene para el mostrador',
        no_debe: ['orbitaleyewear.com.ar', 'outletorbitaleyewear'],
        porque: 'F5 · le mandaba la tienda de consumidor final a una óptica' },
    ],
  },
  {
    id: 'catalogo_gate',
    titulo: 'Autohabilitar catálogo solo para leads de Meta',
    turnos: [
      { yo: 'Hola, soy Optica Vision. Me habilitás el catálogo mayorista?',
        debe: ['Ulises'],
        no_debe: ['catalogo?k='],
        porque: 'un desconocido que no viene de campaña lo habilita una persona' },
    ],
  },
  {
    id: 'reclamo',
    titulo: 'Reclamo de producto se deriva, no se cotiza',
    turnos: [
      { yo: 'Soy consumidor final', debe: [] },
      { yo: 'Me llegó un anteojo con la varilla rota, quiero el cambio',
        debe: ['aso con'],
        no_debe: ['De qué modelo', 'pedido de cotización'],
        porque: 'reclamo por producto dañado: siempre a una persona' },
    ],
  },
  {
    id: 'acentos',
    titulo: 'Clasifica bien con palabras acentuadas',
    turnos: [
      { yo: 'Hola, no soy un particular. Es una consulta de una óptica.',
        no_debe: ['óptica/comercio o consumidor', 'qué zona', 'en qué provincia', 'tu localidad', 'decirme en qué'],
        porque: 'el mensaje real de Saul · /\\bóptica/ nunca matchea en JS porque "ó" no es \\w' },
      { yo: 'Contame de la marca y qué me conviene tener en el mostrador',
        no_debe: ['qué zona', 'en qué provincia', 'tu localidad', 'en qué ciudad'],
        porque: 'la ubicación la carga el vendedor después: el bot no la pide nunca' },
    ],
  },
  {
    id: 'antiloop',
    titulo: 'Sin loop de cotización',
    turnos: [
      { yo: 'Soy óptica, precio de LENA y PALERMO',
        no_debe: ['óptica/comercio o consumidor'],
        porque: 'dijo "Soy óptica" y le repreguntaba el segmento' },
      { yo: 'mmm no sé', no_debe_igual_al_anterior: true, porque: 'F3 · antes regeneraba la misma cotización sin fin' },
      { yo: 'todavía lo estoy pensando', no_debe_igual_al_anterior: true, porque: 'F3 · segunda vuelta del loop' },
    ],
  },
]

// ── Infra ────────────────────────────────────────────────────────────────────
const C = { ok: '\x1b[32m', no: '\x1b[31m', dim: '\x1b[2m', b: '\x1b[1m', warn: '\x1b[33m', off: '\x1b[0m' }

async function rest(path, opts = {}) {
  if (!KEY) throw new Error('falta SUPABASE_SERVICE_ROLE_KEY')
  const r = await fetch(`${REST}/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${r.status} ${path} · ${txt.slice(0, 200)}`)
  return txt ? JSON.parse(txt) : null
}

async function nuevaConversacion(seed) {
  const t = `${TEL_TEST}${String(Math.floor(Math.random() * 900) + 100)}`
  // Algunos escenarios necesitan una óptica ya dada de alta y con token de catálogo vivo.
  if (seed === 'optica_con_token') {
    const cod = `TST-${t.slice(-4)}`
    await rest('clientes', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ cod, razon: 'Óptica de Prueba', nomcomerc: 'Óptica de Prueba', telefono: `+${t}`, whatsapp: `+${t}`, vendedor_asignado: 'Ulises', agenda_owner: 'Ulises', nro_lista: 1, zona: 'Sin zona', localidad: 'Sin zona', origen: 'propio' }),
    })
    await fetch(`${REST}/rpc/catalogo_link_cliente`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cod_cliente: cod }),
    })
  }
  let [c] = await rest(`contactos?telefono=eq.${t}&select=id`)
  if (!c) [c] = await rest('contactos', { method: 'POST', body: JSON.stringify({ telefono: t }) })
  const [cv] = await rest('at_conversaciones', { method: 'POST', body: JSON.stringify({ contacto_id: c.id, canal_origen: 'whatsapp' }) })
  return { contactoId: c.id, conversacionId: cv.id, tel: t, creada: true }
}

async function limpiar() {
  if (!KEY) return
  const convs = await rest(`at_conversaciones?select=id,contactos!inner(telefono)&contactos.telefono=like.${TEL_TEST}*`)
  for (const cv of convs || []) {
    for (const tbl of ['at_mensajes', 'derivaciones', 'bot_cotizaciones']) {
      await rest(`${tbl}?conversacion_id=eq.${cv.id}`, { method: 'DELETE' })
    }
    await rest(`at_conversaciones?id=eq.${cv.id}`, { method: 'DELETE' })
  }
  await rest(`prospeccion_social?telefono=like.${TEL_TEST}*`, { method: 'DELETE' })
  await rest(`contactos?telefono=like.${TEL_TEST}*`, { method: 'DELETE' })
  const tst = await rest(`clientes?cod=like.TST-*&select=cod`)
  for (const c of tst || []) { await rest(`catalogo_acceso?cod_cliente=eq.${c.cod}`, { method: 'DELETE' }); await rest(`catalogo_visitas?cod_cliente=eq.${c.cod}`, { method: 'DELETE' }) }
  await rest(`clientes?cod=like.TST-*`, { method: 'DELETE' })
}

async function decir(ids, texto) {
  const r = await fetch(FN, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversacionId: ids.conversacionId, contactoId: ids.contactoId, canal: 'whatsapp', texto }),
  })
  if (!r.ok) throw new Error(`bot ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return (await r.json()).texto ?? ''
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

function evaluar(turno, resp, anterior) {
  const fallas = []
  const R = norm(resp)
  for (const d of turno.debe || []) if (!R.includes(norm(d))) fallas.push(`falta "${d}"`)
  for (const n of turno.no_debe || []) if (R.includes(norm(n))) fallas.push(`apareció "${n}"`)
  if (turno.no_debe_igual_al_anterior && anterior && norm(resp) === norm(anterior) && resp !== '') fallas.push('repitió la respuesta anterior')
  return fallas
}

// ── Corrida ──────────────────────────────────────────────────────────────────
const escenarios = soloUno ? ESCENARIOS.filter((e) => e.id === soloUno) : ESCENARIOS
let pass = 0, fail = 0

console.log(`\n${C.b}IRIS · suite de conversaciones${C.off}  ${C.dim}${escenarios.length} escenario(s)${C.off}\n`)

if (!KEY && !arg('--conv')) {
  console.log(`${C.warn}Necesito la service role key para crear las conversaciones de prueba:${C.off}`)
  console.log(`${C.dim}  SUPABASE_SERVICE_ROLE_KEY=... node tests/test-bot.mjs${C.off}`)
  console.log(`${C.dim}  (o pasá una conversación ya creada con --conv <id> --contacto <id>)${C.off}\n`)
  process.exit(2)
}

for (const esc of escenarios) {
  console.log(`${C.b}${esc.titulo}${C.off}`)
  let ids
  try {
    ids = arg('--conv')
      ? { conversacionId: arg('--conv'), contactoId: arg('--contacto') }
      : await nuevaConversacion(esc.seed)
  } catch (e) { console.log(`  ${C.no}no pude preparar la conversación: ${e.message}${C.off}\n`); fail++; continue }

  let anterior = null
  for (const turno of esc.turnos) {
    let resp
    try { resp = await decir(ids, turno.yo) } catch (e) { resp = `__ERROR__ ${e.message}` }
    const fallas = evaluar(turno, resp, anterior)
    const corto = (resp === '' ? '(silencio)' : resp).replace(/\n+/g, ' ⏎ ').slice(0, 108)
    console.log(`  ${C.dim}👤${C.off} ${turno.yo.slice(0, 92)}`)
    console.log(`  ${fallas.length ? C.no + '✗' : C.ok + '✓'}${C.off} ${corto}`)
    if (fallas.length) {
      fallas.forEach((f) => console.log(`     ${C.no}${f}${C.off}`))
      if (turno.porque) console.log(`     ${C.dim}${turno.porque}${C.off}`)
      fail++
    } else pass++
    anterior = resp
  }
  console.log('')
}

if (!arg('--conv')) { try { await limpiar() } catch (e) { console.log(`${C.warn}limpieza incompleta: ${e.message}${C.off}`) } }

const total = pass + fail
console.log(`${C.b}${fail === 0 ? C.ok + 'TODO OK' : C.no + 'HAY FALLAS'}${C.off}  ${pass}/${total} turnos correctos\n`)
process.exit(fail === 0 ? 0 : 1)
