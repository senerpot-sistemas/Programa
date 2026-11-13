/**
 * NODIA — Nueva oferta: asistente de 5 etapas.
 * No reemplaza la lógica de ofertas.js / ofertas_nodia.js: reorganiza SUS campos en etapas, muestra solo lo relevante al servicio elegido,
 * detecta condiciones repetidas o contradictorias, conserva lo capturado al navegar, guarda un borrador local y pide al servidor una
 * vista previa real (sin consumir consecutivo). La generación sigue siendo OFERTAS.generarDocumento.
 */
const WIZ = {
  paso: 1, TOTAL: 5, vistos: new Set([1]), solar: null, solarDemo: false, verTodo: false, fotoManual: false, _t: null, _previaVigente: false,
  CLAVE_LOCAL: 'nodia_wz_borrador_v1',

  CLASES: {
    MANT:    { txt: 'Mantenimiento eléctrico',         plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Describa el equipo o la instalación y las actividades de mantenimiento que SÍ se van a ejecutar. Las pruebas y repuestos solo aparecen si usted los escribe.',
                     tipos: ['Mantenimiento preventivo', 'Mantenimiento correctivo', 'Mantenimiento preventivo y correctivo', 'Inspección y diagnóstico', 'Otro'] },
    TRAFO:   { txt: 'Transformadores y subestaciones', plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Indique el tipo de transformador: la fotografía de portada institucional solo corresponde a transformadores en aceite.',
                     tipos: ['Mantenimiento preventivo', 'Mantenimiento correctivo', 'Mantenimiento preventivo y correctivo', 'Suministro e instalación', 'Montaje y puesta en servicio', 'Pruebas y diagnóstico', 'Retiro o desmonte'],
                     sub: { lbl: 'Tipo de transformador', ops: ['En aceite', 'Seco', 'Pad mounted', 'Otro'] } },
    PLANTA:  { txt: 'Plantas eléctricas',              plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Registre la capacidad, el modelo y la serie de la planta en la ficha técnica si desea que figuren en el documento.',
                     tipos: ['Mantenimiento preventivo', 'Mantenimiento correctivo', 'Suministro e instalación', 'Puesta en servicio', 'Pruebas y diagnóstico', 'Otro'] },
    TABLERO: { txt: 'Tableros, barras y acometidas',   plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Describa el tablero o la acometida (tensión nominal, fases, ubicación) y el alcance exacto del trabajo.',
                     tipos: ['Mantenimiento', 'Suministro e instalación', 'Modernización o reforma', 'Pruebas y diagnóstico', 'Otro'],
                     sub: { lbl: 'Tipo de instalación', ops: ['Tableros y cuadros', 'Barras y acometidas', 'Otro'] } },
    FV:      { txt: 'Instalación fotovoltaica',        plantilla: 'SOLAR',         foto: 'PANELES_SOLARES', nota: 'La oferta fotovoltaica exige los datos del Simulador (generación, consumo, tarifa y supuestos con su fuente). No se estiman por su cuenta.',
                     tipos: ['Suministro e instalación', 'Diseño e ingeniería', 'Mantenimiento de sistema existente', 'Ampliación'],
                     sub: { lbl: 'Configuración del sistema', ops: ['Conectado a red', 'Híbrido con baterías', 'Aislado', 'Otro'] } },
    PRUEBAS: { txt: 'Pruebas y diagnósticos',          plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Liste las pruebas que realmente se contratan (etapa 2, «Alcance técnico confirmado»).',
                     tipos: ['Pruebas y diagnóstico', 'Análisis de variables eléctricas', 'Calidad de energía', 'Termografía', 'Otro'] },
    TDR:     { txt: 'Consultoría — términos de referencia', plantilla: 'TDR',     foto: 'NINGUNA', nota: 'Documento de consultoría: no lleva ficha de equipo ni fotografía de equipo.',
                     tipos: ['Consultoría o estudio', 'Diseño', 'Interventoría', 'Otro'] },
    OTRO:    { txt: 'Otro servicio',                   plantilla: 'MANTENIMIENTO', foto: 'NINGUNA', nota: 'Servicio no clasificado: se muestran los campos generales.', tipos: ['Otro'] }
  },
  NOMBRES_PASO: ['', 'Cliente y servicio', 'Equipos y alcance', 'Presupuesto', 'Condiciones', 'Revisión y generación'],

  $(id) { return document.getElementById(id); },
  val(id) { const e = this.$(id); return e ? String(e.value || '').trim() : ''; },
  esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  clase() { return this.val('wz-clase'); },
  esNodia() { return this.val('of-formato') === 'NODIA'; },

  // ───────────────────────── Arranque ─────────────────────────
  init() {
    if (this._ok || !this.$('wz')) return; this._ok = true;
    // Enganches con la lógica existente (sin modificarla)
    const recolectar = OFERTAS_NODIA.recolectar.bind(OFERTAS_NODIA);
    OFERTAS_NODIA.recolectar = (datos) => {
      const d = recolectar(datos);
      if (d.nodia) { d.nodia.clase = this.clase(); d.nodia.tipoTrabajo = this.val('wz-tipo-trabajo'); d.nodia.subclase = this.val('wz-subclase'); if (this.solar && this.val('of-nd-servicio') === 'SOLAR') d.nodia.solar = this.solar; }
      return d;
    };
    const recuperar = OFERTAS.recuperarFormulario.bind(OFERTAS);
    OFERTAS.recuperarFormulario = () => { const d = recuperar(); if (d) d.clasificacion = { clase: this.clase(), claseTexto: (this.CLASES[this.clase()] || {}).txt || '', tipoTrabajo: this.val('wz-tipo-trabajo'), subclase: this.val('wz-subclase') }; return d; };
    const rellenar = OFERTAS.rellenarFormulario.bind(OFERTAS);
    OFERTAS.rellenarFormulario = (data) => { rellenar(data); this.restaurar(data); };
    // Cualquier cambio en el formulario: guarda borrador local y revisa
    const panel = this.$('wz');
    panel.addEventListener('input', () => this.alCambiar()); panel.addEventListener('change', () => this.alCambiar());
    // Indicador de etapa para pantallas pequeñas
    const barra = panel.querySelector('.wz-bar'); const now = document.createElement('div'); now.id = 'wz-now'; now.className = 'wz-now'; barra.insertAdjacentElement('afterend', now);
    // Barra de «mostrar todos los campos» (etapa 2)
    const p2 = panel.querySelector('.wz-panel[data-step="2"]'), tb = document.createElement('div'); tb.className = 'wz-toolbar'; tb.id = 'wz-toolbar-rel';
    tb.innerHTML = '<span id="wz-rel-txt"></span><button type="button" class="wz-mini" id="wz-vertodo" onclick="WIZ.alternarVerTodo()">Mostrar todos los campos</button>'; p2.insertAdjacentElement('afterbegin', tb);
    this.$('of-nd-foto').addEventListener('change', () => { this.fotoManual = true; });   // si la persona elige la foto, no se vuelve a sugerir sola
    OFERTAS_NODIA.cambiarFormato();           // por defecto: PDF NODIA
    this.cambiarClase(false); this.ir(1); this.revisarBorradorLocal();
  },

  // ───────────────────────── Navegación ─────────────────────────
  ir(n, sinValidar) {
    n = Math.max(1, Math.min(this.TOTAL, n)); this.paso = n; this.vistos.add(n);
    document.querySelectorAll('#wz .wz-panel').forEach(p => p.classList.toggle('on', Number(p.dataset.step) === n));
    this.$('wz-bar-fill').style.width = (n * 20) + '%';
    this.$('wz-atras').style.visibility = n === 1 ? 'hidden' : 'visible';
    this.$('wz-siguiente').style.display = n === this.TOTAL ? 'none' : '';
    this.$('of-btn-generar').style.display = n === this.TOTAL ? '' : 'none';
    const now = this.$('wz-now'); if (now) now.textContent = 'Etapa ' + n + ' de ' + this.TOTAL + ' · ' + this.NOMBRES_PASO[n];
    this.ocultarAlerta(); this.refrescar();
    if (n === 4) this.pintarConflictos(); if (n === 5) { this.pintarChecklist(); this.pintarConflictos(); }
    const top = this.$('wz'); if (top && top.scrollIntoView && !sinValidar) top.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  siguiente() {
    const errs = this.revisar().filter(x => x.paso === this.paso && x.nivel === 'error' && x.bloquea);
    if (errs.length) { this.mostrarAlerta('Antes de continuar:', errs); return; }
    this.ir(this.paso + 1);
  },
  atras() { this.ir(this.paso - 1); },
  mostrarAlerta(titulo, items) {
    const a = this.$('wz-alerta'); a.innerHTML = '<b>' + this.esc(titulo) + '</b><ul>' + items.map(x => '<li>' + this.esc(x.texto) + (x.paso && x.paso !== this.paso ? ' <a onclick="WIZ.ir(' + x.paso + ')">Ir a la etapa ' + x.paso + '</a>' : '') + '</li>').join('') + '</ul>'; a.style.display = 'block';
  },
  ocultarAlerta() { const a = this.$('wz-alerta'); if (a) a.style.display = 'none'; },

  // ───────────────────────── Clase de servicio ─────────────────────────
  cambiarClase(porUsuario) {
    const c = this.clase(), def = this.CLASES[c]; if (porUsuario) this.fotoManual = false;
    // tipos de trabajo
    const st = this.$('wz-tipo-trabajo'), actual = st.value; st.innerHTML = '<option value="">— Seleccione —</option>' + (def ? def.tipos : []).map(t => '<option>' + this.esc(t) + '</option>').join(''); if (def && def.tipos.includes(actual)) st.value = actual;
    // subclase (tipo de transformador / configuración fotovoltaica)
    const gs = this.$('wz-g-subclase'), ss = this.$('wz-subclase'), sa = ss.value;
    if (def && def.sub) { gs.style.display = ''; this.$('wz-subclase-lbl').textContent = def.sub.lbl; ss.innerHTML = '<option value="">— Seleccione —</option>' + def.sub.ops.map(t => '<option>' + this.esc(t) + '</option>').join(''); if (def.sub.ops.includes(sa)) ss.value = sa; } else { gs.style.display = 'none'; ss.innerHTML = '<option value="">—</option>'; }
    // plantilla del documento y fotografía sugerida (sin pisar lo que la persona ya eligió)
    if (def && porUsuario) { const pl = this.$('of-nd-servicio'); pl.value = def.plantilla; if (!this.fotoManual) this.$('of-nd-foto').value = def.foto; }
    const nota = this.$('wz-nota-clase'); if (def) { nota.textContent = def.nota; nota.style.display = ''; } else nota.style.display = 'none';
    this.aplicarRelevancia(); this.alCambiarPlantilla(true); this.sugerirFoto();
    if (porUsuario) this.alCambiar();
  },
  cambiarSubclase() { this.fotoManual = false; this.sugerirFoto(); this.alCambiar(); },
  alCambiarPlantilla(silencio) { this.aplicarRelevancia(); if (!silencio) this.alCambiar(); },
  alCambiarFormato() { this.aplicarRelevancia(); this.alCambiar(); },
  /** La fotografía institucional de transformador en aceite solo se sugiere si el transformador ES en aceite; las demás clases, sin foto. */
  /** Fotografía institucional que corresponde a la clase y al tipo elegidos (null = panel de marca). Cada foto solo se sugiere para lo que muestra. */
  fotoSugerida() {
    const c = this.clase(), sub = this.val('wz-subclase');
    if (c === 'FV') return 'PANELES_SOLARES';
    if (c === 'TRAFO') return { 'En aceite': 'TRANSFORMADOR_ACEITE', 'Seco': 'TRANSFORMADOR_SECO', 'Pad mounted': 'PAD_MOUNTED' }[sub] || null;
    if (c === 'PLANTA') return 'PLANTA_ELECTRICA';
    if (c === 'TABLERO') return { 'Tableros y cuadros': 'TABLERO_CUADROS', 'Barras y acometidas': 'BARRAS_ACOMETIDAS' }[sub] || null;
    if (c === 'PRUEBAS') return 'PRUEBAS_ELECTRICAS';
    return null;
  },
  /** Para qué clases es válida cada fotografía (la de pruebas sirve para cualquier trabajo eléctrico con pruebas). */
  FOTO_CLASES: { TRANSFORMADOR_ACEITE: ['TRAFO'], TRANSFORMADOR_SECO: ['TRAFO'], PAD_MOUNTED: ['TRAFO'], PLANTA_ELECTRICA: ['PLANTA'], TABLERO_CUADROS: ['TABLERO'], BARRAS_ACOMETIDAS: ['TABLERO'], PRUEBAS_ELECTRICAS: ['PRUEBAS', 'MANT', 'TRAFO', 'PLANTA', 'TABLERO'], PANELES_SOLARES: ['FV'] },
  FOTO_SUB: { TRANSFORMADOR_ACEITE: 'En aceite', TRANSFORMADOR_SECO: 'Seco', PAD_MOUNTED: 'Pad mounted', TABLERO_CUADROS: 'Tableros y cuadros', BARRAS_ACOMETIDAS: 'Barras y acometidas' },
  FOTO_NOMBRE: { TRANSFORMADOR_ACEITE: 'transformador en aceite', TRANSFORMADOR_SECO: 'transformador seco', PAD_MOUNTED: 'transformador pad mounted', PLANTA_ELECTRICA: 'planta eléctrica', TABLERO_CUADROS: 'tableros y cuadros', BARRAS_ACOMETIDAS: 'barras y acometidas', PRUEBAS_ELECTRICAS: 'pruebas eléctricas', PANELES_SOLARES: 'paneles solares' },
  sugerirFoto() {
    const c = this.clase(), sub = this.val('wz-subclase'), f = this.$('of-nd-foto'), s = this.fotoSugerida(); let h = '';
    if (!this.fotoManual) f.value = s || 'NINGUNA';
    if (c === 'TRAFO' && !sub) h = 'Elija el tipo de transformador (aceite, seco o pad mounted) para sugerir la fotografía adecuada.';
    else if (c === 'TABLERO' && !sub) h = 'Indique si son tableros y cuadros o barras y acometidas para sugerir la fotografía adecuada.';
    else if (s) h = 'Fotografía institucional sugerida: ' + this.FOTO_NOMBRE[s] + '.';
    else if (c) h = 'No hay fotografía institucional para esta clase: se usa el panel de marca.';
    this.$('wz-foto-hint').textContent = h;
  },
  alternarVerTodo() { this.verTodo = !this.verTodo; this.aplicarRelevancia(); },
  /** Muestra solo los campos propios de la clase elegida (los demás siguen accesibles con «Mostrar todos los campos»). */
  aplicarRelevancia() {
    const c = this.clase(), todo = this.verTodo || !c, fv = c === 'FV', tdr = c === 'TDR';
    document.querySelectorAll('#wz [data-rel]').forEach(g => g.classList.toggle('wz-rel-oculto', !(todo || g.dataset.rel.split(' ').includes(c))));
    const mostrar = (id, v) => { const e = this.$(id); if (e) e.style.display = v ? '' : 'none'; };
    mostrar('wz-card-solar', fv || this.val('of-nd-servicio') === 'SOLAR'); mostrar('wz-card-activos', todo || !fv);
    const fichaSinCampos = (fv || tdr) && !this.verTodo; const cf = this.$('wz-card-ficha'); if (cf) cf.classList.toggle('wz-rel-oculto', fichaSinCampos);
    const ct = this.$('wz-card-tecnico'); if (ct) ct.classList.toggle('wz-rel-oculto', (fv || tdr) && !this.verTodo);
    const t = this.$('wz-rel-txt'); if (t) t.textContent = todo ? (c ? 'Se muestran todos los campos.' : 'Elija la clase de servicio (etapa 1) para ver solo los campos que le corresponden.') : 'Se muestran los campos de: ' + (this.CLASES[c] || {}).txt + '.';
    const b = this.$('wz-vertodo'); if (b) { b.textContent = this.verTodo ? 'Mostrar solo los de la clase' : 'Mostrar todos los campos'; b.style.display = c ? '' : 'none'; }
  },

  // ───────────────────────── Datos del Simulador Fotovoltaico ─────────────────────────
  leerSolar() {
    const t = this.val('wz-solar-json'), est = this.$('wz-solar-estado'); this.solarDemo = false;
    if (!t) { this.solar = null; est.textContent = 'Sin datos del Simulador'; est.className = 'wz-solar-estado'; return; }
    try {
      const o = JSON.parse(t); const falt = ['sistema', 'energia', 'tarifa', 'finanzas'].filter(k => !o[k]);
      if (falt.length) throw new Error('faltan: ' + falt.join(', '));
      this.solar = o; this.solarDemo = !!o._demo;
      est.textContent = this.solarDemo ? 'Datos marcados como de demostración: no se pueden usar en una oferta real' : 'Datos cargados: ' + ((o.sistema.modulos || {}).cantidad || '?') + ' módulos · fuente: ' + ((o.energia || {}).fuente || 'sin indicar');
      est.className = 'wz-solar-estado ' + (this.solarDemo ? 'err' : 'ok');
    } catch (e) { this.solar = null; est.textContent = 'JSON no válido: ' + e.message; est.className = 'wz-solar-estado err'; }
  },
  limpiarSolar() { this.$('wz-solar-json').value = ''; this.leerSolar(); this.alCambiar(); },

  // ───────────────────────── Revisión: lista de verificación y conflictos ─────────────────────────
  norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim(); },
  STOP: new Set('para con sin por una uno los las del que sus este esta como cada todo toda desde hasta sobre entre ante tras segun mediante'.split(' ')),
  tok(s) { return new Set(this.norm(s).split(' ').filter(w => w.length > 3 && !this.STOP.has(w))); },
  lineas(id) { return (this.val(id) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); },
  alcanceActs() { return [...document.querySelectorAll('.inp-alcance')].map(i => i.value.trim()).filter(Boolean); },
  partidas() { return [...document.querySelectorAll('#of-tbody-items tr')].map(tr => ({ desc: (tr.querySelector('.inp-desc') || {}).value || '', cant: parseFloat((tr.querySelector('.inp-cant') || {}).value) || 0, unit: parseFloat(String((tr.querySelector('.inp-val') || {}).value || '0').replace(/[^0-9.\-]/g, '')) || 0 })); },
  totalNum() { return parseInt(String(this.$('of-total')?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0; },
  meses(txt) {
    const N = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, veinticuatro: 24, treinta: 30 }, out = new Set(), t = this.norm(txt);
    const re = /(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|veinticuatro|treinta)\s*(?:\d+\s*)?(mes|meses|ano|anos|dias)/g; let m;
    while ((m = re.exec(t))) { const n = /^\d+$/.test(m[1]) ? Number(m[1]) : N[m[1]]; if (!n) continue; out.add(m[2].startsWith('ano') ? n * 12 : m[2] === 'dias' ? Math.round(n / 30) : n); }
    return [...out];
  },

  /** Devuelve [{paso, nivel:'error'|'aviso'|'ok', texto, bloquea?}] */
  revisar() {
    const r = [], add = (paso, nivel, texto, bloquea) => r.push({ paso, nivel, texto, bloquea: !!bloquea });
    const c = this.clase(), nd = this.esNodia(), cliOk = !!this.val('of-cli-select');
    // Etapa 1
    if (!cliOk) add(1, 'error', 'Seleccione el cliente.', true); if (!this.val('of-consecutivo')) add(1, 'error', 'Indique el número de oferta.', true);
    if (!c) { if (nd) add(1, 'error', 'Elija la clase de servicio.', true); else add(1, 'aviso', 'Sin clase de servicio: la oferta no quedará clasificada en el Historial (no bloquea el formato anterior).'); } else if (!this.val('wz-tipo-trabajo')) add(1, 'aviso', 'Falta el tipo de trabajo.');
    if (c === 'TRAFO' && !this.val('wz-subclase')) add(1, 'aviso', 'Indique si el transformador es en aceite, seco o pad mounted.');
    if (nd && !this.val('of-nd-titulo')) add(1, 'aviso', 'Falta el título del servicio (aparece en la portada).');
    // Etapa 2
    if (!this.val('of-objeto')) add(2, 'aviso', 'Falta el objeto de la oferta.');
    if (!this.val('of-alcance-gral') && !this.alcanceActs().length) add(2, 'aviso', 'No hay alcance: escriba el alcance general o al menos una actividad.');
    if (nd && (c === 'FV' || this.val('of-nd-servicio') === 'SOLAR')) { if (!this.solar) add(2, 'error', 'Faltan los datos del Simulador Fotovoltaico.'); else if (this.solarDemo) add(5, 'error', 'Los datos del Simulador están marcados como de demostración: no se puede generar una oferta real con ellos.'); }
    // Etapa 3
    const ps = this.partidas(), conValor = ps.filter(p => p.desc.trim() && p.cant > 0 && p.unit > 0);
    if (!conValor.length) add(3, 'error', 'Agregue al menos una partida con descripción, cantidad y valor.'); if (ps.some(p => p.desc.trim() && (p.cant <= 0 || p.unit <= 0))) add(3, 'aviso', 'Hay partidas con cantidad o valor en cero.');
    if (ps.some(p => !p.desc.trim() && (p.cant > 0 || p.unit > 0))) add(3, 'aviso', 'Hay partidas con valor pero sin descripción.');
    const vistas = new Map(); ps.forEach(p => { const k = this.norm(p.desc); if (!k) return; vistas.set(k, (vistas.get(k) || 0) + 1); }); [...vistas].filter(([, n]) => n > 1).forEach(([k]) => add(3, 'aviso', 'Partida repetida: «' + k.slice(0, 60) + '».'));
    // Etapa 4 y 5
    if (nd) { try { OFERTAS_NODIA.validar().forEach(e => add(4, 'error', e)); } catch (e) {} }
    this.conflictos().forEach(x => add(4, x.nivel, x.texto));
    return r;
  },
  /** Condiciones repetidas o contradictorias entre los textos del formulario. */
  conflictos() {
    const out = [], add = (nivel, texto) => out.push({ nivel, texto }), c = this.clase(), nd = this.esNodia();
    // 1) Fuentes de texto "una idea por línea"
    const fuentes = [['Alcance (actividades)', this.alcanceActs()], ['Pruebas', this.lineas('of-nd-pruebas')], ['Materiales', this.lineas('of-nd-materiales')], ['Repuestos', this.lineas('of-nd-repuestos')], ['Entregables', this.lineas('of-nd-entregables')],
      ['Exclusiones', this.lineas('of-nd-exclusiones')], ['Garantías', this.lineas('of-nd-garantias')], ['Responsabilidades del cliente', this.lineas('of-cond-resp')], ['Notas', this.lineas('of-cond-notas')]];
    const todas = []; fuentes.forEach(([n, ls]) => ls.forEach(l => todas.push({ n, l, k: this.norm(l), t: this.tok(l) })));
    const dup = new Set();
    for (let i = 0; i < todas.length; i++) for (let j = i + 1; j < todas.length; j++) {
      const a = todas[i], b = todas[j]; if (!a.k || !b.k) continue; const clave = a.k + '|' + b.k;
      if (a.k === b.k) { if (!dup.has(a.k)) { dup.add(a.k); add('aviso', 'Condición repetida: «' + a.l.slice(0, 70) + '» aparece en ' + a.n + (a.n === b.n ? ' (dos veces)' : ' y en ' + b.n) + '.'); } continue; }
      if (a.t.size >= 4 && b.t.size >= 4) { const inter = [...a.t].filter(x => b.t.has(x)).length, jac = inter / (a.t.size + b.t.size - inter); if (jac >= 0.8 && !dup.has(clave)) { dup.add(clave); add('aviso', 'Textos casi idénticos: «' + a.l.slice(0, 55) + '» (' + a.n + ') y «' + b.l.slice(0, 55) + '» (' + b.n + ').'); } }
    }
    // 2) Exclusión que contradice algo incluido
    const incl = fuentes.filter(([n]) => ['Alcance (actividades)', 'Pruebas', 'Materiales', 'Repuestos', 'Entregables'].includes(n)).flatMap(([n, ls]) => ls.map(l => ({ n, l, t: this.tok(l), k: this.norm(l) })))
      .concat(this.partidas().filter(p => p.desc.trim()).map(p => ({ n: 'Partidas', l: p.desc, t: this.tok(p.desc), k: this.norm(p.desc) })));
    const ya = new Set(); this.lineas('of-nd-exclusiones').forEach(e => {
      const te = this.tok(e), ke = this.norm(e); if (te.size < 2) return;
      incl.forEach(i => { if (i.t.size < 2) return; const inter = [...te].filter(x => i.t.has(x)).length, cob = inter / Math.min(te.size, i.t.size); const id = ke + '>' + i.k;
        if (inter >= 2 && cob >= 0.75 && !ya.has(id)) { ya.add(id); add(cob === 1 && ke === i.k ? 'error' : 'aviso', 'Posible contradicción: la exclusión «' + e.slice(0, 60) + '» coincide con «' + i.l.slice(0, 60) + '» (' + i.n + '), que está incluido.'); } });
    });
    // 3) Vigencia: el número de días del plan debe coincidir con lo que digan los textos
    const dias = parseInt(this.val('of-nd-vigencia'), 10), txt = ['of-cond-notas', 'of-cond-pago', 'of-cond-financieros', 'of-cond-resp'].map(i => this.val(i)).join(' \n ');
    const re = /(vigencia|validez)[^.\d]{0,40}(\d{1,3})\s*d[ií]as/gi; let m; const distintos = new Set(); while ((m = re.exec(txt))) if (nd && dias && Number(m[2]) !== dias) distintos.add(m[2]);
    distintos.forEach(d => add('error', 'La vigencia del plan es de ' + dias + ' días, pero un texto dice ' + d + ' días.'));
    // 4) Garantías
    const gt = this.val('of-cond-garantia'), gl = this.lineas('of-nd-garantias');
    if (nd && gt && gl.length) add('aviso', 'Hay garantía en dos campos: en el PDF NODIA solo se imprime «Garantías»; el texto de «Garantía técnica» no saldrá.');
    const mesesTodos = new Set([...this.meses(gt), ...gl.flatMap(l => this.meses(l)), ...this.meses(this.val('of-cond-notas').split(/[.\n]/).filter(x => /garant/i.test(x)).join('. '))]); const sinDias = [...mesesTodos].filter(x => x > 0);
    if (sinDias.length > 1) add('aviso', 'Se mencionan plazos de garantía distintos (' + sinDias.sort((a, b) => a - b).join(', ') + ' meses). Confirme que corresponden a alcances diferentes.');
    // 5) IVA
    if (/iva\s+incluido|incluye\s+(el\s+)?iva/i.test(this.val('of-cond-notas') + ' ' + this.val('of-cond-pago')) && (parseInt(String(this.$('of-iva')?.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0) > 0) add('aviso', 'Las notas dicen «IVA incluido», pero el presupuesto discrimina el IVA aparte.');
    // 6) Pago (formato anterior)
    if (!nd) { const pct = (this.val('of-cond-pago').match(/(\d{1,3})\s*%/g) || []).map(x => parseInt(x, 10)); if (pct.length > 1 && pct.reduce((a, b) => a + b, 0) !== 100) add('aviso', 'Los porcentajes del texto de pago suman ' + pct.reduce((a, b) => a + b, 0) + ' %, no 100 %.'); }
    // 7) Coherencia clase ↔ plantilla ↔ fotografía
    const pl = this.val('of-nd-servicio'), foto = this.val('of-nd-foto'), sub = this.val('wz-subclase');
    if (nd && c) {
      if (c === 'FV' && pl !== 'SOLAR') add('error', 'La clase es fotovoltaica pero la plantilla del documento no lo es.'); if (c !== 'FV' && pl === 'SOLAR') add('error', 'La plantilla fotovoltaica no corresponde a la clase «' + (this.CLASES[c] || {}).txt + '».');
      if (foto !== 'NINGUNA' && this.FOTO_CLASES[foto] && !this.FOTO_CLASES[foto].includes(c)) add('error', 'La fotografía de ' + this.FOTO_NOMBRE[foto] + ' no corresponde a la clase «' + (this.CLASES[c] || {}).txt + '».');
      else if (this.FOTO_SUB[foto] && this.CLASES[c] && this.CLASES[c].sub && sub && sub !== this.FOTO_SUB[foto]) add('aviso', 'La fotografía es de ' + this.FOTO_NOMBRE[foto] + ', pero el equipo indicado es «' + sub + '».');
      const sug = this.fotoSugerida(); if (sug && foto !== sug && foto !== 'NINGUNA') add('aviso', 'Para este servicio se sugiere la fotografía de ' + this.FOTO_NOMBRE[sug] + '.');
      if (c === 'FV' && foto !== 'PANELES_SOLARES') add('aviso', 'Para una oferta fotovoltaica se sugiere la fotografía de paneles solares.');
    }
    return out;
  },

  pintarConflictos() {
    const lista = this.conflictos(), el = this.$('wz-conf-lista'), n = this.$('wz-conf-n'); if (!el) return;
    const err = lista.filter(x => x.nivel === 'error').length, av = lista.length - err;
    n.textContent = lista.length; n.className = 'wz-badge ' + (err ? 'rojo' : av ? 'ambar' : 'verde');
    el.innerHTML = lista.length ? lista.map(x => '<div class="wz-it ' + x.nivel + '"><span class="ic">' + (x.nivel === 'error' ? '!' : '•') + '</span><div>' + this.esc(x.texto) + '</div></div>').join('') : '<div class="wz-it ok"><span class="ic">✓</span><div>No se detectaron condiciones repetidas ni contradictorias.</div></div>';
  },
  pintarChecklist() {
    const r = this.revisar(), el = this.$('wz-chk-lista'), n = this.$('wz-chk-n'); if (!el) return;
    const err = r.filter(x => x.nivel === 'error').length, av = r.filter(x => x.nivel === 'aviso').length;
    n.textContent = err ? err + ' por corregir' : av ? av + ' avisos' : 'Todo en orden'; n.className = 'wz-badge ' + (err ? 'rojo' : av ? 'ambar' : 'verde');
    const total = this.$('of-total')?.textContent || '$ 0', ok = [];
    if (this.val('of-cli-select')) ok.push('Cliente seleccionado'); if (this.val('of-consecutivo')) ok.push('Oferta ' + this.val('of-consecutivo')); if (this.clase()) ok.push('Servicio: ' + (this.CLASES[this.clase()] || {}).txt); ok.push('Total de la oferta: ' + total);
    el.innerHTML = r.filter(x => x.nivel !== 'ok').map(x => '<div class="wz-it ' + x.nivel + '"><span class="ic">' + (x.nivel === 'error' ? '!' : '•') + '</span><div>' + this.esc(x.texto) + ' <a onclick="WIZ.ir(' + x.paso + ')">Etapa ' + x.paso + '</a></div></div>').join('')
      + ok.map(t => '<div class="wz-it ok"><span class="ic">✓</span><div>' + this.esc(t) + '</div></div>').join('');
  },

  /** Marcas de las etapas (✓ completa, ! con errores) y estado de la cabecera. */
  refrescar() {
    const r = this.revisar();
    document.querySelectorAll('#wz-steps .wz-step').forEach(b => { const n = Number(b.dataset.step), e = r.some(x => x.paso === n && x.nivel === 'error'), visto = this.vistos.has(n) && n !== this.paso;
      b.classList.toggle('on', n === this.paso); b.classList.toggle('err', visto && e); b.classList.toggle('ok', visto && !e); });
  },

  // ───────────────────────── Borrador local y estado ─────────────────────────
  alCambiar() {
    this._previaVigente = false; clearTimeout(this._t);
    const st = this.$('wz-status'); if (st && !st.classList.contains('guardado')) st.textContent = 'Cambios sin guardar';
    this._t = setTimeout(() => { this.refrescar(); if (this.paso === 4 || this.paso === 5) this.pintarConflictos(); if (this.paso === 5) this.pintarChecklist(); this.guardarLocal(); }, 700);
  },
  guardarLocal() {
    try {
      if (!this.val('of-cli-select')) return; const d = OFERTAS.recuperarFormulario(); if (!d) return;
      localStorage.setItem(this.CLAVE_LOCAL, JSON.stringify({ t: Date.now(), consecutivo: this.val('of-consecutivo'), datos: d })); const st = this.$('wz-status');
      if (st) { st.textContent = 'Borrador local guardado a las ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) + ' · use «Guardar borrador» para conservarlo en el sistema'; st.classList.add('guardado'); setTimeout(() => st.classList.remove('guardado'), 4000); }
    } catch (e) {}
  },
  revisarBorradorLocal() {
    try {
      const raw = localStorage.getItem(this.CLAVE_LOCAL); if (!raw) return; const o = JSON.parse(raw); if (!o || !o.datos || Date.now() - o.t > 7 * 864e5) return;
      const b = this.$('wz-borrador-local'), min = Math.round((Date.now() - o.t) / 60000), hace = min < 60 ? min + ' min' : Math.round(min / 60) + ' h';
      b.innerHTML = '<span>Hay un borrador sin guardar' + (o.consecutivo ? ' (<b>' + this.esc(o.consecutivo) + '</b>)' : '') + ' de hace ' + hace + '.</span><button type="button" onclick="WIZ.restaurarLocal()">Restaurar</button><button type="button" onclick="WIZ.descartarLocal()">Descartar</button>'; b.style.display = 'flex';
    } catch (e) {}
  },
  restaurarLocal() { try { const o = JSON.parse(localStorage.getItem(this.CLAVE_LOCAL)); OFERTAS.rellenarFormulario(o.datos); this.$('of-consecutivo').value = o.datos.consecutivo || ''; this.$('wz-borrador-local').style.display = 'none'; UI.toast('Borrador restaurado', 'ok'); this.ir(1, true); } catch (e) { UI.toast('No se pudo restaurar el borrador', 'err'); } },
  descartarLocal() { try { localStorage.removeItem(this.CLAVE_LOCAL); } catch (e) {} this.$('wz-borrador-local').style.display = 'none'; },
  /** Rehidrata los campos propios del asistente al abrir un borrador u oferta del historial. */
  restaurar(data) {
    const cl = (data && (data.clasificacion || (data.nodia && { clase: data.nodia.clase, tipoTrabajo: data.nodia.tipoTrabajo, subclase: data.nodia.subclase }))) || {};
    this.$('wz-clase').value = cl.clase || ''; this.fotoManual = true; this.cambiarClase(false); this.$('wz-tipo-trabajo').value = cl.tipoTrabajo || ''; this.$('wz-subclase').value = cl.subclase || '';
    const s = data && data.nodia && data.nodia.solar; this.$('wz-solar-json').value = s ? JSON.stringify(s, null, 1) : ''; this.leerSolar();
    if (data && data.nodia && data.nodia.portadaFoto) this.$('of-nd-foto').value = data.nodia.portadaFoto; this.aplicarRelevancia(); this.sugerirFoto(); this.refrescar();
  },

  // ───────────────────────── Vista previa real ─────────────────────────
  async previsualizar() {
    const btn = this.$('wz-btn-previa'), est = this.$('wz-previa-estado'), val = this.$('wz-previa-val');
    if (!this.esNodia()) { est.textContent = 'La vista previa real está disponible para el formato PDF NODIA.'; return; }
    const datos = OFERTAS.recuperarFormulario(); if (!datos) { est.textContent = 'Seleccione un cliente para generar la vista previa.'; return; }
    datos.total = this.$('of-total').textContent; btn.disabled = true; est.textContent = 'Generando la vista previa…'; val.innerHTML = '';
    try {
      const r = await API.call('previsualizarOferta', datos);
      if (!r || r.exito === false) { est.textContent = ''; val.innerHTML = '<div class="wz-it error"><span class="ic">!</span><div>' + this.esc((r && r.error) || 'No se pudo armar la vista previa.') + '</div></div>'; this.$('wz-previa-marco').style.display = 'none'; return; }
      const v = r.validacion || { errores: [], avisos: [] };
      est.textContent = 'Vista previa de ' + r.paginas + ' páginas' + (this.solarDemo ? ' — DATOS DE DEMOSTRACIÓN' : '') + '. No se consumió ningún consecutivo.';
      val.innerHTML = (v.errores || []).map(e => '<div class="wz-it error"><span class="ic">!</span><div>El documento no se podrá emitir: ' + this.esc(e) + '</div></div>').join('') + (v.avisos || []).map(e => '<div class="wz-it aviso"><span class="ic">•</span><div>' + this.esc(e) + '</div></div>').join('');
      const marco = this.$('wz-previa-marco'), fr = this.$('wz-previa'); marco.style.display = 'block';
      fr.onload = () => { try { const doc = fr.contentDocument; const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight); fr.style.height = h + 'px'; const k = Math.min(1, (marco.clientWidth - 24) / 794); fr.style.transform = 'scale(' + k + ')'; marco.style.height = (h * k + 24) + 'px'; } catch (e) {} };
      fr.srcdoc = r.html.replace('</head>', '<style>html,body{margin:0;background:#E5E9F0}.pg{margin:0 0 14px 0}body{width:794px}</style></head>'); this._previaVigente = true;
    } catch (e) { est.textContent = ''; val.innerHTML = '<div class="wz-it error"><span class="ic">!</span><div>' + this.esc(e.message || e) + '</div></div>'; }
    finally { btn.disabled = false; }
  },

  // ───────────────────────── Generación ─────────────────────────
  async generar(btn) {
    const errs = this.revisar().filter(x => x.nivel === 'error');
    if (errs.length) { this.mostrarAlerta('Corrija estos puntos antes de generar:', errs); this.pintarChecklist(); return; }
    await OFERTAS.generarDocumento(btn);
    try { const id = this.val('of-consecutivo'), h = (OFERTAS.DB.historial || []).find(x => String(x.ID_OFERTA) === id); if (h && h.ESTADO === 'GENERADA') { localStorage.removeItem(this.CLAVE_LOCAL); } } catch (e) {}
  }
};
document.addEventListener('DOMContentLoaded', () => WIZ.init());
if (document.readyState !== 'loading') WIZ.init();
