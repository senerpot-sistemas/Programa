/**
 * NODIA — ofertas_nodia.js v0.1
 * Formato de oferta "PDF NODIA" dentro del módulo Ofertas. Es OPCIONAL: mientras el selector "Formato" esté en
 * "Documento (actual)", nada de esto afecta a la oferta, sus totales ni lo que se envía al servidor.
 *
 *  NODIA_CALC      cálculo puro (sin pantalla) de presupuesto con IVA por partida y de pagos. Es el MISMO cálculo que hace
 *                  el generador de PDF en el servidor (NodiaDocs.calcPresupuesto / distribuirPagos), para que la pantalla
 *                  y el documento nunca muestren cifras distintas. Se prueba contra él con miles de casos.
 *  OFERTAS_NODIA   interfaz: panel del formato, IVA por ítem con su soporte, pagos y envío de datos.nodia.
 */
const NODIA_CALC = {
  // ítems: [{ cantidad, unitario, iva }]  iva = '19' | '5' | 'EXCLUIDO' | 'EXENTO'.  aiu: { activo, pctAdmin, pctImprevistos, pctUtilidad }
  presupuesto(items, aiu) {
    const base = {}; let subtotal = 0, noGravado = 0, hayDistinto = false;
    items.forEach(it => {
      const tot = Math.round((parseFloat(it.cantidad) || 0) * (parseFloat(it.unitario) || 0)); subtotal += tot;
      const v = String(it.iva || '19');
      if (v === 'EXCLUIDO' || v === 'EXENTO') { noGravado += tot; hayDistinto = true; }
      else { const t = Number(v) || 19; base[t] = (base[t] || 0) + tot; if (t !== 19) hayDistinto = true; }
    });
    const r = { subtotal, noGravado, mixto: hayDistinto, ivaPorTarifa: [], aiu: null };
    if (aiu && aiu.activo) {
      const pA = parseFloat(aiu.pctAdmin) || 0, pI = parseFloat(aiu.pctImprevistos) || 0, pU = parseFloat(aiu.pctUtilidad) || 0;
      const vA = Math.round(subtotal * pA / 100), vI = Math.round(subtotal * pI / 100), vU = Math.round(subtotal * pU / 100);
      r.aiu = { pA, pI, pU, vA, vI, vU, subtotalAIU: subtotal + vA + vI + vU };
      r.iva = Math.round(vU * 19 / 100); r.ivaPorTarifa.push({ tarifa: 19, base: vU, iva: r.iva }); r.total = r.aiu.subtotalAIU + r.iva;
    } else {
      let iva = 0; Object.keys(base).map(Number).sort((a, b) => b - a).forEach(t => { const v = Math.round(base[t] * t / 100); iva += v; r.ivaPorTarifa.push({ tarifa: t, base: base[t], iva: v }); });
      r.iva = iva; r.total = subtotal + iva;
    }
    return r;
  },
  // Todas las cuotas salvo la última se redondean al peso; la última recibe la diferencia: SIEMPRE suman el total.
  distribuirPagos(total, porcentajes) {
    const t = Math.round(total), out = []; let acum = 0;
    porcentajes.forEach((p, i) => { const v = (i === porcentajes.length - 1) ? t - acum : Math.round(t * p / 100); out.push(v); acum += v; });
    return out;
  },
  validarPagos(total, porcentajes) {
    const e = []; let s = 0;
    porcentajes.forEach((p, i) => { const v = Number(p); if (!(v > 0)) e.push('El pago ' + (i + 1) + ' debe tener un porcentaje mayor que 0'); s += v || 0; });
    s = Math.round(s * 100) / 100;
    if (Math.abs(s - 100) > 0.001) e.push('Las condiciones de pago suman ' + s + ' % y deben sumar 100 %');
    if (!e.length) this.distribuirPagos(total, porcentajes).forEach((v, i) => { if (v < 1) e.push('El pago ' + (i + 1) + ' resulta de menos de 1 peso con este total'); });
    return e;
  }
};

