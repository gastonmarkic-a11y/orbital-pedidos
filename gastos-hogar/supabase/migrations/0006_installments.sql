-- =============================================================================
-- 0006 · Cuotas (sección 5.4) — resuelve el hueco #1 del mercado
-- -----------------------------------------------------------------------------
-- Se registra el total UNA vez y se genera el calendario de cuotas futuras.
-- El plan queda anclado a la tarjeta con la que se compró.
-- =============================================================================

create table if not exists public.installment_plans (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  transaction_origen_id uuid references public.transactions (id) on delete set null,
  card_id              uuid references public.cards (id) on delete set null,
  monto_total          numeric(14,2) not null,
  cantidad             int not null check (cantidad > 0),
  primera_fecha        date not null,
  creado_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_installment_plans_household on public.installment_plans (household_id);
create index if not exists idx_installment_plans_card on public.installment_plans (card_id);

create trigger trg_installment_plans_updated_at
  before update on public.installment_plans
  for each row execute function public.set_updated_at();

-- Cuotas individuales (proyección generada automáticamente) -------------------
create table if not exists public.installments (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.installment_plans (id) on delete cascade,
  nro       int not null,                    -- 1..cantidad
  fecha     date not null,
  monto     numeric(14,2) not null,
  pagada    boolean not null default false,
  unique (plan_id, nro)
);

create index if not exists idx_installments_plan on public.installments (plan_id);
create index if not exists idx_installments_fecha on public.installments (fecha);

-- RLS -------------------------------------------------------------------------
alter table public.installment_plans enable row level security;
alter table public.installments      enable row level security;

create policy installment_plans_select on public.installment_plans
  for select using (public.is_household_member(household_id));
create policy installment_plans_insert on public.installment_plans
  for insert with check (public.can_write_household(household_id));
create policy installment_plans_update on public.installment_plans
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));
create policy installment_plans_delete on public.installment_plans
  for delete using (public.is_household_owner(household_id));

-- installments hereda la pertenencia vía su plan.
create policy installments_select on public.installments
  for select using (exists (
    select 1 from public.installment_plans p
    where p.id = plan_id and public.is_household_member(p.household_id)
  ));
create policy installments_insert on public.installments
  for insert with check (exists (
    select 1 from public.installment_plans p
    where p.id = plan_id and public.can_write_household(p.household_id)
  ));
create policy installments_update on public.installments
  for update using (exists (
    select 1 from public.installment_plans p
    where p.id = plan_id and public.can_write_household(p.household_id)
  ));
create policy installments_delete on public.installments
  for delete using (exists (
    select 1 from public.installment_plans p
    where p.id = plan_id and public.is_household_owner(p.household_id)
  ));
