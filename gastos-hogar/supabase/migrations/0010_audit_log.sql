-- =============================================================================
-- 0010 · Auditoría (sección 8 · seguridad)
-- -----------------------------------------------------------------------------
-- Registro de acciones sensibles por household. Solo owner puede leerlo; los
-- inserts los hace la app/pipeline (service_role bypassa RLS). Datos financieros
-- = PII, así que este log es append-only desde el cliente (sin update/delete).
-- =============================================================================

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  accion       text not null,                 -- create | update | delete | export | login ...
  entidad      text not null,                 -- tabla/recurso afectado
  entidad_id   uuid,
  detalle      jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);

create index if not exists idx_audit_household on public.audit_log (household_id, at desc);

-- RLS -------------------------------------------------------------------------
alter table public.audit_log enable row level security;

-- Solo el owner puede leer la auditoría de su household.
create policy audit_select on public.audit_log
  for select using (public.is_household_owner(household_id));

-- Append-only desde el cliente: cualquier miembro que escribe puede registrar
-- su propia acción; no se permite update/delete (integridad del log).
create policy audit_insert on public.audit_log
  for insert with check (
    public.is_household_member(household_id)
    and (user_id is null or user_id = auth.uid())
  );
