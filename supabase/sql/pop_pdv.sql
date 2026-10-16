-- Material POP en la calle + análisis de puntos de venta + material especial en cabezas de zona (16/10/2026).
--
-- 1) Cada vendedor de campo lleva stock de POP para resolver la exhibición en la visita SIN compra:
--    Kit Exhibición (tiene Orbital pero no exhibidor) y Kit Presencia (no tiene Orbital). Meta: 5 POP por día
--    por vendedor. El check-in ofrece el kit según lo que lee la foto y descuenta el stock al instalarlo.
-- 2) panel_pdv(): para el administrador — visitas por vendedor contra el objetivo (5/día), contactos (25/día),
--    cada punto de venta con su foto y lectura (Orbital, exhibidor, marcas, participación), stock de POP y
--    materiales especiales.
-- 3) pdp_especial: cabezas de zona elegidas para material especial a medida (vidriera, vinilo, banner).

-- ---------- 1) material POP ----------
create table if not exists pop_material (
  codigo text primary key,
  nombre text not null,
  descripcion text,
  unidad text not null default 'unidad',
  activo boolean not null default true
);
insert into pop_material (codigo, nombre, descripcion, unidad) values
  ('EXH-MOST', 'Exhibidor de mostrador Orbital', 'Exhibidor de mostrador de 6 posiciones con cartel de marca (acrílico o MDF), armable en el momento', 'unidad'),
  ('STK-VEND', 'Sticker de vidriera "Vendemos Orbital"', 'Vinilo autoadhesivo para vidrio, aprox. 15 x 15 cm', 'unidad'),
  ('FOL-TP', 'Folleto Triple Protección', 'Folleto A5 a color: Blue Cut + infrarrojo + UV', 'unidad'),
  ('DSP-CHICO', 'Display de mostrador chico', 'Display de cartón o acrílico tipo atril con gráfica Triple Protección', 'unidad')
on conflict (codigo) do nothing;

create table if not exists pop_kit (
  kit text not null,                  -- EXHIBICION | PRESENCIA
  material text not null references pop_material(codigo),
  cantidad int not null,
  primary key (kit, material)
);
insert into pop_kit values
  ('EXHIBICION', 'EXH-MOST', 1), ('EXHIBICION', 'STK-VEND', 1), ('EXHIBICION', 'FOL-TP', 10),
  ('PRESENCIA', 'STK-VEND', 1), ('PRESENCIA', 'FOL-TP', 20), ('PRESENCIA', 'DSP-CHICO', 1)
on conflict do nothing;

-- Movimientos de stock por vendedor: + carga / reposición, − instalado en un punto de venta.
create table if not exists pop_stock_mov (
  id bigserial primary key,
  creado_en timestamptz not null default now(),
  vendedor text not null,
  material text not null references pop_material(codigo),
  cantidad int not null,
  motivo text not null check (motivo in ('carga','reposicion','instalado','ajuste')),
  kit text,
  cod_cliente text,
  checkin_id bigint,
  creado_por text
);
create index if not exists pop_stock_mov_vend on pop_stock_mov (vendedor, material);

create or replace view v_pop_stock as
select v.vendedor, m.codigo material, m.nombre, coalesce(sum(s.cantidad), 0)::int saldo
from (select unnest(array['Lola','Bruno','Adrian']) vendedor) v
cross join pop_material m
left join pop_stock_mov s on s.vendedor = v.vendedor and s.material = m.codigo
where m.activo
group by 1, 2, 3;

