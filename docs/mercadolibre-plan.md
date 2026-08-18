# Mercado Libre como canal de Orbital — plan técnico

> Estado: **propuesta**, nada construido todavía. Escrito el 2026-08-17 contra el
> esquema real de Supabase (`towcgvphxeqilpdnboki`) y las Edge Functions desplegadas.
>
> Decisiones tomadas (2026-08-17): ML entra como **canal nuevo dentro de Orbital**, no como
> proyecto aparte. La cuenta **ya es Tienda Oficial**, **ya tiene publicaciones cargadas** y la
> logística es **mixta** (parte Full, parte stock propio).

---

## 0. Qué se puede y qué no

| | Programable | Cómo |
|---|---|---|
| Header / banners / secciones de la Tienda Oficial | ❌ No | Panel de ML. Acepta imágenes, no HTML/CSS. |
| Descripciones de publicaciones | ❌ No (texto plano) | ML sacó el HTML hace años. |
| Alta / edición de publicaciones | ✅ Sí | API `/items` |
| Stock y precios | ✅ Sí | API `PUT /items/{id}` |
| Órdenes | ✅ Sí | Notificaciones `orders_v2` |
| Preguntas y post-venta | ✅ Sí | Notificaciones `questions` / `messages` |
| Métricas por publicación | ✅ Sí | API `/visits`, `/items/{id}` |

**"Tienda Oficial" no es código**: es una aprobación comercial de ML. Ya la tenemos, así que
el `official_store_id` sirve además como filtro para barrer las publicaciones propias
(`GET /users/{id}/items/search?official_store_id=X`).

---

## 1. Encaje con lo que ya existe

ML es, arquitectónicamente, **el mismo patrón que Shopify**, que ya está andando.
Se replica la estructura, no se inventa nada:

| Shopify (hoy, en prod) | Mercado Libre (a construir) |
|---|---|
| `shopify-oauth-start` / `-callback` | `ml-oauth-start` / `ml-oauth-callback` |
| tabla `shopify_stores` (token) | tabla `ml_cuentas` (token + refresh) |
| `shopify-import` → `pedidos` | `webhook-ml` → `pedidos` |
| `sync-precios-shopify`, `shopify-productos` | `ml-sync` (stock + precio) |
| `ventas_shopify` | `ventas_ml` |
| `mapeo_producto_shopify` | `mapeo_producto_ml` |
| `bot-central` + `webhook-web` / `-instagram` | `bot-central` + canal `ml` |

Fuentes de verdad que ya existen y se reusan tal cual:
- `stock.cantidad` → `available_quantity` de las publicaciones con stock propio
- `precios_publicos.precio` (1049 filas, lista B2C) → base de `price`
- `producto_imagenes` (177 filas) → `pictures` del item
- `pedidos` → destino final de las ventas, con `origen = 'ML'`

---

## 2. Modelo de datos nuevo

```
ml_cuentas
  id, user_id (seller), nickname, site_id ('MLA'), official_store_id,
  access_token, refresh_token, expires_at, scope, updated_at

mapeo_producto_ml
  id, item_id ('MLA...'), variation_id, codigo (→ stock.codigo),
  titulo, estado (active|paused|closed),
  logistic_type (fulfillment|cross_docking|drop_off|xd_drop_off|self_service),
  es_full (bool, derivado), stock_full (int, lo que ML dice que tiene),
  match_origen (sku|titulo|manual), ultimo_sync, ultimo_error

ventas_ml
  id, order_id, pack_id, fecha, comprador, total, unidades,
  shipping_id, logistic_type, pedido_id (→ pedidos.id), raw jsonb

ml_preguntas
  id, question_id (unique), item_id, texto, respuesta,
  resuelto_por (bot|humano), estado, created_at, respondido_en

ml_config
  markup_pct_propio, markup_pct_full, comision_estimada_pct,
  envio_gratis_desde, pausar_si_stock_cero, buffer_unidades
```

`ml_procesados` (o reusar el patrón de `wa_procesados`) para la **cola idempotente**
de notificaciones: ML reintenta cada notificación hasta que devolvés 200, y manda
duplicados. Sin idempotencia, se duplican pedidos.

---

## 3. Fases

### Fase 0 · Credenciales y OAuth *(bloqueante, requiere acción tuya)*

