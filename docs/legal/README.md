# Protección legal de Orbital Suite

## 1. Depósito del software en la DNDA (prioridad)

Trámite: **"Depósito en custodia de obra inédita software"** — Dirección Nacional del Derecho de Autor.
Sirve como prueba de **autoría y fecha cierta**: si alguien copia el sistema, se compara su código con el depositado (y con la huella `ORB-B91CD0154E96`, que va embebida en el código publicado).

| | |
|---|---|
| Costo | $1.400 (tasa incluida), por transferencia al Fondo Cooperador Ley 23.412 DNDA‑CESSI · Banco Provincia · alias `CAMARACESSI` · CBU `0140019901401901247953` (verificá los datos en la página oficial antes de pagar) |
| Vigencia | 3 años. Se renueva por otros 3 dentro de los 30 días posteriores al vencimiento. **Si no se renueva, la obra se destruye** (Decreto 972/2024). Agendalo. |
| Dónde se entrega | Personalmente en Moreno 1230, CABA (lunes a viernes, 9:30 a 14:30), o por correo postal a DNDA, Moreno 1228, C1091AAZ, CABA |
| Consultas | (011) 4124‑7200 |
| Página oficial | https://www.argentina.gob.ar/servicio/deposito-en-custodia-de-obra-inedita-software |

### Paso a paso

1. **Generá el paquete** (desde la carpeta del proyecto, con todo commiteado):
   ```bash
   node scripts/dnda-paquete.mjs
   ```
   Queda en `dnda/<fecha>/`:
   - `orbital-suite-fuente-<fecha>.zip`: el código fuente. Solo incluye código propio, sin datos de clientes ni dependencias de terceros.
   - `MANIFIESTO-SHA256.txt`: la huella digital de cada archivo y la del paquete completo.
   - `memoria-descriptiva.pdf`: la descripción de la obra.
2. **Completá los datos** marcados en amarillo en `docs/legal/memoria-descriptiva.html` (CUIL, DNI, razón social y CUIT del titular, domicilio) y volvé a generar el paquete.
3. *(Opcional, recomendado)* Sumá la estructura de la base de datos. Hay que tener Docker abierto y la contraseña de la base:
   ```bash
   npx supabase db dump --linked --schema public -f dnda/estructura-base.sql
   ```
4. **Copiá al pendrive** el `.zip`, el `MANIFIESTO-SHA256.txt` y la memoria (y la estructura de la base, si la generaste). Usá un pendrive nuevo que quede solo para esto.
5. **Pagá la tasa** y guardá el comprobante.
6. **Entrá a TAD** (https://tramitesadistancia.gob.ar) con tu clave fiscal y buscá *"Depósito en custodia de obra inédita software"*. Cargá:
   - el comprobante de pago;
   - los datos de autor y titular: nombre, CUIL/CUIT, nacionalidad, estado civil, mail, teléfono, domicilio y **porcentaje de titularidad** (100 % al titular);
   - la memoria descriptiva en PDF, como documentación complementaria.
7. TAD genera el **número de expediente y dos carátulas**. Imprimilas.
8. **Armá el sobre:** pendrive dentro de un sobre de papel madera A4, cerrado y **firmado sobre las solapas** por el autor o titular. Escribí en el frente "Orbital Suite" y tu nombre, y pegá las dos carátulas por fuera. Si lo mandás por correo, poné ese sobre dentro de otro.
9. Entregalo. Si falta algo, llega una tarea de subsanación por TAD. Si está todo bien, **la constancia de depósito llega por TAD**: guardala junto con este README.

### Cuándo repetirlo
El sistema cambia todos los días. Conviene un depósito nuevo **cada 6 a 12 meses** o después de un módulo importante, como nueva versión. Cada depósito prueba lo que existía a esa fecha.

> **Quién es el titular:** si el sistema lo hizo o lo pagó la empresa, el titular debería ser la sociedad (con su CUIT) y vos el autor. Si hubo otros programadores, necesitás su cesión de derechos firmada (punto 2) **antes** de declararte titular del 100 %.

## 2. Contratos con quien vea o toque el sistema
Modelo: [`contrato-cesion-y-confidencialidad.md`](contrato-cesion-y-confidencialidad.md).
Firmalo con programadores, diseñadores, colaboradores (por ejemplo, Ariel), vendedores, administración y proveedores con acceso. Incluye confidencialidad, cesión de derechos sobre lo que desarrollen, prohibición de subir el código a herramientas de IA y de replicar el sistema.
**Que lo revise un abogado antes de usarlo.**

## 3. Términos de uso públicos
Publicados en `/terminos` (archivo `public/legal/terminos.html`). Prohíben la copia, la ingeniería inversa, el scraping y el uso para entrenar IA. Conviene enlazarlos desde el pie del catálogo, la consigna, colab y Vision Lab.

## 4. Marcas en el INPI
Registrá en el INPI (https://www.argentina.gob.ar/inpi) las marcas que usás: **Orbital**, **Vision Lab**, **beRabbit** y, si la vas a mostrar al público, **Ojo**. Clases sugeridas: 9 (anteojos y software), 35 (venta y gestión comercial), 42 (software como servicio) y 44 (servicios ópticos y de salud visual). Primero buscá antecedentes en el buscador del INPI. Cuidá que beRabbit no se mezcle con Orbital en las solicitudes.

## 5. Medidas técnicas que acompañan (ver `supabase/seguridad/`)
- *(SQL listo; falta aplicarlo)* La clave pública del sitio solo puede usar las funciones de las páginas públicas; no ve tablas ni funciones internas.
- *(SQL listo; falta aplicarlo)* Límite de 240 consultas anónimas por minuto por IP, con registro de las IPs bloqueadas.
- La huella `ORB-B91CD0154E96` y el aviso de derechos van en cada archivo JavaScript publicado.
- `robots.txt` y el encabezado `X-Robots-Tag: noai` bloquean los rastreadores de IA.
