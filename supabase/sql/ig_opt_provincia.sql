-- Ópticas IG: provincia deducida de nombre, @ y bio (no traen ciudad ni dirección).
-- Orden: cliente vinculado → palabras clave (barrios, partidos, ciudades, provincias) →
-- característica telefónica de la bio → localidades de nuestra base. Sin coincidencia queda null.
-- Se puede corregir a mano desde la bandeja (ig_opt_set_provincia).

alter table ig_opticas add column if not exists provincia text;
alter table ig_opticas add column if not exists provincia_manual boolean not null default false;

create or replace function ig_opt_norm(t text) returns text language sql immutable set search_path to 'public' as $$
  select ' ' || regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g') || ' '
$$;

create or replace function ig_opt_detectar_provincia(p_usuario text, p_nombre text, p_bio text)
returns text language plpgsql stable set search_path to 'public' as $$
declare
  t text := ig_opt_norm(coalesce(p_nombre,'') || ' ' || coalesce(p_bio,''));
  u text := lower(coalesce(p_usuario,''));
  r record; m text[]; d text;
begin
  -- calles con nombre de provincia o barrio («Av. Corrientes», «Av. Santa Fe»): se saca la palabra que sigue
  t := regexp_replace(t, ' (esq|esquina) [a-z]+', ' ', 'g');
  t := regexp_replace(t, ' (av|avda|avenida|calle|pasaje|bv|bulevar) [a-z]+(?= [0-9])', ' ', 'g');
  -- 1) palabras clave, de lo más específico a lo más general
  --    (seguidas de un número de 1 a 4 cifras son una calle y no cuentan; un teléfono sí)
  for r in select * from (values
    -- extranjero
    (' texas ', 'Exterior'), (' montevideo ', 'Exterior'), (' asuncion paraguay ', 'Exterior'), (' bogota ', 'Exterior'),
    (' madrid espana ', 'Exterior'), (' santo domingo ', 'Exterior'), (' eye clinic ', 'Exterior'), (' od ', 'Exterior'), (' optometrist ', 'Exterior'),
    (' miami ', 'Exterior'), (' eye exam ', 'Exterior'), (' eye exams ', 'Exterior'), (' eyeglasses ', 'Exterior'), (' eye care ', 'Exterior'),
    (' madariaga ', 'Buenos Aires'), (' rio tercero ', 'Córdoba'), (' sunchales ', 'Santa Fe'), (' perico ', 'Jujuy'), (' san pedro de jujuy ', 'Jujuy'),
    -- CABA
    (' caba ', 'CABA'), (' capital federal ', 'CABA'), (' ciudad autonoma ', 'CABA'), (' palermo ', 'CABA'), (' belgrano ', 'CABA'),
    (' recoleta ', 'CABA'), (' caballito ', 'CABA'), (' flores ', 'CABA'), (' floresta ', 'CABA'), (' almagro ', 'CABA'), (' boedo ', 'CABA'),
    (' villa urquiza ', 'CABA'), (' urquiza ', 'CABA'), (' villa devoto ', 'CABA'), (' devoto ', 'CABA'), (' villa del parque ', 'CABA'),
    (' villa crespo ', 'CABA'), (' villa santa rita ', 'CABA'), (' villa pueyrredon ', 'CABA'), (' villa luro ', 'CABA'), (' monte castro ', 'CABA'),
    (' liniers ', 'CABA'), (' mataderos ', 'CABA'), (' nunez ', 'CABA'), (' saavedra ', 'CABA'), (' colegiales ', 'CABA'), (' chacarita ', 'CABA'),
    (' san telmo ', 'CABA'), (' barracas ', 'CABA'), (' la boca ', 'CABA'), (' microcentro ', 'CABA'), (' obelisco ', 'CABA'), (' congreso ', 'CABA'),
    (' once ', 'CABA'), (' balvanera ', 'CABA'), (' san cristobal ', 'CABA'), (' parque patricios ', 'CABA'), (' pompeya ', 'CABA'),
    (' parque chacabuco ', 'CABA'), (' villa lugano ', 'CABA'), (' lugano ', 'CABA'), (' agronomia ', 'CABA'), (' coghlan ', 'CABA'),
    (' villa ortuzar ', 'CABA'), (' paternal ', 'CABA'), (' velez sarsfield ', 'CABA'), (' versalles ', 'CABA'), (' puerto madero ', 'CABA'),
    (' retiro ', 'CABA'), (' parque avellaneda ', 'CABA'), (' villa general mitre ', 'CABA'), (' cdad de bs as ', 'CABA'),
    -- provincias por nombre y capitales/ciudades (antes que GBA para que «San Martín, Mendoza» gane Mendoza)
    (' mendoza ', 'Mendoza'), (' godoy cruz ', 'Mendoza'), (' guaymallen ', 'Mendoza'), (' maipu mendoza ', 'Mendoza'), (' lujan de cuyo ', 'Mendoza'),
    (' san rafael ', 'Mendoza'), (' tunuyan ', 'Mendoza'), (' las heras mendoza ', 'Mendoza'),
    (' cordoba ', 'Córdoba'), (' rio cuarto ', 'Córdoba'), (' villa maria ', 'Córdoba'), (' villa carlos paz ', 'Córdoba'), (' carlos paz ', 'Córdoba'),
    (' san francisco cordoba ', 'Córdoba'), (' alta gracia ', 'Córdoba'), (' jesus maria ', 'Córdoba'), (' bell ville ', 'Córdoba'),
    (' santa fe ', 'Santa Fe'), (' rosario ', 'Santa Fe'), (' rafaela ', 'Santa Fe'), (' reconquista ', 'Santa Fe'), (' venado tuerto ', 'Santa Fe'),
    (' firmat ', 'Santa Fe'), (' villa constitucion ', 'Santa Fe'), (' funes ', 'Santa Fe'), (' san lorenzo ', 'Santa Fe'), (' casilda ', 'Santa Fe'),
    (' esperanza ', 'Santa Fe'), (' canada de gomez ', 'Santa Fe'), (' san jorge ', 'Santa Fe'),
    (' entre rios ', 'Entre Ríos'), (' parana ', 'Entre Ríos'), (' concordia ', 'Entre Ríos'), (' gualeguaychu ', 'Entre Ríos'),
    (' concepcion del uruguay ', 'Entre Ríos'), (' nogoya ', 'Entre Ríos'), (' victoria entre rios ', 'Entre Ríos'), (' villaguay ', 'Entre Ríos'),
    (' chaco ', 'Chaco'), (' resistencia ', 'Chaco'), (' rcia ', 'Chaco'), (' saenz pena ', 'Chaco'), (' las brenas ', 'Chaco'), (' villa angela ', 'Chaco'),
    (' misiones ', 'Misiones'), (' posadas ', 'Misiones'), (' obera ', 'Misiones'), (' eldorado ', 'Misiones'), (' puerto iguazu ', 'Misiones'),
    (' corrientes ', 'Corrientes'), (' goya ', 'Corrientes'), (' paso de los libres ', 'Corrientes'),
    (' formosa ', 'Formosa'),
    (' salta ', 'Salta'), (' tartagal ', 'Salta'), (' oran ', 'Salta'),
    (' jujuy ', 'Jujuy'), (' san salvador de jujuy ', 'Jujuy'), (' palpala ', 'Jujuy'),
    (' tucuman ', 'Tucumán'), (' yerba buena ', 'Tucumán'), (' concepcion tucuman ', 'Tucumán'),
    (' santiago del estero ', 'Santiago del Estero'), (' la banda ', 'Santiago del Estero'), (' termas de rio hondo ', 'Santiago del Estero'),
    (' catamarca ', 'Catamarca'),
    (' la rioja ', 'La Rioja'), (' chilecito ', 'La Rioja'),
    (' san juan ', 'San Juan'), (' rawson san juan ', 'San Juan'),
    (' san luis ', 'San Luis'), (' villa mercedes ', 'San Luis'), (' merlo san luis ', 'San Luis'),
    (' neuquen ', 'Neuquén'), (' cipolletti ', 'Río Negro'), (' rio negro ', 'Río Negro'), (' bariloche ', 'Río Negro'), (' general roca ', 'Río Negro'),
    (' viedma ', 'Río Negro'), (' chubut ', 'Chubut'), (' comodoro ', 'Chubut'), (' trelew ', 'Chubut'), (' puerto madryn ', 'Chubut'),
    (' la pampa ', 'La Pampa'), (' santa rosa la pampa ', 'La Pampa'), (' general pico ', 'La Pampa'),
    (' santa cruz ', 'Santa Cruz'), (' rio gallegos ', 'Santa Cruz'), (' caleta olivia ', 'Santa Cruz'),
    (' tierra del fuego ', 'Tierra del Fuego'), (' ushuaia ', 'Tierra del Fuego'), (' rio grande ', 'Tierra del Fuego'),
    -- provincia de Buenos Aires (GBA e interior)
    (' provincia de buenos aires ', 'Buenos Aires'), (' pcia de buenos aires ', 'Buenos Aires'), (' pba ', 'Buenos Aires'),
    (' la plata ', 'Buenos Aires'), (' mar del plata ', 'Buenos Aires'), (' bahia blanca ', 'Buenos Aires'), (' tandil ', 'Buenos Aires'),
    (' olavarria ', 'Buenos Aires'), (' necochea ', 'Buenos Aires'), (' junin ', 'Buenos Aires'), (' pergamino ', 'Buenos Aires'),
    (' san nicolas ', 'Buenos Aires'), (' zarate ', 'Buenos Aires'), (' campana ', 'Buenos Aires'), (' lujan ', 'Buenos Aires'),
    (' chivilcoy ', 'Buenos Aires'), (' mercedes ', 'Buenos Aires'), (' azul ', 'Buenos Aires'), (' bolivar ', 'Buenos Aires'),
    (' san pedro ', 'Buenos Aires'), (' san antonio de areco ', 'Buenos Aires'), (' chacabuco ', 'Buenos Aires'), (' 9 de julio ', 'Buenos Aires'),
    (' trenque lauquen ', 'Buenos Aires'), (' tres arroyos ', 'Buenos Aires'), (' coronel suarez ', 'Buenos Aires'), (' lincoln ', 'Buenos Aires'),
    (' san miguel del monte ', 'Buenos Aires'), (' canuelas ', 'Buenos Aires'), (' lobos ', 'Buenos Aires'), (' ramallo ', 'Buenos Aires'),
    (' moron ', 'Buenos Aires'), (' palomar ', 'Buenos Aires'), (' haedo ', 'Buenos Aires'), (' castelar ', 'Buenos Aires'), (' ituzaingo ', 'Buenos Aires'),
    (' ramos mejia ', 'Buenos Aires'), (' san justo ', 'Buenos Aires'), (' la matanza ', 'Buenos Aires'), (' laferrere ', 'Buenos Aires'),
    (' gonzalez catan ', 'Buenos Aires'), (' merlo ', 'Buenos Aires'), (' padua ', 'Buenos Aires'), (' moreno ', 'Buenos Aires'),
    (' general rodriguez ', 'Buenos Aires'), (' marcos paz ', 'Buenos Aires'), (' ciudadela ', 'Buenos Aires'), (' caseros ', 'Buenos Aires'),
    (' tres de febrero ', 'Buenos Aires'), (' santos lugares ', 'Buenos Aires'), (' villa bosch ', 'Buenos Aires'),
    (' san martin ', 'Buenos Aires'), (' villa ballester ', 'Buenos Aires'), (' san andres ', 'Buenos Aires'),
    (' vicente lopez ', 'Buenos Aires'), (' olivos ', 'Buenos Aires'), (' florida ', 'Buenos Aires'), (' munro ', 'Buenos Aires'),
    (' villa adelina ', 'Buenos Aires'), (' boulogne ', 'Buenos Aires'), (' san isidro ', 'Buenos Aires'), (' martinez ', 'Buenos Aires'),
    (' beccar ', 'Buenos Aires'), (' san fernando ', 'Buenos Aires'), (' tigre ', 'Buenos Aires'), (' nordelta ', 'Buenos Aires'),
    (' pacheco ', 'Buenos Aires'), (' don torcuato ', 'Buenos Aires'), (' escobar ', 'Buenos Aires'), (' garin ', 'Buenos Aires'),
    (' pilar ', 'Buenos Aires'), (' del viso ', 'Buenos Aires'), (' san miguel ', 'Buenos Aires'), (' bella vista ', 'Buenos Aires'),
    (' jose c paz ', 'Buenos Aires'), (' malvinas argentinas ', 'Buenos Aires'), (' grand bourg ', 'Buenos Aires'), (' polvorines ', 'Buenos Aires'),
    (' avellaneda ', 'Buenos Aires'), (' sarandi ', 'Buenos Aires'), (' wilde ', 'Buenos Aires'), (' lanus ', 'Buenos Aires'),
    (' lomas de zamora ', 'Buenos Aires'), (' banfield ', 'Buenos Aires'), (' temperley ', 'Buenos Aires'), (' adrogue ', 'Buenos Aires'),
    (' burzaco ', 'Buenos Aires'), (' longchamps ', 'Buenos Aires'), (' monte grande ', 'Buenos Aires'), (' ezeiza ', 'Buenos Aires'),
    (' quilmes ', 'Buenos Aires'), (' bernal ', 'Buenos Aires'), (' berazategui ', 'Buenos Aires'), (' florencio varela ', 'Buenos Aires'),
    (' rafael calzada ', 'Buenos Aires'), (' claypole ', 'Buenos Aires'), (' glew ', 'Buenos Aires'), (' ensenada ', 'Buenos Aires'),
    (' berisso ', 'Buenos Aires'), (' city bell ', 'Buenos Aires'), (' gonnet ', 'Buenos Aires'), (' zona oeste ', 'Buenos Aires'),
    (' zona norte ', 'Buenos Aires'), (' zona sur ', 'Buenos Aires'), (' gba ', 'Buenos Aires'),
    (' buenos aires ', 'Buenos Aires'), (' bs as ', 'Buenos Aires')
  ) v(k, p) loop
    if t ~ (rtrim(r.k) || ' (?![0-9]{1,4} (?![0-9]))') then return r.p; end if;
  end loop;

  -- 2) característica telefónica (sin el 11 porque puede ser CABA o GBA)
  for m in select regexp_matches(coalesce(p_bio,''), '(\+?\d[\d\s\-\.\(\)]{8,}\d)', 'g') loop
    d := regexp_replace(m[1], '\D', '', 'g');
    d := regexp_replace(d, '^(54)?9?0?', '');
    if length(d) < 10 then continue; end if;
    select p into r from (values
      -- excepciones de 4 cifras (ganan por ser más largas)
      ('2302','La Pampa'),('2331','La Pampa'),('2333','La Pampa'),('2334','La Pampa'),('2335','La Pampa'),('2338','La Pampa'),
      ('2901','Tierra del Fuego'),('2964','Tierra del Fuego'),('2902','Santa Cruz'),('2903','Chubut'),('2920','Río Negro'),
      ('2934','Río Negro'),('2940','Río Negro'),('2945','Chubut'),('2948','Neuquén'),('2972','Neuquén'),('2942','Neuquén'),
      ('3487','Buenos Aires'),('3488','Buenos Aires'),('3489','Buenos Aires'),('3711','Formosa'),('3715','Chaco'),('3716','Formosa'),
      ('3721','Chaco'),('3825','La Rioja'),('3826','La Rioja'),('3827','La Rioja'),
      -- por 3 cifras
      ('220','Buenos Aires'),('221','Buenos Aires'),('222','Buenos Aires'),('223','Buenos Aires'),('224','Buenos Aires'),('225','Buenos Aires'),
      ('226','Buenos Aires'),('227','Buenos Aires'),('228','Buenos Aires'),('229','Buenos Aires'),('230','Buenos Aires'),('231','Buenos Aires'),
      ('232','Buenos Aires'),('233','Buenos Aires'),('234','Buenos Aires'),('235','Buenos Aires'),('236','Buenos Aires'),('237','Buenos Aires'),
      ('239','Buenos Aires'),('240','Buenos Aires'),('241','Buenos Aires'),('242','Buenos Aires'),('243','Buenos Aires'),('244','Buenos Aires'),
      ('245','Buenos Aires'),('246','Buenos Aires'),('247','Buenos Aires'),('248','Buenos Aires'),('249','Buenos Aires'),
      ('260','Mendoza'),('261','Mendoza'),('262','Mendoza'),('263','Mendoza'),('264','San Juan'),('265','San Luis'),('266','San Luis'),
      ('280','Chubut'),('291','Buenos Aires'),('292','Buenos Aires'),('294','Río Negro'),('295','La Pampa'),('296','Santa Cruz'),
      ('297','Chubut'),('298','Río Negro'),('299','Neuquén'),
      ('340','Santa Fe'),('341','Santa Fe'),('342','Santa Fe'),('343','Entre Ríos'),('344','Entre Ríos'),('345','Entre Ríos'),
      ('346','Santa Fe'),('347','Santa Fe'),('348','Santa Fe'),('349','Santa Fe'),
      ('351','Córdoba'),('352','Córdoba'),('353','Córdoba'),('354','Córdoba'),('355','Córdoba'),('356','Córdoba'),('357','Córdoba'),('358','Córdoba'),
      ('362','Chaco'),('364','Chaco'),('370','Formosa'),('371','Formosa'),('372','Chaco'),('373','Chaco'),('374','Misiones'),('375','Misiones'),
      ('376','Misiones'),('377','Corrientes'),('378','Corrientes'),('379','Corrientes'),
      ('380','La Rioja'),('381','Tucumán'),('382','La Rioja'),('383','Catamarca'),('384','Santiago del Estero'),('385','Santiago del Estero'),
      ('386','Tucumán'),('387','Salta'),('388','Jujuy')
    ) v(c, p) where d like c || '%' order by length(c) desc limit 1;
    if found then return r.p; end if;
  end loop;

  -- 3) localidades de nuestra base (solo nombres de 6+ letras con una única provincia)
  select q.p into r from (
    select ig_opt_norm(localidad) l, min(ig_opt_prov_base(provincia)) p
    from clientes where provincia is not null and provincia !~* '^(exterior|moron|coronel pringles)$' and length(localidad) >= 6
    group by 1 having count(distinct ig_opt_prov_base(provincia)) = 1
  ) q where t ~ (rtrim(q.l) || ' (?![0-9]{1,4} (?![0-9]))') order by length(q.l) desc limit 1;
  if found then return r.p; end if;

  -- 4) el @ a veces trae la ciudad (opticasalta, optica.cristina.catamarca)
  for r in select * from (values ('catamarca','Catamarca'),('salta','Salta'),('jujuy','Jujuy'),('tucuman','Tucumán'),('mendoza','Mendoza'),
    ('cordoba','Córdoba'),('rosario','Santa Fe'),('neuquen','Neuquén'),('corrientes','Corrientes'),('misiones','Misiones'),('posadas','Misiones'),
    ('chaco','Chaco'),('formosa','Formosa'),('sanjuan','San Juan'),('sanluis','San Luis'),('larioja','La Rioja'),('chilecito','La Rioja'),
    ('bariloche','Río Negro'),('mardelplata','Buenos Aires'),('laplata','Buenos Aires'),('bahiablanca','Buenos Aires'),('caba','CABA'),
    ('palermo','CABA'),('belgrano','CABA'),('caballito','CABA'),('sanmiguel','Buenos Aires'),('pilar','Buenos Aires'),('tigre','Buenos Aires'),
    ('moron','Buenos Aires'),('quilmes','Buenos Aires'),('lanus','Buenos Aires'),('lomas','Buenos Aires'),('merlo','Buenos Aires'),
    ('lincoln','Buenos Aires'),('sgo','Santiago del Estero'),('tucu','Tucumán'),('mza','Mendoza'),('cba','Córdoba')) v(k, p) loop
    if position(r.k in regexp_replace(u, '[^a-z]', '', 'g')) > 0 then return r.p; end if;
  end loop;
  return null;
