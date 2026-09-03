# Tests de Orbital Suite

Dos suites que cubren lo construido el 3/9/2026: el motor de prospección y el bot IRIS.

## 1. Motor — invariantes en SQL

Corré esto en el SQL editor de Supabase. No necesita nada instalado.

```sql
select * from test_orbital();
-- solo lo que no pasa:
select * from test_orbital() where resultado <> 'PASS';
```

27 casos sobre 7 bloques:

| Bloque | Qué garantiza |
|---|---|
| `embudo` | Todo cliente cae en una sola posta. P2 y P3 exigen señal real del cliente (no basta con que le hayamos mandado algo). |
| `contenido` | Cada paso de `secuencia_posta` apunta a una pieza que existe y está activa, sin repetirse dentro de la misma posta. |
| `tanda` | Nadie recibe el mismo contacto que otro. No se contacta a la posta Fuera. No se asigna WhatsApp a quien no tiene teléfono, ni mail a quien no tiene casilla. |
| `anti-repeticion` | Nunca se reasigna una pieza ya enviada a ese contacto. |
| `equipo` | Los 6 con teléfono cargado y sin número repetido entre quienes prospectan. |
| `cron` | La tanda diaria está programada y activa. |
| `catalogo` | Un desconocido no autohabilita catálogo. Una óptica con token recibe el suyo. Ningún token vivo de un vendedor dado de baja. |
| `trazabilidad` | Toda derivación apunta a un vendedor que existe. |

Dos casos devuelven `AVISO` en vez de `FAIL`: son cosas que necesitan que alguien actúe, no bugs.

## 2. Supervisor — que nada quede colgado

```sql
select * from test_supervisor();
```

| Caso | Qué garantiza |
|---|---|
| Ninguna acción vencida sin liberar | Lo que nadie trabajó en 48 h vuelve al pozo |
| Ningún toque vencido sin reagendar | Nada se queda esperando un día que ya pasó |
| Ningún prospecto sin dueño | Siempre hay alguien responsable |
| La etapa nunca va por detrás de los hechos | Si abrió el catálogo, no puede seguir en Presentación |
| Correrlo dos veces no cambia nada | Es idempotente: no pisa ni duplica |
| Todo movimiento queda auditado | Cada cambio va a `supervisor_log` con de → a |

El supervisor corre L-V a las **6:45**, quince minutos antes de armar las tandas.
Regla clave: **solo avanza etapas, nunca retrocede** — lo que movió una persona se respeta.

## 3. Bot IRIS — conversaciones

Reproduce las transcripciones que fallaron en producción y verifica que ya no fallen.

```bash
SUPABASE_SERVICE_ROLE_KEY=... node tests/test-bot.mjs
node tests/test-bot.mjs --solo saul          # un escenario
```

Cada turno declara qué **debe** y qué **no debe** aparecer en la respuesta. Los `no_debe` son
las fallas reales del relevamiento: si alguna vuelve, el test se pone rojo.

| Escenario | Falla que cubre |
|---|---|
| `saul` | Pedir acceso al catálogo caía en el cotizador (el mensaje lo genera la propia app). |
| `pedido4447` | La pregunta de segmento pisaba la consulta real; el nº de pedido se extraía pero no se buscaba; se cotizaba a quien pedía la devolución. |
| `b2b_link` | Se le mandaba la tienda de consumidor final a una óptica. |
| `catalogo_gate` | Autohabilitar catálogo solo para leads de campaña Meta. |
| `reclamo` | Producto dañado siempre va a una persona. |
| `acentos` | `/\bóptica/` nunca matchea en JS porque "ó" no es `\w`: todo mensaje con la palabra acentuada fallaba la clasificación. |
| `antiloop` | La cotización se regeneraba sin fin cuando la respuesta no se entendía. |

El script crea sus propias conversaciones con teléfonos `5490000000xxx` y las borra al terminar.

## Cuándo correrlos

Después de cada deploy de `bot-central`, y antes de subir cambios al motor de tandas o al
embudo. La suite SQL también sirve como chequeo de salud diario.
