// Tipado explícito del payload del webhook de WhatsApp Cloud API (Meta).
// Sin `any`: sólo modelamos lo que consumimos, el resto queda como unknown.

export type Segmento = "b2b_activo" | "b2b_inactivo" | "b2c";

export type Escalon = "menu" | "regla" | "vector" | "rag" | "humano";

export interface WaTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text";
  text: { body: string };
}

export interface WaInteractiveMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "interactive";
  interactive:
    | { type: "button_reply"; button_reply: { id: string; title: string } }
    | { type: "list_reply"; list_reply: { id: string; title: string; description?: string } };
}

export interface WaOtherMessage {
  from: string;
  id: string;
  timestamp: string;
  type: Exclude<string, "text" | "interactive">;
  [k: string]: unknown;
}

export type WaMessage = WaTextMessage | WaInteractiveMessage | WaOtherMessage;

export interface WaStatus {
  id: string;
  status: string;
  recipient_id: string;
  timestamp: string;
}

export interface WaChangeValue {
  messaging_product: "whatsapp";
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: WaMessage[];
  statuses?: WaStatus[];
}

export interface WaChange {
  field: string;
  value: WaChangeValue;
}

export interface WaEntry {
  id: string;
  changes: WaChange[];
}

export interface WaWebhookPayload {
  object: string;
  entry: WaEntry[];
}

// Contenido normalizado de un mensaje entrante que nos importa procesar.
export interface EntranteNormalizado {
  waMessageId: string;
  from: string;
  tipo: string;
  texto: string | null;        // cuerpo de texto (text.body) si aplica
  replyId: string | null;      // id de button_reply / list_reply si aplica
  payload: WaMessage;
}

export function extraerEntrante(msg: WaMessage): EntranteNormalizado {
  if (msg.type === "text") {
    const t = msg as WaTextMessage;
    return { waMessageId: t.id, from: t.from, tipo: "text", texto: t.text.body, replyId: null, payload: msg };
  }
  if (msg.type === "interactive") {
    const i = msg as WaInteractiveMessage;
    if (i.interactive.type === "button_reply") {
      return {
        waMessageId: i.id, from: i.from, tipo: "button_reply",
        texto: i.interactive.button_reply.title, replyId: i.interactive.button_reply.id, payload: msg,
      };
    }
    return {
      waMessageId: i.id, from: i.from, tipo: "list_reply",
      texto: i.interactive.list_reply.title, replyId: i.interactive.list_reply.id, payload: msg,
    };
  }
  const o = msg as WaOtherMessage;
  return { waMessageId: o.id, from: o.from, tipo: String(o.type), texto: null, replyId: null, payload: msg };
}
