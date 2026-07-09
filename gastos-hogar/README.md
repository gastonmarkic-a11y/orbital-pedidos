# Gastos del Hogar — Sistema Centralizado

Copiloto de ahorro para una familia argentina: fricción cero de carga (subís
foto/PDF y se extrae solo), cuotas bien resueltas, conciliación ticket↔resumen,
motor de ofertas y benchmark de precios de mercado. Stack: **Supabase**
(Postgres + Auth + Storage + Edge Functions + RLS) · **React** · **Netlify**.

> Nombre de trabajo pendiente de definir (candidatos: *Gasto Cero*, *La Alacena*,
> *Chanchología*, *Rendija*).

## Estado actual — Fase 1 (fundación de datos)

Este directorio contiene, por ahora, **la fundación del modelo de datos**:

```
gastos-hogar/
├── README.md
├── SCHEMA.md                 # documentación del modelo de datos y RLS
└── supabase/
    ├── migrations/           # 0001..0011 — tablas + índices + RLS + grants por módulo
    └── seed.sql              # taxonomía base global de categorías
```

Lo entregado cubre las tablas núcleo del prompt (sección 6) con **RLS
multi-tenant en todas**, helpers de autorización por rol (`owner`/`member`/
`viewer`) y la separación entre datos **por household** y **reference data
global** (comercios, productos, precios de mercado, promociones, inflación).
Ver [`SCHEMA.md`](./SCHEMA.md) para el detalle.

## Decisiones tomadas en esta fase

Estas se tomaron con criterio conservador porque el prompt llegó **truncado en la
sección 8** (faltan *Roadmap* y *Decisiones abiertas*), y la sesión no permitió
confirmarlas de forma interactiva:

1. **Ubicación:** el código vive en el subdirectorio `gastos-hogar/`. La app
   preexistente *Orbital Pedidos* (raíz del repo) **no se tocó**.
2. **Primer entregable:** fundación de datos (migraciones SQL + RLS + `SCHEMA.md`),
   que el prompt pide como entrega mínima de cada módulo.
3. **Supabase:** las migraciones son **archivos versionados**; todavía **no** se
   aplicaron a ningún proyecto Supabase vivo.

Si alguna de estas no es la esperada (p. ej. la app debía reemplazar a Orbital, o
querés arrancar por otra fase), avisá y lo ajusto.

## Próximos pasos sugeridos (Fase 1–2)

- Bucket privado de Storage + política de acceso para `sources`.
- Edge Function de extracción (visión → JSON estricto de la sección 5.2) con
  cola/reintentos y estados de `source`.
- Trigger de auto-registro de `cards` al procesar resúmenes.
- Generación automática de `installments` a partir de `cuota_actual/cuota_total`.
- Motor de deduplicación ticket↔resumen (score ponderado).
- Frontend React mobile-first: subida múltiple (cámara), dashboard básico.

## Aplicar las migraciones

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```
