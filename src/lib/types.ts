export type Rol = 'vendedor' | 'admin' | 'deposito' | 'logistica' | 'administracion' | 'produccion' | 'tienda'

export interface StockIngreso {
  id: number
  codigo: string
  modelo: string | null
  descripcion: string | null
  cantidad: number
  precio: number | null
  estado: 'proyectado' | 'confirmado' | 'anulado'
  creado_por: string | null
  created_at: string | null
  confirmado_por: string | null
  confirmado_at: string | null
  nota: string | null
}

export interface Vendedor {
  id: number
  codigo: string
  nombre: string
  email: string | null
  rol: Rol
  activo: boolean
  user_id: string | null
}

export interface Cliente {
  cod: string
  razon: string | null
  localidad: string | null
  telefono: string | null
  cuit: string | null
  nomcomerc: string | null
  direccion: string | null
  email: string | null
  contacto: string | null
  nro_lista: number | null
  whatsapp: string | null
  zona: string | null
  provincia: string | null
  origen: string | null
  ex_vendedor_origen: string | null
  vendedor_asignado: string | null
  prioridad: string | null
  proximo_paso: string | null
  proxima_agenda_fecha: string | null
  ultima_compra_fecha: string | null
  ultima_compra_monto: number | null
  unidades_2025: number | null
  clasificacion_recupero: string | null
  segmento_corporativo: string | null
  horario_entrega: string | null
  nota: string | null
}

export interface Actividad {
  id: number
  fecha: string
  vendedor: string | null
  cod_cliente: string | null
  nombre_comercio: string | null
  contacto: string | null
  telefono: string | null
  localidad: string | null
  email: string | null
  resultado_contacto: string | null
  propuesta_enviada_id: number | null
  voz_cliente_nota: string | null
  actividad_desarrollo: string | null
  actividad_futura: string | null
  proximo_paso_fecha: string | null
  unidades_vendidas: number | null
  monto_vendido: number | null
}

export interface Propuesta {
  id: number
  mes_anio: string | null
  nombre: string
  descripcion: string | null
  objetivo_envios: number | null
  activa: boolean
  orden: number | null
}

export interface ObjetivoMes {
  id: number
  mes_anio: string
  vendedor: string
  objetivo_contactos: number | null
  objetivo_propuestas: number | null
  objetivo_ventas: number | null
}

export interface PiezaMarketing {
  id: number
  categoria: string
  tema: string | null
  url_publica: string | null
  url_corta: string | null
  titulo: string
  descripcion: string | null
  contenido_texto: string | null
  url: string | null
  orden: number | null
  activa: boolean
}

export interface StockItem {
  codigo: string
  modelo: string
  descripcion: string | null
  estuche: string | null
  cantidad: number
  precio: number | null
  clasificacion: string | null
  tipo: string | null
  tratamiento: string | null
  demanda: number | null
  es_caliente: boolean | null
}

export interface PedidoItem {
  codigo: string
  modelo: string
  descripcion: string | null
  cantidad: number
  /** Unidades que no había en stock al cargar el pedido: se cubren con stock proyectado */
  pendiente?: number
  /** Precio real ya pagado por unidad (pedidos de Shopify) — si está presente, manda sobre la lista de Orbital */
  precio?: number
  sku_shopify?: string | null
  seccion?: 'linea' | 'outlet'
}

export type EstadoPedido =
  | 'pendiente'
  | 'en_preparacion'
  | 'observado'
  | 'listo'
  | 'facturado'
  | 'listo_despachar'
  | 'despachado'

export interface Pedido {
  id: number
  fecha: string | null
  vendedor: string | null
  cod_cliente: string | null
  cliente: string | null
  cond_entrega: string | null
  cond_pago: string | null
  dto_comercial: string | null
  dto_financiero: string | null
  dias_pago: string | null
  wsp: string | null
  mail: string | null
  obs: string | null
  items: PedidoItem[] | null
  total_units: number | null
  estado: EstadoPedido | null
  nro_lista: number | null
  blanco_pct: number | null
  negro_pct: number | null
  cuotas_detalle: string | null
  obs_deposito: string | null
  fecha_entrega: string | null
  fecha_factura: string | null
  importe_neto: number | null
  cobrado: boolean | null
  nro_remito: string | null
  nro_factura: string | null
  tipo_transporte: string | null
  nro_guia: string | null
  contacto_entrega: string | null
  direccion_entrega: string | null
  horario_entrega: string | null
  picking: string[] | null
  factura_enviada_at: string | null
  factura_enviada_canal: string | null
  factura_enviada_por: string | null
  /** Depósito decidió entregar lo disponible y dejar el resto pendiente */
  entrega_parcial: boolean | null
  /** Depósito decidió esperar a que ingrese el proyectado antes de armar */
  esperando_stock: boolean | null
}
