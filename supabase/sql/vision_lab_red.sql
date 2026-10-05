-- Orbital Vision Lab · Red (2026-10-05): el consumidor final hace su perfil visual → le recomendamos un oftalmólogo
-- (de nuestra red, por zona y cartilla) → con la receta le recomendamos la óptica cliente que tiene el modelo que eligió.
-- Así entramos al negocio oftálmico y de receta: medimos cada derivación para negociar acuerdos con oftalmólogos y
-- mostrarle a cada óptica los pacientes que le mandamos. Re-ejecutable.

-- ── 1. Ópticas cliente que tienen el modelo elegido ────────────────────────────────────────────
-- Señal por óptica: 'exhibe' (stock en consignación hoy) o 'trabaja' (lo compró en 2025–2026), sin las que lo dieron de
-- baja. Mismas reglas de visibilidad pública que opticas_cercanas. No expone unidades ni importes.
create or replace function public.opticas_con_modelo(p_modelo text, p_q text default null, p_barrio text default null,
  p_provincia text default null, p_limite int default 6)
returns table (cod text, nombre text, direccion text, localidad text, provincia text, barrio text,
  telefono text, whatsapp text, coincide text, senal text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  m text := upper(btrim(coalesce(p_modelo, '')));
  t text := lower(unaccent_simple(btrim(coalesce(p_q,''))));
  b text := lower(unaccent_simple(btrim(coalesce(p_barrio,''))));
  pv text := lower(unaccent_simple(btrim(coalesce(p_provincia,''))));
  caba_rx text := '^(caba|capital|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|c\.?a\.?b\.?a\.?)$';
  es_caba boolean;
begin
  if m = '' then return; end if;
  es_caba := t ~ caba_rx or pv ~ caba_rx;
  return query
  with tiene as (
    select s.cod_cliente c, 2 peso from consignacion_stock s
     where upper(btrim(s.modelo)) = m and coalesce(s.cantidad, 0) > 0
    union all
    select v.cod_cliente, 1 from ventas_hist_cliente_modelo v
     where upper(btrim(v.modelo)) = m and v.anio >= 2025 and v.unidades > 0
  ), senal as (
    select c, max(peso) peso from tiene
     where not exists (select 1 from optica_modelo_baja x where x.cod_cliente = tiene.c and upper(btrim(x.modelo)) = m)
     group by c
  ), base as (
    select c.cod, optica_nombre_publico(c.nombre_publico, c.nomcomerc, c.razon, c.localidad) nom,
           c.direccion dir, c.localidad loc, c.provincia prov, c.barrio bar, c.telefono tel, c.whatsapp wa, h.u2026, s.peso,
           lower(unaccent_simple(btrim(coalesce(c.localidad,'')))) l,
           lower(unaccent_simple(btrim(coalesce(c.barrio,'')))) br,
           lower(unaccent_simple(btrim(coalesce(c.provincia,'')))) p
      from senal s join clientes c on c.cod = s.c join v_cliente_cohorte h on h.cod_cliente = c.cod
     where h.v2026 and nullif(btrim(c.direccion),'') is not null
       and c.vendedor_asignado is distinct from 'Corporativo'
       and not coalesce(c.oculto_publico, false)
  ), marcado as (
    select base.*,
      (br <> '' and ((b <> '' and (br like '%' || b || '%' or b like '%' || br || '%'))
                     or (length(t) >= 3 and br like '%' || t || '%'))) m_barrio,
      case when es_caba then (p ~ caba_rx or l ~ caba_rx)
           else t <> '' and l <> '' and (l = t or (length(t) >= 3 and l like '%' || t || '%') or (length(l) >= 4 and t like '%' || l || '%')) end m_loc,
      (not es_caba and ((pv <> '' and p = pv) or (t <> '' and p = t))) m_prov
    from base
  )
  select mk.cod, mk.nom, mk.dir, mk.loc, mk.prov, mk.bar, mk.tel, mk.wa,
         case when mk.m_barrio then 'barrio' when mk.m_loc then 'localidad' when mk.m_prov then 'provincia' else 'pais' end,
         case when mk.peso = 2 then 'exhibe' else 'trabaja' end
    from marcado mk
   -- sin zona escrita: todas las que lo tienen (para "¿dónde lo encuentro?" sin ubicación)
   where (t = '' and b = '' and pv = '') or mk.m_barrio or mk.m_loc or mk.m_prov
   order by mk.m_barrio desc, mk.m_loc desc, mk.m_prov desc, mk.peso desc, mk.u2026 desc nulls last
   limit least(greatest(coalesce(p_limite, 6), 1), 12);
end $$;
revoke all on function public.opticas_con_modelo(text, text, text, text, int) from public;
grant execute on function public.opticas_con_modelo(text, text, text, text, int) to anon, authenticated;

-- ── 2. Red de oftalmólogos ───────────────────────────────────────────────────────────────────
-- nivel: prospecto (lo cargamos) → contactado → acuerdo (deriva / recibe derivaciones con Orbital) → socio.
-- cartillas: ids de src/modules/visionlab/obras.ts (osde, swiss, galeno, medife, omint, …).
create table if not exists public.oftalmologos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  nombre text not null,
  matricula text,
  centro text,                                  -- clínica / centro donde atiende
  subespecialidad text,                         -- retina, glaucoma, pediatría, córnea, cirugía refractiva…
  direccion text, barrio text, localidad text, provincia text,
  telefono text, whatsapp text, web text, turnos_url text,
  cartillas text[] not null default '{}',
  particular boolean not null default true,     -- atiende particulares
  rating numeric, resenas int,                  -- Google (si se cargó)
  fuente text,                                  -- cartilla OSDE, Google Maps, recomendación de óptica, manual…
  optica_cod text,                              -- óptica cliente que lo recomendó / con la que trabaja
  nivel text not null default 'prospecto' check (nivel in ('prospecto','contactado','acuerdo','socio','descartado')),
  publico boolean not null default true,        -- se puede recomendar en la web
  notas text
);
create index if not exists oftalmologos_loc_idx on public.oftalmologos (lower(localidad));
alter table public.oftalmologos enable row level security;
drop policy if exists oftalmologos_admin on public.oftalmologos;
create policy oftalmologos_admin on public.oftalmologos for all using (public.es_admin()) with check (public.es_admin());

