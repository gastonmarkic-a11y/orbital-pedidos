-- Talle de cada modelo (S · M · L · XL/oversize), igual que las colecciones de talle de la tienda
-- (anteojos-de-sol-talle-chico / -talle-m / -talle-grande / -oversize, 05/10/2026). En la tienda el talle lo
-- definen ancho, alto y curvatura, no solo el ancho: por eso se guarda tal cual y no se calcula.
-- Kobe va XL (155 mm) aunque todavía no está en la colección Oversize. Re-ejecutable.
alter table producto_medidas add column if not exists talle text check (talle in ('S', 'M', 'L', 'XL'));

update producto_medidas p set talle = t.talle from (values
  ('S','BRERA'),('S','BROOKLYN'),('S','CASABLANCA'),('S','SILVERSTONE'),
  ('M','5TH AVENUE'),('M','ASCARI'),('M','BUENOS AIRES'),('M','CHARLOTTE'),('M','CIVIC CENTER'),('M','COLUMBIA'),
  ('M','EMMEN'),('M','LOS HAMPTON'),('M','MICRA'),('M','PALERMO'),('M','PLUMA'),('M','ROMA'),('M','SAN MARINO'),
  ('M','SOPHIA'),('M','SUBLIME'),('M','WYNWOOD'),('M','YORK'),('M','ZERO'),('M','ZETA 1'),('M','ZETA 11'),
  ('M','ZETA 2'),('M','ZETA 4'),('M','ZETA 7'),('M','ZETA 8'),('M','ZETA 9'),('M','ZZR'),
  ('L','ADELAIDA'),('L','ATLANTIC CITY'),('L','CENTRAL PARK'),('L','CRETA'),('L','EIVISSA'),('L','PARIS'),
  ('L','PHOENIX'),('L','SAN REMO'),('L','VENICE'),
  ('XL','LE MANS'),('XL','LONDRES'),('XL','MILANO'),('XL','KOBE')
) t(talle, modelo) where p.modelo = t.modelo;

-- Phoenix es L en la tienda: vuelve a ser rectangular (el oversize ahora es el talle XL).
update producto_medidas set formato = 'rectangular' where modelo = 'PHOENIX';
update producto_medidas set formato = 'rectangular' where modelo = 'KOBE';

-- rostro_medidas (selección de un influencer) devuelve el talle
create or replace function public.rostro_medidas(p_modelos text[])
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'modelo', upper(trim(m.modelo)), 'formato', m.formato, 'talle', m.talle,
    'ancho_mm', round(m.ancho * 10), 'alto_mm', round(m.alto * 10))), '[]'::jsonb)
  from producto_medidas m
  where upper(trim(m.modelo)) = any (select upper(trim(x)) from unnest(p_modelos) x)
$$;
grant execute on function public.rostro_medidas(text[]) to anon, authenticated;

-- pretest_marcos (estudio de rostro y chequeo visual) también devuelve el talle
create or replace function public.pretest_marcos()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with lib as (select * from stock_libre(null, null, null)),
  mods as (
    select s.modelo,
      sum(greatest(l.libre, 0)) libre,
      bool_or(coalesce(s.es_caliente, false)) caliente,
      coalesce(
        (select pi.url from producto_imagenes pi join stock s2 on s2.codigo = pi.codigo
          where s2.modelo = s.modelo and s2.tipo = 'receta' and pi.url not ilike '%packaging%' and not coalesce(pi.es_lifestyle, false)
          order by pi.orden nulls last, (pi.url ilike '%.png%'), pi.id limit 1),
        (select pi.url from producto_imagenes pi
          where pi.modelo = s.modelo and pi.codigo is null and pi.url not ilike '%packaging%'
          order by pi.es_lifestyle, pi.orden nulls last, pi.id limit 1)) foto,
      (select min(pp.precio) from precios_publicos pp join stock s3 on s3.codigo = pp.codigo
        where s3.modelo = s.modelo and s3.tipo = 'receta' and pp.precio > 0) precio_desde
    from stock s
    join lib l on l.codigo = s.codigo
    where s.tipo = 'receta' and l.libre > 0
    group by s.modelo
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'modelo', mo.modelo, 'alto_mm', round(m.alto * 10), 'ancho_mm', round(m.ancho * 10), 'formato', m.formato,
    'talle', m.talle, 'frente', m.frente, 'para', m.para, 'foto', mo.foto, 'precio_desde', mo.precio_desde)
    order by mo.caliente desc, mo.libre desc), '[]'::jsonb)
  from mods mo
  left join producto_medidas m on m.modelo = mo.modelo
  where mo.foto is not null;
$function$;
