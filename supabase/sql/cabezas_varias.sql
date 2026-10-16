-- Cabezas de zona v2 (16/10/2026): varias cabezas por barrio / localidad + correcciones de la revisión.
--
-- Revisión de la v1 (una sola cabeza por zona):
--  · Zonas grandes con un solo arranque: La Plata (27 clientes, 11 fuertes, 14 km), Quilmes (9 fuertes),
--    Lomas (21), Lanús (13 km), Pilar (11 km)… → ahora una cabeza por sector: una cada 5 clientes (lo que
--    cubre un día de 5 visitas), máx. 6, separadas al menos 600 m en CABA y 1 km en conurbano. La 1ª es la de siempre (ancla →
--    a recuperar → prospecto); las demás tienen que ser fuertes: activo con 12+ u/año o a recuperar con
--    prioridad 60+.
--  · El nivel Partners (Premier / Advance / Asociado) ahora pesa al elegir el ancla (+30 / +20 / +10 %).
--  · Interior colado como conurbano (San Miguel de Tucumán, San Fernando del Valle, Gral San Martín de
--    Chubut, Mercedes de Corrientes): fuera, con filtro de provincia y de coordenadas AMBA.
--  · Coordenadas que caen lejos de su zona (Ituzaingó a 73 km, Liniers a 20 km): no se usan para elegir cabeza.
--  · Zonas de otro vendedor por excepción (Adrián en Morón, Flores, Palomar): la cabeza la pone el dueño de la
--    zona; el cliente de excepción se sigue atendiendo pero no arma un día entero.
--  · Localidades duplicadas por cómo están escritas (S. A. de Padua, Pacheco, Hudson, Palomar): unificadas.
--  · La rotación diaria ahora es por cabeza (no por zona) y no repite la misma zona dos días seguidos.
--  · Los 25 contactos de cada día van a los clientes del sector de esa cabeza.

-- ---------- 1) localidades duplicadas ----------
update clientes set localidad = 'San Antonio de Padua', actualizado_en = now() where localidad ilike 's. a. de padua';
update clientes set localidad = 'General Pacheco', actualizado_en = now() where localidad ilike 'pacheco';
update clientes set localidad = 'Guillermo Hudson', actualizado_en = now() where localidad ilike 'hudson';
update clientes set localidad = 'El Palomar', actualizado_en = now() where localidad ilike 'palomar';

-- ---------- 2) tabla: varias cabezas por zona ----------
alter table cabeza_zona drop constraint if exists cabeza_zona_pkey;
alter table cabeza_zona add column if not exists sector int not null default 1;
alter table cabeza_zona add column if not exists n_clientes int;
alter table cabeza_zona add primary key (vendedor, cod_cliente);

