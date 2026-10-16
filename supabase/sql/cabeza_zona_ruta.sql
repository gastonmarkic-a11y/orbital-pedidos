-- Cabeza de zona, ruta del día y acciones del mes siguiente (16/10/2026).
--
-- 1) cabeza_zona: una óptica por barrio (CABA) / localidad (conurbano) de cada vendedor para arrancar el día.
--    Prioridad: el ancla (cliente activo que más compra) → si no hay, el primero a recuperar → si no, el
--    prospecto estratégico más alto. Sale de v_clasif_comercial / v_prospectos_comercial.
-- 2) cabeza_dia: cada día hábil a cada vendedor se le asigna UNA cabeza de zona. Rota los barrios: los que
--    tienen más en juego (venta + unidades perdidas + prospectos) vuelven más seguido; si el día tiene agenda
--    de campo, se prefiere un barrio de esa agenda.
-- 3) opticas_del_dia(): al hacer check-in en la cabeza, las 4 ópticas que siguen (a recuperar, prospectos
--    estratégicos y activos sin visita), cerca, de su cartera y sin visita en 3 semanas. ficha_optica() arma
--    toda la información de cada una para tenerla a mano.
-- 4) acciones_seguimiento: cada visita genera la acción del mes siguiente según la temperatura:
--    caliente/tibia → empujón comercial; fría → branding una vez por mes (se encadena al marcarla hecha).

-- Tabla de acciones primero: ficha_optica la lee.
create table if not exists acciones_seguimiento (
  id bigserial primary key,
  cod_cliente text not null,
  vendedor text,
  actividad_id bigint,
  temperatura text not null check (temperatura in ('caliente','tibia','fria')),
  tipo text not null check (tipo in ('empujon_comercial','branding')),
  fecha_programada date not null,
  titulo text not null,
  detalle text,
  pieza_id bigint,
  estado text not null default 'pendiente' check (estado in ('pendiente','hecha','cancelada')),
  creado_en timestamptz not null default now(),
  hecha_en timestamptz,
  hecha_por text
);

-- ---------- 1) cabeza de zona ----------
create table if not exists cabeza_zona (
  vendedor text not null,
  micro_zona text not null,
  area text,
  cod_cliente text not null,
  motivo text not null,             -- ancla | recuperar | prospecto
  prioridad_zona numeric not null default 0,
  lat double precision,
  lon double precision,
  actualizado_en timestamptz not null default now(),
  primary key (vendedor, micro_zona)
);

create or replace function recalcular_cabezas_zona() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from cabeza_zona;
  insert into cabeza_zona (vendedor, micro_zona, area, cod_cliente, motivo, prioridad_zona, lat, lon)
  with cli as (
    select v.cod, v.vendedor, v.micro_zona, v.area, v.estado, v.u12, v.u_mejor_anio, v.prioridad_recupero, c.lat, c.lon
    from v_clasif_comercial v join clientes c using (cod)
    where v.area in ('CABA','Conurbano') and v.vendedor in ('Adrian','Bruno','Lola') and c.lat is not null
      and v.micro_zona not in ('CABA (sin barrio)','(sin localidad)','Buenos Aires')
      and v.estado in ('Activo','En caída','Perdido reciente','Perdido')),
  pro as (
    select p.cod, p.vendedor, p.micro_zona, p.area, p.puntaje_prospecto, p.lat, p.lon
    from v_prospectos_comercial p
    where p.area in ('CABA','Conurbano') and p.vendedor in ('Adrian','Bruno','Lola') and p.lat is not null
      and p.micro_zona not in ('CABA (sin barrio)','(sin localidad)','Buenos Aires')
      and (p.puntaje_prospecto >= 45 or p.marcado)
      and p.tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')),
  zonas as (
    select vendedor, micro_zona,
      coalesce(sum(greatest(u12,0)) filter (where estado = 'Activo'), 0)
      + coalesce(sum(greatest(u_mejor_anio - greatest(u12,0), 0)) filter (where estado <> 'Activo'), 0) u_juego
    from cli group by 1, 2),
  npro as (select vendedor, micro_zona, count(*) n from pro group by 1, 2),
  cand as (
    -- ancla solo si compra en serio (12+ u/año); si no, primero va el a recuperar o el prospecto fuerte
    select vendedor, micro_zona, area, cod, 'ancla' motivo, case when u12 >= 12 then 1 else 4 end tier, u12::numeric s, lat, lon from cli where estado = 'Activo'
    union all
    select vendedor, micro_zona, area, cod, 'recuperar', 2, prioridad_recupero::numeric, lat, lon from cli where estado <> 'Activo'
    union all
    select vendedor, micro_zona, area, cod, 'prospecto', 3, puntaje_prospecto::numeric, lat, lon from pro),
  elegido as (select distinct on (vendedor, micro_zona) * from cand order by vendedor, micro_zona, tier, s desc nulls last)
  select e.vendedor, e.micro_zona, e.area, e.cod, e.motivo,
         coalesce(z.u_juego, 0) + 20 * coalesce(np.n, 0), e.lat, e.lon
  from elegido e
  left join zonas z using (vendedor, micro_zona)
  left join npro np using (vendedor, micro_zona);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 2) cabeza del día ----------
