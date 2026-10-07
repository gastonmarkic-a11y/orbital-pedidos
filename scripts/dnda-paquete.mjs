// Arma el paquete para el "Depósito en custodia de obra inédita software" (DNDA).
// Uso:  node scripts/dnda-paquete.mjs
// Salida en dnda/<fecha>/ (no se versiona):
//   - orbital-suite-fuente-<fecha>.zip   código fuente de la obra (lo que va al pendrive)
//   - MANIFIESTO-SHA256.txt              huella de cada archivo + huella total del paquete
//   - memoria-descriptiva.html / .pdf    descripción de la obra para el sobre y el TAD
// Solo incluye código propio versionado en git: deja afuera datos de clientes,
// planillas, fotos, PDFs y dependencias de terceros (node_modules).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HUELLA = 'ORB-B91CD0154E96'
const hoy = new Date().toISOString().slice(0, 10)
const raiz = process.cwd()
const salida = join(raiz, 'dnda', hoy)
const staging = join(salida, 'orbital-suite-fuente')

const INCLUIR = [
  /^src\//,
  /^supabase\/functions\//,
  /^supabase\/seguridad\//,
  /^api\//,
  /^scripts\//,
  /^tests\//,
  /^public\/[^/]+\.(js|html)$/,
  /^public\/(p|br|pdv|marca)\/[^/]+\.(html|js|css)$/,
  /^(index\.html|package\.json|vite\.config\.ts|tailwind\.config\.js|postcss\.config\.js|tsconfig\.json|vercel\.json|service-worker\.js|manifest\.json)$/,
]
const EXCLUIR = /\.(png|jpe?g|webp|gif|svg|ico|mp4|mov|glb|gltf|usdz|pdf|xlsx|csv|zip|bin|onnx|woff2?)$/i

const archivos = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && INCLUIR.some((r) => r.test(f)) && !EXCLUIR.test(f) && existsSync(f))
  .sort()

rmSync(salida, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const lineas = []
let lineasCodigo = 0
for (const f of archivos) {
  const buf = readFileSync(f)
  lineas.push(`${sha(buf)}  ${f}`)
  lineasCodigo += buf.toString('utf8').split('\n').length
  const destino = join(staging, f)
  mkdirSync(dirname(destino), { recursive: true })
  copyFileSync(f, destino)
}
const huellaTotal = sha(lineas.join('\n'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const manifiesto = [
  'OBRA: Orbital Suite (software inédito)',
  `HUELLA DE AUTORÍA EN EL CÓDIGO: ${HUELLA}`,
  `FECHA DEL PAQUETE: ${hoy}`,
  `VERSIÓN (commit git): ${commit}`,
  `ARCHIVOS: ${archivos.length} · LÍNEAS: ${lineasCodigo}`,
  `SHA-256 DEL PAQUETE (sobre la lista de abajo): ${huellaTotal}`,
  '',
  ...lineas,
  '',
].join('\n')
writeFileSync(join(staging, 'MANIFIESTO-SHA256.txt'), manifiesto)
writeFileSync(join(salida, 'MANIFIESTO-SHA256.txt'), manifiesto)

// ZIP con el tar de Windows (bsdtar)
const zip = join(salida, `orbital-suite-fuente-${hoy}.zip`)
execFileSync('C:\\Windows\\System32\\tar.exe', ['-a', '-c', '-f', zip, '-C', salida, 'orbital-suite-fuente'])
const huellaZip = sha(readFileSync(zip))

// Memoria descriptiva (base en docs/legal/memoria-descriptiva.html)
const plantilla = readFileSync(join(raiz, 'docs', 'legal', 'memoria-descriptiva.html'), 'utf8')
const memoria = plantilla
  .replaceAll('{{FECHA}}', hoy)
  .replaceAll('{{COMMIT}}', commit)
  .replaceAll('{{ARCHIVOS}}', String(archivos.length))
  .replaceAll('{{LINEAS}}', lineasCodigo.toLocaleString('es-AR'))
  .replaceAll('{{SHA_PAQUETE}}', huellaTotal)
  .replaceAll('{{SHA_ZIP}}', huellaZip)
  .replaceAll('{{HUELLA}}', HUELLA)
const memoriaHtml = join(salida, 'memoria-descriptiva.html')
writeFileSync(memoriaHtml, memoria)

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
if (existsSync(edge)) {
  try {
    execFileSync(edge, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(salida, 'memoria-descriptiva.pdf')}`, 'file:///' + memoriaHtml.replaceAll('\\', '/')], { stdio: 'ignore', timeout: 60000 })
  } catch { /* queda el HTML para imprimir a mano */ }
}

rmSync(staging, { recursive: true, force: true })
console.log(`Listo: ${salida}`)
console.log(`  ${archivos.length} archivos · ${lineasCodigo} líneas`)
console.log(`  SHA-256 paquete: ${huellaTotal}`)
console.log(`  SHA-256 zip:     ${huellaZip}`)
