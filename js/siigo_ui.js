/**
 * SENERPOT — Pantalla «Importar Siigo» (pestaña de Contabilidad).
 * Flujo: subir PDF → leer (QR + texto/OCR) → vista previa con verificaciones y asiento (el servidor revalida) → confirmar → importar.
 * Nada se escribe hasta pulsar «Importar». Depende de: SIIGO_LECTOR, API, UI, CONTABILIDAD.
 */
const SIIGO_UI = {
  _montado: false, _lectura: null, _res: null, _cuentas: {}, _importando: false, _archivo: null, _prev: 0,

  esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); },
  $(id) { return document.getElementById(id); },
  m(n) { return (typeof UI !== 'undefined' && UI.moneda) ? UI.moneda(n) : '$' + Number(n).toLocaleString('es-CO'); },

  montar() {
    if (this._montado) return; const raiz = this.$('siigo-root'); if (!raiz) return;
    raiz.innerHTML = `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E3A5F;padding:10px 14px;border-radius:8px;font-size:12.5px;margin-bottom:14px;">
        📥 <b>Importar una factura de venta de Siigo.</b> Suba el PDF de la factura electrónica: el sistema lee el código QR de la DIAN, cruza los valores
        (base, IVA, retenciones y total) y arma el asiento como si se hubiera facturado aquí. <b>Usted revisa y confirma antes de que se guarde nada.</b>
        Esto no emite ni modifica nada ante la DIAN: la factura legal sigue siendo la de Siigo. Si se equivoca, el documento se corrige anulándolo (Consultas).
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <input type="file" id="siigo-archivo" accept="application/pdf,image/png,image/jpeg" style="max-width:340px;">
        <button class="btn-primary-sm" id="siigo-btn-leer" onclick="SIIGO_UI.leer()">🔍 Leer factura</button>
        <span id="siigo-estado" style="font-size:12.5px;color:#64748B;"></span>
      </div>
      <div id="siigo-resultado"></div>`;
    this._montado = true;
  },

  estado(t, error) { const e = this.$('siigo-estado'); if (e) { e.textContent = t || ''; e.style.color = error ? '#D32F2F' : '#64748B'; } },

  async leer() {
    const inp = this.$('siigo-archivo'), f = inp && inp.files && inp.files[0];
    if (!f) { UI.toast('Elija primero el PDF de la factura', 'warn'); return; }
    if (f.size > 6 * 1024 * 1024) { UI.toast('El archivo supera 6 MB', 'warn'); return; }
    const btn = this.$('siigo-btn-leer'); UI.spin(btn, true);
    this.$('siigo-resultado').innerHTML = ''; this._res = null; this._lectura = null; this._cuentas = {};
    try {
      this._archivo = f;
      const lec = await SIIGO_LECTOR.leerArchivo(f, m => this.estado(m));
      const an = SIIGO_LECTOR.parsear(lec.texto, lec.qr);
      this._lectura = { lec, an };
      if (an.factura && lec.via === 'ocr') an.avisos.push('El texto se leyó por OCR (el PDF es una imagen): confirme el nombre del cliente. Los valores sí están verificados contra el QR.');
      this.estado('');
      if (!an.ok) { this.pintar(); return; }
      await this.previsualizar();
    } catch (e) { this.estado('No se pudo leer: ' + e.message, true); UI.toast(e.message, 'err'); }
    finally { UI.spin(btn, false); }
  },

  /** Pide al servidor la vista previa (revalida, duplicado, tercero, cuentas, asiento). No escribe. */
  async previsualizar() {
    const { lec, an } = this._lectura, n = ++this._prev;
    const nombreIn = this.$('siigo-nombre'); if (nombreIn && nombreIn.value.trim()) an.factura.nombreCliente = nombreIn.value.trim();
    this.estado('Verificando con el servidor…');
    const r = await API.call('siigoPrevisualizar', { factura: an.factura, cuentas: this._cuentas, hashArchivo: lec.hash });
    if (n !== this._prev) return;
    this.estado('');
    if (!r || r.exito === false) { this.estado((r && r.error) || 'El servidor no respondió', true); return; }
    this._res = r.data; this._cuentas = Object.assign({}, r.data.cuentas); this.pintar();
  },

  cuentaCambio(clave, valor) { this._cuentas[clave] = String(valor || '').split(' - ')[0].trim(); this.previsualizar().catch(e => UI.toast(e.message, 'err')); },
  nombreCambio() { this.previsualizar().catch(e => UI.toast(e.message, 'err')); },

  pintar() {
    const { lec, an } = this._lectura, f = an.factura, d = this._res, E = v => this.esc(v), M = n => this.m(n);
    const filaCheck = c => `<div style="font-size:12.5px;margin:2px 0;">${c.ok ? '✅' : '❌'} ${E(c.texto)}</div>`;
    let h = '';
    // Verificaciones
    h += `<div class="card" style="padding:14px;margin-bottom:12px;"><div style="font-weight:700;margin-bottom:6px;">Verificaciones (texto de la factura contra el QR de la DIAN)</div>${an.checks.map(filaCheck).join('') || '<i>—</i>'}`;
    an.errores.filter(e => !an.checks.some(c => c.texto === e)).forEach(e => { h += `<div style="font-size:12.5px;margin:2px 0;color:#B91C1C;">❌ ${E(e)}</div>`; });
    h += '</div>';
    if (!f) { this.$('siigo-resultado').innerHTML = h; return; }
    // Datos leídos
    const ter = d && d.tercero;
    h += `<div class="card" style="padding:14px;margin-bottom:12px;"><div style="font-weight:700;margin-bottom:8px;">Datos de la factura ${E(f.numero)}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px 16px;font-size:13px;">
        <div><span style="color:#64748B;">Fecha</span><br><b>${E(f.fecha)}</b></div>
        <div><span style="color:#64748B;">Vence</span><br><b>${E(f.fechaVence || f.fecha)}${f.plazoDias ? ' (' + f.plazoDias + ' días)' : ''}</b></div>
        <div><span style="color:#64748B;">Forma de pago</span><br><b>${f.formaPago === 'CONTADO' ? 'Contado' : f.formaPago === 'CREDITO' ? 'Crédito' : '—'}</b></div>
        <div><span style="color:#64748B;">NIT cliente</span><br><b>${E(f.nitCliente)}${f.dvCliente ? '-' + E(f.dvCliente) : ''}</b></div>
        <div style="grid-column:span 2;"><span style="color:#64748B;">Cliente ${ter ? (ter.existe ? '(ya está en Terceros)' : '(se creará en Terceros)') : ''}</span><br>
          ${ter && ter.existe ? `<b>${E(ter.nombre)}</b>` : `<input id="siigo-nombre" type="text" value="${E((ter && ter.nombre) || f.nombreCliente)}" style="width:100%;" onchange="SIIGO_UI.nombreCambio()">`}</div>
        <div><span style="color:#64748B;">Base</span><br><b>${M(f.base)}</b></div>
        <div><span style="color:#64748B;">IVA ${f.pctIva ? f.pctIva + ' %' : ''}</span><br><b>${M(f.iva)}</b></div>
        <div><span style="color:#64748B;">Retenciones</span><br><b>${f.retenciones.length ? f.retenciones.map(r => E(({ RETEFUENTE: 'Retefuente', RETEICA: 'ReteICA', RETEIVA: 'ReteIVA' })[r.tipo] || r.tipo) + (r.pct ? ' ' + r.pct + '%' : '') + ' ' + M(r.valor)).join(' · ') : 'ninguna'}</b></div>
        <div><span style="color:#64748B;">Total a pagar (cartera)</span><br><b style="color:#0F766E;">${M(f.totalPagar)}</b></div>
        ${f.ofertaRef ? `<div><span style="color:#64748B;">Oferta citada</span><br><b>${E(f.ofertaRef)}</b></div>` : ''}
      </div>
      <div style="margin-top:10px;font-size:12.5px;"><b>Líneas</b> (la base de cada línea es la repartida sobre el Total Bruto):
        <table class="data-tbl" style="margin-top:4px;"><thead><tr><th>#</th><th>Descripción</th><th class="text-right">Cant.</th><th class="text-right">Base</th></tr></thead><tbody>
        ${f.lineas.map(l => `<tr><td>${l.n}</td><td>${E(l.descripcion)}</td><td class="text-right">${E(l.cantidad)}</td><td class="text-right">${M(l.base)}</td></tr>`).join('')}</tbody></table></div>
      ${f.observaciones ? `<div style="margin-top:8px;font-size:12px;color:#475569;"><b>Observaciones:</b> ${E(f.observaciones)}</div>` : ''}
      <div style="margin-top:8px;font-size:12px;"><a href="https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${E(f.cufe)}" target="_blank" rel="noopener">🔗 Verificar esta factura en la DIAN</a> · CUFE ${E(f.cufe.slice(0, 16))}…</div></div>`;
    // Avisos
    const avisos = [].concat(an.avisos || [], (d && d.avisos) || []);
    if (avisos.length) h += `<div style="background:#FFFBEB;border:1px solid #FDE68A;color:#78350F;padding:10px 14px;border-radius:8px;font-size:12.5px;margin-bottom:12px;">${avisos.map(a => '⚠️ ' + E(a)).join('<br>')}</div>`;
    // Errores del servidor
    const errs = d ? [].concat(d.errores || [], d.errCuentas || []) : [];
    if (errs.length) h += `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#7F1D1D;padding:10px 14px;border-radius:8px;font-size:12.5px;margin-bottom:12px;">${errs.map(a => '❌ ' + E(a)).join('<br>')}</div>`;
    // Cuentas
    if (d) {
      const campos = [['clientes', 'Clientes (cartera)'], ['ingresos', 'Ingresos'], ['iva', 'IVA generado']].filter(c => c[0] !== 'iva' || f.iva > 0)
        .concat(f.retenciones.map(r => [r.tipo, 'Retención a favor: ' + r.tipo.replace('RETE', 'Rete ').toLowerCase()]));
      h += `<div class="card" style="padding:14px;margin-bottom:12px;"><div style="font-weight:700;margin-bottom:6px;">Cuentas contables</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px 16px;">
        ${campos.map(([k, rot]) => { const sug = d.sugeridas && d.sugeridas[k]; const val = this._cuentas[k] || ''; const nom = d.nombresPUC && d.nombresPUC[val];
          return `<div class="field-group"><label>${E(rot)}</label><input list="ct-dl-puc" value="${E(val ? val + (nom ? ' - ' + nom : '') : '')}" onchange="SIIGO_UI.cuentaCambio('${k}',this.value)" placeholder="Elija del PUC…">
            <small style="color:#64748B;">${val && sug && sug.origen && sug.cuenta === val ? 'Tomada de ' + E(sug.origen) : val ? '' : 'Elija una cuenta'}</small></div>`; }).join('')}
        </div><div style="font-size:11.5px;color:#64748B;margin-top:6px;">Las cuentas que confirme se recuerdan para la próxima factura.</div></div>`;
      // Asiento
      if (d.movimientos && d.movimientos.length) {
        h += `<div class="card" style="padding:14px;margin-bottom:12px;"><div style="font-weight:700;margin-bottom:6px;">Asiento que se registrará como <span style="color:#0F766E;">${E(d.idDoc)}</span> (Factura de Venta)</div>
          <div class="table-scroll"><table class="data-tbl"><thead><tr><th>Cuenta</th><th>Detalle</th><th class="text-right">Débito</th><th class="text-right">Crédito</th></tr></thead><tbody>
          ${d.movimientos.map(x => `<tr><td>${E(x.cuenta)} <span style="color:#888;font-size:11px;">— ${E(x.nombreCuenta)}</span></td><td>${E(x.detalle)}</td><td class="text-right">${x.debito ? M(x.debito) : '-'}</td><td class="text-right">${x.credito ? M(x.credito) : '-'}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="2" class="text-right"><b>Totales</b></td><td class="text-right"><b>${M(d.totalDebito)}</b></td><td class="text-right"><b>${M(d.totalDebito)}</b></td></tr></tfoot></table></div>
          <div style="font-size:12px;color:#64748B;margin-top:6px;">Quedará pendiente en cartera: <b>${M(d.saldoCartera)}</b>. Se guarda el PDF original como soporte y no se consume el consecutivo de facturas de la app.</div></div>`;
      }
    }
    const pideNombre = !!(d && d.tercero && !d.tercero.existe && lec.via === 'ocr');
    if (pideNombre) h += `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:10px;"><input type="checkbox" id="siigo-chk-nombre" onchange="SIIGO_UI.habilitar()"> Confirmo que el nombre del cliente está bien escrito (se creará en Terceros; el OCR puede confundir símbolos como «&»).</label>`;
    h += `<div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn-generate" id="siigo-btn-importar" ${d && d.puedeImportar && !pideNombre ? '' : 'disabled'} onclick="SIIGO_UI.importar()">✅ Importar a contabilidad</button>
      <button class="btn-primary-sm" style="background:#64748B;" onclick="SIIGO_UI.cancelar()">Cancelar</button></div>`;
    this.$('siigo-resultado').innerHTML = h;
  },

  habilitar() { const b = this.$('siigo-btn-importar'), c = this.$('siigo-chk-nombre'); if (b) b.disabled = !(this._res && this._res.puedeImportar && (!c || c.checked)); },

  cancelar() { this._lectura = null; this._res = null; this._cuentas = {}; const i = this.$('siigo-archivo'); if (i) i.value = ''; this.$('siigo-resultado').innerHTML = ''; this.estado(''); },

  async aBase64(archivo) {
    const buf = new Uint8Array(await archivo.arrayBuffer()); let s = ''; const T = 0x8000;
    for (let i = 0; i < buf.length; i += T) s += String.fromCharCode.apply(null, buf.subarray(i, i + T));
    return btoa(s);
  },

  async importar() {
    if (this._importando || !this._res || !this._res.puedeImportar) return;
    { const c = this.$('siigo-chk-nombre'); if (c && !c.checked) { UI.toast('Confirme que el nombre del cliente está bien escrito', 'warn'); return; } }
    const { lec, an } = this._lectura, f = an.factura, d = this._res;
    if (!confirm('¿Importar la factura ' + f.numero + ' por ' + this.m(f.totalPagar) + ' (cartera) al cliente ' + ((d.tercero && d.tercero.nombre) || f.nombreCliente) + '?\n\nQuedará registrada como ' + d.idDoc + '. Para corregirla después hay que anularla.')) return;
    this._importando = true; const btn = this.$('siigo-btn-importar'); UI.spin(btn, true);
    try {
      const nombre = (d.tercero && d.tercero.nombre) || f.nombreCliente; f.nombreCliente = nombre;
      const r = await API.call('importarFacturaSiigo', { factura: f, cuentas: this._cuentas, hashArchivo: lec.hash, archivoBase64: await this.aBase64(this._archivo), archivoMime: this._archivo.type, archivoNombre: this._archivo.name, via: lec.via });
      if (r && r.exito) {
        API.clearCache('obtenerDatosERP', {});
        UI.toast('✅ ' + r.mensaje + (r.tercerosCreado ? ' (cliente creado en Terceros)' : ''), 'ok');
        this.$('siigo-resultado').innerHTML = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;color:#064E3B;padding:14px;border-radius:8px;font-size:13.5px;">✅ <b>${this.esc(r.consecutivo)}</b> importada. Quedó en cartera por <b>${this.m(r.saldoCartera)}</b>.
          ${r.url ? `<br><a href="${this.esc(r.url)}" target="_blank" rel="noopener">📄 Ver el PDF original guardado</a>` : ''}<br>Puede verla en <b>Consultas</b> buscando <b>${this.esc(r.consecutivo)}</b>, y registrar su cobro con un Recibo de Caja.</div>`;
        const i = this.$('siigo-archivo'); if (i) i.value = ''; this._lectura = null; this._res = null; this._cuentas = {};
        API.call('obtenerDatosERP').then(x => { CONTABILIDAD.DB = x; CONTABILIDAD.renderUI(); }).catch(() => {});
      } else { UI.toast('No se importó: ' + ((r && r.error) || 'error desconocido'), 'err'); this.estado((r && r.error) || '', true); }
    } catch (e) { UI.toast(e.message, 'err'); }
    finally { this._importando = false; UI.spin(btn, false); }
  }
};
