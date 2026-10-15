// Categoría fija de algunos modelos (pedido del 15/10). Manda sobre las secciones del catálogo:
// en la home el modelo se muestra en esta sección (no en la primera que le toque) y en la Carga masiva
// es su categoría. Las secciones transversales (Día de la Madre, Cuando baja la luz) lo siguen mostrando.
export const CATEGORIA_FIJA: Record<string, string> = {
  '5TH AVENUE': 'destacados', 'ASCARI': 'destacados', 'CASA BLANCA': 'destacados', 'CIVIC CENTER': 'destacados',
  'ADELAIDA': 'destacados', 'BUENOS AIRES I': 'destacados', 'EIVISSA': 'destacados', 'LE MANS': 'destacados', 'SILVERSTONE': 'destacados',
  'ATLANTIC CITY': 'urbano', 'BRERA': 'urbano', 'BROOKLYN': 'urbano', 'CHARLOTTE': 'urbano', 'CRETA': 'urbano',
  'LOS HAMPTON': 'urbano', 'PALERMO': 'urbano', 'PARIS': 'urbano', 'ROMA': 'urbano', 'SOPHIA': 'urbano', 'VENICE': 'urbano', 'WYNWOOD': 'urbano',
}
