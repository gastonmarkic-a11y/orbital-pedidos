-- Catálogo propio por lead (checklist Ojo / ojo-leads).
-- Antes solo había link de catálogo para clientes (con cod_cliente): el vendedor no tenía
-- qué mandarle a un prospecto, o mandaba su link personal y no se sabía quién lo abría.
-- Ahora cada lead tiene su link: si es cliente, el de su óptica; si no, uno tipo 'prospecto'
-- a nombre del vendedor. Las visitas quedan por link y el pedido cae en la cola del vendedor
-- (catalogo_checkout: tipo <> 'optica' → vendedor del acceso).

alter table catalogo_acceso add column if not exists prospeccion_id bigint;
create index if not exists catalogo_acceso_prospeccion_idx on catalogo_acceso (prospeccion_id) where prospeccion_id is not null;

create or replace function public.catalogo_link_lead(p_prospeccion_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p record; v_vend text; v_cod text; v_tel text; r jsonb;
begin
  select * into p from prospeccion_social where id = p_prospeccion_id;
  if p.id is null then return null; end if;
  v_vend := coalesce((select vendedor from lead_check where prospeccion_id = p.id limit 1), p.asignado_a);

  -- Cliente: su link de óptica de siempre (lo crea si le faltaba).
  if p.cod_cliente is not null and exists (select 1 from clientes where cod = p.cod_cliente) then
    r := catalogo_link_cliente(p.cod_cliente, null);
    if coalesce((r->>'ok')::boolean, false) then return r->>'codigo'; end if;
  end if;

  select codigo into v_cod from catalogo_acceso
   where prospeccion_id = p.id and activo and tipo = 'prospecto' limit 1;
  if v_cod is not null then
    -- Si lo pasaron a otro vendedor (🔀 Otra zona), el pedido sigue al nuevo.
    update catalogo_acceso set vendedor = v_vend where codigo = v_cod and vendedor is distinct from v_vend;
    return v_cod;
  end if;

  v_tel := regexp_replace(coalesce(p.telefono, ''), '\D', '', 'g');
  v_cod := 'p' || substr(md5(random()::text || p.id), 1, 6);
  insert into catalogo_acceso (codigo, tipo, vendedor, label, activo, creado_por, prospeccion_id)
  values (v_cod, 'prospecto', v_vend,
          'Prospecto · ' || coalesce(p.nombre, '') || coalesce(' (' || nullif(p.zona, '') || ')', '') || coalesce(' · ' || nullif(v_tel, ''), ''),
          true, 'ojo-leads', p.id);
  return v_cod;
end $function$;

revoke all on function public.catalogo_link_lead(bigint) from public, anon, authenticated;
grant execute on function public.catalogo_link_lead(bigint) to service_role;