create table if not exists cabeza_dia (
  fecha date not null,
  vendedor text not null,
  cod_cliente text not null,
  micro_zona text,
  motivo text,
  enviado_at timestamptz,
  checkin_at timestamptz,
  ruta_enviada_at timestamptz,
  primary key (fecha, vendedor)
);

create or replace function hoy_ar() returns date language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

create or replace function asignar_cabezas_dia(p_fecha date default null) returns setof cabeza_dia
language plpgsql security definer set search_path = public as $$
declare
  f date := coalesce(p_fecha, hoy_ar());
  v text;
  dn int;
begin
  if extract(isodow from f) > 5 then return; end if;
  begin dn := ojo_dia_num(f); exception when others then dn := null; end;
  for v in select distinct vendedor from cabeza_zona loop
    if exists (select 1 from cabeza_dia where fecha = f and vendedor = v) then continue; end if;
    insert into cabeza_dia (fecha, vendedor, cod_cliente, micro_zona, motivo)
    select f, z.vendedor, z.cod_cliente, z.micro_zona, z.motivo
    from cabeza_zona z
    left join lateral (select max(d.fecha) ult from cabeza_dia d where d.vendedor = z.vendedor and d.micro_zona = z.micro_zona and d.fecha < f) u on true
    left join lateral (
      select bool_or(lower(unaccent_simple(coalesce(a.localidad,''))) = lower(unaccent_simple(z.micro_zona))
                     or lower(unaccent_simple(coalesce(a.subzona,''))) like '%' || lower(unaccent_simple(z.micro_zona)) || '%') hay
      from agenda_campo a where a.vendedor = z.vendedor and a.dia_num = dn) ag on true
    where z.vendedor = v
      -- no repetir la óptica si se visitó en la última semana
      and not exists (select 1 from actividad_diaria ad where ad.cod_cliente = z.cod_cliente and ad.fecha >= f - 7
                      and ad.resultado_contacto in ('visito','vendio'))
    order by (z.prioridad_zona + 10) * least(30, coalesce(f - u.ult, 30)) * (case when ag.hay then 3 else 1 end) desc, z.prioridad_zona desc
    limit 1;
  end loop;
  return query select * from cabeza_dia where fecha = f;
end $$;

-- ---------- 3) las 4 ópticas que siguen + ficha ----------
create or replace function dist_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
       + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))) $$;

create or replace function opticas_del_dia(p_vendedor text, p_lat double precision, p_lon double precision,
                                           p_excluir text[] default '{}', p_n int default 4)
returns table (cod text, nombre text, motivo text, puntaje numeric, distancia_m int, lat double precision, lon double precision,
               direccion text, micro_zona text)
