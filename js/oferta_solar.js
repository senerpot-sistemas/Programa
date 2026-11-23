/**
 * NODIA — Oferta fotovoltaica: datos desde el informe PVsyst + consumo/tarifa de la factura (se carga después de oferta_wizard.js).
 * Reglas (auditoría 2026-11-22):
 *  · Un valor EXTRAÍDO del informe nunca se sustituye en silencio: lo que se calcula aparte se rotula «cálculo propio» y se elige de forma expresa.
 *  · Una simulación con CARGA ILIMITADA no produce autoconsumo ni excedentes del cliente (E_Grid = toda la producción).
 *  · El balance mensual es solo una estimación exploratoria: no alimenta indicadores económicos sin una validación expresa.
 *  · Cada mes de consumo lleva su origen (DOCUMENTADO / ESTIMADO_PROMEDIO); los estimados se recalculan o se reemplazan al llegar la factura real.
 *  · Autoconsumo, créditos de energía y excedentes adicionales son beneficios distintos: cada uno con su precio, mecanismo y variación anual.
 *  · Los valores estándar se guardan con VERSIÓN y la oferta conserva la versión usada.
 * El resultado se escribe en el mismo JSON de siempre (#wz-solar-json): el asistente y el servidor no cambian.
 */
(function () {
  if (typeof WIZ === 'undefined' || typeof OFERTAS === 'undefined' || typeof PVSYST === 'undefined') return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const M = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const fmt = (n, d) => (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('es-CO', { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 0 : d });
  /** Número digitado a la colombiana: «1.234,5» o «854,36»; un punto con 3 dígitos después («1.234») es separador de miles. */
  const pnum = s => { if (s === null || s === undefined) return null; const t = String(s).trim().replace(/[\s$]/g, ''); if (t === '') return null; const miles = /^-?\d{1,3}(\.\d{3})+$/.test(t); const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : (miles ? t.replace(/\./g, '') : t)); return isNaN(n) ? null : n; };
  const sum = a => a.reduce((x, y) => x + y, 0);
  /** Dato que no figura en el informe: se muestra como PENDIENTE (nunca «undefined» ni un valor inventado). */
  const PEND = t => '<span class="sl-pen" style="color:#9A6B00;font-weight:600">pendiente: ' + esc(t) + '</span>';
  const val = id => { const e = $(id); return e ? e.value : ''; };
  const chk = id => { const e = $(id); return !!(e && e.checked); };
  const CONFIG_NOMBRE = 'SUPUESTOS_SOLAR', CONFIG_TIPO = 'CONFIG_SOLAR', UMBRAL_KM = 10, UMBRAL_DIMENSION = 1.2;
  const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r, h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const CAMPOS_VERSIONADOS = ['crPrecio', 'crMec', 'crEsc', 'adPrecio', 'adMec', 'adEsc', 'opex', 'esc', 'horizonte', 'tasa', 'fuenteSupuestos'];

  const SOLAR = {
    PV: null,          // datos que vienen del informe PVsyst (confirmados)
    pend: null,        // informe leído, pendiente de confirmar
    cfg: null,         // valores estándar guardados (con versión)
    montado: false, _interno: false, _t: null, _balance: false,

    // ───────────── Montaje de la pantalla ─────────────
    montar() {
      const card = $('wz-card-solar'); if (!card || this.montado) return; this.montado = true;
      const grupo = $('wz-solar-json') && $('wz-solar-json').closest('.field-group');
      const meses = M.map((m, i) => `<label class="sl-mes"><span>${m}</span><input type="text" inputmode="decimal" id="sl-c${i}" data-sl="cons" aria-label="Consumo de ${m} en kWh"></label>`).join('');
      const campo = (id, label, ph, extra) => `<div class="field-group"><label for="${id}">${label}</label><input type="text" id="${id}" data-sl="x" ${extra || ''} placeholder="${esc(ph || '')}"></div>`;
      const raiz = document.createElement('div'); raiz.id = 'sl-root'; raiz.className = 'sl';
      raiz.innerHTML = `
        <div class="sl-paso"><div class="sl-h">1 · Informe de simulación (PVsyst)</div>
          <p class="wz-note">Suba el informe en PDF que entrega el ingeniero. Se lee en este equipo: el archivo no se envía a ningún servidor ni se modifica; queda identificado por su huella SHA-256. La huella permite verificar que los datos usados son coherentes con los extraídos de ese archivo, pero <u>no es una certificación independiente</u> del contenido original de PVsyst. Antes de usarlo, verá lo que se leyó para confirmarlo.</p>
          <div class="wz-row"><input type="file" id="sl-pdf" accept="application/pdf,.pdf" onchange="SOLAR.importar(this)"><span class="wz-solar-estado" id="sl-pdf-estado"></span></div>
          <div id="sl-pv"></div></div>
        <div class="sl-paso"><div class="sl-h">2 · Consumo del cliente (factura) y tarifa</div>
          <p class="wz-note">Digite el consumo en kWh de cada mes que traiga la factura. Los meses vacíos pueden completarse con el promedio de los meses documentados: quedan marcados como <b>estimados</b> (amarillo), la oferta los declara así y se recalculan o se reemplazan cuando llegue la factura real (basta escribir el valor real en esa casilla).</p>
          <div class="sl-meses">${meses}</div>
          <div class="wz-row"><button type="button" class="wz-btn sec" onclick="SOLAR.completarPromedio()">Completar meses vacíos con el promedio</button><button type="button" class="wz-btn ghost" onclick="SOLAR.borrarConsumo()">Borrar consumo</button><span class="wz-solar-estado" id="sl-cons-estado"></span></div>
          <div class="sl-grid2">${campo('sl-fcons', 'Fuente de los meses documentados', 'Ej.: factura Air-e de octubre de 2026 (abril a octubre)')}${campo('sl-tarifa', 'Tarifa de energía evitada ($/kWh)', 'Ej.: 854,36', 'inputmode="decimal"')}</div>
          ${campo('sl-ftarifa', 'Fuente de la tarifa', 'Ej.: factura Air-e de octubre de 2026, componente CU+COT')}</div>
        <div class="sl-paso"><div class="sl-h">3 · Autoconsumo y excedentes</div>
          <div id="sl-auto"></div>
          <div id="sl-bal-box" style="display:none">
            <label class="sl-chk"><input type="checkbox" id="sl-balance" data-sl="x"> Mientras tanto, mostrar una <b>estimación exploratoria por balance mensual</b> (cada mes: autoconsumo = el menor entre la generación y el consumo). Se imprime en una sección <b>separada</b>, no es una simulación y <b>no alimenta ningún indicador económico</b>: ninguna frase escrita a mano lo habilita.</label>
          </div></div>
        <div class="sl-paso"><div class="sl-h">4 · Beneficios económicos, supuestos y textos de la oferta</div>
          <p class="wz-note">Son tres beneficios <b>distintos</b>, cada uno con su precio y su fundamento: el <b>autoconsumo</b> (tarifa evitada, punto 2), los <b>créditos de energía</b> (excedentes que se permutan contra la energía importada) y los <b>excedentes adicionales</b> (lo que supera la importación). La regulación de excedentes (CREG 174 de 2021 y sus modificaciones) cambia con frecuencia: use el texto vigente y anote en el mecanismo la resolución y la fecha consultada. Si falta un dato, el indicador queda bloqueado; el sistema no pone ninguno por su cuenta.</p>
          <div id="sl-exc-info" class="sl-warn" style="display:none"></div>
          <label class="sl-chk"><input type="checkbox" id="sl-exc-no" data-sl="x"> <b>No valorar los excedentes</b> en esta oferta (decisión expresa: el beneficio contará solo el autoconsumo)</label>
          <div class="sl-grid2" id="sl-exc-no-box" style="display:none">${campo('sl-exc-motivo', 'Motivo de no valorar los excedentes', 'Obligatorio si se marca la casilla')}</div>
          <div id="sl-exc-lineas">
            <div class="sl-sub">Créditos de energía (excedentes ≤ energía importada)</div>
            <div class="sl-grid3">${campo('sl-cr-precio', 'Precio ($/kWh)', '', 'inputmode="decimal"')}${campo('sl-cr-mec', 'Mecanismo / norma vigente y fecha', 'Resolución y fecha consultada')}${campo('sl-cr-esc', 'Variación anual del precio (%)', '', 'inputmode="decimal"')}</div>
            <div class="sl-sub">Excedentes adicionales (lo que supera la energía importada)</div>
            <div class="sl-grid3">${campo('sl-ad-precio', 'Precio ($/kWh)', '', 'inputmode="decimal"')}${campo('sl-ad-mec', 'Mecanismo / norma vigente y fecha', 'Resolución y fecha consultada')}${campo('sl-ad-esc', 'Variación anual del precio (%)', '', 'inputmode="decimal"')}</div>
          </div>
          <div class="sl-sub">Supuestos financieros</div>
          <div class="sl-grid4">${campo('sl-opex', 'O&amp;M anual ($)', '', 'inputmode="decimal"')}${campo('sl-esc', 'Variación anual de la tarifa evitada (%)', '', 'inputmode="decimal"')}${campo('sl-hor', 'Horizonte (años)', '', 'inputmode="numeric"')}${campo('sl-tasa', 'Tasa de descuento (%) — opcional', 'Vacío = sin valor presente', 'inputmode="decimal"')}</div>
          <div class="sl-grid2"><div class="field-group"><label for="sl-degmodo">Degradación anual aplicada — origen</label><select id="sl-degmodo" data-sl="degmodo"><option value="PVSYST_PARAMETRO_MODULO">Parámetro de degradación del módulo del informe PVsyst</option><option value="EQUIVALENTE_TABLA_PVSYST">Equivalente anual de la tabla de envejecimiento (cálculo propio)</option><option value="MANUAL">Valor definido por NODIA</option></select></div>
            ${campo('sl-deg', 'Degradación anual aplicada (%)', '', 'inputmode="decimal"')}</div>
          <div id="sl-deg-info" class="wz-note"></div>
          ${campo('sl-fsup', 'Fuente de los supuestos financieros', 'De dónde salen el O&M, la variación de la tarifa y la tasa')}
          <div id="sl-ver-info" class="wz-solar-estado"></div>
          ${campo('sl-proy', 'Nombre del proyecto en la oferta', '')}
          <div class="wz-note"><b>Objeto, alcance, actividades y entregables:</b> se redactan UNA sola vez, en «Objeto y alcance» (más abajo en esta etapa); la oferta los imprime tal como se digitaron. El título del servicio y la ubicación del trabajo (etapa 1) identifican la sede beneficiaria y se imprimen en la portada y en la ficha técnica.</div>
          <div class="sl-grid2">
            <div class="field-group"><label for="sl-comp">Componentes y protecciones principales (una línea por punto)</label><textarea id="sl-comp" rows="5" data-sl="x"></textarea></div></div>
          <div class="sl-grid2"><div class="field-group"><label for="sl-ben">Beneficios tributarios (texto)</label><textarea id="sl-ben" rows="3" data-sl="x" placeholder="Vacío = la oferta no incluye esta sección"></textarea></div>
            ${campo('sl-ben-ref', 'Referencia normativa de los beneficios', '')}</div>
          <div class="wz-row"><button type="button" class="wz-btn sec" onclick="SOLAR.guardarConfig()">Guardar como valores estándar (nueva versión)</button><span class="wz-solar-estado" id="sl-cfg-estado"></span></div></div>
        <div class="sl-paso"><div class="sl-h">5 · Dimensionamiento y ubicación (verificación interna)</div>
          <div id="sl-dim-info"></div>
          <div class="field-group"><label for="sl-just">Justificación técnica o comercial del dimensionamiento (interna, no se imprime)</label><textarea id="sl-just" rows="2" data-sl="x" placeholder="Ej.: se prevé venta de excedentes / ampliación de carga / pedido expreso del cliente"></textarea></div>
          <div class="sl-grid3">${campo('sl-ubic', 'Ubicación real del proyecto (se toma de la etapa 1: «Ubicación del trabajo»)', 'Se completa sola con la ubicación del trabajo', 'readonly')}${campo('sl-ulat', 'Latitud real (opcional)', 'Ej.: 10,9878', 'inputmode="decimal"')}${campo('sl-ulon', 'Longitud real (opcional)', 'Ej.: -74,9547', 'inputmode="decimal"')}</div>
          <div id="sl-ubic-info"></div>
          ${campo('sl-ujust', 'Justificación si el punto simulado difiere de la ubicación real', 'Obligatoria cuando la distancia supera ' + UMBRAL_KM + ' km')}</div>
        <div class="sl-paso"><div class="sl-h">6 · Determinación tributaria por concepto (IVA)</div>
          <p class="wz-note">Ningún concepto se grava ni se excluye por defecto: en la tabla de partidas de esta etapa, elija el tratamiento de <b>cada</b> partida (gravado 19 %, gravado 5 %, excluido o exento). Para una partida <b>excluida</b> de IVA por tratarse de bienes o servicios de proyectos de fuentes no convencionales de energía, se exigen los datos de la <b>certificación UPME</b> y que la partida esté asociada a un bien o servicio de su alcance. Esta aplicación <u>no puede comprobar la autenticidad</u> del certificado ante la UPME ni decidir si procede la exclusión: imprime lo que se declara. Antes de usar una exclusión, confirme con la UPME y con su contador.</p>
          <div id="sl-trib-info" class="sl-warn" style="display:none"></div>
          <div class="sl-grid3">${campo('sl-cert-num', 'Certificación UPME — número', 'Solo si hay partidas excluidas')}<div class="field-group"><label for="sl-cert-fecha">Fecha de expedición</label><input type="date" id="sl-cert-fecha" data-sl="x"></div><div class="field-group"><label for="sl-cert-hasta">Vigente hasta (solo si el certificado la indica)</label><input type="date" id="sl-cert-hasta" data-sl="x"></div></div>
          ${campo('sl-cert-res', 'Resolución UPME bajo la cual se expidió (opcional)', 'Ej.: la que figure en el certificado')}
          <div class="field-group"><label for="sl-cert-alcance">Bienes y servicios del alcance de la certificación (una línea por concepto: «descripción | valor sin IVA»)</label><textarea id="sl-cert-alcance" rows="3" data-sl="x" placeholder="Ej.: Módulos fotovoltaicos de 710 Wp | 18500000"></textarea></div>
          <label class="sl-chk"><input type="checkbox" id="sl-trib-ok" data-sl="x"> <b>Confirmo la determinación tributaria de cada concepto</b> (gravado, excluido o exento), con su fundamento y soporte.</label></div>
        <div class="sl-paso"><div class="sl-h">7 · Documento de prueba</div>
          <label class="sl-chk"><input type="checkbox" id="sl-prueba" data-sl="x"> Este documento es de <b>prueba</b>: el cliente, los precios o las condiciones son ficticios (los datos energéticos son reales, del informe y la factura cargados). Se rotula visiblemente como <b>DOCUMENTO DE PRUEBA — no es una oferta para entregar a un cliente</b>, se emite como MUESTRA y conserva todas las validaciones de una oferta real.</label></div>
        <div id="sl-avisos" class="sl-avisos" aria-live="polite"></div>`;
      card.insertBefore(raiz, card.children[1]);
      { const py = $('sl-proy'); if (py && py.closest('.field-group')) py.closest('.field-group').style.display = 'none'; }   // el título del servicio (etapa 1) es la única fuente del nombre impreso
      { const bn = document.createElement('div'); bn.id = 'sl-clon'; bn.className = 'sl-warn'; bn.style.display = 'none'; raiz.insertBefore(bn, raiz.firstChild); }
      if (grupo) { const det = document.createElement('details'); det.className = 'sl-avanzado'; det.innerHTML = '<summary>Avanzado: datos en formato JSON</summary>'; grupo.parentNode.insertBefore(det, grupo); det.appendChild(grupo); }
      raiz.addEventListener('input', e => {
        const t = e.target; if (!t || !t.dataset || !t.dataset.sl) return;
        if (t.dataset.sl === 'cons') { t.classList.remove('sl-est'); this.reajustarEstimados(); }
        if (t.id === 'sl-deg') { const s = $('sl-degmodo'); if (s && s.value !== 'MANUAL') s.value = 'MANUAL'; }
        this.actualizar(true);
      });
      raiz.addEventListener('change', e => { const t = e.target; if (!t || !t.dataset || !t.dataset.sl) return; if (t.id === 'sl-degmodo') this.aplicarModoDegradacion(); if (t.id === 'sl-prueba') this.alternarPrueba(); this.actualizar(true); });
      { const pr = $('sl-prueba'); if (pr && !(typeof AUTH !== 'undefined' && AUTH.rol === 'ADMINISTRADOR')) { const paso = pr.closest('.sl-paso'); if (paso) paso.style.display = 'none'; } }   // PRODUCCIÓN: documentos de prueba solo para el administrador
      this.cargarConfig(); this.llenarDesde(WIZ.solar); this.pintarAuto(); this.pintarClon(); this.pintarAvisos();
    },

    /** Documento de prueba: se emite como MUESTRA (consecutivo MUESTRA-…) pero conserva todas las validaciones de una oferta real. */
    alternarPrueba() { if (!chk('sl-prueba')) return; const m = $('wz-muestra'); if (m && !m.checked) { m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true })); } },

    // ───────────── 1. Informe PVsyst ─────────────
    async importar(input) {
      const f = input.files && input.files[0], est = $('sl-pdf-estado'); if (!f) return;
      est.className = 'wz-solar-estado'; est.textContent = 'Leyendo el informe…'; $('sl-pv').innerHTML = '';
      try {
        const lineas = await PVSYST.leerPdf(f), r = PVSYST.parsear(lineas), sha = await PVSYST.sha256(f);
        if (!r.ok) { this.pend = null; est.className = 'wz-solar-estado err'; est.textContent = 'No se pudo usar el informe'; $('sl-pv').innerHTML = '<div class="sl-err"><b>Revise el informe:</b><ul>' + r.errores.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>'; return; }
        r.archivo = { nombre: f.name, sha256: sha, bytes: f.size };
        this.pend = r; est.className = 'wz-solar-estado ok'; est.textContent = 'Informe leído — confirme los datos'; this.pintarPendiente();
      } catch (e) { this.pend = null; est.className = 'wz-solar-estado err'; est.textContent = 'No se pudo leer el PDF: ' + e.message; }
    },
    pintarPendiente() {
      const r = this.pend, d = r.datos, m = d.modulo || {}, inv = d.inversor || {}, g = d.mensual.generacion, ev = d.envejecimiento || {};
      const fila = (a, b) => `<tr><th>${a}</th><td>${b}</td></tr>`;
      const carga = d.cargaTipo === 'DEFINIDA' ? `<b>Definida en PVsyst</b> («${esc(d.necesidades)}»): el informe trae el balance (E_Solar, E_Grid, E_User); autoconsumo y excedentes salen de esas columnas y el perfil queda identificado en la oferta. <b>Modalidad pendiente de validación</b> con un informe auténtico de PVsyst con carga definida: hasta ahora solo se ha probado con datos sintéticos; revise el informe y los resultados antes de enviar la oferta.`
        : d.cargaTipo === 'ILIMITADA' ? '<span class="sl-rojo"><b>CARGA ILIMITADA (red)</b></span>: la «energía inyectada» (E_Grid) es <b>toda la producción</b>, <u>no</u> son excedentes del cliente. Este informe <u>no</u> permite calcular autoconsumo, excedentes ni ahorro. Vuelva a simular en PVsyst cargando las «Necesidades del usuario».'
        : `<b>${esc(d.necesidades || 'No determinada')}</b>: la tabla del informe no trae el balance; no se obtienen autoconsumo ni excedentes de él.`;
      const deg = ev.parametroModuloPct != null ? `<div>• <b>Parámetro de degradación del módulo</b> (dato del informe): <b>${fmt(ev.parametroModuloPct, 2)} %/año</b>.</div>
        ${ev.equivalentePct != null ? `<div>• <b>Tabla de envejecimiento a ${ev.aniosTabla} años</b> (datos del informe): la energía útil baja de ${fmt(ev.serie[0].euseMWh, 2)} a ${fmt(ev.serie[ev.serie.length - 1].euseMWh, 2)} MWh; caídas anuales entre ${fmt(ev.caidaAnualMinPct, 2)} % y ${fmt(ev.caidaAnualMaxPct, 2)} %.</div>
        <div>• <b>Equivalente anual compuesto</b> (<i>cálculo propio</i> con esa tabla): <b>${fmt(ev.equivalentePct, 2)} %/año</b>. Diferencia con el parámetro: ${fmt(ev.diferenciaEquivalenteVsParametroPct, 2)} puntos por año.</div>
        <div>• Pérdida total de PR al año ${ev.aniosTabla}: ${fmt(ev.perdidaTotalUltimoAnioPct, 2)} % (tabla) frente a ${fmt(ev.perdidaLinealModuloUltimoAnioPct, 2)} % si solo actuara el parámetro del módulo: <i>pérdidas adicionales</i> de ${fmt(ev.perdidaAdicionalUltimoAnioPct, 2)} puntos (cálculo propio). El informe lista además «desajuste por dispersión» (Imp ${fmt(ev.dispersionImpRmsPct, 1)} %/año, Vmp ${fmt(ev.dispersionVmpRmsPct, 1)} %/año); que explique la diferencia <b>no está verificado</b>.</div>
        <div><b>No se sustituye ningún valor:</b> en el punto 4 se elige cuál se aplica y la oferta declara su origen (por omisión, el parámetro del informe).</div>` : ''}` : 'No se encontró en el informe.';
      $('sl-pv').innerHTML = `<div class="sl-pend"><table class="sl-tbl">
        ${fila('Archivo', esc(r.archivo.nombre) + '<br><small>SHA-256 ' + esc(r.archivo.sha256) + '</small>')}
        ${fila('Punto simulado', `<input type="text" id="sl-lugar" value="${esc([d.lugar, d.pais].filter(Boolean).join(', '))}" aria-label="Sitio"> ${d.latitud != null && d.longitud != null ? `<small>(${fmt(d.latitud, 4)}°, ${fmt(d.longitud, 4)}°; ${esc(d.meteo || '')})</small>` : PEND('el informe no trae las coordenadas')}`)}
        ${fila('Módulos', `${fmt(m.cantidad)} × ${[m.marca, m.modelo].filter(Boolean).length ? esc([m.marca, m.modelo].filter(Boolean).join(' ')) : PEND('marca y modelo')} de ${fmt(m.wp)} Wp = <b>${fmt(d.kwp, 2)} kWp</b>${d.subconjuntos > 1 ? ' <small>(suma de ' + d.subconjuntos + ' subconjuntos del informe)</small>' : ''}`)}
        ${fila('Inversor', `${fmt(inv.cantidad)} × ${[inv.marca, inv.modelo].filter(Boolean).length ? esc([inv.marca, inv.modelo].filter(Boolean).join(' ')) : PEND('marca y modelo')} de ${fmt(inv.kwacUnidad, 1)} kWac`)}
        ${fila('Orientación', d.inclinacion != null && d.azimut != null ? `Inclinación ${fmt(d.inclinacion, 1)}° · azimut ${fmt(d.azimut, 1)}°` : PEND('el informe no trae la orientación'))}
        ${(d.pendientes || []).length ? fila('Pendiente', PEND('no figura en el informe: ' + d.pendientes.join(', ') + '. Queda sin completar y no se imprime en la oferta')) : ''}
        ${fila('Producción', `<b>${fmt(d.generacionAnual)} kWh/año</b>${d.produccionEspecifica ? ' · ' + fmt(d.produccionEspecifica) + ' kWh/kWp·año' : ''}${d.pr ? ' · PR ' + fmt(d.pr, 2) + ' %' : ''}`)}
        ${fila('Mes a mes (kWh)', '<div class="sl-mini">' + g.map((v, i) => `<span><i>${M[i]}</i>${fmt(v)}</span>`).join('') + '</div>')}
        ${fila('Carga simulada', carga)}
        ${fila('Degradación', deg)}
        ${fila('Verificación', `✔ Los 12 meses suman ${fmt(d.generacionAnual)} kWh, igual al total de la tabla (con la tolerancia de redondeo de PVsyst)` + (d.energiaAnual ? (Math.abs(d.energiaAnual - d.generacionAnual) < 0.5 ? ' y a la energía producida del resumen.' : ' y, dentro de ese redondeo, a la energía producida del resumen (' + fmt(d.energiaAnual) + ' kWh): la oferta imprime la suma de los 12 meses.') : '.'))}
        ${r.avisos.length ? fila('Avisos', r.avisos.map(esc).join('<br>')) : ''}</table>
        <div class="wz-row"><button type="button" class="wz-btn" onclick="SOLAR.confirmarPendiente()">Confirmar y usar estos datos</button><button type="button" class="wz-btn ghost" onclick="SOLAR.descartarPendiente()">Descartar</button></div></div>`;
    },
    descartarPendiente() { this.pend = null; $('sl-pv').innerHTML = this.resumenPV(); const e = $('sl-pdf-estado'); e.className = 'wz-solar-estado'; e.textContent = this.PV ? '' : 'Sin informe cargado'; const i = $('sl-pdf'); if (i) i.value = ''; },
    async confirmarPendiente() {
      const r = this.pend; if (!r) return; const d = r.datos, m = d.modulo || {}, inv = d.inversor || {}, ev = d.envejecimiento || {};
      const lugar = (val('sl-lugar') || '').trim();
      this.PV = {
        sistema: { modulos: { cantidad: m.cantidad, potenciaWp: m.wp, marca: m.marca, modelo: m.modelo }, inversores: { cantidad: inv.cantidad, potenciaKwac: inv.kwacUnidad, marca: inv.marca, modelo: inv.modelo }, configuracion: 'Conectado a red (On-Grid)', potenciaKwp: d.kwp },
        simulacion: { programa: 'PVsyst V' + d.version, fecha: d.fechaSimulacion, lugar: lugar, latitud: d.latitud, longitud: d.longitud, inclinacionGrados: d.inclinacion, azimutGrados: d.azimut, datosMeteorologicos: d.meteo, proporcionRendimientoPct: d.pr, produccionEspecificaKWhKWp: d.produccionEspecifica,
          archivoNombre: r.archivo.nombre, archivoSha256: r.archivo.sha256,
          envejecimiento: { parametroModuloPct: ev.parametroModuloPct, equivalentePct: ev.equivalentePct, aniosTabla: ev.aniosTabla, caidaAnualMinPct: ev.caidaAnualMinPct, caidaAnualMaxPct: ev.caidaAnualMaxPct } },
        gen: d.mensual.generacion.slice(), auto: d.cargaTipo === 'DEFINIDA' ? d.mensual.autoconsumo.slice() : null, exc: d.cargaTipo === 'DEFINIDA' ? d.mensual.excedentes.slice() : null,
        cargaTipo: d.cargaTipo, perfilCarga: d.perfilCarga,
        fuente: 'Simulación PVsyst V' + d.version + (d.fechaSimulacion ? ' del ' + d.fechaSimulacion : ''),
        horizonte: ev.horizonte || null, eUser: d.cargaTipo === 'DEFINIDA' && d.mensual.consumo ? d.mensual.consumo.slice() : null
      };
      this.PV.simulacion.origenDatos = 'INFORME_PVSYST';
      this.PV.simulacion.huellaDatos = await PVSYST.sha256Texto(PVSYST.cadenaDatos(this.PV.gen, this.PV.auto, this.PV.exc, this.PV.eUser));   // los números impresos quedan atados a este archivo
      if (this.PV.eUser) {
        this.PV.eUser.forEach((v, i) => { const e = $('sl-c' + i); if (e) { e.value = fmt(v); e.classList.remove('sl-est'); } });
        this.poner('sl-fcons', 'perfil de carga del usuario definido en la simulación PVsyst («' + d.necesidades + '»)');
      }
      if (this.PV.horizonte && !pnum(val('sl-hor'))) this.poner('sl-hor', String(this.PV.horizonte));
      const sel = $('sl-degmodo'); if (sel && !pnum(val('sl-deg'))) { sel.value = 'PVSYST_PARAMETRO_MODULO'; this.aplicarModoDegradacion(); }
      if (!val('sl-proy')) this.poner('sl-proy', 'Sistema solar fotovoltaico conectado a red de ' + fmt(d.kwp, 2) + ' kWp');
      if (!val('sl-comp').trim()) {
        const ls = [], ok = (...v) => v.every(x => x !== undefined && x !== null && x !== '' && !(typeof x === 'number' && isNaN(x)));
        if (ok(m.cantidad, m.wp)) ls.push(m.cantidad + ' módulos fotovoltaicos' + (ok(m.marca) ? ' ' + m.marca : '') + (ok(m.modelo) ? ' ' + m.modelo : '') + ' de ' + m.wp + ' Wp.');
        if (ok(inv.cantidad, inv.kwacUnidad)) ls.push(inv.cantidad + ' inversor' + (inv.cantidad > 1 ? 'es' : '') + (ok(inv.marca) ? ' ' + inv.marca : '') + (ok(inv.modelo) ? ' ' + inv.modelo : '') + ' de ' + inv.kwacUnidad + ' kWac.');
        if (ls.length) this.poner('sl-comp', ls.join('\n'));
      }
      this.pend = null; $('sl-pv').innerHTML = this.resumenPV(); const e = $('sl-pdf-estado'); e.className = 'wz-solar-estado ok'; e.textContent = 'Informe confirmado'; const i = $('sl-pdf'); if (i) i.value = '';
      this.actualizar(true); UI.toast('Datos del informe PVsyst cargados', 'ok');
    },
    resumenPV() {
      const p = this.PV; if (!p) return ''; const s = p.sistema, m = s.modulos, i = s.inversores;
      const carga = p.cargaTipo === 'ILIMITADA' ? 'simulado con CARGA ILIMITADA: sin autoconsumo ni excedentes' : p.auto ? 'con la carga del usuario definida en el informe: autoconsumo y excedentes del informe' : 'sin autoconsumo ni excedentes';
      return `<div class="${p.auto ? 'sl-ok' : 'sl-warn'}">✔ <b>${esc(p.fuente)}</b> — ${fmt(m.cantidad)} módulos de ${fmt(m.potenciaWp)} Wp (${fmt(s.potenciaKwp, 2)} kWp), ${fmt(i.cantidad)} inversor(es) de ${fmt(i.potenciaKwac, 1)} kWac · producción ${fmt(sum(p.gen))} kWh/año · ${carga}.${p.simulacion && p.simulacion.archivoSha256 ? '<br><small>Archivo ' + esc(p.simulacion.archivoNombre) + ' · SHA-256 ' + esc(p.simulacion.archivoSha256) + '</small>' : ''}</div>`;
    },
    poner(id, v) { const e = $(id); if (e) e.value = v == null ? '' : v; },

    // ───────────── 2. Consumo con origen por mes ─────────────
    consumo() { return M.map((_, i) => pnum(val('sl-c' + i))); },
    /** Meses cuya casilla no es UN número válido (letras, varias cifras separadas por espacio o tabulador, negativos): nunca se toman «a medias». */
    consumoInvalido() { return M.filter((_, i) => { const t = String(val('sl-c' + i) || '').trim(); if (!t) return false; if (/\d\s+\d/.test(t) || /[^\d.,\s$]/.test(t)) return true; const n = pnum(t); return n === null || n < 0; }); },
    esEstimado(i) { const e = $('sl-c' + i); return !!(e && e.classList.contains('sl-est')); },
    /** Promedio de los meses documentados (los que no están marcados como estimados). */
    promedioDocumentado() { const c = this.consumo().filter((v, i) => v !== null && !this.esEstimado(i)); return c.length ? sum(c) / c.length : null; },
    completarPromedio() {
      const c = this.consumo(), prom = this.promedioDocumentado();
      if (prom === null) { UI.toast('Digite primero el consumo de los meses que trae la factura', 'warn'); return; }
      if (c.every(v => v !== null)) { UI.toast('Ya están los 12 meses', 'info'); return; }
      const p = Math.round(prom); c.forEach((v, i) => { if (v === null) { const e = $('sl-c' + i); e.value = fmt(p); e.classList.add('sl-est'); } }); this.actualizar(true);
    },
    /** Al llegar un dato real, los meses que siguen estimados se recalculan con el nuevo promedio documentado. */
    reajustarEstimados() {
      const prom = this.promedioDocumentado(); if (prom === null) return; const p = Math.round(prom);
      M.forEach((_, i) => { if (this.esEstimado(i)) $('sl-c' + i).value = fmt(p); });
    },
    borrarConsumo() { M.forEach((_, i) => { const e = $('sl-c' + i); e.value = ''; e.classList.remove('sl-est'); }); this.actualizar(true); },

    // ───────────── 3. Autoconsumo y excedentes ─────────────
    pintarAuto() {
      const c = $('sl-auto'); if (!c) return; const p = this.PV; let h = '', mostrarBal = false;
      if (!p) h = '<p class="wz-note">Cargue y confirme el informe PVsyst para ver este punto.</p>';
      else if (p.auto) h = `<div class="sl-ok">✔ Autoconsumo (${fmt(sum(p.auto))} kWh/año) y excedentes (${fmt(sum(p.exc))} kWh/año) tomados del informe PVsyst, simulado con la carga del usuario definida: <b>${esc(p.perfilCarga && p.perfilCarga.descripcion)}</b>. El perfil queda identificado en la oferta. <b>Modalidad pendiente de validación</b> con un informe auténtico de PVsyst con carga definida: hasta ahora solo se ha probado con datos sintéticos; revise el informe y los resultados antes de enviar la oferta.</div>`;
      else {
        mostrarBal = true;
        h = p.cargaTipo === 'ILIMITADA'
          ? '<div class="sl-warn"><b>Simulación con «CARGA ILIMITADA»: toda la producción figura como inyectada a la red.</b> Eso <u>no</u> son excedentes del cliente: no se usa para calcular autoconsumo, excedentes ni ahorro, y la oferta saldrá <u>sin ahorro ni recuperación de la inversión</u>.<br>Lo correcto: volver a simular en PVsyst cargando las «Necesidades del usuario» con el consumo del cliente y subir ese informe.</div>'
          : '<div class="sl-warn"><b>El informe no trae el balance con carga del usuario.</b> No hay autoconsumo ni excedentes de la simulación; la oferta saldrá sin ahorro ni recuperación de la inversión.</div>';
      }
      c.innerHTML = h; const bb = $('sl-bal-box'); if (bb) bb.style.display = mostrarBal ? '' : 'none';
    },

    // ───────────── Degradación: se ELIGE, no se sustituye ─────────────
    aplicarModoDegradacion() {
      const modo = val('sl-degmodo'), ev = this.PV && this.PV.simulacion && this.PV.simulacion.envejecimiento;
      if (modo === 'MANUAL' || !ev) return;
      const v = modo === 'PVSYST_PARAMETRO_MODULO' ? ev.parametroModuloPct : ev.equivalentePct;
      if (v != null) this.poner('sl-deg', fmt(v, 2));
    },
    notaDegradacion(modo, ev) {
      if (!ev || ev.parametroModuloPct == null) return '';
      const par = fmt(ev.parametroModuloPct, 2), eq = ev.equivalentePct != null ? fmt(ev.equivalentePct, 2) : null;
      if (modo === 'PVSYST_PARAMETRO_MODULO') return eq ? 'Degradación del módulo según el informe PVsyst (' + par + ' %/año). La tabla de envejecimiento del mismo informe equivale a ' + eq + ' %/año en promedio (incluye pérdidas adicionales con los años), por lo que el flujo aquí calculado es más favorable que el de esa tabla.' : '';
      if (modo === 'EQUIVALENTE_TABLA_PVSYST') return 'Degradación equivalente calculada (cálculo propio) a partir de la tabla de envejecimiento de PVsyst; el parámetro de degradación del módulo del informe es ' + par + ' %/año y la diferencia corresponde a pérdidas adicionales que PVsyst acumula con los años.';
      return 'Degradación definida por NODIA; el informe PVsyst indica ' + par + ' %/año (módulo)' + (eq ? ' y ' + eq + ' %/año equivalente en su tabla de envejecimiento' : '') + '.';
    },

    // ───────────── Cálculos de energía (créditos / adicionales) ─────────────
    /** Con consumo completo y autoconsumo/excedentes: créditos = Σ mín(excedentes del mes; importación del mes = consumo − autoconsumo). */
    reparto(auto, exc, cons) {
      if (!auto || !exc || !cons || cons.some(v => v === null)) return null;
      const cr = sum(exc.map((x, i) => Math.min(x, Math.max(cons[i] - auto[i], 0)))), total = sum(exc);
      return { creditos: Math.round(cr * 10) / 10, adicionales: Math.round((total - cr) * 10) / 10, total: Math.round(total * 10) / 10 };
    },

    // ───────────── Armado del JSON ─────────────
    /** La ubicación del proyecto es UNA sola: la «Ubicación del trabajo» de la etapa 1 (este campo solo la refleja). */
    sincronizarUbicacion() { const a = $('of-nd-ubicacion'), b = $('sl-ubic'); if (a && b && b.value !== a.value) b.value = a.value; },
    construir() {
      this.sincronizarUbicacion();
      const p = this.PV; const o = { sistema: p ? JSON.parse(JSON.stringify(p.sistema)) : {}, energia: {}, tarifa: {}, finanzas: {} };
      if (p) o.simulacion = JSON.parse(JSON.stringify(p.simulacion));
      const proy = val('sl-proy').trim(); if (proy) o.proyecto = proy;
      const e = o.energia, c = this.consumo(), conTodos = c.every(v => v !== null), conAlguno = c.some(v => v !== null);
      if (p) { e.generacionMensualKWh = p.gen.slice(); e.cargaSimulacion = p.cargaTipo; if (p.perfilCarga) e.perfilCarga = JSON.parse(JSON.stringify(p.perfilCarga)); }
      const fcons = val('sl-fcons').trim(); if (fcons) e.fuenteConsumo = fcons;
      if (conTodos) {
        e.consumoMensualKWh = c.slice(); e.consumoOrigenMeses = c.map((v, i) => this.esEstimado(i) ? 'ESTIMADO_PROMEDIO' : 'DOCUMENTADO');
        const est = e.consumoOrigenMeses.map((o2, i) => o2 === 'ESTIMADO_PROMEDIO' ? i : -1).filter(i => i >= 0); if (est.length) e.consumoEstimadoMeses = est;
      }
      const partes = []; if (p) partes.push(p.fuente); if (conTodos && fcons) partes.push('consumo: ' + fcons); if (partes.length) e.fuente = partes.join('; ');
      // autoconsumo y excedentes: del informe con carga definida, o balance mensual EXPLORATORIO
      const bal = chk('sl-balance'); this._balance = bal;
      if (p && p.auto) { e.autoconsumoMensualKWh = p.auto.slice(); e.excedentesMensualKWh = p.exc.slice(); e.metodoAutoconsumo = 'PVSYST_CARGA_DEFINIDA'; }
      else if (p && bal && conTodos) {   // ESTIMACIÓN EXPLORATORIA: campo separado, nunca se mezcla con el autoconsumo de una simulación
        const au = p.gen.map((g, i) => Math.round(Math.min(g, c[i]) * 10) / 10);
        e.exploratorio = { metodo: 'BALANCE_MENSUAL', autoconsumoMensualKWh: au, excedentesMensualKWh: p.gen.map((g, i) => Math.round((g - au[i]) * 10) / 10) };
      }
      // tarifa evitada (beneficio 1)
      const tar = pnum(val('sl-tarifa')); if (tar !== null) o.tarifa.energiaCOPkWh = tar; const ft = val('sl-ftarifa').trim(); if (ft) o.tarifa.fuente = ft;
      // créditos de energía (beneficio 2) y excedentes adicionales (beneficio 3): cada uno con su precio, mecanismo y variación anual
      const rep = this.reparto(e.autoconsumoMensualKWh, e.excedentesMensualKWh, conTodos ? c : null); this._rep = rep;
      if (e.excedentesMensualKWh) {
        if (chk('sl-exc-no')) { o.excedentes = { noValorados: true, motivoNoValorar: val('sl-exc-motivo').trim() }; }
        else if (rep) {
          const lineas = [], linea = (tipo, en, pr, mec, es) => { const L = { tipo, energiaKWh: en }; const pp = pnum(pr), ee = pnum(es); if (pp !== null) L.precioCOPkWh = pp; if (String(mec).trim()) L.mecanismo = String(mec).trim(); if (ee !== null) L.escalacionAnualPct = ee; return L; };
          const cr = linea('CREDITO_ENERGIA', rep.creditos, val('sl-cr-precio'), val('sl-cr-mec'), val('sl-cr-esc')), ad = linea('EXCEDENTE_ADICIONAL', rep.adicionales, val('sl-ad-precio'), val('sl-ad-mec'), val('sl-ad-esc'));
          const completa = L => L.precioCOPkWh !== undefined && L.mecanismo !== undefined;
          if (rep.creditos > 0.05 && completa(cr)) lineas.push(cr); if (rep.adicionales > 0.05 && completa(ad)) lineas.push(ad);
          if (lineas.length) o.excedentes = { valoracion: lineas };
        }
      }
      // supuestos financieros
      const f = o.finanzas, ox = pnum(val('sl-opex')), es = pnum(val('sl-esc')), dg = pnum(val('sl-deg')), ho = pnum(val('sl-hor')), ta = pnum(val('sl-tasa'));
      if (ox !== null) f.opexAnualCOP = ox; if (es !== null) f.escalacionTarifaPct = es; if (dg !== null) f.degradacionAnualPct = dg; if (ho !== null) f.horizonteAnios = ho; if (ta !== null) f.tasaDescuentoPct = ta;
      const modo = val('sl-degmodo') || 'MANUAL'; if (dg !== null) { f.degradacionOrigen = modo; const nota = this.notaDegradacion(modo, p && p.simulacion && p.simulacion.envejecimiento); if (nota) f.notaDegradacion = nota; }
      const fst = val('sl-fsup').trim(); if (fst) f.fuenteSupuestos = fst;
      const ver = this.versionUsada(); if (ver) f.supuestosVersion = ver;
      // textos
      const lin = id => val(id).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const al = lin('sl-alcance'), co = lin('sl-comp'); if (al.length) o.alcance = al; if (co.length) o.componentes = co;
      const bt = val('sl-ben').trim(); if (bt) o.beneficiosTributarios = { texto: bt, referencia: val('sl-ben-ref').trim() };
      // dimensionamiento (interno) y ubicación real del proyecto (el informe original no se altera)
      const k = conTodos && p ? sum(c) : null, g = p ? sum(p.gen) : null; const just = val('sl-just').trim();
      if (just || (k && g)) o.dimensionamiento = { justificacion: just, generacionVsConsumoPct: k && g ? Math.round(g / k * 1000) / 10 : null };
      const ub = val('sl-ubic').trim(), ula = pnum(val('sl-ulat')), ulo = pnum(val('sl-ulon')), uj = val('sl-ujust').trim();
      if (p && (ub || ula !== null || ulo !== null)) { o.simulacion.ubicacionProyecto = { descripcion: ub }; if (ula !== null) o.simulacion.ubicacionProyecto.latitud = ula; if (ulo !== null) o.simulacion.ubicacionProyecto.longitud = ulo; if (uj) o.simulacion.ubicacionProyecto.justificacion = uj; }
      // documento de prueba (cliente, precios o condiciones ficticios): se rotula visiblemente y conserva la validación estricta
      if (chk('sl-prueba')) o.documentoPrueba = { datosReales: true, fuentes: (p && p.simulacion && p.simulacion.archivoNombre ? 'informe PVsyst «' + p.simulacion.archivoNombre + '»' : 'informe de simulación') + (fcons ? ' y ' + fcons : '') };
      // determinación tributaria por concepto (nada por defecto)
      { const al = TRIB.alcance(), trib = { confirmacion: { confirmado: chk('sl-trib-ok'), fecha: new Date().toLocaleDateString('es-CO') } };
        if (val('sl-cert-num').trim() || al.length) trib.certificacionUPME = { numero: val('sl-cert-num').trim(), fechaExpedicion: val('sl-cert-fecha'), vigenteHasta: val('sl-cert-hasta') || undefined, resolucion: val('sl-cert-res').trim() || undefined, alcance: al };
        trib.cobertura = TRIB.filas().map((tr, i) => ({ tr, n: i + 1 })).filter(x => (x.tr.querySelector('.inp-iva') || {}).value === 'EXCLUIDO' && x.tr.dataset.cobertura !== undefined && x.tr.dataset.cobertura !== '').map(x => ({ itemN: x.n, alcanceIdx: Number(x.tr.dataset.cobertura) }));
        o.tributario = trib; }
      this._cons = { c, conTodos, conAlguno };
      return o;
    },
    actualizar(desdeForm) {
      if (!this.montado) return; clearTimeout(this._t);
      this._t = setTimeout(() => {
        const o = this.construir(), vacio = !this.PV && !this._cons.conAlguno && !val('sl-tarifa') && !val('sl-proy') && !val('sl-alcance') && !val('sl-cert-num') && !chk('sl-trib-ok') && !chk('sl-prueba');
        this._interno = true; try { const ta = $('wz-solar-json'); if (ta) { ta.value = (vacio && !WIZ.solar) ? '' : JSON.stringify(o, null, 1); } WIZ.leerSolar(); if (desdeForm) WIZ.alCambiar(); } finally { this._interno = false; }
        this.pintarAuto(); this.pintarExcedentes(); this.pintarVersion(); this.pintarUbicacion(); this.pintarAvisos();
        const est = $('sl-cons-estado'); if (est) { const n = this._cons.c.filter(v => v !== null).length, ne = M.filter((_, i) => this.esEstimado(i) && this._cons.c[i] !== null).length; est.textContent = n ? n + ' de 12 meses con dato' + (ne ? ' (' + (n - ne) + ' documentados + ' + ne + ' estimados)' : '') + (n === 12 ? ' · suma ' + fmt(sum(this._cons.c)) + ' kWh/año' : '') : ''; est.className = 'wz-solar-estado' + (n === 12 ? ' ok' : ''); }
        const di = $('sl-deg-info'); if (di) { const ev = this.PV && this.PV.simulacion && this.PV.simulacion.envejecimiento; di.textContent = ev && ev.parametroModuloPct != null ? 'Informe PVsyst: parámetro del módulo ' + fmt(ev.parametroModuloPct, 2) + ' %/año' + (ev.equivalentePct != null ? '; equivalente de su tabla de ' + ev.aniosTabla + ' años (cálculo propio) ' + fmt(ev.equivalentePct, 2) + ' %/año' : '') + '. El valor aplicado y su origen se declaran en la oferta.' : ''; }
      }, 80);
    },
    pintarExcedentes() {
      const i = $('sl-exc-info'), rep = this._rep, no = chk('sl-exc-no'); const nb = $('sl-exc-no-box'); if (nb) nb.style.display = no ? '' : 'none';
      const ln = $('sl-exc-lineas'); if (ln) ln.style.display = no ? 'none' : '';
      if (!i) return; const e = (WIZ.solar || {}).energia || {};
      if (!e.excedentesMensualKWh) { i.style.display = 'none'; return; }
      i.style.display = ''; i.className = rep ? 'sl-ok' : 'sl-warn';
      i.innerHTML = rep ? `Excedentes proyectados ${fmt(rep.total)} kWh/año = <b>créditos de energía ${fmt(rep.creditos)} kWh</b> (cada mes, el menor entre los excedentes y la energía importada) + <b>excedentes adicionales ${fmt(rep.adicionales)} kWh</b>.` : 'Para separar créditos de energía y excedentes adicionales se necesita el consumo de los 12 meses.';
    },

    /** Datos del informe y de la factura → pantalla (borradores, ofertas clonadas o JSON pegado a mano). */
    llenarDesde(s) {
      if (this._interno || !this.montado) return; if (!s) { this.PV = null; this.limpiarCampos(); this.pintarAuto(); this.pintarAvisos(); $('sl-pv').innerHTML = ''; return; }
      const e = s.energia || {}, f = s.finanzas || {}, t = s.tarifa || {}, sm = s.simulacion || {};
      const origenBalance = !!(e.exploratorio && e.exploratorio.metodo === 'BALANCE_MENSUAL');
      this.PV = s.sistema && Array.isArray(e.generacionMensualKWh) ? { sistema: s.sistema, simulacion: sm, gen: e.generacionMensualKWh.slice(), auto: !origenBalance && Array.isArray(e.autoconsumoMensualKWh) ? e.autoconsumoMensualKWh.slice() : null, exc: !origenBalance && Array.isArray(e.excedentesMensualKWh) ? e.excedentesMensualKWh.slice() : null,
        cargaTipo: e.cargaSimulacion || '', perfilCarga: e.perfilCarga || null, fuente: String(e.fuente || '').split('; consumo:')[0] || 'Datos cargados', horizonte: f.horizonteAnios || null, eUser: null } : null;
      const orig = Array.isArray(e.consumoOrigenMeses) ? e.consumoOrigenMeses : null;
      M.forEach((_, i) => { const x = $('sl-c' + i); const v = Array.isArray(e.consumoMensualKWh) ? e.consumoMensualKWh[i] : null; x.value = v == null ? '' : fmt(v); x.classList.toggle('sl-est', orig ? orig[i] === 'ESTIMADO_PROMEDIO' : (e.consumoEstimadoMeses || []).includes(i)); });
      this.poner('sl-fcons', e.fuenteConsumo || ''); this.poner('sl-tarifa', t.energiaCOPkWh != null ? fmt(t.energiaCOPkWh, 2) : ''); this.poner('sl-ftarifa', t.fuente || '');
      const ex = s.excedentes || {}, L = tp => (ex.valoracion || []).find(l => l.tipo === tp) || null, cr = L('CREDITO_ENERGIA'), ad = L('EXCEDENTE_ADICIONAL');
      $('sl-exc-no').checked = ex.noValorados === true; this.poner('sl-exc-motivo', ex.motivoNoValorar || '');
      this.poner('sl-cr-precio', cr ? fmt(cr.precioCOPkWh, 2) : ''); this.poner('sl-cr-mec', cr ? cr.mecanismo : ''); this.poner('sl-cr-esc', cr && cr.escalacionAnualPct != null ? fmt(cr.escalacionAnualPct, 2) : '');
      this.poner('sl-ad-precio', ad ? fmt(ad.precioCOPkWh, 2) : ''); this.poner('sl-ad-mec', ad ? ad.mecanismo : ''); this.poner('sl-ad-esc', ad && ad.escalacionAnualPct != null ? fmt(ad.escalacionAnualPct, 2) : '');
      this.poner('sl-opex', f.opexAnualCOP != null ? fmt(f.opexAnualCOP) : ''); this.poner('sl-esc', f.escalacionTarifaPct != null ? fmt(f.escalacionTarifaPct, 2) : ''); this.poner('sl-deg', f.degradacionAnualPct != null ? fmt(f.degradacionAnualPct, 2) : '');
      if ($('sl-degmodo')) $('sl-degmodo').value = f.degradacionOrigen || (f.degradacionAnualPct != null ? 'MANUAL' : 'PVSYST_PARAMETRO_MODULO');
      this.poner('sl-hor', f.horizonteAnios != null ? f.horizonteAnios : ''); this.poner('sl-tasa', f.tasaDescuentoPct != null ? fmt(f.tasaDescuentoPct, 2) : ''); this.poner('sl-fsup', f.fuenteSupuestos || '');
      this.poner('sl-proy', s.proyecto || ''); /* ofertas guardadas antes: su «alcance» solar pasa a «Objeto y alcance» (única fuente) si ahí aún no hay actividades */ if ((s.alcance || []).length && !WIZ.alcanceActs().length) s.alcance.forEach(t => OFERTAS.addAlcance(t));this.poner('sl-comp', (s.componentes || []).join('\n'));
      this.poner('sl-ben', s.beneficiosTributarios ? s.beneficiosTributarios.texto : ''); this.poner('sl-ben-ref', s.beneficiosTributarios ? (s.beneficiosTributarios.referencia || '') : '');
      this.poner('sl-just', s.dimensionamiento ? s.dimensionamiento.justificacion || '' : ''); const up = sm.ubicacionProyecto || {};
      this.poner('sl-ubic', up.descripcion || ''); this.poner('sl-ulat', up.latitud != null ? fmt(up.latitud, 4) : ''); this.poner('sl-ulon', up.longitud != null ? fmt(up.longitud, 4) : ''); this.poner('sl-ujust', up.justificacion || '');
      { const tr0 = s.tributario || {}, ce = tr0.certificacionUPME || {};
        $('sl-trib-ok').checked = !!(tr0.confirmacion && tr0.confirmacion.confirmado); this.poner('sl-cert-num', ce.numero || ''); this.poner('sl-cert-fecha', ce.fechaExpedicion || ''); this.poner('sl-cert-hasta', ce.vigenteHasta || ''); this.poner('sl-cert-res', ce.resolucion || '');
        this.poner('sl-cert-alcance', (ce.alcance || []).map(a => a.descripcion + (a.valorSinIvaCOP !== undefined ? ' | ' + a.valorSinIvaCOP : '')).join('\n')); $('sl-prueba').checked = !!s.documentoPrueba;
        (tr0.cobertura || []).forEach(cb => { const tr = TRIB.filas()[cb.itemN - 1]; if (tr) tr.dataset.cobertura = cb.alcanceIdx; }); }
      this._balance = origenBalance; this.pintarAuto(); if ($('sl-balance')) $('sl-balance').checked = origenBalance; this.pintarAuto();
      $('sl-pv').innerHTML = this.resumenPV(); this._interno = true; try { this.pintarExcedentes(); } finally { this._interno = false; } this.pintarVersion(); this.pintarUbicacion(); this.pintarAvisos();
    },
    limpiarCampos() { document.querySelectorAll('#sl-root input[data-sl], #sl-root textarea[data-sl]').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; i.classList && i.classList.remove('sl-est'); }); const s = $('sl-degmodo'); if (s) s.value = 'PVSYST_PARAMETRO_MODULO'; this._balance = false; this.cargarConfig(); },

    // ───────────── Valores estándar con VERSIÓN ─────────────
    configGuardada() { const k = (OFERTAS.DB && OFERTAS.DB.kits || []).find(x => String(x.TIPO).toUpperCase() === CONFIG_TIPO && String(x.NOMBRE) === CONFIG_NOMBRE); if (!k) return null; try { return JSON.parse(k.DATA_JSON); } catch (e) { return null; } },
    valoresPantalla() {
      return { crPrecio: val('sl-cr-precio'), crMec: val('sl-cr-mec'), crEsc: val('sl-cr-esc'), adPrecio: val('sl-ad-precio'), adMec: val('sl-ad-mec'), adEsc: val('sl-ad-esc'), opex: val('sl-opex'), esc: val('sl-esc'), horizonte: val('sl-hor'), tasa: val('sl-tasa'), fuenteSupuestos: val('sl-fsup'),
        ftarifa: val('sl-ftarifa'), alcance: val('sl-alcance').split(/\r?\n/).map(s => s.trim()).filter(Boolean), beneficios: val('sl-ben'), beneficiosRef: val('sl-ben-ref') };
    },
    /** Versión de supuestos que respalda ESTA oferta: la guardada si los valores coinciden; si se ajustaron, se declara «modificado». */
    versionUsada() {
      const c = this.cfg; if (!c || !c.version) return null; const v = this.valoresPantalla(), g = c.valores || {};
      const igual = CAMPOS_VERSIONADOS.every(k => String(v[k] ?? '').trim() === String(g[k] ?? '').trim());
      return igual ? { version: c.version, fecha: c.fecha } : { version: c.version, fecha: c.fecha, modificado: true };
    },
    cargarConfig() {
      const raw = this.configGuardada(); this.cfg = raw && raw.version ? raw : null; const est = $('sl-cfg-estado');
      if (!this.cfg) { if (est) { est.className = 'wz-solar-estado'; est.textContent = 'Aún no hay valores estándar guardados'; } return; }
      const g = this.cfg.valores || {}, sx = (id, v) => { const e = $(id); if (e && !e.value && v != null && v !== '') e.value = v; };
      sx('sl-cr-precio', g.crPrecio); sx('sl-cr-mec', g.crMec); sx('sl-cr-esc', g.crEsc); sx('sl-ad-precio', g.adPrecio); sx('sl-ad-mec', g.adMec); sx('sl-ad-esc', g.adEsc);
      sx('sl-opex', g.opex); sx('sl-esc', g.esc); sx('sl-hor', g.horizonte); sx('sl-tasa', g.tasa); sx('sl-fsup', g.fuenteSupuestos); sx('sl-alcance', (g.alcance || []).join('\n')); sx('sl-ben', g.beneficios); sx('sl-ben-ref', g.beneficiosRef); sx('sl-ftarifa', g.ftarifa);
      if (est) { est.className = 'wz-solar-estado ok'; est.textContent = 'Valores estándar cargados (versión ' + this.cfg.version + ', ' + this.cfg.fecha + ')'; }
    },
    pintarVersion() {
      const i = $('sl-ver-info'); if (!i) return; const v = this.versionUsada();
      if (!this.cfg) { i.className = 'wz-solar-estado'; i.textContent = 'Supuestos sin versión registrada: la oferta dirá que se definieron en ella. Guárdelos como valores estándar para versionarlos.'; return; }
      i.className = 'wz-solar-estado' + (v && !v.modificado ? ' ok' : ''); i.textContent = v && !v.modificado ? 'Esta oferta usa los supuestos NODIA versión ' + v.version + ' (' + v.fecha + ').' : 'Valores ajustados respecto de la versión ' + this.cfg.version + ' (' + this.cfg.fecha + '): la oferta lo declara.';
    },
    async guardarConfig() {
      const v = this.valoresPantalla(); const algo = Object.values(v).some(x => Array.isArray(x) ? x.length : String(x).trim());
      if (!algo) { UI.toast('No hay valores para guardar', 'warn'); return; }
      const previa = this.cfg; if (previa && !UI.confirmar('Se guardará la versión ' + (previa.version + 1) + ' de los valores estándar y la versión ' + previa.version + ' quedará en el historial. ¿Continuar?')) return;
      const hoy = new Date().toLocaleDateString('es-CO'), hist = previa ? [{ version: previa.version, fecha: previa.fecha, valores: previa.valores }].concat(previa.historial || []).slice(0, 20) : [];
      const nuevo = { version: previa ? previa.version + 1 : 1, fecha: hoy, valores: v, historial: hist };
      try {
        const r = await API.call('guardarPaquete', { nombre: CONFIG_NOMBRE, tipo: CONFIG_TIPO, dataJson: JSON.stringify(nuevo) });
        if (!r || r.exito === false) { UI.toast((r && r.error) || 'No se pudo guardar', 'err'); return; }
        OFERTAS.DB.kits = (OFERTAS.DB.kits || []).filter(k => !(String(k.TIPO).toUpperCase() === CONFIG_TIPO && String(k.NOMBRE) === CONFIG_NOMBRE)); OFERTAS.DB.kits.push(r.data); if (typeof DatosERP !== 'undefined') DatosERP.invalidar();
        this.cfg = nuevo; UI.toast('Valores estándar guardados: versión ' + nuevo.version, 'ok'); this.cargarConfig(); this.actualizar(true);
      } catch (e) { UI.toast(e.message, 'err'); }
    },

    // ───────────── Ubicación y dimensionamiento ─────────────
    pintarUbicacion() {
      const i = $('sl-ubic-info'), d = $('sl-dim-info'), p = this.PV; if (!i) return;
      if (!p || !p.simulacion || p.simulacion.latitud == null) { i.innerHTML = ''; } else {
        const la = pnum(val('sl-ulat')), lo = pnum(val('sl-ulon')), s = p.simulacion;
        const base = `Punto simulado en el informe: <b>${esc(s.lugar)}</b> (${fmt(s.latitud, 4)}°, ${fmt(s.longitud, 4)}°; ${esc(s.datosMeteorologicos)}).`;
        if (la !== null && lo !== null) { const dk = km(s.latitud, s.longitud, la, lo); i.innerHTML = `<div class="${dk <= UMBRAL_KM ? 'sl-ok' : 'sl-warn'}">${base} Distancia a la ubicación real: <b>${fmt(dk, 1)} km</b> ${dk <= UMBRAL_KM ? '(coherente: dentro de ' + UMBRAL_KM + ' km).' : '(supera ' + UMBRAL_KM + ' km: documente la justificación o repita la simulación en el sitio).'}</div>`; }
        else i.innerHTML = `<div class="sl-warn">${base} <b>Ubicación no verificada:</b> sin las coordenadas reales del proyecto no se puede comparar. El informe original no se modifica.</div>`;
      }
      if (d) { const c = this._cons, g = p ? sum(p.gen) : null; if (c && c.conTodos && g) { const k = sum(c.c), r = g / k; d.innerHTML = `<div class="${r > UMBRAL_DIMENSION ? 'sl-warn' : 'sl-ok'}">Generación ${fmt(g)} kWh/año frente a un consumo de ${fmt(k)} kWh/año: <b>${fmt(r * 100)} %</b>${r > UMBRAL_DIMENSION ? ' — desproporcionada (aviso interno, no va al cliente)' : ''}.</div>`; } else d.innerHTML = ''; }
    },

    // ───────────── Avisos y revisión ─────────────
    /** Determinación tributaria por concepto: se evalúa aunque todavía no se haya cargado el informe PVsyst. */
    problemasTrib() {
      const r = [], add = (nivel, texto, bloquea) => r.push({ nivel, texto, bloquea: !!bloquea });
      TRIB.sinDefinir().forEach(n => add('error', 'Defina el tratamiento de IVA de la partida ' + n + ': ningún concepto se grava ni se excluye por defecto.', true));
      if (!chk('sl-trib-ok')) add('error', 'Confirme la determinación tributaria de cada concepto (punto 6).', true);
      { const exs = TRIB.excluidas();
        if (exs.length) {
          if (!val('sl-cert-num').trim() || !val('sl-cert-fecha')) add('error', 'Hay partidas excluidas de IVA: indique el número y la fecha de expedición de la certificación UPME (punto 6).', true);
          if (!TRIB.alcance().length) add('error', 'Indique los bienes y servicios del alcance de la certificación UPME (punto 6).', true);
          exs.forEach(x => { if (x.tr.dataset.cobertura === undefined || x.tr.dataset.cobertura === '') add('error', 'La partida ' + x.n + ' (excluida de IVA) debe asociarse a un bien o servicio del alcance de la certificación UPME.', true); });
          add('aviso', 'La exclusión de IVA no se comprueba ante la UPME desde esta aplicación: confirme el certificado y su alcance con la UPME y con su contador.');
        } }
      return r;
    },
    problemas() {
      this.sincronizarUbicacion();
      const r = [], add = (nivel, texto, bloquea, paso) => r.push({ nivel, texto, bloquea: !!bloquea, paso }); const p = this.PV, c = this._cons || { c: this.consumo(), conTodos: false, conAlguno: false };
      // Etapa 1: la sede beneficiaria se identifica por el título del servicio y la ubicación del trabajo (se imprimen en la portada).
      if (!val('of-nd-titulo').trim()) add('error', 'Escriba el título del servicio: identifica la sede beneficiaria (por ejemplo, el nombre del colegio) y se imprime bajo «Oferta técnico-económica».', true, 1);
      if (!val('of-nd-ubicacion').trim()) add('error', 'Indique la ubicación del trabajo (dirección y municipio de la sede beneficiaria).', true, 1);
      const malos = this.consumoInvalido(); if (malos.length) add('error', 'El consumo de ' + malos.join(', ') + ' no es un número válido: use solo cifras en kWh, un solo número por casilla y sin letras.', true);
      { const cl = this.problemasClon(); cl.forEach(x => r.push(x)); }
      if (!p) { add('error', 'Cargue y confirme el informe de simulación PVsyst (punto 1).', true); return r.concat(this.problemasTrib()); }
      { const sx = p.sistema || {}, mo = sx.modulos || {}, iv = sx.inversores || {};   // DATOS ESENCIALES: nunca se emite con el sistema incompleto
        if (!(mo.cantidad > 0 && mo.potenciaWp > 0)) add('error', 'Faltan la cantidad y la potencia de los módulos (dato esencial del informe PVsyst). Cargue un informe que los incluya.', true);
        if (!(iv.cantidad > 0 && iv.potenciaKwac > 0)) add('error', 'Faltan la cantidad y la potencia de los inversores (dato esencial del informe PVsyst). Cargue un informe que los incluya.', true);
        if (!Array.isArray(p.gen) || p.gen.length !== 12) add('error', 'Falta la generación mensual del informe PVsyst (dato esencial).', true);
        if (!p.simulacion || !p.simulacion.archivoSha256) add('error', 'El informe PVsyst no quedó identificado por su huella: vuelva a cargarlo.', true); }
      if (c.conAlguno && !c.conTodos) add('aviso', 'Consumo incompleto: faltan meses. Complételos o use «Completar meses vacíos con el promedio»; sin los 12 meses no se calcula la cobertura ni se separan créditos y excedentes adicionales.');
      if (!c.conAlguno) add('aviso', 'No se digitó el consumo del cliente: la oferta no mostrará la cobertura ni comparará con el consumo.');
      if (c.conAlguno && !val('sl-fcons').trim()) add('error', 'Falta la fuente de los meses de consumo documentados (por ejemplo, la factura del cliente).', true);
      if (c.conTodos && M.every((_, i) => this.esEstimado(i))) add('error', 'Ningún mes de consumo está documentado: el consumo no puede ser enteramente estimado.', true);
      if (c.conTodos && p.eUser) { const dif = M.filter((_, i) => Math.abs(c.c[i] - p.eUser[i]) > 1); if (dif.length) add('aviso', 'El consumo digitado difiere del perfil de carga de la simulación PVsyst en: ' + dif.join(', ') + '. El autoconsumo del informe corresponde a ese perfil.'); }
      const tar = pnum(val('sl-tarifa')); if (tar === null) add('aviso', 'Falta la tarifa de energía: sin ella no se calcula el ahorro.'); else if (!val('sl-ftarifa').trim()) add('error', 'Falta la fuente de la tarifa (por ejemplo, la factura del cliente).', true);
      const e = (WIZ.solar || {}).energia || {};
      if (p.cargaTipo === 'ILIMITADA' && !e.autoconsumoMensualKWh) add('aviso', 'Simulación con CARGA ILIMITADA: no hay autoconsumo ni excedentes del cliente. La oferta saldrá sin ahorro ni recuperación de la inversión. Repita la simulación con las «Necesidades del usuario».');
      else if (!e.autoconsumoMensualKWh) add('aviso', 'Sin autoconsumo y excedentes la oferta saldrá sin ahorro ni recuperación de la inversión.');
      if (e.exploratorio) add('aviso', 'Balance mensual EXPLORATORIO: se imprime en una sección separada y NO alimenta ningún indicador económico; ninguna validación escrita lo habilita. Solo una simulación con la carga del usuario definida, de un informe identificado y con el perfil de carga igual al consumo, puede respaldar el ahorro y la recuperación.');
      if (e.autoconsumoMensualKWh) {   // criterio verificable de los datos energéticos que alimentan finanzas (el servidor lo vuelve a comprobar)
        const sm = p.simulacion || {}, pc = e.perfilCarga && e.perfilCarga.consumoMensualKWh, falta = [];
        if (!sm.huellaDatos) falta.push('huella de los datos'); if (!Array.isArray(pc)) falta.push('perfil de carga mensual de la simulación'); else if (c.conTodos && c.c.some((v, i) => Math.abs(v - pc[i]) > 1)) falta.push('consumo igual al perfil de carga simulado');
        if (falta.length) add('aviso', 'Los datos energéticos no cumplen el criterio de validación para alimentar indicadores económicos (' + falta.join('; ') + '): ahorro y recuperación quedarán bloqueados.');
      }
      if (e.excedentesMensualKWh && !chk('sl-exc-no')) {
        const ex = (WIZ.solar || {}).excedentes, rep = this._rep;
        if (rep && !(ex && ex.valoracion)) add('aviso', 'Créditos de energía y excedentes adicionales sin valorar (falta precio o mecanismo): el ahorro y la recuperación quedan bloqueados.');
        else if (rep && ex && ex.valoracion) { const faltaEsc = ex.valoracion.filter(l => l.escalacionAnualPct === undefined); if (faltaEsc.length) add('aviso', 'Falta la variación anual del precio de: ' + faltaEsc.map(l => l.tipo === 'CREDITO_ENERGIA' ? 'créditos de energía' : 'excedentes adicionales').join(' y ') + ' (indicadores bloqueados).'); const dist = (rep.creditos > 0.05 ? 1 : 0) + (rep.adicionales > 0.05 ? 1 : 0); if (ex.valoracion.length < dist) add('aviso', 'Falta valorar una de las dos clases de excedentes (créditos o adicionales): indicadores bloqueados.'); }
      }
      if (chk('sl-exc-no') && !val('sl-exc-motivo').trim()) add('error', 'Indique el motivo de no valorar los excedentes.', true);
      const f = ['sl-opex', 'sl-esc', 'sl-deg', 'sl-hor'].filter(id => pnum(val(id)) === null); if (e.autoconsumoMensualKWh && tar !== null && f.length) add('aviso', 'Faltan supuestos financieros (O&M, variación de la tarifa, degradación u horizonte): no se calculará la recuperación de la inversión.');
      if (e.autoconsumoMensualKWh && tar !== null && !val('sl-fsup').trim()) add('error', 'Falta la fuente de los supuestos financieros.', true);
      if (c.conTodos) { const g = sum(p.gen), k = sum(c.c), just = val('sl-just').trim(); if (k > 0 && g > UMBRAL_DIMENSION * k) add(just ? 'info' : 'aviso', 'Aviso interno (no va al cliente): el sistema genera ' + fmt(g) + ' kWh/año y el cliente consume ' + fmt(k) + ' kWh/año (' + fmt(g / k * 100) + ' %).' + (just ? ' Justificación registrada: «' + just + '».' : ' Confirme el dimensionamiento y documente la justificación en el punto 5.')); }
      if (c.conTodos && p.auto) { const mal = p.auto.map((a, i) => a > c.c[i] + 0.5 ? M[i] : null).filter(Boolean); if (mal.length) add('error', 'El autoconsumo del informe supera el consumo digitado en: ' + mal.join(', ') + '. Revise el consumo.', true); }
      const s = p.simulacion || {}, la = pnum(val('sl-ulat')), lo = pnum(val('sl-ulon'));
      if (!val('sl-ubic').trim() && la === null) add('aviso', 'No se indicó la ubicación real del proyecto: no se verificó su coherencia con el punto simulado (' + (s.lugar || 'informe') + ').');
      else if (la === null || lo === null) add('aviso', 'Ubicación no verificada: falta la latitud y la longitud reales para compararlas con el punto simulado.');
      else if (s.latitud != null) { const dk = km(s.latitud, s.longitud, la, lo); if (dk > UMBRAL_KM) add(val('sl-ujust').trim() ? 'info' : 'error', 'El punto simulado está a ' + fmt(dk, 1) + ' km de la ubicación real (umbral ' + UMBRAL_KM + ' km).' + (val('sl-ujust').trim() ? ' Diferencia documentada: «' + val('sl-ujust').trim() + '».' : ' Documente la justificación o repita la simulación en el sitio.'), !val('sl-ujust').trim()); }
      return r.concat(this.problemasTrib());
    },
    pintarAvisos() {
      const c = $('sl-avisos'); if (!c) return; const r = this.problemas();
      c.innerHTML = r.length ? '<ul>' + r.map(x => `<li class="${x.nivel}">${esc(x.texto)}</li>`).join('') + '</ul>' : '<div class="sl-ok">✔ Datos solares completos para generar la oferta.</div>';
    },
    // ───────────── Clonación SEGURA: los datos de un proyecto no pasan a otro ─────────────
    clonDe: null,   // { id, cliente, ubicacion, titulo, mantener, revisado } — se conserva en borradores
    clienteActual() { try { const o = JSON.parse($('of-cli-select').value); return String(o.EMPRESA_NOMBRE || o.EMPRESA || '').trim(); } catch (e) { return ''; } },
    normTxt(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); },
    problemasClon() {
      const c = this.clonDe, r = []; if (!c) return r;
      if (c.mantener) {
        const mismoCli = this.normTxt(this.clienteActual()) === this.normTxt(c.cliente), mismaSede = this.normTxt(val('of-nd-ubicacion')) === this.normTxt(c.ubicacion);
        if (!mismoCli || !mismaSede) r.push({ nivel: 'error', bloquea: true, paso: 1, texto: 'Cambió ' + (!mismoCli && !mismaSede ? 'el cliente y la sede' : !mismoCli ? 'el cliente' : 'la sede') + ' respecto de la oferta ' + c.id + ': los datos energéticos (informe PVsyst, consumos, tarifa) pertenecen a ese proyecto. Vuelva a «' + c.cliente + ' — ' + c.ubicacion + '» o empiece de nuevo («Oferta en blanco» o clone otra vez eligiendo «otro proyecto»).' });
      } else if (!c.revisado) r.push({ nivel: 'error', bloquea: true, texto: 'Esta oferta se copió de la ' + c.id + ' (otro proyecto): revise las partidas, actividades, entregables y condiciones copiados y marque la casilla de revisión (arriba, en los datos solares).' });
      return r;
    },
    pintarClon() {
      const b = $('sl-clon'); if (!b) return; const c = this.clonDe;
      if (!c) { b.style.display = 'none'; b.innerHTML = ''; return; }
      b.style.display = '';
      b.innerHTML = c.mantener ? '<b>Nueva versión del MISMO proyecto</b> (copiada de ' + esc(c.id) + '): se conservaron el informe PVsyst, los consumos y la tarifa porque usted confirmó que cliente y sede son los mismos. Si cambia el cliente o la sede, la oferta se bloquea hasta cargar los datos de nuevo. La fecha de emisión es siempre la del momento de emitir.'
        : '<b>Copiada de ' + esc(c.id) + ' para OTRO proyecto.</b> NO se copiaron: el informe PVsyst y su huella, la configuración energética, los consumos, la tarifa, la ubicación, el título ni el objeto. Cargue los de este proyecto. <label class="sl-chk" style="margin-top:6px"><input type="checkbox" id="sl-clon-rev" ' + (c.revisado ? 'checked' : '') + ' onchange="SOLAR.clonRevisado(this.checked)"> <b>Revisé las partidas, actividades, entregables y condiciones copiados:</b> corresponden a este proyecto.</label>';
    },
    clonRevisado(v) { if (this.clonDe) { this.clonDe.revisado = !!v; this.pintarAvisos(); WIZ.alCambiar(); } },
    /** Se llama al clonar una oferta: por omisión LIMPIA todo lo que es del proyecto original; conservarlo es una excepción confirmada. */
    alClonar(h) {
      let data; try { data = JSON.parse(h.DATA_JSON); } catch (e) { return; }
      const n = data && data.nodia; this.clonDe = null; this._clonDatos = null;
      if (!n || !(n.servicio === 'SOLAR' || n.solar)) { this.pintarClon(); return; }
      const o = { id: String(data.consecutivo || ''), cliente: String((data.cliente || {}).EMPRESA_NOMBRE || (data.cliente || {}).EMPRESA || ''), ubicacion: String(n.ubicacion || ''), titulo: String(n.tituloServicio || '') };
      this._clonDatos = data;
      this.limpiarParaOtroProyecto(); this.clonDe = { id: o.id, cliente: o.cliente, ubicacion: o.ubicacion, titulo: o.titulo, mantener: false, revisado: false };
      this.pintarClon(); this.pintarAvisos();
      WIZ.modal('Oferta solar copiada', '<div class="wz-nota"><b>Los datos energéticos y de ubicación son de UN proyecto.</b> La oferta <b>' + esc(o.id) + '</b> es de «' + esc(o.titulo || 'sin título') + '» (' + esc(o.cliente) + ', ' + esc(o.ubicacion || 'sin ubicación') + '). Por seguridad se dejaron VACÍOS: informe PVsyst y su huella, configuración energética, consumos, tarifa, ubicación, título, objeto y fecha de emisión (la fecha siempre se fija al emitir).</div>' +
        '<div class="wz-botones"><button type="button" class="wz-btn pri" onclick="WIZ.cerrarModal()">Es otro proyecto: continuar con esos datos vacíos (recomendado)</button></div>' +
        '<hr><div class="wz-nota">Solo si esta oferta es una <b>nueva versión del MISMO proyecto y la MISMA sede</b>:</div>' +
        '<label class="sl-chk"><input type="checkbox" id="sl-clon-mismo-chk" onchange="document.getElementById(\'sl-clon-mismo\').disabled=!this.checked"> Confirmo que el cliente («' + esc(o.cliente) + '»), la sede («' + esc(o.ubicacion) + '») y los datos energéticos son los mismos.</label>' +
        '<div class="wz-botones"><button type="button" id="sl-clon-mismo" class="wz-btn ghost" disabled onclick="SOLAR.clonMismo()">Conservar los datos del proyecto</button></div>', '640px');
    },
    limpiarParaOtroProyecto() {
      WIZ.limpiarSolar();   // informe PVsyst, huella, energía, consumos, tarifa, supuestos, tributario y componentes
      ['of-nd-titulo', 'of-nd-ubicacion', 'of-objeto'].forEach(id => { const e = $(id); if (e) e.value = ''; });
      this.sincronizarUbicacion(); WIZ.alCambiar();
    },
    clonMismo() {
      const o = this.clonDe, data = this._clonDatos, k = $('sl-clon-mismo-chk'); if (!o || !data || !k || !k.checked) return;
      OFERTAS.rellenarFormulario(data);   // vuelve a poner TODO lo del proyecto original (el consecutivo ya es nuevo)
      this.clonDe = o; o.mantener = true; o.revisado = true; WIZ.cerrarModal(); this.pintarClon(); this.pintarAvisos(); WIZ.alCambiar();
      UI.toast('Se conservaron los datos del proyecto. Si cambia el cliente o la sede, la oferta se bloquea.', 'warn');
    },

    revisiones() { return this.problemas().filter(x => x.bloquea || x.nivel === 'aviso').map(x => ({ paso: x.paso || 2, nivel: x.nivel === 'error' ? 'error' : 'aviso', texto: x.texto, bloquea: x.bloquea })); }
  };
  window.SOLAR = SOLAR;


  // ───────────── IVA: ningún concepto se grava por defecto (clase FV) ─────────────
  const TRIB = {
    filas() { return [...document.querySelectorAll('#of-tbody-items tr')]; },
    /** Deja la partida SIN determinar (el IVA 19 % que traen las filas nuevas es solo el valor de arranque de la pantalla, no una determinación). */
    blanquear(tr) {
      const sel = tr && tr.querySelector('.inp-iva'); if (!sel || sel.dataset.determinado === '1') return;
      if (!sel.querySelector('option[value=""]')) { const o = document.createElement('option'); o.value = ''; o.textContent = '— Definir —'; sel.insertBefore(o, sel.firstChild); }
      sel.value = ''; sel.dataset.sindefinir = '1';
    },
    blanquearTodas() { if (WIZ.clase() === 'FV') this.filas().forEach(tr => { const s = tr.querySelector('.inp-iva'); if (s && s.dataset.determinado !== '1') this.blanquear(tr); }); },
    sinDefinir() { return WIZ.clase() === 'FV' ? this.filas().map((tr, i) => ({ tr, n: i + 1, v: (tr.querySelector('.inp-iva') || {}).value })).filter(x => x.v === '').map(x => x.n) : []; },
    excluidas() { return this.filas().map((tr, i) => ({ tr, n: i + 1, v: (tr.querySelector('.inp-iva') || {}).value })).filter(x => x.v === 'EXCLUIDO'); },
    alcance() { return val('sl-cert-alcance').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => { const p = s.split('|'); return { descripcion: p[0].trim(), valorSinIvaCOP: p[1] !== undefined && pnum(p[1]) !== null ? pnum(p[1]) : undefined }; }); }
  };
  SOLAR.TRIB = TRIB;
  if (typeof OFERTAS.addFila === 'function') {
    const af0 = OFERTAS.addFila;
    OFERTAS.addFila = function (datos) { const r = af0.apply(this, arguments); if (WIZ.clase() !== 'FV') return r; if (!(datos && datos.iva)) { const trs = TRIB.filas(), tr = trs[trs.length - 1]; if (tr) TRIB.blanquear(tr); } else { const s = TRIB.filas().slice(-1)[0] && TRIB.filas().slice(-1)[0].querySelector('.inp-iva'); if (s) s.dataset.determinado = '1'; } return r; };
  }
  document.addEventListener('change', e => { const t = e.target; if (t && t.classList && t.classList.contains('inp-iva')) { t.dataset.determinado = t.value === '' ? '' : '1'; if (SOLAR.montado) SOLAR.actualizar(true); } });
  if (typeof OFERTAS_NODIA !== 'undefined') {
    const rc0 = OFERTAS_NODIA.recolectar; OFERTAS_NODIA.recolectar = function (datos) { const r = rc0.apply(this, arguments); if (WIZ.clase() === 'FV' && datos && datos.items) { TRIB.filas().forEach((tr, i) => { const s = tr.querySelector('.inp-iva'); if (s && s.value === '' && datos.items[i]) { delete datos.items[i].tratamiento; delete datos.items[i].tarifaIva; } }); } return r; };
    const va0 = OFERTAS_NODIA.validar; OFERTAS_NODIA.validar = function () { const e = va0.apply(this, arguments) || []; TRIB.sinDefinir().forEach(n => e.push('Defina el tratamiento de IVA de la partida ' + n + ' (gravado, excluido o exento).')); return e; };
    const rs0 = OFERTAS_NODIA.refrescarSoporte; OFERTAS_NODIA.refrescarSoporte = function () {
      const r = rs0.apply(this, arguments); const cont = $('of-nd-soporte'); if (!cont || WIZ.clase() !== 'FV') return r;
      const al = TRIB.alcance(), filas = TRIB.filas();
      cont.querySelectorAll('[data-n]').forEach(blk => {
        const n = Number(blk.dataset.n), tr = filas[n - 1]; if (!tr || (tr.querySelector('.inp-iva') || {}).value !== 'EXCLUIDO' || blk.querySelector('select[data-k="cobertura"]')) return;
        const div = document.createElement('div'); div.className = 'field-group';
        div.innerHTML = '<label>Bien o servicio de la certificación UPME que cubre esta partida</label><select data-k="cobertura"><option value="">— Elegir —</option>' + al.map((a, k) => '<option value="' + k + '"' + (String(tr.dataset.cobertura) === String(k) ? ' selected' : '') + '>' + esc(a.descripcion) + '</option>').join('') + '</select>';
        blk.appendChild(div); div.querySelector('select').addEventListener('change', ev => { tr.dataset.cobertura = ev.target.value; SOLAR.actualizar(true); });
      });
      return r;
    };
  }

  // ───────────── Enganches con el asistente ─────────────
  const leer0 = WIZ.leerSolar; WIZ.leerSolar = function () { const r = leer0.apply(this, arguments); if (!SOLAR._interno) SOLAR.llenarDesde(this.solar); return r; };
  const lim0 = WIZ.limpiarSolar; WIZ.limpiarSolar = function () { SOLAR.PV = null; SOLAR.pend = null; if (SOLAR.montado) { SOLAR.limpiarCampos(); $('sl-pv').innerHTML = ''; const i = $('sl-pdf'); if (i) i.value = ''; const e = $('sl-pdf-estado'); if (e) { e.className = 'wz-solar-estado'; e.textContent = ''; } } return lim0.apply(this, arguments); };
  const rel0 = WIZ.aplicarRelevancia; WIZ.aplicarRelevancia = function () { const r = rel0.apply(this, arguments); const c = $('wz-card-solar'); if (c && c.style.display !== 'none') { SOLAR.montar(); TRIB.blanquearTodas(); } return r; };
  const rev0 = WIZ.revisar; WIZ.revisar = function () { const r = rev0.apply(this, arguments); const nd = this.esNodia && this.esNodia(); if (nd && (this.clase() === 'FV' || this.val('of-nd-servicio') === 'SOLAR') && SOLAR.montado) { const ya = new Set(r.map(x => x.texto)); SOLAR.revisiones().forEach(x => { if (!ya.has(x.texto)) r.push(x); }); } return r; };
  // ───────────── Clonación segura: enganches ─────────────
  { const ch0 = OFERTAS.cargarDesdeHistorial; if (typeof ch0 === 'function') OFERTAS.cargarDesdeHistorial = function (h, esClon) { const r = ch0.apply(this, arguments); if (esClon) { try { SOLAR.alClonar(h); } catch (e) { console.error(e); } } return r; }; }
  { const rf0 = OFERTAS.recuperarFormulario; if (typeof rf0 === 'function') OFERTAS.recuperarFormulario = function () { const d = rf0.apply(this, arguments); if (d && SOLAR.clonDe) d.clonDe = JSON.parse(JSON.stringify(SOLAR.clonDe)); return d; }; }
  { const rs1 = WIZ.restaurar; WIZ.restaurar = function (data) { const r = rs1.apply(this, arguments); SOLAR.clonDe = (data && data.clonDe) || null; SOLAR.pintarClon(); return r; }; }
  { const eb0 = WIZ.enBlanco; if (typeof eb0 === 'function') WIZ.enBlanco = function () { const r = eb0.apply(this, arguments); if (!this.hayContenido()) { SOLAR.clonDe = null; SOLAR._clonDatos = null; SOLAR.pintarClon(); } return r; }; }
  if (document.readyState !== 'loading') { try { WIZ.aplicarRelevancia(); } catch (e) { /* aún no hay formulario */ } }
})();
