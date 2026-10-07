import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Aviso de derechos al principio de cada JS publicado (sobrevive a la minificación).
// La huella coincide con src/lib/autoria.ts y con el depósito de la obra en la DNDA.
const AVISO =
  '/*! Orbital Suite · © Orbital Eyewear · Todos los derechos reservados (Ley 11.723) · ORB-B91CD0154E96 · ' +
  'Prohibida la copia, ingeniería inversa o uso para entrenar modelos de IA. */\n'
function avisoAutoria(): Plugin {
  return {
    name: 'aviso-autoria',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) if (f.type === 'chunk') f.code = AVISO + f.code
    },
  }
}

// ID de build para el check-in de versión: usa el commit de Vercel; en local, 'dev'.
const build = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)
// Timestamp del build (monotónico): cada deploy genera uno mayor → sirve para detectar versión nueva.
const buildTs = Date.now()

export default defineConfig({
  plugins: [react(), avisoAutoria()],
  define: {
    __APP_BUILD__: JSON.stringify(build),
    __APP_BUILD_TS__: JSON.stringify(buildTs),
  },
})