language plpgsql stable security definer set search_path = public as $$
declare radio int := 8000;  -- la distancia resta 8 puntos por km: las cercanas ganan solas
begin
    return query
    with base as (
      select v.cod, v.nombre, v.estado, v.prioridad_recupero, v.u12, v.micro_zona, c.lat, c.lon, c.direccion,
             dist_m(p_lat, p_lon, c.lat, c.lon) d
      from v_clasif_comercial v join clientes c using (cod)
      where v.vendedor = p_vendedor and c.lat is not null and v.cod <> all (p_excluir)
        and abs(c.lat - p_lat) < radio / 90000.0 and abs(c.lon - p_lon) < radio / 75000.0),
    pros as (select p.cod, p.puntaje_prospecto, p.tipo_oportunidad from v_prospectos_comercial p
             where p.vendedor = p_vendedor and (p.puntaje_prospecto >= 25 or p.marcado)
               and p.tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')),
    vis as (select distinct ad.cod_cliente from actividad_diaria ad
            where ad.fecha >= hoy_ar() - 21 and ad.resultado_contacto in ('visito','vendio','no_estaba')),
    cand as (
      select b.*,
        case
          when b.estado in ('En caída','Perdido reciente','Perdido') then coalesce(b.prioridad_recupero, 30)
          when b.estado = 'Activo' then 35
          when pr.cod is not null then pr.puntaje_prospecto * 0.8
          else null end base_pts,
        case
          when b.estado = 'En caída' then 'en caída: recuperar volumen'
          when b.estado in ('Perdido reciente','Perdido') then 'recuperar'
          when b.estado = 'Activo' then 'cliente activo sin visita'
          when pr.cod is not null then 'prospecto: ' || lower(pr.tipo_oportunidad)
          end mot
      from base b left join pros pr on pr.cod = b.cod
      where b.d <= radio and b.cod not in (select cod_cliente from vis where cod_cliente is not null))
    select c.cod, c.nombre, c.mot, round((c.base_pts - c.d / 1000 * 8)::numeric, 1), round(c.d)::int, c.lat::double precision, c.lon::double precision, c.direccion, c.micro_zona
    from cand c where c.base_pts is not null
    order by c.base_pts - c.d / 1000 * 8 desc
    limit p_n;
end $$;

-- Ficha de la óptica para llevar a la visita.
create or replace function ficha_optica(p_cod text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cod', c.cod,
    'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon),
    'direccion', c.direccion, 'localidad', c.localidad, 'barrio', c.barrio,
    'contacto', c.contacto, 'tel', coalesce(c.whatsapp, c.telefono),
    'horario', c.horario_entrega,
    'estado', v.estado, 'nivel_partner', v.nivel_partner,
    'u12', v.u12, 'u_prev12', v.u_prev12, 'u_mejor_anio', v.u_mejor_anio, 'ult_mes', v.ult_mes,
    'tiene_orbital', c.tiene_orbital,
    'vidriera', c.vidriera_analisis -> 'observaciones',
    'modelos', (select json_agg(m) from (select modelo, sum(unidades) u from ventas_hist_cliente_modelo
                where cod_cliente = c.cod and modelo !~* '(caja|packaging|franela|repuesto|ajuste|estuche|display|exhibidor|bolsa|tanka|cord[oó]n|pa[nñ]o|l[ií]quido|kit|cartel)' and anio >= extract(year from now())::int - 2 group by 1 order by 2 desc limit 4) m),
    'ultima_actividad', (select json_build_object('fecha', a.fecha, 'resultado', a.resultado_contacto,
                           'nota', left(coalesce(a.actividad_futura, a.voz_cliente_nota, a.actividad_desarrollo), 160))
                         from actividad_diaria a where a.cod_cliente = c.cod order by a.fecha desc, a.id desc limit 1),
    'catalogo_30d', (select json_build_object('visitas', count(*), 'ultima', max(cv.created_at)::date)
                     from catalogo_visitas cv where cv.cod_cliente = c.cod and cv.created_at >= now() - interval '30 days'),
    'catalogo_min_30d', (select round(coalesce(sum(cs.segundos), 0) / 60.0) from catalogo_sesion cs
                         where cs.cod_cliente = c.cod and cs.iniciada_at >= now() - interval '30 days'),
    'accion_pendiente', (select json_build_object('fecha', s.fecha_programada, 'titulo', s.titulo, 'temperatura', s.temperatura)
                         from acciones_seguimiento s where s.cod_cliente = c.cod and s.estado = 'pendiente' limit 1),
    'que_ofrecer', case
       when v.estado = 'Activo' then 'Reposición + lanzamientos del mes. Revisar exhibición (POP) y Plan Canje.'
       when v.estado = 'En caída' then 'Plan Canje y condición del mes para volver a su volumen. Preguntar qué cambió.'
       when v.estado in ('Perdido reciente','Perdido') then 'Reenganche: novedades y condición de vuelta. Preguntar por qué dejó.'
       else 'Paquete de Bienvenida: presentación de marca, catálogo con clave y condición de primera compra.' end
  )
  from clientes c left join v_clasif_comercial v using (cod)
  where c.cod = p_cod $$;

-- ---------- 4) acciones del mes siguiente ----------
create unique index if not exists acciones_seguimiento_una_pendiente on acciones_seguimiento (cod_cliente) where estado = 'pendiente';
create index if not exists acciones_seguimiento_vend_fecha on acciones_seguimiento (vendedor, fecha_programada) where estado = 'pendiente';

