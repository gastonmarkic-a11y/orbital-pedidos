/* ============================================================
 * Orbital Eyewear — Widget de chat público (self-contained)
 * Embebé en cualquier web con:
 *   <script src="https://TU-DOMINIO/chat-widget.js" defer></script>
 * Llama al backend del bot (webhook-web) — mismo cerebro que WhatsApp/IG.
 * Sin dependencias, sin frameworks. Vanilla JS.
 * ============================================================ */
(function () {
  'use strict'
  if (window.__orbitalChatCargado) return
  window.__orbitalChatCargado = true

  var ENDPOINT = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web'
  var LS_SESION = 'orbital_chat_sesion'
  var LS_CONV = 'orbital_chat_conv'

  // Sesión anónima persistente por navegador
  var sesionId = localStorage.getItem(LS_SESION)
  if (!sesionId) {
    sesionId = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    localStorage.setItem(LS_SESION, sesionId)
  }
  var conversacionId = localStorage.getItem(LS_CONV) || null

  // ---------- estilos ----------
  var css = [
    '.oc-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:#15151A;color:#fff;border:none;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .15s}',
    '.oc-btn:active{transform:scale(.94)}',
    '.oc-panel{position:fixed;right:20px;bottom:90px;width:min(92vw,370px);height:min(70vh,560px);background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}',
    '.oc-open .oc-panel{display:flex}',
    '.oc-head{background:#15151A;color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}',
    '.oc-head b{font-size:15px;font-weight:600}.oc-head small{display:block;font-size:11px;color:#C8A96E}',
    '.oc-x{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1}',
    '.oc-body{flex:1;overflow-y:auto;padding:14px;background:#F6F4EF;display:flex;flex-direction:column;gap:8px}',
    '.oc-msg{max-width:80%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.35;white-space:pre-wrap;word-wrap:break-word}',
    '.oc-bot{background:#fff;border:1px solid rgba(0,0,0,.08);align-self:flex-start;border-bottom-left-radius:4px}',
    '.oc-user{background:#15151A;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}',
    '.oc-qr{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start}',
    '.oc-qr button{background:#fff;border:1px solid #C8A96E;color:#8F6A34;border-radius:16px;padding:6px 11px;font-size:12px;cursor:pointer}',
    '.oc-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(0,0,0,.08);background:#fff}',
    '.oc-foot input{flex:1;border:1px solid rgba(0,0,0,.15);border-radius:20px;padding:9px 14px;font-size:14px;outline:none}',
    '.oc-foot button{background:#15151A;color:#fff;border:none;border-radius:20px;width:40px;font-size:18px;cursor:pointer}',
    '.oc-foot button:disabled{opacity:.5}',
  ].join('')
  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  // ---------- DOM ----------
  var root = document.createElement('div')
  root.innerHTML =
    '<button class="oc-btn" aria-label="Chatear">💬</button>' +
    '<div class="oc-panel" role="dialog">' +
    '<div class="oc-head"><span><b>Orbital Eyewear</b><small>Te ayudamos al toque</small></span><button class="oc-x" aria-label="Cerrar">×</button></div>' +
    '<div class="oc-body"></div>' +
    '<div class="oc-foot"><input type="text" placeholder="Escribí tu mensaje..." /><button aria-label="Enviar">➤</button></div>' +
    '</div>'
  document.body.appendChild(root)

  var btn = root.querySelector('.oc-btn')
  var panel = root.querySelector('.oc-panel')
  var body = root.querySelector('.oc-body')
  var input = root.querySelector('.oc-foot input')
  var enviar = root.querySelector('.oc-foot button')
  var cerrar = root.querySelector('.oc-x')

  var primeraApertura = true
  function toggle() {
    root.classList.toggle('oc-open')
    if (root.classList.contains('oc-open')) {
      input.focus()
      if (primeraApertura) {
        primeraApertura = false
        addBot('¡Hola! 👋 Soy el asistente de Orbital. ¿En qué te damos una mano?')
      }
    }
  }
  btn.addEventListener('click', toggle)
  cerrar.addEventListener('click', toggle)

  function addMsg(texto, clase) {
    var d = document.createElement('div')
    d.className = 'oc-msg ' + clase
    d.textContent = texto
    body.appendChild(d)
    body.scrollTop = body.scrollHeight
    return d
  }
  function addBot(t) { return addMsg(t, 'oc-bot') }
  function addUser(t) { return addMsg(t, 'oc-user') }

  function addQuickReplies(opciones) {
    if (!opciones || !opciones.length) return
    var cont = document.createElement('div')
    cont.className = 'oc-qr'
    opciones.forEach(function (op) {
      var b = document.createElement('button')
      b.textContent = op
      b.addEventListener('click', function () {
        cont.remove()
        mandar(op)
      })
      cont.appendChild(b)
    })
    body.appendChild(cont)
    body.scrollTop = body.scrollHeight
  }

  var enviando = false
  async function mandar(texto) {
    texto = (texto || input.value).trim()
    if (!texto || enviando) return
    input.value = ''
    addUser(texto)
    enviando = true
    enviar.disabled = true
    var pensando = addBot('…')
    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversacionId: conversacionId, sesionId: sesionId, texto: texto }),
      })
      var data = await res.json()
      pensando.remove()
      if (data.conversacionId) {
        conversacionId = data.conversacionId
        localStorage.setItem(LS_CONV, conversacionId)
      }
      addBot(data.texto || 'Gracias, en un rato te respondemos.')
      addQuickReplies(data.quickReplies)
    } catch (e) {
      pensando.remove()
      addBot('Uy, hubo un problema de conexión. Probá de nuevo en un momento.')
    } finally {
      enviando = false
      enviar.disabled = false
      input.focus()
    }
  }

  enviar.addEventListener('click', function () { mandar() })
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') mandar() })
})()
