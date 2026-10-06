-- Campaña ASCARI (2026-10-06, Gastón): a las ópticas y prospectos que abrieron el catálogo
-- en los últimos 30 días les llega el video + texto del Ascari.
--   · WhatsApp oficial: plantilla ascari_temporada (edge campana-ascari), sobre el circuito de
--     campañas de siempre (campana + campana_envio, proveedor wa_meta).
--   · Vendedores: cada uno recibe en Telegram su lista con botón de WhatsApp con el texto ya escrito.
-- Quedan afuera los revendedores y la óptica de prueba; los dados de baja se cargan como 'baja'.

create or replace function public.campana_catalogo_abrieron(p_dias int default 30)
returns table(codigo text, tipo text, cod_cliente text, nombre text, vendedor text, wa text,
              ultima_visita timestamptz, de_baja boolean)
language sql stable security definer set search_path to 'public' as $$
  with vis as (
    select v.codigo, max(v.created_at) ultima
      from catalogo_visitas v
     where v.created_at > now() - make_interval(days => p_dias)
     group by v.codigo
  ), base as (
    select ac.codigo, ac.tipo, ac.cod_cliente, vis.ultima,
           case when ac.tipo = 'optica' then coalesce(nullif(btrim(cl.nomcomerc), ''), cl.razon, ac.label)
                else coalesce(nullif(btrim(ps.nombre), ''), ac.label) end nombre,
           case when _vend_activo(cl.vendedor_asignado) then cl.vendedor_asignado
                when _vend_activo(ac.enviado_por) then ac.enviado_por
                when _vend_activo(ac.vendedor) then ac.vendedor
                else 'Corporativo' end vendedor,
           case when ac.tipo = 'optica' then coalesce(cl.whatsapp, cl.telefono) else ps.telefono end tel_raw
      from vis
      join catalogo_acceso ac on ac.codigo = vis.codigo and ac.tipo in ('optica', 'prospecto')
      left join clientes cl on cl.cod = ac.cod_cliente
      left join prospeccion_social ps on ps.id = ac.prospeccion_id
     where (ac.tipo = 'prospecto' or ac.cod_cliente is not null)
       and coalesce(ac.cod_cliente, '') not in (select v.cod_cliente from vendedores v where v.rol = 'revendedor' and v.cod_cliente is not null)
       and coalesce(ac.cod_cliente, '') <> '999999'
  )
  -- Una fila por persona (una óptica puede tener más de un link): la visita más reciente.
  select distinct on (coalesce(b.cod_cliente, ojo_wa_numero(b.tel_raw), b.codigo))
         b.codigo, b.tipo, b.cod_cliente, b.nombre, b.vendedor, ojo_wa_numero(b.tel_raw), b.ultima,
         esta_de_baja(b.cod_cliente, null, b.tel_raw, 'whatsapp')
    from base b
   order by coalesce(b.cod_cliente, ojo_wa_numero(b.tel_raw), b.codigo), b.ultima desc
$$;

-- El link del botón de la plantilla necesita el acceso de cada uno (su catálogo con sus precios).
alter table public.campana_envio add column if not exists codigo_acceso text;
alter table public.campana_envio add column if not exists vendedor text;