-- N-ésimo día hábil (lun-vie) del mes siguiente a p_desde.
create or replace function dia_habil_mes_siguiente(p_desde date, p_n int) returns date language plpgsql immutable as $$
declare d date := (date_trunc('month', p_desde) + interval '1 month')::date; k int := 0;
begin
  loop
    if extract(isodow from d) <= 5 then k := k + 1; if k >= p_n then return d; end if; end if;
    d := d + 1;
  end loop;
end $$;

-- Temperatura de la relación: lo que pasó en la visita + lo que hizo el cliente con el catálogo.
create or replace function temperatura_cliente(p_cod text, p_resultado text, p_texto text) returns text
language sql stable security definer set search_path = public as $$
  with cat as (
    select (select count(*) from catalogo_visitas where cod_cliente = p_cod and created_at >= now() - interval '14 days') vis,
           (select coalesce(sum(segundos), 0) from catalogo_sesion where cod_cliente = p_cod and iniciada_at >= now() - interval '14 days') seg)
  select case
    when p_resultado in ('vendio','ya','cmp') or cat.seg >= 300
      or coalesce(p_texto, '') ~* '(va a comprar|quiere comprar|hace(r)? (un )?pedido|confirm|cerr[oó]|encarg)' then 'caliente'
    when p_resultado in ('cat','pie') or cat.vis > 0
      or coalesce(p_texto, '') ~* '(inter[eé]s|precio|cat[aá]logo|volver|muestra|le gust|evaluar|pensar|lo piensa|despu[eé]s|pr[oó]ximo mes|llamar)' then 'tibia'
    else 'fria' end
  from cat $$;

-- Pieza de marketing para la acción: comercial (propuesta según historia) o branding (rota y no repite).
create or replace function pieza_para_accion(p_cod text, p_tipo text) returns bigint
language sql stable security definer set search_path = public as $$
  select p.id from piezas_marketing p
  where p.activa and (
    (p_tipo = 'empujon_comercial' and p.categoria in ('propuesta','catalogo','video')
       and p.tema in ('canje','bienvenida','preventa','lanzamientos','catalogos'))
    or (p_tipo = 'branding' and ((p.categoria in ('imagen','video') and p.tema <> 'herramientas') or (p.categoria = 'catalogo' and p.tema in ('catalogos','cristales')))))
  order by (select count(*) from acciones_seguimiento s where s.cod_cliente = p_cod and s.pieza_id = p.id),
           case when p_tipo = 'empujon_comercial' and p.tema = (case when exists (select 1 from ventas_hist_cliente h where h.cod_cliente = p_cod) then 'canje' else 'bienvenida' end) then 0 else 1 end,
           p.orden nulls last, p.id
  limit 1 $$;

