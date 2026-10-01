-- Comisión doble para promotores de colección (Zaira, desde el 01/10/2026):
--   pct_comision        → todo lo orgánico (ver ajuste al final: solo Meta va al resto)
--   pct_comision_resto  → el resto de la colección: anuncios de Orbital y directo en la tienda
-- Rige para pedidos desde pct_resto_desde (fecha AR). Antes de esa fecha, todo a pct_comision.
-- Sin pct_comision_resto o sin fecha: todo a pct_comision, como antes.
-- "Propio" = canal 'link' o 'redes' de colab_venta_origen (link → meta → redes → tienda):
-- un anuncio de Orbital visto en Instagram cuenta como anuncio, no como redes.

alter table colab_influencer
  add column if not exists pct_comision_resto numeric,
  add column if not exists pct_resto_desde date;

create or replace view colab_coleccion_venta as
 WITH inf AS (
         SELECT i.id, i.pct_comision, i.pct_comision_resto, i.pct_resto_desde,
            i.coleccion, i.coleccion_tag, i.coleccion_desde, i.coleccion_solo_linea
           FROM colab_influencer i
          WHERE i.coleccion IS NOT NULL AND i.coleccion_desde IS NOT NULL
        ), skus AS (
         SELECT inf_1.id AS influencer_id, z.codigo AS sku, z.modelo
           FROM inf inf_1
             JOIN zn_links_color z ON z.activo AND inf_1.coleccion = 'orbital-x-zaira'::text
        UNION ALL
         SELECT inf_1.id, p.sku, p.modelo
           FROM inf inf_1
             JOIN colab_producto p ON p.sku IS NOT NULL AND inf_1.coleccion_tag IS NOT NULL AND inf_1.coleccion_tag = ANY (p.tags)
        ), sk AS (
         SELECT skus.influencer_id, skus.sku, min(skus.modelo) AS modelo
           FROM skus GROUP BY skus.influencer_id, skus.sku
        )
 SELECT inf.id AS influencer_id,
    v.order_id,
    v.order_number AS order_name,
    v.creado_en_shopify AS fecha,
    sk.sku,
    sk.modelo,
    q.unidades,
    round(q.bruto, 2) AS total_linea,
    round(n.neto, 2) AS neto_sin_iva,
    e.estado,
    round(CASE WHEN e.estado = 'pagado' THEN n.neto * p.pct / 100 ELSE 0 END, 2) AS com_influencer,
    lk.link_id,
    p.pct AS pct_aplicado,
    pr.propio
   FROM inf
     JOIN ventas_shopify v ON (v.creado_en_shopify AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= inf.coleccion_desde
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.raw -> 'line_items', '[]'::jsonb)) l(value)
     JOIN sk ON sk.influencer_id = inf.id AND sk.sku = (l.value ->> 'sku')
     CROSS JOIN LATERAL ( SELECT COALESCE((l.value ->> 'current_quantity')::integer, (l.value ->> 'quantity')::integer, 0) AS unidades,
            GREATEST(0::numeric, COALESCE((l.value ->> 'price')::numeric, 0) * COALESCE((l.value ->> 'current_quantity')::integer, (l.value ->> 'quantity')::integer, 0)::numeric
              - COALESCE((SELECT sum((d.value ->> 'amount')::numeric) FROM jsonb_array_elements(COALESCE(l.value -> 'discount_allocations', '[]'::jsonb)) d(value)), 0)) AS bruto) q
     CROSS JOIN LATERAL ( SELECT CASE WHEN (v.raw ->> 'taxes_included') = 'false' THEN q.bruto ELSE q.bruto / 1.21 END AS neto) n
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (v.raw ->> 'cancelled_at') IS NOT NULL THEN 'cancelado'
                    WHEN v.financial_status = ANY (ARRAY['paid', 'partially_refunded']) THEN 'pagado'
                    WHEN v.financial_status = 'refunded' THEN 'reembolsado'
                    ELSE 'pendiente'
                END AS estado) e
     CROSS JOIN LATERAL ( SELECT ( SELECT cl.id FROM colab_link cl
                 WHERE cl.influencer_id = inf.id AND v.landing_site ~~* '%utm_source=colab%' AND v.landing_site ~~* ('%utm_content=' || cl.codigo || '%')
                 LIMIT 1) AS link_id) lk
     CROSS JOIN LATERAL ( SELECT lk.link_id IS NOT NULL
              OR (NOT (COALESCE(v.landing_site, '') ~* 'utm_source=(fb|facebo|meta|ig|insta)' OR colab_fbclid_anuncio(v.landing_site))
                  AND COALESCE(v.referring_site, '') ~* '(instagram|facebook|tiktok|youtube|fb\.me|t\.co)') AS propio) pr
     CROSS JOIN LATERAL ( SELECT CASE
                WHEN inf.pct_comision_resto IS NOT NULL AND inf.pct_resto_desde IS NOT NULL
                 AND (v.creado_en_shopify AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= inf.pct_resto_desde
                 AND NOT pr.propio
                THEN inf.pct_comision_resto ELSE inf.pct_comision END AS pct) p
  WHERE NOT inf.coleccion_solo_linea OR v.order_number ~ '^#?[0-9]+$';

-- Venta efectiva: se agrega el % aplicado a cada fila (al final, para no romper dependientes).
create or replace view colab_venta_ef as
 SELECT v.order_id, v.order_name, v.fecha, v.link_id, v.influencer_id, v.admin_id, v.modelo, v.estado,
    v.unidades, v.total_cliente, v.neto_sin_iva, v.com_influencer, v.com_admin,
    'link'::text AS origen,
    v.pct_influencer AS pct_inf
   FROM colab_venta v JOIN colab_influencer i ON i.id = v.influencer_id
  WHERE i.coleccion_desde IS NULL
UNION ALL
 SELECT c.order_id, c.order_name, c.fecha, c.link_id, c.influencer_id, i.admin_id, c.modelo, c.estado,
    c.unidades, c.total_linea AS total_cliente, c.neto_sin_iva, c.com_influencer,
    round(CASE WHEN c.estado = 'pagado' THEN c.neto_sin_iva * COALESCE(a.pct_comision, 0) / 100 ELSE 0 END, 2) AS com_admin,
    CASE WHEN c.link_id IS NOT NULL THEN 'link' ELSE 'coleccion' END AS origen,
    c.pct_aplicado AS pct_inf
   FROM colab_coleccion_venta c
     JOIN colab_influencer i ON i.id = c.influencer_id
     JOIN colab_admin a ON a.id = i.admin_id;

-- Entrar: el panel necesita los dos % y desde cuándo rige el segundo.
create or replace function colab_entrar(p_clave text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('rol', 'orbital', 'id', id, 'nombre', nombre)
       from colab_orbital where clave = p_clave and activo),
    (select jsonb_build_object('rol', 'admin', 'id', id, 'nombre', nombre, 'pct', pct_comision, 'influencers_ig', ve_influencers_ig)
       from colab_admin where clave = p_clave and activo),
    (select jsonb_build_object('rol', 'influencer', 'id', i.id, 'nombre', i.nombre, 'ref', i.ref,
            'pct', i.pct_comision, 'pct_resto', i.pct_comision_resto, 'pct_resto_desde', i.pct_resto_desde,
            'pct_descuento', i.pct_descuento, 'admin', a.nombre, 'coleccion', i.coleccion)
       from colab_influencer i join colab_admin a on a.id = i.admin_id
      where i.clave = p_clave and i.activo and a.activo)
  )
