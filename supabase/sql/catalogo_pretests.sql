-- Vision Lab Pro en el catálogo mayorista (2026-10-07): la óptica ve los pretests que la eligieron
-- (optica_cod) o que salieron de su QR (optica_origen), con la misma clave del catálogo.
-- Estado compartido con la Suite; la óptica tiene su propia nota (nota_optica). No ve la nota interna
-- de Orbital ni la ruta de la receta (bucket privado).
alter table public.pretests add column if not exists nota_optica text;

create or replace function public.catalogo_pretests(p_clave text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with c as (select catalogo_cod(p_clave) cod)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'code', p.code, 'created_at', p.created_at, 'origen', p.origen,
    'nombre', p.nombre, 'edad', p.edad, 'usa', p.usa, 'indice', p.indice, 'semaforo', p.semaforo,
    'ticket', p.ticket, 'localidad', p.localidad, 'obra_social', p.obra_social,
    'modelo_buscado', p.modelo_buscado, 'derivado', p.oftalmologo_id is not null,
    'eligio', p.optica_cod = c.cod, 'de_mi_qr', p.optica_origen = c.cod,
    'estado', p.estado, 'nota_optica', p.nota_optica,
    'extras', coalesce(p.extras, '{}'::jsonb) - 'receta',
    'con_receta', p.extras ? 'receta'
  ) order by p.created_at desc), '[]'::jsonb)
  from pretests p, c
  where c.cod is not null and (p.optica_cod = c.cod or p.optica_origen = c.cod)
$$;

create or replace function public.catalogo_pretest_actualizar(p_clave text, p_id uuid, p_estado text, p_nota text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_cod text := catalogo_cod(p_clave);
begin
  if v_cod is null then return false; end if;
  if p_estado is not null and p_estado not in ('nuevo','contactado','turno','vendido','descartado') then return false; end if;
  update pretests set estado = coalesce(p_estado, estado), nota_optica = coalesce(p_nota, nota_optica)
   where id = p_id and (optica_cod = v_cod or optica_origen = v_cod);
  return found;
end $$;

grant execute on function public.catalogo_pretests(text) to anon, authenticated;
grant execute on function public.catalogo_pretest_actualizar(text, uuid, text, text) to anon, authenticated;
