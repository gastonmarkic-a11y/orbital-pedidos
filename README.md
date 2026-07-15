# Orbital Suite

App unificada de gestión comercial de Orbital Eyewear: **Pedidos + Actividad Comercial** en una sola app React con módulos por rol.

## Stack

- React 18 + Vite + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth por magic link)
- Hosting: Vercel

## Roles y módulos

| Rol | Módulos |
|---|---|
| vendedor | Agenda del Día, Cartera, Cargar Actividad, Mis Resultados, Marketing, Nuevo Pedido, Mis Pedidos |
| admin | Todo lo anterior + Dashboard, Cobranzas, Stock, Clientes, Admin Actividad |
| deposito | Pedidos a preparar, Stock |
| logistica | Entregas pendientes |
| administracion | Facturación, Cobranzas, Dashboard, Clientes |

El rol se define en la tabla `vendedores` de Supabase (columna `rol`). El login es por mail (magic link) — el mail del usuario debe estar cargado en `vendedores.email`.

## Flujo de estados de pedido

`pendiente` → `en_preparacion` → (`observado` ↔ ajuste del vendedor) → `listo` (remito) → `facturado` (factura) → `listo_despachar` → `despachado` (transporte + guía)

## Sincronización automática

Al cargar un pedido, un trigger en Supabase (`trg_sync_pedido_actividad`) crea el registro correspondiente en `actividad_diaria`.

## Desarrollo

```bash
npm install
npm run dev      # desarrollo local
npm run build    # build de producción (tsc + vite)
```

La versión HTML original de Orbital Pedidos quedó preservada en `legacy/`.
