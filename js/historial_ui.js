/**
 * NODIA — Historial de ofertas (copia aislada). Tabla en escritorio, tarjetas en celular, filtros del servidor, avisos de seguimiento,
 * acciones con motivo/confirmación y bitácora. Habla con las acciones hist* del backend (paginación y filtros se calculan en el servidor).
 */
const HX = {
  est: { pagina: 1, tamano: 25, busqueda: '', orden: 'fecha_desc', vista: 'activas', clase: '', cargando: false, listo: null, filas: [], pag: null, resumen: null, avisos: null, papelera: false, ult: 0 },
  VISTAS: [
    ['activas', 'Activas', () => ({ archivadas: 'NO' }), r => r.total - (r.archivadas || 0)],
    ['aviso', 'Con aviso', () => ({ conAviso: true }), r => r.conAviso],
    ['sinenvio', 'Sin enviar', () => ({ estadoBD: ['GENERADA'], envio: 'NO' }), r => r.porSituacion.GEN_SIN_ENVIO],
    ['enviadas', 'Enviadas', () => ({ estadoBD: ['GENERADA'], envio: 'SI' }), null],
    ['aprobadas', 'Aprobadas', () => ({ estadoBD: ['APROBADA'], archivadas: 'TODAS' }), r => r.porEstadoBD.APROBADA],
    ['rechazadas', 'Rechazadas', () => ({ estadoBD: ['RECHAZADA'], archivadas: 'TODAS' }), r => r.porEstadoBD.RECHAZADA],
    ['cerradas', 'Cerradas', () => ({ cerradas: 'SI' }), r => r.cerradas],
    ['archivadas', 'Archivadas', () => ({ archivadas: 'SOLO' }), r => r.archivadas],
    ['todas', 'Todas', () => ({ archivadas: 'TODAS' }), r => r.total]
  ],
  SIT: { GEN_SIN_ENVIO: ['Generada · sin enviar', 'amb'], ENV_AL_DIA: ['Enviada · al día', 'ver'], ENV_SEG1: ['Seguimiento 1', 'roj'], ENV_SEG2: ['Seguimiento 2', 'roj'], ENV_REPROG: ['Seguimiento reprogramado', 'roj'], ENV_DECIDIR: ['Decidir cierre', 'roj'],
         APROBADA: ['Aprobada', 'ver'], RECHAZADA: ['Rechazada', 'gri'], CERRADA: ['Cerrada', 'gri'], BORRADOR: ['Borrador', 'azu'], ERROR: ['Con error', 'roj'] },
  AVISO: { A1: '¿Enviaste esta oferta?', A2: 'Seguimiento 1', A3: 'Seguimiento 2', A4: 'Seguimiento reprogramado', A5: 'Decidir: cerrar, reprogramar o dar seguimiento' },
  CLASES: ['Fotovoltaico', 'Transformadores y subestaciones', 'Plantas eléctricas', 'Tableros, barras y acometidas', 'Pruebas y diagnósticos', 'Diseño, ingeniería y trámites', 'Suministro de personal / SST', 'Otros'],
  CANALES: ['Correo', 'WhatsApp', 'Entrega en persona', 'Otro'],
  $(id) { return document.getElementById(id); },
  esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  rol() { return sessionStorage.getItem('senerpot_rol') || ''; },
  priv() { return ['ADMINISTRADOR', 'INGENIERIA'].includes(this.rol()); },
  pesos(n) { return '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO'); },
  fecha(iso) { if (!iso) return '—'; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso); },
  uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'op-' + Date.now() + '-' + Math.random().toString(16).slice(2)); },

  // ───────────────────────── Arranque ─────────────────────────
  init() {
    if (this._ok || !this.$('ov-historial')) return; this._ok = true;
    const v = this.$('ov-historial'), legacy = [...v.children]; const raiz = document.createElement('div'); raiz.id = 'hx-root'; raiz.className = 'hx';
    const leg = document.createElement('div'); leg.id = 'hx-legacy'; leg.style.display = 'none'; legacy.forEach(c => leg.appendChild(c)); v.appendChild(raiz); v.appendChild(leg);
    raiz.innerHTML = `
      <div class="hx-head"><div><div class="hx-kicker">Seguimiento comercial</div><h2 class="hx-h">Historial de ofertas</h2><div class="hx-sub" id="hx-sub">Cargando…</div></div>
        <div class="hx-head-r"><button type="button" class="hx-btn sec" id="hx-btn-papelera" onclick="HX.verPapelera()" style="display:none">Papelera</button><button type="button" class="hx-btn sec" onclick="HX.cargar(true)">Actualizar</button></div></div>
      <div id="hx-avisos" class="hx-avisos" style="display:none"></div>
      <div id="hx-aviso-ini" class="hx-ini" style="display:none"></div>
      <div class="hx-chips" id="hx-chips"></div>
      <div class="hx-tools">
        <input type="search" id="hx-q" placeholder="Buscar por N.º de oferta o cliente…" oninput="HX.buscar(this.value)" aria-label="Buscar">
        <select id="hx-clase" onchange="HX.est.clase=this.value; HX.cargar(true)" aria-label="Clase"><option value="">Todas las clases</option><option value="__PEND__">Sin clasificar</option></select>
        <select id="hx-orden" onchange="HX.est.orden=this.value; HX.cargar(true)" aria-label="Orden">
          <option value="fecha_desc">Más recientes primero</option><option value="fecha_asc">Más antiguas primero</option><option value="total_desc">Mayor valor</option><option value="total_asc">Menor valor</option>
          <option value="cliente_asc">Cliente A–Z</option><option value="antiguedad_desc">Más días sin cerrar</option><option value="numero_desc">N.º de oferta ↓</option></select>
        <button type="button" class="hx-btn ghost" onclick="HX.limpiar()">Limpiar</button>
      </div>
      <details class="hx-mas" id="hx-mas"><summary>Más filtros <span class="hx-badge azu" id="hx-mas-n" style="display:none"></span></summary>
        <div class="hx-mas-g">
          <label>Estado de la oferta<select id="hx-f-estado" onchange="HX.filtroExtra()"><option value="">Cualquiera</option><option>GENERADA</option><option>APROBADA</option><option>RECHAZADA</option><option>BORRADOR</option></select></label>
          <label>Documento<select id="hx-f-doc" onchange="HX.filtroExtra()"><option value="">Cualquiera</option><option value="VIGENTE">NODIA vigente</option><option value="VENCIDO">NODIA vencido</option><option value="ANULADO">NODIA anulado</option><option value="SIN">Sin PDF</option></select></label>
          <label>Envío<select id="hx-f-envio" onchange="HX.filtroExtra()"><option value="">Cualquiera</option><option value="SI">Enviadas</option><option value="NO">Sin enviar</option></select></label>
          <label>Generada desde<input type="date" id="hx-f-desde" onchange="HX.filtroExtra()"></label>
          <label>Generada hasta<input type="date" id="hx-f-hasta" onchange="HX.filtroExtra()"></label>
          <label>Antigüedad mínima (días)<input type="number" id="hx-f-ant" min="0" placeholder="Ej.: 15" onchange="HX.filtroExtra()"></label>
        </div></details>
      <div class="hx-conc" id="hx-conc" style="display:none"></div>
      <div id="hx-lista" class="hx-lista"></div>
      <div class="hx-pie" id="hx-pie"></div>`;
    this.$('hx-clase').insertAdjacentHTML('beforeend', this.CLASES.map(c => '<option>' + this.esc(c) + '</option>').join(''));
    this.$('hx-btn-papelera').style.display = this.priv() ? '' : 'none';
    // al abrir la pestaña: cargar
    const tab = OFERTAS.tab.bind(OFERTAS); OFERTAS.tab = (id) => { tab(id); if (id === 'historial') this.alAbrir(); };
    this.cargarAvisos();
  },
  alAbrir() { if (Date.now() - this.est.ult > 20000 || !this.est.filas.length) this.cargar(true); },

  // ───────────────────────── Carga ─────────────────────────
  filtros() {
    const v = this.VISTAS.find(x => x[0] === this.est.vista) || this.VISTAS[0], f = v[2](), x = this.est.extra || {}; if (this.est.clase) f.clase = [this.est.clase];
    if (x.estado) { f.estadoBD = [x.estado]; if (f.archivadas === 'NO') f.archivadas = 'TODAS'; } if (x.envio) f.envio = x.envio;
    if (x.doc === 'SIN') f.pdf = 'NO'; else if (x.doc) f.estadoDoc = [x.doc];
    if (x.desde) f.desde = x.desde; if (x.hasta) f.hasta = x.hasta; if (x.ant !== '' && x.ant != null && !isNaN(x.ant)) f.antigMin = Number(x.ant);
    return f;
  },
  filtroExtra() {
    const g = id => this.$(id).value; this.est.extra = { estado: g('hx-f-estado'), doc: g('hx-f-doc'), envio: g('hx-f-envio'), desde: g('hx-f-desde'), hasta: g('hx-f-hasta'), ant: g('hx-f-ant') };
    const n = Object.values(this.est.extra).filter(v => v !== '').length, b = this.$('hx-mas-n'); b.textContent = n; b.style.display = n ? 'inline-block' : 'none'; this.cargar(true);
  },
  buscar(t) { clearTimeout(this._tb); this._tb = setTimeout(() => { this.est.busqueda = t.trim(); this.cargar(true); }, 450); },
  limpiar() { Object.assign(this.est, { busqueda: '', orden: 'fecha_desc', vista: 'activas', clase: '', pagina: 1, extra: {} }); ['hx-f-estado', 'hx-f-doc', 'hx-f-envio', 'hx-f-desde', 'hx-f-hasta', 'hx-f-ant'].forEach(i => this.$(i).value = ''); this.$('hx-mas-n').style.display = 'none'; this.$('hx-q').value = ''; this.$('hx-orden').value = 'fecha_desc'; this.$('hx-clase').value = ''; this.cargar(true); },
  vista(v) { this.est.vista = v; this.cargar(true); },
  pagina(n) { this.est.pagina = n; this.cargar(false); this.$('hx-root').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  async cargar(reset) {
    if (this.est.cargando) { this._pend = !!(reset || this._pend); return; }   // si cambian los filtros mientras carga, se repite al terminar
    if (reset) this.est.pagina = 1; this.est.cargando = true; this.pintarCargando();
    try {
      const r = await API.call('histListar', { pagina: this.est.pagina, tamano: this.est.tamano, busqueda: this.est.busqueda, filtros: this.filtros(), orden: this.est.orden });
      if (r && r.exito === false) { this.est.listo = false; this.pintarNoListo(r); return; }
      this.est.listo = true; this.est.filas = r.pagina.filas; this.est.pag = r.pagina; this.est.resumen = r.resumen; this.est.ult = Date.now(); this.$('hx-aviso-ini').style.display = 'none'; this.pintar();
    } catch (e) { this.$('hx-lista').innerHTML = '<div class="hx-vacio">No se pudo cargar el historial: ' + this.esc(e.message) + ' <button class="hx-btn sec" onclick="HX.cargar(true)">Reintentar</button></div>'; }
    finally { this.est.cargando = false; if (this._pend !== undefined) { const r = this._pend; this._pend = undefined; this.cargar(r); } }
  },
  pintarCargando() { if (!this.est.filas.length) this.$('hx-lista').innerHTML = '<div class="hx-vacio">Cargando ofertas…</div>'; else this.$('hx-lista').classList.add('cargando'); },
  pintarNoListo(r) {
    this.$('hx-lista').innerHTML = ''; this.$('hx-chips').innerHTML = ''; this.$('hx-sub').textContent = '';
    const a = this.$('hx-aviso-ini'); a.style.display = 'block';
    a.innerHTML = (r.codigo === 'HISTORIAL_NO_INICIADO' ? 'El nuevo Historial aún no está iniciado.' : this.esc(r.error || 'No disponible.')) + (AUTH.rol === 'ADMINISTRADOR' && r.codigo === 'HISTORIAL_NO_INICIADO' ? ' <button class="hx-btn pri" onclick="HX.iniciar(this)">Iniciar Historial</button> <span class="hx-sub">Crea las hojas auxiliares y vincula las ofertas existentes sin modificarlas.</span>' : '') +
      '<div style="margin-top:8px"><button class="hx-btn ghost" onclick="document.getElementById(\'hx-legacy\').style.display=\'block\'">Ver la lista anterior</button></div>';
  },
  async iniciar(btn) { if (!UI.confirmar('Se crearán las hojas auxiliares del Historial y se vincularán las ofertas existentes. No se modifica ninguna oferta. ¿Continuar?')) return; btn.disabled = true; const r = await API.call('histInicializar', {}); btn.disabled = false; if (r.exito) { UI.toast('Historial iniciado: ' + r.sincronizacion.creadas + ' ofertas vinculadas', 'ok'); this.cargar(true); } else UI.toast(r.error || 'No se pudo iniciar', 'err'); },

  // ───────────────────────── Pintado ─────────────────────────
  pintar() {
    const r = this.est.resumen, p = this.est.pag, lista = this.$('hx-lista'); lista.classList.remove('cargando');
    this.$('hx-sub').textContent = r.total + ' ofertas · ' + (r.conAviso || 0) + ' con aviso · ' + (r.sinClase || 0) + ' sin clasificar';
    this.$('hx-chips').innerHTML = this.VISTAS.map(([k, t, , c]) => { const n = c ? c(r) : null; return '<button type="button" class="hx-chip' + (this.est.vista === k ? ' on' : '') + '" onclick="HX.vista(\'' + k + '\')">' + this.esc(t) + (n != null ? ' <b>' + n + '</b>' : '') + '</button>'; }).join('');
    const cn = r.conciliacion, c = this.$('hx-conc');
    if (cn && this.priv()) { c.style.display = 'block'; c.innerHTML = 'Pendientes según la base: <b>' + cn.pendientesBD + '</b> = archivadas <b>' + cn.archivadas + '</b>' + (cn.archivadasTambienCerradas ? ' (de ellas, ' + cn.archivadasTambienCerradas + ' también cerradas)' : '') + ' + cerradas <b>' + cn.cerradas + '</b> + activas <b>' + cn.activas + '</b>' + (cn.cuadra ? ' <span class="hx-ok">✓ cuadra</span>' : ' <span class="hx-mal">no cuadra</span>'); } else c.style.display = 'none';
    if (!this.est.filas.length) { lista.innerHTML = '<div class="hx-vacio">No hay ofertas con estos filtros.</div>'; this.$('hx-pie').innerHTML = ''; return; }
    const filas = this.est.filas;
    const tabla = '<div class="hx-tabla-w"><table class="hx-tabla"><thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Clase</th><th class="r">Total</th><th>Situación</th><th>Documento</th><th>Próx. seguimiento</th><th></th></tr></thead><tbody>' +
      filas.map(f => this.filaHtml(f)).join('') + '</tbody></table></div>';
    const tarjetas = '<div class="hx-cards">' + filas.map(f => this.tarjetaHtml(f)).join('') + '</div>';
    lista.innerHTML = tabla + tarjetas;
    const desde = p.desde + 1, hasta = p.hasta, tot = p.total, pags = Math.ceil(tot / p.tamano);
    this.$('hx-pie').innerHTML = '<span>Mostrando ' + desde + '–' + hasta + ' de ' + tot + (p.parcial ? ' (página reducida por tamaño)' : '') + '</span><span class="hx-pag">' +
      '<button class="hx-btn ghost" ' + (p.pagina <= 1 ? 'disabled' : '') + ' onclick="HX.pagina(' + (p.pagina - 1) + ')">← Anterior</button><b>' + p.pagina + ' / ' + Math.max(1, pags) + '</b>' +
      '<button class="hx-btn ghost" ' + (p.siguiente ? '' : 'disabled') + ' onclick="HX.pagina(' + (p.siguiente && p.siguiente.pagina ? p.siguiente.pagina : p.pagina + 1) + ')">Siguiente →</button></span>';
  },
  sitHtml(f) { const s = this.SIT[f.sit] || [f.sit, 'gri']; return '<span class="hx-pill ' + s[1] + '">' + this.esc(s[0]) + '</span>' + (f.ar ? '<span class="hx-pill gri">Archivada</span>' : ''); },
  docHtml(f) { if (!f.dt) return '<span class="hx-mut">Sin PDF</span>'; if (f.dt === 'NODIA') { const e = { VIGENTE: ['Vigente', 'ver'], VENCIDO: ['Vencido', 'amb'], ANULADO: ['Anulado', 'roj'], REEMPLAZADO: ['Reemplazado', 'gri'], MUESTRA: ['Muestra', 'azu'], SIN_VIGENCIA_DEFINIDA: ['Sin vigencia', 'amb'] }[f.de] || [f.de, 'gri']; return 'NODIA v' + (f.dv || 1) + ' <span class="hx-pill ' + e[1] + '">' + this.esc(e[0]) + '</span>'; } return f.de === 'PRINCIPAL' ? 'Doc. principal <span class="hx-mut">(formato anterior)</span>' : f.de === 'VARIOS' ? 'Varios archivos <span class="hx-mut">elegir</span>' : 'Formato anterior'; },
  vivaE(f) { return f.e === 'GENERADA' && !f.ar && !f.ci && f.en === 'E'; },
  proxHtml(f) { if (f.av) return '<span class="hx-aviso-t">' + this.esc(this.AVISO[f.av] || f.av) + '</span>'; if (f.ps && this.vivaE(f)) return this.fecha(f.ps); return '<span class="hx-mut">—</span>'; },
  filaHtml(f) { return '<tr class="' + (f.av ? 'hx-conaviso' : '') + '"><td><b>' + this.esc(f.id) + '</b></td><td>' + this.fecha(f.fi) + '</td><td class="hx-cli">' + this.esc(f.c) + '</td><td>' + (f.cl ? this.esc(f.cl) + (f.co === 'S' ? ' <span class="hx-mut" title="Sugerida, sin confirmar">(sugerida)</span>' : '') : '<span class="hx-mut">Sin clasificar</span>') + '</td><td class="r">' + this.pesos(f.t) + '</td><td>' + this.sitHtml(f) + '</td><td>' + this.docHtml(f) + '</td><td>' + this.proxHtml(f) + '</td><td class="r"><button type="button" class="hx-btn sec sm" onclick="HX.acciones(\'' + this.esc(f.id) + '\')">Acciones</button></td></tr>'; },
  tarjetaHtml(f) { return '<article class="hx-card' + (f.av ? ' conaviso' : '') + '"><div class="hx-card-t"><div><b class="hx-card-id">' + this.esc(f.id) + '</b><div class="hx-mut">' + this.fecha(f.fi) + ' · ' + (f.cl ? this.esc(f.cl) : 'Sin clasificar') + '</div></div><div class="hx-card-tot">' + this.pesos(f.t) + '</div></div>' +
    '<div class="hx-card-cli">' + this.esc(f.c) + '</div><div class="hx-card-pills">' + this.sitHtml(f) + '</div><div class="hx-card-doc">' + this.docHtml(f) + '</div>' + (f.av ? '<div class="hx-card-av">⚠ ' + this.esc(this.AVISO[f.av] || f.av) + '</div>' : (f.ps && this.vivaE(f) ? '<div class="hx-card-prox">Próximo seguimiento: ' + this.fecha(f.ps) + '</div>' : '')) +
    '<div class="hx-card-act"><button type="button" class="hx-btn pri" onclick="HX.acciones(\'' + this.esc(f.id) + '\')">Acciones</button>' + this.accionRapida(f) + '</div></article>'; },
  accionRapida(f) { if (f.e === 'BORRADOR') return '<button type="button" class="hx-btn sec" onclick="HX.editarBorrador(\'' + this.esc(f.id) + '\')">Editar borrador</button>'; if (f.e !== 'GENERADA' || f.ar || f.ci) return ''; return f.en === 'N' ? '<button type="button" class="hx-btn sec" onclick="HX.dlgEnvio(\'' + this.esc(f.id) + '\')">Registrar envío</button>' : '<button type="button" class="hx-btn sec" onclick="HX.dlgSeguimiento(\'' + this.esc(f.id) + '\')">Seguimiento</button>'; },
  fila(id) { return this.est.filas.find(f => f.id === id) || (this._extra || {})[id]; },

  // ───────────────────────── Avisos al ingresar ─────────────────────────
  async cargarAvisos() {
    try {
      const r = await API.call('histAvisos', {}); if (!r || r.exito === false || r.noIniciado) return; this.est.avisos = r; const b = this.$('hx-avisos');
      const tab = this.$('ot-historial'); if (tab) tab.innerHTML = '🕘 Historial' + (r.total ? ' <span class="hx-badge">' + r.total + '</span>' : '');
      if (r.total) { b.style.display = 'flex'; b.innerHTML = '<span>⚠ Tienes <b>' + r.total + '</b> oferta' + (r.total > 1 ? 's' : '') + ' con seguimiento pendiente' + (r.porRegularizar ? ' · ' + r.porRegularizar + ' anteriores por regularizar' : '') + '.</span><button type="button" class="hx-btn sec" onclick="OFERTAS.tab(\'historial\'); HX.vista(\'aviso\')">Ver ahora</button>'; } else b.style.display = 'none';
    } catch (e) {}
  },

  // ───────────────────────── Acciones ─────────────────────────
  modal(titulo, html) {
    let m = this.$('hx-modal'); if (!m) { m = document.createElement('div'); m.id = 'hx-modal'; m.className = 'hx-modal'; m.innerHTML = '<div class="hx-modal-box" role="dialog" aria-modal="true"><div class="hx-modal-h"><span id="hx-modal-t"></span><button type="button" class="hx-x" onclick="HX.cerrar()" aria-label="Cerrar">×</button></div><div id="hx-modal-c"></div></div>'; m.addEventListener('click', e => { if (e.target === m) this.cerrar(); }); document.body.appendChild(m); }
    this.$('hx-modal-t').textContent = titulo; this.$('hx-modal-c').innerHTML = html; m.classList.add('open');
  },
  cerrar() { const m = this.$('hx-modal'); if (m) m.classList.remove('open'); },
  /** Un borrador no tiene documento: se abre en el generador para seguir editándolo (mismo consecutivo). */
  editarBorrador(id) { this.cerrar(); UI.toast('Abriendo el borrador…', 'info'); OFERTAS.gestionarOferta(id, 'CARGAR'); },
  /** Oferta hecha con el diseño anterior: se abre en el generador con el MISMO número y el formato PDF NODIA ya elegido (genera una versión nueva; el documento viejo no se borra). */
  async rehacerNodia(id) {
    this.cerrar(); UI.toast('Abriendo la oferta ' + id + ' para rehacerla en formato NODIA…', 'info');
    await OFERTAS.gestionarOferta(id, 'CARGAR');
    const f = document.getElementById('of-formato'); if (!f || String(document.getElementById('of-consecutivo').value) !== String(id)) return;
    f.value = 'NODIA'; f.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof WIZ !== 'undefined') WIZ.ir(1, true);
    UI.toast('Conserva el número ' + id + '. Elija la clase de servicio y el tipo de trabajo, revise la vista previa y genere.', 'warn');
  },
  acciones(id) {
    const f = this.fila(id); if (!f) return; const url = ((OFERTAS.DB.historial || []).find(h => String(h.ID_OFERTA) === id) || {}).URL_DOC, priv = this.priv(), gen = f.e === 'GENERADA', libre = gen && !f.ar && !f.ci;
    const b = (t, fn, cls) => '<button type="button" class="hx-btn ' + (cls || 'sec') + ' blk" onclick="' + fn + '">' + t + '</button>', q = this.esc(id);
    let h = '<div class="hx-resumen"><b>' + this.esc(f.c) + '</b><div>' + this.pesos(f.t) + ' · ' + this.sitHtml(f) + '</div></div><div class="hx-acc">';
    if (f.e === 'BORRADOR') h += b('Editar borrador', `HX.editarBorrador('${q}')`, 'pri') + '<div class="hx-nota">Es un borrador: todavía no tiene documento. Ábralo para seguir editándolo y generarlo.</div>';   // un borrador no tiene documento: se edita siempre
    if (f.e !== 'BORRADOR' && f.dt !== 'NODIA' && (f.dt || url)) h += b('Rehacer en formato NODIA', `HX.rehacerNodia('${q}')`, 'pri') + '<div class="hx-nota">Esta oferta se hizo con el diseño anterior. Se abre con el mismo número y el PDF NODIA elegido; el documento viejo no se borra.</div>';
    if (url) h += '<a class="hx-btn pri blk" href="' + this.esc(url) + '" target="_blank" rel="noopener">Abrir documento</a>';
    if (libre && f.en === 'N') h += b('Registrar envío', `HX.dlgEnvio('${q}')`);
    if (libre && f.en === 'E') h += b('Registrar seguimiento', `HX.dlgSeguimiento('${q}')`) + b('Reprogramar seguimiento', `HX.dlgReprogramar('${q}')`);
    if (libre && f.en === 'E') h += b('Registrar un nuevo envío (otra versión)', `HX.dlgEnvio('${q}', true)`);
    if (gen && !f.ar) h += b('Marcar como aprobada', `HX.decidir('${q}','APROBADA')`) + b('Marcar como rechazada', `HX.decidir('${q}','RECHAZADA')`);
    if (priv && libre) h += b('Cerrar la oferta…', `HX.dlgCerrar('${q}')`);
    if (priv && f.ci) h += b('Reabrir la oferta…', `HX.dlgMotivo('${q}','histReabrir','Reabrir la oferta','Reabrir')`);
    if (priv) h += f.ar ? b('Desarchivar…', `HX.dlgMotivo('${q}','histDesarchivar','Desarchivar la oferta','Desarchivar')`) : b('Archivar…', `HX.dlgMotivo('${q}','histArchivar','Archivar la oferta (no toca el documento ni su validación)','Archivar')`);
    if (priv) h += b('Confirmar clase de servicio…', `HX.dlgClase('${q}')`);
    h += b('Ver detalle y bitácora', `HX.detalle('${q}')`);
    if (f.dt || url) h += b('Cargar en el generador', `HX.cerrar(); OFERTAS.gestionarOferta('${q}','CARGAR')`) + b('Clonar como oferta nueva', `HX.cerrar(); OFERTAS.gestionarOferta('${q}','CLONAR')`);
    if (priv) h += b('Eliminar definitivamente…', `HX.dlgEliminar('${q}')`, 'del');
    this.modal('Oferta ' + id, h + '</div>');
  },
  campo(id, lbl, tipo, extra) { return '<div class="field-group hx-fg"><label for="' + id + '">' + lbl + '</label>' + (tipo === 'textarea' ? '<textarea id="' + id + '" rows="3" ' + (extra || '') + '></textarea>' : '<input id="' + id + '" type="' + tipo + '" ' + (extra || '') + '>') + '</div>'; },
  selector(id, lbl, ops) { return '<div class="field-group hx-fg"><label for="' + id + '">' + lbl + '</label><select id="' + id + '">' + ops.map(o => '<option>' + this.esc(o) + '</option>').join('') + '</select></div>'; },
  hoy() { return new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10); },
  /** Envía una operación al servidor con su OPERACION_ID (se conserva mientras el diálogo siga abierto: reintentar nunca duplica). */
  async enviar(btn, accion, params, ok) {
    const op = this._op = this._op || this.uuid(); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const r = await API.call(accion, Object.assign({ operacionId: op }, params));
      if (r && r.exito) { this._op = null; this.cerrar(); UI.toast(ok + (r.estado === 'YA_APLICADA' ? ' (ya estaba registrado)' : r.estado === 'REANUDADA' ? ' (se completó una operación interrumpida)' : ''), 'ok'); DatosERP.invalidar(); this.cargar(false); this.cargarAvisos(); return r; }
      UI.toast((r && r.error) || 'No se pudo completar', 'err'); if (r && r.codigo === 'LOCK_OCUPADO') UI.toast('Puedes reintentar: no se duplicará.', 'warn');
    } catch (e) { UI.toast('Sin respuesta del servidor: ' + e.message + '. Puedes reintentar; no se duplicará.', 'err'); }
    btn.disabled = false; btn.textContent = btn.dataset.t;
  },
  boton(txt, fn) { return '<div class="hx-botones"><button type="button" class="hx-btn ghost" onclick="HX.cerrar()">Cancelar</button><button type="button" class="hx-btn pri" data-t="' + txt + '" onclick="' + fn + '">' + txt + '</button></div>'; },
  dlgEnvio(id, reenvio) {
    this._op = null; this.modal(reenvio ? 'Nuevo envío de ' + id : 'Registrar envío de ' + id,
      '<p class="hx-nota">' + (reenvio ? 'Registre el reenvío de una versión nueva: el reloj de seguimiento se reinicia.' : 'Indique cuándo y por qué medio se envió realmente la oferta al cliente.') + '</p>' + this.campo('hx-f-fecha', 'Fecha real del envío', 'date', 'max="' + this.hoy() + '" value="' + this.hoy() + '"') + this.selector('hx-f-canal', 'Medio', this.CANALES) + this.campo('hx-f-version', 'Versión del documento (opcional)', 'text', 'placeholder="Ej.: 2"') + this.campo('hx-f-nota', 'Nota (opcional)', 'textarea') +
      this.boton('Guardar envío', `HX.okEnvio('${this.esc(id)}',this)`));
  },
  okEnvio(id, btn) { const f = this.$('hx-f-fecha').value; if (!f) { UI.toast('Indique la fecha del envío', 'warn'); return; } this.enviar(btn, 'histRegistrarEnvio', { id, fecha: f, canal: this.$('hx-f-canal').value, version: this.$('hx-f-version').value, nota: this.$('hx-f-nota').value }, 'Envío registrado'); },
  dlgSeguimiento(id) {
    this._op = null; this.modal('Seguimiento de ' + id, this.campo('hx-f-fecha', 'Fecha del contacto', 'date', 'max="' + this.hoy() + '" value="' + this.hoy() + '"') + this.selector('hx-f-medio', 'Medio', ['Llamada', 'WhatsApp', 'Correo', 'Visita', 'Reunión']) + this.campo('hx-f-quien', '¿Con quién habló?', 'text') + this.campo('hx-f-res', 'Resultado', 'textarea') + this.campo('hx-f-acc', 'Próxima acción (opcional)', 'text') + this.campo('hx-f-rep', 'Volver a contactar el (opcional)', 'date', 'min="' + this.hoy() + '"') + this.boton('Guardar seguimiento', `HX.okSeguimiento('${this.esc(id)}',this)`));
  },
  okSeguimiento(id, btn) { const g = i => this.$(i).value.trim(); if (!g('hx-f-quien') || !g('hx-f-res')) { UI.toast('Indique con quién habló y el resultado', 'warn'); return; } this.enviar(btn, 'histRegistrarSeguimiento', { id, fechaContacto: g('hx-f-fecha'), medio: g('hx-f-medio'), interlocutor: g('hx-f-quien'), resultado: g('hx-f-res'), proximaAccion: g('hx-f-acc'), reprogramarA: g('hx-f-rep') }, 'Seguimiento registrado'); },
  dlgReprogramar(id) { this._op = null; this.modal('Reprogramar seguimiento de ' + id, this.campo('hx-f-fecha', 'Nueva fecha', 'date', 'min="' + this.hoy() + '"') + this.campo('hx-f-mot', 'Motivo (opcional)', 'text') + this.boton('Reprogramar', `HX.okRepro('${this.esc(id)}',this)`)); },
  okRepro(id, btn) { const f = this.$('hx-f-fecha').value; if (!f) { UI.toast('Indique la nueva fecha', 'warn'); return; } this.enviar(btn, 'histReprogramar', { id, fecha: f, motivo: this.$('hx-f-mot').value }, 'Seguimiento reprogramado'); },
  dlgCerrar(id) { this._op = null; this.modal('Cerrar ' + id, '<p class="hx-nota">Cerrar no es rechazar: la oferta queda sin respuesta o desistida y deja de generar avisos. Puede reabrirse.</p>' + this.selector('hx-f-cierre', 'Motivo del cierre', ['SIN_RESPUESTA', 'DESISTIDA']) + this.campo('hx-f-mot', 'Explicación (obligatoria)', 'textarea') + this.boton('Cerrar oferta', `HX.okCerrar('${this.esc(id)}',this)`)); },
  okCerrar(id, btn) { const m = this.$('hx-f-mot').value.trim(); if (!m) { UI.toast('El motivo es obligatorio', 'warn'); return; } this.enviar(btn, 'histCerrar', { id, cierre: this.$('hx-f-cierre').value, motivo: m }, 'Oferta cerrada'); },
  dlgMotivo(id, accion, titulo, boton) { this._op = null; this._accionMotivo = accion; this.modal(titulo + ' — ' + id, this.campo('hx-f-mot', 'Motivo (obligatorio)', 'textarea') + this.boton(boton, `HX.okMotivo('${this.esc(id)}',this)`)); },
  okMotivo(id, btn) { const m = this.$('hx-f-mot').value.trim(); if (!m) { UI.toast('El motivo es obligatorio', 'warn'); return; } this.enviar(btn, this._accionMotivo, { id, motivo: m }, 'Hecho'); },
  dlgClase(id) { const f = this.fila(id); this._op = null; this.modal('Clase de servicio de ' + id, '<p class="hx-nota">' + (f.co === 'S' ? 'La clase actual es una <b>sugerencia</b> y aún no está confirmada.' : 'Confirme o corrija la clase.') + '</p>' + this.selector('hx-f-clase', 'Clase', this.CLASES) + this.boton('Confirmar clase', `HX.okClase('${this.esc(id)}',this)`)); if (f.cl) this.$('hx-f-clase').value = f.cl; },
  okClase(id, btn) { this.enviar(btn, 'histConfirmarClase', { id, clase: this.$('hx-f-clase').value }, 'Clase confirmada'); },
  async decidir(id, estado) { this.cerrar(); await OFERTAS.actualizarEstadoOfertaUI(id, estado); await this.cargar(false); this.cargarAvisos(); },
  dlgEliminar(id) {
    this._op = null; this.modal('Eliminar ' + id, '<div class="hx-peligro">Esta acción retira la oferta de la lista. Se guarda una copia completa en la papelera para poder restaurarla. No es posible si tiene un proyecto o un PDF NODIA vigente (primero hay que anularlo).</div>' + this.campo('hx-f-mot', 'Motivo (obligatorio)', 'textarea') + this.campo('hx-f-conf', 'Para confirmar, escriba el N.º de oferta: ' + id, 'text', 'autocomplete="off"') + this.boton('Eliminar', `HX.okEliminar('${this.esc(id)}',this)`));
  },
  okEliminar(id, btn) { const m = this.$('hx-f-mot').value.trim(), c = this.$('hx-f-conf').value.trim(); if (!m) { UI.toast('El motivo es obligatorio', 'warn'); return; } if (c !== id) { UI.toast('Escriba exactamente el N.º de oferta para confirmar', 'warn'); return; } this.enviar(btn, 'histEliminar', { id, motivo: m, confirmacion: c }, 'Oferta eliminada (copia en la papelera)'); },
  async detalle(id) {
    const f = this.fila(id); this.modal('Detalle de ' + id, '<div class="hx-vacio">Cargando…</div>');
    try {
      const d = await API.call('histDetalle', { uid: f.u }); if (!d.exito) { this.$('hx-modal-c').innerHTML = '<div class="hx-vacio">' + this.esc(d.error || 'No disponible') + '</div>'; return; }
      const m = d.meta || {}, ev = d.eventos || [];
      this.$('hx-modal-c').innerHTML = (d.operacionesParciales && d.operacionesParciales.length ? '<div class="hx-peligro">Hay ' + d.operacionesParciales.length + ' operación(es) sin completar.</div>' : '') +
        '<div class="hx-kv"><div><span>Cliente</span>' + this.esc(f.c) + '</div><div><span>Total</span>' + this.pesos(f.t) + '</div><div><span>Clase</span>' + this.esc(m.CLASE || 'Sin clasificar') + (m.CLASE_ORIGEN === 'SUGERIDA' ? ' (sugerida)' : '') + '</div><div><span>Envío</span>' + (m.ENVIO_ESTADO === 'ENVIADA' ? this.fecha(m.ENVIO_FECHA) + ' · ' + this.esc(m.ENVIO_CANAL) : 'Sin registrar') + '</div><div><span>Seguimientos del ciclo</span>' + (m.SEGUIMIENTOS_CICLO || 0) + '</div><div><span>Documentos NODIA</span>' + ((d.documentosNodia || []).map(x => 'v' + x.version + ' ' + this.esc(x.estado)).join(' · ') || '—') + '</div></div>' +
        '<h4 class="hx-h4">Bitácora (' + ev.length + ')</h4><div class="hx-bit">' + (ev.length ? ev.slice().reverse().map(e => '<div class="hx-ev"><div class="hx-ev-t">' + this.esc(String(e.fecha).replace('T', ' ').slice(0, 16)) + ' · <b>' + this.esc(e.tipo.replace(/_/g, ' ').toLowerCase()) + '</b></div><div class="hx-ev-d">' + this.esc(e.usuario || 'sistema') + (e.motivo ? ' — ' + this.esc(e.motivo) : '') + '</div></div>').join('') : '<div class="hx-mut">Sin eventos.</div>') + '</div>';
    } catch (e) { this.$('hx-modal-c').innerHTML = '<div class="hx-vacio">' + this.esc(e.message) + '</div>'; }
  },
  // ───────────────────────── Papelera ─────────────────────────
  async verPapelera() {
    this.modal('Papelera de ofertas eliminadas', '<div class="hx-vacio">Cargando…</div>');
    const r = await API.call('histListarEliminadas', {}); if (!r.exito) { this.$('hx-modal-c').innerHTML = '<div class="hx-vacio">' + this.esc(r.error) + '</div>'; return; }
    this._papelera = r.filas; this.$('hx-modal-c').innerHTML = r.filas.length ? '<div class="hx-acc">' + r.filas.map((x, i) => '<div class="hx-pap"><div><b>' + this.esc(x.id) + '</b> · ' + this.esc(x.cliente) + '<div class="hx-mut">' + this.esc(String(x.en).slice(0, 10)) + ' por ' + this.esc(x.por) + ' — ' + this.esc(x.motivo) + (x.restauradaEn ? ' · restaurada' : '') + '</div></div>' + (x.restauradaEn ? '' : '<button class="hx-btn sec sm" onclick="HX.dlgRestaurar(' + i + ')">Restaurar</button>') + '</div>').join('') + '</div>' : '<div class="hx-vacio">La papelera está vacía.</div>';
  },
  dlgRestaurar(i) { const x = this._papelera[i]; this._op = null; this.modal('Restaurar ' + x.id, '<p class="hx-nota">La oferta vuelve <b>archivada</b>, con sus datos y su historial. No se revalida el documento ni se renumera.</p>' + this.campo('hx-f-mot', 'Motivo (obligatorio)', 'textarea') + this.boton('Restaurar', `HX.okRestaurar(${i},this)`)); },
  okRestaurar(i, btn) { const m = this.$('hx-f-mot').value.trim(); if (!m) { UI.toast('El motivo es obligatorio', 'warn'); return; } this.enviar(btn, 'histRestaurar', { uid: this._papelera[i].uid, motivo: m }, 'Oferta restaurada'); }
};
document.addEventListener('DOMContentLoaded', () => HX.init());
if (document.readyState !== 'loading') HX.init();
