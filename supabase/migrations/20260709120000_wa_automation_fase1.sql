-- ============================================================================
-- Orbital Eyewear · Automatización WhatsApp — Fase 1 (Esqueleto sin LLM)
-- ----------------------------------------------------------------------------
-- Crea el esquema base del sistema de respuestas automáticas:
--   · conversaciones          estado por teléfono (segmento, escalamiento, ventana 24h)
--   · mensajes                cola idempotente + log de entrantes/salientes
--   · base_conocimiento       respuestas curadas por intención, con filtro de segmento en SQL
--   · clientes_telefono_index índice de normalización teléfono→cod (NO toca `clientes`)
--
-- RLS: activada en las cuatro tablas SIN políticas para anon/authenticated.
--      Sólo `service_role` (usada por las Edge Functions) puede leer/escribir,
--      porque service_role hace bypass de RLS. No hay acceso anónimo.
--
-- Timezone de referencia del negocio: America/Argentina/Buenos_Aires
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Normalización de teléfonos argentinos
-- ----------------------------------------------------------------------------
-- Devuelve el "número significativo nacional" (NSN) de 10 dígitos = área+abonado,
-- o NULL si el input no representa un móvil argentino plausible.
--
-- Reglas (idénticas a las del cliente TypeScript en la Edge Function):
--   1. Deja sólo dígitos.
--   2. Quita código país 54 y el 9 de móvil de Meta (549… ó 54… de 12+ díg.).
--   3. Quita el 0 interurbano inicial.
--   4. Si quedan 12 díg., quita un '15' embebido tras el código de área (móvil local).
--   5. Valida NSN de 10 díg. que no empiece en 0.
--
-- El número entrante de Meta es limpio y confiable → cae siempre en el NSN correcto.
-- Los fijos (8 díg.) devuelven NULL: un consumidor final que escribe desde un móvil
-- desconocido queda como b2c, que es el default seguro.
create or replace function wa_nsn(raw text)
returns text
language plpgsql
immutable
as $$
declare
  d   text;
  off int;
begin
  if raw is null then
    return null;
  end if;

  d := regexp_replace(raw, '\D', '', 'g');
  if d = '' then
    return null;
  end if;

  -- código país + 9 de móvil
  if left(d, 3) = '549' then
    d := substr(d, 4);
  elsif left(d, 2) = '54' and length(d) >= 12 then
    d := substr(d, 3);
  end if;

  -- prefijo interurbano
  if left(d, 1) = '0' then
    d := substr(d, 2);
  end if;

  -- '15' móvil embebido: sólo cuando quedan 12 díg. (NSN de 10 + los 2 del 15)
  if length(d) = 12 then
    off := position('15' in substr(d, 3));  -- buscar desde la pos. 3 (dejar el área)
    if off > 0 then
      off := off + 2;                        -- offset real dentro de d (1-based)
      d := substr(d, 1, off - 1) || substr(d, off + 2);
    end if;
  end if;

  if length(d) = 10 and left(d, 1) <> '0' then
    return d;
  end if;

  return null;
end;
$$;

comment on function wa_nsn(text) is
  'Normaliza un teléfono argentino al NSN de 10 dígitos (área+abonado) o NULL. Espejo de telefono.ts en la Edge Function.';

-- ----------------------------------------------------------------------------
-- Índice teléfono → cod  (frontera de seguridad de la segmentación)
-- ----------------------------------------------------------------------------
create table if not exists clientes_telefono_index (
  telefono_norm text not null,
  cod           text not null,
  fuente        text not null check (fuente in ('whatsapp', 'telefono')),
  primary key (telefono_norm, cod, fuente)
);

create index if not exists idx_cti_telefono_norm
  on clientes_telefono_index (telefono_norm);

comment on table clientes_telefono_index is
  'Mapa normalizado teléfono→cod para clasificar el segmento del entrante. Regenerable con wa_rebuild_telefono_index(). No modifica la tabla clientes.';

