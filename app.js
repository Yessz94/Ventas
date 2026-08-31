// ============================================================
// Registro de Ventas - Decants de Perfumes
// Lógica de la aplicación + sincronización con Google Sheets
// ============================================================

(function () {
  'use strict';

  // ---------- Estado general ----------
  var estado = {
    url: null,      // URL del Apps Script
    ventas: [],     // todas las ventas
    modalVentaId: null, // id de la venta activa en el modal de abonos
    abonoModal: null    // función de recarga del modal
  };

  var LS_URL = 'rv_sheet_url';

  // ---------- Utilidades ----------
  function $id(id) { return document.getElementById(id); }

  function dinero(n) {
    var num = Number(n) || 0;
    return '$' + num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var t = $id('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 2500);
  }

  // ---------- Persistencia local de la URL ----------
  function guardarURL() {
    try { localStorage.setItem(LS_URL, estado.url); } catch (e) {}
  }
  function cargarURL() {
    try { return localStorage.getItem(LS_URL) || null; } catch (e) { return null; }
  }

  // ---------- Pantallas ----------
  function mostrarSetup(conUrl) {
    $id('screen-setup').classList.remove('hidden');
    $id('screen-app').classList.add('hidden');
    $id('btn-save-url').classList.toggle('hidden', !!conUrl);
    $id('btn-edit-url').classList.toggle('hidden', !conUrl);
    var hint = conUrl ? 'Conexión guardada. Pulsa "Cambiar URL" para modificarla.' : 'No has configurado la conexión.';
    $id('setup-hint').textContent = hint;
  }

  function mostrarApp() {
    $id('screen-setup').classList.add('hidden');
    $id('screen-app').classList.remove('hidden');
    cargarVentas();
  }

  function iniciar() {
    var url = cargarURL();
    if (url) { estado.url = url; mostrarApp(); }
    else { mostrarSetup(false); }
  }

  // ---------- Detección de disponibilidad / primer arranque ----------
  // Si no hay URL configurada nunca, probamos con el disparador "doGet"
  // del Apps Script para auto-conexión (opcional). Por defecto dejamos
  // la configuración manual.

  // ---------- Comunicación con Google Apps Script ----------
  function extraerPassword(url) {
    // Saca el parámetro "password" de la URL (acepta ?password= y &password=)
    var m = url.match(/[?&]password=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function llamarAPI(accion, datos) {
    if (!estado.url) { return Promise.reject(new Error('No hay URL configurada.')); }
    var payload = Object.assign({ accion: accion }, datos || {});
    var pw = extraerPassword(estado.url);
    if (pw) { payload.password = pw; }
    return fetch(estado.url, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.error) { throw new Error(j.error); }
      return j;
    });
  }

  // ---------- Cargar ventas ----------
  function cargarVentas() {
    llamarAPI('leer')
      .then(function (res) {
        estado.ventas = (res && res.ventas) || [];
        renderResumen();
        renderLista();
      })
      .catch(function (err) {
        // No hay conexión configurada correctamente
        if (!estado.url) { mostrarSetup(false); return; }
        toast('Error de conexión: ' + (err.message || 'revisa la URL'));
      });
  }

  // ---------- Cálculos ----------
  function abonosVenta(v) {
    return (v.abonos && Array.isArray(v.abonos)) ? v.abonos : [];
  }
  function totalAbonado(v) {
    return abonosVenta(v).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
  }
  function saldoVenta(v) {
    if (String(v.pago) === 'contado') { return 0; }
    return Math.max(0, (Number(v.precio) || 0) - totalAbonado(v));
  }
  function gananciaVenta(v) { return (Number(v.precio) || 0) - (Number(v.costo) || 0); }
  function esCancelado(v) {
    return String(v.pago) === 'contado' || saldoVenta(v) <= 0;
  }

  // ---------- Resumen ----------
  function renderResumen() {
    var totalVendido = 0, totalGanancia = 0, totalPorCobrar = 0;
    estado.ventas.forEach(function (v) {
      totalVendido += Number(v.precio) || 0;
      totalGanancia += gananciaVenta(v);
      totalPorCobrar += saldoVenta(v);
    });
    $id('stat-vendido').textContent = dinero(totalVendido);
    $id('stat-ganancia').textContent = dinero(totalGanancia);
    $id('stat-porcobrar').textContent = dinero(totalPorCobrar);
    $id('stat-ventas').textContent = estado.ventas.length;
  }

  // ---------- Lista de ventas ----------
  function renderLista() {
    var cont = $id('lista-ventas');
    cont.innerHTML = '';
    $id('empty-list').classList.toggle('hidden', estado.ventas.length > 0);

    estado.ventas.slice().reverse().forEach(function (v) {
      var cancelado = esCancelado(v);
      var clase = cancelado ? 'cancelado' : 'pendiente';
      var etiqueta = cancelado ? 'Cancelado' : 'Pendiente';

      var card = document.createElement('div');
      card.className = 'venta-card ' + clase;

      var fechaTxt = v.fecha || '';
      var html = '';
      html += '<div class="venta-top">';
      html += '<span class="venta-perfume">' + esc(v.perfume) + '</span>';
      html += '<span class="estado ' + clase + '">' + etiqueta + '</span>';
      html += '</div>';
      html += '<div class="venta-info">';
      html += 'Precio: <b>' + dinero(v.precio) + '</b> &nbsp; Costo: <b>' + dinero(v.costo) + '</b> &nbsp; Pago: <b>' + esc(v.pago === 'contado' ? 'Contado' : 'Crédito') + '</b>';
      if (fechaTxt) { html += '<div class="abono-fecha">' + esc(fechaTxt) + '</div>'; }
      html += '</div>';

      if (String(v.pago) === 'credito') {
        var saldo = saldoVenta(v);
        html += '<div class="venta-info">Abonado: <b>' + dinero(totalAbonado(v)) + '</b> &nbsp; Saldo: <b class="saldo">' + dinero(saldo) + '</b></div>';
      }

      html += '<div class="venta-actions">';
      html += '<button class="btn ghost small" data-ver="' + esc(v.id) + '">Detalle / Abonos</button> ';
      html += '<button class="btn danger small" data-elim="' + esc(v.id) + '">Eliminar</button>';
      html += '</div>';

      card.innerHTML = html;
      cont.appendChild(card);
    });

    // Eventos de la lista
    cont.querySelectorAll('[data-ver]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalle(b.getAttribute('data-ver')); });
    });
    cont.querySelectorAll('[data-elim]').forEach(function (b) {
      b.addEventListener('click', function () { eliminarVenta(b.getAttribute('data-elim')); });
    });
  }

  // ---------- Nueva venta ----------
  function abrirModalVenta() {
    $id('f-perfume').value = '';
    $id('f-precio').value = '';
    $id('f-costo').value = '';
    $id('f-abono').value = '';
    document.querySelector('input[name="pago"][value="contado"]').checked = true;
    actualizarAbonoVisible();
    $id('modal-title').textContent = 'Nueva venta';
    $id('modal-venta').classList.remove('hidden');
    $id('f-perfume').focus();
  }

  function cerrarModalVenta() {
    $id('modal-venta').classList.add('hidden');
  }

  function actualizarAbonoVisible() {
    var credito = document.querySelector('input[name="pago"]:checked').value === 'credito';
    $id('abono-group').style.display = credito ? 'block' : 'none';
    if (!credito) { $id('f-abono').value = ''; }
  }

  function guardarVenta() {
    var perfume = $id('f-perfume').value.trim();
    var precio = Number($id('f-precio').value) || 0;
    var costo = Number($id('f-costo').value) || 0;
    var pago = document.querySelector('input[name="pago"]:checked').value;
    var abono = pago === 'credito' ? (Number($id('f-abono').value) || 0) : 0;

    if (!perfume) { toast('Escribe el nombre del perfume'); return; }
    if (precio <= 0) { toast('Pon un precio válido'); return; }
    if (costo < 0) { toast('El costo no puede ser negativo'); return; }

    var venta = {
      perfume: perfume,
      precio: precio,
      costo: costo,
      pago: pago,
      abonos: pago === 'credito' && abono > 0 ? [{ monto: abono, fecha: new Date().toLocaleString() }] : [],
      fecha: new Date().toLocaleString()
    };

    llamarAPI('crearVenta', venta)
      .then(function () {
        cerrarModalVenta();
        toast('Venta registrada ✅');
        cargarVentas();
      })
      .catch(function (err) { toast('Error: ' + (err.message || '')); });
  }

  // ---------- Detalle y abonos ----------
  function abrirDetalle(id) {
    var v = estado.ventas.find(function (x) { return String(x.id) === String(id); });
    if (!v) return;
    estado.modalVentaId = id;

    $id('det-perfume').textContent = v.perfume;
    $id('det-info').innerHTML =
      'Precio: <b>' + dinero(v.precio) + '</b><br>' +
      'Costo: <b>' + dinero(v.costo) + '</b><br>' +
      'Pago: <b>' + (v.pago === 'contado' ? 'Contado' : 'Crédito') + '</b><br>' +
      (v.pago === 'credito'
        ? 'Abonado: <b>' + dinero(totalAbonado(v)) + '</b><br>Saldo: <b class="saldo">' + dinero(saldoVenta(v)) + '</b><br>Estado: <b>' + (esCancelado(v) ? 'Cancelado' : 'Pendiente') + '</b>'
        : 'Estado: <b>Cancelado</b>');

    renderAbonos(v);
    $id('d-abono').value = '';
    $id('modal-detalle').classList.remove('hidden');
  }

  function cerrarDetalle() {
    $id('modal-detalle').classList.add('hidden');
    estado.modalVentaId = null;
  }

  function renderAbonos(v) {
    var cont = $id('det-abonos');
    cont.innerHTML = '';
    var abonos = abonosVenta(v);
    if (abonos.length === 0) {
      cont.innerHTML = '<p class="empty">Sin abonos</p>';
    } else {
      abonos.slice().reverse().forEach(function (a) {
        var item = document.createElement('div');
        item.className = 'abono-item';
        item.innerHTML = '<span>' + dinero(a.monto) + '</span><span class="abono-fecha">' + esc(a.fecha || '') + '</span>';
        cont.appendChild(item);
      });
    }
  }

  function agregarAbono() {
    var id = estado.modalVentaId;
    var v = estado.ventas.find(function (x) { return String(x.id) === String(id); });
    if (!v) return;
    var monto = Number($id('d-abono').value) || 0;
    if (monto <= 0) { toast('Pon un abono válido'); return; }

    var vta = {
      id: id,
      monto: monto,
      fecha: new Date().toLocaleString()
    };
    llamarAPI('agregarAbono', vta)
      .then(function () {
        $id('d-abono').value = '';
        toast('Abono registrado ✅');
        abrirDetalle(id);
        cargarVentas();
      })
      .catch(function (err) { toast('Error: ' + (err.message || '')); });
  }

  // ---------- Eliminar ----------
  function eliminarVenta(id) {
    if (!confirm('¿Eliminar esta venta y todos sus abonos?')) return;
    llamarAPI('eliminarVenta', { id: id })
      .then(function () {
        toast('Venta eliminada');
        if (estado.modalVentaId === id) { cerrarDetalle(); }
        cargarVentas();
      })
      .catch(function (err) { toast('Error: ' + (err.message || '')); });
  }

  // ---------- Eventos ----------
  function bind() {
    $id('btn-save-url').addEventListener('click', function () {
      var u = $id('sheet-url').value.trim();
      if (!u) { toast('Pega la URL de conexión'); return; }
      estado.url = u;
      guardarURL();
      mostrarApp();
    });

    $id('btn-edit-url').addEventListener('click', function () {
      $id('sheet-url').value = estado.url || '';
      mostrarSetup(true);
    });

    $id('btn-refresh').addEventListener('click', function () {
      cargarVentas();
      toast('Actualizado');
    });

    $id('btn-nueva').addEventListener('click', abrirModalVenta);
    $id('btn-cancelar').addEventListener('click', cerrarModalVenta);
    $id('btn-guardar').addEventListener('click', guardarVenta);

    document.querySelectorAll('input[name="pago"]').forEach(function (r) {
      r.addEventListener('change', actualizarAbonoVisible);
    });

    $id('btn-agregar-abono').addEventListener('click', agregarAbono);
    $id('btn-cerrar-detalle').addEventListener('click', cerrarDetalle);

    // Enter en abono
    $id('d-abono').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { agregarAbono(); }
    });

    // Cerrar modales con tecla Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        cerrarModalVenta();
        cerrarDetalle();
      }
    });

    // Cerrar modal al hacer clic fuera del cuadro
    $id('modal-venta').addEventListener('click', function (e) {
      if (e.target === $id('modal-venta')) { cerrarModalVenta(); }
    });
    $id('modal-detalle').addEventListener('click', function (e) {
      if (e.target === $id('modal-detalle')) { cerrarDetalle(); }
    });
  }

  // ---------- Arranque ----------
  function init() {
    bind();
    iniciar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
