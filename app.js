/* ===== Mi Lista — lista de compras compartida ===== */
(function () {
  'use strict';

  var CATS = [
    { id: 'carniceria', name: 'Carnicería', emoji: '🥩',
      sug: ['Carne picada', 'Pollo', 'Milanesas', 'Bife', 'Chorizo', 'Jamón', 'Costillas', 'Salchichas'] },
    { id: 'verduleria', name: 'Verdulería', emoji: '🥬',
      sug: ['Tomate', 'Papa', 'Cebolla', 'Banana', 'Manzana', 'Lechuga', 'Zanahoria', 'Limón'] },
    { id: 'bebidas', name: 'Bebidas', emoji: '🥤',
      sug: ['Agua', 'Gaseosa', 'Jugo', 'Cerveza', 'Vino', 'Soda'] },
    { id: 'supermercado', name: 'Supermercado', emoji: '🛒',
      sug: ['Leche', 'Pan', 'Huevos', 'Fideos', 'Arroz', 'Aceite', 'Azúcar', 'Yerba', 'Café', 'Queso',
            'Papel higiénico', 'Detergente', 'Lavandina', 'Shampoo'] }
  ];

  var KEY = 'milista.v1';
  var KEY_CAT = 'milista.cat';
  var KEY_URL = 'milista.url';
  var PAUSA = 700;      // espera antes de mandar cambios
  var REFRESCO = 10000; // cada cuánto busca cambios de los demás

  // Link de invitación: milista.../?lista=<dirección de la planilla>
  // Se guarda en el celular y se borra de la barra de direcciones.
  (function () {
    try {
      var u = new URLSearchParams(location.search).get('lista');
      if (u && /^https:\/\/.+/i.test(u.trim())) {
        localStorage.setItem(KEY_URL, u.trim());
        history.replaceState(null, '', location.pathname);
      }
    } catch (e) {}
  })();

  var items = load();
  var storedCat = localStorage.getItem(KEY_CAT);
  var activeCat = CATS.some(function (c) { return c.id === storedCat; }) ? storedCat : CATS[0].id;

  var $ = function (id) { return document.getElementById(id); };
  var chipsEl = $('chips');
  var listEl = $('list');
  var emptyEl = $('empty');
  var barEl = $('bar');
  var countEl = $('count');
  var fillEl = $('fill');
  var clearBtn = $('clearDone');
  var formEl = $('addForm');
  var inputEl = $('nameInput');
  var suggestEl = $('suggest');
  var toastEl = $('toast');
  var askEl = $('ask');
  var cfgEl = $('cfg');
  var syncBtn = $('syncBtn');
  var syncDot = $('syncDot');
  var syncText = $('syncText');

  /* ---------- datos ---------- */

  function cat(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i];
    return CATS[CATS.length - 1];
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data.filter(function (it) {
        return it && typeof it.name === 'string';
      }).map(function (it) {
        return {
          id: String(it.id),
          name: it.name,
          cat: cat(it.cat).id,      // categorías viejas -> Supermercado
          done: !!it.done,
          upd: Number(it.upd) || 0,
          del: !!it.del,
          pend: !!it.pend
        };
      });
    } catch (e) {
      return [];
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
  }

  function vivos() {
    return items.filter(function (it) { return !it.del; });
  }

  function norm(s) {
    return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function buzz(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('toast--on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('toast--on'); }, 2200);
  }

  function tocado(it) {
    it.upd = Date.now();
    it.pend = true;
  }

  /* ---------- sincronización con la planilla ---------- */

  function endpoint() {
    var u = localStorage.getItem(KEY_URL);
    if (u === null || u === undefined) u = (window.MILISTA_URL || '');
    return String(u).trim();
  }

  var syncing = false, otraVez = false, pausa = null;

  function estado(tipo, texto) {
    if (!endpoint()) { syncBtn.hidden = true; return; }
    syncBtn.hidden = false;
    syncBtn.className = 'sync sync--' + tipo;
    syncText.textContent = texto;
  }

  function aRemoto(it) {
    return {
      id: it.id, nombre: it.name, categoria: it.cat,
      comprado: !!it.done, borrado: !!it.del
    };
  }

  function aplicar(remotos, sello) {
    var locales = {};
    items.forEach(function (it) { locales[it.id] = it; });

    var out = [];
    remotos.forEach(function (r) {
      if (!r || !r.id) return;
      var id = String(r.id);
      var l = locales[id];
      delete locales[id];
      // si cambió acá mientras hablábamos con la planilla, gana lo de acá
      if (l && l.pend && sello[id] !== l.upd) { out.push(l); return; }
      out.push({
        id: id,
        name: String(r.nombre || ''),
        cat: cat(r.categoria).id,
        done: !!r.comprado,
        upd: Number(r.actualizado) || 0,
        del: !!r.borrado,
        pend: false
      });
    });

    // lo que la planilla no conoce: se mantiene solo si todavía está sin mandar
    Object.keys(locales).forEach(function (id) {
      if (locales[id].pend) out.push(locales[id]);
    });

    var antes = firma(items);
    items = out;
    save();
    // solo redibuja si algo cambió: si no, un toque podría caer justo
    // en el momento en que la pantalla se rehace sola
    if (firma(items) !== antes) render();
  }

  function firma(lista) {
    return lista.map(function (it) {
      return it.id + '|' + it.name + '|' + it.cat + '|' + (it.done ? 1 : 0) + '|' + (it.del ? 1 : 0);
    }).sort().join('\n');
  }

  function sync(manual) {
    var url = endpoint();
    if (!url) { estado('local', ''); return; }
    if (syncing) { otraVez = true; return; }
    syncing = true;

    var envio = items.filter(function (it) { return it.pend; });
    var sello = {};
    envio.forEach(function (it) { sello[it.id] = it.upd; });
    estado('va', envio.length ? 'Guardando…' : 'Actualizando…');

    // corta sola si la red se cuelga
    var corte = null, señal;
    if (window.AbortController) {
      var ac = new AbortController();
      señal = ac.signal;
      corte = setTimeout(function () { ac.abort(); }, 15000);
    }

    // sin encabezados propios: así el navegador no pide permiso extra (CORS simple)
    fetch(url, { method: 'POST', body: JSON.stringify({ cambios: envio.map(aRemoto) }), signal: señal })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.items)) {
          throw new Error((data && data.error) || 'respuesta rara');
        }
        aplicar(data.items, sello);
        estado('ok', 'Lista compartida');
      })
      .catch(function () {
        estado('no', 'Sin conexión');
        if (manual) toast('No se pudo conectar con la planilla');
      })
      .then(function () {
        if (corte) clearTimeout(corte);
        syncing = false;
        if (otraVez) { otraVez = false; sync(); }
      });
  }

  function syncLuego() {
    if (!endpoint()) return;
    estado('va', 'Guardando…');
    clearTimeout(pausa);
    pausa = setTimeout(function () { sync(); }, PAUSA);
  }

  /* ---------- acciones ---------- */

  var flashId = null;

  function addItem(name) {
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return;
    name = name.charAt(0).toUpperCase() + name.slice(1);

    var dupe = null;
    var vis = vivos();
    for (var i = 0; i < vis.length; i++) {
      if (norm(vis[i].name) === norm(name)) { dupe = vis[i]; break; }
    }
    if (dupe) {
      flashId = dupe.id;
      if (dupe.done) { dupe.done = false; tocado(dupe); syncLuego(); }
      save();
      render('dupe');
      toast('"' + dupe.name + '" ya está en la lista');
      buzz(40);
      return;
    }

    var it = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
      name: name,
      cat: activeCat,
      done: false,
      upd: Date.now(),
      del: false,
      pend: true
    };
    items.push(it);
    flashId = it.id;
    save();
    render('new');
    syncLuego();
    buzz(15);
  }

  function toggle(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items[i].done = !items[i].done;
        tocado(items[i]);
        buzz(items[i].done ? 25 : 12);
        break;
      }
    }
    save();
    render();
    syncLuego();
  }

  function remove(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) { items[i].del = true; tocado(items[i]); break; }
    }
    save();
    render();
    syncLuego();
  }

  function confirmAsk(text, onYes) {
    $('askText').textContent = text;
    if (typeof askEl.showModal === 'function') {
      askEl.showModal();
      var yes = function () { cerrar(); onYes(); };
      var no = function () { cerrar(); };
      function cerrar() {
        askEl.close();
        $('askYes').removeEventListener('click', yes);
        $('askNo').removeEventListener('click', no);
      }
      $('askYes').addEventListener('click', yes);
      $('askNo').addEventListener('click', no);
    } else if (window.confirm(text)) {
      onYes();
    }
  }

  /* ---------- render ---------- */

  function renderChips() {
    chipsEl.innerHTML = '';
    CATS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', c.id === activeCat ? 'true' : 'false');
      b.innerHTML = '<span class="chip__emoji">' + c.emoji + '</span>';
      b.appendChild(document.createTextNode(c.name));
      b.addEventListener('click', function () {
        activeCat = c.id;
        try { localStorage.setItem(KEY_CAT, activeCat); } catch (e) {}
        renderChips();
        renderSuggest();
        inputEl.focus();
      });
      chipsEl.appendChild(b);
    });
  }

  function renderSuggest() {
    suggestEl.innerHTML = '';
    var c = cat(activeCat);
    var vis = vivos();
    var libres = c.sug.filter(function (s) {
      return !vis.some(function (it) { return norm(it.name) === norm(s); });
    }).slice(0, 8);
    libres.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sug';
      b.textContent = '+ ' + s;
      b.addEventListener('click', function () { addItem(s); });
      suggestEl.appendChild(b);
    });
  }

  function renderList(anim) {
    listEl.innerHTML = '';
    var vis = vivos();

    CATS.forEach(function (c) {
      var ofCat = vis.filter(function (it) { return it.cat === c.id; });
      if (!ofCat.length) return;

      ofCat.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
      var pend = ofCat.filter(function (it) { return !it.done; }).length;

      var g = document.createElement('section');
      g.className = 'group';

      var h = document.createElement('div');
      h.className = 'group__head';
      h.innerHTML =
        '<span class="group__emoji">' + c.emoji + '</span>' +
        '<span class="group__name"></span>' +
        '<span class="group__rule"></span>' +
        '<span class="group__n">' + pend + '</span>';
      h.querySelector('.group__name').textContent = c.name;
      g.appendChild(h);

      ofCat.forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'item' + (it.done ? ' item--done' : '');
        if (it.id === flashId && anim) row.classList.add(anim === 'dupe' ? 'item--dupe' : 'item--new');

        var tap = document.createElement('button');
        tap.type = 'button';
        tap.className = 'item__tap';
        tap.setAttribute('aria-pressed', it.done ? 'true' : 'false');
        tap.innerHTML = '<span class="box" aria-hidden="true">✓</span><span class="item__name"></span>';
        tap.querySelector('.item__name').textContent = it.name;
        tap.addEventListener('click', function () { toggle(it.id); });

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'item__del';
        del.setAttribute('aria-label', 'Borrar ' + it.name);
        del.textContent = '✕';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          remove(it.id);
        });

        row.appendChild(tap);
        row.appendChild(del);
        g.appendChild(row);
      });

      listEl.appendChild(g);
    });

    flashId = null;
  }

  function renderBar() {
    var vis = vivos();
    var total = vis.length;
    var done = vis.filter(function (it) { return it.done; }).length;

    emptyEl.hidden = total > 0;
    barEl.hidden = total === 0;

    countEl.textContent = done + ' de ' + total + ' comprado' + (total === 1 ? '' : 's');
    fillEl.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';
    clearBtn.disabled = done === 0;
  }

  function render(anim) {
    renderList(anim);
    renderBar();
    renderSuggest();
  }

  /* ---------- eventos ---------- */

  formEl.addEventListener('submit', function (e) {
    e.preventDefault();
    addItem(inputEl.value);
    inputEl.value = '';
    inputEl.focus();
  });

  clearBtn.addEventListener('click', function () {
    var listos = vivos().filter(function (it) { return it.done; });
    if (!listos.length) return;
    var n = listos.length;
    confirmAsk('¿Borrar los ' + n + ' producto' + (n === 1 ? '' : 's') + ' ya comprado' + (n === 1 ? '' : 's') + '?', function () {
      listos.forEach(function (it) { it.del = true; tocado(it); });
      save();
      render();
      syncLuego();
      toast('Listo, lista limpia');
      buzz(30);
    });
  });

  syncBtn.addEventListener('click', function () { sync(true); });

  /* ---------- configuración de la lista compartida ---------- */

  // No hay botón a la vista: se abre dejando apretado el título un segundo y medio.
  // Es para emergencias (cambió la dirección de la planilla), no para el uso diario.
  (function () {
    var titulo = $('titulo'), reloj = null;

    function abrir() {
      $('cfgUrl').value = endpoint();
      $('cfgState').textContent = endpoint() ? '' : 'Ahora la lista se guarda solo en este celular.';
      if (typeof cfgEl.showModal === 'function') cfgEl.showModal();
      buzz(20);
    }
    function empezar() { reloj = setTimeout(abrir, 1500); }
    function cortar() { clearTimeout(reloj); }

    titulo.addEventListener('pointerdown', empezar);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      titulo.addEventListener(ev, cortar);
    });
    titulo.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();

  $('cfgCancel').addEventListener('click', function () { cfgEl.close(); });

  $('cfgSave').addEventListener('click', function () {
    var v = $('cfgUrl').value.trim();
    if (v && !/^https:\/\/.+/i.test(v)) {
      $('cfgState').textContent = 'La dirección tiene que empezar con https://';
      return;
    }
    try { localStorage.setItem(KEY_URL, v); } catch (e) {}
    cfgEl.close();
    if (v) { estado('va', 'Conectando…'); sync(true); }
    else { syncBtn.hidden = true; toast('Lista solo en este celular'); }
  });

  $('cfgOff').addEventListener('click', function () {
    try { localStorage.setItem(KEY_URL, ''); } catch (e) {}
    cfgEl.close();
    syncBtn.hidden = true;
    toast('Lista solo en este celular');
  });

  /* ---------- arranque ---------- */

  renderChips();
  render();

  if (endpoint()) {
    estado('va', 'Conectando…');
    sync();
    setInterval(function () {
      if (document.visibilityState === 'visible') sync();
    }, REFRESCO);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sync();
    });
    window.addEventListener('online', function () { sync(); });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
