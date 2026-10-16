-- Panel Zonas v2 (16/10/2026): todas las cabezas de cada zona, seguimiento diario del campo
-- (5 visitas, 25 contactos, 5 POP, fotos leídas) y la lectura del punto de venta de cada cliente
-- (Orbital, exhibidor, marcas / participación, kit POP, material especial, contacto para agendar).

create or replace function panel_zonas(p_vendedor text default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if current_is_admin() or current_vendedor_rol() = 'administracion' then
    v := coalesce(p_vendedor, 'Adrian');
  else
    v := current_vendedor_codigo();
  end if;
  if v is null then raise exception 'sin vendedor'; end if;
  return json_build_object(
    'vendedor', v,
    -- seguimiento diario: visitas (meta 5), check-ins con foto, contactos (meta 25), agendados y POP (meta 5)
    'dias', coalesce((select json_agg(x order by x.fecha desc) from (
        select g::date fecha,
          (select count(distinct cod) from (
             select k.cod_cliente cod from visitas_checkin k where k.vendedor = v and k.estado = 'confirmado' and k.cod_cliente is not null
               and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = g::date
             union
             select a.cod_cliente from actividad_diaria a where a.vendedor = v and a.fecha = g::date
               and a.origen in ('checkin','agenda_campo') and a.resultado_contacto in ('visito','vendio','cmp','cat','pie','no_interesa')) t) visitas,
          (select count(*) from visitas_checkin k where k.vendedor = v and k.foto_url is not null
             and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = g::date) fotos,
          (select count(*) from visitas_checkin k where k.vendedor = v and k.analisis is not null
             and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = g::date) fotos_leidas,
          (select count(*) from contactos_dia c where c.vendedor = v and c.fecha = g::date) contactos_lista,
          (select count(*) from contactos_dia c where c.vendedor = v and c.fecha = g::date and c.estado <> 'pendiente') contactos,
          (select count(*) from contactos_dia c where c.vendedor = v and c.fecha = g::date and c.estado = 'agendado') agendados,
          (select count(distinct m.cod_cliente) from pop_stock_mov m where m.vendedor = v and m.motivo = 'instalado'
             and (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = g::date) pop,
          (select d.micro_zona from cabeza_dia d where d.vendedor = v and d.fecha = g::date) zona,
          (select d.checkin_at is not null from cabeza_dia d where d.vendedor = v and d.fecha = g::date) checkin_cabeza
        from generate_series(hoy_ar() - 13, hoy_ar(), interval '1 day') g
        where extract(isodow from g) <= 5) x), '[]'::json),
    'kits', json_build_object('exhibicion', pop_kits_disponibles(v, 'EXHIBICION'), 'presencia', pop_kits_disponibles(v, 'PRESENCIA')),
    'cabezas', coalesce((select json_agg(json_build_object(
        'micro_zona', z.micro_zona, 'area', z.area, 'cod', z.cod_cliente, 'motivo', z.motivo,
        'prioridad', round(z.prioridad_zona), 'sector', z.sector, 'n_clientes', z.n_clientes,
        'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon),
        'plan', (select json_agg(d.fecha order by d.fecha) from cabeza_dia d
                 where d.vendedor = z.vendedor and d.cod_cliente = z.cod_cliente and d.fecha >= hoy_ar())) order by z.micro_zona, z.sector)
      from cabeza_zona z join clientes c on c.cod = z.cod_cliente where z.vendedor = v), '[]'::json),
    'clientes', coalesce((select json_agg(json_build_object(
        'cod', x.cod, 'nombre', x.nombre, 'area', x.area, 'micro_zona', x.micro_zona, 'estado', x.estado,
        'nivel', x.nivel_partner, 'u12', x.u12, 'u_mejor', x.u_mejor_anio, 'ult_mes', x.ult_mes,
        'prioridad', x.prioridad_recupero, 'puntaje', p.puntaje_prospecto, 'oportunidad', p.tipo_oportunidad,
        'direccion', x.direccion, 'tel', coalesce(x.whatsapp, x.telefono),
        -- punto de venta: lo que leyó la última foto, POP y material especial
        'foto_fecha', cl.vidriera_fecha, 'foto_url', cl.foto_vidriera_url,
        'tiene_orbital', cl.tiene_orbital,
        'exhibidor', (cl.vidriera_analisis->>'tiene_exhibidor_orbital')::boolean,
        'marcas', cl.vidriera_analisis->'marcas_visibles',
        'participacion', cl.vidriera_analisis->'participacion',
        'espacio', cl.vidriera_analisis->>'espacio_vidriera',
        'pop_nivel', cl.pop_nivel,
        'kit', (select string_agg(distinct m.kit, ', ') from pop_stock_mov m where m.cod_cliente = x.cod and m.motivo = 'instalado'),
        'especial', (select e.estado from pdp_especial e where e.cod_cliente = x.cod),
        'ult_checkin', (select max(k.creado_en) from visitas_checkin k where k.cod_cliente = x.cod and k.estado = 'confirmado'),
        'contacto', (select json_build_object('fecha', cd.fecha, 'estado', cd.estado, 'visita', cd.fecha_visita)
                     from contactos_dia cd where cd.cod_cliente = x.cod and cd.fecha >= hoy_ar() - 21 order by cd.fecha desc limit 1)))
      from v_clasif_comercial x
      join clientes cl on cl.cod = x.cod
      left join v_prospectos_comercial p on p.cod = x.cod
      where x.vendedor = v), '[]'::json)
  );
end $$;