end $$;

-- Normaliza el nombre de provincia de la base para que coincida con los de arriba
create or replace function ig_opt_prov_base(p text) returns text language sql immutable set search_path to 'public' as $$
  select case when p is null then null when p ilike 'ciudad aut%' or p ilike 'caba' then 'CABA'
    when lower(unaccent(p)) = 'buenos aires' then 'Buenos Aires' when p ilike 'exterior' then 'Exterior'
    when lower(unaccent(p)) in ('entre rios','cordoba','tucuman','neuquen','rio negro') then
      (array['Entre Ríos','Córdoba','Tucumán','Neuquén','Río Negro'])[array_position(array['entre rios','cordoba','tucuman','neuquen','rio negro'], lower(unaccent(p)))]
    else initcap(p) end
$$;

create or replace function ig_opt_recalcular_provincias() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update ig_opticas o set provincia = coalesce(
      (select ig_opt_prov_base(c.provincia) from clientes c where c.cod = o.cliente_cod and c.provincia is not null
         and c.provincia !~* '^(moron|coronel pringles)$'),
      ig_opt_detectar_provincia(o.usuario, o.nombre, o.bio))
  where not o.provincia_manual;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function ig_opt_set_provincia(p_usuario text, p_provincia text) returns void
language sql security definer set search_path to 'public' as $$
  update ig_opticas set provincia = nullif(p_provincia, ''), provincia_manual = true
  where usuario = p_usuario and ig_opt_es_admin()
$$;

-- Ópticas nuevas o bio actualizada: deducir provincia al vuelo
create or replace function ig_opt_trg_provincia() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not new.provincia_manual and (tg_op = 'INSERT' or new.bio is distinct from old.bio or new.nombre is distinct from old.nombre
      or new.cliente_cod is distinct from old.cliente_cod) then
    new.provincia := coalesce(
      (select ig_opt_prov_base(c.provincia) from clientes c where c.cod = new.cliente_cod and c.provincia is not null),
      ig_opt_detectar_provincia(new.usuario, new.nombre, new.bio));
  end if;
  return new;
end $$;
drop trigger if exists ig_opt_provincia on ig_opticas;
create trigger ig_opt_provincia before insert or update on ig_opticas for each row execute function ig_opt_trg_provincia();

revoke all on function ig_opt_recalcular_provincias() from public, anon, authenticated;
select ig_opt_recalcular_provincias();
