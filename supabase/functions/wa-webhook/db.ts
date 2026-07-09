// Acceso a datos con service_role (bypass de RLS). Las tablas del sistema
// tienen RLS activada sin políticas: sólo esta clave puede leer/escribir.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Segmento } from "./types.ts";

export function crearCliente(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface Conversacion {
  id: number;
  telefono: string;
  segmento: Segmento;
  cod_cliente: string | null;
  requiere_humano: boolean;
}

export interface ResolucionSegmento {
  segmento: Segmento;
  cod_cliente: string | null;
  telefono_norm: string | null;
}

// Clasifica el teléfono entrante vía la función SQL (filtro de segmento en SQL).
export async function resolverSegmento(
  db: SupabaseClient,
  telefono: string,
): Promise<ResolucionSegmento> {
  const { data, error } = await db.rpc("wa_resolver_segmento", { telefono_entrante: telefono });
  if (error) throw new Error(`wa_resolver_segmento: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { segmento: "b2c", cod_cliente: null, telefono_norm: null };
  return {
    segmento: row.segmento as Segmento,
    cod_cliente: row.cod_cliente ?? null,
    telefono_norm: row.telefono_norm ?? null,
  };
}

// Inserta el mensaje entrante de forma idempotente. Devuelve null si ya existía
// (reintento de Meta) → el caller no vuelve a procesar ni a responder.
export async function insertarEntranteIdempotente(
  db: SupabaseClient,
  row: {
    wa_message_id: string;
    telefono: string;
    tipo: string;
    contenido: string | null;
    payload: unknown;
  },
): Promise<number | null> {
  const { data, error } = await db
    .from("mensajes")
    .upsert(
      { ...row, direccion: "entrante", estado: "pendiente" },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`insert entrante: ${error.message}`);
  if (!data || data.length === 0) return null; // duplicado
  return data[0].id as number;
}

// Rate limit por teléfono: cuántos entrantes en la última ventana.
export async function contarEntrantesRecientes(
  db: SupabaseClient,
  telefono: string,
  ventanaSegundos: number,
): Promise<number> {
  const desde = new Date(Date.now() - ventanaSegundos * 1000).toISOString();
  const { count, error } = await db
    .from("mensajes")
    .select("id", { count: "exact", head: true })
    .eq("telefono", telefono)
    .eq("direccion", "entrante")
    .gte("created_at", desde);
  if (error) throw new Error(`rate limit count: ${error.message}`);
  return count ?? 0;
}

export async function upsertConversacion(
  db: SupabaseClient,
  res: ResolucionSegmento,
  telefono: string,
): Promise<Conversacion> {
  // ¿existe?
  const { data: existente, error: selErr } = await db
    .from("conversaciones")
    .select("id, telefono, segmento, cod_cliente, requiere_humano")
    .eq("telefono", telefono)
    .maybeSingle();
  if (selErr) throw new Error(`select conversacion: ${selErr.message}`);

  if (existente) {
    // Actualizamos actividad y segmento (puede haber cambiado de inactivo→activo).
    // No pisamos requiere_humano: el escalamiento es de una sola vía.
    const { data, error } = await db
      .from("conversaciones")
      .update({
        segmento: res.segmento,
        cod_cliente: res.cod_cliente,
        telefono_norm: res.telefono_norm,
        ultima_actividad: new Date().toISOString(),
      })
      .eq("id", existente.id)
      .select("id, telefono, segmento, cod_cliente, requiere_humano")
      .single();
    if (error) throw new Error(`update conversacion: ${error.message}`);
    return data as Conversacion;
  }

  const { data, error } = await db
    .from("conversaciones")
    .insert({
      telefono,
      telefono_norm: res.telefono_norm,
      segmento: res.segmento,
      cod_cliente: res.cod_cliente,
      ultima_actividad: new Date().toISOString(),
    })
    .select("id, telefono, segmento, cod_cliente, requiere_humano")
    .single();
  if (error) throw new Error(`insert conversacion: ${error.message}`);
  return data as Conversacion;
}

// Busca respuesta curada aplicando el filtro de segmento EN SQL (@>).
// Un segmento no permitido nunca recibe la fila: el contenido restringido
// jamás entra al contexto.
export async function buscarRespuestaCurada(
  db: SupabaseClient,
  intencion: string,
  segmento: Segmento,
): Promise<string | null> {
  const { data, error } = await db
    .from("base_conocimiento")
    .select("respuesta")
    .eq("intencion", intencion)
    .eq("activa", true)
    .contains("segmentos_permitidos", [segmento])
    .order("prioridad", { ascending: true })
    .limit(1);
  if (error) throw new Error(`buscar respuesta: ${error.message}`);
  if (!data || data.length === 0) return null;
  return data[0].respuesta as string;
}

export async function escalarConversacion(
  db: SupabaseClient,
  conversacionId: number,
  motivo: string,
): Promise<void> {
  const { error } = await db
    .from("conversaciones")
    .update({
      requiere_humano: true,
      estado: "escalada",
      escalado_motivo: motivo,
      escalado_en: new Date().toISOString(),
    })
    .eq("id", conversacionId);
  if (error) throw new Error(`escalar: ${error.message}`);
}

export async function registrarSaliente(
  db: SupabaseClient,
  conversacionId: number,
  telefono: string,
  contenido: string,
  intencion: string | null,
  escalon: string,
): Promise<void> {
  await db.from("mensajes").insert({
    conversacion_id: conversacionId,
    telefono,
    direccion: "saliente",
    tipo: "text",
    contenido,
    intencion,
    escalon_resuelto: escalon,
    estado: "procesado",
    procesado_en: new Date().toISOString(),
  });
  await db
    .from("conversaciones")
    .update({ ultimo_saliente: new Date().toISOString() })
    .eq("id", conversacionId);
}

export async function marcarProcesado(
  db: SupabaseClient,
  mensajeId: number,
  intencion: string | null,
  escalon: string | null,
): Promise<void> {
  await db
    .from("mensajes")
    .update({
      estado: "procesado",
      intencion,
      escalon_resuelto: escalon,
      procesado_en: new Date().toISOString(),
    })
    .eq("id", mensajeId);
}

export async function marcarError(
  db: SupabaseClient,
  mensajeId: number,
  detalle: string,
): Promise<void> {
  // intentos + 1 vía RPC atómica no disponible aquí: leemos y sumamos.
  const { data } = await db.from("mensajes").select("intentos").eq("id", mensajeId).single();
  const intentos = ((data?.intentos as number) ?? 0) + 1;
  await db
    .from("mensajes")
    .update({ estado: "error", error_detalle: detalle.slice(0, 2000), intentos })
    .eq("id", mensajeId);
}
