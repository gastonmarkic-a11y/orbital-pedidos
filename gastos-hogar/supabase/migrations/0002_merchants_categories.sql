-- =============================================================================
-- 0002 · Comercios, categorías y reglas de categorización (sección 5.3)
-- -----------------------------------------------------------------------------
--   * merchants  → catálogo canónico GLOBAL (unifica "COTO CICSA"/"Coto 034").
--   * categories → taxonomía jerárquica: base GLOBAL (household_id null) +
--                  custom por household.
--   * category_rules → motor de reglas por household; aprende de correcciones.
-- =============================================================================

-- Comercios canónicos (global) ------------------------------------------------
create table if not exists public.merchants (
  id              uuid primary key default gen_random_uuid(),
  nombre_canonico text not null,
  cuit            text,
  rubro           text,
  creado_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_merchants_cuit
  on public.merchants (cuit) where cuit is not null;
create index if not exists idx_merchants_nombre_trgm
  on public.merchants using gin (nombre_canonico gin_trgm_ops);

create trigger trg_merchants_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

-- Categorías (global + custom por household) ----------------------------------
-- household_id null  → categoría base disponible para todos.
-- household_id set   → categoría propia del household.
create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid references public.households (id) on delete cascade,
  nombre       text not null,
  parent_id    uuid references public.categories (id) on delete set null,
  creado_at    timestamptz not null default now()
);

create index if not exists idx_categories_household on public.categories (household_id);
create index if not exists idx_categories_parent on public.categories (parent_id);

-- Reglas de categorización por household (sección 5.3) ------------------------
-- match_tipo: cómo se decide la categoría (comercio, cuit, keyword).
create table if not exists public.category_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  match_tipo   text not null check (match_tipo in ('comercio', 'cuit', 'keyword')),
  match_valor  text not null,
  category_id  uuid not null references public.categories (id) on delete cascade,
  -- prioridad mayor gana ante múltiples reglas que matchean.
  prioridad    int not null default 100,
  creado_por   uuid references auth.users (id) on delete set null,
  creado_at    timestamptz not null default now(),
  unique (household_id, match_tipo, match_valor)
);

create index if not exists idx_category_rules_household on public.category_rules (household_id);

-- RLS -------------------------------------------------------------------------
alter table public.merchants      enable row level security;
alter table public.categories     enable row level security;
alter table public.category_rules enable row level security;

-- merchants: reference data global. Lectura para autenticados; la escritura la
-- hace la ingesta con service_role (bypassa RLS), no el usuario final.
create policy merchants_select on public.merchants
  for select to authenticated using (true);

-- categories: se ven las globales (household_id null) y las del propio household.
create policy categories_select on public.categories
  for select using (
    household_id is null or public.is_household_member(household_id)
  );

-- Solo se pueden crear/editar categorías propias del household (nunca globales).
create policy categories_insert on public.categories
  for insert with check (
    household_id is not null and public.can_write_household(household_id)
  );

create policy categories_update on public.categories
  for update using (
    household_id is not null and public.can_write_household(household_id)
  )
  with check (
    household_id is not null and public.can_write_household(household_id)
  );

create policy categories_delete on public.categories
  for delete using (
    household_id is not null and public.is_household_owner(household_id)
  );

-- category_rules: CRUD dentro del household (viewer solo lee).
create policy category_rules_select on public.category_rules
  for select using (public.is_household_member(household_id));

create policy category_rules_insert on public.category_rules
  for insert with check (public.can_write_household(household_id));

create policy category_rules_update on public.category_rules
  for update using (public.can_write_household(household_id))
  with check (public.can_write_household(household_id));

create policy category_rules_delete on public.category_rules
  for delete using (public.can_write_household(household_id));
