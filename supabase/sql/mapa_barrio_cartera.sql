-- Mapa por barrio en Cartera (16/10/2026).
-- Las vistas v_clasif_comercial / v_prospectos_comercial NO se exponen a anon ni authenticated
-- (leen clientes saltando RLS). La app entra solo por estas funciones, que filtran por vendedor:
-- un vendedor ve únicamente su cartera; admin y administración pueden pedir la de cualquiera.

revoke all on v_clasif_comercial, v_prospectos_comercial, _v_nivel_partner, prospecto_marca_vendedor from anon, authenticated;
alter table prospecto_marca_vendedor enable row level security;

create or replace function mapa_barrio(p_vendedor text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v text;
begin
  if current_is_admin() or current_vendedor_rol() = 'administracion' then
    v := coalesce(p_vendedor, current_vendedor_codigo());
  else
    v := current_vendedor_codigo();
  end if;
  if v is null then raise exception 'sin vendedor'; end if;
  return json_build_object(
    'vendedor', v,
    'corte', (select max(anio_mes) from ventas_hist_cliente),
    'clientes', coalesce((select json_agg(r) from (
      select cod, nombre, area, micro_zona, direccion, coalesce(whatsapp, telefono) tel, estado, nivel_partner,
             u_mejor_anio, u12, ult_mes, meses_sin_compra, prioridad_recupero
      from v_clasif_comercial
      where vendedor = v and estado in ('Activo','En caída','Perdido reciente','Perdido')) r), '[]'::json),
    'prospectos', coalesce((select json_agg(r) from (
      select cod, nombre, area, micro_zona, direccion, coalesce(whatsapp, telefono) tel, tipo_oportunidad, marca,
             suc_amba, nivel_partner, pts_ubicacion, seguidores_ig, puntaje_prospecto, coalesce(marcado, false) marcado, nota_vendedor
      from v_prospectos_comercial
      where vendedor = v and (puntaje_prospecto >= 25 or marcado)
        and tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')) r), '[]'::json)
  );
end $$;

-- Marca manual de prospecto estratégico (+10 puntos). Solo el vendedor dueño del cliente, admin o administración.
create or replace function marcar_prospecto(p_cod text, p_estrategico boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  yo text := current_vendedor_codigo();
begin
  if yo is null then raise exception 'sin vendedor'; end if;
  if not (current_is_admin() or current_vendedor_rol() = 'administracion'
          or exists (select 1 from clientes where cod = p_cod and vendedor_asignado = yo)) then
    raise exception 'el prospecto no es de tu cartera';
  end if;
  if p_estrategico then
    insert into prospecto_marca_vendedor (cod, estrategico, nota, marcado_por, marcado_en)
    values (p_cod, true, nullif(trim(p_nota), ''), yo, now())
    on conflict (cod) do update set estrategico = true, nota = coalesce(nullif(trim(excluded.nota), ''), prospecto_marca_vendedor.nota),
      marcado_por = excluded.marcado_por, marcado_en = now();
  else
    delete from prospecto_marca_vendedor where cod = p_cod;
  end if;
end $$;

revoke all on function mapa_barrio(text), marcar_prospecto(text, boolean, text) from public, anon;
grant execute on function mapa_barrio(text), marcar_prospecto(text, boolean, text) to authenticated;
