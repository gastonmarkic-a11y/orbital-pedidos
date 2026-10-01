-- Orbital Vision Lab: pretest visual público (/lab/pretest) + panel de leads (/vision-lab).
-- La página pública no toca tablas: solo llama a las RPC security definer de abajo.

create table if not exists public.pretests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_at timestamptz not null default now(),
  origen text not null default 'web',          -- web | tienda | qr | suite
  optica_origen text,                           -- cod de la óptica si llegó por su QR (?o=)
  nombre text,
  edad int,
  usa text,                                     -- no | si | viejos
  ppi int,
  acuity_r numeric, acuity_l numeric,
  contrast int,
  astig_r boolean, astig_l boolean,
  color_hits int,
  amsler_r boolean, amsler_l boolean,
  near text,
  score int,
  indice int,
  semaforo text,                                -- verde | amarillo | rojo
  ticket text,
  localidad text,                               -- zona escrita o detectada ("Palermo, CABA"); sin coordenadas
  optica_cod text,                              -- óptica que eligió (click en WhatsApp / Cómo llegar)
  optica_click_at timestamptz,
  estado text not null default 'nuevo',         -- nuevo | contactado | turno | vendido | descartado
  nota text
);
-- 2026-09-30: lejos a 3 m (con ayudante) o 50 cm, y agudeza de cerca a 40 cm ojo por ojo.
alter table public.pretests add column if not exists dist_cm int, add column if not exists near_r numeric, add column if not exists near_l numeric;
create index if not exists pretests_created_idx on public.pretests (created_at desc);

alter table public.pretests enable row level security;
drop policy if exists pretests_admin_select on public.pretests;
create policy pretests_admin_select on public.pretests for select using (public.es_admin());
drop policy if exists pretests_admin_update on public.pretests;
create policy pretests_admin_update on public.pretests for update using (public.es_admin()) with check (public.es_admin());

-- Guarda el resultado y devuelve el código único ORB-XXXX-MMDD.
create or replace function public.pretest_guardar(p jsonb)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code text;
  v_mmdd text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'MMDD');
  v_origen text := coalesce(nullif(p->>'origen',''), 'web');
begin
  if v_origen not in ('web','tienda','qr','suite') then v_origen := 'web'; end if;
  loop
    v_code := 'ORB-' || upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=', ''), 1, 4)) || '-' || v_mmdd;
    exit when v_code ~ '^ORB-[A-Z0-9]{4}-\d{4}$' and not exists (select 1 from pretests where code = v_code);
  end loop;
  insert into pretests (code, origen, optica_origen, nombre, edad, usa, ppi, acuity_r, acuity_l, contrast,
    astig_r, astig_l, color_hits, amsler_r, amsler_l, near, score, indice, semaforo, ticket, dist_cm, near_r, near_l)
  values (
    v_code, v_origen, left(nullif(p->>'optica_origen',''), 40),
    left(nullif(btrim(p->>'nombre'),''), 60),
    case when (p->>'edad') ~ '^\d{1,2}$' then (p->>'edad')::int end,
    case when p->>'usa' in ('no','si','viejos') then p->>'usa' end,
    least(greatest((p->>'ppi')::numeric, 0), 2000)::int,
    (p->>'acuity_r')::numeric, (p->>'acuity_l')::numeric,
    (p->>'contrast')::int,
    (p->>'astig_r')::boolean, (p->>'astig_l')::boolean,
    least(greatest((p->>'color_hits')::int, 0), 3),
    (p->>'amsler_r')::boolean, (p->>'amsler_l')::boolean,
    case when p->>'near' in ('J1','J3','J5','J7','J10','J14') then p->>'near' end,
    (p->>'score')::int, (p->>'indice')::int,
    case when p->>'semaforo' in ('verde','amarillo','rojo') then p->>'semaforo' end,
    left(replace(p->>'ticket', 'ORB-····-····', v_code), 2000),
    case when (p->>'dist_cm') ~ '^\d{2,3}$' then (p->>'dist_cm')::int end,
    least(greatest((p->>'near_r')::numeric, 0), 2), least(greatest((p->>'near_l')::numeric, 0), 2)
  );
  return v_code;
end $$;

-- Zona escrita o detectada ("Palermo, CABA") y óptica elegida.
create or replace function public.pretest_actualizar(p_code text, p_localidad text default null, p_optica_cod text default null)
returns void language sql security definer set search_path = public as $$
  update pretests set
    localidad = coalesce(left(nullif(btrim(p_localidad),''), 80), localidad),
    optica_cod = coalesce(left(p_optica_cod, 40), optica_cod),
    optica_click_at = case when p_optica_cod is not null then now() else optica_click_at end
  where code = p_code and created_at > now() - interval '2 days';
