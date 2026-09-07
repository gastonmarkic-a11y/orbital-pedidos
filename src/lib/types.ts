export type Rol = 'vendedor' | 'admin' | 'deposito' | 'logistica' | 'administracion' | 'produccion' | 'tienda' | 'contenido' | 'revendedor' | 'social' | 'usa' | 'financiero'

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
  /** Operador que agendó proxima_agenda_fecha. null = del pool, nadie la tomó todavía */
  agenda_owner: string | null
  /** Prospector (Marketing=Luna / Damian) que derivó el contacto a un vendedor. Se fija arriba de la agenda hasta que lo toma. */
  derivado_por: string | null
  derivado_at: string | null
  /** Igual que derivado_por pero estable: no se limpia cuando el vendedor toma el contacto. Es el que usa Liquidación. */
  derivado_origen: string | null
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
  /** Precio especial de preventa (si está seteado, el vendedor puede elegirlo en el pedido) */
  precio_preventa?: number | null
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
  /** El vendedor eligió el precio de preventa para este ítem */
  preventa?: boolean
  /** Precio de preventa por unidad, snapshot al cargar el pedido (para que no cambie después) */
  precio_pv?: number
  /** Ítem marcado como regalo/bonificación: va a precio 0 (lo ve depósito y va 0 a Tango) */
  regalo?: boolean
  /** Precio NETO especial pactado con el cliente (lista especial por cliente, ej. GAFAS LUXURY).
   *  Es FINAL: reemplaza la lista, sin comercial/financiero, con IVA aparte. */
  precio_esp?: number | null
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
  created_at?: string | null
  fecha: string | null
  vendedor: string | null
  cod_cliente: string | null
  cliente: string | null
  cond_entrega: string | null
  entrega_canal: string | null
  entrega_pago: string | null
  cond_pago: string | null
  medios_pago: string[] | null
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
  /** Momento en que se exportó a Tango (Novedades). Evita reexportar. */
  exportado_tango_at: string | null
  /** Origen del pedido: 'catalogo' | 'consigna' (liquidación) | 'reposicion' | null (normal). */
  origen?: string | null
}

/* ── Módulo financiero ──────────────────────────────────────────────── */

export type RazonSocial = 'Ejemplar' | 'Plenorius' | 'Plastic'
export const RAZONES_SOCIALES: RazonSocial[] = ['Ejemplar', 'Plenorius', 'Plastic']

export interface CuentaFinanciera {
  id: number
  tipo: 'banco' | 'mp' | 'efectivo'
  nombre: string
  razon_social: RazonSocial
  saldo_actual: number
  activo: boolean
  orden: number
  created_at?: string
}

export interface MovimientoFinanciero {
  id: number
  cuenta_id: number
  fecha: string
  /** Positivo = ingreso, negativo = egreso. */
  monto: number
  tipo: string
  contraparte: string | null
  detalle: string | null
  conciliado: boolean
  origen: 'manual' | 'import' | 'mp'
  /** Id en el origen (payment_id de MP, hash de la linea del extracto). Evita duplicar al reimportar. */
  ref_externa: string | null
  created_at?: string
  creado_por?: string | null
}

export interface SaldoDiario {
  id: number
  cuenta_id: number
  fecha: string
  saldo: number
}

export interface ChequeCartera {
  id: number
  numero: string
  banco: string
  monto: number
  tipo: 'fisico' | 'echeck'
  fecha_recepcion: string
  fecha_vencimiento: string
  cliente_id: string | null
  cliente_nombre: string | null
  estado: string
  fecha_deposito: string | null
  fecha_cobro_real: string | null
  cuenta_deposito_id: number | null
  razon_social: RazonSocial | null
  pedido_id: number | null
  nota: string | null
  aviso_enviado_at: string | null
  historial: { fecha: string; de: string; a: string; por: string | null }[] | null
  created_at?: string
  updated_at?: string
  creado_por?: string | null
}

export interface ParametrosFin {
  id: number
  /** TNA de la financiera, en %. */
  tasa_financiera: number
  /** Gasto fijo de la financiera, en % sobre el bruto del cheque. */
  gasto_fijo_financiera: number
  /** TNA de descuento del banco, en %. */
  tasa_banco: number
  comision_fija_banco: number
  /** % que se le ofrece al cliente para que pague en efectivo en vez de con cheque. */
  descuento_efectivo: number
  iva_pct: number
  /** NULL = anualizar el descuento en efectivo con el DSO de la cartera. */
  horizonte_efectivo_dias: number | null
  dias_disp_banco: number
  dias_disp_financiera: number
  dias_disp_efectivo: number
  peso_costo: number
  peso_velocidad: number
  peso_relacion: number
  /** % de la cartera en +90 días a partir del cual salta la alerta. */
  alerta_mora_pct: number
  /** Cifras que ningún módulo deriva todavía y hacen falta para los indicadores. */
  pasivo_corriente: number
  inventario_valorizado: number
  gasto_mensual: number
  ref_liquidez: number
  ref_acida: number
  ref_runway_dias: number
  vigente_desde: string
  creado_por?: string | null
  created_at?: string
}
