-- Objetivo diario de campo (16/10/2026): 5 VISITAS (cabeza de zona + las 4 que siguen) y 25 CONTACTOS
-- para ir armando agenda: mensajes a ópticas de las zonas de los próximos días del plan (cabeza_dia),
-- para que cuando el vendedor llegue a ese barrio ya tenga visitas confirmadas. Los AGENDADOS entran
-- primero en la ruta de ese día (opticas_del_dia les suma 60 puntos).

create table if not exists contactos_dia (
  fecha date not null,                 -- día en que se le pide contactar
  vendedor text not null,
  cod_cliente text not null,
  micro_zona text,
  fecha_visita date,                   -- día del plan en que va a estar en esa zona
  motivo text,
  orden int,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','enviado','agendado','no_responde','no_interesa')),
  actualizado_en timestamptz,
  primary key (fecha, vendedor, cod_cliente)
);
create index if not exists contactos_dia_agendado on contactos_dia (cod_cliente, fecha_visita) where estado = 'agendado';
revoke all on contactos_dia from anon, authenticated;
alter table contactos_dia enable row level security;

-- Arma los 25 contactos del día de cada vendedor con cabeza asignada.
-- Zonas: las de los próximos 5 días hábiles del plan. Candidatos con teléfono, sin contacto en 14 días
-- y sin haber estado en la lista en 21 días. Hasta 8 por día de visita, los días más cercanos primero.
create or replace function generar_contactos_dia(p_fecha date default null, p_n int default 25) returns int
language plpgsql security definer set search_path = public as $$
declare f date := coalesce(p_fecha, hoy_ar()); n int;
begin
  if extract(isodow from f) > 5 then return 0; end if;
  insert into contactos_dia (fecha, vendedor, cod_cliente, micro_zona, fecha_visita, motivo, orden)
  with prox as (
    select vendedor, fecha fecha_visita, micro_zona, cod_cliente cabeza,
           row_number() over (partition by vendedor order by fecha) k
    from cabeza_dia where fecha > f and fecha <= f + 10),
  prox5 as (select * from prox where k <= 5),
  ya as (select vendedor from contactos_dia where fecha = f group by 1),
  pros as materialized (select cod, puntaje_prospecto from v_prospectos_comercial
           where (puntaje_prospecto >= 25 or marcado)
             and tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')),
  cand as (
    select p.vendedor, p.fecha_visita, p.micro_zona, v.cod,
      case when v.estado in ('En caída','Perdido reciente','Perdido') then 'recuperar'
           when v.estado = 'Activo' then 'activo'
           when pr.cod is not null then 'prospecto' else 'sin compras' end motivo,
      case when v.estado in ('En caída','Perdido reciente','Perdido') then coalesce(v.prioridad_recupero, 30) + 10
           when v.estado = 'Activo' then 40
           when pr.cod is not null then pr.puntaje_prospecto
           else 5 end pts
    from prox5 p
    join v_clasif_comercial v on v.vendedor = p.vendedor and v.micro_zona = p.micro_zona and v.cod <> p.cabeza
    join clientes c on c.cod = v.cod
    left join pros pr on pr.cod = v.cod
    where p.vendedor not in (select vendedor from ya)
      and nullif(regexp_replace(coalesce(c.whatsapp, c.telefono, ''), '\D', '', 'g'), '') is not null
      and v.estado <> 'Histórico'
      and not exists (select 1 from actividad_diaria a where a.cod_cliente = v.cod and a.fecha >= f - 14)
      and not exists (select 1 from contactos_dia cd where cd.cod_cliente = v.cod and cd.fecha >= f - 21)),
  rk as (select *, row_number() over (partition by vendedor, fecha_visita order by pts desc) rn from cand),
  sel as (select *, row_number() over (partition by vendedor order by (rn > 8), fecha_visita, rn) ord from rk)
  select f, vendedor, cod, micro_zona, fecha_visita, motivo, ord from sel where ord <= p_n
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Mensaje sugerido para WhatsApp (lo usa el bot y la app).
create or replace function mensaje_contacto(p_vendedor text, p_motivo text, p_zona text, p_fecha date, p_contacto text)
returns text language sql immutable as $$
  select 'Hola' || coalesce(' ' || split_part(nullif(trim(p_contacto), ''), ' ', 1), '') || '! Soy '
    || case p_vendedor when 'Adrian' then 'Adrián' else p_vendedor end || ', de Orbital Eyewear 👋 '
    || 'El ' || (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from p_fecha)::int + 1]
    || ' ' || to_char(p_fecha, 'DD/MM') || ' voy a estar recorriendo ' || p_zona || '. '
    || case p_motivo
         when 'recuperar' then 'Hace un tiempo que no trabajamos juntos y quiero mostrarte las novedades y las condiciones de este mes para volver. '
         when 'activo' then 'Quiero pasar a mostrarte los lanzamientos y ver cómo está la exhibición. '
         else 'Me gustaría presentarte la marca y dejarte el catálogo. ' end
    || '¿Te queda bien que pase? ¿En qué horario te viene mejor?' $$;

