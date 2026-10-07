-- Lista de precios para la central de consigna: categoría, modelo, código, descripción y precio
-- (lista óptico, sin IVA = stock.precio, el mismo que usa la consigna). Solo el link de la madre.
-- Entra el catálogo de Orbital con stock más todo lo que el cliente tiene en sus sucursales.
create or replace function public.consigna_lista_precios(p_k text)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare a consigna_acceso;
begin
  select * into a from consigna_acceso where codigo = p_k and activo;
  if a.codigo is null then raise exception 'acceso_invalido'; end if;
  if a.sucursal_id is not null then raise exception 'sin_permiso'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'categoria', trim(concat_ws(' · ',
                       case s.tipo when 'sol' then 'Sol' when 'receta' then 'Receta' end,
                       initcap(s.clasificacion))),
        'modelo', s.modelo, 'codigo', s.codigo, 'descripcion', s.descripcion,
        'tratamiento', s.tratamiento, 'precio', s.precio)
      order by s.tipo nulls last, s.clasificacion nulls last, s.modelo, s.descripcion)
    from stock s
    where coalesce(s.modelo,'') <> '' and coalesce(s.precio,0) > 1000
      and s.codigo !~ '^9{9,}$' and lower(s.modelo) not in ('outlet','prensa')
      and (s.cantidad > 0 or exists (
        select 1 from consigna_suc_stock c join cliente_sucursal cs on cs.id = c.sucursal_id
        where c.codigo = s.codigo and cs.cod_madre = a.cod_madre))
  ), '[]'::jsonb);
end $$;
grant execute on function public.consigna_lista_precios(text) to anon, authenticated;
