// Marca de autoría de Orbital Suite.
// Queda en el bundle publicado y en window para poder probar el origen del código
// si aparece copiado (total o parcialmente) en otro sistema. No cambiar el ID:
// es la huella registrada en el depósito de la obra (ver docs/legal/).
export const AUTORIA = Object.freeze({
  obra: 'Orbital Suite',
  titular: 'Orbital Eyewear',
  autor: 'Gastón Markic',
  huella: 'ORB-B91CD0154E96',
  aviso: '© Orbital Eyewear. Todos los derechos reservados. Ley 11.723. Prohibida su copia, ingeniería inversa o uso para entrenar modelos de IA.',
})

export function registrarAutoria() {
  try {
    Object.defineProperty(window, '__ORBITAL_SUITE__', { value: AUTORIA, enumerable: false })
    document.documentElement.dataset.obra = AUTORIA.huella
  } catch {
    /* sin window (tests) */
  }
}