$$;

-- Liquidación: cada fila trae el % que se le aplicó.
create or replace function colab_liquidacion(p_clave text, p_periodo text, p_admin bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_infs bigint[] := colab_scope(p_clave, p_admin);
  v_ve_admin boolean := colab_inf_id(p_clave) is null;
  v_m timestamp := to_timestamp(coalesce(nullif(p_periodo, ''), to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')) || '-01', 'YYYY-MM-DD')::timestamp;
begin
  if v_infs is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_name', v.order_name, 'fecha', v.fecha, 'influencer', i.nombre, 'admin', a.nombre, 'modelo', v.modelo,
      'estado', v.estado, 'unidades', v.unidades, 'total_cliente', v.total_cliente,
      'neto', v.neto_sin_iva, 'com_inf', v.com_influencer, 'pct', v.pct_inf,
      'com_adm', case when v_ve_admin then v.com_admin else null end,
      'red', l.red, 'formato', l.formato, 'canal', o.canal, 'campana', o.nombre
    ) order by v.fecha desc)
    from colab_venta_ef v
    join colab_influencer i on i.id = v.influencer_id
    join colab_admin a on a.id = i.admin_id
    left join colab_link l on l.id = v.link_id
    left join colab_venta_origen o on o.order_id = v.order_id and o.influencer_id = v.influencer_id
    where v.influencer_id = any(v_infs)
      and date_trunc('month', v.fecha at time zone 'America/Argentina/Buenos_Aires') = v_m), '[]'::jsonb);
