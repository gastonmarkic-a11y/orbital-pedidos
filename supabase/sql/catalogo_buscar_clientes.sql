-- Buscador de clientes en el checkout del catálogo cuando el link es de un vendedor
-- (o el vendedor está logueado en la Suite). Antes había que tipear el código/CUIT
-- exacto y si no coincidía el pedido quedaba en cualquier cliente.
-- Solo responde a links tipo 'vendedor' activos: el link de una óptica no ve la cartera.
-- Primero los clientes asignados a ese vendedor, después el resto.
create or replace function public.catalogo_buscar_clientes(p_acceso text, p_q text)
returns table (cod text, razon text, nomcomerc text, localidad text, contacto text, whatsapp text, email text, propio boolean)
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_vend text;
  v_q text := unaccent(lower(trim(coalesce(p_q, ''))));
  v_dig text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  select a.vendedor into v_vend from catalogo_acceso a
   where a.codigo = p_acceso and a.activo and a.tipo = 'vendedor' limit 1;
  if v_vend is null then
    select v.codigo into v_vend from vendedores v
     where v.user_id = auth.uid() and v.activo and v.rol = 'vendedor' limit 1;
  end if;
  if v_vend is null or length(v_q) < 2 then return; end if;

  return query
  select c.cod, c.razon, c.nomcomerc, c.localidad, c.contacto, c.whatsapp, c.email,
         (c.vendedor_asignado = v_vend) as propio
    from clientes c
   where c.cod ilike v_q || '%'
      or unaccent(lower(coalesce(c.razon, ''))) like '%' || v_q || '%'
      or unaccent(lower(coalesce(c.nomcomerc, ''))) like '%' || v_q || '%'
      or unaccent(lower(coalesce(c.localidad, ''))) like '%' || v_q || '%'
      or (length(v_dig) >= 5 and regexp_replace(coalesce(c.cuit, ''), '\D', '', 'g') like '%' || v_dig || '%')
   order by (c.vendedor_asignado = v_vend) desc nulls last,
            (c.cod ilike v_q || '%') desc,
            coalesce(c.nomcomerc, c.razon)
   limit 12;
end $$;

grant execute on function public.catalogo_buscar_clientes(text, text) to anon, authenticated;
