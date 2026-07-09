// Cliente mínimo de WhatsApp Cloud API para enviar respuestas.
// Verifica la ventana de 24h antes de cualquier envío de texto libre.

const GRAPH_VERSION = "v21.0";

interface EnvioResultado {
  ok: boolean;
  status: number;
  body: unknown;
}

function baseUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

async function postMensaje(
  token: string,
  phoneNumberId: string,
  body: Record<string, unknown>,
): Promise<EnvioResultado> {
  const res = await fetch(baseUrl(phoneNumberId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export function enviarTexto(
  token: string,
  phoneNumberId: string,
  to: string,
  texto: string,
): Promise<EnvioResultado> {
  return postMensaje(token, phoneNumberId, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: texto },
  });
}

export interface FilaLista {
  id: string;
  title: string;        // máx 24 chars
  description?: string; // máx 72 chars
}

export interface SeccionLista {
  title: string;
  rows: FilaLista[];
}

export function enviarLista(
  token: string,
  phoneNumberId: string,
  to: string,
  cuerpo: string,
  botonTexto: string,
  secciones: SeccionLista[],
  header?: string,
): Promise<EnvioResultado> {
  return postMensaje(token, phoneNumberId, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      ...(header ? { header: { type: "text", text: header } } : {}),
      body: { text: cuerpo },
      action: { button: botonTexto, sections: secciones },
    },
  });
}

export interface BotonReply {
  id: string;
  title: string; // máx 20 chars
}

export function enviarBotones(
  token: string,
  phoneNumberId: string,
  to: string,
  cuerpo: string,
  botones: BotonReply[],
): Promise<EnvioResultado> {
  return postMensaje(token, phoneNumberId, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: cuerpo },
      action: {
        buttons: botones.slice(0, 3).map((b) => ({ type: "reply", reply: b })),
      },
    },
  });
}
