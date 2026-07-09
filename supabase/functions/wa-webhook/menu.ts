// Escalón 1 de la cascada: menú interactivo nativo de WhatsApp.
// Los ids de las filas SON las intenciones (routing directo, costo 0).
// Límite duro de la Cloud API: máx. 10 filas en total por lista.

import type { Segmento } from "./types.ts";
import type { SeccionLista } from "./whatsapp.ts";

interface Menu {
  header: string;
  cuerpo: string;
  boton: string;
  secciones: SeccionLista[];
}

const PRODUCTO: SeccionLista = {
  title: "Producto",
  rows: [
    { id: "catalogo_modelos", title: "Modelos 2026", description: "ASCARI · CIVIC CENTER · CASA BLANCA · 5TH AVENUE" },
    { id: "tecnologia_lentes", title: "Tecnología de lentes", description: "VSL HD, UV400, Blue Cut 420nm" },
    { id: "garantia", title: "Garantía", description: "Cómo funciona" },
    { id: "cuidado_producto", title: "Cuidado y limpieza", description: "Para que duren" },
  ],
};

const AYUDA_ROW = { id: "hablar_humano", title: "Hablar con el equipo", description: "Te pasamos con una persona" };
const REDES_ROW = { id: "redes_contacto", title: "Instagram y contacto", description: "@orbital.eyewear" };

export function construirMenu(segmento: Segmento): Menu {
  if (segmento === "b2b_activo") {
    return {
      header: "Orbital Eyewear",
      cuerpo: "Hola, ¿en qué te damos una mano hoy?",
      boton: "Ver opciones",
      secciones: [
        {
          title: "Tu cuenta",
          rows: [
            { id: "precios", title: "Precios", description: "Lista mayorista" },
            { id: "stock", title: "Stock", description: "Disponibilidad por modelo" },
            { id: "estado_pedido", title: "Estado de pedido", description: "Seguí tu pedido" },
          ],
        },
        {
          title: "Comercial",
          rows: [
            { id: "propuestas_comerciales", title: "Propuestas", description: "Canje, preventa y más" },
            { id: "zona_vendedor", title: "Mi vendedor", description: "Quién te atiende" },
            { id: "condiciones_generales", title: "Condiciones", description: "Pagos y entregas" },
          ],
        },
        {
          title: "Producto",
          rows: [
            { id: "catalogo_modelos", title: "Modelos 2026", description: "Colección" },
            { id: "tecnologia_lentes", title: "Tecnología", description: "VSL, UV400, Blue Cut" },
          ],
        },
        { title: "Ayuda", rows: [AYUDA_ROW] },
      ],
    };
  }

  if (segmento === "b2b_inactivo") {
    return {
      header: "Orbital Eyewear",
      cuerpo: "Hola, ¿en qué te damos una mano?",
      boton: "Ver opciones",
      secciones: [
        PRODUCTO,
        {
          title: "Trabajar con Orbital",
          rows: [
            { id: "como_ser_cliente", title: "Vender Orbital", description: "Sumá la marca a tu óptica" },
            { id: "condiciones_generales", title: "Condiciones", description: "Pagos y entregas" },
            { id: "propuestas_comerciales", title: "Propuestas", description: "Canje, preventa y más" },
            { id: "zona_vendedor", title: "Mi vendedor", description: "Quién te atiende" },
          ],
        },
        { title: "Más", rows: [REDES_ROW, AYUDA_ROW] },
      ],
    };
  }

  // b2c
  return {
    header: "Orbital Eyewear",
    cuerpo: "¡Hola! Bienvenido a Orbital. ¿Qué te gustaría ver?",
    boton: "Ver opciones",
    secciones: [
      PRODUCTO,
      {
        title: "Comprar",
        rows: [
          { id: "donde_comprar", title: "Dónde comprar", description: "Ópticas que tienen Orbital" },
          REDES_ROW,
        ],
      },
      { title: "Ayuda", rows: [AYUDA_ROW] },
    ],
  };
}

// Ids del menú que son intenciones válidas (routing directo).
export function esIntencionDeMenu(id: string): boolean {
  return /^[a-z_]+$/.test(id);
}
