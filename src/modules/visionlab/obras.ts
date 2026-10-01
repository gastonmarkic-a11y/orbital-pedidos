// Obras sociales y prepagas para el buscador de oftalmólogos del Vision Lab: link a la cartilla pública de cada una
// (verificados en el dominio de cada una el 01/10/2026) y nombre para buscar en Google Maps "oftalmólogo <nombre>".
// Casi ninguna permite precargar la especialidad por URL: se manda a la búsqueda y se indica elegir Oftalmología.
// Orden de las principales: por cantidad aproximada de afiliados (PAMI, OSDE, IOMA, OSECAC, Swiss Medical…).

export interface ObraSocial {
  id: string
  nombre: string
  /** nombre corto para los botones */
  corto?: string
  /** link a la cartilla pública (null si no tiene búsqueda pública) */
  cartilla: string | null
  /** pide número de afiliado / DNI para ver la cartilla */
  login?: boolean
  /** indicación propia para usar la cartilla (si no, "elegí Oftalmología y tu localidad") */
  ayuda?: string
  /** texto para Google Maps (si no, el nombre) */
  busqueda?: string
  /** aparece como botón (las demás, en "Otra") */
  principal?: boolean
}

export const OBRAS: ObraSocial[] = [
  { id: 'pami', nombre: 'PAMI', cartilla: 'https://www.pami.org.ar/cartilla/buscar-servicio-medico', principal: true,
    ayuda: 'En la cartilla elegí la categoría Oftalmología, tu provincia y tu partido.' },
  { id: 'osde', nombre: 'OSDE', cartilla: 'https://www.osde.com.ar/cartilla-medica', principal: true,
    ayuda: 'En la cartilla elegí tu plan (210, 310, 410…), la especialidad Oftalmología y tu zona.' },
  { id: 'ioma', nombre: 'IOMA', cartilla: 'https://sistemas.ioma.gba.gov.ar/Cartilla/Prestacion/Medico', principal: true,
    ayuda: 'En la cartilla elegí la especialidad Oftalmología, tu partido y tu localidad.' },
  { id: 'osecac', nombre: 'OSECAC', cartilla: 'https://www.osecac.org.ar/Cartillas', login: true, principal: true },
  { id: 'swiss', nombre: 'Swiss Medical', cartilla: 'https://www.swissmedical.com.ar/prepagaclientes/cartilla', principal: true,
    ayuda: 'En la cartilla entrá a "Especialidades médicas", elegí Oftalmología y tu zona.' },
  { id: 'galeno', nombre: 'Galeno', cartilla: 'https://www.galeno.com.ar/planes/220/cartilla/', principal: true,
    ayuda: 'La cartilla abre en el plan 220: si tu plan es otro (200, 330, 440, 550) cambialo arriba. Después elegí Oftalmología y tu zona.' },
  { id: 'osprera', nombre: 'OSPRERA', cartilla: 'https://www.osprera.org.ar/red_prestadores.php', principal: true,
    ayuda: 'En la cartilla elegí tu provincia, tu partido y la especialidad Oftalmología.' },
  { id: 'sancor', nombre: 'Sancor Salud', corto: 'Sancor', cartilla: 'https://sancorsalud.com.ar/cartilla-nosoyasociado', principal: true },
  { id: 'medife', nombre: 'Medifé', cartilla: 'https://www.medife.com.ar/guiamedica/buscadorprestadores', principal: true,
    ayuda: 'Entrá a "Buscar en cartilla", elegí Oftalmología y tu localidad.' },
  { id: 'omint', nombre: 'OMINT', cartilla: 'https://autogestion.omint.com.ar/cartilla/publica', principal: true,
    ayuda: 'En la cartilla elegí tu plan, la especialidad Oftalmología y tu zona.' },

  { id: 'accord', nombre: 'Accord Salud', cartilla: 'https://www.accordsalud.com.ar/cartilla',
    ayuda: 'La cartilla te va pidiendo zona, plan y tipo: en especialidad elegí Oftalmología.' },
  { id: 'avalian', nombre: 'Avalian (ex ACA Salud)', corto: 'Avalian', cartilla: 'https://www.avalian.com/cartilla', busqueda: 'Avalian' },
  { id: 'federada', nombre: 'Federada Salud', cartilla: 'https://federada.com/cartilla-medica/?especialidad=oftalmologia',
    ayuda: 'La cartilla ya abre filtrada en Oftalmología: elegí tu provincia y localidad.' },
  { id: 'hospital-aleman', nombre: 'Hospital Alemán (Plan Médico)', corto: 'Hospital Alemán', cartilla: 'https://www.hospitalaleman.org.ar/plan-medico/quiero-asociarme/cartillas-online/', busqueda: 'Hospital Alemán plan médico' },
  { id: 'hospital-italiano', nombre: 'Hospital Italiano (Plan de Salud)', corto: 'Hospital Italiano', cartilla: 'https://www1.hospitalitaliano.org.ar/PortalWebBeta/#!/login', login: true,
    ayuda: 'La cartilla está dentro del Portal de Pacientes.', busqueda: 'Hospital Italiano plan de salud' },
  { id: 'jerarquicos', nombre: 'Jerárquicos Salud', cartilla: 'https://gestiones.jerarquicos.com/socios/CartillaPrestadores/CartillaPrestadores' },
  { id: 'luis-pasteur', nombre: 'Luis Pasteur', cartilla: 'https://pasteurmobile.com.ar/CartillaComercial', busqueda: 'OSLP Luis Pasteur' },
  { id: 'medicus', nombre: 'Medicus', cartilla: 'https://cartillas.medicus.com.ar/' },
  { id: 'ospaca', nombre: 'OSPACA', cartilla: 'https://www.ospaca.com/informacion/prestadores-medicos/',
    ayuda: 'Entrá a la red de prestadores que figura en tu credencial y elegí Oftalmología.' },
  { id: 'ospe', nombre: 'OSPE (Petroleros)', corto: 'OSPE', cartilla: 'https://www.ospesalud.com.ar/afiliados/cartillas-medicas/',
    ayuda: 'Elegí tu provincia para ver la cartilla y buscá Oftalmología.', busqueda: 'OSPE' },
  { id: 'ospedyc', nombre: 'OSPEDYC', cartilla: 'https://www.ospedyc.org.ar/beneficiarios/cartillamedica.aspx', login: true },
  { id: 'osdepym', nombre: 'OSDEPYM', cartilla: 'https://www.osdepym.com.ar/PortalCMS/cartilla.htm' },
  { id: 'prevencion', nombre: 'Prevención Salud', cartilla: 'https://www.prevencionsalud.com.ar/cartilla-medica' },
  { id: 'union-personal', nombre: 'Unión Personal', cartilla: 'https://gestion.unionpersonal.com.ar/cartilla' },
  { id: 'otra', nombre: 'Otra (no está en la lista)', cartilla: null },
  { id: 'particular', nombre: 'No tengo / particular', cartilla: null },
]

export const PRINCIPALES = OBRAS.filter((o) => o.principal)

/** Nombre para mostrar en el panel: id de la lista ('osde') o "otra: <lo que escribió>". */
export function nombreObraSocial(v: string): string {
  if (v.startsWith('otra: ')) return v.slice(6)
  return OBRAS.find((o) => o.id === v)?.nombre ?? v
}
