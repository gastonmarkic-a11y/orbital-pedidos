-- Mapa de zonas 15/10/2026 (reemplaza el del 30/9).
-- Lola: conurbano norte + noroeste (sin CABA) + Moreno + Merlo norte + CUYO
--       + Entre Ríos y Santa Fe norte (ex zona de Mauro, desde 15/10).
-- Bruno: CABA salvo los 7 barrios del sur + Morón (El Palomar entero) + Ituzaingó + NEA.
-- Adrián: CABA sur + sur del conurbano + La Matanza + Merlo sur + Gral. Rodríguez/Luján/Marcos Paz
--         + La Plata + Campana-Zárate + interior Bs As, CENTRO, NOA, Patagonia.

CREATE OR REPLACE FUNCTION public.subzona_gba(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with x as (select lower(unaccent_simple(coalesce(p,''))) q)
  select case
    when q ~ 'san miguel del monte|lucila del mar|general belgrano|las flores' then '99 Otros GBA'
    when q ~ 'parque san martin|pque san martin|pque\. san martin' then '07 Merlo-Moreno'
    when q ~ 'ciudad autonoma|capital federal|caba|villa lugano|villa crespo|caballito|flores|liniers|mataderos|palermo|villa luro|floresta|paternal|boedo|barracas|la boca|nueva pompeya|villa soldati|parque patricios|monserrat|montserrat|san telmo|constitucion|almagro|balvanera|once|recoleta|retiro|belgrano|nunez|saavedra|coghlan|colegiales|chacarita|agronomia|villa devoto|villa del parque|villa pueyrredon|villa urquiza|parque chacabuco|versalles|velez' then '01 CABA'
    when q ~ 'san miguel|bella vista|muniz|jose c\.? ?paz|jose clemente paz|grand bourg|gran bourg|tortuguitas|polvorines|povirines|malvinas argentinas|pablo nogues|villa de mayo|sourdeaux|tierras altas' then '13 Noroeste'
    when q ~ 'tigre|pacheco|nordelta|benavidez|troncos del talar|rincon de milberg|dique lujan|ricardo rojas|el talar' then '14 Tigre'
    when q ~ 'vicente lopez|olivos|florida|martinez|ballester|san fernando|beccar|boulogne|carapachay|munro|san isidro|villa adelina|jose leon suarez|san andres|villa martelli|acassuso|don torcuato|victoria|la lucila|virreyes|san martin|villa maipu|billinghurst|villa lynch|chilavert' then '02 Norte'
    when q ~ 'pilar|del viso|garin|escobar|maschwitz|matheu|manuel alberti|villa rosa|derqui|maquinista savio|loma verde|manzanares|zelaya|lagomarsino|fatima' then '03 Norte-Pilar'
    when q ~ 'campana|zarate|baradero' then '04 Campana-Zarate'
    when q ~ 'ramos m[ae]jia|moron|haedo|castelar|caseros|ciudadela|palomar|hurlingham|santos lugares|villa santos tesei|tesei|villa bosch|saenz pena|tres de febrero|3 de febrero|martin coronado|loma hermosa|pablo podesta|churruca|william morris|villa sarmiento' then '05 Oeste'
    when q ~ 'san justo|isidro casanova|casanova|gonzalez catan|laferrere|la ferrere|rafael castillo|virrey del pino|catan|villa luzuriaga|tapiales|villa celina|villa madero|aldo bonzi|lomas del mirador|la tablada|ciudad evita|20 de junio|veinte de junio' then '06 La Matanza'
    when q ~ 'ituzaingo|ituzaigo|parque leloir|villa udaondo|merlo|padua|libertad|paso del rey|moreno|francisco alvarez|mariano acosta|pontevedra|agustin ferrari|la reja|trujui|cuartel v' then '07 Merlo-Moreno'
    when q ~ 'lujan|general rodriguez|gral\.? rodriguez|marcos paz|mercedes|navarro' then '08 Lujan'
    when q ~ 'avellaneda|lanus|lomas de zamora|banfield|bandfield|temperley|gerli|remedios de escalada|valentin[a]? alsina|villa dominico|sarandi|dock sud|wilde|pineyro|crucecita|monte chingolo|fiorito|budge|turdera|llavallol|villa centenario|villa albertina|parque baron' then '09 Sur-Lanus'
    when q ~ 'quilmes|bernal|berazategui|florencio varela|hudson|solano|ranelagh|don bosco|ezpeleta|platanos|villa la florida|villa espana|sourigues|souriges|el pato|pereyra|ingeniero allan|ingeniero alan|ing\.? allan|zeballos|bosques|villa vatteone|gobernador costa' then '10 Sur-Quilmes'
    when q ~ 'adrogue|burzaco|longchamps|monte ?grande|ezeiza|canuelas|canning|glew|claypole|rafael calzada|guernica|tristan suarez|san vicente|juan m\. gutierrez|juan maria gutierrez|jose marmol|ministro rivadavia|alejandro korn|luis guillon|el jaguel|la union|spegazzini|domselaar|don orione|9 de abril' then '11 Alte Brown-Ezeiza'
    when q ~ 'la plata|city bell|gonnet|berisso|ensenada|tolosa|villa elisa|abasto|ringuelet|los hornos|melchor romero|gorina|hernandez|villa castells|arturo segui|etcheverry|magdalena|brandsen' then '12 Gran La Plata'
    else '99 Otros GBA'
  end from x
$function$;

CREATE OR REPLACE FUNCTION public.zona_vendedor(p_barrio text, p_prov text, p_loc text, p_tel text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
 with r as (select region_de(p_prov,p_loc) reg, unaccent(lower(trim(coalesce(p_prov,'')))) prov,
   lower(unaccent_simple(coalesce(p_loc,''))) l,
   case when region_de(p_prov,p_loc) in ('CABA','AMBA Norte','AMBA Oeste','AMBA Sur','Interior Bs As','Sin zona') then subzona_gba(p_loc) end sz)
 select case
  -- CABA: sur para Adrián, el resto para Bruno (Lola no tiene CABA)
  when p_barrio in ('La Boca','Barracas','Parque Patricios','Nueva Pompeya','Villa Soldati','Villa Lugano','Villa Riachuelo') then 'Adrian'
  when p_barrio is not null then 'Bruno'
  when sz = '01 CABA' or reg = 'CABA' then
    case when l ~ '(la boca|barracas|parque patricios|pompeya|soldati|lugano|riachuelo)' then 'Adrian' else 'Bruno' end
  when sz = '04 Campana-Zarate' or (reg in ('AMBA Norte','Interior Bs As','Sin zona') and l ~ '(campana|zarate|lima\M)') then 'Adrian'
  when sz in ('02 Norte','03 Norte-Pilar','14 Tigre','13 Noroeste') then 'Lola'
  -- Oeste: Ramos Mejía es La Matanza (Adrián); 3 de Febrero y Hurlingham son de Lola; Morón y El Palomar de Bruno
  when sz = '05 Oeste' then
    case when l ~ 'ramos m[ae]jia' then 'Adrian'
         when l ~ '(caseros|ciudadela|santos lugares|saenz pena|villa bosch|hurlingham|tesei|tres de febrero|3 de febrero|martin coronado|loma hermosa|pablo podesta|churruca|william morris)' then 'Lola'
         else 'Bruno' end
  when sz = '06 La Matanza' then 'Adrian'
  -- Merlo dividido: norte (centro, Padua, Parque San Martín) y Moreno a Lola; sur a Adrián; Ituzaingó a Bruno
  when sz = '07 Merlo-Moreno' then
    case when l ~ '(ituzaingo|ituzaigo|parque leloir|villa udaondo)' then 'Bruno'
         when l ~ '(libertad|pontevedra|mariano acosta|agustin ferrari)' then 'Adrian'
         else 'Lola' end
  when sz in ('08 Lujan','09 Sur-Lanus','10 Sur-Quilmes','11 Alte Brown-Ezeiza','12 Gran La Plata') then 'Adrian'
  when prov = 'entre rios' then 'Lola'
  when prov = 'santa fe' and santa_fe_norte(p_loc,p_tel) then 'Lola'
  else case reg
    when 'AMBA Norte' then 'Lola' when 'AMBA Oeste' then 'Bruno' when 'AMBA Sur' then 'Adrian'
    when 'CUYO' then 'Lola' when 'NEA' then 'Bruno' when 'NOA' then 'Adrian'
    when 'Interior Bs As' then 'Adrian' when 'CENTRO' then 'Adrian' when 'Patagonia' then 'Adrian'
    end
 end from r $function$;
