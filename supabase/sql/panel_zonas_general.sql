-- Panel general de zonas (16/10/2026): los 3 vendedores juntos para el mapa único de CABA + conurbano
-- (zonas con clientes y centro, todas las cabezas con coordenadas) y el seguimiento desde el 14/10.
-- Solo admin / administración.

create or replace function panel_zonas_general() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not (current_is_admin() or current_vendedor_rol() = 'administracion') then raise exception 'solo administración'; end if;
  return (
    with cli as materialized (
      select v.cod, v.vendedor, v.micro_zona, v.area, v.estado, c.lat::float8 lat, c.lon::float8 lon
      from v_clasif_comercial v join clientes c using (cod)
      where v.vendedor in ('Adrian','Bruno','Lola') and v.area in ('CABA','Conurbano')
        and v.micro_zona not in ('CABA (sin barrio)','(sin localidad)','Buenos Aires')),
    pro as materialized (select cod from v_prospectos_comercial where puntaje_prospecto >= 45),
    zonas as materialized (
      select x.vendedor, x.micro_zona, x.area, count(*) n,
        count(*) filter (where x.estado = 'Activo') activos,
        count(*) filter (where x.estado in ('En caída','Perdido reciente','Perdido')) recuperar,
        count(p.cod) prospectos,
        avg(x.lat) filter (where x.lat between -35.4 and -33.6 and x.lon between -59.8 and -57.6) lat,
        avg(x.lon) filter (where x.lat between -35.4 and -33.6 and x.lon between -59.8 and -57.6) lon
      from cli x left join pro p on p.cod = x.cod group by 1, 2, 3)
    select json_build_object(
      'zonas', coalesce((select json_agg(z order by z.vendedor, z.n desc) from zonas z), '[]'::json),
      'cabezas', coalesce((select json_agg(json_build_object(
          'vendedor', k.vendedor, 'micro_zona', k.micro_zona, 'area', k.area, 'cod', k.cod_cliente, 'sector', k.sector,
          'motivo', k.motivo, 'n_clientes', k.n_clientes, 'prioridad', round(k.prioridad_zona), 'lat', k.lat, 'lon', k.lon,
          'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon),
          'proxima', (select min(d.fecha) from cabeza_dia d where d.cod_cliente = k.cod_cliente and d.fecha >= hoy_ar())) order by k.vendedor, k.micro_zona, k.sector)
        from cabeza_zona k join clientes c on c.cod = k.cod_cliente), '[]'::json),
      'vendedores', (select json_agg(json_build_object(
          'vendedor', v,
          'clientes', (select count(*) from cli where vendedor = v),
          'activos', (select count(*) from cli where vendedor = v and estado = 'Activo'),
          'zonas', (select count(*) from zonas where vendedor = v),
          'cabezas', (select count(*) from cabeza_zona where vendedor = v),
          'hoy_zona', (select micro_zona from cabeza_dia where vendedor = v and fecha = hoy_ar()),
          'hoy_checkin', (select checkin_at is not null from cabeza_dia where vendedor = v and fecha = hoy_ar()),
          'visitas_hoy', (select count(distinct k.cod_cliente) from visitas_checkin k where k.vendedor = v and k.estado = 'confirmado'
                            and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date = hoy_ar()),
          'visitas_periodo', (select count(*) from (select distinct k.cod_cliente, (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date
                            from visitas_checkin k where k.vendedor = v and k.estado = 'confirmado'
                            and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date >= date '2026-10-14') t),
          'contactos_hoy', (select count(*) from contactos_dia where vendedor = v and fecha = hoy_ar() and estado <> 'pendiente'),
          'contactos_periodo', (select count(*) from contactos_dia where vendedor = v and fecha >= date '2026-10-14' and estado <> 'pendiente'),
          'agendados', (select count(*) from contactos_dia where vendedor = v and fecha >= date '2026-10-14' and estado = 'agendado'),
          'pop_periodo', (select count(distinct cod_cliente) from pop_stock_mov where vendedor = v and motivo = 'instalado'),
          'dias_habiles', (select count(*) from generate_series(date '2026-10-14', hoy_ar(), interval '1 day') g where extract(isodow from g) <= 5)))
        from unnest(array['Lola','Bruno','Adrian']) v)
    ));
end $$;
revoke all on function panel_zonas_general() from public, anon;
grant execute on function panel_zonas_general() to authenticated;