1. Crear la aplicación en el panel de desarrolladores de ML (Client ID + Secret).
2. Configurar `redirect_uri` → `.../functions/v1/ml-oauth-callback`.
3. Configurar la **URL de notificaciones** → `.../functions/v1/webhook-ml`, con los
   topics: `orders_v2`, `questions`, `messages`, `items`, `shipments`.
4. Deploy de `ml-oauth-start` / `ml-oauth-callback` (con PKCE, que ML exige) y
   un cron `ml-token-refresh`.

⚠️ **Detalle que rompe integraciones**: el access token de ML dura **6 horas** y el
refresh token es de **un solo uso** (rota en cada refresh). Si un refresh falla y no
se guarda el nuevo, la cuenta queda desconectada y hay que re-autorizar a mano.
El cron y el guardado del par nuevo tienen que ser transaccionales.

### Fase 1 · Stock y precios (lo que más plata cuida)

Como la logística es **mixta**, la publicación manda: `ml-sync` decide qué hacer ítem
por ítem según `logistic_type`, que se lee de la API y se guarda en `mapeo_producto_ml`.

**Regla previa a todo — sin foto no se publica.** `ml-sync` filtra por existencia de imagen
antes de tocar nada: si el modelo del SKU no tiene fila en `producto_imagenes`, el SKU no sale.
Se aplica en el código y no a mano, para que no se escape una publicación vacía cuando entre
stock nuevo. Al 2026-08-18 eso deja **619 SKUs publicables de los 886 con stock (27.512 unidades)**.

⚠️ Ojo con el cruce: `producto_imagenes` está cargada **por modelo, no por código** (99 modelos,
que cubren esos 619 SKUs). Sólo 77 SKUs tienen la foto de su color exacto. El match hay que
hacerlo por `upper(trim(modelo))`, no por `codigo` — cruzando por código dan 77 y parece que no
hay con qué llenar la tienda.

**Publicaciones con stock propio** (`cross_docking`, `drop_off`, `self_service`) — push:
- `stock.cantidad − buffer_unidades` → `PUT /items/{id}` `available_quantity`
- si queda en 0 → pausar la publicación (configurable)
- `precios_publicos.precio` × `markup_pct_propio` → `price`

**Publicaciones en Full** (`fulfillment`) — **pull, nunca push**:
- El stock está físicamente en el depósito de ML: **no es** `stock.cantidad`. Son unidades
  distintas, ya despachadas. Pushear ahí rompe el inventario de los dos lados.
- `ml-sync` sólo **lee** la cantidad de ML y la guarda en `mapeo_producto_ml.stock_full`,
  para que en la Suite se vea el stock total real (propio + Full) sin mezclarlos.
- El precio sí se pushea, con `markup_pct_full` (comisión y costo de envío difieren de ME2).

📌 **Dos cosas de plata acá:**

1. **El precio de ML no puede ser el de Shopify.** ML se lleva comisión (~13–14% según
   categoría y tipo de publicación) + envío gratis sobre el umbral. Publicar al precio web
   se come el margen entero. Por eso el markup se define una vez en `ml_config` y queda
   visible en la Suite — y va separado para Full vs. propio, porque los costos no son iguales.

2. **`buffer_unidades` evita la sobreventa entre canales.** Las publicaciones con stock
   propio comparten las mismas unidades físicas que B2B y Shopify. Sin colchón, la última
   unidad se vende dos veces y una de las dos ventas hay que cancelarla — en ML eso pega
   directo en la reputación de la cuenta.

### Fase 1.a · Matcheo inicial (una sola vez)

Como ya hay publicaciones cargadas, antes de sincronizar hay que atar `item_id ↔ stock.codigo`:

1. Barrido de `GET /users/{id}/items/search?official_store_id=X`
2. Match automático por `SELLER_SKU` / `seller_custom_field` contra `stock.codigo`
3. Lo que no matchee, match tentativo por título contra `stock.modelo`
4. El resto, a mano en una pantalla de la Suite (`match_origen` deja registro de cómo se ató)

**Hasta que el matcheo esté cerrado y revisado, `ml-sync` corre en modo lectura** (informa
qué haría, no escribe). Arrancar a pushear con un mapeo a medias es la forma más rápida de
poner el precio de un modelo en la publicación de otro.

### Fase 2 · Órdenes → flujo de pedidos