-- Cada vez que la web recomienda un oftalmólogo y la persona toca turno / cómo llegar / web.
create table if not exists public.oftalmo_derivaciones (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  oftalmologo_id bigint not null references public.oftalmologos(id) on delete cascade,
  pretest_code text,
  accion text not null check (accion in ('whatsapp','telefono','mapa','web')),
  obra_social text,
  localidad text
);
create index if not exists oftalmo_deriv_idx on public.oftalmo_derivaciones (oftalmologo_id, created_at desc);
alter table public.oftalmo_derivaciones enable row level security;
drop policy if exists oftalmo_deriv_admin on public.oftalmo_derivaciones;
create policy oftalmo_deriv_admin on public.oftalmo_derivaciones for select using (public.es_admin());

-- Público: los de la red para esa zona y obra social. Primero los con acuerdo ("recomendado por Orbital"), después los
-- que atienden su cartilla, después por reseñas. Solo datos profesionales públicos.
create or replace function public.oftalmologos_cercanos(p_q text default null, p_barrio text default null,
  p_provincia text default null, p_obra text default null, p_limite int default 5)
returns table (id bigint, nombre text, centro text, subespecialidad text, direccion text, localidad text, provincia text,
  barrio text, telefono text, whatsapp text, web text, turnos_url text, rating numeric, resenas int,
  atiende_obra boolean, recomendado boolean, coincide text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t text := lower(unaccent_simple(btrim(coalesce(p_q,''))));
  b text := lower(unaccent_simple(btrim(coalesce(p_barrio,''))));
  pv text := lower(unaccent_simple(btrim(coalesce(p_provincia,''))));
  ob text := lower(btrim(coalesce(p_obra,'')));
  caba_rx text := '^(caba|capital|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|c\.?a\.?b\.?a\.?)$';
  es_caba boolean;
begin
  if t = '' and b = '' and pv = '' then return; end if;
  es_caba := t ~ caba_rx or pv ~ caba_rx;
  return query
  with base as (
    select o.*,
      lower(unaccent_simple(btrim(coalesce(o.localidad,'')))) l,
      lower(unaccent_simple(btrim(coalesce(o.barrio,'')))) br,
      lower(unaccent_simple(btrim(coalesce(o.provincia,'')))) p
    from oftalmologos o where o.publico and o.nivel <> 'descartado'
  ), marcado as (
    select base.*,
      (br <> '' and ((b <> '' and (br like '%' || b || '%' or b like '%' || br || '%')) or (length(t) >= 3 and br like '%' || t || '%'))) m_barrio,
      case when es_caba then (p ~ caba_rx or l ~ caba_rx)
           else t <> '' and l <> '' and (l = t or (length(t) >= 3 and l like '%' || t || '%') or (length(l) >= 4 and t like '%' || l || '%')) end m_loc,
      (not es_caba and ((pv <> '' and p = pv) or (t <> '' and p = t))) m_prov,
      (ob <> '' and (ob = any (base.cartillas) or (ob = 'particular' and base.particular))) m_obra
    from base
  )
  select mk.id, mk.nombre, mk.centro, mk.subespecialidad, mk.direccion, mk.localidad, mk.provincia, mk.barrio,
         mk.telefono, mk.whatsapp, mk.web, mk.turnos_url, mk.rating, mk.resenas,
         mk.m_obra, mk.nivel in ('acuerdo','socio'),
         case when mk.m_barrio then 'barrio' when mk.m_loc then 'localidad' else 'provincia' end
    from marcado mk
   where mk.m_barrio or mk.m_loc or mk.m_prov
   order by (mk.m_barrio or mk.m_loc) desc, (mk.nivel in ('acuerdo','socio')) desc, mk.m_obra desc,
            coalesce(mk.rating, 0) * ln(1 + coalesce(mk.resenas, 0)) desc
   limit least(greatest(coalesce(p_limite, 5), 1), 10);
end $$;

create or replace function public.oftalmo_derivar(p_id bigint, p_accion text, p_code text default null,
  p_obra text default null, p_localidad text default null)
returns void language sql security definer set search_path = public as $$
  insert into oftalmo_derivaciones (oftalmologo_id, accion, pretest_code, obra_social, localidad)
  select o.id, p_accion, left(nullif(p_code,''), 20), left(nullif(p_obra,''), 60), left(nullif(btrim(p_localidad),''), 80)
    from oftalmologos o
   where o.id = p_id and o.publico and p_accion in ('whatsapp','telefono','mapa','web');
$$;
revoke all on function public.oftalmologos_cercanos(text, text, text, text, int) from public;
revoke all on function public.oftalmo_derivar(bigint, text, text, text, text) from public;
grant execute on function public.oftalmologos_cercanos(text, text, text, text, int) to anon, authenticated;
grant execute on function public.oftalmo_derivar(bigint, text, text, text, text) to anon, authenticated;

-- ── 3. Embudo: consumidor → oftalmólogo → receta → óptica → venta (panel de la Suite) ─────────────────
-- El oftalmólogo elegido y el modelo buscado quedan en el lead del pretest (si hay código).
alter table public.pretests add column if not exists oftalmologo_id bigint, add column if not exists modelo_buscado text;
create or replace function public.pretest_red(p_code text, p_oftalmologo bigint default null, p_modelo text default null)
returns void language sql security definer set search_path = public as $$
  update pretests set
    oftalmologo_id = coalesce(p_oftalmologo, oftalmologo_id),
    modelo_buscado = coalesce(left(upper(nullif(btrim(p_modelo),'')), 40), modelo_buscado)
  where code = p_code and created_at > now() - interval '30 days';
$$;
revoke all on function public.pretest_red(text, bigint, text) from public;
grant execute on function public.pretest_red(text, bigint, text) to anon, authenticated;

-- Ranking para negociar acuerdos: derivaciones (90 días) y cartillas premium que atiende.
create or replace view public.v_oftalmo_ranking with (security_invoker = true) as
select o.*,
  (select count(*) from oftalmo_derivaciones d where d.oftalmologo_id = o.id and d.created_at > now() - interval '90 days') deriv_90d,
  (select count(*) from oftalmo_derivaciones d where d.oftalmologo_id = o.id) deriv_total,
  cardinality(array(select unnest(o.cartillas) intersect select unnest(array['osde','swiss','galeno','medife','omint','hospital-italiano','hospital-aleman','medicus','sancor','accord']))) cartillas_premium
from oftalmologos o;
