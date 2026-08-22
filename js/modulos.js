/**
 * SENERPOT — proyectos.js v1.0
 * Gestión de órdenes de servicio y proyectos.
 * Módulo nuevo — conecta Ofertas con Contabilidad.
 */

const PROYECTOS = {

  DB: { proyectos: [], historial: [], clientes: [] },

  ESTADOS: ['BORRADOR','EN_PROGRESO','PAUSADO','TERMINADO','FACTURADO','COBRADO'],
  ESTADO_COLORS: {
    BORRADOR:'badge-gray', EN_PROGRESO:'badge-blue', PAUSADO:'badge-orange',
    TERMINADO:'badge-green', FACTURADO:'badge-blue', COBRADO:'badge-green'
  },

  // ── INIT ────────────────────────────────────
  async init() {
    try {
      const data = await API.call('obtenerDatos');
      this.DB = data;
      this.render();
    } catch(e) { UI.toast('Error cargando proyectos: ' + e.message, 'err'); }
  },

  render() {
    this.renderTabla(document.getElementById('pry-filtro-estado')?.value || '');
    this.poblarSelectOfertas();
    this.poblarSelectClientes();
  },

  // ── TABS ────────────────────────────────────
  tab(id) {
    document.querySelectorAll('#view-proyectos .subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#view-proyectos .subview').forEach(v => v.classList.remove('active'));
    document.getElementById('pryt-' + id)?.classList.add('active');
    document.getElementById('pryv-' + id)?.classList.add('active');
  },

  // ── RENDER TABLA ────────────────────────────
  renderTabla(filtroEstado = '') {
    const tbody = document.getElementById('pry-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let lista = [...(this.DB.proyectos || [])].reverse();
    if (filtroEstado) lista = lista.filter(p => p.ESTADO === filtroEstado);
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">No hay proyectos. Crea uno nuevo.</td></tr>';
      return;
    }
    lista.forEach(p => {
      const badgeClass = this.ESTADO_COLORS[p.ESTADO] || 'badge-gray';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${p.ID_PROYECTO}</b></td>
        <td>${p.NOMBRE || '-'}</td>
        <td>${p.CLIENTE || '-'}</td>
        <td>${UI.moneda(p.VALOR || 0)}</td>
        <td><span class="badge ${badgeClass}">${p.ESTADO || '-'}</span></td>
        <td>${p.REF_FACTURA_SIGO || '<span style="color:#ccc">—</span>'}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button class="btn-icon btn-icon-edit" onclick="PROYECTOS.abrirDetalle('${p.ID_PROYECTO}')" title="Ver detalle"><i class="ti ti-eye"></i></button>
          <button class="btn-icon" style="color:#639922" onclick="PROYECTOS.cambiarEstado('${p.ID_PROYECTO}')" title="Actualizar estado"><i class="ti ti-refresh"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  filtrar() {
    const estado = document.getElementById('pry-filtro-estado')?.value || '';
    this.renderTabla(estado);
  },

  // ── NUEVO PROYECTO ──────────────────────────
  poblarSelectOfertas() {
    const sel = document.getElementById('pry-sel-oferta');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sin oferta relacionada —</option>';
    (this.DB.historial || []).forEach(h => {
      const opt = document.createElement('option');
      opt.value = h.ID_OFERTA;
      opt.text  = h.ID_OFERTA + ' — ' + h.CLIENTE + ' (' + h.TOTAL + ')';
      sel.add(opt);
    });
  },

  poblarSelectClientes() {
    const sel = document.getElementById('pry-sel-cliente');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar cliente —</option>';
    (this.DB.clientes || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.EMPRESA_NOMBRE || c.EMPRESA;
      opt.text  = c.EMPRESA_NOMBRE || c.EMPRESA;
      sel.add(opt);
    });
  },

  autoLlenarCliente() {
    const idOferta = document.getElementById('pry-sel-oferta')?.value;
    if (!idOferta) return;
    const oferta = (this.DB.historial || []).find(h => h.ID_OFERTA === idOferta);
    if (!oferta) return;
    const selCli = document.getElementById('pry-sel-cliente');
    if (selCli) selCli.value = oferta.CLIENTE;
    const valInput = document.getElementById('pry-valor');
    if (valInput && oferta.TOTAL) {
      const num = parseFloat(String(oferta.TOTAL).replace(/[^0-9]/g, ''));
      if (!isNaN(num)) valInput.value = num;
    }
    const nomInput = document.getElementById('pry-nombre');
    if (nomInput && !nomInput.value) nomInput.value = 'Proyecto ' + oferta.CLIENTE;
  },

  async crearProyecto() {
    const nombre   = document.getElementById('pry-nombre')?.value?.trim();
    const cliente  = document.getElementById('pry-sel-cliente')?.value;
    const idOferta = document.getElementById('pry-sel-oferta')?.value;
    const valor    = document.getElementById('pry-valor')?.value;
    const tecnico  = document.getElementById('pry-tecnico')?.value?.trim();
    const notas    = document.getElementById('pry-notas')?.value?.trim();

    if (!nombre || !cliente) { UI.toast('Nombre y cliente son requeridos', 'warn'); return; }

    const btn = document.getElementById('pry-btn-crear');
    UI.spin(btn, true);
    try {
      // Fase 3: antes eran DOS round-trips (crearProyecto + obtenerDatos
      // completo). El backend ya devuelve el proyecto nuevo directamente
      // — se agrega en memoria y se refresca solo la tabla de proyectos.
      // No hace falta poblarSelectOfertas()/poblarSelectClientes(): esta
      // acción no toca DB.historial ni DB.clientes.
      const res = await API.call('crearProyecto', { nombre, cliente, idOferta, valor, tecnico, notas });
      Store.upsert(this.DB.proyectos, res.data);
      this.renderTabla(document.getElementById('pry-filtro-estado')?.value || '');
      // Limpiar formulario
      ['pry-nombre','pry-valor','pry-tecnico','pry-notas'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('pry-sel-oferta').value = '';
      document.getElementById('pry-sel-cliente').value = '';
      UI.toast('Proyecto ' + res.idProyecto + ' creado', 'ok');
      this.tab('lista');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { UI.spin(btn, false); }
  },

  // ── DETALLE / CAMBIAR ESTADO ─────────────────
  abrirDetalle(id) {
    const p = (this.DB.proyectos || []).find(x => x.ID_PROYECTO === id);
    if (!p) return;
    const panel = document.getElementById('pry-detalle');
    if (!panel) return;
    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Proyecto</div><div style="font-weight:500">${p.ID_PROYECTO}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Estado</div><div><span class="badge ${this.ESTADO_COLORS[p.ESTADO]||'badge-gray'}">${p.ESTADO}</span></div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Nombre</div><div>${p.NOMBRE||'-'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Cliente</div><div>${p.CLIENTE||'-'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Valor</div><div style="font-weight:700;color:var(--primary)">${UI.moneda(p.VALOR||0)}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Oferta</div><div>${p.ID_OFERTA||'—'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Ref. Factura SIGO</div><div>${p.REF_FACTURA_SIGO||'—'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Técnico</div><div>${p.TECNICO||'—'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Inicio</div><div>${p.FECHA_INICIO||'—'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Fin</div><div>${p.FECHA_FIN||'—'}</div></div>
      </div>
      ${p.NOTAS ? `<div style="background:#f9fafb;padding:10px;border-radius:6px;font-size:13px"><b>Notas:</b> ${p.NOTAS}</div>` : ''}`;
    document.getElementById('pry-modal-detalle')?.classList.add('open');
    document.getElementById('pry-detalle-id').value = id;
  },

  async cambiarEstado(id) {
    const p = (this.DB.proyectos || []).find(x => x.ID_PROYECTO === id);
    if (!p) return;
    const opciones = this.ESTADOS.map((e,i) => `${i+1}. ${e}`).join('\n');
    const input    = prompt(`Estado actual: ${p.ESTADO}\n\nNuevo estado:\n${opciones}\n\nIngrese número:`);
    if (!input) return;
    const idx = parseInt(input) - 1;
    if (idx < 0 || idx >= this.ESTADOS.length) { UI.toast('Opción inválida', 'warn'); return; }
    const nuevoEstado    = this.ESTADOS[idx];
    const refFacturaSigo = ['FACTURADO','COBRADO'].includes(nuevoEstado) ? (prompt('N° Factura SIGO (opcional):') || '') : '';
    try {
      const res = await API.call('actualizarEstadoProyecto', { id, estado: nuevoEstado, refFacturaSigo });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      Store.upsert(this.DB.proyectos, res.data);
      this.renderTabla(document.getElementById('pry-filtro-estado')?.value || '');
      UI.toast('Estado actualizado: ' + nuevoEstado, 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  cerrarModal(id) { document.getElementById(id)?.classList.remove('open'); }
};


/* ═══════════════════════════════════════════════
   ALMACEN
═══════════════════════════════════════════════ */
const ALMACEN = {

  DB: [],
  CATEGORIAS: ['MATERIALES','EQUIPOS','HERRAMIENTAS','SERVICIOS','REPUESTOS','OTROS'],

  async init() {
    try {
      this.DB = await API.call('obtenerAlmacen');
      this.render();
    } catch(e) { UI.toast('Error cargando almacén', 'err'); }
  },

  render() {
    this.renderTabla();
    this.poblarFiltros();
  },

  renderTabla(filtro = '') {
    const tbody = document.getElementById('alm-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let lista = this.DB || [];
    if (filtro) lista = lista.filter(i => String(i.CATEGORIA||'').toUpperCase() === filtro.toUpperCase());
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888">Sin ítems. Agrega materiales o servicios.</td></tr>';
      return;
    }
    lista.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge-blue" style="font-size:10px">${i.CATEGORIA||''}</span></td>
        <td>${i.DESCRIPCION||''}</td>
        <td>${i.UNIDAD||'UN'}</td>
        <td>${i.PROVEEDOR||'—'}</td>
        <td class="text-right">${UI.moneda(i.PRECIO_COMPRA||0)}</td>
        <td class="text-right">${UI.moneda(i.PRECIO_VENTA||0)}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button class="btn-icon btn-icon-edit" onclick='ALMACEN.editarUI(${JSON.stringify(i).replace(/'/g,"&#39;")})' title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn-icon btn-icon-del" onclick='ALMACEN.eliminar(${JSON.stringify(i).replace(/'/g,"&#39;")})' title="Eliminar"><i class="ti ti-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  filtrar() {
    const cat = document.getElementById('alm-filtro-cat')?.value || '';
    this.renderTabla(cat);
  },

  poblarFiltros() {
    const sel = document.getElementById('alm-filtro-cat');
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>';
    this.CATEGORIAS.forEach(c => { const o = document.createElement('option'); o.value = c; o.text = c; sel.add(o); });
    sel.value = actual;
    // Selector del modal
    const selMod = document.getElementById('alm-cat-modal');
    if (selMod) { selMod.innerHTML = ''; this.CATEGORIAS.forEach(c => { const o = document.createElement('option'); o.value = c; o.text = c; selMod.add(o); }); }
  },

  abrirModal(i = null) {
    document.getElementById('alm-modal-title').textContent = i ? 'Editar Ítem' : 'Nuevo Ítem';
    document.getElementById('alm-edit-idx').value = i ? i._rowIndex : '';
    // ID_ITEM es el ID inmutable asignado al crear el ítem (ver Proyectos.gs)
    // — se reenvía en guardar()/eliminar() para el bloqueo optimista.
    this._editId = i ? i.ID_ITEM : null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('alm-cat-modal',   i?.CATEGORIA || 'MATERIALES');
    set('alm-desc',         i?.DESCRIPCION);
    set('alm-unidad',       i?.UNIDAD || 'UN');
    set('alm-proveedor',    i?.PROVEEDOR);
    set('alm-precio-c',     i?.PRECIO_COMPRA || 0);
    set('alm-precio-v',     i?.PRECIO_VENTA  || 0);
    set('alm-referencia',   i?.REFERENCIA);
    set('alm-notas-modal',  i?.NOTAS);
    document.getElementById('alm-modal').classList.add('open');
  },

  editarUI(i) { this.abrirModal(i); },

  cerrarModal() { document.getElementById('alm-modal')?.classList.remove('open'); },

  async guardar() {
    const obj = {
      _rowIndex:    document.getElementById('alm-edit-idx')?.value,
      id:           this._editId || undefined,
      categoria:    document.getElementById('alm-cat-modal')?.value,
      descripcion:  document.getElementById('alm-desc')?.value,
      unidad:       document.getElementById('alm-unidad')?.value || 'UN',
      proveedor:    document.getElementById('alm-proveedor')?.value,
      precioCompra: document.getElementById('alm-precio-c')?.value || 0,
      precioVenta:  document.getElementById('alm-precio-v')?.value || 0,
      referencia:   document.getElementById('alm-referencia')?.value,
      notas:        document.getElementById('alm-notas-modal')?.value
    };
    if (!obj.descripcion) { UI.toast('Falta descripción', 'warn'); return; }
    const accion = obj._rowIndex ? 'editarItemAlmacen' : 'guardarItemAlmacen';
    try {
      const res = await API.call(accion, obj);
      // this.DB es el arreglo mismo (no un objeto con sub-clave) — se
      // parchea in situ. No hace falta poblarFiltros() (this.render()
      // completo): las categorías del filtro son una lista fija, no
      // dependen de DB, así que re-renderizar solo la tabla basta.
      Store.upsert(this.DB, res.data);
      this.renderTabla(document.getElementById('alm-filtro-cat')?.value || '');
      this.cerrarModal();
      UI.toast('Ítem guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async eliminar(i) {
    if (!UI.confirmar('¿Eliminar este ítem?')) return;
    try {
      const res = await API.call('eliminarItemAlmacen', { rowIndex: i._rowIndex, id: i.ID_ITEM });
      Store.remove(this.DB, res.rowIndex);
      this.renderTabla(document.getElementById('alm-filtro-cat')?.value || '');
      UI.toast('Ítem eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  filtrarBusqueda(txt) {
    const rows = document.getElementById('alm-tbody')?.getElementsByTagName('tr') || [];
    for (const row of rows) {
      row.style.display = row.innerText.toLowerCase().includes(txt.toLowerCase()) ? '' : 'none';
    }
  }
};


/* ═══════════════════════════════════════════════
   PANEL / DASHBOARD
═══════════════════════════════════════════════ */
const PANEL = {

  charts: {},

  async init() {
    const el = document.getElementById('panel-loader');
    if (el) el.style.display = 'flex';
    try {
      const data = await API.call('getDashboard');
      if (el) el.style.display = 'none';
      document.getElementById('panel-content').style.display = 'block';
      this.renderKPIs(data.kpis);
      this.renderCharts(data.charts);
    } catch(e) {
      if (el) el.innerHTML = '<div style="color:#D32F2F">Error: ' + e.message + '</div>';
    }
  },

  renderKPIs(kpis) {
    if (!kpis) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('panel-ventas',   UI.moneda(kpis.ventas   || 0));
    set('panel-gastos',   UI.moneda(kpis.gastos   || 0));
    set('panel-utilidad', UI.moneda(kpis.utilidad || 0));
    set('panel-margen',   (kpis.margen || 0).toFixed(1) + '%');
    set('panel-cartera',  UI.moneda(kpis.cartera  || 0));
  },

  renderCharts(charts) {
    if (!charts || typeof Chart === 'undefined') return;

    // Destruir anteriores si existen
    Object.values(this.charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    this.charts = {};

    const defaults = {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#64748B', boxWidth: 10, font: { size: 11 } } } },
      scales: { y: { ticks: { color: '#94A3B8' }, grid: { color: '#E2E8F0' } }, x: { ticks: { color: '#94A3B8' } } }
    };

    // Línea: Tendencia
    const ctxLine = document.getElementById('panel-chart-linea');
    if (ctxLine && charts.linea) {
      this.charts.linea = new Chart(ctxLine, {
        type: 'line',
        data: {
          labels: charts.linea.labels,
          datasets: [
            { label: 'Ventas',  data: charts.linea.ventas, borderColor: '#009E60', backgroundColor: 'rgba(0,158,96,0.08)', tension: 0.4, fill: true },
            { label: 'Gastos',  data: charts.linea.gastos, borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.4, fill: true }
          ]
        },
        options: defaults
      });
    }

    // Dona: Top clientes
    const ctxBar = document.getElementById('panel-chart-clientes');
    if (ctxBar && charts.barras) {
      this.charts.clientes = new Chart(ctxBar, {
        type: 'doughnut',
        data: {
          labels: charts.barras.labels,
          datasets: [{ data: charts.barras.valores, backgroundColor: ['#009E60','#3B82F6','#8B5CF6','#F59E0B','#EF4444'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#64748B', boxWidth: 10 } } } }
      });
    }

    // Barras horizontales: Top servicios
    const ctxSrv = document.getElementById('panel-chart-servicios');
    if (ctxSrv && charts.servicios) {
      this.charts.servicios = new Chart(ctxSrv, {
        type: 'bar',
        data: {
          labels: charts.servicios.labels,
          datasets: [{ label: 'Ventas', data: charts.servicios.valores, backgroundColor: '#F59E0B', borderRadius: 4 }]
        },
        options: { ...defaults, indexAxis: 'y', plugins: { legend: { display: false } } }
      });
    }
  }
};