create or replace function programar_accion(p_cod text, p_vendedor text, p_actividad bigint, p_temp text, p_desde date)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  tipo text := case when p_temp = 'fria' then 'branding' else 'empujon_comercial' end;
  fecha date := dia_habil_mes_siguiente(p_desde, case p_temp when 'caliente' then 3 when 'tibia' then 8 else 12 end);
  pieza bigint := pieza_para_accion(p_cod, tipo);
  nuevo bigint;
begin
  update acciones_seguimiento set estado = 'cancelada' where cod_cliente = p_cod and estado = 'pendiente';
  insert into acciones_seguimiento (cod_cliente, vendedor, actividad_id, temperatura, tipo, fecha_programada, titulo, detalle, pieza_id)
  values (p_cod, p_vendedor, p_actividad, p_temp, tipo, fecha,
    case p_temp when 'caliente' then '🔥 Empujón comercial: cerrar el pedido del mes'
                when 'tibia' then '🙂 Empujón comercial: propuesta y condición del mes'
                else '🌱 Branding: material de marca del mes' end,
    case p_temp when 'caliente' then 'Respuesta caliente en la visita. Mandar la propuesta con la condición del mes y llamar para cerrar.'
                when 'tibia' then 'Mostró interés. Mandar el material y una condición concreta; volver a llamar a los 3 días.'
                else 'Interés bajo. Un contacto por mes con material de marca, sin presionar: trabajo lento y constante.' end
      || coalesce(' ' || nullif(vidriera_resumen(p_cod), ''), ''),
    pieza)
  returning id into nuevo;
  return nuevo;
end $$;

-- Cada visita/contacto con resultado genera la acción del mes siguiente.
create or replace function trg_actividad_accion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t text;
  prev record;
  rango int;
begin
  if new.cod_cliente is null or new.resultado_contacto is null then return new; end if;
  if new.resultado_contacto in ('no_estaba','reagendar','nh','conflicto') then return new; end if;
  if coalesce(new.origen, '') not in ('checkin','agenda_campo','agenda_interior','ojo_tarjeta','reunion') then return new; end if;
  t := temperatura_cliente(new.cod_cliente, new.resultado_contacto,
         concat_ws(' ', new.actividad_desarrollo, new.actividad_futura, new.voz_cliente_nota, new.reaccion));
  if new.resultado_contacto in ('no_interesa','no') then t := 'fria'; end if;
  -- una visita "fría" (ej. el check-in automático) no baja una acción más caliente cargada en los últimos días
  select * into prev from acciones_seguimiento where cod_cliente = new.cod_cliente and estado = 'pendiente' limit 1;
  rango := case t when 'caliente' then 3 when 'tibia' then 2 else 1 end;
  if prev.id is not null and prev.creado_en >= now() - interval '3 days'
     and (case prev.temperatura when 'caliente' then 3 when 'tibia' then 2 else 1 end) >= rango then
    return new;
  end if;
  perform programar_accion(new.cod_cliente, coalesce(new.vendedor, (select vendedor_asignado from clientes where cod = new.cod_cliente)),
                           new.id, t, coalesce(new.fecha, hoy_ar()));
  return new;
exception when others then
  -- nunca trabar la carga de la visita (check-in, agenda, tarjetas) por la acción de seguimiento
  raise warning 'acciones_seguimiento: %', sqlerrm;
  return new;
end $$;
drop trigger if exists actividad_accion on actividad_diaria;
create trigger actividad_accion after insert on actividad_diaria for each row execute function trg_actividad_accion();

-- Branding: al marcarla hecha se programa la del mes siguiente (contacto mensual constante).
create or replace function trg_accion_hecha() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'hecha' and old.estado = 'pendiente' and new.tipo = 'branding' then
    perform programar_accion(new.cod_cliente, new.vendedor, null, 'fria', greatest(new.fecha_programada, hoy_ar()));
  end if;
  return new;
end $$;
drop trigger if exists accion_hecha on acciones_seguimiento;
create trigger accion_hecha after update of estado on acciones_seguimiento for each row execute function trg_accion_hecha();

