-- Clasificación comercial por barrio / localidad (16/10/2026).
-- Nivel Partners (Premier / Advance / Asociado) sale de la planilla clientes-27-03-2025.xlsx,
-- cargada en _stg_planilla_20250327 (cod, tipo, lat, lon).
-- Prioridad de recuperación (0-100): volumen del mejor año 50, recencia 20, nivel Partners 20, frecuencia 10.
-- Se mide en unidades (no en pesos) para que la inflación no distorsione la comparación entre años.

create or replace view _v_nivel_partner as
select distinct on (base) base cod_base, tipo,
 case tipo when 'Premiere Partners' then 'Premier' when 'Advanced Partners' then 'Advance' else 'Asociado' end nivel
from (select lpad((regexp_match(cod, '(\d{5,6})'))[1], 6, '0') base, tipo from _stg_planilla_20250327 where tipo ~ 'Partners') s
where base is not null
order by base, case tipo when 'Premiere Partners' then 1 when 'Advanced Partners' then 2 else 3 end;

-- Localidad genérica ("Buenos Aires", vacía…) o de CABA: se usa al corregir ubicaciones.
create or replace function _loc_generica_o_caba(p_loc text, p_prov text) returns boolean language sql stable as $$
 select lower(unaccent(trim(coalesce(p_loc,'')))) ~ '^(buenos aires|bs\.? ?as\.?|capital federal|capital|ciudad autonoma de buenos aires|ciudad de buenos aires|caba|cdad\.? autonoma.*|provincia de buenos aires|caba/gba|)$'
   or region_de(p_prov,p_loc)='CABA' or subzona_gba(p_loc)='01 CABA' $$;

create or replace view v_clasif_comercial as
with corte as (select max(anio_mes) m from ventas_hist_cliente),
v as (
 select h.cod_cliente,
  sum(unidades) filter (where anio_mes > to_char(to_date(c.m,'YYYY-MM') - interval '12 months','YYYY-MM')) u12,
  sum(unidades) filter (where anio_mes > to_char(to_date(c.m,'YYYY-MM') - interval '24 months','YYYY-MM') and anio_mes <= to_char(to_date(c.m,'YYYY-MM') - interval '12 months','YYYY-MM')) u_prev12,
  sum(importe_ars) filter (where anio_mes > to_char(to_date(c.m,'YYYY-MM') - interval '12 months','YYYY-MM')) ars12,
  max(anio_mes) ult_mes,
  count(distinct anio_mes) filter (where anio_mes >= '2023-01') meses_compra_23_26,
  sum(unidades) filter (where anio_mes >= '2023-01') u_23_26
 from ventas_hist_cliente h cross join corte c group by 1),
mejor as (select cod_cliente, max(u) u_mejor_anio from (select cod_cliente, substring(anio_mes,1,4) a, sum(unidades) u from ventas_hist_cliente where anio_mes >= '2022-01' group by 1,2) x group by 1),
b as (
 select c.cod, coalesce(c.nomcomerc,c.razon) nombre, c.vendedor_asignado vendedor, c.localidad, c.barrio, c.direccion, c.telefono, c.whatsapp,
  region_de(c.provincia,c.localidad) reg, subzona_gba(c.localidad) sz, n.nivel nivel_partner,
  coalesce(v.u12,0) u12, coalesce(v.u_prev12,0) u_prev12, coalesce(v.ars12,0) ars12, coalesce(m.u_mejor_anio,0) u_mejor_anio,
  coalesce(v.meses_compra_23_26,0) meses_compra, v.ult_mes,
  (select m from corte) corte
 from clientes c
 left join v on v.cod_cliente=c.cod
 left join mejor m on m.cod_cliente=c.cod
 left join _v_nivel_partner n on n.cod_base = lpad((regexp_match(c.cod,'(\d{5,6})'))[1],6,'0')
 where coalesce(c.vendedor_asignado,'') not in ('Corporativo','Tienda','Gaston')),
e as (
 select b.*,
  case when barrio is not null then barrio
       when reg='CABA' or sz='01 CABA' then 'CABA (sin barrio)'
       when sz <> '99 Otros GBA' then initcap(lower(unaccent_simple(coalesce(localidad,''))))
       else coalesce(initcap(lower(nullif(trim(localidad),''))),'(sin localidad)') end micro_zona,
  case when barrio is not null or reg='CABA' or sz='01 CABA' then 'CABA' when sz <> '99 Otros GBA' then 'Conurbano' else 'Interior' end area,
  case when ult_mes is null then null else (extract(year from age(to_date(corte,'YYYY-MM'), to_date(ult_mes,'YYYY-MM')))*12 + extract(month from age(to_date(corte,'YYYY-MM'), to_date(ult_mes,'YYYY-MM'))))::int end meses_sin_compra
 from b),
f as (
 select e.*,
  case
   when u_mejor_anio = 0 and ult_mes is null then 'Nunca compró'
   when meses_sin_compra <= 5 and u_prev12 > 0 and u12 < 0.6*u_prev12 then 'En caída'
   when meses_sin_compra <= 5 then 'Activo'
   when meses_sin_compra <= 17 then 'Perdido reciente'
   when meses_sin_compra <= 41 then 'Perdido'
   else 'Histórico' end estado
 from e)
select f.*,
 case when estado in ('En caída','Perdido reciente','Perdido') then round(
   50 * least(1, ln(1+greatest(u_mejor_anio,0))/ln(1+1500))
 + 20 * case when estado='En caída' then 1 when meses_sin_compra<=11 then 0.9 when meses_sin_compra<=17 then 0.7 when meses_sin_compra<=29 then 0.45 else 0.25 end
 + case nivel_partner when 'Premier' then 20 when 'Advance' then 14 when 'Asociado' then 7 else 0 end
 + 10 * least(1, meses_compra/24.0)) end prioridad_recupero
from f;

-- ===== Fase 3: universo de prospectos (16/10/2026) =====
-- Marca normalizada de una óptica (para detectar cadenas con varias sucursales).
create or replace function marca_optica(p text) returns text language sql immutable as $$
 with a as (select lower(unaccent_simple(coalesce(p,''))) s),
 b as (select regexp_replace(regexp_replace(s, '\(.*$|\s+-\s+.*$|\s+suc(ursal|\.)?\s.*$', '', 'g'), '[^a-z0-9 ]', ' ', 'g') s from a),
 c as (select array_remove(regexp_split_to_array(trim(s), '\s+'), '') w from b),
 d as (select array(select x from unnest(w) x where x not in ('optica','opticas','optical','optico','opticos','centro','lab','laboratorio','la','el','los','las','de','del','y','e','srl','sa','s','a','sas','sh','s r l','co','ii','iii','i','1','2','3','casa','instituto','contactologia','visual')) w from c)
 select nullif(array_to_string(w[1:2],' '),'') from d $$;

-- Marca manual del vendedor: suma 10 puntos al prospecto.
create table if not exists prospecto_marca_vendedor (cod text primary key, estrategico boolean not null default true, nota text, marcado_por text, marcado_en timestamptz default now());

-- Puntaje de prospecto (0-100): cadena 30 + sucursales en AMBA 15 + nivel Partners 2025 / ex cliente 20
-- + ubicación (shopping/galería 15, avenida o calle comercial 10) + Instagram 10 + marca del vendedor 10.
-- Estratégico >= 45 · Secundario 25-44. Las sucursales de cuentas que ya compran y las fichas administrativas no puntúan.
-- (definición completa aplicada en la base: ver pg_get_viewdef('v_prospectos_comercial'))