create or replace function recalcular_cabezas_zona() returns int
language plpgsql security definer set search_path = public as $$
declare z record; k record; maxc int; sep numeric; elegidos int; n int;
begin
  delete from cabeza_zona;

  drop table if exists _cz_all;
  create temp table _cz_all as select * from v_clasif_comercial;

  drop table if exists _cz_cli;
  create temp table _cz_cli as
  select v.cod, v.vendedor, v.micro_zona, v.area, v.estado, v.u12, v.u_mejor_anio, v.prioridad_recupero, v.nivel_partner,
         c.lat::float8 lat, c.lon::float8 lon
  from _cz_all v join clientes c using (cod)
  where v.area in ('CABA','Conurbano') and v.vendedor in ('Adrian','Bruno','Lola') and c.lat is not null
    and v.micro_zona not in ('CABA (sin barrio)','(sin localidad)','Buenos Aires')
    and v.estado in ('Activo','En caída','Perdido reciente','Perdido')
    and (c.provincia is null or lower(unaccent_simple(c.provincia)) in ('buenos aires','caba','ciudad autonoma de buenos aires','capital federal','moron','berazategui'))
    and c.lat between -35.4 and -33.6 and c.lon between -59.8 and -57.6;

  drop table if exists _cz_pro;
  create temp table _cz_pro as
  select p.cod, p.vendedor, p.micro_zona, p.area, p.puntaje_prospecto, p.lat::float8 lat, p.lon::float8 lon
  from v_prospectos_comercial p
  where p.area in ('CABA','Conurbano') and p.vendedor in ('Adrian','Bruno','Lola') and p.lat is not null
    and p.micro_zona not in ('CABA (sin barrio)','(sin localidad)','Buenos Aires')
    and (p.puntaje_prospecto >= 45 or p.marcado)
    and p.tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')
    and p.lat between -35.4 and -33.6 and p.lon between -59.8 and -57.6;

  -- coordenadas fuera de su zona (mal geocodificadas): lejos del centro (mediana) de la zona
  delete from _cz_cli x using (
    select vendedor, micro_zona, percentile_cont(0.5) within group (order by lat) mlat, percentile_cont(0.5) within group (order by lon) mlon
    from _cz_cli group by 1, 2) m
  where m.vendedor = x.vendedor and m.micro_zona = x.micro_zona
    and dist_m(m.mlat, m.mlon, x.lat, x.lon) > case x.area when 'CABA' then 4000 else 15000 end;

  -- zonas de otro vendedor (clientes de excepción): la cabeza la pone el vendedor con más clientes en la zona
  drop table if exists _cz_dueno;
  create temp table _cz_dueno as
  select distinct on (micro_zona) micro_zona, vendedor
  from (select micro_zona, vendedor, count(*) cnt from _cz_all where vendedor in ('Adrian','Bruno','Lola') group by 1, 2) t
  order by micro_zona, cnt desc;
  delete from _cz_cli x using _cz_dueno d where d.micro_zona = x.micro_zona and d.vendedor <> x.vendedor;
  delete from _cz_pro x using _cz_dueno d where d.micro_zona = x.micro_zona and d.vendedor <> x.vendedor;

  drop table if exists _cz_cand;
  create temp table _cz_cand as
  select vendedor, micro_zona, area, cod, 'ancla'::text motivo, case when u12 >= 12 then 1 else 4 end tier,
         (u12 * case nivel_partner when 'Premier' then 1.3 when 'Advance' then 1.2 when 'Asociado' then 1.1 else 1 end)::numeric s,
         u12 >= 12 fuerte, lat, lon
  from _cz_cli where estado = 'Activo'
  union all
  select vendedor, micro_zona, area, cod, 'recuperar', 2, prioridad_recupero::numeric, coalesce(prioridad_recupero, 0) >= 60, lat, lon
  from _cz_cli where estado <> 'Activo'
  union all
  select vendedor, micro_zona, area, cod, 'prospecto', 3, puntaje_prospecto::numeric, false, lat, lon from _cz_pro;

  for z in select c.vendedor, c.micro_zona, min(c.area) area,
                  (select count(*) from _cz_cli x where x.vendedor = c.vendedor and x.micro_zona = c.micro_zona) n_cli
           from _cz_cand c group by 1, 2 loop
    maxc := least(6, greatest(1, ceil(z.n_cli / 5.0)::int));   -- una cabeza cada 5 clientes (un día de 5 visitas)
    sep := case z.area when 'CABA' then 600 else 1000 end;
    elegidos := 0;
    for k in select * from _cz_cand c where c.vendedor = z.vendedor and c.micro_zona = z.micro_zona
             order by tier, s desc nulls last loop
      exit when elegidos >= maxc;
      if elegidos = 0 or (k.fuerte and not exists (
          select 1 from cabeza_zona e where e.vendedor = z.vendedor and e.micro_zona = z.micro_zona
            and dist_m(e.lat, e.lon, k.lat, k.lon) < sep)) then
        elegidos := elegidos + 1;
        insert into cabeza_zona (vendedor, micro_zona, area, cod_cliente, motivo, prioridad_zona, lat, lon, sector, actualizado_en)
        values (z.vendedor, z.micro_zona, z.area, k.cod, k.motivo, 0, k.lat, k.lon, elegidos, now())
        on conflict do nothing;
      end if;
    end loop;
  end loop;

  -- cada cliente y prospecto de la zona va a la cabeza más cercana: eso arma el sector y su peso
  update cabeza_zona t set prioridad_zona = x.u_juego + 20 * x.npro, n_clientes = x.ncli
  from (
    select cab, coalesce(sum(u), 0) u_juego, count(*) ncli
    from (
      select distinct on (c.cod) q.cod_cliente cab,
             case when c.estado = 'Activo' then greatest(c.u12, 0) else greatest(c.u_mejor_anio - greatest(c.u12, 0), 0) end u
      from _cz_cli c join cabeza_zona q on q.vendedor = c.vendedor and q.micro_zona = c.micro_zona
      order by c.cod, dist_m(q.lat, q.lon, c.lat, c.lon)) a
    group by cab
  ) x0
  full join (
    select cab, count(*) npro0 from (
      select distinct on (p.cod) q.cod_cliente cab
      from _cz_pro p join cabeza_zona q on q.vendedor = p.vendedor and q.micro_zona = p.micro_zona
      order by p.cod, dist_m(q.lat, q.lon, p.lat, p.lon)) b
    group by cab
  ) y0 using (cab)
  cross join lateral (select coalesce(x0.u_juego, 0) u_juego, coalesce(x0.ncli, 0) ncli, coalesce(y0.npro0, 0) npro) x
  where t.cod_cliente = cab;

  select count(*) into n from cabeza_zona;
  return n;
end $$;

-- ---------- 3) rotación diaria por cabeza ----------
create or replace function asignar_cabezas_dia(p_fecha date default null) returns setof cabeza_dia
language plpgsql security definer set search_path = public as $$
declare
  f date := coalesce(p_fecha, hoy_ar());
  v text;
  dn int;