-- Un envío de propuesta/material al cliente cumple la acción pendiente que vence en los próximos 5 días.
create or replace function trg_envio_cumple_accion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update acciones_seguimiento set estado = 'hecha', hecha_en = now(), hecha_por = new.vendedor
  where cod_cliente = new.cod_cliente and estado = 'pendiente' and fecha_programada <= hoy_ar() + 5;
  return new;
exception when others then
  raise warning 'acciones_seguimiento (envío): %', sqlerrm;
  return new;
end $$;
drop trigger if exists envio_cumple_accion on envios_propuesta;
create trigger envio_cumple_accion after insert on envios_propuesta for each row execute function trg_envio_cumple_accion();

-- Sube la temperatura de las pendientes si el cliente abrió el catálogo después de la visita (corre a diario).
create or replace function actualizar_temperaturas() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; t text;
begin
  for r in select * from acciones_seguimiento where estado = 'pendiente' and temperatura in ('fria','tibia') loop
    t := temperatura_cliente(r.cod_cliente, null, null);
    if (t = 'caliente' and r.temperatura <> 'caliente') or (t = 'tibia' and r.temperatura = 'fria') then
      perform programar_accion(r.cod_cliente, r.vendedor, r.actividad_id, t, hoy_ar() - 25);  -- vence pronto: mes en curso
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- lo que ve el vendedor ----------
-- Su día: cabeza de zona con ficha, ruta (si ya hizo check-in) y acciones que vencen.
create or replace function mi_dia_campo(p_vendedor text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if current_is_admin() or current_vendedor_rol() = 'administracion' then v := coalesce(p_vendedor, current_vendedor_codigo());
  else v := current_vendedor_codigo(); end if;
  if v is null then raise exception 'sin vendedor'; end if;
  return json_build_object(
    'vendedor', v,
    'cabeza', (select json_build_object('micro_zona', d.micro_zona, 'motivo', d.motivo, 'checkin_at', d.checkin_at,
                                        'ficha', ficha_optica(d.cod_cliente))
               from cabeza_dia d where d.vendedor = v and d.fecha = hoy_ar()),
    'ruta', (select json_agg(json_build_object('orden', r.orden, 'motivo', r.motivo, 'visitado', r.visitado,
                                               'distancia_m', r.distancia_m, 'ficha', ficha_optica(r.cod_cliente)) order by r.orden)
             from ruta_dia r where r.vendedor = v and r.fecha = hoy_ar() and r.orden > 0),
    'acciones', (select json_agg(json_build_object('id', s.id, 'cod', s.cod_cliente,
                    'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon), 'tel', coalesce(c.whatsapp, c.telefono),
                    'temperatura', s.temperatura, 'tipo', s.tipo, 'fecha', s.fecha_programada, 'titulo', s.titulo,
                    'detalle', s.detalle, 'pieza', p.titulo, 'pieza_url', coalesce(p.url_corta, p.url_publica, p.url))
                    order by s.fecha_programada, s.temperatura)
                 from acciones_seguimiento s join clientes c on c.cod = s.cod_cliente
                 left join piezas_marketing p on p.id = s.pieza_id
                 where s.vendedor = v and s.estado = 'pendiente' and s.fecha_programada <= hoy_ar() + 7)
  );
end $$;

create or replace function marcar_accion(p_id bigint, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare yo text := current_vendedor_codigo();
begin
  if p_estado not in ('hecha','cancelada') then raise exception 'estado inválido'; end if;
  update acciones_seguimiento set estado = p_estado, hecha_en = now(), hecha_por = yo
  where id = p_id and estado = 'pendiente'
    and (vendedor = yo or current_is_admin() or current_vendedor_rol() = 'administracion');
end $$;

-- ---------- permisos: nada directo a anon/authenticated; solo las funciones de la app ----------
revoke all on cabeza_zona, cabeza_dia, acciones_seguimiento from anon, authenticated;
alter table cabeza_zona enable row level security;
alter table cabeza_dia enable row level security;
alter table acciones_seguimiento enable row level security;
revoke all on function recalcular_cabezas_zona(), asignar_cabezas_dia(date), opticas_del_dia(text, double precision, double precision, text[], int),
  ficha_optica(text), programar_accion(text, text, bigint, text, date), actualizar_temperaturas(),
  mi_dia_campo(text), marcar_accion(bigint, text), temperatura_cliente(text,text,text), pieza_para_accion(text,text) from public, anon;
-- Supabase da EXECUTE a authenticated por defecto: las internas (fichas de cualquier cliente) solo para service_role.
revoke execute on function recalcular_cabezas_zona(), asignar_cabezas_dia(date), opticas_del_dia(text, double precision, double precision, text[], int),
  ficha_optica(text), programar_accion(text, text, bigint, text, date), actualizar_temperaturas(),
  temperatura_cliente(text,text,text), pieza_para_accion(text,text) from authenticated;
grant execute on function mi_dia_campo(text), marcar_accion(bigint, text) to authenticated;

-- ---------- tareas programadas ----------
-- Lunes 7:50 AR: recalcular cabezas de zona (las ventas y los prospectos cambian).
-- Lun-vie 8:15 AR: ojo-cabeza-dia asigna la cabeza del día y le manda a cada vendedor la ficha + acciones del día.
select cron.schedule('cabezas-zona-recalcular', '50 10 * * 1', $$select recalcular_cabezas_zona()$$);
select cron.schedule('ojo-cabeza-dia', '15 11 * * 1-5', $$select net.http_post(url := 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/ojo-cabeza-dia?tarea=dia', headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select valor from app_config where clave='cron_key')), body := '{}'::jsonb, timeout_milliseconds := 120000)$$);

-- ---------- remarketing continuo + datos de la vidriera (16/10/2026, 2ª parte) ----------
-- Lo que vio la foto del check-in (Orbital presente, competencia, POP sugerido) entra en el detalle de cada acción.
create or replace function vidriera_resumen(p_cod text) returns text
language sql stable security definer set search_path = public as $$
  select concat_ws(' ',
    case when c.tiene_orbital is false then 'Vidriera sin Orbital: sumar material de marca'
           || coalesce(' y ofrecer POP nivel ' || pn.nivel || ' (' || pn.nombre || ')', '') || '.'
         when c.tiene_orbital is true then 'Ya exhibe Orbital: reforzar con lanzamientos y revisar el POP.' end,
    case when jsonb_array_length(coalesce(c.vidriera_analisis -> 'marcas_visibles', '[]'::jsonb)) > 0
         then 'Competencia vista: ' || (select string_agg(x, ', ') from (select jsonb_array_elements_text(c.vidriera_analisis -> 'marcas_visibles') x limit 4) m) || '.' end)
  from clientes c
  left join lateral (select pop_sugerido from visitas_checkin v where v.cod_cliente = c.cod and v.pop_sugerido is not null order by v.confirmado_en desc nulls last limit 1) vk on true
  left join pop_niveles pn on pn.nivel = vk.pop_sugerido
  where c.cod = p_cod $$;
revoke execute on function vidriera_resumen(text) from public, anon, authenticated;
-- programar_accion: el detalle termina con  || coalesce(' ' || nullif(vidriera_resumen(p_cod), ''), '')

-- Remarketing continuo: cumplida una acción se programa la del mes siguiente (nadie queda sin contacto mensual).
-- branding → branding; empujón caliente → tibio; empujón tibio → tibio si sigue mirando el catálogo, si no branding.
create or replace function trg_accion_hecha() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  if new.estado = 'hecha' and old.estado = 'pendiente' then
    sig := case when new.tipo = 'branding' then 'fria'
                when new.temperatura = 'caliente' then 'tibia'
                else case when temperatura_cliente(new.cod_cliente, null, null) = 'fria' then 'fria' else 'tibia' end end;
    perform programar_accion(new.cod_cliente, new.vendedor, null, sig, greatest(new.fecha_programada, hoy_ar()));
  end if;
  return new;
exception when others then
  raise warning 'acciones_seguimiento (encadenar): %', sqlerrm;
  return new;
end $$;
