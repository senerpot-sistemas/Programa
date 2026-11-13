/**
 * NODIA — Nueva oferta: mejoras de uso diario (se carga después de oferta_wizard.js).
 *  1) Buscador de clientes (nombre, NIT, ciudad).        2) Tipo de trabajo siempre con opciones.
 *  3) Encabezados de «equipos» según la clase (sin «pad mounted» por defecto).
 *  4) Mover actividades y partidas arrastrando.          5) Paquetes de oferta (guardar, usar, actualizar, borrar) y «empezar desde…».
 *  6) Partidas: buscador del catálogo y de lo ya cotizado (último precio), pegar lista, ajustar precios, duplicar.
 * Todo lo que llena un paquete lo escribió y guardó una persona: el sistema no agrega contenido técnico por su cuenta.
 */
(function () {
  if (typeof WIZ === 'undefined' || typeof OFERTAS === 'undefined') return;
  const $ = id => document.getElementById(id), esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const pesos = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const num = s => { const n = parseFloat(String(s ?? '').replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
  const setv = (id, v) => { const e = $(id); if (!e) return; e.value = v == null ? '' : v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };

  // ───────────── Ventana emergente propia ─────────────
  WIZ.modal = function (titulo, html, ancho) {
    let m = $('wz-modal'); if (!m) { m = document.createElement('div'); m.id = 'wz-modal'; m.className = 'wz-modal'; m.innerHTML = '<div class="wz-modal-box" role="dialog" aria-modal="true"><div class="wz-modal-h"><span id="wz-modal-t"></span><button type="button" class="wz-x" onclick="WIZ.cerrarModal()" aria-label="Cerrar">×</button></div><div id="wz-modal-c"></div></div>'; m.addEventListener('mousedown', e => { if (e.target === m) WIZ.cerrarModal(); }); document.body.appendChild(m); }
    $('wz-modal-t').textContent = titulo; $('wz-modal-c').innerHTML = html; m.querySelector('.wz-modal-box').style.maxWidth = ancho || '640px'; m.classList.add('open');
  };
  WIZ.cerrarModal = function () { const m = $('wz-modal'); if (m) m.classList.remove('open'); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') WIZ.cerrarModal(); });

  // ───────────── Selector con buscador (reutilizable) ─────────────
  /** opciones(): [{texto, sub, valor}] · alElegir(opcion) · alEscribirLibre(texto) opcional (Enter sin coincidencia) */
  WIZ.combo = function (cfg) {
    const raiz = document.createElement('div'); raiz.className = 'wz-combo'; raiz.innerHTML = '<input type="text" class="wz-combo-in" autocomplete="off" placeholder="' + esc(cfg.placeholder || 'Buscar…') + '" aria-label="' + esc(cfg.placeholder || 'Buscar') + '"><div class="wz-combo-lista" role="listbox"></div>';
    const inp = raiz.querySelector('input'), lista = raiz.querySelector('.wz-combo-lista'); let ops = [], activo = -1;
    const pintar = () => {
      const q = norm(inp.value).split(' ').filter(Boolean); ops = cfg.opciones().filter(o => q.every(t => norm(o.texto + ' ' + (o.sub || '')).includes(t))).slice(0, 40); activo = ops.length ? 0 : -1;
      lista.innerHTML = ops.map((o, i) => '<div class="wz-combo-op' + (i === activo ? ' on' : '') + '" data-i="' + i + '" role="option"><div class="t">' + esc(o.texto) + '</div>' + (o.sub ? '<div class="s">' + esc(o.sub) + '</div>' : '') + '</div>').join('') +
        (cfg.alEscribirLibre && inp.value.trim() ? '<div class="wz-combo-op libre" data-libre="1"><div class="t">Agregar «' + esc(inp.value.trim().slice(0, 60)) + '» como partida nueva</div></div>' : '') +
        (!ops.length && !(cfg.alEscribirLibre && inp.value.trim()) ? '<div class="wz-combo-vacio">' + esc(cfg.vacio || 'Sin resultados') + '</div>' : '');
    };
    const abrir = () => { pintar(); lista.classList.add('open'); }, cerrar = () => lista.classList.remove('open');
    const elegir = i => { const o = ops[i]; if (!o) return; cerrar(); inp.value = cfg.mantenerTexto ? o.texto : ''; cfg.alElegir(o); if (!cfg.mantenerTexto) inp.blur(); };
    inp.addEventListener('focus', () => { if (cfg.mantenerTexto) inp.select(); abrir(); }); inp.addEventListener('input', abrir);
    inp.addEventListener('keydown', e => {
      const n = lista.querySelectorAll('.wz-combo-op[data-i]').length;
      if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(n - 1, activo + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(0, activo - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (activo >= 0 && ops[activo]) elegir(activo); else if (cfg.alEscribirLibre && inp.value.trim()) { cerrar(); cfg.alEscribirLibre(inp.value.trim()); inp.value = ''; } return; } else if (e.key === 'Escape') { cerrar(); return; } else return;
      lista.querySelectorAll('.wz-combo-op[data-i]').forEach((el, i) => el.classList.toggle('on', i === activo)); const el = lista.querySelector('.wz-combo-op.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    });
    lista.addEventListener('mousedown', e => { e.preventDefault(); const op = e.target.closest('.wz-combo-op'); if (!op) return; if (op.dataset.libre) { cerrar(); cfg.alEscribirLibre(inp.value.trim()); inp.value = ''; } else elegir(Number(op.dataset.i)); });
    document.addEventListener('mousedown', e => { if (!raiz.contains(e.target)) cerrar(); }); inp.addEventListener('blur', () => setTimeout(cerrar, 120));
    raiz.poner = t => { inp.value = t || ''; }; raiz.input = inp; return raiz;
  };

  // ───────────── 1) Buscador de clientes ─────────────
  function iniciarClientes() {
    const sel = $('of-cli-select'); if (!sel || sel.dataset.combo) return; sel.dataset.combo = '1'; sel.style.display = 'none';
    const combo = WIZ.combo({
      placeholder: 'Buscar cliente por nombre, NIT o ciudad…', mantenerTexto: true, vacio: 'No hay clientes con ese dato. Use «+ Nuevo cliente».',
      opciones: () => [...sel.options].filter(o => o.value).map(o => { let c = {}; try { c = JSON.parse(o.value); } catch (e) {} return { texto: o.text, sub: [c.NIT, c.CIUDAD].filter(Boolean).join(' · '), valor: o.value }; }),
      alElegir: o => { sel.value = o.valor; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    sel.insertAdjacentElement('beforebegin', combo); WIZ._comboCli = combo;
    WIZ.syncCliente = () => { const o = sel.options[sel.selectedIndex]; combo.poner(sel.value && o ? o.text : ''); };
    ['cargarCliente', 'limpiarCliente', 'renderSelectClientes'].forEach(n => { const f = OFERTAS[n].bind(OFERTAS); OFERTAS[n] = function (...a) { const r = f(...a); WIZ.syncCliente(); return r; }; });
    sel.addEventListener('change', WIZ.syncCliente); WIZ.syncCliente();
  }

  // ───────────── 2) Tipo de trabajo siempre con opciones ─────────────
  WIZ.tiposUnion = function () {
    if (this.clase()) return; const st = $('wz-tipo-trabajo'); if (!st) return; const actual = st.value, todos = [...new Set(Object.values(this.CLASES).flatMap(c => c.tipos))];
    st.innerHTML = '<option value="">— Seleccione —</option>' + todos.map(t => '<option>' + esc(t) + '</option>').join(''); st.value = actual;
  };

  // ───────────── 3) Equipos según la clase ─────────────
  const EQUIPOS = {
    TRAFO: { t: 'Transformadores a intervenir', th: ['Tipo', 'Marca', 'kVA', 'Serie', 'Tensión (V)'], ph: ['Ej.: en aceite, seco, pad mounted', '(opcional)', 'kVA', 'Serie', 'Tensión'] },
    PLANTA: { t: 'Plantas eléctricas a intervenir', th: ['Tipo', 'Marca', 'kVA', 'Serie', 'Tensión (V)'], ph: ['Ej.: diésel, gas', '(opcional)', 'kVA', 'Serie', 'Tensión'] },
    TABLERO: { t: 'Tableros, barras o acometidas', th: ['Tipo', 'Marca', 'Capacidad (kVA, si aplica)', 'Referencia / serie', 'Tensión (V)'], ph: ['Ej.: tablero general, blindobarra', '(opcional)', 'kVA', 'Referencia', 'Tensión'] },
    PRUEBAS: { t: 'Equipos a probar', th: ['Equipo', 'Marca', 'Capacidad (kVA, si aplica)', 'Serie', 'Tensión (V)'], ph: ['Ej.: transformador, celda', '(opcional)', 'kVA', 'Serie', 'Tensión'] },
    _: { t: 'Equipos o activos del cliente', th: ['Equipo', 'Marca', 'Capacidad (kVA, si aplica)', 'Serie', 'Tensión (V)'], ph: ['Ej.: transformador, planta, tablero', '(opcional)', 'kVA', 'Serie', 'Tensión'] }
  };
  WIZ.aplicarEquipos = function () {
    const e = EQUIPOS[this.clase()] || EQUIPOS._, sub = this.val('wz-subclase'), ph = e.ph.slice(); if (this.clase() === 'TRAFO' && sub) ph[0] = 'Ej.: ' + sub.toLowerCase();
    if ($('wz-act-titulo')) $('wz-act-titulo').textContent = e.t; ['tipo', 'marca', 'kva', 'serie', 'volt'].forEach((k, i) => { const th = $('wz-act-th-' + k); if (th) th.textContent = e.th[i]; document.querySelectorAll('#of-tbody-activos .act-' + k).forEach(inp => { inp.placeholder = ph[i]; }); });
  };

  // ───────────── 4) Mover arrastrando ─────────────
  WIZ.sortable = function (tbodyId, alTerminar) {
    const tb = $(tbodyId); if (!tb || tb.dataset.sortable) return; tb.dataset.sortable = '1';
    const poner = () => tb.querySelectorAll('tr').forEach(tr => { if (tr.querySelector('.wz-grip')) return; const celda = tr.firstElementChild; if (!celda) return; const g = document.createElement('span'); g.className = 'wz-grip'; g.title = 'Mantén presionado y arrastra para mover'; g.textContent = '⠿'; if (tbodyId === 'of-tbody-alcance') { celda.textContent = ''; celda.appendChild(g); } else celda.insertBefore(g, celda.firstChild); });
    new MutationObserver(poner).observe(tb, { childList: true }); poner();
    tb.addEventListener('pointerdown', e => {
      const g = e.target.closest('.wz-grip'); if (!g || e.button > 0) return; e.preventDefault(); const tr = g.closest('tr'); tr.classList.add('wz-arrastrando');
      const mover = ev => { const y = ev.clientY; if (y < 90) window.scrollBy(0, -14); else if (y > innerHeight - 130) window.scrollBy(0, 14); const filas = [...tb.children].filter(x => x !== tr); let destino = null; for (const f of filas) { const r = f.getBoundingClientRect(); if (y < r.top + r.height / 2) { destino = f; break; } } if (tr.nextElementSibling !== destino) tb.insertBefore(tr, destino); };
      // los eventos se escuchan en el documento: al mover la fila en el DOM el asa pierde la captura del puntero
      const fin = ev => { if (ev.type === 'pointerup') mover(ev); tr.classList.remove('wz-arrastrando'); document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', fin); document.removeEventListener('pointercancel', fin); if (alTerminar) alTerminar(); WIZ.alCambiar(); };
      document.addEventListener('pointermove', mover); document.addEventListener('pointerup', fin); document.addEventListener('pointercancel', fin);
    });
  };

  // ───────────── 5) Paquetes ─────────────
  const lineas = id => (($(id) && $(id).value) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  WIZ.empaquetar = function () {
    const items = [...document.querySelectorAll('#of-tbody-items tr')].map(tr => ({ desc: tr.querySelector('.inp-desc').value, un: tr.querySelector('.inp-un').value, cant: tr.querySelector('.inp-cant').value, val: tr.querySelector('.inp-val').value, iva: (tr.querySelector('.inp-iva') || {}).value || '19', fundamento: tr.dataset.fundamento || '', soporte: tr.dataset.soporte || '', hasta: tr.dataset.hasta || '' })).filter(i => i.desc.trim());
    return {
      v: 1, clase: this.clase(), subclase: this.val('wz-subclase'), tipoTrabajo: this.val('wz-tipo-trabajo'), plantilla: this.val('of-nd-servicio'), foto: this.val('of-nd-foto'), titulo: this.val('of-nd-titulo'), firmar: !!($('of-nd-firmar') && $('of-nd-firmar').checked),
      objeto: this.val('of-objeto'), alcanceGral: this.val('of-alcance-gral'), actividades: this.alcanceActs(), pruebas: lineas('of-nd-pruebas'), materiales: lineas('of-nd-materiales'), repuestos: lineas('of-nd-repuestos'), entregables: lineas('of-nd-entregables'), exclusiones: lineas('of-nd-exclusiones'), garantias: lineas('of-nd-garantias'),
      pagos: (typeof OFERTAS_NODIA !== 'undefined' && OFERTAS_NODIA.pagos ? OFERTAS_NODIA.pagos() : []).filter(p => p.pct > 0 || p.concepto), vigenciaDias: this.val('of-nd-vigencia'), tiempo: this.val('of-cond-tiempo'), notas: this.val('of-cond-notas'), responsabilidades: this.val('of-cond-resp'), garantiaTexto: this.val('of-cond-garantia'), condPago: this.val('of-cond-pago'), financieros: this.val('of-cond-financieros'),
      items, aiu: { activo: !!($('of-aiu-check') && $('of-aiu-check').checked), a: this.val('of-aiu-a'), i: this.val('of-aiu-i'), u: this.val('of-aiu-u') }
    };
  };
  WIZ.hayContenido = function () { return !!(this.val('of-objeto') || this.val('of-alcance-gral') || this.alcanceActs().length || this.partidas().some(p => p.desc.trim())); };
  WIZ.aplicarPaquete = function (p, silencioso) {
    if (!p) return; if (!silencioso && this.hayContenido() && !UI.confirmar('Este paquete va a reemplazar el objeto, el alcance, las partidas y las condiciones que ya escribiste. ¿Continuar?')) return false;
    setv('wz-clase', p.clase || ''); this.cambiarClase(true); setv('wz-subclase', p.subclase || ''); setv('wz-tipo-trabajo', p.tipoTrabajo || ''); if (p.plantilla) setv('of-nd-servicio', p.plantilla); this.fotoManual = !!p.foto && p.foto !== 'NINGUNA'; if (p.foto) setv('of-nd-foto', p.foto);
    setv('of-nd-titulo', p.titulo || ''); if ($('of-nd-firmar')) $('of-nd-firmar').checked = !!p.firmar; setv('of-objeto', p.objeto); setv('of-alcance-gral', p.alcanceGral);
    $('of-tbody-alcance').innerHTML = ''; (p.actividades || []).forEach(t => OFERTAS.addAlcance(t));
    [['of-nd-pruebas', 'pruebas'], ['of-nd-materiales', 'materiales'], ['of-nd-repuestos', 'repuestos'], ['of-nd-entregables', 'entregables'], ['of-nd-exclusiones', 'exclusiones'], ['of-nd-garantias', 'garantias']].forEach(([id, k]) => setv(id, (p[k] || []).join('\n')));
    if (p.vigenciaDias) setv('of-nd-vigencia', p.vigenciaDias); setv('of-cond-tiempo', p.tiempo); setv('of-cond-notas', p.notas); setv('of-cond-resp', p.responsabilidades); setv('of-cond-garantia', p.garantiaTexto); if (p.condPago) setv('of-cond-pago', p.condPago); if (p.financieros) setv('of-cond-financieros', p.financieros);
    $('of-nd-tbody-pagos').innerHTML = ''; (p.pagos || []).forEach(x => OFERTAS_NODIA.agregarPago(x.pct, x.concepto)); if (!(p.pagos || []).length && this.esNodia()) { OFERTAS_NODIA.agregarPago(50, 'A la aceptación de la oferta.'); OFERTAS_NODIA.agregarPago(50, 'Contra entrega del informe final.'); }
    $('of-tbody-items').innerHTML = ''; (p.items || []).forEach(i => { OFERTAS.addFila({ desc: i.desc, cant: i.cant, val: i.val, iva: i.iva, fundamento: i.fundamento, soporte: i.soporte, hasta: i.hasta }); const un = document.querySelector('#of-tbody-items tr:last-child .inp-un'); if (un && i.un) un.value = i.un; });
    const ai = p.aiu || {}; if ($('of-aiu-check')) { $('of-aiu-check').checked = !!ai.activo; if (ai.a !== '' && ai.a != null) setv('of-aiu-a', ai.a); if (ai.i !== '' && ai.i != null) setv('of-aiu-i', ai.i); if (ai.u !== '' && ai.u != null) setv('of-aiu-u', ai.u); OFERTAS.toggleAIU(); }
    OFERTAS.calcularTotales(); if (typeof OFERTAS_NODIA !== 'undefined') { OFERTAS_NODIA.pintarPagos(); OFERTAS_NODIA.refrescarSoporte(); } this.aplicarRelevancia(); this.sugerirFoto(); if (p.foto) setv('of-nd-foto', p.foto); this.alCambiar(); return true;
  };
  const paquetes = () => (OFERTAS.DB.kits || []).filter(k => String(k.TIPO).toUpperCase() === 'PAQUETE');
  const resumenPaquete = d => { let p = {}; try { p = JSON.parse(d); } catch (e) {} const c = (WIZ.CLASES[p.clase] || {}).txt || 'Sin clase'; return c + (p.tipoTrabajo ? ' · ' + p.tipoTrabajo : '') + ' · ' + (p.items || []).length + ' partidas · ' + (p.actividades || []).length + ' actividades'; };
  WIZ.verPaquetes = function (modo) {
    const kits = (OFERTAS.DB.kits || []), pq = paquetes(), sueltos = kits.filter(k => ['TEXTOS', 'ITEMS'].includes(String(k.TIPO).toUpperCase()));
    const fila = (k, i, esPaq) => '<div class="wz-pq" data-n="' + esc(norm(k.NOMBRE)) + '"><div class="wz-pq-t"><b>' + esc(k.NOMBRE) + '</b><div class="wz-pq-s">' + (esPaq ? esc(resumenPaquete(k.DATA_JSON)) : 'Kit de ' + (String(k.TIPO).toUpperCase() === 'TEXTOS' ? 'textos (objeto y alcance)' : 'precios (partidas)')) + '</div></div><div class="wz-pq-a">' +
      '<button type="button" class="wz-btn pri sm" onclick="WIZ.usarPaquete(' + i + ',' + (esPaq ? 1 : 0) + ')">Usar</button>' + (esPaq ? '<button type="button" class="wz-btn ghost sm" onclick="WIZ.renombrarPaquete(' + i + ')">Renombrar</button>' : '') + '<button type="button" class="wz-btn del sm" onclick="WIZ.borrarKit(' + i + ',' + (esPaq ? 1 : 0) + ')">Eliminar</button></div></div>';
    this._lp = pq; this._ls = sueltos;
    this.modal('Paquetes y kits', '<input type="search" id="wz-pq-q" class="wz-combo-in" placeholder="Buscar por nombre…" oninput="WIZ.filtrarPaquetes(this.value)" aria-label="Buscar paquete"><div class="wz-nota">Un <b>paquete</b> reúne todo lo de una oferta (clase, textos, actividades, partidas, pagos, vigencia, garantías…). Para crear uno: arme la oferta y use «Guardar toda la oferta como paquete» (etapa 2, junto a Objeto y alcance). Para modificarlo: úselo, cambie lo que necesite y guárdelo con el mismo nombre.</div>' +
      '<h4 class="wz-h4">Paquetes (' + pq.length + ')</h4><div id="wz-pq-lista">' + (pq.length ? pq.map((k, i) => fila(k, i, true)).join('') : '<div class="wz-vacio">Aún no hay paquetes. Arme una oferta y guárdela como paquete.</div>') + '</div>' +
      '<h4 class="wz-h4">Kits que ya tienes (' + sueltos.length + ')</h4><div id="wz-ks-lista">' + sueltos.map((k, i) => fila(k, i, false)).join('') + '</div>', '720px'); setTimeout(() => $('wz-pq-q') && $('wz-pq-q').focus(), 50);
  };
  WIZ.filtrarPaquetes = function (t) { const q = norm(t).split(' ').filter(Boolean); document.querySelectorAll('#wz-modal .wz-pq').forEach(e => { e.style.display = q.every(x => e.dataset.n.includes(x)) ? '' : 'none'; }); };
  WIZ.usarPaquete = function (i, esPaq) {
    if (esPaq) { const k = this._lp[i]; let p; try { p = JSON.parse(k.DATA_JSON); } catch (e) { UI.toast('El paquete está dañado', 'err'); return; } if (this.aplicarPaquete(p) !== false) { this.cerrarModal(); UI.toast('Paquete «' + k.NOMBRE + '» aplicado. Revise cliente, cantidades y precios.', 'ok'); this.ir(1, true); } }
    else { const k = this._ls[i]; this.cerrarModal(); OFERTAS.aplicarKit(String(k.TIPO).toUpperCase(), k.DATA_JSON); this.alCambiar(); UI.toast('Kit «' + k.NOMBRE + '» aplicado', 'ok'); }
  };
  WIZ.guardarComoPaquete = async function () {
    if (!this.hayContenido()) { UI.toast('Primero arme la oferta (objeto, actividades o partidas) para guardarla como paquete', 'warn'); return; }
    const sugerido = (this.val('of-nd-titulo') || this.val('of-objeto')).slice(0, 80);
    this.pedirNombre('Guardar toda la oferta como paquete', sugerido, 'Guardar paquete', 'Si ya existe un paquete con ese nombre, se actualiza con lo que hay en pantalla.', nombre => this._guardarPaquete(nombre));
  };
  /** Ventana para escribir un nombre (reemplaza a prompt(), que el navegador puede bloquear). */
  WIZ.pedirNombre = function (titulo, inicial, boton, nota, alAceptar) {
    this.modal(titulo, '<div class="field-group"><label for="wz-nom">Nombre</label><input type="text" id="wz-nom" maxlength="120" class="wz-combo-in" value="' + esc(inicial) + '"></div><div class="wz-nota">' + esc(nota) + '</div><div class="wz-botones"><button type="button" class="wz-btn ghost" onclick="WIZ.cerrarModal()">Cancelar</button><button type="button" class="wz-btn pri" id="wz-nom-ok">' + esc(boton) + '</button></div>', '480px');
    const inp = $('wz-nom'), ok = () => { const n = inp.value.trim(); if (!n) { UI.toast('Escriba un nombre', 'warn'); return; } WIZ.cerrarModal(); alAceptar(n); };
    $('wz-nom-ok').onclick = ok; inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }); setTimeout(() => { inp.focus(); inp.select(); }, 50);
  };
  WIZ._guardarPaquete = async function (nombre) {
    UI.toast('Guardando paquete…', 'info');
    const existe = paquetes().some(k => norm(k.NOMBRE) === norm(nombre)); if (existe && !UI.confirmar('Ya existe un paquete llamado «' + nombre + '». ¿Reemplazar su contenido con lo que hay en pantalla?')) return;
    try { const r = await API.call('guardarPaquete', { nombre, tipo: 'PAQUETE', dataJson: JSON.stringify(this.empaquetar()) }); if (!r || r.exito === false) { UI.toast((r && r.error) || 'No se pudo guardar', 'err'); return; } OFERTAS.DB.kits = (OFERTAS.DB.kits || []).filter(k => !(String(k.TIPO).toUpperCase() === 'PAQUETE' && norm(k.NOMBRE) === norm(nombre))); OFERTAS.DB.kits.push(r.data); if (typeof DatosERP !== 'undefined') DatosERP.invalidar(); UI.toast(r.creado ? 'Paquete «' + nombre + '» creado' : 'Paquete «' + nombre + '» actualizado', 'ok'); } catch (e) { UI.toast(e.message, 'err'); }
  };
  WIZ.renombrarPaquete = async function (i) {
    const k = this._lp[i]; this.pedirNombre('Renombrar paquete', k.NOMBRE, 'Renombrar', 'El contenido del paquete no cambia.', nuevo => this._renombrar(k, nuevo));
  };
  WIZ._renombrar = async function (k, nuevo) {
    if (nuevo === k.NOMBRE) return; if (paquetes().some(x => norm(x.NOMBRE) === norm(nuevo) && x.NOMBRE !== k.NOMBRE)) { UI.toast('Ya existe un paquete con ese nombre', 'err'); return; }
    try { const a = await API.call('guardarPaquete', { nombre: nuevo, tipo: 'PAQUETE', dataJson: k.DATA_JSON }); if (a.exito === false) { UI.toast(a.error, 'err'); return; } await API.call('eliminarKitPorNombre', { nombre: k.NOMBRE, tipo: 'PAQUETE' }); OFERTAS.DB.kits = OFERTAS.DB.kits.filter(x => !(String(x.TIPO).toUpperCase() === 'PAQUETE' && x.NOMBRE === k.NOMBRE)); OFERTAS.DB.kits.push(a.data); DatosERP.invalidar(); this.verPaquetes(); UI.toast('Renombrado', 'ok'); } catch (e) { UI.toast(e.message, 'err'); }
  };
  WIZ.borrarKit = async function (i, esPaq) {
    const k = (esPaq ? this._lp : this._ls)[i]; if (!UI.confirmar('¿Eliminar «' + k.NOMBRE + '»? No se puede deshacer.')) return;
    try { const r = await API.call('eliminarKitPorNombre', { nombre: k.NOMBRE, tipo: String(k.TIPO).toUpperCase() }); if (r.exito === false) { UI.toast(r.error, 'err'); return; } OFERTAS.DB.kits = OFERTAS.DB.kits.filter(x => !(String(x.TIPO).toUpperCase() === String(k.TIPO).toUpperCase() && x.NOMBRE === k.NOMBRE)); DatosERP.invalidar(); OFERTAS.renderSelectKits(); this.verPaquetes(); UI.toast('Eliminado', 'ok'); } catch (e) { UI.toast(e.message, 'err'); }
  };
  WIZ.desdeOfertaAnterior = function () {
    const h = (OFERTAS.DB.historial || []).slice().reverse();
    this.modal('Empezar desde una oferta anterior', '<input type="search" id="wz-oa-q" class="wz-combo-in" placeholder="Buscar por número, cliente o valor…" oninput="WIZ.filtrarOfertas(this.value)" aria-label="Buscar oferta"><div class="wz-nota">Se copian el cliente, el objeto, las actividades, las partidas y las condiciones. El consecutivo es nuevo; puede cambiar todo.</div><div id="wz-oa-lista">' +
      h.slice(0, 300).map(o => '<div class="wz-pq" data-n="' + esc(norm(o.ID_OFERTA + ' ' + o.CLIENTE + ' ' + o.TOTAL)) + '"><div class="wz-pq-t"><b>' + esc(o.ID_OFERTA) + '</b> · ' + esc(o.CLIENTE) + '<div class="wz-pq-s">' + esc(o.TOTAL) + ' · ' + esc(o.ESTADO) + '</div></div><div class="wz-pq-a"><button type="button" class="wz-btn pri sm" onclick="WIZ.usarOferta(\'' + esc(o.ID_OFERTA) + '\')">Usar como base</button></div></div>').join('') + '</div>', '720px'); setTimeout(() => $('wz-oa-q') && $('wz-oa-q').focus(), 50);
  };
  WIZ.filtrarOfertas = function (t) { const q = norm(t).split(' ').filter(Boolean); document.querySelectorAll('#wz-oa-lista .wz-pq').forEach(e => { e.style.display = q.every(x => e.dataset.n.includes(x)) ? '' : 'none'; }); };
  WIZ.usarOferta = async function (id) {
    if (this.hayContenido() && !UI.confirmar('Se reemplazará lo que ya escribiste con los datos de la oferta ' + id + '. ¿Continuar?')) return; this.cerrarModal(); await OFERTAS.gestionarOferta(id, 'CLONAR'); this.ir(1, true); UI.toast('Oferta ' + id + ' cargada como base. Revise todo antes de generar.', 'ok');
  };
  /** Deja la oferta en blanco SIN recargar la página (recargar mandaba a la pantalla de inicio de la app). */
  WIZ.enBlanco = function () {
    if (this.hayContenido() && !UI.confirmar('Se borrará lo que ya escribiste. ¿Empezar en blanco?')) return;
    const SALVAR = ['of-consecutivo'];   // formato y serie vuelven a su valor inicial (PDF NODIA, DIV); el consecutivo se vuelve a sugerir
    document.querySelectorAll('#wz input, #wz textarea, #wz select').forEach(e => {
      if (!e.id || SALVAR.includes(e.id) || e.closest('#wz-modal') || e.closest('tbody') || e.id === 'wz-nom') return;
      if (e.type === 'checkbox' || e.type === 'radio') e.checked = e.defaultChecked;
      else if (e.tagName === 'SELECT') { const d = [...e.options].findIndex(o => o.defaultSelected); e.selectedIndex = d >= 0 ? d : 0; }
      else e.value = e.defaultValue || '';
    });
    OFERTAS.limpiarCliente(); if (this.limpiarSolar) { $('wz-solar-json').value = ''; this.leerSolar(); }
    ['of-tbody-activos', 'of-tbody-alcance', 'of-tbody-items', 'of-nd-tbody-pagos'].forEach(id => { const t = $(id); if (t) t.innerHTML = ''; });
    OFERTAS.addActivo(); OFERTAS.addAlcance(); OFERTAS.toggleAIU(); OFERTAS.calcularTotales();
    if (typeof OFERTAS_NODIA !== 'undefined') { OFERTAS_NODIA.cambiarFormato(); OFERTAS_NODIA.refrescarSoporte && OFERTAS_NODIA.refrescarSoporte(); OFERTAS_NODIA.pintarPagos(); }
    this.fotoManual = false; this.cambiarClase(true); OFERTAS.sugerirConsecutivoPorTipo(true); this.descartarLocal();
    this.ir(1, true); this.alCambiar(); UI.toast('Oferta en blanco lista', 'ok');
    const t = $('wz'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' });
  };

  // ───────────── 6) Partidas: buscador, pegar lista, ajustar precios, duplicar ─────────────
  WIZ._frecuentes = null;
  WIZ.cargarFrecuentes = async function () { if (this._frecuentes || this._cargandoFrec) return; this._cargandoFrec = true; try { const r = await API.call('partidasFrecuentes', {}); this._frecuentes = (r && r.partidas) || []; } catch (e) { this._frecuentes = []; } this._cargandoFrec = false; };
  function opcionesPartidas() {
    const vistos = new Set(), out = [];
    (WIZ._frecuentes || []).forEach(f => { const k = norm(f.desc).slice(0, 90); vistos.add(k); out.push({ texto: f.desc, sub: 'Cotizada ' + f.veces + (f.veces === 1 ? ' vez' : ' veces') + (f.ultimo ? ' · último precio ' + pesos(f.ultimo) + (f.min && f.max && f.min !== f.max ? ' (rango ' + pesos(f.min) + ' – ' + pesos(f.max) + ')' : '') + ' · ' + f.oferta : ''), valor: { desc: f.desc, val: f.ultimo || 0, un: f.unidad || 'UN' } }); });
    ((OFERTAS.DB && OFERTAS.DB.items) || []).forEach(i => { const d = i.DESCRIPCION_SERVICIO || i.DESCRIPCION || ''; if (!d || vistos.has(norm(d).slice(0, 90))) return; out.push({ texto: d, sub: 'Catálogo' + (i.PRECIO_VENTA_LISTA ? ' · precio de lista ' + pesos(i.PRECIO_VENTA_LISTA) : ''), valor: { desc: d, val: num(i.PRECIO_VENTA_LISTA || i.PRECIO || 0), un: i.UNIDAD || 'UN', cod: i.CODIGO || '' } }); });
    return out;
  }
  function iniciarPartidas() {
    const sel = $('of-sel-item-db'); if (!sel || sel.dataset.combo) return; sel.dataset.combo = '1'; const fila = sel.closest('.cat-add-row'); sel.style.display = 'none'; const btn = fila && fila.querySelector('button'); if (btn) btn.style.display = 'none';
    const combo = WIZ.combo({ placeholder: 'Buscar partida ya cotizada o del catálogo…', opciones: opcionesPartidas, vacio: 'Sin coincidencias',
      alElegir: o => { OFERTAS.addFila({ desc: o.valor.desc, cant: 1, val: o.valor.val, cod: o.valor.cod || '' }); const t = document.querySelector('#of-tbody-items tr:last-child .inp-un'); if (t && o.valor.un) t.value = o.valor.un; WIZ.alCambiar(); UI.toast(o.valor.val ? 'Partida agregada con el último precio usado: revíselo.' : 'Partida agregada', 'ok'); },
      alEscribirLibre: t => { OFERTAS.addFila({ desc: t, cant: 1, val: 0 }); WIZ.alCambiar(); } });
    fila.insertBefore(combo, fila.firstChild); combo.input.addEventListener('focus', () => WIZ.cargarFrecuentes());
    const barra = document.createElement('div'); barra.className = 'wz-barra-partidas';
    barra.innerHTML = '<button type="button" class="wz-mini" onclick="WIZ.pegarPartidas()">Pegar lista de partidas</button><button type="button" class="wz-mini" onclick="WIZ.ajustarPrecios()">Ajustar precios en %</button><span class="wz-hint">Arrastre ⠿ para ordenar · ⧉ duplica una partida</span>'; fila.insertAdjacentElement('afterend', barra);
  }
  WIZ.pegarPartidas = function () {
    this.modal('Pegar lista de partidas', '<div class="wz-nota">Una partida por línea: <b>descripción ; cantidad ; valor unitario</b>. También sirve copiar y pegar desde Excel (columnas separadas por tabulación). Cantidad y valor son opcionales.</div><textarea id="wz-pp-t" rows="9" class="wz-ta" placeholder="Limpieza y lavado de transformador ; 1 ; 150000&#10;Pruebas eléctricas megger ; 1 ; 350000"></textarea><div id="wz-pp-r" class="wz-nota"></div><div class="wz-botones"><button type="button" class="wz-btn ghost" onclick="WIZ.cerrarModal()">Cancelar</button><button type="button" class="wz-btn pri" onclick="WIZ.confirmarPegado()">Agregar partidas</button></div>');
    $('wz-pp-t').addEventListener('input', () => { $('wz-pp-r').textContent = WIZ._parsePartidas($('wz-pp-t').value).length + ' partidas detectadas'; }); setTimeout(() => $('wz-pp-t') && $('wz-pp-t').focus(), 50);
  };
  WIZ._parsePartidas = function (t) { return String(t || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const c = l.split(/\t|;|\s\|\s/).map(x => x.trim()); return { desc: c[0], cant: c[1] ? (num(c[1]) || 1) : 1, val: c[2] ? num(c[2]) : 0 }; }).filter(x => x.desc && x.desc.length > 1); };
  WIZ.confirmarPegado = function () { const l = this._parsePartidas($('wz-pp-t').value); if (!l.length) { UI.toast('No se detectó ninguna partida', 'warn'); return; } l.forEach(x => OFERTAS.addFila(x)); this.cerrarModal(); this.alCambiar(); UI.toast(l.length + ' partidas agregadas', 'ok'); };
  WIZ.pegarActividades = function () {
    this.modal('Pegar varias actividades', '<div class="wz-nota">Una actividad por línea. Se agregan al final del alcance detallado.</div><textarea id="wz-pa-t" rows="9" class="wz-ta"></textarea><div class="wz-botones"><button type="button" class="wz-btn ghost" onclick="WIZ.cerrarModal()">Cancelar</button><button type="button" class="wz-btn pri" onclick="WIZ.confirmarPegadoAct()">Agregar actividades</button></div>'); setTimeout(() => $('wz-pa-t') && $('wz-pa-t').focus(), 50);
  };
  WIZ.confirmarPegadoAct = function () { const l = ($('wz-pa-t').value || '').split(/\r?\n/).map(s => s.replace(/^[\s\-•*·\d.)]+/, '').trim()).filter(Boolean); if (!l.length) { UI.toast('No hay actividades', 'warn'); return; } l.forEach(t => OFERTAS.addAlcance(t)); this.cerrarModal(); this.alCambiar(); UI.toast(l.length + ' actividades agregadas', 'ok'); };
  WIZ.ajustarPrecios = function () {
    if (!document.querySelector('#of-tbody-items tr')) { UI.toast('Aún no hay partidas', 'warn'); return; }
    this.modal('Ajustar precios', '<div class="wz-nota">Sube o baja el valor unitario de <b>todas</b> las partidas. Use un número negativo para bajar (ej. −5).</div><div class="wz-grid"><div class="field-group"><label for="wz-aj-p">Porcentaje (%)</label><input type="number" id="wz-aj-p" step="0.1" placeholder="Ej.: 8"></div><div class="field-group"><label class="wz-check" style="margin-top:22px"><input type="checkbox" id="wz-aj-r" checked> Redondear a miles</label></div></div><div class="wz-botones"><button type="button" class="wz-btn ghost" onclick="WIZ.cerrarModal()">Cancelar</button><button type="button" class="wz-btn pri" onclick="WIZ.aplicarAjuste()">Aplicar</button></div>'); setTimeout(() => $('wz-aj-p') && $('wz-aj-p').focus(), 50);
  };
  WIZ.aplicarAjuste = function () {
    const p = parseFloat($('wz-aj-p').value); if (isNaN(p) || p === 0) { UI.toast('Indique un porcentaje', 'warn'); return; } const red = $('wz-aj-r').checked;
    document.querySelectorAll('#of-tbody-items tr').forEach(tr => { const v = tr.querySelector('.inp-val'), u = parseFloat(v.value) || 0; if (!u) return; let n = u * (1 + p / 100); n = red ? Math.round(n / 1000) * 1000 : Math.round(n); v.value = n; OFERTAS.calcFila(v); });
    this.cerrarModal(); OFERTAS.calcularTotales(); this.alCambiar(); UI.toast('Precios ajustados ' + (p > 0 ? '+' : '') + p + ' %', 'ok');
  };
  WIZ.duplicarFila = function (btn) {
    const tr = btn.closest('tr'), d = { desc: tr.querySelector('.inp-desc').value, cant: tr.querySelector('.inp-cant').value, val: tr.querySelector('.inp-val').value, iva: (tr.querySelector('.inp-iva') || {}).value || '19', fundamento: tr.dataset.fundamento, soporte: tr.dataset.soporte, hasta: tr.dataset.hasta };
    OFERTAS.addFila(d); const nueva = document.querySelector('#of-tbody-items tr:last-child'); const un = tr.querySelector('.inp-un'); if (un) nueva.querySelector('.inp-un').value = un.value; tr.insertAdjacentElement('afterend', nueva); OFERTAS.renumerarItems(); OFERTAS.calcularTotales(); this.alCambiar();
  };
  function botonDuplicar() {
    const tb = $('of-tbody-items'); if (!tb || tb.dataset.dup) return; tb.dataset.dup = '1';
    const poner = () => tb.querySelectorAll('tr').forEach(tr => { const c = tr.lastElementChild; if (!c || c.querySelector('.wz-dup')) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-icon wz-dup'; b.title = 'Duplicar esta partida'; b.textContent = '⧉'; b.setAttribute('onclick', 'WIZ.duplicarFila(this)'); const borrar = c.querySelector('.btn-icon-del'); c.insertBefore(b, borrar || null); });
    new MutationObserver(poner).observe(tb, { childList: true }); poner();
  }

  // ───────────── Arranque ─────────────
  function iniciar() {
    iniciarClientes(); iniciarPartidas(); botonDuplicar(); WIZ.sortable('of-tbody-alcance'); WIZ.sortable('of-tbody-items', () => { OFERTAS.renumerarItems(); OFERTAS.calcularTotales(); });
    // Textos con comillas o «<» se rompían al dibujar la fila: se asignan por DOM, no por HTML
    const aal = OFERTAS.addAlcance.bind(OFERTAS); OFERTAS.addAlcance = function (t = '') { aal(''); const i = document.querySelector('#of-tbody-alcance tr:last-child .inp-alcance'); if (i) i.value = t; };
    const afi = OFERTAS.addFila.bind(OFERTAS); OFERTAS.addFila = function (d = null) { afi(d && d.desc ? Object.assign({}, d, { desc: '' }) : d); if (d && d.desc) { const i = document.querySelector('#of-tbody-items tr:last-child .inp-desc'); if (i) i.value = d.desc; } };
    const aa = OFERTAS.addActivo.bind(OFERTAS); OFERTAS.addActivo = function (data) {
      const filas = document.querySelectorAll('#of-tbody-activos tr');   // si solo hay la fila vacía inicial y llegan datos, se usa esa fila
      if (data && data.tipo && filas.length === 1 && ['.act-tipo', '.act-marca', '.act-kva', '.act-serie', '.act-volt'].every(s => !filas[0].querySelector(s).value)) filas[0].remove();
      aa(data); const tr = document.querySelector('#of-tbody-activos tr:last-child'); if (tr && !(data && data.tipo)) { const t = tr.querySelector('.act-tipo'); if (t && t.value === 'PAD MOUNTED') t.value = ''; } WIZ.aplicarEquipos(); };
    document.querySelectorAll('#of-tbody-activos tr').forEach(tr => { const t = tr.querySelector('.act-tipo'); if (t && t.value === 'PAD MOUNTED' && !['.act-marca', '.act-kva', '.act-serie', '.act-volt'].some(s => tr.querySelector(s).value)) t.value = ''; });
    const cc = WIZ.cambiarClase.bind(WIZ); WIZ.cambiarClase = function (u) { cc(u); WIZ.tiposUnion(); WIZ.aplicarEquipos(); }; const cs = WIZ.cambiarSubclase.bind(WIZ); WIZ.cambiarSubclase = function () { cs(); WIZ.aplicarEquipos(); };
    WIZ.tiposUnion(); WIZ.aplicarEquipos(); WIZ.cargarFrecuentes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(iniciar, 0)); else setTimeout(iniciar, 0);
})();
