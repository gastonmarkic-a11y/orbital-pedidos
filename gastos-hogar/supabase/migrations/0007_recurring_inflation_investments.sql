-- =============================================================================
-- 0007 · Recurrentes, inflación e inversiones (secciones 5.7 y 5.8)
-- -----------------------------------------------------------------------------
--   * recurring_expenses  → gastos que se repiten (Netflix, expensas, colegio).
--   * inflation_index      → índice GLOBAL (IPC) para valores constantes.
--   * investment_scenarios → simulaciones del excedente proyectado.
-- =============================================================================

-- Gastos recurrentes detectados ----------------------------------------------
create table if not exists public.recurring_expenses (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  merchant_id    uuid references public.merchants (id) on delete set null,
  category_id    uuid references public.categories (id) on delete set null,
  card_id        uuid references public.cards (id) on delete set null,  -- anclado a la tarjeta que lo cobra
  periodicidad   text not null
                   check (periodicidad in ('mensual', 'bimestral', 'trimestral', 'anual')),
  monto_estimado numeric(14,2),
  activo         boolean not null default true,
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_recurring_household on public.recurring_expenses (household_id);

create trigger trg_recurring_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

-- Índice de inflación (GLOBAL) ------------------------------------------------
-- valor = número índice base; el ajuste a valores constantes se calcula en la
-- capa de reporte dividiendo por el índice del mes correspondiente.
create table if not exists public.inflation_index (
  fecha date primary key,                    -- primer día del mes
  valor numeric(14,4) not null
);

-- Escenarios de inversión del excedente --------------------------------------
create table if not exists public.investment_scenarios (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  nombre         text not null,
  instrumento    text not null
                   check (instrumento in ('plazo_fijo', 'fci_money_market', 'dolar_mep', 'cedear', 'otro')),
  -- Parámetros configurables por el usuario (TNA, retorno estimado, etc.).
  tasa_anual     numeric(7,4),
  capital_inicial numeric(14,2),
  aporte_mensual numeric(14,2),
  horizonte_meses int,
  supuestos      jsonb not null default '{}'::jsonb,
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_investment_household on public.investment_scenarios (household_id);

create trigger trg_investment_updated_at
  before update on public.investment_scenarios
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.recurring_expenses   enable row level security;
alter table public.inflation_index      enable row level security;
alter table public.investment_scenarios enable row level security;

create policy recurring_select on public.recurring_expenses
  for select using (public.is_household_member(household_id));
create policy recurring_insert on public.recurring_expenses
  for insert with check (public.can_write_household(household_id));
create policy recurring_update on public.recurring_expenses
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy recurring_delete on public.recurring_expenses
  for delete using (public.is_household_owner(household_id));

-- inflation_index: reference data global de solo lectura para autenticados.
create policy inflation_select on public.inflation_index
  for select to authenticated using (true);

create policy investment_select on public.investment_scenarios
  for select using (public.is_household_member(household_id));
create policy investment_insert on public.investment_scenarios
  for insert with check (public.can_write_household(household_id));
create policy investment_update on public.investment_scenarios
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy investment_delete on public.investment_scenarios
  for delete using (public.is_household_owner(household_id));
