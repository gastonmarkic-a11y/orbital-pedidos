# SCHEMA.md — Modelo de datos

Modelo de datos del **Sistema Centralizado de Gastos del Hogar** sobre Supabase
(Postgres + Auth + RLS). Corresponde a la **Fase 1 · fundación multi-tenant**
del prompt de producto.

> **Principio rector:** todo dato pertenece a un `household`. Ninguna query sin
> filtro de `household_id`. **RLS obligatorio en todas las tablas.**

Las migraciones viven en [`supabase/migrations/`](./supabase/migrations) y están
numeradas para correr en orden. La taxonomía base de categorías se carga con
[`supabase/seed.sql`](./supabase/seed.sql).

---

## 1. Alcance de las tablas: por household vs. global

| Ámbito | Tablas | Regla RLS de lectura |
|---|---|---|
| **Por household** | `households`, `household_members`, `sources`, `category_rules`, `cards`, `card_benefits`, `accounts`, `transactions`, `installment_plans`, `installments`, `recurring_expenses`, `investment_scenarios`, `promo_usage`, `ticket_items`, `audit_log` | miembro del household (o dueño de la transacción para `ticket_items`) |
| **Global (reference data)** | `merchants`, `products`, `market_prices`, `promotions`, `inflation_index` | cualquier usuario autenticado (solo `SELECT`) |
| **Mixto** | `categories` (base global cuando `household_id is null` + custom por household) | global o miembro del household |

Las tablas globales **solo exponen `SELECT`** a los usuarios. Sus escrituras las
realiza la ingesta/pipeline con `service_role`, que **bypassa RLS** por diseño.

---

## 2. Modelo de autorización (RLS)

Tres helpers `SECURITY DEFINER` (migración `0001`) centralizan la lógica y evitan
recursión de políticas sobre `household_members`:

| Función | Devuelve `true` si… |
|---|---|
| `is_household_member(hid)` | el usuario actual pertenece al household |
| `has_household_role(hid, roles[])` | el usuario tiene alguno de esos roles |
| `can_write_household(hid)` | el usuario es `owner` o `member` |
| `is_household_owner(hid)` | el usuario es `owner` |

**Roles** (`household_members.rol`): `owner`, `member`, `viewer`.

| Acción | `viewer` | `member` | `owner` |
|---|:--:|:--:|:--:|
| Leer datos del household | ✅ | ✅ | ✅ |
| Crear/editar gastos, tarjetas, categorías… | ❌ | ✅ | ✅ |
| Editar/borrar registros de **otros** miembros | ❌ | ❌ | ✅ |
| Administrar miembros del household | ❌ | ❌ | ✅ |
| Leer `audit_log` | ❌ | ❌ | ✅ |

- En `transactions` y `sources`, un `member` solo edita/borra **lo propio**
  (`cargado_por` / `subido_por = auth.uid()`); el `owner` edita todo.
- Al crear un `household`, un trigger `SECURITY DEFINER` convierte al creador en
  `owner` automáticamente (`0001 · handle_new_household`).

---

## 3. Tablas por módulo

### 3.1 Núcleo multi-tenant (`0001`)
- **`households`** `(id, nombre, creado_por, creado_at, updated_at)` — unidad de tenencia.
- **`household_members`** `(household_id, user_id, rol, creado_at)` — PK compuesta; un usuario puede estar en varios households.

### 3.2 Comercios y categorización (`0002`)
- **`merchants`** `(id, nombre_canonico, cuit, rubro)` — canónico global; unifica variantes ("COTO CICSA" → "Coto"). Índice trigram para fuzzy match.
- **`categories`** `(id, household_id?, nombre, parent_id)` — jerárquica; base global + custom por household.
- **`category_rules`** `(id, household_id, match_tipo, match_valor, category_id, prioridad, creado_por)` — motor de reglas que **aprende de las correcciones** del usuario. `match_tipo ∈ {comercio, cuit, keyword}`.

### 3.3 Ingesta (`0003`)
- **`sources`** `(id, household_id, tipo, storage_path, estado, error_detalle, intentos, subido_por)` — un registro por archivo subido. `estado ∈ {pendiente, procesando, procesado, error}`. El original nunca se descarta (Storage privado).

