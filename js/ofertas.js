/**
 * SENERPOT — ofertas.js v1.0
 * Lógica completa del módulo Ofertas.
 * Adaptado de App 1 (Generador de Ofertas v23.2).
 * Usa API.call() en lugar de google.script.run.
 */

const OFERTAS = {

  DB: { clientes: [], items: [], kits: [], activos: [], historial: [] },

  // ──────────────────────────────────────────
  //  INICIALIZACIÓN
  // ──────────────────────────────────────────
  async init() {
    this.mostrarFecha();
    this.addActivo();
    this.addAlcance();
    try {
      const data = await API.call('obtenerDatos');
      this.DB = data;
      this.render();
    } catch(e) {
      UI.toast('Error cargando datos: ' + e.message, 'err');
    }
  },

  render() {
    this.renderSelectClientes();
    this.renderTablaClientes();
    this.renderTablaServicios();
    this.renderTablaHistorial();
    this.renderSelectKits();
    this.poblarCatalogo();
    this.sugerirConsecutivo();
  },

  async recargar() {
    try {
      const data = await API.call('obtenerDatos');
      this.DB = data;
      this.render();
    } catch(e) { UI.toast('Error recargando datos', 'err'); }
  },

  // ──────────────────────────────────────────
  //  NAVEGACIÓN DE SUBTABS
  // ──────────────────────────────────────────
  tab(id) {
    document.querySelectorAll('#view-ofertas .subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#view-ofertas .subview').forEach(v => v.classList.remove('active'));
    document.getElementById('ot-' + id)?.classList.add('active');
    document.getElementById('ov-' + id)?.classList.add('active');
  },

  // ──────────────────────────────────────────
  //  RENDERIZADO DE DATOS
  // ──────────────────────────────────────────
  renderSelectClientes() {
    const sel = document.getElementById('of-cli-select');
    sel.innerHTML = '<option value="">-- Seleccionar cliente --</option>';
    this.DB.clientes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(c);
      opt.text  = c.EMPRESA_NOMBRE || c.EMPRESA || 'Sin nombre';
      sel.add(opt);
    });
  },

  renderTablaClientes() {
    const tbody = document.getElementById('of-tbody-cli');
    tbody.innerHTML = '';
    this.DB.clientes.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.EMPRESA_NOMBRE || c.EMPRESA || ''}</td>
        <td>${c.NIT || '-'}</td>
        <td>${c.ATENCION_A || c.ATENCION || '-'}</td>
        <td>${c.TELEFONO || '-'}</td>
        <td>
          <button class="btn-icon btn-icon-edit" onclick='OFERTAS.editarClienteUI(${JSON.stringify(c).replace(/'/g,"&#39;")})' title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn-icon btn-icon-del"  onclick="OFERTAS.eliminarClienteUI(${c._rowIndex})" title="Eliminar"><i class="ti ti-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  renderTablaServicios() {
    const tbody = document.getElementById('of-tbody-srv');
    tbody.innerHTML = '';
    this.DB.items.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i.CODIGO || ''}</td>
        <td>${i.DESCRIPCION_SERVICIO || i.DESCRIPCION || ''}</td>
        <td>${i.UNIDAD || 'UN'}</td>
        <td>${UI.moneda(i.PRECIO_VENTA_LISTA || i.PRECIO || 0)}</td>
        <td>
          <button class="btn-icon btn-icon-edit" onclick='OFERTAS.editarServicioUI(${JSON.stringify(i).replace(/'/g,"&#39;")})' title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn-icon btn-icon-del"  onclick="OFERTAS.eliminarServicioUI(${i._rowIndex})" title="Eliminar"><i class="ti ti-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  renderTablaHistorial() {
    const tbody = document.getElementById('of-tbody-hist');
    tbody.innerHTML = '';
    const hist = [...(this.DB.historial || [])].reverse();
    hist.forEach(h => {
      const badgeClass = h.ESTADO === 'GENERADA' ? 'badge-green' : 'badge-orange';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${h.ID_OFERTA}</td>
        <td>${h.FECHA}</td>
        <td>${h.CLIENTE}</td>
        <td>${h.TOTAL}</td>
        <td><span class="badge ${badgeClass}">${h.ESTADO}</span></td>
        <td>
          <button class="btn-icon btn-icon-edit" onclick="OFERTAS.gestionarOferta('${h.ID_OFERTA}','CARGAR')" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" style="color:#1976D2" onclick="OFERTAS.gestionarOferta('${h.ID_OFERTA}','CLONAR')" title="Clonar"><i class="ti ti-copy"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  renderSelectKits() {
    const selTextos = document.getElementById('of-sel-kit-textos');
    const selItems  = document.getElementById('of-sel-kit-items');
    selTextos.innerHTML = '<option value="">Kit de textos...</option>';
    selItems.innerHTML  = '<option value="">Kit de precios...</option>';
    if (!this.DB.kits) return;
    this.DB.kits.forEach(k => {
      let nombre = k.NOMBRE || k.Nombre || '';
      if (nombre.length > 60) nombre = nombre.slice(0, 57) + '...';
      const tipo   = String(k.TIPO || k.Tipo).toUpperCase();
      const data   = k.DATA_JSON || k.Data_Json;
      if (!data) return;
      const opt = document.createElement('option');
      opt.value = data; opt.text = nombre;
      if (tipo === 'TEXTOS') selTextos.add(opt);
      else if (tipo === 'ITEMS') selItems.add(opt.cloneNode(true));
    });
  },

  poblarCatalogo() {
    const sel = document.getElementById('of-sel-item-db');
    sel.innerHTML = '<option value="">Buscar servicio del catálogo...</option>';
    this.DB.items.forEach(i => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(i);
      let texto = (i.CODIGO ? i.CODIGO + ' — ' : '') + (i.DESCRIPCION_SERVICIO || i.DESCRIPCION || '');
      if (texto.length > 75) texto = texto.slice(0, 72) + '...';
      opt.text = texto;
      sel.add(opt);
    });
  },

  sugerirConsecutivo() {
    const input = document.getElementById('of-consecutivo');
    if (input.value.trim()) return;
    if (!this.DB.historial?.length) return;
    const ultimo = this.DB.historial[this.DB.historial.length - 1].ID_OFERTA;
    if (!ultimo) return;
    const m = ultimo.match(/^(.*?)(\d+)$/);
    if (m) {
      const next = String(parseInt(m[2]) + 1).padStart(m[2].length, '0');
      input.value = m[1] + next;
    }
  },

  mostrarFecha() {
    const d = new Date();
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    document.getElementById('of-fecha').value = `Barranquilla, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  },

  // ──────────────────────────────────────────
  //  CARGA DE CLIENTE
  // ──────────────────────────────────────────
  cargarCliente() {
    const val = document.getElementById('of-cli-select').value;
    if (!val) return;
    const c = JSON.parse(val);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('of-cli-dir',   c.DIRECCION);
    set('of-cli-attn',  c.ATENCION_A || c.ATENCION);
    set('of-cli-tel',   c.TELEFONO);
    set('of-cli-email', c.EMAIL);
  },

  limpiarCliente() {
    ['of-cli-select','of-cli-dir','of-cli-attn','of-cli-tel','of-cli-email'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  // ──────────────────────────────────────────
  //  FILAS DINÁMICAS
  // ──────────────────────────────────────────
  addActivo(data = null) {
    const tbody = document.getElementById('of-tbody-activos');
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="act-tipo"  value="${data?.tipo  || 'PAD MOUNTED'}"></td>
      <td><input type="text" class="act-marca" value="${data?.marca || ''}" placeholder="(Opcional)"></td>
      <td><input type="text" class="act-kva"   value="${data?.kva   || ''}" placeholder="KVA"></td>
      <td><input type="text" class="act-serie" value="${data?.serie || ''}" placeholder="Serie"></td>
      <td><input type="text" class="act-volt"  value="${data?.voltaje || ''}" placeholder="Voltaje"></td>
      <td style="text-align:center;">
        <button class="btn-icon btn-icon-del" onclick="this.closest('tr').remove()" title="Eliminar"><i class="ti ti-x"></i></button>
      </td>`;
    tbody.appendChild(tr);
  },

  addAlcance(texto = '') {
    const tbody = document.getElementById('of-tbody-alcance');
    const tr    = document.createElement('tr');
    tr.innerHTML = `
      <td style="width:24px;color:var(--primary);text-align:center;">❖</td>
      <td><input type="text" class="inp-alcance" value="${texto}" placeholder="Describa la actividad..."></td>
      <td style="width:70px;text-align:center;">
        <button class="btn-icon" style="color:#888" onclick="OFERTAS.moverFila(this,-1)" title="Subir">↑</button>
        <button class="btn-icon" style="color:#888" onclick="OFERTAS.moverFila(this,1)"  title="Bajar">↓</button>
        <button class="btn-icon btn-icon-del" onclick="this.closest('tr').remove()">×</button>
      </td>`;
    tbody.appendChild(tr);
  },

  addFila(datos = null) {
    const tbody = document.getElementById('of-tbody-items');
    const tr    = document.createElement('tr');
    const cod   = datos?.cod  || '';
    const desc  = datos?.desc || '';
    const cant  = datos?.cant || 1;
    const unit  = datos?.val  || 0;
    const tot   = Number(cant) * Number(unit);
    tr.innerHTML = `
      <td><input type="text"   class="inp-cod"   value="${cod}"></td>
      <td><input type="text"   class="inp-desc"  value="${desc}" placeholder="Descripción..."></td>
      <td><input type="text"   class="inp-un"    value="UN" style="text-align:center;"></td>
      <td><input type="number" class="inp-cant"  value="${cant}" onchange="OFERTAS.calcFila(this)"></td>
      <td><input type="number" class="inp-val"   value="${unit}" onchange="OFERTAS.calcFila(this)"></td>
      <td><input type="text"   class="inp-total" value="${tot}"  readonly style="background:#f5f5f5;"></td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn-icon" style="color:#888" onclick="OFERTAS.moverFila(this,-1)">↑</button>
        <button class="btn-icon" style="color:#888" onclick="OFERTAS.moverFila(this,1)">↓</button>
        <button class="btn-icon" style="color:var(--primary)" onclick="OFERTAS.guardarItemUI(this)" title="Guardar al catálogo"><i class="ti ti-device-floppy"></i></button>
        <button class="btn-icon btn-icon-del" onclick="OFERTAS.borrarFila(this)"><i class="ti ti-x"></i></button>
      </td>`;
    tbody.appendChild(tr);
    this.calcularTotales();
  },

  addItemDesdeCat() {
    const val = document.getElementById('of-sel-item-db').value;
    if (!val) { UI.toast('Seleccione un servicio del catálogo', 'warn'); return; }
    const item = JSON.parse(val);
    this.addFila({
      cod:  item.CODIGO || '',
      desc: item.DESCRIPCION_SERVICIO || item.DESCRIPCION || '',
      cant: 1,
      val:  item.PRECIO_VENTA_LISTA || item.PRECIO || 0
    });
    document.getElementById('of-sel-item-db').value = '';
  },

  moverFila(btn, dir) {
    const row = btn.closest('tr');
    if (dir === -1 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    else if (dir === 1 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
  },

  calcFila(input) {
    const tr   = input.closest('tr');
    const cant = parseFloat(tr.querySelector('.inp-cant').value) || 0;
    const val  = parseFloat(tr.querySelector('.inp-val').value)  || 0;
    tr.querySelector('.inp-total').value = cant * val;
    this.calcularTotales();
  },

  borrarFila(btn) { btn.closest('tr').remove(); this.calcularTotales(); },

  calcularTotales() {
    let sub = 0;
    document.querySelectorAll('.inp-total').forEach(i => sub += parseFloat(i.value || 0));
    const iva   = sub * 0.19;
    const total = sub + iva;
    document.getElementById('of-subtotal').textContent = UI.moneda(sub);
    document.getElementById('of-iva').textContent      = UI.moneda(iva);
    document.getElementById('of-total').textContent    = UI.moneda(total);
  },

  // ──────────────────────────────────────────
  //  KITS
  // ──────────────────────────────────────────
  aplicarKit(tipo, jsonData) {
    if (!jsonData) return;
    const data = JSON.parse(jsonData);
    if (tipo === 'TEXTOS') {
      document.getElementById('of-objeto').value      = data.objeto || '';
      document.getElementById('of-alcance-gral').value = data.alcance_gral || '';
      document.getElementById('of-tbody-alcance').innerHTML = '';
      const lista = Array.isArray(data.alcance_act) ? data.alcance_act :
                    (data.alcance_act || '').split('\n').filter(l => l.trim());
      lista.forEach(l => this.addAlcance(l));
    } else if (tipo === 'ITEMS') {
      document.getElementById('of-tbody-items').innerHTML = '';
      data.forEach(k => this.addFila(k));
    }
  },

  async guardarKitUI(tipo) {
    let dataToSave;
    if (tipo === 'TEXTOS') {
      const lista = [];
      document.querySelectorAll('.inp-alcance').forEach(i => { if (i.value.trim()) lista.push(i.value.trim()); });
      dataToSave = { objeto: document.getElementById('of-objeto').value, alcance_gral: document.getElementById('of-alcance-gral').value, alcance_act: lista };
      if (!dataToSave.objeto) { UI.toast('El objeto está vacío', 'warn'); return; }
    } else if (tipo === 'ITEMS') {
      dataToSave = [];
      document.querySelectorAll('#of-tbody-items tr').forEach(tr => {
        dataToSave.push({ cod: tr.querySelector('.inp-cod').value, desc: tr.querySelector('.inp-desc').value, cant: tr.querySelector('.inp-cant').value, val: tr.querySelector('.inp-val').value });
      });
      if (!dataToSave.length) { UI.toast('La tabla está vacía', 'warn'); return; }
    }
    const nombre = prompt('Nombre para este kit:');
    if (!nombre) return;
    try {
      this.DB = await API.call('guardarKit', { nombre, tipo, dataJson: JSON.stringify(dataToSave) });
      this.renderSelectKits();
      UI.toast('Kit guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  GUARDAR ÍTEM AL CATÁLOGO
  // ──────────────────────────────────────────
  async guardarItemUI(btn) {
    const tr   = btn.closest('tr');
    const desc = tr.querySelector('.inp-desc').value.trim();
    if (!desc) { UI.toast('Falta descripción', 'warn'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>';
    try {
      this.DB = await API.call('guardarServicio', {
        codigo:      tr.querySelector('.inp-cod').value,
        descripcion: desc,
        unidad:      tr.querySelector('.inp-un').value,
        precio:      tr.querySelector('.inp-val').value
      });
      this.renderTablaServicios();
      this.poblarCatalogo();
      btn.innerHTML = '<i class="ti ti-check"></i>';
      setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i>'; }, 2000);
    } catch(e) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i>'; UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  RECUPERAR DATOS DEL FORMULARIO
  // ──────────────────────────────────────────
  recuperarFormulario() {
    const cliRaw = document.getElementById('of-cli-select').value;
    if (!cliRaw) return null;
    const cliente = JSON.parse(cliRaw);
    const activosLista = [];
    document.querySelectorAll('#of-tbody-activos tr').forEach(tr => {
      const marca = tr.querySelector('.act-marca').value;
      const kva   = tr.querySelector('.act-kva').value;
      if (marca || kva) activosLista.push({
        tipo: tr.querySelector('.act-tipo').value, marca, kva,
        serie: tr.querySelector('.act-serie').value, voltaje: tr.querySelector('.act-volt').value
      });
    });
    const alcanceLista = [];
    document.querySelectorAll('.inp-alcance').forEach(i => { if (i.value.trim()) alcanceLista.push(i.value.trim()); });
    const itemsData = [];
    document.querySelectorAll('#of-tbody-items tr').forEach(tr => {
      itemsData.push({
        codigo:      tr.querySelector('.inp-cod').value,
        descripcion: tr.querySelector('.inp-desc').value,
        unidad:      tr.querySelector('.inp-un').value,
        cantidad:    tr.querySelector('.inp-cant').value,
        unitario:    tr.querySelector('.inp-val').value,
        total:       tr.querySelector('.inp-total').value
      });
    });
    return {
      fechaHeader:  document.getElementById('of-fecha').value,
      consecutivo:  document.getElementById('of-consecutivo').value,
      cliente,
      activosLista,
      textos: {
        objeto:                  document.getElementById('of-objeto').value,
        alcance_gral:            document.getElementById('of-alcance-gral').value,
        alcance_act_lista:       alcanceLista,
        cond_pago:               document.getElementById('of-cond-pago').value,
        terminos_financieros:    document.getElementById('of-cond-financieros').value,
        cond_vigencia:           document.getElementById('of-cond-vigencia').value,
        cond_tiempo:             document.getElementById('of-cond-tiempo').value,
        condiciones_notas:       document.getElementById('of-cond-notas').value,
        responsabilidades_cliente: document.getElementById('of-cond-resp').value,
        cond_garantia:           document.getElementById('of-cond-garantia').value
      },
      items: itemsData
    };
  },

  // ──────────────────────────────────────────
  //  GUARDAR BORRADOR
  // ──────────────────────────────────────────
  async guardarBorrador() {
    const datos = this.recuperarFormulario();
    if (!datos) { UI.toast('Seleccione un cliente', 'warn'); return; }
    const consec = document.getElementById('of-consecutivo').value.trim();
    if (!consec) { UI.toast('Ingrese el N° de oferta', 'warn'); return; }
    try {
      this.DB = await API.call('guardarHistorial', {
        idOferta: consec, clienteNombre: datos.cliente.EMPRESA_NOMBRE || datos.cliente.EMPRESA,
        total: document.getElementById('of-total').textContent, estado: 'BORRADOR', datos
      });
      this.renderTablaHistorial();
      UI.toast('Borrador guardado', 'ok');
      this.tab('historial');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  GENERAR OFERTA
  // ──────────────────────────────────────────
  async generarDocumento() {
    const datos = this.recuperarFormulario();
    if (!datos) { UI.toast('Seleccione un cliente', 'warn'); return; }
    if (!datos.consecutivo) { UI.toast('Ingrese el N° de oferta', 'warn'); return; }
    datos.total = document.getElementById('of-total').textContent;
    const btn = document.querySelector('.btn-generate');
    UI.spin(btn, true);
    try {
      const url = await API.call('procesarOferta', datos);
      window.open(url, '_blank');
      await this.recargar();
      UI.toast('Oferta generada exitosamente', 'ok');
    } catch(e) { UI.toast('Error: ' + e.message, 'err'); }
    finally { UI.spin(btn, false); }
  },

  // ──────────────────────────────────────────
  //  CARGAR / CLONAR DESDE HISTORIAL
  // ──────────────────────────────────────────
  gestionarOferta(id, accion) {
    const oferta = this.DB.historial.find(h => String(h.ID_OFERTA) === String(id));
    if (!oferta) { UI.toast('Oferta no encontrada', 'err'); return; }
    if (accion === 'CARGAR') this.cargarDesdeHistorial(oferta);
    else if (accion === 'CLONAR') { const clon = {...oferta}; clon.ID_OFERTA = ''; this.cargarDesdeHistorial(clon, true); }
  },

  cargarDesdeHistorial(h, esClon = false) {
    if (!h.DATA_JSON) { UI.toast('Sin datos de oferta', 'err'); return; }
    const data = JSON.parse(h.DATA_JSON);
    this.rellenarFormulario(data);
    document.getElementById('of-consecutivo').value = esClon ? '' : h.ID_OFERTA;
    if (esClon) this.sugerirConsecutivo();
    this.tab('generador');
  },

  rellenarFormulario(data) {
    const sel = document.getElementById('of-cli-select');
    for (let i = 0; i < sel.options.length; i++) {
      try {
        const c = JSON.parse(sel.options[i].value);
        if ((c.EMPRESA_NOMBRE || c.EMPRESA) === (data.cliente.EMPRESA_NOMBRE || data.cliente.EMPRESA)) {
          sel.selectedIndex = i; this.cargarCliente(); break;
        }
      } catch(e) {}
    }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('of-objeto',           data.textos.objeto);
    set('of-alcance-gral',     data.textos.alcance_gral);
    set('of-cond-pago',        data.textos.cond_pago);
    set('of-cond-financieros', data.textos.terminos_financieros);
    set('of-cond-vigencia',    data.textos.cond_vigencia);
    set('of-cond-tiempo',      data.textos.cond_tiempo);
    set('of-cond-notas',       data.textos.condiciones_notas);
    set('of-cond-resp',        data.textos.responsabilidades_cliente);
    set('of-cond-garantia',    data.textos.cond_garantia || 'Garantía integral de doce (12) meses.');
    document.getElementById('of-tbody-activos').innerHTML = '';
    (data.activosLista?.length ? data.activosLista : [null]).forEach(a => this.addActivo(a));
    document.getElementById('of-tbody-alcance').innerHTML = '';
    data.textos.alcance_act_lista?.forEach(t => this.addAlcance(t));
    document.getElementById('of-tbody-items').innerHTML = '';
    data.items?.forEach(it => this.addFila({ cod: it.codigo, desc: it.descripcion, val: it.unitario, cant: it.cantidad }));
  },

  // ──────────────────────────────────────────
  //  CLIENTES CRUD
  // ──────────────────────────────────────────
  modalCliente(c = null) {
    document.getElementById('of-title-cli').textContent = c ? 'Editar Cliente' : 'Nuevo Cliente';
    document.getElementById('of-cli-edit-idx').value = c ? c._rowIndex : '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('of-n-empresa', c?.EMPRESA_NOMBRE || c?.EMPRESA);
    set('of-n-nit',     c?.NIT);
    set('of-n-dir-m',   c?.DIRECCION);
    set('of-n-ciudad',  c?.CIUDAD || 'BARRANQUILLA');
    set('of-n-attn-m',  c?.ATENCION_A || c?.ATENCION);
    set('of-n-tel-m',   c?.TELEFONO);
    set('of-n-email-m', c?.EMAIL);
    document.getElementById('of-modal-cli').classList.add('open');
  },

  editarClienteUI(c) { this.modalCliente(c); },

  cerrarModal(id) { document.getElementById(id).classList.remove('open'); },

  async guardarClienteForm() {
    const obj = {
      _rowIndex: document.getElementById('of-cli-edit-idx').value,
      empresa:   document.getElementById('of-n-empresa').value,
      nit:       document.getElementById('of-n-nit').value,
      direccion: document.getElementById('of-n-dir-m').value,
      ciudad:    document.getElementById('of-n-ciudad').value,
      atencion:  document.getElementById('of-n-attn-m').value,
      telefono:  document.getElementById('of-n-tel-m').value,
      email:     document.getElementById('of-n-email-m').value
    };
    if (!obj.empresa) { UI.toast('Falta nombre de empresa', 'warn'); return; }
    try {
      const accion = obj._rowIndex ? 'editarCliente' : 'guardarCliente';
      this.DB = await API.call(accion, obj);
      this.renderSelectClientes(); this.renderTablaClientes();
      this.cerrarModal('of-modal-cli');
      UI.toast('Cliente guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async eliminarClienteUI(idx) {
    if (!UI.confirmar('¿Eliminar este cliente?')) return;
    try {
      this.DB = await API.call('eliminarCliente', { rowIndex: idx });
      this.renderSelectClientes(); this.renderTablaClientes();
      UI.toast('Cliente eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  SERVICIOS CRUD
  // ──────────────────────────────────────────
  modalServicio(i = null) {
    document.getElementById('of-title-srv').textContent = i ? 'Editar Servicio' : 'Nuevo Servicio';
    document.getElementById('of-srv-edit-idx').value = i ? i._rowIndex : '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('of-srv-cod',   i?.CODIGO);
    set('of-srv-desc',  i?.DESCRIPCION_SERVICIO || i?.DESCRIPCION);
    set('of-srv-un',    i?.UNIDAD || 'UN');
    set('of-srv-price', i?.PRECIO_VENTA_LISTA || i?.PRECIO);
    document.getElementById('of-modal-srv').classList.add('open');
  },

  editarServicioUI(i) { this.modalServicio(i); },

  async guardarServicioForm() {
    const obj = {
      _rowIndex:   document.getElementById('of-srv-edit-idx').value,
      codigo:      document.getElementById('of-srv-cod').value,
      descripcion: document.getElementById('of-srv-desc').value,
      unidad:      document.getElementById('of-srv-un').value,
      precio:      document.getElementById('of-srv-price').value
    };
    if (!obj.descripcion) { UI.toast('Falta descripción', 'warn'); return; }
    try {
      const accion = obj._rowIndex ? 'editarServicio' : 'guardarServicio';
      this.DB = await API.call(accion, obj);
      this.renderTablaServicios(); this.poblarCatalogo();
      this.cerrarModal('of-modal-srv');
      UI.toast('Servicio guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async eliminarServicioUI(idx) {
    if (!UI.confirmar('¿Eliminar este servicio?')) return;
    try {
      this.DB = await API.call('eliminarServicio', { rowIndex: idx });
      this.renderTablaServicios(); this.poblarCatalogo();
      UI.toast('Servicio eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async migrarHistorial() {
    if (!UI.confirmar('¿Importar todos los servicios del historial al catálogo?')) return;
    try {
      this.DB = await API.call('migrarHistorial');
      this.renderTablaServicios(); this.poblarCatalogo();
      UI.toast('Migración completada', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  BÚSQUEDA EN TABLAS
  // ──────────────────────────────────────────
  filtrar(idTabla, texto) {
    const rows = document.getElementById(idTabla)?.getElementsByTagName('tr') || [];
    for (const row of rows) {
      row.style.display = row.innerText.toLowerCase().includes(texto.toLowerCase()) ? '' : 'none';
    }
  }
};
