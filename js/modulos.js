/**
 * SENERPOT — proyectos.js v1.0
 * Gestión de órdenes de servicio y proyectos.
 * Módulo nuevo — conecta Ofertas con Contabilidad.
 */

const PROYECTOS = {

  DB: { proyectos: [], historial: [], clientes: [] },

  ESTADOS: ['POR_INICIAR','EN_PROGRESO','PAUSADO','TERMINADO','FACTURADO','COBRADO'],
  ESTADO_COLORS: {
    POR_INICIAR:'badge-gray', EN_PROGRESO:'badge-blue', PAUSADO:'badge-orange',
    TERMINADO:'badge-green', FACTURADO:'badge-blue', COBRADO:'badge-green'
  },

  // ── INIT ────────────────────────────────────
  async init() {
    try {
      const data = await DatosERP.obtener();
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
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Responsable</div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="pry-responsable-input" value="${p.TECNICO||''}" placeholder="Sin asignar" style="flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;" onkeydown="if(event.key==='Enter')PROYECTOS.guardarResponsable('${id}')">
            <button class="btn-icon" style="color:var(--primary)" onclick="PROYECTOS.guardarResponsable('${id}')" title="Guardar responsable"><i class="ti ti-check"></i></button>
          </div>
        </div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Inicio</div><div>${p.FECHA_INICIO||'—'}</div></div>
        <div><div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Fin</div><div>${p.FECHA_FIN||'—'}</div></div>
      </div>
      ${p.NOTAS ? `<div style="background:#f9fafb;padding:10px;border-radius:6px;font-size:13px;margin-bottom:14px;"><b>Notas:</b> ${p.NOTAS}</div>` : ''}
      <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;">Presupuesto del proyecto</div>
          ${p.ID_OFERTA ? `<button class="btn-icon" style="color:var(--primary)" onclick="PROYECTOS.copiarDeOferta('${id}')" title="Copiar ítems de la oferta ${p.ID_OFERTA}"><i class="ti ti-copy"></i></button>` : ''}
        </div>
        <div id="pry-presupuesto-lista" style="font-size:12.5px;">Cargando…</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <input type="text" id="pry-pres-desc" list="pry-pres-dl" placeholder="Descripción (busca en compras ya hechas)" style="flex:2;min-width:160px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;" oninput="PROYECTOS.sugerirDesdeCompra(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();PROYECTOS.agregarLineaLocal('${id}');}">
          <datalist id="pry-pres-dl"></datalist>
          <input type="number" id="pry-pres-cant" placeholder="Cant." value="1" style="width:55px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;" onkeydown="if(event.key==='Enter'){event.preventDefault();PROYECTOS.agregarLineaLocal('${id}');}">
          <input type="text" id="pry-pres-unidad" placeholder="UN" value="UN" style="width:45px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;">
          <input type="number" id="pry-pres-costo" placeholder="Costo unit." style="width:90px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:12px;" onkeydown="if(event.key==='Enter'){event.preventDefault();PROYECTOS.agregarLineaLocal('${id}');}">
          <button class="btn-primary-sm" onclick="PROYECTOS.agregarLineaLocal('${id}')">+ Agregar a la lista</button>
        </div>
        <div id="pry-pres-hint" style="font-size:11px;color:#888;margin-top:4px;"></div>
        <div id="pry-pres-guardar-wrap" style="display:none;margin-top:10px;">
          <button class="btn-generate" id="pry-pres-btn-guardar" onclick="PROYECTOS.guardarPresupuestoLote('${id}', this)" style="width:100%;background:#F59E0B;">
            Guardar presupuesto (<span id="pry-pres-count">0</span> líneas sin guardar)
          </button>
        </div>
        <div id="pry-presupuesto-resumen" style="text-align:right;font-size:13px;margin-top:8px;"></div>
      </div>
      ${this.bloqueComprasProyecto(id)}
      <div style="border-top:1px solid var(--border);padding-top:14px;">
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:8px;">Bitácora — avances, materiales, novedades</div>
        <div id="pry-comentarios-lista" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">Cargando…</div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="pry-comentario-nuevo" placeholder="Ej: se visitó el sitio, falta el material X..." style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;font-size:13px;" onkeydown="if(event.key==='Enter')PROYECTOS.agregarComentario('${id}')">
          <button class="btn-primary-sm" onclick="PROYECTOS.agregarComentario('${id}')">Agregar</button>
        </div>
      </div>`;
    document.getElementById('pry-modal-detalle')?.classList.add('open');
    document.getElementById('pry-detalle-id').value = id;
    this._presupuestoPendiente = []; // limpio al abrir — no arrastrar líneas sin guardar de otro proyecto
    this.poblarDatalistCompras();
    this.cargarPresupuesto(id);
    // El botón de eliminar solo se muestra a ADMINISTRADOR — esto es solo
    // para que la interfaz tenga sentido, la restricción real ya la aplica
    // el servidor (ver eliminarProyecto en PERMISOS, Auth.gs).
    const btnEliminar = document.getElementById('pry-btn-eliminar');
    if (btnEliminar) btnEliminar.style.display = (typeof AUTH !== 'undefined' && AUTH.rol === 'ADMINISTRADOR') ? '' : 'none';
    this.cargarComentarios(id);
  },

  // Costo real del proyecto — suma en memoria de las compras del módulo
  // Compras (BD_ALMACEN) que quedaron marcadas con este ID_PROYECTO. No es
  // una llamada nueva a la API: this.DB.almacen ya viene incluido en el
  // mismo obtenerDatos() que cargó los proyectos (ver DatosERP en api.js).
  bloqueComprasProyecto(id) {
    const compras = (this.DB.almacen || []).filter(c => c.ID_PROYECTO === id);
    const total = compras.reduce((sum, c) => sum + (parseFloat(c.PRECIO_COMPRA)||0) * (parseFloat(c.CANTIDAD)||1), 0);
    if (!compras.length) {
      return `<div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:8px;">Compras cargadas a este proyecto</div>
        <div style="font-size:12px;color:#888;">Sin compras registradas todavía. Se cargan desde el módulo Compras, eligiendo este proyecto.</div>
      </div>`;
    }
    const filas = compras.map(c => `
      <tr>
        <td>${c.DESCRIPCION||''}</td>
        <td style="text-align:right;">${c.CANTIDAD||1} ${c.UNIDAD||'UN'}</td>
        <td>${c.PROVEEDOR||'—'}</td>
        <td style="text-align:right;">${UI.moneda((parseFloat(c.PRECIO_COMPRA)||0) * (parseFloat(c.CANTIDAD)||1))}</td>
      </tr>`).join('');
    return `<div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:8px;">Compras cargadas a este proyecto</div>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;">
        <tbody>${filas}</tbody>
      </table>
      <div style="text-align:right;font-weight:700;margin-top:6px;font-size:13px;">Total comprado: ${UI.moneda(total)}</div>
    </div>`;
  },

  totalComprasProyecto(id) {
    return (this.DB.almacen || [])
      .filter(c => c.ID_PROYECTO === id)
      .reduce((sum, c) => sum + (parseFloat(c.PRECIO_COMPRA)||0) * (parseFloat(c.CANTIDAD)||1), 0);
  },

  // dd/MM/yyyy — new Date(str) lo interpreta mal (lo lee como MM/dd/yyyy)
  _parseFechaDMY(s) {
    const p = String(s||'').split(' ')[0].split('/');
    if (p.length !== 3) return new Date(0);
    return new Date(+p[2], +p[1]-1, +p[0]);
  },

  // Autocompletado del campo Descripción en Presupuesto, a partir de las
  // compras ya registradas en el módulo Compras (BD_ALMACEN) — así, si ya
  // compraron algo parecido antes, se puede elegir en vez de escribir de
  // cero y de paso se sugiere el costo real más reciente.
  poblarDatalistCompras() {
    const dl = document.getElementById('pry-pres-dl');
    if (!dl) return;
    const vistos = new Set();
    dl.innerHTML = (this.DB.almacen || [])
      .filter(c => { if (vistos.has(c.DESCRIPCION)) return false; vistos.add(c.DESCRIPCION); return true; })
      .map(c => `<option value="${c.DESCRIPCION}">`)
      .join('');
  },

  // Al escribir/elegir una descripción que coincide con una compra ya
  // hecha, sugiere unidad y costo unitario (el de la compra más reciente
  // con esa descripción) — la persona los puede corregir igual, esto solo
  // ahorra tener que ir a mirar cuánto costó la última vez.
  sugerirDesdeCompra(texto) {
    const hint = document.getElementById('pry-pres-hint');
    const t = String(texto||'').trim().toUpperCase();
    if (!t) { if (hint) hint.textContent = ''; return; }
    const coincidencias = (this.DB.almacen || []).filter(c => c.DESCRIPCION === t);
    if (!coincidencias.length) { if (hint) hint.textContent = ''; return; }
    const mejor = coincidencias.sort((a,b) => this._parseFechaDMY(b.FECHA_ULTIMO_PRECIO) - this._parseFechaDMY(a.FECHA_ULTIMO_PRECIO))[0];
    const inputUnidad = document.getElementById('pry-pres-unidad');
    const inputCosto  = document.getElementById('pry-pres-costo');
    if (inputUnidad) inputUnidad.value = mejor.UNIDAD || 'UN';
    if (inputCosto)  inputCosto.value  = mejor.PRECIO_COMPRA || 0;
    if (hint) hint.textContent = `Última compra: ${UI.moneda(mejor.PRECIO_COMPRA||0)} (${mejor.PROVEEDOR||'—'}, ${mejor.FECHA_ULTIMO_PRECIO||''})` + (coincidencias.length > 1 ? ` — ${coincidencias.length} compras registradas con esta descripción` : '');
  },

  // ── PRESUPUESTO ──────────────────────────────
  // Se carga aparte (no viene en el obtenerDatos() compartido con Ofertas)
  // porque, igual que la bitácora, es un detalle que solo hace falta al
  // abrir un proyecto puntual — cargarlo siempre en el payload grande
  // sería peso muerto para todos los que solo ven la lista.
  async cargarPresupuesto(id) {
    const lista = document.getElementById('pry-presupuesto-lista');
    if (!lista) return;
    try {
      this._presupuestoActual = await API.call('obtenerPresupuestoProyecto', { idProyecto: id });
      this.renderPresupuesto(id);
    } catch(e) {
      lista.innerHTML = '<div style="font-size:12px;color:#D32F2F;">No se pudo cargar el presupuesto.</div>';
    }
  },

  renderPresupuesto(id) {
    const lista   = document.getElementById('pry-presupuesto-lista');
    const resumen = document.getElementById('pry-presupuesto-resumen');
    if (!lista) return;
    const lineas     = this._presupuestoActual || [];
    const pendientes = this._presupuestoPendiente || [];
    const totalGuardado  = lineas.reduce((s,l) => s + (parseFloat(l.COSTO_UNITARIO)||0) * (parseFloat(l.CANTIDAD)||1), 0);
    const totalPendiente = pendientes.reduce((s,l) => s + (parseFloat(l.costoUnitario)||0) * (parseFloat(l.cantidad)||1), 0);
    const totalPresupuestado = totalGuardado + totalPendiente;

    if (!lineas.length && !pendientes.length) {
      lista.innerHTML = '<div style="font-size:12px;color:#888;">Sin líneas presupuestadas todavía.</div>';
    } else {
      const filasGuardadas = lineas.map(l => `
        <tr>
          <td>${l.DESCRIPCION||''}</td>
          <td style="text-align:right;">${l.CANTIDAD||1} ${l.UNIDAD||'UN'}</td>
          <td style="text-align:right;">${UI.moneda((parseFloat(l.COSTO_UNITARIO)||0) * (parseFloat(l.CANTIDAD)||1))}</td>
          <td style="text-align:center;"><button class="btn-icon btn-icon-del" onclick="PROYECTOS.eliminarLineaPresupuestoUI('${l.ID}','${id}')" title="Eliminar"><i class="ti ti-trash"></i></button></td>
        </tr>`).join('');
      // Las líneas "sin guardar" viven solo en memoria (this._presupuestoPendiente)
      // hasta que se aprieta "Guardar presupuesto" — se ven marcadas en naranja
      // para que quede claro que todavía no están en la base de datos.
      const filasPendientes = pendientes.map(l => `
        <tr style="background:#FFF8E1;">
          <td>${l.descripcion} <span class="badge badge-orange" style="font-size:9px;">sin guardar</span></td>
          <td style="text-align:right;">${l.cantidad} ${l.unidad}</td>
          <td style="text-align:right;">${UI.moneda((l.costoUnitario||0) * (l.cantidad||1))}</td>
          <td style="text-align:center;"><button class="btn-icon btn-icon-del" onclick="PROYECTOS.quitarLineaPendiente('${id}','${l._tempId}')" title="Quitar de la lista"><i class="ti ti-x"></i></button></td>
        </tr>`).join('');
      lista.innerHTML = `<table style="width:100%;font-size:12.5px;border-collapse:collapse;"><tbody>${filasGuardadas}${filasPendientes}</tbody></table>`;
    }

    const wrapGuardar = document.getElementById('pry-pres-guardar-wrap');
    const countEl     = document.getElementById('pry-pres-count');
    if (wrapGuardar) wrapGuardar.style.display = pendientes.length ? 'block' : 'none';
    if (countEl) countEl.textContent = pendientes.length;

    if (!resumen) return;
    const totalReal = this.totalComprasProyecto(id);
    const diferencia = totalPresupuestado - totalReal;
    const colorDif = diferencia >= 0 ? '#009E60' : '#D32F2F';
    resumen.innerHTML = `
      <div>Presupuestado: <b>${UI.moneda(totalPresupuestado)}</b>${pendientes.length ? ` <span style="color:#F59E0B;font-weight:400;">(incluye ${pendientes.length} sin guardar)</span>` : ''}</div>
      <div style="color:${colorDif};font-weight:700;">${diferencia >= 0 ? 'Disponible' : 'Excedido'}: ${UI.moneda(Math.abs(diferencia))}</div>`;
  },

  // Agregar a la lista NO llama al servidor — solo mete la línea en un
  // arreglo en memoria y vuelve a pintar. Por eso se siente instantáneo
  // aunque se agreguen 20 ítems seguidos; antes cada "Agregar" era un
  // viaje de red a Apps Script (que puede tardar varios segundos), así
  // que cargar muchos ítems uno por uno se sentía lentísimo.
  agregarLineaLocal(id) {
    const descripcion   = document.getElementById('pry-pres-desc')?.value?.trim();
    const cantidad      = document.getElementById('pry-pres-cant')?.value || 1;
    const unidad        = document.getElementById('pry-pres-unidad')?.value || 'UN';
    const costoUnitario = document.getElementById('pry-pres-costo')?.value || 0;
    if (!descripcion) { UI.toast('Escribe una descripción', 'warn'); return; }

    this._presupuestoPendiente = this._presupuestoPendiente || [];
    this._presupuestoPendiente.push({
      _tempId: 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      descripcion, unidad, cantidad: parseFloat(cantidad)||1, costoUnitario: parseFloat(costoUnitario)||0
    });
    this.renderPresupuesto(id);

    ['pry-pres-desc','pry-pres-costo'].forEach(elId => { const el = document.getElementById(elId); if (el) el.value = ''; });
    document.getElementById('pry-pres-cant').value = 1;
    const hint = document.getElementById('pry-pres-hint');
    if (hint) hint.textContent = '';
    document.getElementById('pry-pres-desc')?.focus(); // listo para seguir escribiendo el siguiente ítem sin tocar el mouse
  },

  quitarLineaPendiente(id, tempId) {
    this._presupuestoPendiente = (this._presupuestoPendiente || []).filter(l => l._tempId !== tempId);
    this.renderPresupuesto(id);
  },

  // El único viaje al servidor: manda todas las líneas acumuladas de una
  // sola vez (agregarLineasPresupuestoLote hace una sola escritura en la
  // hoja para todas), en vez de una llamada por línea.
  async guardarPresupuestoLote(id, btn) {
    const pendientes = this._presupuestoPendiente || [];
    if (!pendientes.length) return;
    if (this._guardandoLote) return;
    this._guardandoLote = true;
    UI.spin(btn, true);
    try {
      const res = await API.call('agregarLineasPresupuestoLote', { idProyecto: id, items: pendientes });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      this._presupuestoActual = (this._presupuestoActual || []).concat(res.data);
      this._presupuestoPendiente = [];
      this.renderPresupuesto(id);
      UI.toast(res.data.length + ' línea' + (res.data.length === 1 ? '' : 's') + ' guardada' + (res.data.length === 1 ? '' : 's'), 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoLote = false; UI.spin(btn, false); }
  },

  async eliminarLineaPresupuestoUI(lineaId, id) {
    if (!UI.confirmar('¿Eliminar esta línea del presupuesto?')) return;
    try {
      const res = await API.call('eliminarLineaPresupuesto', { id: lineaId });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      this._presupuestoActual = (this._presupuestoActual || []).filter(l => l.ID !== lineaId);
      this.renderPresupuesto(id);
      UI.toast('Línea eliminada', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // El costo unitario queda en 0 (ver copiarItemsOfertaAPresupuesto en
  // Proyectos.gs) — el precio de la oferta es lo que se le cobra al
  // cliente, no lo que cuesta comprar, así que hay que completarlo a mano.
  async copiarDeOferta(id) {
    if (!UI.confirmar('¿Copiar los ítems de la oferta al presupuesto? Las cantidades se copian, el costo queda en 0 para que lo completes.')) return;
    try {
      const res = await API.call('copiarItemsOfertaAPresupuesto', { idProyecto: id });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      await this.cargarPresupuesto(id);
      UI.toast(res.cantidad + ' ítems copiados al presupuesto', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async cargarComentarios(id) {
    const lista = document.getElementById('pry-comentarios-lista');
    if (!lista) return;
    try {
      const comentarios = await API.call('obtenerComentariosProyecto', { idProyecto: id });
      if (!comentarios || !comentarios.length) {
        lista.innerHTML = '<div style="font-size:12px;color:#888;">Sin comentarios todavía.</div>';
        return;
      }
      lista.innerHTML = comentarios.map(c => `
        <div style="background:#f9fafb;padding:8px 10px;border-radius:6px;font-size:12.5px;">
          <div style="font-weight:700;color:var(--primary-dark);">${c.USUARIO} <span style="font-weight:400;color:#94A3B8;font-size:11px;">${c.FECHA}</span></div>
          <div>${c.COMENTARIO}</div>
        </div>`).join('');
    } catch(e) {
      lista.innerHTML = '<div style="font-size:12px;color:#D32F2F;">No se pudieron cargar los comentarios.</div>';
    }
  },

  // El autor del comentario lo pone el servidor a partir de la sesión
  // (ver params._sesion en Api.gs) — nunca se envía "quién soy" desde
  // aquí, para que la bitácora no se pueda falsificar.
  async agregarComentario(id) {
    const input = document.getElementById('pry-comentario-nuevo');
    const comentario = input?.value?.trim();
    if (!comentario) return;
    try {
      const res = await API.call('agregarComentarioProyecto', { idProyecto: id, comentario });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      input.value = '';
      this.cargarComentarios(id);
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // Reutiliza actualizarEstadoProyecto mandando el mismo estado actual —
  // el backend ya acepta "tecnico" junto con el cambio de estado (ver
  // Proyectos.gs), así que no hace falta un endpoint nuevo solo para
  // esto.
  async guardarResponsable(id) {
    const p = (this.DB.proyectos || []).find(x => x.ID_PROYECTO === id);
    if (!p) return;
    const input = document.getElementById('pry-responsable-input');
    const tecnico = input?.value?.trim();
    if (!tecnico) { UI.toast('Escribe un nombre para el responsable', 'warn'); return; }
    try {
      const res = await API.call('actualizarEstadoProyecto', { id, estado: p.ESTADO, tecnico });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      Store.upsert(this.DB.proyectos, res.data);
      this.renderTabla(document.getElementById('pry-filtro-estado')?.value || '');
      UI.toast('Responsable asignado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
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

  async eliminarProyecto() {
    const id = document.getElementById('pry-detalle-id')?.value;
    if (!id) return;
    if (!UI.confirmar(`¿Eliminar el proyecto "${id}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await API.call('eliminarProyecto', { idProyecto: id });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      Store.remove(this.DB.proyectos, res.rowIndex);
      this.renderTabla(document.getElementById('pry-filtro-estado')?.value || '');
      this.cerrarModal('pry-modal-detalle');
      UI.toast('Proyecto eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  cerrarModal(id) {
    // Las líneas de presupuesto "sin guardar" solo viven en memoria — si
    // se cierra el modal sin apretar "Guardar presupuesto", se pierden.
    // Avisar antes en vez de descartarlas en silencio.
    if (id === 'pry-modal-detalle' && (this._presupuestoPendiente || []).length) {
      if (!UI.confirmar(`Tienes ${this._presupuestoPendiente.length} línea(s) de presupuesto sin guardar. ¿Cerrar de todos modos y perderlas?`)) return;
      this._presupuestoPendiente = [];
    }
    document.getElementById(id)?.classList.remove('open');
  }
};


/* ═══════════════════════════════════════════════
   ALMACEN (mostrado como "Compras" en la interfaz) — registro de compras
   reales por proyecto: cada fila es una compra (proveedor, cantidad,
   precio y a qué proyecto se cargó), no un catálogo de inventario físico
   — SENERPOT no maneja bodega.
═══════════════════════════════════════════════ */
const ALMACEN = {

  DB: [],
  _proyectos: [],
  CATEGORIAS: ['MATERIALES','EQUIPOS','HERRAMIENTAS','SERVICIOS','REPUESTOS','OTROS'],

  async init() {
    try {
      const data = await DatosERP.obtener();
      this.DB = data.almacen || [];
      this._proyectos = data.proyectos || [];
      this.render();
    } catch(e) { UI.toast('Error cargando compras', 'err'); }
  },

  render() {
    this.renderTabla();
    this.poblarFiltros();
  },

  nombreProyecto(idProyecto) {
    if (!idProyecto) return '<span style="color:#ccc">— General —</span>';
    const p = this._proyectos.find(x => x.ID_PROYECTO === idProyecto);
    return p ? `${p.ID_PROYECTO} — ${p.CLIENTE||''}` : idProyecto;
  },

  renderTabla(filtro = '') {
    const tbody = document.getElementById('alm-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let lista = this.DB || [];
    if (filtro) lista = lista.filter(i => String(i.CATEGORIA||'').toUpperCase() === filtro.toUpperCase());
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">Sin compras registradas todavía.</td></tr>';
      return;
    }
    lista.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge badge-blue" style="font-size:10px">${i.CATEGORIA||''}</span></td>
        <td>${i.DESCRIPCION||''}</td>
        <td>${i.UNIDAD||'UN'}</td>
        <td class="text-right">${i.CANTIDAD||1}</td>
        <td>${i.PROVEEDOR||'—'}</td>
        <td class="text-right">${UI.moneda(i.PRECIO_COMPRA||0)}</td>
        <td style="font-size:12px;">${this.nombreProyecto(i.ID_PROYECTO)}</td>
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

  poblarSelectProyectos(actual = '') {
    const sel = document.getElementById('alm-sel-proyecto');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Compra general (sin proyecto) —</option>';
    this._proyectos.forEach(p => {
      const o = document.createElement('option');
      o.value = p.ID_PROYECTO;
      o.text  = `${p.ID_PROYECTO} — ${p.CLIENTE||''}`;
      sel.add(o);
    });
    sel.value = actual;
  },

  abrirModal(i = null) {
    document.getElementById('alm-modal-title').textContent = i ? 'Editar Compra' : 'Nueva Compra';
    document.getElementById('alm-edit-idx').value = i ? i._rowIndex : '';
    // ID_ITEM es el ID inmutable asignado al crear el ítem (ver Proyectos.gs)
    // — se reenvía en guardar()/eliminar() para el bloqueo optimista.
    this._editId = i ? i.ID_ITEM : null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('alm-cat-modal',   i?.CATEGORIA || 'MATERIALES');
    set('alm-desc',         i?.DESCRIPCION);
    set('alm-unidad',       i?.UNIDAD || 'UN');
    set('alm-cantidad',     i?.CANTIDAD || 1);
    set('alm-proveedor',    i?.PROVEEDOR);
    set('alm-precio-c',     i?.PRECIO_COMPRA || 0);
    set('alm-precio-v',     i?.PRECIO_VENTA  || 0);
    set('alm-referencia',   i?.REFERENCIA);
    set('alm-notas-modal',  i?.NOTAS);
    this.poblarSelectProyectos(i?.ID_PROYECTO || '');
    document.getElementById('alm-modal').classList.add('open');
  },

  editarUI(i) { this.abrirModal(i); },

  cerrarModal() { document.getElementById('alm-modal')?.classList.remove('open'); },

  async guardar(btn) {
    // Sin esto, un clic mientras Apps Script todavía está respondiendo
    // (puede tardar varios segundos) parece no hacer nada, y el impulso
    // natural es volver a hacer clic — eso duplica la compra. Deshabilitar
    // el botón apenas se hace clic evita que un segundo clic dispare una
    // segunda escritura antes de que vuelva la respuesta de la primera.
    if (this._guardando) return;
    this._guardando = true;
    UI.spin(btn, true);

    const obj = {
      _rowIndex:    document.getElementById('alm-edit-idx')?.value,
      id:           this._editId || undefined,
      categoria:    document.getElementById('alm-cat-modal')?.value,
      descripcion:  document.getElementById('alm-desc')?.value,
      unidad:       document.getElementById('alm-unidad')?.value || 'UN',
      cantidad:     document.getElementById('alm-cantidad')?.value || 1,
      proveedor:    document.getElementById('alm-proveedor')?.value,
      precioCompra: document.getElementById('alm-precio-c')?.value || 0,
      precioVenta:  document.getElementById('alm-precio-v')?.value || 0,
      idProyecto:   document.getElementById('alm-sel-proyecto')?.value || '',
      referencia:   document.getElementById('alm-referencia')?.value,
      notas:        document.getElementById('alm-notas-modal')?.value
    };
    if (!obj.descripcion) { UI.toast('Falta descripción', 'warn'); this._guardando = false; UI.spin(btn, false); return; }
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
      UI.toast('Compra guardada', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardando = false; UI.spin(btn, false); }
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

  // null = mes actual (default al entrar); 0-11 = ese mes del año en curso;
  // 'ANIO' = todo el año. Se guarda aquí (no solo en el <select>) para que
  // recargar los datos y volver a pintar no dependa de leer el DOM primero.
  periodo: null,

  ESTADO_HEX: { POR_INICIAR:'#64748B', EN_PROGRESO:'#3B82F6', PAUSADO:'#F59E0B', TERMINADO:'#009E60', FACTURADO:'#1D9E75', COBRADO:'#00593E' },

  async init() {
    const el = document.getElementById('panel-loader');
    if (el) el.style.display = 'flex';
    try {
      // getDashboard (Contabilidad) y DatosERP (Ofertas/Proyectos) son
      // fuentes independientes — se piden en paralelo, no una tras otra.
      // DatosERP ya está cacheada si Ofertas/Proyectos se visitaron antes
      // en esta sesión (ver DatosERP en api.js), así que esto puede no
      // costar ninguna llamada nueva de red.
      const [data, erp] = await Promise.all([API.call('getDashboard'), DatosERP.obtener()]);
      if (el) el.style.display = 'none';
      document.getElementById('panel-content').style.display = 'block';
      this.renderKPIs(data.kpis);
      this.renderCharts(data.charts);
      const sel = document.getElementById('panel-periodo');
      if (sel) sel.value = String(new Date().getMonth()); // arranca en el mes actual
      this._erp = erp;
      this.renderHero(erp);
      this.renderResumen();
      this.renderTendenciaOfertas(erp.historial || []);
      this.renderProyectosPorEstado(erp.proyectos || []);
    } catch(e) {
      if (el) el.innerHTML = '<div style="color:#D32F2F">Error: ' + e.message + '</div>';
    }
  },

  cambiarPeriodo() {
    const sel = document.getElementById('panel-periodo');
    this.periodo = sel.value === 'ANIO' ? 'ANIO' : parseInt(sel.value, 10);
    this.renderResumen();
  },

  // ── Utilidades de fecha/animación ──────────────
  // BD_OFERTAS.FECHA / BD_PROYECTOS.FECHA_CREACION llegan como "dd/MM/yyyy"
  // o "dd/MM/yyyy HH:mm" (Sheets autoconvierte fechas al escribir) —
  // new Date(str) con ese formato la interpretaría como MM/dd/yyyy y daría
  // el mes equivocado, así que se parsea a mano. Todos los datos actuales
  // son de 2026 — cuando exista un segundo año, esto se extiende con un
  // selector de año además del de mes.
  _partesFecha(fechaStr) {
    const p = String(fechaStr||'').split(' ')[0].split('/');
    if (p.length !== 3) return null;
    return { dia: parseInt(p[0],10), mes: parseInt(p[1],10)-1, anio: parseInt(p[2],10) };
  },

  _coincideConPeriodo(fechaStr) {
    const f = this._partesFecha(fechaStr);
    if (!f || f.anio !== new Date().getFullYear()) return false;
    if (this.periodo === 'ANIO') return true;
    const mesObjetivo = this.periodo === null ? new Date().getMonth() : this.periodo;
    return f.mes === mesObjetivo;
  },

  // Conteo animado (ease-out) para que los números del panel se sientan
  // vivos al cargar — respeta prefers-reduced-motion en vez de forzar la
  // animación a quien la desactivó por accesibilidad.
  _animar(el, valorFinal, formateador) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !isFinite(valorFinal)) { el.textContent = formateador(valorFinal); return; }
    const t0 = performance.now(), duracion = 650;
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / duracion);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = formateador(valorFinal * ease);
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  },

  // Compara el valor del período elegido contra el mes inmediatamente
  // anterior — solo tiene sentido cuando se está viendo un mes puntual
  // (comparar "todo el año" contra "el mes anterior" no significa nada),
  // así que en "ANIO" simplemente no se muestra badge.
  _trendHTML(actual, anterior) {
    if (this.periodo === 'ANIO' || anterior === null) return '';
    if (anterior === 0) return actual > 0 ? `<div class="metric-trend up"><i class="ti ti-arrow-up-right"></i> nuevo</div>` : '';
    const delta = ((actual - anterior) / anterior) * 100;
    if (Math.abs(delta) < 1) return `<div class="metric-trend flat"><i class="ti ti-minus"></i> igual que antes</div>`;
    const cls = delta > 0 ? 'up' : 'down';
    const icon = delta > 0 ? 'ti-arrow-up-right' : 'ti-arrow-down-right';
    return `<div class="metric-trend ${cls}"><i class="ti ${icon}"></i> ${Math.abs(delta).toFixed(0)}% vs. mes anterior</div>`;
  },

  renderResumen() {
    if (!this._erp) return;
    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const label = document.getElementById('panel-periodo-label');
    if (label) {
      const nombrePeriodo = this.periodo === 'ANIO' ? ('Todo ' + new Date().getFullYear())
        : MESES[this.periodo === null ? new Date().getMonth() : this.periodo] + ' ' + new Date().getFullYear();
      label.textContent = 'Ofertas y Proyectos — ' + nombrePeriodo;
    }
    this.renderResumenOfertas(this._erp.historial || []);
    this.renderResumenProyectos(this._erp.proyectos || []);
  },

  renderResumenOfertas(historial) {
    const delPeriodo = historial.filter(h => this._coincideConPeriodo(h.FECHA));
    const generadas  = delPeriodo.filter(h => h.ESTADO === 'GENERADA').length;
    const aprobadas  = delPeriodo.filter(h => h.ESTADO === 'APROBADA').length;
    const rechazadas = delPeriodo.filter(h => h.ESTADO === 'RECHAZADA').length;
    const valor = delPeriodo.reduce((s,h) => s + OFERTAS.parseTotalOferta(h.TOTAL), 0);

    // Mes anterior, para las flechitas de tendencia — solo se calcula si
    // hay un mes puntual seleccionado (ver _trendHTML).
    let deltaTotal = null, deltaAprobadas = null, deltaValor = null;
    if (this.periodo !== 'ANIO') {
      const mesActual = this.periodo === null ? new Date().getMonth() : this.periodo;
      const mesAnterior = (mesActual + 11) % 12;
      const delMesAnterior = historial.filter(h => {
        const f = this._partesFecha(h.FECHA);
        return f && f.anio === new Date().getFullYear() && f.mes === mesAnterior;
      });
      deltaTotal = delMesAnterior.length;
      deltaAprobadas = delMesAnterior.filter(h => h.ESTADO === 'APROBADA').length;
      deltaValor = delMesAnterior.reduce((s,h) => s + OFERTAS.parseTotalOferta(h.TOTAL), 0);
    }

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    this._animar(document.getElementById('panel-of-total'), delPeriodo.length, v => Math.round(v));
    set('panel-of-generadas',  generadas);
    this._animar(document.getElementById('panel-of-aprobadas'), aprobadas, v => Math.round(v));
    set('panel-of-rechazadas', rechazadas);
    this._animar(document.getElementById('panel-of-valor'), valor, v => UI.moneda(v));

    const trendEl = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    trendEl('panel-of-total-trend',     this._trendHTML(delPeriodo.length, deltaTotal));
    trendEl('panel-of-aprobadas-trend', this._trendHTML(aprobadas, deltaAprobadas));
    trendEl('panel-of-valor-trend',     this._trendHTML(valor, deltaValor));
  },

  renderResumenProyectos(proyectos) {
    const delPeriodo = proyectos.filter(p => this._coincideConPeriodo(p.FECHA_CREACION));
    const activos = delPeriodo.filter(p => !['TERMINADO','FACTURADO','COBRADO'].includes(p.ESTADO));
    const porIniciar = delPeriodo.filter(p => p.ESTADO === 'POR_INICIAR').length;
    const enProgreso = delPeriodo.filter(p => p.ESTADO === 'EN_PROGRESO').length;
    const valor = delPeriodo.reduce((s,p) => s + (parseFloat(p.VALOR)||0), 0);

    this._animar(document.getElementById('panel-pry-activos'), activos.length, v => Math.round(v));
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('panel-pry-porIniciar', porIniciar);
    set('panel-pry-enProgreso', enProgreso);
    this._animar(document.getElementById('panel-pry-valor'), valor, v => UI.moneda(v));
  },

  // El número que abre la conversación con la junta — deliberadamente
  // histórico completo (no depende del selector de período), porque
  // responde a "¿cómo va el negocio en general?", no "¿cómo va este mes?".
  renderHero(erp) {
    const hist = erp.historial || [], proy = erp.proyectos || [], cli = erp.clientes || [];
    const pipelineTotal = hist.reduce((s,h) => s + OFERTAS.parseTotalOferta(h.TOTAL), 0);
    const aprobadas  = hist.filter(h => h.ESTADO === 'APROBADA').length;
    const rechazadas = hist.filter(h => h.ESTADO === 'RECHAZADA').length;
    const decididas  = aprobadas + rechazadas;
    const winRate = decididas > 0 ? (aprobadas / decididas * 100) : 0;
    const proyectosActivos = proy.filter(p => !['TERMINADO','FACTURADO','COBRADO'].includes(p.ESTADO)).length;

    this._animar(document.getElementById('panel-hero-pipeline'), pipelineTotal, v => UI.moneda(v));
    const sub = document.getElementById('panel-hero-sub');
    if (sub) sub.textContent = `${hist.length} oferta${hist.length===1?'':'s'} registrada${hist.length===1?'':'s'} desde el inicio`;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('panel-hero-winrate', decididas > 0 ? winRate.toFixed(0) + '%' : '—');
    set('panel-hero-proyectos', proyectosActivos);
    set('panel-hero-clientes', cli.length);
  },

  renderKPIs(kpis) {
    if (!kpis) return;
    this._animar(document.getElementById('panel-ventas'),   kpis.ventas   || 0, v => UI.moneda(v));
    this._animar(document.getElementById('panel-gastos'),   kpis.gastos   || 0, v => UI.moneda(v));
    this._animar(document.getElementById('panel-utilidad'), kpis.utilidad || 0, v => UI.moneda(v));
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('panel-margen',   (kpis.margen || 0).toFixed(1) + '%');
    this._animar(document.getElementById('panel-cartera'), kpis.cartera || 0, v => UI.moneda(v));
  },

  // Evolución del año completo (independiente del selector de período) —
  // cotizado vs. aprobado, mes a mes, para ver la tendencia real del
  // negocio de un vistazo en vez de un solo número puntual.
  renderTendenciaOfertas(historial) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('panel-chart-tendencia-ofertas');
    if (!ctx) return;
    const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const anio = new Date().getFullYear();
    const cotizado = new Array(12).fill(0), aprobado = new Array(12).fill(0);
    historial.forEach(h => {
      const f = this._partesFecha(h.FECHA);
      if (!f || f.anio !== anio) return;
      cotizado[f.mes] += OFERTAS.parseTotalOferta(h.TOTAL);
      if (h.ESTADO === 'APROBADA') aprobado[f.mes] += OFERTAS.parseTotalOferta(h.TOTAL);
    });

    if (this.charts.tendenciaOfertas) { try { this.charts.tendenciaOfertas.destroy(); } catch(e) {} }
    const gCotizado = ctx.getContext('2d').createLinearGradient(0,0,0,260);
    gCotizado.addColorStop(0, 'rgba(139,92,246,.28)'); gCotizado.addColorStop(1, 'rgba(139,92,246,0)');
    const gAprobado = ctx.getContext('2d').createLinearGradient(0,0,0,260);
    gAprobado.addColorStop(0, 'rgba(0,158,96,.32)'); gAprobado.addColorStop(1, 'rgba(0,158,96,0)');

    this.charts.tendenciaOfertas = new Chart(ctx, {
      type: 'line',
      data: {
        labels: MESES,
        datasets: [
          { label: 'Cotizado', data: cotizado, borderColor: '#8B5CF6', backgroundColor: gCotizado, tension: .4, fill: true, pointRadius: 2, pointHoverRadius: 5 },
          { label: 'Aprobado', data: aprobado, borderColor: '#009E60', backgroundColor: gAprobado, tension: .4, fill: true, pointRadius: 2, pointHoverRadius: 5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#64748B', boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + UI.moneda(c.parsed.y) } } },
        scales: { y: { ticks: { color: '#94A3B8', callback: (v) => UI.moneda(v) }, grid: { color: '#E2E8F0' } }, x: { ticks: { color: '#94A3B8' }, grid: { display: false } } }
      }
    });
  },

  // Dona de proyectos por estado — mismos colores que las badges del
  // módulo Proyectos, para que un mismo estado se vea siempre igual en
  // toda la app.
  renderProyectosPorEstado(proyectos) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('panel-chart-proyectos-estado');
    if (!ctx) return;
    const ESTADOS = ['POR_INICIAR','EN_PROGRESO','PAUSADO','TERMINADO','FACTURADO','COBRADO'];
    const conteo = ESTADOS.map(e => proyectos.filter(p => p.ESTADO === e).length);
    const labels = ESTADOS.filter((e,i) => conteo[i] > 0);
    const data   = conteo.filter(c => c > 0);
    const colores = labels.map(e => this.ESTADO_HEX[e]);

    if (this.charts.proyectosEstado) { try { this.charts.proyectosEstado.destroy(); } catch(e) {} }
    if (!data.length) return;
    this.charts.proyectosEstado = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colores, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { color: '#64748B', boxWidth: 10, font: { size: 11 } } } }
      }
    });
  },

  renderCharts(charts) {
    if (!charts || typeof Chart === 'undefined') return;

    // Destruir anteriores si existen (solo las de Contabilidad — las de
    // Ofertas/Proyectos se manejan en sus propias funciones)
    ['linea','clientes','servicios'].forEach(k => { if (this.charts[k]) { try { this.charts[k].destroy(); } catch(e) {} } });

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
