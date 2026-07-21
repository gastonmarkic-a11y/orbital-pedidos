# Orbital Eyewear — Bot público de atención y postventa · Contexto técnico

> Documento para arrancar una conversación nueva desde cero sobre el bot multicanal
> B2B+B2C. Pegá esto como contexto inicial. Todo lo de acá está **verificado contra
> la base y el código reales** al 2026-07-21, no es supuesto.

---

## 0. En una línea

Ya existe una **Fase 1 funcionando** (webhook + cola idempotente + resolución de
segmento en SQL + cascada de respuestas por reglas, **sin LLM todavía**). El próximo
paso es sumar el escalón RAG/vector con LLM y **probarlo en un HTML antes de conectar
el número real de WhatsApp**.

---

## 1. Dos productos, un mismo backend

| | Orbital Suite (interno) | Bot público de atención (este proyecto) |
|---|---|---|
| Quién entra | Vendedores, depósito, admin, tienda | Cualquiera: ópticas (B2B) y consumidores (B2C) |
| Interfaz | App React (Vercel) | WhatsApp / Instagram / web / teléfono |
| Estado | En producción | Fase 1 (reglas) lista; falta LLM + prueba HTML |

Ambos comparten la **misma base Supabase** (proyecto `towcgvphxeqilpdnboki`), mismas
tablas de `clientes`, `stock`, `pedidos`, `vendedores`.

---

## 2. Stack técnico

- **Frontend Suite:** React 18 + Vite + TypeScript + Tailwind + react-router. Repo
  `gastonmarkic-a11y/orbital-pedidos`, rama `feature/orbital-suite`, deploy en Vercel
  (`orbital-pedidos-...vercel.app`, instalada como PWA).
- **Backend:** Supabase (Postgres 17). Edge Functions en Deno/TypeScript.
- **Auth Suite:** magic link por mail (Supabase Auth), roles en `vendedores.rol`.
- **WhatsApp:** Cloud API de Meta. Número conectado: **+54 9 11 7854-8316** ("Orbital",
  Argentina), estado **Conectado**, calidad **Alta**, negocio **verificado y aprobado**.
  Zona horaria America/Argentina/Buenos_Aires. (Divisa de la cuenta de WA figura en USD,
  ojo si se usa para algo.)

### Edge Functions ya desplegadas (Supabase)
- `wa-webhook` (v5) — **el bot**. GET verifica webhook; POST recibe mensajes.
- `shopify-import` (v14) — importa pedidos de la tienda a `pedidos`.
- `shopify-productos`, `shopify-oauth-start/callback` — sync catálogo/OAuth tienda.
- `meta-insights-sync`, `meta-oauth-start/callback` — trae gasto/ROAS de Meta Ads.

---

## 3. El bot que YA existe: `wa-webhook` (Fase 1, sin LLM)

Arquitectura de archivos dentro de la function:
`index.ts` (orquestador) · `firma.ts` (HMAC) · `db.ts` (acceso datos) · `menu.ts`
(menús interactivos) · `reglas.ts` (regex de intención) · `whatsapp.ts` (Cloud API) ·
`types.ts` (tipos del payload de Meta).

### Flujo por mensaje entrante
1. **Verificación de firma** `X-Hub-Signature-256` (HMAC-SHA256 con `APP_SECRET`).
2. **Cola idempotente**: insert en `mensajes` con `wa_message_id` único → si ya existe,
   se ignora (no se procesa dos veces).
3. **Rate limit**: máx. `RATE_LIMIT_POR_MINUTO` (default 15) entrantes/min por teléfono.
4. **Resolución de segmento** vía RPC `wa_resolver_segmento(telefono)`.
5. **Upsert de `conversaciones`** (estado persistente por teléfono).
6. Si `requiere_humano` → no responde (ya está en manos de una persona).
7. **Cascada de resolución** (escalones):
   - **Escalón 1 · menú**: lista interactiva nativa de WhatsApp. Los `id` de las filas
     SON las intenciones (routing directo, costo 0). Límite duro: 10 filas por lista.
   - **Escalón 2 · reglas**: regex sobre el texto (`reglas.ts`) → intención.
   - **Respuesta curada**: busca en `base_conocimiento` por intención + segmento.
   - **Escalamiento a humano**: por reglas (cobranza, devolución, reclamo, garantía a
     gestionar, precio especial, "quiero hablar con una persona"), o B2B activo pidiendo
     datos sensibles → deriva.
   - **Fallback**: si no entiende, reenvía el menú.

