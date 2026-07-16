import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Aplicar el tema guardado antes del primer render
if (localStorage.getItem('orbital_theme') === 'dark') {
  document.documentElement.classList.add('dark')
}

// Registrar el service worker para poder instalar la app en el teléfono (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
