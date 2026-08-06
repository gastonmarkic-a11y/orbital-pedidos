import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ID de build para el check-in de versión: usa el commit de Vercel; en local, 'dev'.
const build = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7)
// Timestamp del build (monotónico): cada deploy genera uno mayor → sirve para detectar versión nueva.
const buildTs = Date.now()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(build),
    __APP_BUILD_TS__: JSON.stringify(buildTs),
  },
})