`webhook-ml` recibe `orders_v2` → arma un registro en `ventas_ml` → crea el `pedido`
con `origen = 'ML'` → entra al mismo circuito que hoy: depósito, picking, remito,
export a Tango. Sin ramas nuevas río abajo.

Ojo con las ventas Full: esas **no** pasan por depósito (las despacha ML), así que el
pedido entra ya cumplido — sirve para la contabilidad y el dashboard, no para picking.

### Fase 3 · Preguntas y post-venta automáticas

`webhook-ml` con topic `questions` → `bot-central` (el mismo cerebro) → `POST /answers`.
El segmento en ML es siempre **b2c**, así que no hace falta `wa_resolver_segmento`.

🚨 **Riesgo real, distinto a WhatsApp**: ML **prohíbe sacar al comprador de la
plataforma**. No se puede dar WhatsApp, teléfono, mail ni link externo en preguntas ni
en mensajería. ML lo modera automáticamente y penaliza la reputación. El bot hoy está
diseñado para escalar a un humano por WhatsApp — para el canal ML hay que meter un
**filtro de canal** en `bot-central` que bloquee datos de contacto y derive a un humano
*dentro* de ML.

### Fase 4 · Diseño de tienda (sin código)

Arquitectura de secciones definida el 2026-08-18 — plan visual completo en el artifact
"Tienda Oficial Orbital". **Seis secciones, con Triple protección como cabecera:**

| Sección | Qué la alimenta | SKUs con foto | Unidades |
|---|---|---|---|
| **Triple protección** (cabecera) | `tratamiento = Inflarrojo + Blue cut` | 78 | 2.673 |
| Sol | `tipo = sol` | 478 | 22.407 |
| Ofertas | `clasificacion = oportunidades` | 137 | 5.275 |
| Oftálmicos | `tipo = receta` | 118 | 4.557 |
| Sport | `clasificacion = deportivo` | 98 | 6.008 |
| Pantallas | `tipo = receta` + `tratamiento = Blue cut` | 34 | 1.630 |

Pantallas y Triple protección van **separadas**: una es armazón de receta con filtro, la otra
es la tecnología de lente completa. Las secciones se solapan a propósito (Triple protección es
subconjunto de Sol; Pantallas de Oftálmicos).

**Pendientes de dato**: Gamer, Neutros para pantallas y Pregraduados no se derivan de ningún
campo — necesitan una columna `seccion_ml` en `stock`. Nocturno tiene 11 modelos, no alcanza
para solapa propia.

🐛 **Corregir antes de publicar**: `tratamiento` guarda `Inflarrojo + Blue cut` (falta la `r`)
en 82 SKUs. Ahora que Triple protección es la cabecera, ese typo está en el campo que alimenta
la sección más visible de la tienda.

Además: plantillas de fotos según requisitos de ML (fondo blanco en la principal, mínimo
1200px, sin logos ni textos superpuestos) y títulos de 60 caracteres con formato
`Tipo + Marca + Modelo + Atributo diferencial`.

---

## 4. Lo único que bloquea el arranque

Todo lo de arriba se puede construir salvo un paso, que **sólo lo podés hacer vos** porque
requiere entrar con la cuenta de Orbital:

1. Crear la aplicación en el panel de desarrolladores de ML → salen **Client ID** y **Client Secret**.
2. Cargar como `redirect_uri`:
   `https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ml-oauth-callback`
3. Cargar como URL de notificaciones:
   `https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-ml`
   con los topics `orders_v2`, `questions`, `messages`, `items`, `shipments`.
4. Guardar Client ID y Secret como secrets de Supabase (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`).

Los pasos 2 y 3 se pueden cargar antes de que las functions existan; ML no las valida al guardar.

---

## 5. Orden de trabajo propuesto

| # | Qué | Depende de |
|---|---|---|
| 1 | Tablas nuevas en Supabase (`ml_*`) | nada — se puede hacer ya |
| 2 | `ml-oauth-start` / `-callback` + `ml-token-refresh` | credenciales (Fase 0) |
| 3 | Barrido + matcheo `item_id ↔ codigo` + pantalla en la Suite | 2 |
| 4 | `ml-sync` en modo lectura → revisión → modo escritura | 3 |
| 5 | `webhook-ml` → `ventas_ml` → `pedidos` | 2 |
| 6 | Canal `ml` en `bot-central` + filtro de datos de contacto | 5 |
| 7 | Piezas de diseño de Tienda Oficial | nada — en paralelo |
