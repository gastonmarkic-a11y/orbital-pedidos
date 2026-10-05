-- Estudio de rostro (/lab/rostro?r=<codigo>): forma y medidas de los modelos que promociona un influencer
-- (su catálogo o la colección ZN), para recomendarle a su comunidad los que le van a su cara.
-- Solo datos públicos de producto (formato y medidas en mm). Re-ejecutable.
create or replace function public.rostro_medidas(p_modelos text[])
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'modelo', upper(trim(m.modelo)), 'formato', m.formato,
    'ancho_mm', round(m.ancho * 10), 'alto_mm', round(m.alto * 10))), '[]'::jsonb)
  from producto_medidas m
  where upper(trim(m.modelo)) = any (select upper(trim(x)) from unnest(p_modelos) x)
$$;
grant execute on function public.rostro_medidas(text[]) to anon, authenticated;
