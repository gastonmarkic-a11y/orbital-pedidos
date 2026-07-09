-- =============================================================================
-- 0003 · Ingesta: sources (sección 5.1)
-- -----------------------------------------------------------------------------
-- Cada archivo subido (ticket, resumen, extracto, comprobante) crea un `source`
-- con estado pendiente → procesando → procesado → error. El original nunca se
-- descarta: queda en Storage (bucket privado) para auditoría/reproceso.
-- =============================================================================

create table if not exists public.sources (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  tipo         text not null
                 check (tipo in ('ticket', 'resumen_tarjeta', 'extracto', 'comprobante', 'manual')),
  storage_path text,                       -- ruta en el bucket privado (null si carga manual)
  estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'procesando', 'procesado', 'error')),
  error_detalle text,                      -- detalle cuando estado = 'error' (nunca se pierde el original)
  intentos     int not null default 0,     -- reintentos de extracción
  subido_por   uuid not null references auth.users (id) on delete set null,
  creado_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_sources_household on public.sources (household_id);
create index if not exists idx_sources_estado on public.sources (household_id, estado);

create trigger trg_sources_updated_at
  before update on public.sources
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.sources enable row level security;

create policy sources_select on public.sources
  for select using (public.is_household_member(household_id));

create policy sources_insert on public.sources
  for insert with check (
    public.can_write_household(household_id) and subido_por = auth.uid()
  );

-- El pipeline de extracción corre con service_role (bypassa RLS) para mover
-- estados. Desde el cliente: owner cualquiera, member solo lo que subió.
create policy sources_update on public.sources
  for update using (
    public.is_household_owner(household_id)
    or (public.can_write_household(household_id) and subido_por = auth.uid())
  );

create policy sources_delete on public.sources
  for delete using (public.is_household_owner(household_id));