-- Kits que todavía puede armar cada vendedor con lo que tiene.
create or replace function pop_kits_disponibles(p_vendedor text, p_kit text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(min(floor(coalesce(s.saldo, 0)::numeric / k.cantidad))::int, 0)
  from pop_kit k left join v_pop_stock s on s.material = k.material and s.vendedor = p_vendedor
  where k.kit = p_kit $$;

-- Instalar un kit en un punto de venta: descuenta el stock y sube el nivel de POP del cliente.
create or replace function pop_instalar(p_vendedor text, p_cod text, p_kit text, p_checkin bigint default null) returns int
language plpgsql security definer set search_path = public as $$
begin
  if p_kit not in ('EXHIBICION','PRESENCIA') then raise exception 'kit inválido'; end if;
  insert into pop_stock_mov (vendedor, material, cantidad, motivo, kit, cod_cliente, checkin_id, creado_por)
  select p_vendedor, material, -cantidad, 'instalado', p_kit, p_cod, p_checkin, p_vendedor from pop_kit where kit = p_kit;
  update clientes set pop_nivel = greatest(coalesce(pop_nivel, 0), case p_kit when 'EXHIBICION' then 2 else 1 end),
                      actualizado_en = now()
  where cod = p_cod;
  return pop_kits_disponibles(p_vendedor, p_kit);
end $$;

-- ---------- 3) material especial en cabezas de zona ----------
create table if not exists pdp_especial (
  cod_cliente text primary key,
  vendedor text,
  micro_zona text,
  tipo_sugerido text,                 -- vidriera completa / vinilo / banner / display iluminado / relevar
  motivo text,
  estado text not null default 'relevar' check (estado in ('relevar','diseño','producción','instalado','descartado')),
  medidas text,
  foto_url text,
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);

-- Elige las cabezas para material especial: anclas con volumen (top 6 por vendedor) y lo que dice la foto.
create or replace function elegir_pdp_especial(p_por_vendedor int default 6) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into pdp_especial (cod_cliente, vendedor, micro_zona, tipo_sugerido, motivo)
  select x.cod_cliente, x.vendedor, x.micro_zona,
    case when c.vidriera_analisis is null then 'relevar (sin foto todavía)'
         when c.vidriera_analisis->>'espacio_vidriera' = 'alto' then 'vidriera completa / vinilo de marca'
         when c.vidriera_analisis->>'espacio_vidriera' = 'medio' then 'display iluminado de vidriera + banner'
         else 'banner de mostrador / roll-up' end,
    'Cabeza de zona de ' || x.micro_zona || ' · ' || x.u12 || ' u en 12 meses'
  from (
    select z.*, round(v.u12) u12, row_number() over (partition by z.vendedor order by v.u12 desc) rk
    from cabeza_zona z join v_clasif_comercial v on v.cod = z.cod_cliente
    where z.motivo = 'ancla') x
  join clientes c on c.cod = x.cod_cliente
  where x.rk <= p_por_vendedor
  on conflict (cod_cliente) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- permisos ----------
revoke all on pop_material, pop_kit, pop_stock_mov, v_pop_stock, pdp_especial from anon, authenticated;
alter table pop_material enable row level security;
alter table pop_kit enable row level security;
alter table pop_stock_mov enable row level security;
alter table pdp_especial enable row level security;
revoke all on function pop_kits_disponibles(text, text), pop_instalar(text, text, text, bigint), elegir_pdp_especial(int)
  from public, anon, authenticated;