-- Reconstruye el índice desde `clientes`. Idempotente (trunca + repuebla).
--   incluir_telefono = false (default): SÓLO indexa la columna `whatsapp`.
--     Alta precisión: elevamos a B2B únicamente si el entrante matchea un
--     WhatsApp que tenemos en ficha. Evita falsos positivos que filtrarían
--     precios mayoristas a un consumidor (requisito duro de negocio).
--   incluir_telefono = true: agrega también `telefono` (mayor cobertura,
--     mayor riesgo de match espurio). Usar sólo con datos depurados.
create or replace function wa_rebuild_telefono_index(incluir_telefono boolean default false)
returns int
language plpgsql
as $$
declare
  n int;
begin
  truncate clientes_telefono_index;

  insert into clientes_telefono_index (telefono_norm, cod, fuente)
  select distinct nrm, cod, fuente
  from (
    -- whatsapp: parte campos con múltiples números y normaliza cada token
    select cod, 'whatsapp'::text as fuente,
           wa_nsn(tok) as nrm
    from clientes,
         lateral regexp_split_to_table(coalesce(whatsapp, ''), '[/,;]| y | Y ') as tok
    union all
    select cod, 'telefono'::text as fuente,
           wa_nsn(tok) as nrm
    from clientes,
         lateral regexp_split_to_table(coalesce(telefono, ''), '[/,;]| y | Y ') as tok
    where incluir_telefono
  ) s
  where nrm is not null
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function wa_rebuild_telefono_index(boolean) is
  'Repuebla clientes_telefono_index. incluir_telefono=false (default) indexa sólo whatsapp (alta precisión).';