### Escalones definidos (enum `Escalon`)
`menu | regla | vector | rag | humano` — **`vector` y `rag` están declarados pero NO
implementados todavía**. Ese es el hueco a llenar con el LLM.

### Secrets que usa (Supabase → Edge Functions → Secrets)
`VERIFY_TOKEN`, `APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`RATE_LIMIT_POR_MINUTO`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## 4. Resolución de segmento — el corazón del diseño

El segmento **no** se deduce del canal (por WhatsApp entran tanto ópticas como
consumidores). Se resuelve por contacto con la RPC:

```
wa_resolver_segmento(telefono_entrante text)
  → TABLE(segmento text, cod_cliente text, telefono_norm text)
```

**Tres segmentos, no dos** (matiz importante vs. el brief original):
- `b2b_activo` — óptica que ya es cliente (match en `clientes`, con compras/actividad).
- `b2b_inactivo` — óptica conocida pero sin actividad reciente.
- `b2c` — sin match → consumidor final.

Apoyo: tabla `clientes_telefono_index` (1315 filas) mapea teléfono normalizado → `cod`
de cliente. Se regenera con `wa_rebuild_telefono_index()`. Helper `wa_nsn(raw)` normaliza
el número. El segmento se resuelve una vez y **persiste** en `conversaciones` toda la
sesión; no se re-pregunta en cada mensaje.

---

## 5. Tablas relevantes (esquema real)

### `conversaciones` (estado por teléfono)
`id, telefono (unique), telefono_norm, cod_cliente, segmento (b2b_activo|b2b_inactivo|b2c,
default b2c), requiere_humano (bool), escalado_motivo, escalado_en, turnos_baja_conf,
estado (activa|escalada|cerrada), ultima_actividad, ultimo_saliente, created_at, updated_at`

### `mensajes` (cola idempotente + log entrantes/salientes)
`id, wa_message_id (unique), conversacion_id, telefono, direccion (entrante|saliente),
tipo, contenido, payload (jsonb), intencion, escalon_resuelto (menu|regla|vector|rag|
humano), confianza (numeric), estado (pendiente|procesado|error), error_detalle,
intentos, created_at, procesado_en`

### `base_conocimiento` (respuestas curadas por intención) — 14 filas hoy
`id, intencion, pregunta, variantes (text[]), respuesta, segmentos_permitidos (text[],
subconjunto de {b2b_activo,b2b_inactivo,b2c}, cardinalidad ≥ 1), siempre_escala (bool),
activa (bool), prioridad (int, menor = primero), created_at, updated_at`

**GUARDRAIL:** el filtro por segmento va en el `WHERE` del SQL
(`.contains('segmentos_permitidos', [segmento])`), **no en el prompt**. Un B2C no puede
ver contenido solo-B2B porque el registro nunca sale de la base — no depende de que el
modelo "se acuerde".

Contenido cargado hoy (intención → segmentos):
- Solo B2C: `como_ser_cliente` (versión consumidor), `donde_comprar`.
- Solo B2B: `condiciones_generales`, `propuestas_comerciales`, `zona_vendedor`,
  `preventa` (solo b2b_activo), `como_ser_cliente` (versión óptica).
- Todos: `catalogo_modelos`, `tecnologia_lentes`, `garantia`, `cuidado_producto`,
  `redes_contacto`.
- Placeholders sin completar (activa=false): `direccion`, `horarios`.

### `clientes` (5446 filas) — universo B2B
`cod (PK), razon, nomcomerc, cuit, localidad, provincia, zona, telefono, whatsapp, email,
contacto, nro_lista, vendedor_asignado (FK vendedores.codigo), prioridad, proximo_paso,
proxima_agenda_fecha, ultima_compra_fecha, ultima_compra_monto, unidades_2025,
clasificacion_recupero, segmento_corporativo, nota, horario_entrega`

### `stock` (843) · `pedidos` (72) · `vendedores` (15)
- `stock`: `codigo (PK), modelo, descripcion, precio, cantidad, clasificacion, tipo,
  tratamiento, demanda, es_caliente`.
- `pedidos`: pedidos B2B + de tienda (Shopify). Los de tienda van con `vendedor='Tienda'`,
  clientes fijos `888888` (línea) / `888889` (outlet).
- `vendedores`: `codigo, nombre, email, rol (vendedor|admin|deposito|logistica|
  administracion|produccion|tienda), telefono_remitente`. Vendedores de la tienda física
  B2B a los que deriva el bot: **Adrián y Martín**.

---

## 6. Reglas de negocio del bot (comportamiento por segmento)

- **Precios:** B2B ve lista mayorista vigente; B2C **no** ve precio (Orbital vende vía
  ópticas) → se lo deriva a la óptica más cercana o a la Tienda.
- **Stock:** B2B ve disponibilidad para pedir; B2C solo "disponible / consultá en tu
  óptica" o link a Tienda.
- **Derivación con intención de compra:**
  - B2B → vendedor asignado (Adrián/Martín) vía `wa.me`.
  - B2C → Tienda/Shopify (ventas atribuidas a `888888`/`888889`) o la óptica más cercana.
- **Tono:** mismo espíritu de marca; a la óptica se le habla de reposición, márgenes y
  campañas; al consumidor, de producto y experiencia.

### Marca / producto (para las respuestas)
- Colección 2026: **ASCARI, CIVIC CENTER, CASA BLANCA, 5TH AVENUE** (líneas históricas
  también: SOPHIA, LE MANS, LONG BEACH; cápsula con Zaira Nara).
- Tecnología: lentes **VSL™ HD Real**, UV400, filtro Blue Light/Blue Cut 420nm,
  polarizados. Materiales: Nylon PA12, acetato italiano, ultralivianos.
- Instagram: **@orbital.eyewear**. Fabricación en Morón; desarrollo creativo con Miami.

---

## 7. Qué falta construir (el trabajo real de este proyecto)

1. **Escalón RAG/vector con LLM** (`escalon_resuelto = 'vector'|'rag'`): cuando reglas +
   respuesta curada no alcanzan, buscar en base de conocimiento por similitud (embeddings)
   y redactar con un LLM. **El filtro por segmento tiene que ir igual en el SQL del
   retrieval, no en el prompt.** Hoy `base_conocimiento` es match exacto por intención;
   falta la columna de embeddings + función de búsqueda vectorial (pgvector).
2. **Harness de prueba en HTML** (pedido explícito): una página que simule el chat
   —mande texto, muestre la respuesta del bot, deje elegir segmento b2b_activo/b2b_inactivo/
   b2c— **sin tocar el número real de WhatsApp**. Sirve para probar la lógica de cascada,
   los guardrails y el tono antes de conectar. Puede pegar contra una edge function de
   test o correr la lógica en el browser con datos mock.
3. **Multicanal real:** hoy el webhook es de WhatsApp. Instagram/web/teléfono comparten
   el mismo endpoint conceptual pero falta el adaptador de cada canal.
4. **Completar `base_conocimiento`:** `direccion` y `horarios` están como placeholders
   inactivos.

---

## 8. Cómo probar sin romper producción

- El webhook valida firma HMAC: un POST de prueba sin firma válida da 401. Para el harness
  HTML conviene una **edge function de test aparte** (sin validación de firma, protegida
  por otra clave) que exponga solo la cascada de resolución, o correr la lógica de
  `reglas.ts`/menú en el browser con datos mock.
- La cola es idempotente por `wa_message_id`: para pruebas, generar ids únicos.
- Nunca mandar mensajes reales al número productivo desde pruebas: el harness debe
  **mostrar** la respuesta, no enviarla por Cloud API.
```