end $$;

-- Zaira: 20% lo suyo, 10% el resto, desde el 01/10/2026.
update colab_influencer set pct_comision_resto = 10, pct_resto_desde = '2026-10-01'
 where coleccion = 'orbital-x-zaira';

-- Bot de Telegram y /zn: también necesitan los dos %.
create or replace function colab_tg_quien(p_tg bigint) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare r jsonb;
begin
  update colab_tg set ultimo_visto = now() where telegram_user_id = p_tg and activo;
  select jsonb_build_object(
    'influencer_id', i.id, 'nombre', i.nombre, 'clave', i.clave,
    'pct_comision', i.pct_comision, 'pct_descuento', i.pct_descuento,
    'pct_comision_resto', i.pct_comision_resto, 'pct_resto_desde', i.pct_resto_desde,
    'coleccion', i.coleccion, 'chat_id', t.chat_id,
    'admin', a.nombre, 'cbu_alias', i.cbu_alias
  ) into r
  from colab_tg t
  join colab_influencer i on i.id = t.influencer_id
  join colab_admin a on a.id = i.admin_id
  where t.telegram_user_id = p_tg and t.activo and i.activo and a.activo;
  return r;
end $function$;

create or replace function zn_colab_clave(p_clave text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when zn_clave_ok(p_clave) then
    (select jsonb_build_object('clave', i.clave, 'pct', i.pct_comision,
            'pct_resto', i.pct_comision_resto, 'pct_resto_desde', i.pct_resto_desde)
       from colab_influencer i join colab_admin a on a.id = i.admin_id
      where i.ref = 'zn' and i.activo and a.activo)
  end
$$;

-- colab_resumen leía colab_venta_ef / colab_venta_origen en ~30 subconsultas (1,1 s, al
-- límite del timeout de anon). Ahora las lee una vez en CTEs materializadas (≈40 ms).
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.colab_resumen'::regproc);
  if position('vo as materialized' in d) > 0 then return; end if;
  d := replace(d, 'colab_venta_ef', 've');
  d := replace(d, 'colab_venta_origen', 'vo');
  d := replace(d, 'return jsonb_build_object(',
    'return (with ve as materialized (select * from colab_venta_ef where influencer_id = any(v_infs)), ' ||
    'vo as materialized (select * from colab_venta_origen where influencer_id = any(v_infs)) select jsonb_build_object(');
  d := replace(d, E'  );\nend $function$', E'  ));\nend $function$');
  execute d;
end $mig$;

-- 01/10/2026 (ajuste): el 10% es SOLO para ventas por anuncios pagos de Meta. Todo lo orgánico
-- (links, redes, publicaciones de Orbital o de otros, compras directas) va al pct_comision.
do $mig$
declare d text;
begin
  d := pg_get_viewdef('public.colab_coleccion_venta'::regclass);
  d := regexp_replace(d,
    '\(\(lk\.link_id IS NOT NULL\) OR \(\(NOT \(\(COALESCE\(v\.landing_site, ''''::text\) ~\* ''utm_source=\(fb\|facebo\|meta\|ig\|insta\)''::text\) OR colab_fbclid_anuncio\(v\.landing_site\)\)\) AND \(COALESCE\(v\.referring_site, ''''::text\) ~\* ''\(instagram\|facebook\|tiktok\|youtube\|fb\\.me\|t\\.co\)''::text\)\)\) AS propio',
    '((lk.link_id IS NOT NULL) OR (NOT ((COALESCE(v.landing_site, ''''::text) ~* ''utm_source=(fb|facebo|meta|ig|insta)''::text) OR colab_fbclid_anuncio(v.landing_site)))) AS propio');
  if position('referring_site' in d) = 0 then
    execute 'create or replace view colab_coleccion_venta as ' || d;
  end if;
end $mig$;

-- Dashboard con período: serie de 12 meses y orígenes por rango de meses.
-- (aplicado como migración colab_dashboard_periodos: colab_resumen 5→11 meses + colab_origenes)
