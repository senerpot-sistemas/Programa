/**
 * SENERPOT — contabilidad.js v1.0
 * Módulo ERP Contable completo.
 * Adaptado de SENERPOT ERP v14.15 (App 2).
 */

const CONTABILIDAD = {

  DB:           { config:{}, puc:[], terceros:[], productos:[], cartera:[], memoria:[] },
  MOVS:         [],
  abonosTemp:   [],

  // ──────────────────────────────────────────
  //  INIT
  // ──────────────────────────────────────────
  async init() {
    this.setFechaHoy();
    this.setFechasReporte();
    try {
      const data = await API.call('obtenerDatosERP');
      this.DB = data;
      this.renderUI();
    } catch(e) { UI.toast('Error cargando datos: ' + e.message, 'err'); }
  },

  renderUI() {
    // PUC + Memoria
    const listaPUC = [...(this.DB.puc || []), ...(this.DB.memoria || [])];
    this.fillDatalist('ct-dl-puc', listaPUC);

    // Terceros
    const dlTerc = document.getElementById('ct-dl-terceros');
    if (dlTerc) { dlTerc.innerHTML = ''; (this.DB.terceros || []).forEach(t => { const o = document.createElement('option'); o.value = t.texto; dlTerc.appendChild(o); }); }
    const dlTerc2 = document.getElementById('ct-dl-terceros-cons');
    if (dlTerc2) { dlTerc2.innerHTML = dlTerc?.innerHTML || ''; }

    // Productos
    const dlProd = document.getElementById('ct-dl-prod');
    if (dlProd) { dlProd.innerHTML = ''; (this.DB.productos || []).forEach(p => { const o = document.createElement('option'); o.value = p.codigo + ' — ' + p.nombre; dlProd.appendChild(o); }); }

    // Cartera para datalist
    const dlRef = document.getElementById('ct-dl-ref');
    if (dlRef) { dlRef.innerHTML = ''; (this.DB.cartera || []).forEach(f => { const o = document.createElement('option'); o.value = f.id; o.label = 'Saldo: ' + UI.moneda(f.saldo); dlRef.appendChild(o); }); }

    this.cambiarContexto();
  },

  fillDatalist(id, arr) {
    const dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = '';
    arr.forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
  },

  // ──────────────────────────────────────────
  //  SUBTABS
  // ──────────────────────────────────────────
  tab(id) {
    document.querySelectorAll('#view-contabilidad .subtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#view-contabilidad .subview').forEach(v => v.classList.remove('active'));
    document.getElementById('ctt-' + id)?.classList.add('active');
    document.getElementById('ctv-' + id)?.classList.add('active');
  },

  // ──────────────────────────────────────────
  //  TIPO DE DOCUMENTO
  // ──────────────────────────────────────────
  activarDoc(el) {
    document.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    el.querySelector('input').checked = true;
    this.cambiarContexto();
  },

  getTipoDoc() {
    const checked = document.querySelector('input[name="ct-td"]:checked');
    return checked ? checked.value : 'CE';
  },

  cambiarContexto() {
    const td = this.getTipoDoc();
    const lblTerc = document.getElementById('ct-lbl-tercero');
    const compOpts = document.getElementById('ct-compra-opts');
    const carteraPanel = document.getElementById('ct-cartera-panel');
    const refDiv = document.getElementById('ct-ref-div');
    const tabAuto = document.getElementById('ct-tab-auto-lbl');

    if (lblTerc) {
      const labels = { FV:'CLIENTE', CC:'CLIENTE', ND:'CLIENTE', FC:'PROVEEDOR', CE:'PROVEEDOR', NCR:'PROVEEDOR', RC:'RECIBIDO DE', NC:'TERCERO' };
      lblTerc.textContent = labels[td] || 'TERCERO';
    }

    if (compOpts)    compOpts.style.display    = ['FC','CE'].includes(td) ? 'flex' : 'none';
    if (carteraPanel) carteraPanel.style.display = td === 'RC'  ? 'block' : 'none';
    if (refDiv)      refDiv.style.display       = ['RC','NCR'].includes(td) ? 'block' : 'none';

    if (tabAuto) {
      if (['FV','CC'].includes(td)) {
        tabAuto.style.display = 'flex';
        this.toggleModo('auto');
      } else {
        tabAuto.style.display = 'none';
        this.toggleModo('manual');
      }
    }

    this.autoCompletarConcepto();
    if (td === 'RC') this.mostrarCartera();
    if (['RC','NCR'].includes(td)) this.actualizarListaRef();
  },

  // ──────────────────────────────────────────
  //  TERCERO / CONCEPTO / VENCIMIENTO
  // ──────────────────────────────────────────
  cambioTercero() {
    this.autoCompletarConcepto();
    const td = this.getTipoDoc();
    if (td === 'RC') this.mostrarCartera();
    if (['RC','NCR'].includes(td)) this.actualizarListaRef();
  },

  autoCompletarConcepto() {
    const tercRaw = document.getElementById('ct-tercero')?.value || '';
    const nombre  = tercRaw.split(' - ')[1] || tercRaw;
    const td      = this.getTipoDoc();
    const campo   = document.getElementById('ct-concepto');
    if (!nombre || !campo || campo.value) return;
    const map = { FV:`Servicios prestados a ${nombre}`, FC:`Compra a ${nombre}`, CE:`Pago proveedor ${nombre}`, RC:`Pago recibido de ${nombre}`, CC:`Cuenta de cobro a ${nombre}`, ND:`Nota débito a ${nombre}`, NCR:`Nota crédito a ${nombre}`, NC:`Ajuste contable ${nombre}` };
    campo.value = map[td] || '';
  },

  calcularVencimiento() {
    const dias   = parseInt(document.getElementById('ct-plazo')?.value) || 0;
    const fechaS = document.getElementById('ct-fecha')?.value;
    const info   = document.getElementById('ct-venc-info');
    if (!fechaS || !info) return;
    const fecha = new Date(fechaS);
    fecha.setDate(fecha.getDate() + dias + 1);
    info.textContent = 'Vence: ' + fecha.toLocaleDateString('es-CO');
  },

  setFechaHoy() {
    const input = document.getElementById('ct-fecha');
    if (input) input.valueAsDate = new Date();
  },

  setFechasReporte() {
    const hoy = new Date();
    const ini = document.getElementById('ct-rep-ini');
    const fin = document.getElementById('ct-rep-fin');
    if (ini) ini.valueAsDate = new Date(hoy.getFullYear(), 0, 1);
    if (fin) fin.valueAsDate = hoy;
    const selAnio = document.getElementById('ct-rep-anio');
    if (selAnio) {
      selAnio.innerHTML = '';
      for (let y = hoy.getFullYear(); y >= 2023; y--) {
        const o = document.createElement('option'); o.value = y; o.text = y; selAnio.appendChild(o);
      }
    }
  },

  // ──────────────────────────────────────────
  //  SMART PANEL — modo
  // ──────────────────────────────────────────
  toggleModo(m) {
    document.getElementById('ct-p-auto').style.display   = m === 'auto'   ? 'block' : 'none';
    document.getElementById('ct-p-manual').style.display = m === 'manual' ? 'block' : 'none';
    const rAuto   = document.querySelector('input[name="ct-mode"][value="auto"]');
    const rManual = document.querySelector('input[name="ct-mode"][value="manual"]');
    if (rAuto)   rAuto.checked   = m === 'auto';
    if (rManual) rManual.checked = m === 'manual';
  },

  toggleAIU() {
    const isAIU = document.getElementById('ct-chk-aiu')?.checked;
    const panel = document.getElementById('ct-panel-aiu');
    if (panel) panel.style.display = isAIU ? 'block' : 'none';
  },

  // ──────────────────────────────────────────
  //  AGREGAR MOVIMIENTOS
  // ──────────────────────────────────────────
  addAuto() {
    const valInput = document.getElementById('ct-sel-prod')?.value || '';
    const base     = parseFloat(document.getElementById('ct-val-base')?.value) || 0;
    const isAIU    = document.getElementById('ct-chk-aiu')?.checked;
    const chkIva   = document.getElementById('ct-chk-iva')?.checked;
    const chkRete  = document.getElementById('ct-chk-rete')?.checked;
    const destino  = document.querySelector('input[name="ct-dest"]:checked')?.value || 'inv';

    const prod     = (this.DB.productos || []).find(p => (p.codigo + ' — ' + p.nombre) === valInput);
    if (!prod) { UI.toast('Seleccione un producto del catálogo', 'warn'); return; }
    if (base <= 0) { UI.toast('Ingrese el valor base', 'warn'); return; }

    const ctaPrincipal = destino === 'inv' ? prod.ctaInventario : prod.ctaGasto;

    if (isAIU) {
      const pA = parseFloat(document.getElementById('ct-p-a')?.value) || 0;
      const pI = parseFloat(document.getElementById('ct-p-i')?.value) || 0;
      const pU = parseFloat(document.getElementById('ct-p-u')?.value) || 0;
      const ctaA = (document.getElementById('ct-cta-a')?.value || '').split(' - ')[0];
      const ctaI = (document.getElementById('ct-cta-i')?.value || '').split(' - ')[0];
      const ctaU = (document.getElementById('ct-cta-u')?.value || '').split(' - ')[0];
      if (!ctaA || !ctaI || !ctaU) { UI.toast('Complete las cuentas AIU', 'warn'); return; }
      const vA = Math.round(base * pA / 100);
      const vI = Math.round(base * pI / 100);
      const vU = Math.round(base * pU / 100);
      this.addRow(ctaPrincipal, prod.nombre + ' (Costo)', 0, base);
      this.addRow(ctaA, `AIU - Adm ${pA}%`, 0, vA);
      this.addRow(ctaI, `AIU - Imp ${pI}%`, 0, vI);
      this.addRow(ctaU, `AIU - Util ${pU}%`, 0, vU);
      if (chkIva && prod.porcIva > 0) { const vIva = Math.round(vU * prod.porcIva / 100); this.addRow(prod.ctaIva, `IVA ${prod.porcIva}% (Utilidad)`, 0, vIva); }
      if (chkRete && prod.porcRete > 0) { const vRete = Math.round((base+vA+vI+vU) * prod.porcRete / 100); this.addRow(prod.ctaRete, `Rete ${prod.porcRete}%`, vRete, 0); }
    } else {
      this.addRow(ctaPrincipal, prod.nombre, 0, base);
      if (chkIva  && prod.porcIva  > 0) { this.addRow(prod.ctaIva,  `IVA ${prod.porcIva}%`,   0, Math.round(base * prod.porcIva / 100)); }
      if (chkRete && prod.porcRete > 0) { this.addRow(prod.ctaRete, `Rete ${prod.porcRete}%`, Math.round(base * prod.porcRete / 100), 0); }
    }

    const selProd = document.getElementById('ct-sel-prod');
    const valBase = document.getElementById('ct-val-base');
    if (selProd) selProd.value = '';
    if (valBase) valBase.value = '';
    this.actualizarTabla();
  },

  addManual() {
    const cta  = (document.getElementById('ct-m-cta')?.value  || '').split(' - ')[0];
    const det  =  document.getElementById('ct-m-det')?.value  || '';
    const deb  = parseFloat(document.getElementById('ct-m-deb')?.value)  || 0;
    const cred = parseFloat(document.getElementById('ct-m-cred')?.value) || 0;
    if (cta && (deb > 0 || cred > 0)) {
      this.addRow(cta, det, deb, cred);
      ['ct-m-cta','ct-m-det'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      ['ct-m-deb','ct-m-cred'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 0; });
    }
  },

  addRow(c, d, db, cr) {
    this.MOVS.push({ cuenta: c, nombreCuenta: '', detalle: d, debito: db, credito: cr });
    this.actualizarTabla();
  },

  editarLinea(idx) {
    const m = this.MOVS[idx];
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('ct-m-cta',  m.cuenta);
    set('ct-m-det',  m.detalle);
    set('ct-m-deb',  m.debito);
    set('ct-m-cred', m.credito);
    this.toggleModo('manual');
    this.MOVS.splice(idx, 1);
    this.actualizarTabla();
  },

  borrarLinea(idx) { this.MOVS.splice(idx, 1); this.actualizarTabla(); },

  actualizarTabla() {
    const tbody = document.getElementById('ct-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let sDb = 0, sCr = 0;
    this.MOVS.forEach((m, i) => {
      sDb += m.debito; sCr += m.credito;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${m.cuenta}</td><td>${m.detalle}</td>
        <td class="text-right">${UI.moneda(m.debito)}</td>
        <td class="text-right">${UI.moneda(m.credito)}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button class="btn-icon btn-icon-edit" onclick="CONTABILIDAD.editarLinea(${i})"><i class="ti ti-edit"></i></button>
          <button class="btn-icon btn-icon-del"  onclick="CONTABILIDAD.borrarLinea(${i})"><i class="ti ti-x"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
    const tDeb  = document.getElementById('ct-t-deb');
    const tCred = document.getElementById('ct-t-cred');
    if (tDeb)  tDeb.textContent  = UI.moneda(sDb);
    if (tCred) tCred.textContent = UI.moneda(sCr);
    this.validar(sDb, sCr);
  },

  validar(sDb, sCr) {
    const dif = Math.abs(sDb - sCr);
    const btn = document.getElementById('ct-btn-save');
    const msg = document.getElementById('ct-msg');
    if (!msg || !btn) return;
    if (dif < 1 && sDb > 0) {
      msg.style.display = 'block'; msg.className = 'balance-msg balance-ok';
      msg.textContent = '✅ Cuadrado — listo para procesar';
      btn.disabled = false;
    } else {
      msg.style.display = 'block'; msg.className = 'balance-msg balance-err';
      msg.textContent = `⚠️ Descuadre: ${UI.moneda(dif)}`;
      btn.disabled = true;
    }
  },

  // ──────────────────────────────────────────
  //  CARTERA
  // ──────────────────────────────────────────
  mostrarCartera() {
    const input  = document.getElementById('ct-tercero')?.value || '';
    const nit    = input.split(' - ')[0];
    const div    = document.getElementById('ct-lista-cartera');
    if (!div) return;
    const pendientes = (this.DB.cartera || []).filter(c => c.nit === nit);
    if (!pendientes.length) { div.innerHTML = '<small style="color:var(--primary)">¡Paz y Salvo!</small>'; return; }
    div.innerHTML = pendientes.map(p => `
      <div class="cartera-item">
        <div><div style="font-weight:500">${p.id}</div><div style="font-size:11px;color:#888">${p.fecha}</div></div>
        <div style="text-align:right">
          <div style="font-weight:700;color:#D32F2F">${UI.moneda(p.saldo)}</div>
          <button class="btn-primary-sm" style="font-size:11px;padding:3px 8px;margin-top:3px" onclick="CONTABILIDAD.agregarPago('${p.id}',${p.saldo},'${p.cuentaCartera||'130505'}')">PAGAR</button>
        </div>
      </div>`).join('');
  },

  // cuentaCartera: cuenta real de cartera de ESA factura (viene del backend,
  // ver obtenerDatosIniciales en Datos.gs) — no siempre es 130505, algunas
  // facturas pueden quedar en otra cuenta según el tipo de crédito. Cae en
  // '130505' solo si el backend no pudo determinarla (documento sin
  // movimiento de cartera detectable).
  agregarPago(idDoc, saldo, cuentaCartera = '130505') {
    const abono = parseFloat(prompt(`Saldo: ${UI.moneda(saldo)}\nIngrese valor a abonar:`, saldo));
    if (!abono || abono <= 0) return;
    if (abono > saldo) { UI.toast('Abono mayor al saldo', 'warn'); return; }
    this.addRow(cuentaCartera, 'Abono a Factura ' + idDoc, 0, abono);
    const esBanco = confirm('¿Entró al BANCO?\nAceptar = Banco (111005)\nCancelar = Caja (110505)');
    this.addRow(esBanco ? '111005' : '110505', 'Ingreso Pago Factura ' + idDoc, abono, 0);
    this.abonosTemp.push({ idDoc, valor: abono });
  },

  actualizarListaRef() {
    const input = document.getElementById('ct-tercero')?.value || '';
    const nit   = input.split(' - ')[0];
    const dl    = document.getElementById('ct-dl-ref');
    if (!dl) return;
    dl.innerHTML = '';
    (this.DB.cartera || []).filter(c => c.nit === nit).forEach(f => {
      const o = document.createElement('option');
      o.value = f.id; o.label = `Saldo: ${UI.moneda(f.saldo)} (${f.fecha})`;
      dl.appendChild(o);
    });
  },

  async seleccionarRef() {
    const ref = document.getElementById('ct-ref-factura')?.value || '';
    const td  = this.getTipoDoc();
    if (!ref) return;
    if (td === 'NCR') {
      document.getElementById('ct-concepto').value = 'Devolución / Ajuste Factura ' + ref;
      try {
        const res = await API.call('obtenerDetalleNCR', { idFactura: ref });
        if (res.exito) { this.MOVS = res.movimientos; this.actualizarTabla(); UI.toast('Ítems cargados automáticamente', 'ok'); }
        else UI.toast(res.error, 'err');
      } catch(e) { UI.toast(e.message, 'err'); }
    } else if (td === 'RC') {
      document.getElementById('ct-concepto').value = 'Pago Factura ' + ref;
      const factura = (this.DB.cartera || []).find(f => f.id === ref);
      if (factura && confirm(`¿Generar asiento automático por ${UI.moneda(factura.saldo)}?`)) {
        this.agregarPago(ref, factura.saldo, factura.cuentaCartera || '130505');
      }
    }
  },

  // ──────────────────────────────────────────
  //  GUARDAR DOCUMENTO
  // ──────────────────────────────────────────
  async guardar() {
    if (!confirm('¿Procesar documento?')) return;
    const btn = document.getElementById('ct-btn-save');
    UI.spin(btn, true);
    const tercRaw = document.getElementById('ct-tercero')?.value || '';
    const pkg = {
      tipoDoc:     this.getTipoDoc(),
      fecha:       document.getElementById('ct-fecha')?.value,
      plazo:       document.getElementById('ct-plazo')?.value || 0,
      tercero:     { nit: tercRaw.split(' - ')[0], nombre: tercRaw.split(' - ')[1] || tercRaw },
      concepto:    document.getElementById('ct-concepto')?.value,
      total:       parseFloat(document.getElementById('ct-t-deb')?.textContent?.replace(/[^0-9]/g, '')) || 0,
      movimientos: this.MOVS,
      centroCosto: document.getElementById('ct-cc')?.value || '',
      abonos:      this.abonosTemp,
      refFactura:  document.getElementById('ct-ref-factura')?.value || ''
    };
    try {
      const r = await API.call('procesarDocumento', pkg);
      if (r.exito) {
        UI.toast('✅ Guardado: ' + r.consecutivo, 'ok');
        if (r.url) window.open(r.url, '_blank');
        this.resetForm();
      } else {
        UI.toast('Error: ' + r.error, 'err');
      }
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { UI.spin(btn, false); }
  },

  resetForm() {
    this.MOVS = []; this.abonosTemp = [];
    const ids = ['ct-tercero','ct-concepto','ct-cc','ct-ref-factura','ct-val-base','ct-sel-prod'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('ct-plazo').value = 0;
    this.actualizarTabla();
    this.setFechaHoy();
    // Reload ERP data
    API.call('obtenerDatosERP').then(data => { this.DB = data; this.renderUI(); }).catch(() => {});
  },

  // ──────────────────────────────────────────
  //  CONSULTAS
  // ──────────────────────────────────────────
  async buscarHistorial() {
    const input = document.getElementById('ct-cons-tercero')?.value || '';
    if (!input) { UI.toast('Ingrese nombre o NIT', 'warn'); return; }
    const nit    = input.split(' - ')[0];
    const nombre = input.split(' - ')[1] || input;
    const fIni   = document.getElementById('ct-cons-ini')?.value;
    const fFin   = document.getElementById('ct-cons-fin')?.value;
    const tDoc   = document.getElementById('ct-cons-tipo')?.value;

    const tbody = document.getElementById('ct-tbody-hist');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">⏳ Consultando...</td></tr>';
    const result = document.getElementById('ct-result-cons');
    if (result) result.style.display = 'block';

    try {
      const res = await API.call('consultarHistorial', { nit, fIni, fFin, tipoDoc: tDoc });
      if (!res.exito) { UI.toast('Error: ' + res.error, 'err'); return; }

      document.getElementById('ct-res-nombre').textContent = nombre;
      document.getElementById('ct-res-nit').textContent    = 'NIT: ' + nit;
      document.getElementById('ct-res-saldo').textContent  = UI.moneda(res.saldo);
      document.getElementById('ct-res-saldo').style.color  = res.saldo >= 0 ? '#D32F2F' : '#009E60';
      document.getElementById('ct-res-estado').textContent = res.saldo === 0 ? 'PAZ Y SALVO' : res.saldo > 0 ? 'DEUDOR' : 'A FAVOR';

      if (!tbody) return;
      if (!res.movimientos.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Sin movimientos en el período</td></tr>'; return; }
      tbody.innerHTML = '';
      res.movimientos.forEach(m => {
        const tr = document.createElement('tr');
        const esReversion = m.doc.startsWith('ANU-'); // reversión generada por anular — no se edita ni se vuelve a anular
        const botonVer = m.urlDoc ? `<button class="btn-icon" style="color:#8B5CF6" onclick="window.open('${m.urlDoc}','_blank')" title="Ver documento"><i class="ti ti-file-text"></i></button>` : '';
        const botonAnular = esReversion ? '' : `<button class="btn-icon" style="color:#D32F2F" onclick="CONTABILIDAD.anularDocumentoUI('${m.doc}')" title="Anular documento"><i class="ti ti-file-off"></i></button>`;
        tr.innerHTML = `
          <td>${m.fecha}</td><td><b>${m.doc}</b></td><td>${m.cuenta}</td><td>${m.detalle}</td>
          <td class="text-right">${m.debito  > 0 ? UI.moneda(m.debito)  : '-'}</td>
          <td class="text-right">${m.credito > 0 ? UI.moneda(m.credito) : '-'}</td>
          <td style="text-align:center;white-space:nowrap;">${botonVer}${botonAnular}</td>`;
        tbody.appendChild(tr);
      });
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // Anular un documento posteado — el backend genera la reversión (débito↔
  // crédito invertidos) y marca el original ANULADO, nunca borra ni edita
  // los movimientos originales. Es el único mecanismo de corrección "fuerte"
  // disponible (junto con NCR/ND) — editar in-place quedó deshabilitado a
  // propósito para no perder el rastro de auditoría.
  async anularDocumentoUI(idDoc) {
    if (!confirm(`¿Anular el documento ${idDoc}? Se registrará una reversión contable; el original queda marcado como anulado y no se puede deshacer.`)) return;
    try {
      const res = await API.call('anularDocumento', { id: idDoc });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      UI.toast(res.mensaje, 'ok');
      this.buscarHistorial();
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  BANCOS
  // ──────────────────────────────────────────
  async cargarBancos() {
    const tbody = document.getElementById('ct-tbody-bancos');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">⏳ Cargando...</td></tr>';
    try {
      const data = await API.call('obtenerBancos');
      if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay movimientos pendientes</td></tr>'; return; }
      tbody.innerHTML = '';
      data.forEach(d => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align:center;"><input type="checkbox" onchange="CONTABILIDAD.conciliar(this,'${d.uuid}')"></td>
          <td>${d.fecha}</td><td>${d.doc}</td><td>${d.detalle}</td>
          <td class="text-right">${UI.moneda(d.debito)}</td>
          <td class="text-right">${UI.moneda(d.credito)}</td>`;
        tbody.appendChild(tr);
      });
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  async conciliar(chk, uuid) {
    if (!chk.checked) return;
    if (!confirm('¿Marcar como conciliado?')) { chk.checked = false; return; }
    try {
      const ok = await API.call('marcarConciliado', { uuid });
      if (ok) chk.closest('tr').style.opacity = '0.4';
    } catch(e) { chk.checked = false; UI.toast(e.message, 'err'); }
  },

  // ──────────────────────────────────────────
  //  MODALS TERCERO Y PRODUCTO
  // ──────────────────────────────────────────
  abrirModalTercero() {
    ['ct-n-nit','ct-n-nom','ct-n-dir','ct-n-ciu','ct-n-tel'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('ct-modal-tercero').classList.add('open');
  },

  async crearTercero() {
    const obj = {
      nit:       document.getElementById('ct-n-nit')?.value,
      nombre:    document.getElementById('ct-n-nom')?.value,
      direccion: document.getElementById('ct-n-dir')?.value,
      ciudad:    document.getElementById('ct-n-ciu')?.value,
      telefono:  document.getElementById('ct-n-tel')?.value,
      regimen:   document.getElementById('ct-n-reteiva')?.value || 'Responsable de IVA'
    };
    if (!obj.nit || !obj.nombre) { UI.toast('NIT y nombre son requeridos', 'warn'); return; }
    try {
      const res = await API.call('crearTercero', obj);
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      this.DB.terceros.push(res.data);
      this.renderUI();
      document.getElementById('ct-modal-tercero').classList.remove('open');
      UI.toast('Tercero creado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  abrirModalProducto() {
    document.getElementById('ct-modal-prod').classList.add('open');
  },

  async crearProducto() {
    const obj = {
      codigo:       document.getElementById('ct-s-cod')?.value,
      nombre:       document.getElementById('ct-s-nom')?.value,
      tipo:         document.getElementById('ct-s-tipo')?.value,
      ctaInventario: document.getElementById('ct-s-cta-inv')?.value?.split(' - ')[0],
      ctaGasto:     document.getElementById('ct-s-cta-gas')?.value?.split(' - ')[0],
      iva:          document.getElementById('ct-s-iva')?.value,
      ctaIva:       document.getElementById('ct-s-cta-iva')?.value,
      rete:         document.getElementById('ct-s-rete')?.value,
      ctaRete:      document.getElementById('ct-s-cta-rete')?.value
    };
    if (!obj.nombre) { UI.toast('Falta nombre', 'warn'); return; }
    try {
      const res = await API.call('crearProducto', obj);
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      await API.call('obtenerDatosERP').then(d => { this.DB = d; this.renderUI(); });
      document.getElementById('ct-modal-prod').classList.remove('open');
      UI.toast('Producto creado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
  },

  cerrarModal(id) { document.getElementById(id)?.classList.remove('open'); },

  // ──────────────────────────────────────────
  //  REPORTES NIIF (sub-panel)
  // ──────────────────────────────────────────
  async generarReporte() {
    const tipo    = document.getElementById('ct-rep-tipo')?.value;
    const ini     = document.getElementById('ct-rep-ini')?.value;
    const fin     = document.getElementById('ct-rep-fin')?.value;
    const filtro  = document.getElementById('ct-rep-filtro')?.value;
    const thead   = document.querySelector('#ct-tbl-reporte thead');
    const tbody   = document.querySelector('#ct-tbl-reporte tbody');
    if (!thead || !tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Generando...</td></tr>';
    try {
      const data = await API.call('generarReporte', { tipo, fIni: ini, fFin: fin, filtro });
      thead.innerHTML = ''; tbody.innerHTML = '';
      let head = '';
      if (['BALANCE','PYG','GENERAL'].includes(tipo)) {
        head = '<tr><th>CUENTA</th><th>NOMBRE</th><th class="text-right">DÉBITO</th><th class="text-right">CRÉDITO</th><th class="text-right">SALDO</th></tr>';
        data.forEach(d => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${d.c1}</td><td>${d.c2}</td><td class="text-right">${UI.moneda(d.c3)}</td><td class="text-right">${UI.moneda(d.c4)}</td><td class="text-right"><b>${UI.moneda(d.c5)}</b></td>`; tbody.appendChild(tr); });
      } else if (tipo === 'CARTERA') {
        head = '<tr><th>TERCERO</th><th>DOC</th><th>VENCE</th><th>DÍAS</th><th>RANGO</th><th class="text-right">SALDO</th></tr>';
        data.forEach(d => { const tr = document.createElement('tr'); const col = d.c4 > 30 ? 'color:red' : ''; tr.innerHTML = `<td>${d.c1}</td><td>${d.c2}</td><td>${d.c3}</td><td style="${col}">${d.c4}</td><td>${d.c5}</td><td class="text-right">${UI.moneda(d.c6)}</td>`; tbody.appendChild(tr); });
      } else {
        head = '<tr><th>C1</th><th>C2</th><th>C3</th><th>C4</th><th>C5</th><th>C6</th></tr>';
        data.forEach(d => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${d.c1||''}</td><td>${d.c2||''}</td><td>${d.c3||''}</td><td>${d.c4||''}</td><td>${d.c5||''}</td><td>${d.c6||''}</td>`; tbody.appendChild(tr); });
      }
      thead.innerHTML = head;
    } catch(e) { UI.toast(e.message, 'err'); }
  }
};