-- ----------------------------------------------------------------------------
-- Conversaciones
-- ----------------------------------------------------------------------------
create table if not exists conversaciones (
  id                       bigint generated always as identity primary key,
  telefono                 text not null unique,               -- E.164 sin + (como lo entrega Meta)
  telefono_norm            text,                               -- NSN de 10 díg. (referencia)
  cod_cliente              text,                               -- cod matcheado en clientes (soft ref)
  segmento                 text not null default 'b2c'
                             check (segmento in ('b2b_activo', 'b2b_inactivo', 'b2c')),
  requiere_humano          boolean not null default false,
  escalado_motivo          text,
  escalado_en              timestamptz,
  turnos_baja_conf         int not null default 0,
  estado                   text not null default 'activa'
                             check (estado in ('activa', 'escalada', 'cerrada')),
  ultima_actividad         timestamptz not null default now(), -- último mensaje del USUARIO (ventana 24h)
  ultimo_saliente          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_conv_requiere_humano
  on conversaciones (requiere_humano) where requiere_humano;
create index if not exists idx_conv_segmento on conversaciones (segmento);

comment on table conversaciones is
  'Estado por teléfono: segmento, escalamiento (una sola vía) y ventana de 24h de Meta.';

-- ----------------------------------------------------------------------------
-- Mensajes (cola idempotente + log)
-- ----------------------------------------------------------------------------
create table if not exists mensajes (
  id                bigint generated always as identity primary key,
  wa_message_id     text unique,                       -- id de Meta → idempotencia
  conversacion_id   bigint references conversaciones(id) on delete cascade,
  telefono          text not null,
  direccion         text not null check (direccion in ('entrante', 'saliente')),
  tipo              text,                              -- text | interactive | button_reply | list_reply | template | ...
  contenido         text,                             -- texto (dato personal: no loggear en nivel info)
  payload           jsonb,                             -- payload crudo del mensaje de Meta
  intencion         text,
  escalon_resuelto  text check (escalon_resuelto in ('menu', 'regla', 'vector', 'rag', 'humano')),
  confianza         numeric,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente', 'procesado', 'error')),
  error_detalle     text,
  intentos          int not null default 0,
  created_at        timestamptz not null default now(),
  procesado_en      timestamptz
);

create index if not exists idx_msg_estado on mensajes (estado) where estado <> 'procesado';
create index if not exists idx_msg_telefono_fecha on mensajes (telefono, created_at desc);

comment on table mensajes is
  'Cola idempotente (wa_message_id único) y log de entrantes/salientes. Métrica escalon_resuelto por mensaje.';

-- ----------------------------------------------------------------------------
-- Base de conocimiento (respuestas curadas; embeddings llegan en Fase 2)
-- ----------------------------------------------------------------------------
create table if not exists base_conocimiento (
  id                    bigint generated always as identity primary key,
  intencion             text not null,
  pregunta              text not null,               -- pregunta canónica / disparador
  variantes             text[] not null default '{}',
  respuesta             text not null,
  segmentos_permitidos  text[] not null
                          check (
                            segmentos_permitidos <@ array['b2b_activo','b2b_inactivo','b2c']::text[]
                            and cardinality(segmentos_permitidos) > 0
                          ),
  siempre_escala        boolean not null default false,
  activa                boolean not null default true,
  prioridad             int not null default 100,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_bc_intencion on base_conocimiento (intencion) where activa;

comment on table base_conocimiento is
  'Respuestas curadas por intención. segmentos_permitidos filtra en el WHERE SQL: contenido restringido nunca entra al contexto (candado de segmentación).';
comment on column base_conocimiento.segmentos_permitidos is
  'Segmentos que pueden ver esta respuesta. El filtro vive en SQL, no en el prompt del LLM.';

-- ----------------------------------------------------------------------------
-- trigger updated_at
-- ----------------------------------------------------------------------------
create or replace function wa_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_conv_updated_at on conversaciones;
create trigger trg_conv_updated_at before update on conversaciones
  for each row execute function wa_touch_updated_at();

drop trigger if exists trg_bc_updated_at on base_conocimiento;
create trigger trg_bc_updated_at before update on base_conocimiento
  for each row execute function wa_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Resolución de segmento por teléfono
-- ----------------------------------------------------------------------------
-- Recibe el teléfono entrante (E.164 sin +) y devuelve segmento + cod.
-- El corte b2b_activo / b2b_inactivo usa clientes.ultima_compra_fecha (18 meses).
-- Si hay varios cod para el mismo NSN, gana el de compra más reciente.
create or replace function wa_resolver_segmento(telefono_entrante text)
returns table (segmento text, cod_cliente text, telefono_norm text)
language plpgsql
stable
as $$
declare
  nrm  text;
  rec  record;
begin
  nrm := wa_nsn(telefono_entrante);

  if nrm is null then
    return query select 'b2c'::text, null::text, null::text;
    return;
  end if;

  select c.cod, c.ultima_compra_fecha
    into rec
  from clientes_telefono_index i
  join clientes c on c.cod = i.cod
  where i.telefono_norm = nrm
  order by c.ultima_compra_fecha desc nulls last
  limit 1;

  if not found then
    return query select 'b2c'::text, null::text, nrm;
    return;
  end if;

  if rec.ultima_compra_fecha is not null
     and rec.ultima_compra_fecha >= (current_date - interval '18 months') then
    return query select 'b2b_activo'::text, rec.cod, nrm;
  else
    return query select 'b2b_inactivo'::text, rec.cod, nrm;
  end if;
end;
$$;

comment on function wa_resolver_segmento(text) is
  'Clasifica el teléfono entrante en b2b_activo / b2b_inactivo / b2c. Corte de actividad: clientes.ultima_compra_fecha ≤ 18 meses.';

-- Pinnear search_path (hardening: evita inyección de search_path; limpia el linter).
alter function wa_nsn(text)                          set search_path = public, pg_catalog;
alter function wa_rebuild_telefono_index(boolean)    set search_path = public, pg_catalog;
alter function wa_resolver_segmento(text)            set search_path = public, pg_catalog;
alter function wa_touch_updated_at()                 set search_path = public, pg_catalog;

-- ----------------------------------------------------------------------------
-- RLS: activar sin políticas → sólo service_role (bypass) accede
-- ----------------------------------------------------------------------------
alter table conversaciones          enable row level security;
alter table mensajes                enable row level security;
alter table base_conocimiento       enable row level security;
alter table clientes_telefono_index enable row level security;

-- (Sin CREATE POLICY: anon y authenticated quedan sin acceso.)