-- ---------- ficha de la óptica: nivel POP y material especial pendiente ----------
create or replace function ficha_optica(p_cod text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'cod', c.cod,
    'nombre', coalesce(nullif(trim(c.nomcomerc), ''), c.razon),
    'direccion', c.direccion, 'localidad', c.localidad, 'barrio', c.barrio,
    'contacto', c.contacto, 'tel', coalesce(c.whatsapp, c.telefono),
    'horario', c.horario_entrega,
    'estado', v.estado, 'nivel_partner', v.nivel_partner,
    'u12', v.u12, 'u_prev12', v.u_prev12, 'u_mejor_anio', v.u_mejor_anio, 'ult_mes', v.ult_mes,
    'tiene_orbital', c.tiene_orbital,
    'vidriera', c.vidriera_analisis -> 'observaciones',
    'modelos', (select json_agg(m) from (select modelo, sum(unidades) u from ventas_hist_cliente_modelo
                where cod_cliente = c.cod and modelo !~* '(caja|packaging|franela|repuesto|ajuste|estuche|display|exhibidor|bolsa|tanka|cord[oó]n|pa[nñ]o|l[ií]quido|kit|cartel)' and anio >= extract(year from now())::int - 2 group by 1 order by 2 desc limit 4) m),
    'ultima_actividad', (select json_build_object('fecha', a.fecha, 'resultado', a.resultado_contacto,
                           'nota', left(coalesce(a.actividad_futura, a.voz_cliente_nota, a.actividad_desarrollo), 160))
                         from actividad_diaria a where a.cod_cliente = c.cod order by a.fecha desc, a.id desc limit 1),
    'catalogo_30d', (select json_build_object('visitas', count(*), 'ultima', max(cv.created_at)::date)
                     from catalogo_visitas cv where cv.cod_cliente = c.cod and cv.created_at >= now() - interval '30 days'),
    'catalogo_min_30d', (select round(coalesce(sum(cs.segundos), 0) / 60.0) from catalogo_sesion cs
                         where cs.cod_cliente = c.cod and cs.iniciada_at >= now() - interval '30 days'),
    'accion_pendiente', (select json_build_object('fecha', s.fecha_programada, 'titulo', s.titulo, 'temperatura', s.temperatura)
                         from acciones_seguimiento s where s.cod_cliente = c.cod and s.estado = 'pendiente' limit 1),
    'pop_nivel', c.pop_nivel,
    'pdp_especial', (select json_build_object('tipo', e.tipo_sugerido, 'estado', e.estado) from pdp_especial e
                     where e.cod_cliente = c.cod and e.estado not in ('instalado','descartado')),
    'que_ofrecer', case
       when v.estado = 'Activo' then 'Reposición + lanzamientos del mes. Revisar exhibición (POP) y Plan Canje.'
       when v.estado = 'En caída' then 'Plan Canje y condición del mes para volver a su volumen. Preguntar qué cambió.'
       when v.estado in ('Perdido reciente','Perdido') then 'Reenganche: novedades y condición de vuelta. Preguntar por qué dejó.'
       else 'Paquete de Bienvenida: presentación de marca, catálogo con clave y condición de primera compra.' end
  )
  from clientes c left join v_clasif_comercial v using (cod)
  where c.cod = p_cod $$;