-- Al marcar un contacto como agendado queda la próxima agenda en el cliente.
create or replace function marcar_contacto(p_cod text, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare yo text := current_vendedor_codigo(); r record;
begin
  if p_estado not in ('enviado','agendado','no_responde','no_interesa','pendiente') then raise exception 'estado inválido'; end if;
  select * into r from contactos_dia where cod_cliente = p_cod and fecha >= hoy_ar() - 14
    and (vendedor = yo or current_is_admin() or current_vendedor_rol() = 'administracion')
    order by fecha desc limit 1;
  if r is null then raise exception 'ese contacto no está en tu lista'; end if;
  update contactos_dia set estado = p_estado, actualizado_en = now() where fecha = r.fecha and vendedor = r.vendedor and cod_cliente = p_cod;
  if p_estado = 'agendado' and r.fecha_visita is not null then
    update clientes set proxima_agenda_fecha = r.fecha_visita, proximo_paso = '📍 Visita agendada (cabeza de zona ' || coalesce(r.micro_zona, '') || ')',
                        agenda_owner = r.vendedor, actualizado_en = now()
    where cod = p_cod;
  end if;
  if p_estado in ('enviado','agendado','no_interesa') then
    insert into actividad_diaria (fecha, vendedor, cod_cliente, nombre_comercio, origen, resultado_contacto, actividad_desarrollo, proximo_paso_fecha)
    select hoy_ar(), r.vendedor, p_cod, coalesce(nullif(trim(c.nomcomerc), ''), c.razon), 'contacto_agenda',
           case p_estado when 'agendado' then 'agendado' when 'no_interesa' then 'no_interesa' else 'mensaje' end,
           case p_estado when 'agendado' then 'Visita agendada para el ' || to_char(r.fecha_visita, 'DD/MM') || ' (' || r.micro_zona || ')'
                         when 'no_interesa' then 'Contacto para agendar: no le interesa'
                         else 'Mensaje para agendar visita del ' || to_char(r.fecha_visita, 'DD/MM') end,
           case when p_estado = 'agendado' then r.fecha_visita end
    from clientes c where c.cod = p_cod;
  end if;
end $$;

revoke all on function generar_contactos_dia(date, int), mensaje_contacto(text, text, text, date, text) from public, anon, authenticated;
revoke all on function marcar_contacto(text, text) from public, anon;
grant execute on function marcar_contacto(text, text) to authenticated;

-- La visita agendada sale primera en el check-in de ese día.
create or replace function opticas_del_dia(p_vendedor text, p_lat double precision, p_lon double precision,
  p_excluir text[] default '{}', p_n int default 4)
returns table (cod text, nombre text, motivo text, puntaje numeric, distancia_m int, lat double precision, lon double precision, direccion text, micro_zona text)
language plpgsql stable security definer set search_path = public as $$
declare radio int := 8000;
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
          when exists (select 1 from contactos_dia cd where cd.cod_cliente = b.cod and cd.estado = 'agendado' and cd.fecha_visita = hoy_ar()) then 100
          when b.estado in ('En caída','Perdido reciente','Perdido') then coalesce(b.prioridad_recupero, 30)
          when b.estado = 'Activo' then 35
          when pr.cod is not null then pr.puntaje_prospecto * 0.8
          else null end base_pts,
        case
          when exists (select 1 from contactos_dia cd where cd.cod_cliente = b.cod and cd.estado = 'agendado' and cd.fecha_visita = hoy_ar()) then '📅 visita agendada para hoy'
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

-- Mi día con el objetivo (5 visitas / 25 contactos) y la lista de contactos con su mensaje.
create or replace function mi_dia_campo(p_vendedor text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if current_is_admin() or current_vendedor_rol() = 'administracion' then v := coalesce(p_vendedor, current_vendedor_codigo());
  else v := current_vendedor_codigo(); end if;
  if v is null then raise exception 'sin vendedor'; end if;
  return json_build_object(
    'vendedor', v,
    'objetivo', json_build_object(
       'visitas_meta', 5,
       'visitas', (select count(distinct a.cod_cliente) from actividad_diaria a where a.vendedor = v and a.fecha = hoy_ar()
                   and a.origen in ('checkin','agenda_campo') and a.resultado_contacto in ('visito','vendio','cmp','cat','pie','no_interesa')),
       'contactos_meta', 25,
       'contactos', (select count(*) from contactos_dia c where c.vendedor = v and c.fecha = hoy_ar() and c.estado <> 'pendiente'),
       'agendados', (select count(*) from contactos_dia c where c.vendedor = v and c.estado = 'agendado' and c.fecha_visita >= hoy_ar())),
    'cabeza', (select json_build_object('micro_zona', d.micro_zona, 'motivo', d.motivo, 'checkin_at', d.checkin_at,
                                        'ficha', ficha_optica(d.cod_cliente))
               from cabeza_dia d where d.vendedor = v and d.fecha = hoy_ar()),
    'ruta', (select json_agg(json_build_object('orden', r.orden, 'motivo', r.motivo, 'visitado', r.visitado,
                                               'distancia_m', r.distancia_m, 'ficha', ficha_optica(r.cod_cliente)) order by r.orden)
             from ruta_dia r where r.vendedor = v and r.fecha = hoy_ar() and r.orden > 0),
    'contactos', (select json_agg(json_build_object('cod', c.cod_cliente,
                    'nombre', coalesce(nullif(trim(cl.nomcomerc), ''), cl.razon), 'contacto', cl.contacto,
                    'whatsapp', cl.whatsapp, 'telefono', cl.telefono, 'zona', c.micro_zona, 'fecha_visita', c.fecha_visita,
                    'motivo', c.motivo, 'estado', c.estado,
                    'mensaje', mensaje_contacto(v, c.motivo, c.micro_zona, c.fecha_visita, cl.contacto)) order by c.orden)
                  from contactos_dia c join clientes cl on cl.cod = c.cod_cliente
                  where c.vendedor = v and c.fecha = hoy_ar()),
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
