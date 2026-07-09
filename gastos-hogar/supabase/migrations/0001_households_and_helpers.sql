-- =============================================================================
-- 0001 · Núcleo multi-tenant: households, membresías, helpers y RLS base
-- -----------------------------------------------------------------------------
-- Principio rector (sección 2 del prompt): TODO dato pertenece a un household.
-- Ninguna query sin filtro de household_id. RLS obligatorio en todas las tablas.
--
-- Este archivo crea:
--   * extensiones necesarias
--   * households + household_members
--   * funciones helper de autorización (SECURITY DEFINER para evitar recursión RLS)
--   * trigger que convierte al creador del household en owner
--   * políticas RLS de households y household_members
-- =============================================================================

-- Extensiones -----------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy match de comercios/productos

-- Trigger genérico de updated_at ---------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tablas núcleo ---------------------------------------------------------------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado_por  uuid not null references auth.users (id) on delete restrict,
  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_households_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  rol          text not null default 'member'
                 check (rol in ('owner', 'member', 'viewer')),
  creado_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists idx_household_members_user on public.household_members (user_id);

-- Funciones helper de autorización -------------------------------------------
-- SECURITY DEFINER: se ejecutan como el dueño de la función y NO disparan las
-- políticas RLS de household_members, evitando recursión infinita cuando esas
-- mismas políticas invocan estas funciones.
create or replace function public.is_household_member(_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = _household_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_household_role(_household_id uuid, _roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = _household_id
      and user_id = auth.uid()
      and rol = any (_roles)
  );
$$;

-- Atajos legibles reutilizados por las políticas de escritura de otras tablas.
create or replace function public.can_write_household(_household_id uuid)
returns boolean
language sql
stable
as $$
  select public.has_household_role(_household_id, array['owner', 'member']);
$$;

create or replace function public.is_household_owner(_household_id uuid)
returns boolean
language sql
stable
as $$
  select public.has_household_role(_household_id, array['owner']);
$$;

-- Al crear un household, el creador queda como owner automáticamente.
create or replace function public.handle_new_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.household_members (household_id, user_id, rol)
  values (new.id, new.creado_por, 'owner')
  on conflict (household_id, user_id) do nothing;
  return new;
end;
$$;

create trigger trg_household_owner_bootstrap
  after insert on public.households
  for each row execute function public.handle_new_household();

-- RLS -------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;

-- households: los miembros ven su household; cualquiera autenticado puede crear
-- uno (queda como owner por el trigger); solo owner edita/borra.
create policy households_select on public.households
  for select using (public.is_household_member(id));

create policy households_insert on public.households
  for insert with check (creado_por = auth.uid());

create policy households_update on public.households
  for update using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

create policy households_delete on public.households
  for delete using (public.is_household_owner(id));

-- household_members: los miembros ven a sus co-miembros; solo owner administra.
-- (El primer owner lo inserta el trigger SECURITY DEFINER, no esta política.)
create policy household_members_select on public.household_members
  for select using (public.is_household_member(household_id));

create policy household_members_insert on public.household_members
  for insert with check (public.is_household_owner(household_id));

create policy household_members_update on public.household_members
  for update using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

create policy household_members_delete on public.household_members
  for delete using (public.is_household_owner(household_id));
