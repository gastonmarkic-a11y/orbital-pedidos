-- =============================================================================
-- 0005 · Transacciones + deduplicación/conciliación (secciones 5.2 y 5.5)
-- -----------------------------------------------------------------------------
-- El registro central. Una transacción puede entrar dos veces (ticket físico y
-- línea del resumen): el motor de dedup las agrupa por `dedup_group_id` para
-- NUNCA contar dos veces en los totales.
-- =============================================================================

create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  source_id         uuid references public.sources (id) on delete set null,
  fecha             date not null,
  merchant_id       uuid references public.merchants (id) on delete set null,
  descripcion       text,
  monto             numeric(14,2) not null,
  moneda            text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  medio_pago        text check (medio_pago in
                      ('credito', 'debito', 'efectivo', 'transferencia', 'qr')),
  card_id           uuid references public.cards (id) on delete set null,
  account_id        uuid references public.accounts (id) on delete set null,
  category_id       uuid references public.categories (id) on delete set null,
  imputado_a        uuid references auth.users (id) on delete set null,  -- a quién se le imputa
  cargado_por       uuid references auth.users (id) on delete set null,  -- quién lo cargó
  -- Cuotas: cuando el documento indica C.03/06 se guarda el crudo y se genera
  -- el installment_plan en la migración 0006.
  cuota_actual      int,
  cuota_total       int,
  iva               numeric(14,2),
  cuit_comercio     text,
  estado            text not null default 'confirmada'
                      check (estado in
                        ('confirmada', 'requiere_revision',
                         'sospecha_duplicado', 'duplicada_fusionada')),
  -- Todas las transacciones del mismo consumo comparten dedup_group_id; los
  -- reportes suman una vez por grupo. Null = grupo propio (todavía no fusionada).
  dedup_group_id    uuid,
  confianza         numeric(4,3),            -- 0.000 .. 1.000 devuelta por el extractor
  creado_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_transactions_household on public.transactions (household_id);
create index if not exists idx_transactions_fecha on public.transactions (household_id, fecha);
create index if not exists idx_transactions_merchant on public.transactions (merchant_id);
create index if not exists idx_transactions_category on public.transactions (category_id);
create index if not exists idx_transactions_card on public.transactions (card_id);
create index if not exists idx_transactions_dedup on public.transactions (dedup_group_id);
create index if not exists idx_transactions_estado on public.transactions (household_id, estado);

create trigger trg_transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.transactions enable row level security;

create policy transactions_select on public.transactions
  for select using (public.is_household_member(household_id));

create policy transactions_insert on public.transactions
  for insert with check (public.can_write_household(household_id));

-- owner edita todo; member solo lo que cargó ("edita lo propio").
create policy transactions_update on public.transactions
  for update using (
    public.is_household_owner(household_id)
    or (public.can_write_household(household_id) and cargado_por = auth.uid())
  );

create policy transactions_delete on public.transactions
  for delete using (
    public.is_household_owner(household_id)
    or (public.can_write_household(household_id) and cargado_por = auth.uid())
  );
