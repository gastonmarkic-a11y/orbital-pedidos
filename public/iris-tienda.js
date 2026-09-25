/* ============================================================
 * IRIS en la tienda Shopify (orbitaleyewear.com.ar) — chat embebido, vanilla JS.
 * Se instala con UNA línea en el tema (theme.liquid, antes de </body>):
 *   <script src="https://ver.orbitaleyewear.com.ar/iris-tienda.js" defer></script>
 * Opcional: data-lado="izquierda" si choca con otro botón flotante.
 *
 * Habla con webhook-web (origen 'shopify' → IRIS trata al visitante como consumidor
 * final y cotiza con el precio de Shopify). La charla se guarda en el navegador para
 * que siga al pasar de una página a otra de la tienda, y cada tanto pregunta si el
 * equipo le contestó desde la Suite o Telegram (accion 'escuchar').
 * ============================================================ */
(function () {
  'use strict'
  if (window.__irisTienda) return
  window.__irisTienda = true

  var ENDPOINT = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web'
  var LS_SES = 'iris_tienda_ses'
  var LS_CONV = 'iris_tienda_conv'
  var LS_HIST = 'iris_tienda_hist'
  var LS_DESDE = 'iris_tienda_desde'
  var AZUL = '#0004FF'
  var ESCUCHAR_MS = 10000

  var script = document.currentScript
  var izquierda = script && script.getAttribute('data-lado') === 'izquierda'

  function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  function lsSet(k, v) { try { localStorage.setItem(k, v) } catch (e) { /* modo privado */ } }

  var sesionId = lsGet(LS_SES)
  if (!sesionId) {
    sesionId = 'shop-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    lsSet(LS_SES, sesionId)
  }
  var conversacionId = lsGet(LS_CONV) || null
  // Se fija la primera vez: si se recalculara en cada página, lo que el equipo escriba
  // mientras el visitante cambia de página quedaría salteado.
  var desde = lsGet(LS_DESDE)
  if (!desde) { desde = new Date().toISOString(); lsSet(LS_DESDE, desde) }
  var hist = []
  try { hist = JSON.parse(lsGet(LS_HIST) || '[]') } catch (e) { hist = [] }

  // ---------- estilos ----------
  var lado = izquierda ? 'left' : 'right'
  var css = [
    '.iris-w,.iris-w *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.iris-btn{position:fixed;' + lado + ':18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;height:52px;padding:0 18px 0 14px;border-radius:26px;border:none;background:' + AZUL + ';color:#fff;font-size:15px;font-weight:600;box-shadow:0 8px 24px rgba(0,4,255,.35);cursor:pointer;transition:transform .15s}',
    '.iris-btn:active{transform:scale(.95)}',
    '.iris-btn svg{width:22px;height:22px}',
    '.iris-dot{width:8px;height:8px;border-radius:50%;background:#35E07A;box-shadow:0 0 0 2px ' + AZUL + '}',
    '.iris-badge{position:absolute;top:-4px;' + lado + ':-4px;min-width:20px;height:20px;border-radius:10px;background:#FF3B30;color:#fff;font-size:12px;display:none;align-items:center;justify-content:center;padding:0 5px}',
    '.iris-panel{position:fixed;' + lado + ':18px;bottom:82px;z-index:2147483001;width:370px;max-width:calc(100vw - 24px);height:min(74vh,580px);background:#fff;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}',
    '.iris-open .iris-panel{display:flex}',
    '.iris-head{background:' + AZUL + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}',
    '.iris-av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}',
    '.iris-head b{display:block;font-size:15px;line-height:1.2}.iris-head small{font-size:12px;opacity:.8}',
    '.iris-x{margin-' + (izquierda ? 'right' : 'left') + ':auto;background:none;border:none;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}',
    '.iris-body{flex:1;overflow-y:auto;padding:14px;background:#F5F5F7;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}',
    '.iris-msg{max-width:85%;padding:9px 12px;border-radius:16px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;color:#111}',
    '.iris-bot{background:#fff;border:1px solid rgba(0,0,0,.06);align-self:flex-start;border-bottom-left-radius:5px}',
    '.iris-user{background:' + AZUL + ';color:#fff;align-self:flex-end;border-bottom-right-radius:5px}',
    '.iris-msg a{color:' + AZUL + ';text-decoration:underline;word-break:break-all}',
    '.iris-user a{color:#fff}',
    '.iris-typing{display:flex;gap:4px;align-items:center;height:18px}',
    '.iris-typing i{width:6px;height:6px;border-radius:50%;background:#aaa;animation:iris-b 1s infinite}',
    '.iris-typing i:nth-child(2){animation-delay:.15s}.iris-typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes iris-b{0%,60%,100%{opacity:.3}30%{opacity:1}}',
    '.iris-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:#fff;border-top:1px solid rgba(0,0,0,.06)}',
    '.iris-chips button{background:#fff;border:1px solid rgba(0,4,255,.3);color:' + AZUL + ';border-radius:16px;padding:6px 11px;font-size:12.5px;cursor:pointer}',
    '.iris-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(0,0,0,.06);background:#fff}',
    '.iris-foot input{flex:1;min-width:0;border:1px solid rgba(0,0,0,.15);border-radius:22px;padding:10px 14px;font-size:16px;outline:none;color:#111;background:#fff}',
    '.iris-foot input:focus{border-color:' + AZUL + '}',
    '.iris-foot button{flex:none;background:' + AZUL + ';color:#fff;border:none;border-radius:50%;width:42px;height:42px;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.iris-foot button:disabled{opacity:.45}',
    '@media (max-width:480px){.iris-panel{' + lado + ':0;bottom:0;width:100vw;max-width:100vw;height:100%;border-radius:0}.iris-open .iris-btn{display:none}}',
  ].join('')
  var st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)

  // ---------- DOM ----------
  var root = document.createElement('div')
  root.className = 'iris-w'
  root.innerHTML =
    '<button class="iris-btn" aria-label="Chatear con IRIS">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
      '<span>¿Te ayudo?</span><span class="iris-dot"></span><span class="iris-badge"></span>' +
    '</button>' +
    '<div class="iris-panel" role="dialog" aria-label="Chat con IRIS">' +
      '<div class="iris-head"><div class="iris-av">I</div><div><b>IRIS · Orbital Eyewear</b><small>Te respondo ahora mismo</small></div>' +
      '<button class="iris-x" aria-label="Cerrar">×</button></div>' +
      '<div class="iris-body"></div>' +
      '<div class="iris-chips"></div>' +
      '<div class="iris-foot"><input type="text" placeholder="Escribí tu consulta…" enterkeyhint="send" />' +
      '<button aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg></button></div>' +
    '</div>'
  document.body.appendChild(root)

  var btn = root.querySelector('.iris-btn')
  var badge = root.querySelector('.iris-badge')
  var body = root.querySelector('.iris-body')
  var chips = root.querySelector('.iris-chips')
  var input = root.querySelector('.iris-foot input')
  var enviarBtn = root.querySelector('.iris-foot button')

  // ---------- texto: *negrita*, _cursiva_ y links, sin inyectar HTML ----------
  function formatear(t) {
    var s = String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<b>$2</b>')
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?)]|$)/g, '$1<i>$2</i>')
    return s
  }

  function pintar(m) {
    var d = document.createElement('div')
    d.className = 'iris-msg ' + (m.de === 'cliente' ? 'iris-user' : 'iris-bot')
    d.innerHTML = formatear(m.texto)
    body.appendChild(d)
    body.scrollTop = body.scrollHeight
  }

  function agregar(de, texto) {
    var m = { de: de, texto: texto }
    hist.push(m)
    if (hist.length > 60) hist = hist.slice(-60)
    lsSet(LS_HIST, JSON.stringify(hist))
    pintar(m)
  }

  // ---------- sugerencias ----------
  function modeloEnPantalla() {
    var tipo = document.querySelector('meta[property="og:type"]')
    if (!tipo || tipo.getAttribute('content') !== 'product') return null
    var t = document.querySelector('meta[property="og:title"]')
    var n = t && t.getAttribute('content')
    return n ? n.split(/\s[|–-]\s/)[0].trim().slice(0, 60) : null
  }

  function pintarChips() {
    chips.innerHTML = ''
    if (hist.some(function (m) { return m.de === 'cliente' })) { chips.style.display = 'none'; return }
    var modelo = modeloEnPantalla()
    var ops = []
    if (modelo) ops.push({ label: 'Consultar por ' + modelo, texto: '¿Tienen disponible el ' + modelo + '? ¿En qué colores?' })
    ops.push({ label: 'Medios de pago y cuotas', texto: '¿Qué medios de pago y cuotas tienen?' })
    ops.push({ label: 'Envíos', texto: '¿Cómo son los envíos y cuánto tardan?' })
    ops.push({ label: '¿Se pueden graduar?', texto: '¿Los anteojos se pueden hacer con aumento?' })
    ops.push({ label: 'No encuentro un modelo', texto: 'Estoy buscando un modelo y no lo encuentro en la página' })
    ops.forEach(function (o) {
      var b = document.createElement('button')
      b.type = 'button'
      b.textContent = o.label
      b.addEventListener('click', function () { mandar(o.texto) })
      chips.appendChild(b)
    })
    chips.style.display = 'flex'
  }

  // ---------- abrir / cerrar ----------
  var sinLeer = 0
  function marcarSinLeer(n) {
    sinLeer = n
    badge.textContent = String(n)
    badge.style.display = n > 0 ? 'flex' : 'none'
  }

  function abrir() {
    root.classList.add('iris-open')
    marcarSinLeer(0)
    if (!hist.length) agregar('bot', '¡Hola! 👋 Soy IRIS, de Orbital Eyewear. Te ayudo a encontrar tu modelo, ver colores y stock, y con cualquier duda de pagos o envíos. ¿Qué estás buscando?')
    pintarChips()
    body.scrollTop = body.scrollHeight
    if (window.matchMedia('(min-width: 481px)').matches) input.focus()
  }
  function cerrar() { root.classList.remove('iris-open') }
  btn.addEventListener('click', function () { root.classList.contains('iris-open') ? cerrar() : abrir() })
  root.querySelector('.iris-x').addEventListener('click', cerrar)

  hist.forEach(pintar)

  // ---------- enviar ----------
  var enviando = false
  function mandar(t) {
    var texto = (t || input.value).trim()
    if (!texto || enviando) return
    input.value = ''
    agregar('cliente', texto)
    chips.style.display = 'none'
    enviando = true
    enviarBtn.disabled = true
    var pensando = document.createElement('div')
    pensando.className = 'iris-msg iris-bot'
    pensando.innerHTML = '<div class="iris-typing"><i></i><i></i><i></i></div>'
    body.appendChild(pensando)
    body.scrollTop = body.scrollHeight

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversacionId: conversacionId, sesionId: sesionId, texto: texto,
        identidad: { origen: 'shopify' },
      }),
    }).then(function (r) { return r.json() }).then(function (data) {
      pensando.remove()
      if (data.conversacionId) { conversacionId = data.conversacionId; lsSet(LS_CONV, conversacionId) }
      if (!data.silencio) agregar('bot', data.texto || 'Gracias, en un rato te respondemos por acá.')
    }).catch(function () {
      pensando.remove()
      agregar('bot', 'Uy, hubo un problema de conexión. Probá de nuevo en un momento.')
    }).then(function () {
      enviando = false
      enviarBtn.disabled = false
    })
  }
  enviarBtn.addEventListener('click', function () { mandar() })
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') mandar() })

  // ---------- respuestas del equipo (Suite / Telegram) ----------
  function escuchar() {
    if (!conversacionId || document.hidden) return
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'escuchar', sesionId: sesionId, conversacionId: conversacionId, desde: desde }),
    }).then(function (r) { return r.json() }).then(function (data) {
      var ms = (data && data.mensajes) || []
      if (!ms.length) return
      desde = ms[ms.length - 1].created_at
      lsSet(LS_DESDE, desde)
      ms.forEach(function (m) { agregar('bot', m.contenido) })
      if (!root.classList.contains('iris-open')) marcarSinLeer(sinLeer + ms.length)
    }).catch(function () { /* se reintenta en el próximo tick */ })
  }
  setInterval(escuchar, ESCUCHAR_MS)
  escuchar()
})()