-- ---------- 2) panel de puntos de venta (administración) ----------
create or replace function panel_pdv(p_desde date default null, p_hasta date default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare d1 date := coalesce(p_desde, hoy_ar() - 30); d2 date := coalesce(p_hasta, hoy_ar());
begin
  if not (current_is_admin() or current_vendedor_rol() = 'administracion') then raise exception 'solo administración'; end if;
  return json_build_object(
    'desde', d1, 'hasta', d2,
    'dias_habiles', (select count(*) from generate_series(d1, d2, interval '1 day') g where extract(isodow from g) <= 5),
    -- visitas reales: check-ins confirmados (una por óptica por día) + visitas cargadas en la agenda
    'visitas', coalesce((select json_agg(x) from (
        select vendedor, fecha, count(distinct cod_cliente) visitas from (
          select vendedor, (creado_en at time zone 'America/Argentina/Buenos_Aires')::date fecha, cod_cliente
          from visitas_checkin where estado = 'confirmado' and cod_cliente is not null
          union
          select vendedor, fecha, cod_cliente from actividad_diaria
          where origen in ('checkin','agenda_campo') and resultado_contacto in ('visito','vendio','cmp','cat','pie','no_interesa')
        ) v where fecha between d1 and d2 and vendedor in ('Adrian','Bruno','Lola') group by 1, 2 order by 1, 2) x), '[]'::json),
    'contactos', coalesce((select json_agg(x) from (
        select vendedor, fecha, count(*) filter (where estado <> 'pendiente') hechos, count(*) filter (where estado = 'agendado') agendados, count(*) total
        from contactos_dia where fecha between d1 and d2 group by 1, 2 order by 1, 2) x), '[]'::json),
    'pdv', coalesce((select json_agg(x order by x.fecha desc) from (
        select distinct on (k.cod_cliente) k.id, (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date fecha, k.vendedor, k.cod_cliente cod,
          coalesce(nullif(trim(c.nomcomerc), ''), c.razon) nombre, coalesce(c.barrio, c.localidad) zona, k.foto_url,
          (k.analisis->>'tiene_orbital')::boolean tiene_orbital,
          (k.analisis->>'tiene_exhibidor_orbital')::boolean tiene_exhibidor,
          k.analisis->'marcas_visibles' marcas, k.analisis->'participacion' participacion,
          k.analisis->>'espacio_vidriera' espacio_vidriera, k.analisis->>'nivel_local' nivel_local,
          k.analisis->>'observaciones' observaciones, k.pop_sugerido,
          (select string_agg(distinct m.kit, ', ') from pop_stock_mov m where m.cod_cliente = k.cod_cliente and m.motivo = 'instalado') kit_instalado
        from visitas_checkin k join clientes c on c.cod = k.cod_cliente
        where k.estado = 'confirmado' and k.analisis is not null
          and (k.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2
        order by k.cod_cliente, k.creado_en desc) x), '[]'::json),
    'stock', coalesce((select json_agg(x) from (
        select s.vendedor, s.material, s.nombre, s.saldo from v_pop_stock s order by 1, 2) x), '[]'::json),
    'kits', coalesce((select json_agg(x) from (
        select v vendedor, pop_kits_disponibles(v, 'EXHIBICION') exhibicion, pop_kits_disponibles(v, 'PRESENCIA') presencia,
          (select count(*) from pop_stock_mov m where m.vendedor = v and m.motivo = 'instalado' and m.material in ('EXH-MOST','STK-VEND')
             and (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between d1 and d2) instalados
        from unnest(array['Lola','Bruno','Adrian']) v) x), '[]'::json),
    'especiales', coalesce((select json_agg(x order by x.vendedor, x.zona) from (
        select e.cod_cliente cod, e.vendedor, e.micro_zona zona, e.tipo_sugerido, e.estado, e.motivo, e.medidas,
          coalesce(nullif(trim(c.nomcomerc), ''), c.razon) nombre, c.direccion, c.foto_vidriera_url foto_url
        from pdp_especial e join clientes c on c.cod = e.cod_cliente) x), '[]'::json)
  );
end $$;

create or replace function pdp_especial_estado(p_cod text, p_estado text, p_medidas text default null, p_notas text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (current_is_admin() or current_vendedor_rol() = 'administracion') then raise exception 'solo administración'; end if;
  update pdp_especial set estado = p_estado, medidas = coalesce(p_medidas, medidas), notas = coalesce(p_notas, notas), actualizado_en = now()
  where cod_cliente = p_cod;
end $$;

-- Carga / reposición / ajuste de stock POP por vendedor (cuando llega la orden de compra).
create or replace function pop_cargar(p_vendedor text, p_material text, p_cantidad int, p_motivo text default 'carga') returns int
language plpgsql security definer set search_path = public as $$
declare s int;
begin
  if not (current_is_admin() or current_vendedor_rol() = 'administracion') then raise exception 'solo administración'; end if;
  if p_vendedor not in ('Lola','Bruno','Adrian') then raise exception 'vendedor inválido'; end if;
  if p_motivo not in ('carga','reposicion','ajuste') then raise exception 'motivo inválido'; end if;
  insert into pop_stock_mov (vendedor, material, cantidad, motivo, creado_por)
  values (p_vendedor, p_material, p_cantidad, p_motivo, coalesce(current_vendedor_codigo(), 'admin'));
  select saldo into s from v_pop_stock where vendedor = p_vendedor and material = p_material;
  return s;
end $$;
revoke all on function pop_cargar(text, text, int, text) from public, anon;
grant execute on function pop_cargar(text, text, int, text) to authenticated;

revoke all on function panel_pdv(date, date), pdp_especial_estado(text, text, text, text) from public, anon;
grant execute on function panel_pdv(date, date), pdp_especial_estado(text, text, text, text) to authenticated;