begin
  if extract(isodow from f) > 5 then return; end if;
  begin dn := ojo_dia_num(f); exception when others then dn := null; end;
  for v in select distinct vendedor from cabeza_zona loop
    if exists (select 1 from cabeza_dia where fecha = f and vendedor = v) then continue; end if;
    insert into cabeza_dia (fecha, vendedor, cod_cliente, micro_zona, motivo)
    select f, z.vendedor, z.cod_cliente, z.micro_zona, z.motivo
    from cabeza_zona z
    -- cuánto hace que no arranca por esta cabeza (y por esta zona)
    left join lateral (select max(d.fecha) ult from cabeza_dia d where d.vendedor = z.vendedor and d.cod_cliente = z.cod_cliente and d.fecha < f) u on true
    left join lateral (select max(d.fecha) ultz from cabeza_dia d where d.vendedor = z.vendedor and d.micro_zona = z.micro_zona and d.fecha < f) uz on true
    left join lateral (
      select bool_or(lower(unaccent_simple(coalesce(a.localidad,''))) = lower(unaccent_simple(z.micro_zona))
                     or lower(unaccent_simple(coalesce(a.subzona,''))) like '%' || lower(unaccent_simple(z.micro_zona)) || '%') hay
      from agenda_campo a where a.vendedor = z.vendedor and a.dia_num = dn) ag on true
    where z.vendedor = v
      and not exists (select 1 from actividad_diaria ad where ad.cod_cliente = z.cod_cliente and ad.fecha >= f - 7
                      and ad.resultado_contacto in ('visito','vendio'))
    order by (z.prioridad_zona + 10) * least(30, coalesce(f - u.ult, 30))
             * (case when ag.hay then 3 else 1 end)
             * (case when uz.ultz >= f - 3 then 0.3 else 1 end) desc,   -- no repetir la zona en días seguidos
             z.prioridad_zona desc
    limit 1;
  end loop;
  return query select * from cabeza_dia where fecha = f;
end $$;

-- ---------- 4) contactos: los clientes del sector de la cabeza de ese día ----------
create or replace function generar_contactos_dia(p_fecha date default null, p_n int default 25) returns int
language plpgsql security definer set search_path = public as $$
declare f date := coalesce(p_fecha, hoy_ar()); n int;
begin
  if extract(isodow from f) > 5 then return 0; end if;
  insert into contactos_dia (fecha, vendedor, cod_cliente, micro_zona, fecha_visita, motivo, orden)
  with prox as (
    select vendedor, fecha fecha_visita, micro_zona, cod_cliente cabeza,
           row_number() over (partition by vendedor order by fecha) k
    from cabeza_dia where fecha > f and fecha <= f + 10),
  prox5 as (select * from prox where k <= 5),
  ya as (select vendedor from contactos_dia where fecha = f group by 1),
  pros as materialized (select cod, puntaje_prospecto from v_prospectos_comercial
           where (puntaje_prospecto >= 25 or marcado)
             and tipo_oportunidad not in ('Excluir (ficha administrativa)','Sucursal de cuenta existente')),
  cand as (
    select p.vendedor, p.fecha_visita, p.micro_zona, v.cod,
      case when v.estado in ('En caída','Perdido reciente','Perdido') then 'recuperar'
           when v.estado = 'Activo' then 'activo'
           when pr.cod is not null then 'prospecto' else 'sin compras' end motivo,
      case when v.estado in ('En caída','Perdido reciente','Perdido') then coalesce(v.prioridad_recupero, 30) + 10
           when v.estado = 'Activo' then 40
           when pr.cod is not null then pr.puntaje_prospecto
           else 5 end pts
    from prox5 p
    join v_clasif_comercial v on v.vendedor = p.vendedor and v.micro_zona = p.micro_zona and v.cod <> p.cabeza
    join clientes c on c.cod = v.cod
    left join pros pr on pr.cod = v.cod
    where p.vendedor not in (select vendedor from ya)
      and nullif(regexp_replace(coalesce(c.whatsapp, c.telefono, ''), '\D', '', 'g'), '') is not null
      and v.estado <> 'Histórico'
      -- zona con varias cabezas: solo los del sector de la cabeza de ese día (la más cercana)
      and (c.lat is null or p.cabeza = (
            select z.cod_cliente from cabeza_zona z where z.vendedor = p.vendedor and z.micro_zona = p.micro_zona
            order by dist_m(z.lat, z.lon, c.lat::float8, c.lon::float8) limit 1))
      and not exists (select 1 from actividad_diaria a where a.cod_cliente = v.cod and a.fecha >= f - 14)
      and not exists (select 1 from contactos_dia cd where cd.cod_cliente = v.cod and cd.fecha >= f - 21)),
  rk as (select *, row_number() over (partition by vendedor, fecha_visita order by pts desc) rn from cand),
  sel as (select *, row_number() over (partition by vendedor order by (rn > 8), fecha_visita, rn) ord from rk)
  select f, vendedor, cod, micro_zona, fecha_visita, motivo, ord from sel where ord <= p_n
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 5) panel Zonas: todas las cabezas, seguimiento diario y lectura de cada PDV ----------
-- (definición en panel_zonas_pdv.sql)

revoke all on function recalcular_cabezas_zona(), asignar_cabezas_dia(date), generar_contactos_dia(date, int) from public, anon, authenticated;
