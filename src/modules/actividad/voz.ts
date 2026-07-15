const TEMAS = [
  { key: 'precio', label: '💲 Precio / económicos', keywords: ['precio', 'car[oa]', 'económic', 'economic', 'barato', 'descuento'] },
  { key: 'marca_blanca', label: '🏷️ Marca blanca / producto propio', keywords: ['marca blanca', 'customizado', 'cápsula', 'capsula', 'exclusiv'] },
  { key: 'competencia', label: '🔀 Compra a otro proveedor', keywords: ['compra a', 'otro proveedor', 'competencia'] },
  { key: 'sin_respuesta', label: '📵 No responde / sin contacto', keywords: ['no responde', 'no contesta', 'no atiende', 'sin respuesta', 'no me pude contactar'] },
  { key: 'logistica', label: '🚚 Entrega / pedido / logística', keywords: ['entrega', 'envio', 'envío', 'demora', 'pedido'] },
  { key: 'interes_producto', label: '🕶️ Interés en línea de producto', keywords: ['be rabbit', 'canje', 'preventa', 'urbano', 'sport', 'colección', 'coleccion'] },
]

const IGNORAR = new Set(['orbital linea', 'prueba', 'pueba', 'nada en particular', 'test'])

export function clasificarVoz(nota: string | null): { key: string; label: string } | null {
  if (!nota) return null
  const t = nota.trim().toLowerCase()
  if (!t || IGNORAR.has(t)) return null
  for (const tema of TEMAS) {
    if (tema.keywords.some((k) => new RegExp(k, 'i').test(t))) return { key: tema.key, label: tema.label }
  }
  return { key: 'otro', label: '💬 Otro comentario' }
}