const OFERTAS_NODIA = {
  _ultimoTotal: 0,
  el(id) { return document.getElementById(id); },
  activo() { const s = this.el('of-formato'); return !!s && s.value === 'NODIA'; },

  // Cambia entre "Documento (actual)" y "PDF NODIA": muestra u oculta lo propio del formato y recalcula los totales.
  cambiarFormato() {
    const on = this.activo();
    document.body.classList.toggle('fmt-nodia', on);
    const panel = this.el('of-nodia-panel'); if (panel) panel.style.display = on ? 'block' : 'none';
    const btn = this.el('of-btn-generar'); if (btn) btn.textContent = on ? 'Generar oferta (PDF NODIA)' : 'Generar oferta (Doc)';
    const pago = this.el('of-cond-pago'); if (pago) { pago.readOnly = on; pago.style.background = on ? '#f5f5f5' : ''; }
    const vig = this.el('of-cond-vigencia'); if (vig) { vig.readOnly = on; vig.style.background = on ? '#f5f5f5' : ''; }   // en NODIA la vigencia sale del campo "Vigencia (días)"
    if (on) this.sincronizarVigencia();
    if (on && !this.el('of-nd-tbody-pagos').children.length) this.agregarPago(50, 'A la aceptación de la oferta.'), this.agregarPago(50, 'Contra entrega del informe final.');
    OFERTAS.calcularTotales(); this.refrescarSoporte(); this.pintarPagos();
  },

  sincronizarVigencia() { const d = parseInt(this.el('of-nd-vigencia')?.value, 10), v = this.el('of-cond-vigencia'); if (v && d >= 1) v.value = d + ' días calendario.'; },

  // ───── Totales (reemplaza el cálculo de la pantalla solo en formato NODIA) ─────
  filasItems() { return [...document.querySelectorAll('#of-tbody-items tr')]; },
  itemsParaCalculo() { return this.filasItems().map(tr => ({ cantidad: tr.querySelector('.inp-cant').value, unitario: tr.querySelector('.inp-val').value, iva: tr.querySelector('.inp-iva')?.value || '19' })); },
  aiuActual() { return { activo: this.el('of-aiu-check')?.checked, pctAdmin: this.el('of-aiu-a')?.value, pctImprevistos: this.el('of-aiu-i')?.value, pctUtilidad: this.el('of-aiu-u')?.value }; },
  totales() {
    const r = NODIA_CALC.presupuesto(this.itemsParaCalculo(), this.aiuActual()), set = (id, v) => { const e = this.el(id); if (e) e.textContent = v; };
    set('of-subtotal', UI.moneda(r.subtotal));
    if (r.aiu) {
      set('of-aiu-row-a', `Administración (${r.aiu.pA}%):`); set('of-aiu-row-i', `Imprevistos (${r.aiu.pI}%):`); set('of-aiu-row-u', `Utilidad (${r.aiu.pU}%):`);
      set('of-aiu-val-a', UI.moneda(r.aiu.vA)); set('of-aiu-val-i', UI.moneda(r.aiu.vI)); set('of-aiu-val-u', UI.moneda(r.aiu.vU)); set('of-aiu-val-sub', UI.moneda(r.aiu.subtotalAIU));
    }
    const ng = r.noGravado > 0 && !r.aiu; ['of-nd-row-ng', 'of-nd-val-ng'].forEach(id => { const e = this.el(id); if (e) e.style.display = ng ? '' : 'none'; });
    if (ng) set('of-nd-val-ng', UI.moneda(r.noGravado));
    const lab = this.el('of-iva-label');
    if (lab) lab.textContent = r.aiu ? 'IVA 19% (sobre Utilidad):' : (r.mixto ? 'IVA (' + (r.ivaPorTarifa.map(g => g.tarifa + '% sobre ' + UI.moneda(g.base)).join('; ') || 'sin base gravada') + '):' : 'IVA 19%:');
    set('of-iva', UI.moneda(r.iva)); set('of-total', UI.moneda(r.total));
    this._ultimoTotal = r.total; this.pintarPagos();
    return r;
  },

  // ───── IVA por ítem y su soporte ─────
  celdaIva(valor = '19') {
    const opts = [['19', '19 %'], ['5', '5 %'], ['EXCLUIDO', 'Excluido'], ['EXENTO', 'Exento']].map(([v, t]) => `<option value="${v}"${v === String(valor) ? ' selected' : ''}>${t}</option>`).join('');
    return `<td class="nd-only"><select class="inp-iva" onchange="OFERTAS_NODIA.cambioIva(this)" style="width:100%;padding:5px;font-size:12px;">${opts}</select></td>`;
  },
  cambioIva(sel) { const tr = sel.closest('tr'); if (sel.value !== 'EXCLUIDO' && sel.value !== 'EXENTO') { delete tr.dataset.fundamento; delete tr.dataset.soporte; delete tr.dataset.hasta; } OFERTAS.calcularTotales(); this.refrescarSoporte(); },
  esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); },
  // Panel con el fundamento y el soporte de cada ítem excluido o exento (obligatorios: sin ellos el servidor rechaza la oferta)
  refrescarSoporte() {
    const cont = this.el('of-nd-soporte'); if (!cont) return;
    const filas = this.filasItems().map((tr, i) => ({ tr, n: i + 1, v: tr.querySelector('.inp-iva')?.value })).filter(x => x.v === 'EXCLUIDO' || x.v === 'EXENTO');
    if (!this.activo() || !filas.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
    cont.style.display = 'block';
    cont.innerHTML = `<div style="font-weight:700;font-size:12px;color:var(--primary-dark);margin-bottom:6px;">Soporte tributario de las partidas excluidas o exentas de IVA</div>
      <div style="font-size:12px;color:#5B6675;margin-bottom:8px;">El IVA no se deja de cobrar por la descripción del ítem: cada partida debe indicar la norma que la sustenta y el documento que la respalda (p. ej. certificación de la UPME con su número y vigencia). Sin esto la oferta no se genera.</div>` +
      filas.map(({ tr, n, v }) => `<div class="conditions-grid" style="margin-bottom:8px;border-left:3px solid var(--accent);padding-left:8px;" data-n="${n}">
        <div class="field-group"><label>Ítem ${n} (${v === 'EXCLUIDO' ? 'excluido' : 'exento'}) — Fundamento legal</label><input type="text" data-k="fundamento" value="${this.esc(tr.dataset.fundamento)}" placeholder="Ej.: Art. 12 de la Ley 1715 de 2014, modificado por el art. 8 de la Ley 2099 de 2021"></div>
        <div class="field-group"><label>Documento de soporte</label><input type="text" data-k="soporte" value="${this.esc(tr.dataset.soporte)}" placeholder="Ej.: Certificación UPME No. ___ del ___"></div>
        <div class="field-group"><label>Soporte vigente hasta</label><input type="date" data-k="hasta" value="${this.esc(tr.dataset.hasta)}"></div></div>`).join('');
    cont.querySelectorAll('[data-n]').forEach(blk => { const n = Number(blk.dataset.n); blk.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { this.filasItems()[n - 1].dataset[inp.dataset.k] = inp.value; })); });
  },

  // ───── Pagos estructurados ─────
  agregarPago(pct = '', concepto = '') {
    const tb = this.el('of-nd-tbody-pagos'), tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="number" class="nd-pago-pct" step="0.01" min="0" value="${this.esc(pct)}" oninput="OFERTAS_NODIA.pintarPagos()" style="width:80px"></td>
      <td><input type="text" class="nd-pago-con" value="${this.esc(concepto)}" placeholder="Concepto del pago"></td>
      <td class="nd-pago-val" style="text-align:right;white-space:nowrap;"></td><td style="text-align:center"><button class="btn-icon btn-icon-del" onclick="this.closest('tr').remove();OFERTAS_NODIA.pintarPagos()">✕</button></td>`;
    tb.appendChild(tr); this.pintarPagos();
  },
  pagos() { return [...document.querySelectorAll('#of-nd-tbody-pagos tr')].map(tr => ({ pct: parseFloat(tr.querySelector('.nd-pago-pct').value), concepto: tr.querySelector('.nd-pago-con').value.trim() })); },
  pintarPagos() {
    const res = this.el('of-nd-pagos-resumen'); if (!res) return;
    const p = this.pagos(), pct = p.map(x => x.pct || 0), err = NODIA_CALC.validarPagos(this._ultimoTotal, pct);
    const cuotas = err.length ? [] : NODIA_CALC.distribuirPagos(this._ultimoTotal, pct);
    document.querySelectorAll('#of-nd-tbody-pagos tr').forEach((tr, i) => { tr.querySelector('.nd-pago-val').textContent = cuotas.length ? UI.moneda(cuotas[i]) : '—'; });
    res.innerHTML = err.length ? `<span style="color:#B91C1C">${this.esc(err[0])}</span>` : `<span style="color:var(--ok)">Suman 100 % = ${UI.moneda(this._ultimoTotal)} (la última cuota recibe la diferencia del redondeo)</span>`;
    const legacy = this.el('of-cond-pago'); if (legacy && this.activo()) legacy.value = p.filter(x => x.pct > 0).map(x => `${x.pct}% ${x.concepto}`.trim()).join('; ');
  },

  // ───── Datos hacia el servidor ─────
  lineas(id) { return (this.el(id)?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); },
  recolectar(datos) {
    const filas = this.filasItems();
    if (!this.activo()) return datos;
    datos.items.forEach((it, i) => {
      const tr = filas[i], v = tr.querySelector('.inp-iva')?.value || '19';
      if (v === 'EXCLUIDO' || v === 'EXENTO') { it.tratamiento = v; it.fundamento = (tr.dataset.fundamento || '').trim(); it.soporte = (tr.dataset.soporte || '').trim(); it.soporteVigenteHasta = tr.dataset.hasta || ''; }
      else { it.tratamiento = 'GRAVADO'; it.tarifaIva = Number(v); }
    });
    const val = id => (this.el(id)?.value || '').trim();
    const eq = { tipo: val('of-nd-eq-tipo'), marca: val('of-nd-eq-marca'), modelo: val('of-nd-eq-modelo'), serie: val('of-nd-eq-serie'), potenciaKVA: val('of-nd-eq-kva'), tensionPrimariaV: val('of-nd-eq-vp'),
      tensionSecundariaV: val('of-nd-eq-vs'), refrigeracion: val('of-nd-eq-refrig'), fases: val('of-nd-eq-fases'), anioFabricacion: val('of-nd-eq-anio'), ubicacionEquipo: val('of-nd-eq-ubic') };
    datos.nodia = { formato: 'NODIA', servicio: val('of-nd-servicio') || 'MANTENIMIENTO', tituloServicio: val('of-nd-titulo'), ubicacion: val('of-nd-ubicacion'), vigenciaDias: parseInt(val('of-nd-vigencia'), 10) || 0,
      resumen: val('of-nd-resumen'), portadaFoto: val('of-nd-foto') || 'NINGUNA', firmar: !!this.el('of-nd-firmar')?.checked, equipo: eq,
      pruebas: this.lineas('of-nd-pruebas'), materiales: this.lineas('of-nd-materiales'), repuestos: this.lineas('of-nd-repuestos'), entregables: this.lineas('of-nd-entregables'),
      exclusiones: this.lineas('of-nd-exclusiones'), garantias: this.lineas('of-nd-garantias'), pagos: this.pagos().filter(p => p.pct > 0 || p.concepto) };
    return datos;
  },
  // Antes de enviar: lo que se puede ver en pantalla (el servidor vuelve a validar todo)
  validar() {
    if (!this.activo()) return [];
    const e = [], d = parseInt(this.el('of-nd-vigencia').value, 10);
    if (!(d >= 1 && d <= 365)) e.push('Indica la vigencia de la oferta en días (1 a 365).');
    const r = this.totales(), p = this.pagos();
    if (p.length) NODIA_CALC.validarPagos(r.total, p.map(x => x.pct || 0)).forEach(x => e.push(x));
    this.filasItems().forEach((tr, i) => { const v = tr.querySelector('.inp-iva')?.value; if (v === 'EXCLUIDO' || v === 'EXENTO') { if (!(tr.dataset.fundamento || '').trim() || !(tr.dataset.soporte || '').trim()) e.push(`El ítem ${i + 1} (${v === 'EXCLUIDO' ? 'excluido' : 'exento'} de IVA) necesita fundamento legal y documento de soporte.`); } });
    if (r.aiu && r.mixto) e.push('El AIU no se combina con IVA distinto por partida: use una sola modalidad.');
    return e;
  },
  restaurar(data) {
    const n = data.nodia, sel = this.el('of-formato'); if (!sel) return;
    sel.value = n && n.formato === 'NODIA' ? 'NODIA' : 'DOC';
    const set = (id, v) => { const e = this.el(id); if (e) e.value = (v ?? '') === '' ? '' : v; };
    document.getElementById('of-nd-tbody-pagos').innerHTML = '';
    if (n) {
      set('of-nd-servicio', n.servicio || 'MANTENIMIENTO'); set('of-nd-titulo', n.tituloServicio); set('of-nd-ubicacion', n.ubicacion); set('of-nd-vigencia', n.vigenciaDias || 15); set('of-nd-resumen', n.resumen);
      set('of-nd-foto', n.portadaFoto || 'NINGUNA'); const f = this.el('of-nd-firmar'); if (f) f.checked = !!n.firmar;
      const e = n.equipo || {}; set('of-nd-eq-tipo', e.tipo); set('of-nd-eq-marca', e.marca); set('of-nd-eq-modelo', e.modelo); set('of-nd-eq-serie', e.serie); set('of-nd-eq-kva', e.potenciaKVA);
      set('of-nd-eq-vp', e.tensionPrimariaV); set('of-nd-eq-vs', e.tensionSecundariaV); set('of-nd-eq-refrig', e.refrigeracion); set('of-nd-eq-fases', e.fases); set('of-nd-eq-anio', e.anioFabricacion); set('of-nd-eq-ubic', e.ubicacionEquipo);
      ['pruebas', 'materiales', 'repuestos', 'entregables', 'exclusiones', 'garantias'].forEach(k => set('of-nd-' + k, (n[k] || []).join('\n')));
      (n.pagos || []).forEach(p => this.agregarPago(p.pct, p.concepto));
    }
    this.cambiarFormato();
  }
};