### 3.4 Tarjetas y cuentas (`0004`)
- **`cards`** `(id, household_id, banco, red, ultimos4, titular_user_id, fecha_cierre, fecha_venc, origen)` — **auto-detectadas** desde resúmenes (`origen = auto_resumen`). Índice único `(household_id, banco, red, ultimos4)` para no duplicar al reprocesar. Son el **ancla** de cuotas, recurrentes y beneficios.
- **`card_benefits`** `(id, household_id, card_id, merchant_id|rubro, dias, porcentaje, tope, medio, compra_min, vigencia_*)` — descuentos **propios** de una tarjeta del household.
- **`accounts`** `(id, household_id, tipo, nombre, moneda)` — banco o billetera.

### 3.5 Transacciones y deduplicación (`0005`)
- **`transactions`** — registro central. Guarda `cargado_por` (quién lo cargó) e `imputado_a` (a quién se le imputa). `estado ∈ {confirmada, requiere_revision, sospecha_duplicado, duplicada_fusionada}`. Las transacciones del mismo consumo comparten `dedup_group_id`; **los reportes suman una vez por grupo**.

### 3.6 Cuotas (`0006`)
- **`installment_plans`** `(id, household_id, transaction_origen_id, card_id, monto_total, cantidad, primera_fecha)` — el total se registra **una vez**.
- **`installments`** `(id, plan_id, nro, fecha, monto, pagada)` — calendario futuro generado automáticamente. Hereda RLS vía `plan_id`.

### 3.7 Recurrentes, inflación e inversiones (`0007`)
- **`recurring_expenses`** — anclados a la `card_id` que los cobra.
- **`inflation_index`** `(fecha, valor)` — índice global (IPC) para valores constantes.
- **`investment_scenarios`** — simulaciones del excedente (`plazo_fijo`, `fci_money_market`, `dolar_mep`, `cedear`), con `supuestos jsonb`.

### 3.8 Motor de ofertas (`0008`)
- **`promotions`** — descuentos **generales** de tienda/banco (reference global). El motor las cruza con `card_benefits` propios.
- **`promo_usage`** `(household_id, promotion_id, mes, monto_reintegrado)` — tope consumido por mes (por household).

### 3.9 Benchmark de precios (`0009`)
- **`products`** — catálogo canónico global (índice único por `ean`, trigram por nombre).
- **`ticket_items`** `(transaction_id, descripcion, cantidad, precio_unitario, ean, product_id, match_confianza)` — detalle línea por línea; por household vía `transaction_id`.
- **`market_prices`** — precios de mercado globales ingestados de **SEPA / Precios Claros**.

### 3.10 Auditoría (`0010`)
- **`audit_log`** `(household_id, user_id, accion, entidad, entidad_id, detalle, at)` — append-only desde el cliente; solo `owner` lee.

### 3.11 GRANTs (`0011`)
- Otorga privilegios de tabla a los roles `anon`/`authenticated`/`service_role`. **RLS sigue siendo la frontera de seguridad** — el GRANT no alcanza para escribir si no hay política. Redundante en Supabase hosted (default privileges), incluido para que el esquema sea auto-contenido en Postgres local/self-hosted.

---

## 4. Diagrama de relaciones (resumen)

```
auth.users ──< household_members >── households
                                        │
      ┌───────────────┬─────────────────┼──────────────┬───────────────┐
   sources          cards            accounts      categories*     category_rules
      │               │                                  │
      │           card_benefits                          │
      └──────────< transactions >───────────────────────┘
                     │   │   │
        installment_plans │ ticket_items ──> products* ──< market_prices*
             │            │                     
        installments   dedup_group (self)       

promotions* ──< promo_usage        recurring_expenses      investment_scenarios
inflation_index*                   audit_log

(*) tablas globales / mixtas — reference data, SELECT para autenticados.
```

---

## 5. Convenciones

- **PK:** `uuid` con `gen_random_uuid()` (extensión `pgcrypto`).
- **Dinero:** `numeric(14,2)`; **moneda:** `ARS`/`USD` explícita por fila.
- **Timestamps:** `timestamptz`; `updated_at` mantenido por trigger `set_updated_at()`.
- **Fuzzy match:** `pg_trgm` (índices GIN en `merchants.nombre_canonico` y `products.nombre_canonico`).
- **Borrados:** `on delete cascade` hacia el household; `set null` en referencias opcionales para no perder historial.

---

## 6. Cómo aplicar

```bash
# Con Supabase CLI y un proyecto linkeado:
supabase db push          # aplica supabase/migrations/*.sql en orden
psql "$DATABASE_URL" -f supabase/seed.sql   # taxonomía base de categorías
```

> Estas migraciones son **archivos**; todavía no se aplicaron a ningún proyecto
> Supabase (decisión de la Fase 1: entregar la fundación versionada y revisable
> antes de tocar infra viva).
