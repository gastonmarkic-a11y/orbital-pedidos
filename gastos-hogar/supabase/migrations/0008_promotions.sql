-- =============================================================================
-- 0008 · Motor de ofertas: promociones y uso de topes (sección 5.9)
-- -----------------------------------------------------------------------------
--   * promotions → descuentos GENERALES de tienda/banco (no atados a una tarjeta
--                  puntual del household). Reference data global versionada.
--   * promo_usage→ tope consumido por el household en el mes (por household, RLS).
--
-- El motor cruza estas promociones GLOBALES con los card_benefits PROPIOS
-- (migración 0004) para responder "¿con qué pago?".
-- =============================================================================

create table if not exists public.promotions (
  id             uuid primary key default gen_random_uuid(),
  banco          text,
  tarjeta_red    text,                        -- Visa | Master | Amex | ...
  merchant_id    uuid references public.merchants (id) on delete set null,
  rubro          text,                        -- alternativa al comercio puntual
  dias           int[],                       -- 0=domingo .. 6=sábado
  porcentaje     numeric(5,2),
  tope           numeric(14,2),               -- tope mensual de reintegro
  medio          text,                        -- MODO | QR | apple_pay | google_pay | fisico
  compra_min     numeric(14,2),
  acumulable     boolean not null default false,
  vigencia_desde date,
  vigencia_hasta date,
  fuente         text,                        -- origen del dato (carga_manual | scraping | comunidad)
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (merchant_id is not null or rubro is not null)
);

create index if not exists idx_promotions_merchant on public.promotions (merchant_id);
create index if not exists idx_promotions_vigencia on public.promotions (vigencia_desde, vigencia_hasta);

create trigger trg_promotions_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

-- Tope consumido por household/promo/mes --------------------------------------
create table if not exists public.promo_usage (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  promotion_id      uuid not null references public.promotions (id) on delete cascade,
  mes               date not null,            -- primer día del mes
  monto_reintegrado numeric(14,2) not null default 0,
  updated_at        timestamptz not null default now(),
  unique (household_id, promotion_id, mes)
);

create index if not exists idx_promo_usage_household on public.promo_usage (household_id);

create trigger trg_promo_usage_updated_at
  before update on public.promo_usage
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promo_usage enable row level security;

-- promotions: reference data global de solo lectura para autenticados.
create policy promotions_select on public.promotions
  for select to authenticated using (true);

create policy promo_usage_select on public.promo_usage
  for select using (public.is_household_member(household_id));
create policy promo_usage_insert on public.promo_usage
  for insert with check (public.can_write_household(household_id));
create policy promo_usage_update on public.promo_usage
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy promo_usage_delete on public.promo_usage
  for delete using (public.is_household_owner(household_id));
