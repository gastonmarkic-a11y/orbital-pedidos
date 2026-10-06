// Campaña ASCARI: prepara todo SIN mandarle nada a nadie.
//   1. sube el video y las 3 fotos a Supabase (catalogo/campanas/ascari)
//   2. da de alta la plantilla ascari_temporada en Meta
//   3. carga la lista de quienes abrieron el catálogo (campana + campana_envio)
//   4. arma los mensajes de Telegram en modo prueba (no los manda)
// Uso (PowerShell):  $env:CRON_KEY="..."; node scripts/campana-ascari.mjs
// Después:           node scripts/campana-ascari.mjs estado | prueba 549XXXXXXXXXX | telegram | enviar 50
// El resultado queda en ascari-preview/resultado.json.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// La clave se pasa una sola vez ($env:CRON_KEY="...") y queda guardada en la carpeta del usuario
// (fuera del repo), así los pasos siguientes andan desde cualquier terminal.
const ARCH_KEY = join(homedir(), '.orbital-cron-key')
let KEY = process.env.CRON_KEY?.trim()
if (KEY) writeFileSync(ARCH_KEY, KEY, { mode: 0o600 })
else if (existsSync(ARCH_KEY)) KEY = readFileSync(ARCH_KEY, 'utf8').trim()
if (!KEY) {
  // Sin clave guardada: la pide acá mismo (se pega y Enter) y la guarda para las próximas veces.
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  KEY = (await rl.question('Pegá la clave (cron_key) y apretá Enter: ')).trim().replace(/^["']|["']$/g, '')
  rl.close()
  if (!KEY) { console.error('No se pegó ninguna clave.'); process.exit(1) }
  writeFileSync(ARCH_KEY, KEY, { mode: 0o600 })
}
const FN = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/campana-ascari'
const llamar = async (q, body) => {
  const r = await fetch(`${FN}?${q}`, { method: body ? 'POST' : 'GET', headers: { 'x-cron-key': KEY }, body })
  const t = await r.text()
  // Clave equivocada: se borra la guardada para que la próxima vez la vuelva a pedir.
  if (r.status === 401) { try { unlinkSync(ARCH_KEY) } catch { /* nada */ } console.error('La clave no es correcta. Corré el comando de nuevo y pegala otra vez.'); process.exit(1) }
  try { return JSON.parse(t) } catch { return { http: r.status, texto: t } }
}

const [paso = 'preparar', arg] = process.argv.slice(2)
const out = {}
if (paso === 'preparar') {
  for (const [nombre, archivo] of [['ascari-teaser.mp4', 'public/banners/ascari-teaser.mp4'], ...[1, 2, 3].map((i) => [`ascari-${i}.jpg`, `ascari-preview/ascari-${i}.jpg`])])
    out[`subir ${nombre}`] = await llamar(`tarea=subir&nombre=${nombre}`, readFileSync(archivo))
  out.plantilla = await llamar('tarea=plantilla')
  out.cargar = await llamar('tarea=cargar')
  out.telegram_prueba = await llamar('tarea=telegram&prueba=1')
} else if (paso === 'estado') out.estado = await llamar('tarea=estado')
else if (paso === 'prueba') out.prueba = await llamar(`tarea=prueba&a=${arg ?? ''}`)
else if (paso === 'telegram') out.telegram = await llamar('tarea=telegram')
else if (paso === 'enviar') out.enviar = await llamar(`tarea=enviar&max=${Number(arg) || 50}`)
else { console.error('paso: preparar | estado | prueba <numero> | telegram | enviar <max>'); process.exit(1) }

writeFileSync('ascari-preview/resultado.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2).slice(0, 3000))