$$;

-- Ópticas Orbital de la zona, por texto (sin coordenadas): barrio → ciudad → provincia.
-- Mismas reglas de visibilidad pública que bot_optica_cercana. `coincide` dice por qué entró cada una,
-- para que la página avise si solo hay de la provincia.
create or replace function public.opticas_cercanas(p_q text default null, p_barrio text default null,
  p_provincia text default null, p_limite int default 5)
returns table (cod text, nombre text, direccion text, localidad text, provincia text, barrio text,
  telefono text, whatsapp text, coincide text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  t text := lower(unaccent_simple(btrim(coalesce(p_q,''))));
  b text := lower(unaccent_simple(btrim(coalesce(p_barrio,''))));
  pv text := lower(unaccent_simple(btrim(coalesce(p_provincia,''))));
  caba_rx text := '^(caba|capital|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|c\.?a\.?b\.?a\.?)$';
  es_caba boolean;
begin
  if t = '' and b = '' and pv = '' then return; end if;
  es_caba := t ~ caba_rx or pv ~ caba_rx;
  return query
  with base as (
    select c.cod, optica_nombre_publico(c.nombre_publico, c.nomcomerc, c.razon, c.localidad) nom,
           c.direccion dir, c.localidad loc, c.provincia prov, c.barrio bar, c.telefono tel, c.whatsapp wa, h.u2026,
           lower(unaccent_simple(btrim(coalesce(c.localidad,'')))) l,
           lower(unaccent_simple(btrim(coalesce(c.barrio,'')))) br,
           lower(unaccent_simple(btrim(coalesce(c.provincia,'')))) p
      from clientes c join v_cliente_cohorte h on h.cod_cliente = c.cod
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
  select m.cod, m.nom, m.dir, m.loc, m.prov, m.bar, m.tel, m.wa,
         case when m.m_barrio then 'barrio' when m.m_loc then 'localidad' else 'provincia' end
    from marcado m
   where m.m_barrio or m.m_loc or m.m_prov
   order by m.m_barrio desc, m.m_loc desc, m.u2026 desc nulls last
   limit least(greatest(coalesce(p_limite, 5), 1), 10);
end $$;

revoke all on function public.pretest_guardar(jsonb) from public;
revoke all on function public.pretest_actualizar(text, text, text) from public;
revoke all on function public.opticas_cercanas(text, text, text, int) from public;
grant execute on function public.pretest_guardar(jsonb) to anon, authenticated;
grant execute on function public.pretest_actualizar(text, text, text) to anon, authenticated;
grant execute on function public.opticas_cercanas(text, text, text, int) to anon, authenticated;

-- Panel en tiempo real
do $$ begin
  alter publication supabase_realtime add table public.pretests;
exception when duplicate_object then null; end $$;

-- Recomendador de armazones del informe (2026-09-30): armazones de RECETA con medidas cargadas y stock libre,
-- con una foto y el precio desde. Público (lo llama la página del pretest); solo datos de catálogo.
-- producto_medidas está en cm: alto = altura de lente (B), ancho = frente total.
create or replace function public.pretest_marcos()
returns jsonb language sql stable security definer set search_path = public as $$
  with lib as (select * from stock_libre(null, null, null)),
  mods as (
    select m.modelo, m.alto, m.ancho, m.formato, m.frente, m.para,
      sum(greatest(l.libre, 0)) libre,
      (select pi.url from producto_imagenes pi join stock s2 on s2.codigo = pi.codigo
        where s2.modelo = m.modelo and s2.tipo = 'receta' and pi.url not ilike '%packaging%' and not coalesce(pi.es_lifestyle, false)
        order by pi.orden nulls last, (pi.url ilike '%.png%'), pi.id limit 1) foto,  -- los .png suelen ser fotos de ambiente
      (select min(pp.precio) from precios_publicos pp join stock s3 on s3.codigo = pp.codigo
        where s3.modelo = m.modelo and s3.tipo = 'receta' and pp.precio > 0) precio_desde
    from producto_medidas m
    join stock s on s.modelo = m.modelo and s.tipo = 'receta'
    left join lib l on l.codigo = s.codigo
    where m.alto is not null
    group by m.modelo, m.alto, m.ancho, m.formato, m.frente, m.para
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'modelo', modelo, 'alto_mm', round(alto * 10), 'ancho_mm', round(ancho * 10), 'formato', formato,
    'frente', frente, 'para', para, 'foto', foto, 'precio_desde', precio_desde) order by libre desc), '[]'::jsonb)
  from mods where libre > 0 and foto is not null;
$$;
grant execute on function public.pretest_marcos() to anon, authenticated;
