-- Panel "Zonas" en Suite (16/10/2026): por vendedor, cada barrio / localidad con su cabeza de zona, los días
-- del plan en que le toca y TODOS los clientes de la zona (activos, a recuperar, prospectos y sin compras).
-- Un vendedor ve solo lo suyo; admin y administración eligen el vendedor.

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
    'cabezas', coalesce((select json_agg(json_build_object(
        'micro_zona', z.micro_zona, 'area', z.area, 'cod', z.cod_cliente, 'motivo', z.motivo,
        'prioridad', round(z.prioridad_zona),
        'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon),
        'plan', (select json_agg(d.fecha order by d.fecha) from cabeza_dia d
                 where d.vendedor = z.vendedor and d.micro_zona = z.micro_zona and d.fecha >= hoy_ar())))
      from cabeza_zona z join clientes c on c.cod = z.cod_cliente where z.vendedor = v), '[]'::json),
    'clientes', coalesce((select json_agg(json_build_object(
        'cod', x.cod, 'nombre', x.nombre, 'area', x.area, 'micro_zona', x.micro_zona, 'estado', x.estado,
        'nivel', x.nivel_partner, 'u12', x.u12, 'u_mejor', x.u_mejor_anio, 'ult_mes', x.ult_mes,
        'prioridad', x.prioridad_recupero, 'puntaje', p.puntaje_prospecto, 'oportunidad', p.tipo_oportunidad,
        'direccion', x.direccion, 'tel', coalesce(x.whatsapp, x.telefono)))
      from v_clasif_comercial x
      left join v_prospectos_comercial p on p.cod = x.cod
      where x.vendedor = v), '[]'::json)
  );
end $$;

revoke all on function panel_zonas(text) from public, anon;
grant execute on function panel_zonas(text) to authenticated;
