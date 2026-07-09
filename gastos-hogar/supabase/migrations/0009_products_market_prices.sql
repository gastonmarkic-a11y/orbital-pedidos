-- =============================================================================
-- 0009 · Benchmark de precios: ítems de ticket, productos y precios de mercado
-- (secciones 5.2 y 5.10)
-- -----------------------------------------------------------------------------
--   * ticket_items → detalle línea por línea de un ticket (POR household, hereda
--                    RLS vía transaction_id).
--   * products     → catálogo canónico GLOBAL de productos.
--   * market_prices→ precios de mercado GLOBALES ingestados de SEPA/Precios Claros.
-- =============================================================================

-- Catálogo canónico de productos (GLOBAL) -------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  nombre_canonico text not null,
  ean             text,
  marca           text,
  presentacion    text,                       -- "1 L", "500 g", ...
  rubro           text,
  creado_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_products_ean
  on public.products (ean) where ean is not null;
create index if not exists idx_products_nombre_trgm
  on public.products using gin (nombre_canonico gin_trgm_ops);

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Detalle de ítems de un ticket (POR household vía transaction) ---------------
create table if not exists public.ticket_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  descripcion     text not null,
  cantidad        numeric(12,3),
  precio_unitario numeric(14,2),
  ean             text,
  product_id      uuid references public.products (id) on delete set null,
  -- Confianza del match ítem→producto canónico (por EAN=alta, por fuzzy=baja).
  match_confianza numeric(4,3),
  creado_at       timestamptz not null default now()
);

create index if not exists idx_ticket_items_transaction on public.ticket_items (transaction_id);
create index if not exists idx_ticket_items_product on public.ticket_items (product_id);
create index if not exists idx_ticket_items_ean on public.ticket_items (ean);

-- Precios de mercado (GLOBAL, ingestados de SEPA/Precios Claros) --------------
create table if not exists public.market_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references public.products (id) on delete cascade,
  ean         text,
  cadena      text not null,                  -- Coto | Carrefour | Dia | ...
  sucursal    text,
  provincia   text,
  precio      numeric(14,2) not null,
  fecha       date not null,
  fuente      text not null default 'sepa',
  creado_at   timestamptz not null default now()
);

create index if not exists idx_market_prices_product on public.market_prices (product_id, fecha);
create index if not exists idx_market_prices_ean on public.market_prices (ean, fecha);
create index if not exists idx_market_prices_cadena on public.market_prices (cadena, fecha);

-- RLS -------------------------------------------------------------------------
alter table public.products      enable row level security;
alter table public.ticket_items  enable row level security;
alter table public.market_prices enable row level security;

-- products / market_prices: reference data global de solo lectura para
-- autenticados. La ingesta corre con service_role (bypassa RLS).
create policy products_select on public.products
  for select to authenticated using (true);

create policy market_prices_select on public.market_prices
  for select to authenticated using (true);

-- ticket_items hereda la pertenencia de su transacción.
create policy ticket_items_select on public.ticket_items
  for select using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and public.is_household_member(t.household_id)
  ));
create policy ticket_items_insert on public.ticket_items
  for insert with check (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and public.can_write_household(t.household_id)
  ));
create policy ticket_items_update on public.ticket_items
  for update using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and public.can_write_household(t.household_id)
  ));
create policy ticket_items_delete on public.ticket_items
  for delete using (exists (
    select 1 from public.transactions t
    where t.id = transaction_id and public.can_write_household(t.household_id)
  ));
