/**
 * SENERPOT — ofertas.js v1.0
 * Lógica completa del módulo Ofertas.
 * Adaptado de App 1 (Generador de Ofertas v23.2).
 * Usa API.call() en lugar de google.script.run.
 */

const OFERTAS = {

  DB: { clientes: [], items: [], kits: [], activos: [], historial: [] },

  _chartEmbudo: null,

  // SENERPOT lleva un consecutivo INDEPENDIENTE por tipo de oferta — DIV,
  // INSP, MTTO — y todo lo que no encaje ahí cae en OTROS. No es una
  // columna aparte en la hoja: el tipo se lee directo del prefijo del
  // N° de oferta (DIV-26-005 -> tipo DIV), así que nunca se puede
  // desincronizar de la fuente real de datos.
  TIPOS_OFERTA: ['DIV','INSP','MTTO','OTROS'],
  TIPO_BADGE: { DIV:'badge-blue', INSP:'badge-purple', MTTO:'badge-orange', OTROS:'badge-gray' },

  tipoDeOferta(idOferta) {
    const m = String(idOferta||'').toUpperCase().match(/^([A-Z]+)/);
    const prefijo = m ? m[1] : '';
    return this.TIPOS_OFERTA.includes(prefijo) ? prefijo : 'OTROS';
  },

  // ──────────────────────────────────────────
  //  INICIALIZACIÓN
  // ──────────────────────────────────────────
  async init() {
    this.mostrarFecha();
    this.addActivo();
    this.addAlcance();
    try {
      const data = await DatosERP.obtener();
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
    this.sugerirConsecutivoPorTipo();
    this.renderDashboardOfertas();
  },

  async recargar() {
    try {
      DatosERP.invalidar();
      const data = await DatosERP.obtener();
      this.DB = data;
      this.render();
    } catch(e) { UI.toast('Error recargando datos', 'err'); }
  },

  // ──────────────────────────────────────────
  //  DASHBOARD DE OFERTAS (Fase 4 — 100% in-memory)
  //  Todo se calcula con reduce/filter sobre this.DB.historial, que ya
  //  está en memoria desde el último init()/recargar()/guardado local
  //  (Store.upsert de la Fase 3). Cero llamadas a API.call/fetch aquí:
  //  el costo de esta función es procesar un arreglo que ya tenemos, no
  //  esperar una respuesta de red — de ahí la latencia cero.
  // ──────────────────────────────────────────

  // BD_OFERTAS.TOTAL se guarda como texto formateado ("$ 1.234.567", ver
  // guardarBorrador/generarDocumento), no como número — hay que limpiarlo
  // antes de sumar o el reduce da NaN/basura.
  parseTotalOferta(str) {
    return parseFloat(String(str || '0').replace(/[^0-9]/g, '')) || 0;
  },

  // Semántica revisada (Fase 4.1): BORRADOR es trabajo a medias que nunca
  // se le mostró al cliente — no cuenta como actividad comercial, se
  // excluye del dashboard por completo. GENERADA es la única etapa
  // "abierta" real (se presentó, el cliente no ha decidido). APROBADA y
  // RECHAZADA son los dos desenlaces posibles, registrados por el botón
  // de decisión en el historial.
  //
  // Pipeline vs. Forecast (Fase 4.2): son cosas distintas y las pidieron
  // las dos. Pipeline abierto es la suma cruda de lo pendiente, sin
  // ajustar por probabilidad. Forecast es esa misma suma ponderada por la
  // TASA DE CONVERSIÓN REAL del historial (aprobadas ÷ decididas) — ya no
  // es un porcentaje inventado como en la primera versión de este
  // dashboard: es el desempeño real medido de este mismo cliente/negocio.
  // Sin decisiones todavía (aprobadas + rechazadas === 0) no hay con qué
  // calcular una tasa real, así que se asume 50% como punto de partida
  // neutral y se avisa en el título de la tarjeta.
  renderDashboardOfertas() {
    const hist = this.DB.historial || [];

    const oportunidades = hist.filter(h => h.ESTADO === 'GENERADA');
    const aprobadas     = hist.filter(h => h.ESTADO === 'APROBADA');
    const rechazadas    = hist.filter(h => h.ESTADO === 'RECHAZADA');

    const pipelineAbierto = oportunidades.reduce((sum, h) => sum + this.parseTotalOferta(h.TOTAL), 0);
    const valorGanado     = aprobadas.reduce((sum, h) => sum + this.parseTotalOferta(h.TOTAL), 0);

    const decididas = aprobadas.length + rechazadas.length;
    const tasaConversion = decididas > 0 ? aprobadas.length / decididas : 0.5;
    const forecast = pipelineAbierto * tasaConversion;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('of-dash-oportunidades', oportunidades.length);
    set('of-dash-aprobadas',     aprobadas.length);
    set('of-dash-pipeline',      UI.moneda(pipelineAbierto));
    set('of-dash-ganado',        UI.moneda(valorGanado));
    set('of-dash-forecast',      UI.moneda(forecast));

    const labelForecast = document.querySelector('#of-dash-forecast')?.closest('.kpi-card')?.querySelector('.kpi-label');
    if (labelForecast) {
      labelForecast.textContent = decididas > 0
        ? `Forecast (${Math.round(tasaConversion * 100)}% conversión real)`
        : 'Forecast (50% — sin histórico aún)';
    }

    this.renderChartEmbudo(oportunidades.length, aprobadas.length, rechazadas.length);
  },

  // Embudo de ventas con Chart.js (misma librería que PANEL, sin plugins
  // adicionales) — barras horizontales muestran las 3 etapas reales.
  renderChartEmbudo(nOportunidades, nAprobadas, nRechazadas) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('of-dash-chart');
    if (!ctx) return;

    if (this._chartEmbudo) { try { this._chartEmbudo.destroy(); } catch(e) {} }

    this._chartEmbudo = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Oportunidades (pendientes)', 'Aprobadas', 'Rechazadas'],
        datasets: [{
          label: 'Ofertas', data: [nOportunidades, nAprobadas, nRechazadas],
          backgroundColor: ['#3B82F6', '#009E60', '#D32F2F'], borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0, color: '#94A3B8' }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#64748B' } }
        }
      }
    });
  },

  // ──────────────────────────────────────────
  //  DECISIÓN DEL CLIENTE (Aprobar / Rechazar)
  // ──────────────────────────────────────────
  async actualizarEstadoOfertaUI(id, nuevoEstado, btn) {
    if (this._actualizandoEstadoOferta) return;
    const verbo = nuevoEstado === 'APROBADA' ? 'aprobar' : 'rechazar';
    if (!UI.confirmar(`¿Marcar la oferta ${id} como ${verbo === 'aprobar' ? 'APROBADA' : 'RECHAZADA'}?`)) return;
    if (this._actualizandoEstadoOferta) return;
    this._actualizandoEstadoOferta = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const res = await API.call('actualizarEstadoOferta', { id, estado: nuevoEstado });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      DatosERP.invalidar(); // que Panel/Proyectos no se queden con el pipeline/forecast viejo
      Store.upsert(this.DB.historial, res.data);
      this.renderTablaHistorial();
      this.renderDashboardOfertas();
      UI.toast('Oferta ' + id + ' marcada como ' + nuevoEstado.toLowerCase(), 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._actualizandoEstadoOferta = false; if (btn) UI.spinIcon(btn, false); }
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
          <button class="btn-icon btn-icon-edit" onclick='OFERTAS.editarClienteUI(${JSON.stringify(c).replace(/'/g,"&#39;")})' title="Editar">✏️ Editar</button>
          <button class="btn-icon btn-icon-del"  onclick='OFERTAS.eliminarClienteUI(${JSON.stringify(c).replace(/'/g,"&#39;")},this)' title="Eliminar">🗑️ Eliminar</button>
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
          <button class="btn-icon btn-icon-edit" onclick='OFERTAS.editarServicioUI(${JSON.stringify(i).replace(/'/g,"&#39;")})' title="Editar">✏️ Editar</button>
          <button class="btn-icon btn-icon-del"  onclick='OFERTAS.eliminarServicioUI(${JSON.stringify(i).replace(/'/g,"&#39;")},this)' title="Eliminar">🗑️ Eliminar</button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  // Número final del consecutivo (DIV-26-005 -> 5) — null si el ID no
  // termina en dígitos (p.ej. los sufijos "B" que se usan para marcar un
  // número duplicado histórico, ver agregarOfertasLote en Oferta.gs).
  numeroDeOferta(idOferta) {
    const m = String(idOferta||'').match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  },

  renderTablaHistorial() {
    const tbody = document.getElementById('of-tbody-hist');
    tbody.innerHTML = '';
    const filtroTipo = document.getElementById('of-filtro-tipo')?.value || '';
    const badgeClass = { BORRADOR: 'badge-gray', GENERADA: 'badge-blue', APROBADA: 'badge-green', RECHAZADA: 'badge-red', ERROR_GENERACION: 'badge-red' };

    // Agrupadas por tipo y ordenadas por número de consecutivo (no por
    // fecha de creación) — así, dentro de cada serie (DIV/INSP/MTTO/
    // OTROS), un hueco en la numeración salta a la vista en vez de
    // quedar perdido entre ofertas de otras series.
    const porTipo = {};
    (this.DB.historial || []).forEach(h => {
      const t = this.tipoDeOferta(h.ID_OFERTA);
      (porTipo[t] = porTipo[t] || []).push(h);
    });

    const tiposAMostrar = filtroTipo ? [filtroTipo] : this.TIPOS_OFERTA;
    let huboFilas = false;

    tiposAMostrar.forEach(tipo => {
      const lista = (porTipo[tipo] || []).slice().sort((a,b) => {
        const na = this.numeroDeOferta(a.ID_OFERTA), nb = this.numeroDeOferta(b.ID_OFERTA);
        return (na === null ? Infinity : na) - (nb === null ? Infinity : nb);
      });
      if (!lista.length) return;
      huboFilas = true;

      const trHeader = document.createElement('tr');
      trHeader.innerHTML = `<td colspan="7" style="background:#F1F5F9;font-weight:700;font-size:11px;text-transform:uppercase;color:#64748B;padding:6px 10px;">
        <span class="badge ${this.TIPO_BADGE[tipo]}" style="font-size:10px;">${tipo}</span> — ${lista.length} oferta${lista.length===1?'':'s'}
      </td>`;
      tbody.appendChild(trHeader);

      let anterior = null;
      lista.forEach(h => {
        const numActual = this.numeroDeOferta(h.ID_OFERTA);
        // Salto en la numeración dentro de esta serie — exactamente lo
        // que se pidió: ver de un vistazo si "se voló" un consecutivo.
        // Tope de 1000: algunas ofertas viejas (categoría OTROS) tienen
        // IDs tipo "OF-1771364127214" (timestamp, no un consecutivo real)
        // — sin este tope, la diferencia entre esos números generaría un
        // aviso de "faltan miles de números" sin ningún sentido.
        if (anterior !== null && numActual !== null && numActual - anterior > 1 && numActual - anterior <= 1000) {
          const faltantes = [];
          for (let n = anterior + 1; n < numActual; n++) faltantes.push(String(n).padStart(3,'0'));
          const trGap = document.createElement('tr');
          trGap.innerHTML = `<td colspan="7" style="background:#FEF3C7;color:#92400E;font-size:11.5px;padding:5px 10px;">
            ⚠️ Falta${faltantes.length===1?'':'n'} el número${faltantes.length===1?'':'s'} ${faltantes.join(', ')} en ${tipo} (salta de #${String(anterior).padStart(3,'0')} a #${String(numActual).padStart(3,'0')})
          </td>`;
          tbody.appendChild(trGap);
        }
        if (numActual !== null) anterior = numActual;

        const tr = document.createElement('tr');
        // Antes: hasta 6 íconos amontonados horizontalmente por fila.
        // Ahora: una sola acción principal en texto ("Editar") + "Más" que
        // abre un menú con el resto (Ver, Clonar, Aprobar/Rechazar, Enviar,
        // Eliminar) también en texto — ver abrirMenuAccionesOferta().
        tr.innerHTML = `
          <td>${h.ID_OFERTA}</td>
          <td><span class="badge ${this.TIPO_BADGE[tipo]}" style="font-size:10px;">${tipo}</span></td>
          <td>${h.FECHA}</td>
          <td>${h.CLIENTE}</td>
          <td>${h.TOTAL}</td>
          <td><span class="badge ${badgeClass[h.ESTADO] || 'badge-gray'}">${h.ESTADO}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn-row-action" onclick="OFERTAS.gestionarOferta('${h.ID_OFERTA}','CARGAR',this)">Editar</button>
            <button class="btn-row-more" onclick="OFERTAS.abrirMenuAccionesOferta('${h.ID_OFERTA}')">⋯ Más</button>
          </td>`;
        tbody.appendChild(tr);
      });
    });

    if (!huboFilas) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">Sin ofertas registradas.</td></tr>';
    }
  },

  // Reemplaza la fila de íconos: junta todas las acciones de una oferta
  // (Ver, Editar, Clonar, Aprobar/Rechazar, Enviar, Eliminar) como botones
  // de texto dentro de un solo modal, en vez de íconos amontonados. Cada
  // opción llama a la misma función de siempre (con sus mismas protecciones
  // contra doble clic) — esto solo cambia CÓMO se dispara, no la lógica.
  abrirMenuAccionesOferta(id) {
    const h = (this.DB.historial || []).find(x => String(x.ID_OFERTA) === String(id));
    if (!h) { UI.toast('Oferta no encontrada', 'err'); return; }

    const titulo = document.getElementById('of-acciones-titulo');
    if (titulo) titulo.textContent = 'Oferta ' + id;

    const acciones = [];
    if (h.URL_DOC) {
      acciones.push({ texto: 'Ver documento', fn: () => window.open(h.URL_DOC, '_blank') });
    } else if (h.TIENE_DATA_JSON || h.DATA_JSON) {
      acciones.push({ texto: 'Ver resumen', fn: () => this.verResumenOferta(id) });
    }
    acciones.push({ texto: 'Editar',  fn: () => this.gestionarOferta(id, 'CARGAR') });
    acciones.push({ texto: 'Clonar',  fn: () => this.gestionarOferta(id, 'CLONAR') });
    if (h.ESTADO === 'GENERADA') {
      acciones.push({ texto: 'Aprobar',  fn: () => this.actualizarEstadoOfertaUI(id, 'APROBADA') });
      acciones.push({ texto: 'Rechazar', fn: () => this.actualizarEstadoOfertaUI(id, 'RECHAZADA') });
    }
    if (h.URL_DOC) {
      acciones.push({ texto: 'Enviar', fn: () => this.abrirModalEnvio(id) });
    }
    acciones.push({ texto: 'Eliminar', fn: () => this.eliminarOfertaUI(id), danger: true });

    const lista = document.getElementById('of-acciones-lista');
    lista.innerHTML = '';
    acciones.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn-accion-menu' + (a.danger ? ' btn-accion-menu-danger' : '');
      btn.textContent = a.texto;
      btn.onclick = () => { this.cerrarModal('of-modal-acciones'); a.fn(); };
      lista.appendChild(btn);
    });
    document.getElementById('of-modal-acciones')?.classList.add('open');
  },

  // ──────────────────────────────────────────
  //  ENVIAR OFERTA (correo / WhatsApp)
  // ──────────────────────────────────────────
  // No hay forma de adjuntar el archivo automáticamente desde un sitio
  // web — ningún navegador lo permite, por seguridad (si un sitio pudiera
  // adjuntar archivos solo con que entres, cualquier página podría
  // "enviar" cosas en tu nombre sin que te dieras cuenta). Lo que SÍ se
  // puede hacer, y es lo que hace esto: abrir el correo/WhatsApp de la
  // persona con el destinatario, asunto y mensaje ya escritos —
  // incluyendo el enlace al documento — para que solo falte revisar y
  // darle enviar. La cuenta desde la que se envía la elige la persona en
  // su propio Outlook/WhatsApp, igual que si lo escribiera a mano.
  abrirModalEnvio(id) {
    const h = (this.DB.historial || []).find(x => String(x.ID_OFERTA) === String(id));
    if (!h || !h.URL_DOC) { UI.toast('Esta oferta no tiene documento generado para enviar', 'warn'); return; }

    const clienteInfo = (this.DB.clientes || []).find(c => (c.EMPRESA_NOMBRE || c.EMPRESA) === h.CLIENTE);
    this._envioActual   = { id, urlDoc: h.URL_DOC, cliente: h.CLIENTE || 'estimado cliente' };
    this._envioTelefono = clienteInfo?.TELEFONO || '';

    document.getElementById('of-envio-medio').value = 'EMAIL';
    document.getElementById('of-envio-destino').value = clienteInfo?.EMAIL || '';
    this.cambiarMedioEnvio();
    document.getElementById('of-modal-envio')?.classList.add('open');
  },

  cambiarMedioEnvio() {
    const esEmail = document.getElementById('of-envio-medio').value === 'EMAIL';
    const wrapAsunto = document.getElementById('of-envio-asunto-wrap');
    if (wrapAsunto) wrapAsunto.style.display = esEmail ? '' : 'none';
    document.getElementById('of-envio-destino-label').textContent = esEmail
      ? 'Correo del destinatario' : 'WhatsApp del destinatario (con indicativo, ej: 573001234567)';

    const destinoInput = document.getElementById('of-envio-destino');
    if (!esEmail && !destinoInput.value) destinoInput.value = this._envioTelefono || '';

    const cliente = this._envioActual?.cliente || 'estimado cliente';
    const urlDoc  = this._envioActual?.urlDoc || '';
    const idOf    = this._envioActual?.id || '';
    document.getElementById('of-envio-asunto').value = 'Oferta comercial SENERPOT — ' + idOf;
    document.getElementById('of-envio-mensaje').value = esEmail
      ? `Estimados ${cliente},\n\nNos permitimos enviar la siguiente oferta comercial para su consideración:\n\n${urlDoc}\n\nQuedamos atentos a cualquier duda o comentario al respecto.\n\nCordialmente,\nSENERPOT S.A.S.\nServicios de Energía y Potencia`
      : `¡Hola! Desde SENERPOT nos permitimos enviarle la siguiente oferta comercial para su consideración:\n\n${urlDoc}\n\nQuedamos atentos a cualquier duda o comentario. En SENERPOT, siempre es un gusto ponerle energía a sus proyectos. ⚡\n\nSaludos cordiales.`;
  },

  confirmarEnvio() {
    const medio   = document.getElementById('of-envio-medio').value;
    const destino = document.getElementById('of-envio-destino').value.trim();
    const mensaje = document.getElementById('of-envio-mensaje').value;

    if (medio === 'EMAIL') {
      if (!destino) { UI.toast('Ingresa el correo del destinatario', 'warn'); return; }
      const asunto = document.getElementById('of-envio-asunto').value;
      // No navega la página — el navegador reconoce "mailto:" y abre el
      // programa de correo predeterminado (Outlook, si está configurado
      // así en el equipo) con todo ya escrito.
      window.location.href = 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(mensaje);
    } else {
      const soloNumeros = destino.replace(/[^0-9]/g, '');
      const url = soloNumeros
        ? 'https://wa.me/' + soloNumeros + '?text=' + encodeURIComponent(mensaje)
        : 'https://wa.me/?text=' + encodeURIComponent(mensaje);
      window.open(url, '_blank');
    }
    this.cerrarModal('of-modal-envio');
  },

  // DATA_JSON ya no viene en el listado masivo (this.DB.historial) — se
  // sacó para que la caché de servidor quepa bajo el límite de 100KB (ver
  // Datos.gs, obtenerDatosCompletos). Si el registro en memoria ya la
  // trae (oferta recién creada/editada en esta misma sesión), se usa
  // directo; si no (caso normal: se cargó del listado masivo), se pide
  // puntual con obtenerDetalleOferta(). TIENE_DATA_JSON (booleano) es lo
  // que sí viene siempre en el listado, para saber si vale la pena pedir.
  async resolverDataJson(oferta) {
    if (oferta.DATA_JSON) return oferta.DATA_JSON;
    if (!oferta.TIENE_DATA_JSON) { UI.toast('Sin detalle guardado para esta oferta', 'warn'); return null; }
    try {
      const res = await API.call('obtenerDetalleOferta', { idOferta: oferta.ID_OFERTA });
      if (!res.exito) { UI.toast(res.error, 'err'); return null; }
      return res.dataJson;
    } catch(e) { UI.toast(e.message, 'err'); return null; }
  },

  // Resumen de solo lectura para ofertas que no tienen URL_DOC guardado
  // (generadas antes de este cambio) pero sí tienen DATA_JSON — evita
  // mandar a alguien que solo quiere revisar al formulario completo de
  // edición.
  async verResumenOferta(id, btn) {
    if (this._viendoResumenOferta) return;
    const h = (this.DB.historial || []).find(x => String(x.ID_OFERTA) === String(id));
    if (!h) { UI.toast('Oferta no encontrada', 'err'); return; }
    this._viendoResumenOferta = true;
    if (btn) UI.spinIcon(btn, true);
    let dataJson;
    try { dataJson = await this.resolverDataJson(h); }
    finally { this._viendoResumenOferta = false; if (btn) UI.spinIcon(btn, false); }
    if (!dataJson) return;
    let data;
    try { data = JSON.parse(dataJson); } catch(e) { UI.toast('No se pudo leer el detalle de esta oferta', 'err'); return; }

    const cliente = data.cliente?.EMPRESA_NOMBRE || data.cliente?.EMPRESA || h.CLIENTE || '—';
    const items = (data.items || []).map(it => `
      <tr><td>${it.descripcion || ''}</td><td style="text-align:center">${it.cantidad || ''}</td><td style="text-align:right">${UI.moneda(it.unitario||0)}</td><td style="text-align:right">${UI.moneda(it.total||0)}</td></tr>
    `).join('');

    document.getElementById('of-ver-titulo').textContent = 'Oferta ' + h.ID_OFERTA;
    document.getElementById('of-ver-contenido').innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;">
        <div><b>Cliente:</b> ${cliente}</div>
        <div><b>Fecha:</b> ${h.FECHA || '—'}</div>
        ${data.textos?.objeto ? `<div style="margin-top:6px;"><b>Objeto:</b> ${data.textos.objeto}</div>` : ''}
      </div>
      <table class="data-tbl">
        <thead><tr><th>Descripción</th><th style="width:60px">Cant</th><th style="width:100px">Vr. Unit</th><th style="width:100px">Total</th></tr></thead>
        <tbody>${items || '<tr><td colspan="4" style="text-align:center;color:#888">Sin ítems registrados</td></tr>'}</tbody>
      </table>
      <div style="text-align:right;margin-top:10px;font-weight:700;color:var(--primary);font-size:16px;">Total: ${h.TOTAL}</div>
    `;
    document.getElementById('of-modal-ver')?.classList.add('open');
  },

  // Borra un registro de historial por error de escritura/duplicado, para
  // que no siga inflando los conteos del dashboard. Búsqueda por ID en el
  // servidor (no por posición) — ver eliminarOferta en Oferta.gs.
  async eliminarOfertaUI(id, btn) {
    if (this._eliminandoOferta) return;
    if (!UI.confirmar(`¿Eliminar la oferta ${id}? Esta acción no se puede deshacer.`)) return;
    if (this._eliminandoOferta) return;
    this._eliminandoOferta = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const res = await API.call('eliminarOferta', { id });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      DatosERP.invalidar();
      this.DB.historial = this.DB.historial.filter(h => String(h.ID_OFERTA) !== String(id));
      this.renderTablaHistorial();
      this.renderDashboardOfertas();
      UI.toast('Oferta ' + id + ' eliminada', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._eliminandoOferta = false; if (btn) UI.spinIcon(btn, false); }
  },

  // ──────────────────────────────────────────
  //  OFERTA HISTÓRICA MANUAL (hecha fuera del sistema)
  // ──────────────────────────────────────────
  modalOfertaManual() {
    ['of-h-id','of-h-fecha','of-h-cliente','of-h-total'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const estadoSel = document.getElementById('of-h-estado');
    if (estadoSel) estadoSel.value = 'GENERADA';
    // Sugerir clientes ya existentes, pero sin exigir que coincida — una
    // oferta histórica puede ser de un cliente que nunca se registró aquí.
    const dl = document.getElementById('of-dl-hist-cli');
    if (dl) {
      dl.innerHTML = '';
      (this.DB.clientes || []).forEach(c => {
        const o = document.createElement('option');
        o.value = c.EMPRESA_NOMBRE || c.EMPRESA || '';
        dl.appendChild(o);
      });
    }
    document.getElementById('of-modal-hist')?.classList.add('open');
  },

  async guardarOfertaManualForm(btn) {
    if (this._guardandoOfertaManual) return;
    const idOferta = document.getElementById('of-h-id')?.value?.trim();
    const cliente  = document.getElementById('of-h-cliente')?.value?.trim();
    if (!idOferta || !cliente) { UI.toast('N° de oferta y cliente son requeridos', 'warn'); return; }

    const fechaRaw = document.getElementById('of-h-fecha')?.value; // yyyy-mm-dd o vacío
    const fecha    = fechaRaw ? new Date(fechaRaw + 'T00:00:00').toLocaleDateString('es-CO') : '';
    const total    = parseFloat(document.getElementById('of-h-total')?.value) || 0;
    const estado   = document.getElementById('of-h-estado')?.value || 'GENERADA';

    this._guardandoOfertaManual = true;
    if (btn) UI.spin(btn, true);
    try {
      const res = await API.call('agregarOfertaManual', {
        idOferta, cliente, fecha, estado, total: UI.moneda(total)
      });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      DatosERP.invalidar();
      Store.upsert(this.DB.historial, res.data);
      this.renderTablaHistorial();
      this.renderDashboardOfertas();
      this.cerrarModal('of-modal-hist');
      UI.toast('Oferta histórica agregada', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoOfertaManual = false; if (btn) UI.spin(btn, false); }
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

  // Cada tipo (DIV/INSP/MTTO/OTROS) lleva su propio consecutivo — sugerir
  // "el siguiente número" ya no puede mirar solo la última oferta de TODO
  // el historial (eso mezclaba las series), sino la última de ESE tipo.
  // forzar=true sobreescribe aunque ya haya algo escrito (se usa cuando
  // la persona cambia el selector de tipo a propósito); si no, respeta
  // lo que ya esté en el campo, igual que el comportamiento original.
  sugerirConsecutivoPorTipo(forzar = false) {
    const input = document.getElementById('of-consecutivo');
    if (!input) return;
    if (!forzar && input.value.trim()) return;
    const tipo = document.getElementById('of-tipo-oferta')?.value || 'OTROS';
    const delTipo = (this.DB.historial || []).filter(h => this.tipoDeOferta(h.ID_OFERTA) === tipo);
    if (!delTipo.length) {
      const anio = String(new Date().getFullYear()).slice(-2);
      input.value = `${tipo}-${anio}-001`;
      return;
    }
    const ultimo = delTipo[delTipo.length - 1].ID_OFERTA;
    const m = ultimo.match(/^(.*?)(\d+)$/);
    input.value = m ? m[1] + String(parseInt(m[2],10) + 1).padStart(m[2].length, '0') : ultimo;
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
        <button class="btn-icon btn-icon-del" onclick="this.closest('tr').remove()" title="Eliminar">✕</button>
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
        <button class="btn-icon" style="color:var(--primary)" onclick="OFERTAS.guardarItemUI(this)" title="Guardar al catálogo">💾</button>
        <button class="btn-icon btn-icon-del" onclick="OFERTAS.borrarFila(this)">✕</button>
      </td>`;
    tbody.appendChild(tr);
    this.calcularTotales();
    this.renumerarItems();
  },

  // El campo "Ítem" se renumera solo cada vez que se agrega, borra o
  // reordena una fila — antes había que escribirlo a mano, y si se
  // borraba un ítem del medio, los que quedaban abajo se quedaban con el
  // número viejo (perdían el consecutivo) hasta corregirlos uno por uno.
  renumerarItems() {
    document.querySelectorAll('#of-tbody-items tr').forEach((tr, i) => {
      const inp = tr.querySelector('.inp-cod');
      if (inp) inp.value = i + 1;
    });
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
    if (row.parentNode?.id === 'of-tbody-items') this.renumerarItems();
  },

  calcFila(input) {
    const tr   = input.closest('tr');
    const cant = parseFloat(tr.querySelector('.inp-cant').value) || 0;
    const val  = parseFloat(tr.querySelector('.inp-val').value)  || 0;
    tr.querySelector('.inp-total').value = cant * val;
    this.calcularTotales();
  },

  borrarFila(btn) { btn.closest('tr').remove(); this.calcularTotales(); this.renumerarItems(); },

  toggleAIU() {
    const on = document.getElementById('of-aiu-check').checked;
    document.getElementById('of-aiu-fields').style.display = on ? 'grid' : 'none';
    document.querySelectorAll('.aiu-line').forEach(el => el.style.display = on ? '' : 'none');
    document.getElementById('of-subtotal-label').textContent = on ? 'Costo Directo:' : 'Subtotal:';
    document.getElementById('of-iva-label').textContent = on ? 'IVA 19% (sobre Utilidad):' : 'IVA 19%:';
    this.calcularTotales();
  },

  // Contratos por AIU: el IVA solo aplica sobre el componente de Utilidad,
  // no sobre el costo directo ni sobre Administración/Imprevistos — así
  // quedaron ya las cuentas del PUC (41652001/02/03 y 24080211 "IVA 19%
  // AIU"), este cálculo solo refleja ese mismo criterio en la oferta.
  calcularTotales() {
    let sub = 0;
    document.querySelectorAll('.inp-total').forEach(i => sub += parseFloat(i.value || 0));
    document.getElementById('of-subtotal').textContent = UI.moneda(sub);

    const aiuOn = document.getElementById('of-aiu-check')?.checked;
    let iva, total;

    if (aiuOn) {
      const pA = parseFloat(document.getElementById('of-aiu-a').value) || 0;
      const pI = parseFloat(document.getElementById('of-aiu-i').value) || 0;
      const pU = parseFloat(document.getElementById('of-aiu-u').value) || 0;
      const vA = sub * pA / 100;
      const vI = sub * pI / 100;
      const vU = sub * pU / 100;
      const subAIU = sub + vA + vI + vU;
      iva   = vU * 0.19;
      total = subAIU + iva;

      document.getElementById('of-aiu-row-a').textContent = `Administración (${pA}%):`;
      document.getElementById('of-aiu-row-i').textContent = `Imprevistos (${pI}%):`;
      document.getElementById('of-aiu-row-u').textContent = `Utilidad (${pU}%):`;
      document.getElementById('of-aiu-val-a').textContent   = UI.moneda(vA);
      document.getElementById('of-aiu-val-i').textContent   = UI.moneda(vI);
      document.getElementById('of-aiu-val-u').textContent   = UI.moneda(vU);
      document.getElementById('of-aiu-val-sub').textContent = UI.moneda(subAIU);
    } else {
      iva   = sub * 0.19;
      total = sub + iva;
    }

    document.getElementById('of-iva').textContent   = UI.moneda(iva);
    document.getElementById('of-total').textContent = UI.moneda(total);
  },

  // ──────────────────────────────────────────
  //  KITS
  // ──────────────────────────────────────────
  aplicarKit(tipo, jsonData) {
    if (!jsonData) return;
    const data = JSON.parse(jsonData);
    if (tipo === 'TEXTOS') {
      const hayAlgoQuePerder = document.getElementById('of-objeto').value.trim()
        || document.getElementById('of-alcance-gral').value.trim()
        || document.querySelectorAll('#of-tbody-alcance tr').length > 0;
      if (hayAlgoQuePerder && !UI.confirmar('Este kit va a reemplazar el objeto y el alcance que ya tienes escritos. ¿Continuar?')) return;
      document.getElementById('of-objeto').value      = data.objeto || '';
      document.getElementById('of-alcance-gral').value = data.alcance_gral || '';
      document.getElementById('of-tbody-alcance').innerHTML = '';
      const lista = Array.isArray(data.alcance_act) ? data.alcance_act :
                    (data.alcance_act || '').split('\n').filter(l => l.trim());
      lista.forEach(l => this.addAlcance(l));
    } else if (tipo === 'ITEMS') {
      const hayItemsQuePerder = document.querySelectorAll('#of-tbody-items tr').length > 0;
      if (hayItemsQuePerder && !UI.confirmar('Este kit va a reemplazar los ítems que ya tienes agregados. ¿Continuar?')) return;
      document.getElementById('of-tbody-items').innerHTML = '';
      data.forEach(k => this.addFila(k));
    }
  },

  async guardarKitUI(tipo, btn) {
    if (this._guardandoKit) return;
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
    this._guardandoKit = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const res = await API.call('guardarKit', { nombre, tipo, dataJson: JSON.stringify(dataToSave) });
      Store.upsert(this.DB.kits, res.data);
      this.renderSelectKits();
      UI.toast('Kit guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoKit = false; if (btn) UI.spinIcon(btn, false); }
  },

  // ──────────────────────────────────────────
  //  GUARDAR ÍTEM AL CATÁLOGO
  // ──────────────────────────────────────────
  async guardarItemUI(btn) {
    const tr   = btn.closest('tr');
    const desc = tr.querySelector('.inp-desc').value.trim();
    if (!desc) { UI.toast('Falta descripción', 'warn'); return; }
    btn.disabled = true; btn.innerHTML = '⏳';
    try {
      const res = await API.call('guardarServicio', {
        codigo:      tr.querySelector('.inp-cod').value,
        descripcion: desc,
        unidad:      tr.querySelector('.inp-un').value,
        precio:      tr.querySelector('.inp-val').value
      });
      Store.upsert(this.DB.items, res.data);
      this.renderTablaServicios();
      this.poblarCatalogo();
      btn.innerHTML = '✓';
      setTimeout(() => { btn.disabled = false; btn.innerHTML = '💾'; }, 2000);
    } catch(e) { btn.disabled = false; btn.innerHTML = '💾'; UI.toast(e.message, 'err'); }
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
      items: itemsData,
      aiu: {
        activo:         document.getElementById('of-aiu-check')?.checked || false,
        pctAdmin:       document.getElementById('of-aiu-a')?.value || 0,
        pctImprevistos: document.getElementById('of-aiu-i')?.value || 0,
        pctUtilidad:    document.getElementById('of-aiu-u')?.value || 0
      }
    };
  },

  // ──────────────────────────────────────────
  //  GUARDAR BORRADOR
  // ──────────────────────────────────────────
  async guardarBorrador(btn) {
    if (this._guardandoBorrador) return;
    const datos = this.recuperarFormulario();
    if (!datos) { UI.toast('Seleccione un cliente', 'warn'); return; }
    const consec = document.getElementById('of-consecutivo').value.trim();
    if (!consec) { UI.toast('Ingrese el N° de oferta', 'warn'); return; }
    this._guardandoBorrador = true;
    if (btn) UI.spin(btn, true);
    try {
      const res = await API.call('guardarHistorial', {
        idOferta: consec, clienteNombre: datos.cliente.EMPRESA_NOMBRE || datos.cliente.EMPRESA,
        total: document.getElementById('of-total').textContent, estado: 'BORRADOR', datos
      });
      DatosERP.invalidar();
      Store.upsert(this.DB.historial, res.data);
      this.renderTablaHistorial();
      this.renderDashboardOfertas(); // DB.historial mutó — redibujar el dashboard
      UI.toast('Borrador guardado', 'ok');
      this.tab('historial');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoBorrador = false; if (btn) UI.spin(btn, false); }
  },

  // ──────────────────────────────────────────
  //  GENERAR OFERTA
  // ──────────────────────────────────────────
  async generarDocumento(btn) {
    if (this._generandoDocumento) return;
    const datos = this.recuperarFormulario();
    if (!datos) { UI.toast('Seleccione un cliente', 'warn'); return; }
    if (!datos.consecutivo) { UI.toast('Ingrese el N° de oferta', 'warn'); return; }
    datos.total = document.getElementById('of-total').textContent;
    this._generandoDocumento = true;
    UI.spin(btn, true);
    try {
      const url = await API.call('procesarOferta', datos);
      window.open(url, '_blank');
      await this.recargar();
      UI.toast('Oferta generada exitosamente', 'ok');
    } catch(e) { UI.toast('Error: ' + e.message, 'err'); }
    finally { this._generandoDocumento = false; UI.spin(btn, false); }
  },

  // ──────────────────────────────────────────
  //  CARGAR / CLONAR DESDE HISTORIAL
  // ──────────────────────────────────────────
  async gestionarOferta(id, accion, btn) {
    if (this._gestionandoOferta) return;
    const oferta = this.DB.historial.find(h => String(h.ID_OFERTA) === String(id));
    if (!oferta) { UI.toast('Oferta no encontrada', 'err'); return; }
    this._gestionandoOferta = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const dataJson = await this.resolverDataJson(oferta);
      if (!dataJson) return;
      if (accion === 'CARGAR') this.cargarDesdeHistorial({ ...oferta, DATA_JSON: dataJson });
      else if (accion === 'CLONAR') {
        const tipoOriginal = this.tipoDeOferta(oferta.ID_OFERTA); // se pierde en cuanto se vacíe ID_OFERTA
        const clon = { ...oferta, DATA_JSON: dataJson, ID_OFERTA: '' };
        this.cargarDesdeHistorial(clon, true, tipoOriginal);
      }
    } finally { this._gestionandoOferta = false; if (btn) UI.spinIcon(btn, false); }
  },

  cargarDesdeHistorial(h, esClon = false, tipoOriginal = null) {
    if (!h.DATA_JSON) { UI.toast('Sin datos de oferta', 'err'); return; }
    const data = JSON.parse(h.DATA_JSON);
    this.rellenarFormulario(data);
    document.getElementById('of-consecutivo').value = esClon ? '' : h.ID_OFERTA;
    if (esClon) {
      // Al clonar, seguimos en la misma serie (DIV/INSP/MTTO/OTROS) que
      // la oferta original — solo cambia el consecutivo, no el tipo.
      if (tipoOriginal) document.getElementById('of-tipo-oferta').value = tipoOriginal;
      this.sugerirConsecutivoPorTipo(true);
    }
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

    const aiu = data.aiu || {};
    document.getElementById('of-aiu-check').checked = !!aiu.activo;
    set('of-aiu-a', aiu.pctAdmin       ?? 9);
    set('of-aiu-i', aiu.pctImprevistos ?? 6);
    set('of-aiu-u', aiu.pctUtilidad    ?? 4);
    this.toggleAIU();
  },

  // ──────────────────────────────────────────
  //  CLIENTES CRUD
  // ──────────────────────────────────────────
  modalCliente(c = null) {
    document.getElementById('of-title-cli').textContent = c ? 'Editar Cliente' : 'Nuevo Cliente';
    document.getElementById('of-cli-edit-idx').value = c ? c._rowIndex : '';
    // ID inmutable del cliente, capturado en memoria (no hay campo oculto
    // en el HTML para esto) — se reenvía al guardar/eliminar para que el
    // backend pueda verificar que la fila no se desplazó desde que se
    // abrió este formulario, en vez de confiar ciegamente en _rowIndex.
    this._clienteEditId = c ? c.ID_CLIENTE : null;
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

  async guardarClienteForm(btn) {
    // Sin esto, un doble clic (o un clic mientras Apps Script todavía
    // responde) crea dos clientes iguales — pasó de verdad, backend no
    // valida duplicados de nombre/NIT aquí.
    if (this._guardandoCliente) return;
    const obj = {
      _rowIndex: document.getElementById('of-cli-edit-idx').value,
      id:        this._clienteEditId || undefined,
      empresa:   document.getElementById('of-n-empresa').value,
      nit:       document.getElementById('of-n-nit').value,
      direccion: document.getElementById('of-n-dir-m').value,
      ciudad:    document.getElementById('of-n-ciudad').value,
      atencion:  document.getElementById('of-n-attn-m').value,
      telefono:  document.getElementById('of-n-tel-m').value,
      email:     document.getElementById('of-n-email-m').value
    };
    if (!obj.empresa) { UI.toast('Falta nombre de empresa', 'warn'); return; }
    this._guardandoCliente = true;
    if (btn) UI.spin(btn, true);
    try {
      const accion = obj._rowIndex ? 'editarCliente' : 'guardarCliente';
      const res = await API.call(accion, obj);
      Store.upsert(this.DB.clientes, res.data);
      this.renderSelectClientes(); this.renderTablaClientes();
      this.cerrarModal('of-modal-cli');
      UI.toast('Cliente guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoCliente = false; if (btn) UI.spin(btn, false); }
  },

  async eliminarClienteUI(c, btn) {
    if (this._eliminandoCliente) return;
    if (!UI.confirmar('¿Eliminar este cliente?')) return;
    if (this._eliminandoCliente) return;
    this._eliminandoCliente = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const res = await API.call('eliminarCliente', { rowIndex: c._rowIndex, id: c.ID_CLIENTE });
      Store.remove(this.DB.clientes, res.rowIndex);
      this.renderSelectClientes(); this.renderTablaClientes();
      UI.toast('Cliente eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._eliminandoCliente = false; if (btn) UI.spinIcon(btn, false); }
  },

  // ──────────────────────────────────────────
  //  SERVICIOS CRUD
  // ──────────────────────────────────────────
  modalServicio(i = null) {
    document.getElementById('of-title-srv').textContent = i ? 'Editar Servicio' : 'Nuevo Servicio';
    document.getElementById('of-srv-edit-idx').value = i ? i._rowIndex : '';
    // ID_SERVICIO es el UUID inmutable asignado por el backend al crear el
    // ítem (ver Oferta.gs) — a diferencia de CODIGO, que el usuario puede
    // editar libremente y por eso no sirve como identidad para detectar
    // colisiones de concurrencia.
    this._servicioEditId = i ? i.ID_SERVICIO : null;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('of-srv-cod',   i?.CODIGO);
    set('of-srv-desc',  i?.DESCRIPCION_SERVICIO || i?.DESCRIPCION);
    set('of-srv-un',    i?.UNIDAD || 'UN');
    set('of-srv-price', i?.PRECIO_VENTA_LISTA || i?.PRECIO);
    document.getElementById('of-modal-srv').classList.add('open');
  },

  editarServicioUI(i) { this.modalServicio(i); },

  async guardarServicioForm(btn) {
    if (this._guardandoServicio) return;
    const obj = {
      _rowIndex:   document.getElementById('of-srv-edit-idx').value,
      id:          this._servicioEditId || undefined,
      codigo:      document.getElementById('of-srv-cod').value,
      descripcion: document.getElementById('of-srv-desc').value,
      unidad:      document.getElementById('of-srv-un').value,
      precio:      document.getElementById('of-srv-price').value
    };
    if (!obj.descripcion) { UI.toast('Falta descripción', 'warn'); return; }
    this._guardandoServicio = true;
    if (btn) UI.spin(btn, true);
    try {
      const accion = obj._rowIndex ? 'editarServicio' : 'guardarServicio';
      const res = await API.call(accion, obj);
      // editarServicio devuelve solo los campos que cambió (no toca
      // CATEGORIA/COSTO_BASE/MARGEN) — Store.upsert fusiona en vez de
      // reemplazar, así que esos tres campos no se pierden.
      Store.upsert(this.DB.items, res.data);
      this.renderTablaServicios(); this.poblarCatalogo();
      this.cerrarModal('of-modal-srv');
      UI.toast('Servicio guardado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._guardandoServicio = false; if (btn) UI.spin(btn, false); }
  },

  async eliminarServicioUI(i, btn) {
    if (this._eliminandoServicio) return;
    if (!UI.confirmar('¿Eliminar este servicio?')) return;
    if (this._eliminandoServicio) return;
    this._eliminandoServicio = true;
    if (btn) UI.spinIcon(btn, true);
    try {
      const res = await API.call('eliminarServicio', { rowIndex: i._rowIndex, id: i.ID_SERVICIO });
      Store.remove(this.DB.items, res.rowIndex);
      this.renderTablaServicios(); this.poblarCatalogo();
      UI.toast('Servicio eliminado', 'ok');
    } catch(e) { UI.toast(e.message, 'err'); }
    finally { this._eliminandoServicio = false; if (btn) UI.spinIcon(btn, false); }
  },

  async migrarHistorial() {
    if (!UI.confirmar('¿Importar todos los servicios del historial al catálogo?')) return;
    try {
      // Migración masiva: sí trae DB_ITEMS completo (backend solo devuelve
      // esa hoja, no las otras 6 del ERP — ver Oferta.gs), porque puede
      // haber creado muchas filas de una vez, no un solo registro.
      const res = await API.call('migrarHistorial');
      this.DB.items = res.items;
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
