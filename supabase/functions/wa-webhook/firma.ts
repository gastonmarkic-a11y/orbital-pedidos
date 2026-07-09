// Validación de X-Hub-Signature-256 (HMAC-SHA256 sobre el body CRUDO, con APP_SECRET).
// Sin esto, cualquiera puede postear mensajes falsos al endpoint.
// Comparación en tiempo constante.

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación en tiempo constante entre dos strings hex.
function timingSafeEqual(a: string, b: string): boolean {
  // Longitudes distintas: comparamos igual para no filtrar por timing, pero devolvemos false.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function firmaValida(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const recibido = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  const esperado = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(esperado, recibido);
}
