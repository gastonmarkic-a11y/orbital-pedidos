-- =============================================================================
-- 0004 · Tarjetas, beneficios de tarjeta y cuentas (secciones 5.3 y 5.9)
-- -----------------------------------------------------------------------------
--   * cards        → AUTO-detectadas al procesar resúmenes (banco+red+últimos4).
--                    Son el "ancla" de cuotas, recurrentes y beneficios.
--   * card_benefits→ descuentos PROPIOS de una tarjeta puntual del household.
--   * accounts     → cuentas de banco/billetera (Mercado Pago, Ualá, ...).
-- =============================================================================

-- Tarjetas (auto-detectadas desde resúmenes) ---------------------------------
create table if not exists public.cards (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  banco             text,
  red               text,                    -- Visa | Master | Amex | Naranja | ...
  ultimos4          text,
  -- Titular de la tarjeta dentro del household. Se apunta al user_id (no a la PK
  -- compuesta de household_members) para tener una FK simple con integridad.
  titular_user_id   uuid references auth.users (id) on delete set null,
  fecha_cierre      date,                    -- ciclo de la tarjeta ≠ mes calendario
  fecha_venc        date,
  origen            text not null default 'auto_resumen'
                      check (origen in ('auto_resumen', 'manual')),
  creado_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Evita duplicar la misma tarjeta al reprocesar resúmenes (clave de anclaje).
create unique index if not exists uq_cards_identity
  on public.cards (household_id, coalesce(banco, ''), coalesce(red, ''), coalesce(ultimos4, ''));
create index if not exists idx_cards_household on public.cards (household_id);

create trigger trg_cards_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- Beneficios propios de una tarjeta -------------------------------------------
create table if not exists public.card_benefits (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  card_id        uuid not null references public.cards (id) on delete cascade,
  merchant_id    uuid references public.merchants (id) on delete set null,
  rubro          text,                        -- alternativa al comercio puntual
  dias           int[],                       -- 0=domingo .. 6=sábado
  porcentaje     numeric(5,2),                -- % de reintegro
  tope           numeric(14,2),               -- tope mensual de reintegro
  medio          text,                        -- MODO | QR | fisico | apple_pay | ...
  compra_min     numeric(14,2),
  vigencia_desde date,
  vigencia_hasta date,
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (merchant_id is not null or rubro is not null)
);

create index if not exists idx_card_benefits_household on public.card_benefits (household_id);
create index if not exists idx_card_benefits_card on public.card_benefits (card_id);

create trigger trg_card_benefits_updated_at
  before update on public.card_benefits
  for each row execute function public.set_updated_at();

-- Cuentas de banco / billetera ------------------------------------------------
create table if not exists public.accounts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  tipo         text not null check (tipo in ('banco', 'billetera')),
  nombre       text not null,
  moneda       text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  creado_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_accounts_household on public.accounts (household_id);

create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.cards         enable row level security;
alter table public.card_benefits enable row level security;
alter table public.accounts      enable row level security;

create policy cards_select on public.cards
  for select using (public.is_household_member(household_id));
create policy cards_insert on public.cards
  for insert with check (public.can_write_household(household_id));
create policy cards_update on public.cards
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy cards_delete on public.cards
  for delete using (public.is_household_owner(household_id));

create policy card_benefits_select on public.card_benefits
  for select using (public.is_household_member(household_id));
create policy card_benefits_insert on public.card_benefits
  for insert with check (public.can_write_household(household_id));
create policy card_benefits_update on public.card_benefits
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy card_benefits_delete on public.card_benefits
  for delete using (public.can_write_household(household_id));

create policy accounts_select on public.accounts
  for select using (public.is_household_member(household_id));
create policy accounts_insert on public.accounts
  for insert with check (public.can_write_household(household_id));
create policy accounts_update on public.accounts
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy accounts_delete on public.accounts
  for delete using (public.is_household_owner(household_id));
