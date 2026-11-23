/**
 * NODIA — Lector del informe PDF de PVsyst (se ejecuta en el navegador; el PDF no sale del equipo).
 *  - PVSYST.leerPdf(archivo)  → lee el PDF con pdf.js y devuelve las líneas de texto.
 *  - PVSYST.parsear(lineas)   → extrae los datos del sistema y la producción mensual, y los VERIFICA contra el propio informe
 *                               (la suma de los 12 meses debe coincidir con el total anual y con la «energía producida»).
 * Regla del sistema: nada se estima. Si un dato no está en el informe, queda vacío y se avisa; si no cuadra, se rechaza.
 */
(function (raiz) {
  'use strict';
  const MESES = [['enero', 'january'], ['febrero', 'february'], ['marzo', 'march'], ['abril', 'april'], ['mayo', 'may'], ['junio', 'june'], ['julio', 'july'], ['agosto', 'august'], ['septiembre', 'september', 'setiembre'], ['octubre', 'october'], ['noviembre', 'november'], ['diciembre', 'december']];
  const SEP = ' | ';
  const num = s => { const n = parseFloat(String(s).replace(/,/g, '.').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const celdas = l => String(l).split(SEP).map(s => s.trim());
  const redondeo = (n, d) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };

  /** Agrupa los textos de una página en líneas (por posición vertical) y devuelve las líneas con las celdas unidas por « | ». */
  function lineasDePagina(items) {
    const t = items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    t.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = [];
    t.forEach(it => { const l = lineas.find(l => Math.abs(l.y - it.y) < 2.5); if (l) l.items.push(it); else lineas.push({ y: it.y, items: [it] }); });
    lineas.sort((a, b) => b.y - a.y);
    return lineas.map(l => { l.items.sort((a, b) => a.x - b.x); return l.items.map(i => i.s).join(SEP); });
  }

  const PDFJS_VERSION = '3.11.174', CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
  function cargarScript(src) { return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar el lector de PDF (revise la conexión a internet).')); document.head.appendChild(s); }); }
  async function prepararPdfJs() {
    if (!raiz.pdfjsLib) await cargarScript(CDN + 'pdf.min.js');
    if (!raiz.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      try { const r = await fetch(CDN + 'pdf.worker.min.js'); const b = await r.blob(); raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b); }
      catch (e) { raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.worker.min.js'; }
    }
    return raiz.pdfjsLib;
  }
  async function leerPdf(archivo) {
    const lib = await prepararPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
    const lineas = [];
    for (let p = 1; p <= doc.numPages; p++) { const pag = await doc.getPage(p); const tc = await pag.getTextContent(); lineas.push(...lineasDePagina(tc.items)); }
    return lineas;
  }

  /** Interpreta las líneas del informe. Devuelve { ok, datos, avisos[], errores[] }. */
  function parsear(lineas) {
    const avisos = [], errores = [], d = {}, L = lineas.map(String), T = L.join('\n').replace(/ \| /g, ' ');
    const buscar = (re, g) => { const m = re.exec(T); return m ? (g === undefined ? m : m[g === 0 ? 0 : g]) : null; };
    if (!/PVsyst/i.test(T) || !/Balances y resultados principales|Main results|Balances et r/i.test(T)) { return { ok: false, datos: null, avisos, errores: ['El archivo no parece un informe de simulación de PVsyst en español.'] }; }

    d.version = (buscar(/PVsyst V(\d+\.\d+(?:\.\d+)?)/, 1) || '');
    d.proyecto = ((L.find(l => /^Proyecto:/.test(l)) || '').replace(/^Proyecto:\s*/, '') || '').trim();
    d.variante = ((L.find(l => /^Variante:/.test(l)) || '').replace(/^Variante:\s*/, '') || '').trim();
    { const i = L.findIndex(l => /Fecha de simulaci/.test(l)); const m = i >= 0 ? /(\d\d)\/(\d\d)\/(\d\d)\s+\d\d:\d\d/.exec(L.slice(i, i + 3).join(' ')) : null; d.fechaSimulacion = m ? m[1] + '/' + m[2] + '/20' + m[3] : ''; }

    // Sitio, coordenadas y datos meteorológicos
    { const i = L.findIndex(l => /^Sitio geogr/.test(l)); if (i >= 0) {
        const c1 = celdas(L[i + 1] || ''), c2 = celdas(L[i + 2] || ''), c3 = celdas(L[i + 3] || '');
        d.lugar = c1[0] || ''; d.pais = c2[0] && !/^Altitud/.test(c2[0]) ? c2[0] : '';
        const la = /Latitud \| (-?[\d.]+) \| °\(([NS])\)/.exec((L[i + 1] || '')); if (la) d.latitud = num(la[1]) * (la[2] === 'S' && num(la[1]) > 0 ? -1 : 1);
        const lo = /Longitud \| (-?[\d.]+) \| °\(([EW])\)/.exec((L[i + 2] || '')); if (lo) d.longitud = num(lo[1]) * (lo[2] === 'W' && num(lo[1]) > 0 ? -1 : 1);
        const al = /Altitud \| (-?[\d.]+) \| m/.exec(L.slice(i, i + 5).join('\n')); if (al) d.altitud = num(al[1]);
        void c3;
      } }
    { const i = L.findIndex(l => /^Datos meteo/.test(l)); if (i >= 0) { const raw = (L[i + 2] || '').split(SEP)[0].trim(); d.meteoOriginal = raw; d.meteo = raw ? raw.split(/\s+dll/i)[0].trim() + (/sint[eé]tico/i.test(raw) ? ' (datos sintéticos)' : '') : ''; } }
    { const m = /Inclinaci[oó]n\/Azimut \| (-?[\d.]+) \/ (-?[\d.]+)\s*°/.exec(L.join('\n')); if (m) { d.inclinacion = num(m[1]); d.azimut = num(m[2]); } }

    // Necesidades del usuario (carga)
    { const i = L.findIndex(l => /Necesidades del usuario/.test(l)); const sig = i >= 0 ? celdas(L[i + 1] || '').pop() : ''; d.necesidades = sig || ''; d.cargaIlimitada = /Carga ilimitada/i.test(d.necesidades); }

    // Módulos e inversor
    { const i = L.findIndex(l => /^Fabricante \|/.test(l));
      if (i >= 0) {
        const f = celdas(L[i]), m = celdas(L[i + 1] || ''), p = L.slice(i, i + 12).find(l => /^Unidad Nom\. Potencia/.test(l)), n = L.slice(i, i + 12).find(l => /^N[uú]mero de m[oó]dulos FV/.test(l));
        d.modulo = { marca: f[1] || '', modelo: m[1] || '' }; d.inversor = { marca: f[3] || '', modelo: m[3] || '' };
        if (p) { const c = celdas(p); d.modulo.wp = num(c[1]); d.inversor.kwacUnidad = num(c[3]); }
        if (n) { const c = celdas(n); d.modulo.cantidad = num(c[1]); d.inversor.cantidad = num(c[4]); }
      } }
    { const m = /Pnom total \| ([\d.]+) \| kWp/.exec(L.join('\n')); if (m) d.kwp = num(m[1]); const m2 = /Potencia total \| ([\d.]+) \| kWca/.exec(L.join('\n')); if (m2) d.kwacTotal = num(m2[1]); }
    if (!d.modulo || !d.modulo.cantidad || !d.modulo.wp) avisos.push('No se pudo leer la cantidad o la potencia de los módulos: complételas a mano.');
    else { const calc = d.modulo.cantidad * d.modulo.wp / 1000; if (d.kwp && Math.abs(calc - d.kwp) > 0.02) errores.push('La potencia del informe (' + d.kwp + ' kWp) no coincide con módulos × potencia (' + calc.toFixed(2) + ' kWp).'); }

    // Resultados anuales
    { const m = /Energ[ií]a producida (\d+(?:[.,]\d+)?)\s*kWh\/a/.exec(T); if (m) d.energiaAnual = num(m[1]); const p = /Producci[oó]n espec[ií]fica (\d+(?:[.,]\d+)?)/.exec(T); if (p) d.produccionEspecifica = num(p[1]); const r = /Proporci[oó]n rend\. PR (\d+(?:[.,]\d+)?)/.exec(T); if (r) d.pr = num(r[1]); }

    // Tabla «Balances y resultados principales»: se leen las columnas POR NOMBRE
    { const i = L.findIndex(l => /^GlobHor \| /.test(l));
      if (i < 0) errores.push('No se encontró la tabla «Balances y resultados principales».');
      else {
        const cols = celdas(L[i]); const idx = n => cols.indexOf(n);
        const filas = []; for (let k = i + 1; k < L.length && filas.length < 14; k++) { const c = celdas(L[k]); const nm = norm(c[0]); const mi = MESES.findIndex(a => a.includes(nm)); if (mi >= 0 || nm === 'ano' || nm === 'year') { filas.push({ mes: mi, c }); if (mi < 0) break; } else if (filas.length) break; }
        const meses = filas.filter(f => f.mes >= 0), anio = filas.find(f => f.mes < 0);
        if (meses.length !== 12) errores.push('La tabla mensual del informe no tiene los 12 meses (se leyeron ' + meses.length + ').');
        else {
          const col = n => { const j = idx(n); if (j < 0) return null; const v = new Array(12).fill(null); meses.forEach(f => { v[f.mes] = num(f.c[j + 1]); }); return v.some(x => x === null) ? null : v; };
          const anual = n => { const j = idx(n); return j < 0 || !anio ? null : num(anio.c[j + 1]); };
          const eGrid = col('E_Grid'), eSolar = col('E_Solar'), eUser = col('E_User'), eFrGrid = col('EFrGrid'), eAvail = col('E_Avail'), eUnused = col('EUnused'), eArray = col('EArray');
          d.columnas = cols;
          if (!eGrid) errores.push('La tabla mensual no trae la columna E_Grid (energía inyectada a la red).');
          else {
            d.mensual = { eGrid, eArray, eSolar, eUser, eFrGrid, eAvail, eUnused };
            if (eSolar) { d.mensual.generacion = eGrid.map((g, k) => g + eSolar[k]); d.mensual.autoconsumo = eSolar.slice(); d.mensual.excedentes = eGrid.slice(); d.conCarga = true; }
            else { d.mensual.generacion = eGrid.slice(); d.mensual.autoconsumo = null; d.mensual.excedentes = null; d.conCarga = false; }
            const sumaGen = d.mensual.generacion.reduce((a, b) => a + b, 0);
            const totalTabla = eSolar ? (anual('E_Grid') || 0) + (anual('E_Solar') || 0) : anual('E_Grid');
            d.generacionAnual = sumaGen;
            if (totalTabla !== null && Math.abs(totalTabla - sumaGen) > 3) errores.push('La suma de los 12 meses (' + Math.round(sumaGen) + ' kWh) no coincide con el total anual de la tabla (' + totalTabla + ' kWh).');
            if (d.energiaAnual && !eSolar && Math.abs(d.energiaAnual - sumaGen) > 3) errores.push('La suma de los 12 meses (' + Math.round(sumaGen) + ' kWh) no coincide con la energía producida del resumen (' + d.energiaAnual + ' kWh).');
            if (eAvail && eSolar && eUnused) { const dif = eAvail.reduce((a, v, k) => a + Math.abs(v - eSolar[k] - eGrid[k] - eUnused[k]), 0); if (dif > 12) avisos.push('E_Avail no es igual a E_Solar + E_Grid + EUnused (diferencia ' + Math.round(dif) + ' kWh): revise el informe.'); }
            if (eUnused && eUnused.some(v => v > 0.5)) avisos.push('El informe indica energía no utilizada (EUnused): no se cuenta como generación aprovechada.');
            if (d.conCarga && eUser) d.mensual.consumo = eUser.slice();
          }
        }
      } }

    // Envejecimiento (degradación)
    { const j = L.findIndex(l => /^Lapso de tiempo de la simulaci/.test(l)); const m = j >= 0 ? /(\d+)\s*a[nñ]os/.exec(L[j]) : null; const horizonte = m ? Number(m[1]) : null;
      const k = L.findIndex(l => /^EUseful \|/.test(l)); const euse = []; if (k >= 0) for (let q = k + 1; q < L.length; q++) { const c = celdas(L[q]); if (/^\d{1,2}$/.test(c[0]) && /^\d+\.\d{2}$/.test(c[1] || '')) euse[Number(c[0])] = num(c[1]); else if (euse.length) break; }
      const par = /Factor de p[eé]rdida \| ([\d.]+) %\/a[nñ]o/.exec(L.join('\n'));
      const imp = /Dispersi[oó]n Imp RMS \| ([\d.]+)/.exec(L.join('\n')), vmp = /Dispersi[oó]n Vmp RMS \| ([\d.]+)/.exec(L.join('\n'));
      // Serie completa de la tabla: año, energía útil (MWh), PR (%) y pérdida de PR acumulada (%)
      const serie = []; if (k >= 0) for (let q = k + 1; q < L.length; q++) { const c = celdas(L[q]); if (/^\d{1,2}$/.test(c[0]) && /^\d+\.\d{2}$/.test(c[1] || '')) serie.push({ anio: Number(c[0]), euseMWh: num(c[1]), pr: num(c[2]), perdidaPrPct: num(c[3]) }); else if (serie.length) break; }
      // TRES magnitudes distintas (no se mezclan ni se sustituyen entre sí):
      //  A) parametroModuloPct  → valor EXTRAÍDO del informe (degradación media del módulo).
      //  B) serie               → valores EXTRAÍDOS de la tabla de envejecimiento (incluye todas las pérdidas que PVsyst suma con los años).
      //  C) equivalente*        → CÁLCULO PROPIO a partir de B (tasa anual compuesta entre el año 1 y el último); no es un dato de PVsyst.
      d.envejecimiento = { horizonte, parametroModuloPct: par ? num(par[1]) : null, parametroPct: par ? num(par[1]) : null, dispersionImpRmsPct: imp ? num(imp[1]) : null, dispersionVmpRmsPct: vmp ? num(vmp[1]) : null, euse, serie };
      const n = euse.length - 1; if (n >= 2 && euse[1] && euse[n]) {
        d.envejecimiento.equivalentePct = redondeo((1 - Math.pow(euse[n] / euse[1], 1 / (n - 1))) * 100, 2); d.envejecimiento.efectivaPct = d.envejecimiento.equivalentePct; d.envejecimiento.aniosTabla = n;
        const caidas = []; for (let a = 2; a <= n; a++) caidas.push((1 - euse[a] / euse[a - 1]) * 100); d.envejecimiento.caidaAnualMinPct = redondeo(Math.min(...caidas), 2); d.envejecimiento.caidaAnualMaxPct = redondeo(Math.max(...caidas), 2);
        const ult = serie[serie.length - 1]; if (ult && ult.perdidaPrPct !== null && d.envejecimiento.parametroModuloPct !== null) {
          // Pérdida lineal que explicaría SOLO el parámetro del módulo (a mitad de cada año) frente a la pérdida total de la tabla. Cálculo propio; la atribución de la diferencia NO está verificada.
          const lineal = d.envejecimiento.parametroModuloPct * (ult.anio - 0.5), total = Math.abs(ult.perdidaPrPct);
          d.envejecimiento.perdidaTotalUltimoAnioPct = redondeo(total, 2); d.envejecimiento.perdidaLinealModuloUltimoAnioPct = redondeo(lineal, 2); d.envejecimiento.perdidaAdicionalUltimoAnioPct = redondeo(total - lineal, 2);
          d.envejecimiento.diferenciaEquivalenteVsParametroPct = redondeo(d.envejecimiento.equivalentePct - d.envejecimiento.parametroModuloPct, 2);
        } }
      if (!horizonte) avisos.push('No se encontró el horizonte de la herramienta de envejecimiento.'); }

    // Procedencia de la CARGA del usuario: nunca se deduce autoconsumo ni excedentes de una simulación con carga ilimitada.
    {
      const ilimitada = /ilimitad/i.test(d.necesidades || ''), conColumnas = !!(d.mensual && d.mensual.eSolar);
      if (ilimitada && conColumnas) errores.push('El informe dice «carga ilimitada» pero trae columnas de autoconsumo (E_Solar): el informe es incoherente; no se usa.');
      d.cargaTipo = ilimitada ? 'ILIMITADA' : (conColumnas ? 'DEFINIDA' : (d.necesidades ? 'DEFINIDA_SIN_BALANCE' : 'NO_DETERMINADA'));
      d.perfilCarga = { tipo: d.cargaTipo, descripcion: d.necesidades || '', consumoAnualKWh: d.mensual && d.mensual.consumo ? d.mensual.consumo.reduce((a, b) => a + b, 0) : null, consumoMensualKWh: d.mensual && d.mensual.consumo ? d.mensual.consumo.slice() : null };
      if (d.cargaTipo === 'ILIMITADA') avisos.push('Simulación con carga ilimitada: la «energía inyectada» (E_Grid) es TODA la producción; NO son excedentes del cliente y no se usa para ahorro.');
      if (d.cargaTipo === 'DEFINIDA_SIN_BALANCE') avisos.push('El informe tiene una carga definida («' + d.necesidades + '») pero su tabla no trae el balance (E_Solar/E_User): no se pueden obtener autoconsumo ni excedentes de él.');
      if (d.cargaTipo === 'NO_DETERMINADA') avisos.push('No se pudo determinar el tipo de carga de la simulación: no se usan autoconsumo ni excedentes.');
      if (d.cargaTipo === 'DEFINIDA') avisos.push('El informe trae la carga del usuario («' + d.necesidades + '»): autoconsumo y excedentes salen de las columnas E_Solar y E_Grid del propio informe.');
      if (d.cargaTipo !== 'DEFINIDA' && d.mensual) { d.conCarga = false; d.mensual.autoconsumo = null; d.mensual.excedentes = null; }
    }
    return { ok: errores.length === 0, datos: d, avisos, errores };
  }

  /**
   * Huella SHA-256 del archivo original. Sirve para IDENTIFICAR el archivo y verificar la coherencia de los datos enviados con los extraídos de él;
   * NO es una certificación independiente del contenido original de PVsyst (no hay firma ni validación del fabricante).
   */
  async function sha256(archivo) {
    const buf = await archivo.arrayBuffer(); const h = await (raiz.crypto || require('crypto').webcrypto).subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** SHA-256 (hex) de un texto UTF-8. */
  async function sha256Texto(texto) {
    const h = await (raiz.crypto || require('crypto').webcrypto).subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /**
   * Cadena canónica de los datos energéticos extraídos del informe (generación, autoconsumo, excedentes y perfil de carga mensual).
   * Su huella viaja con la oferta y el servidor la recalcula: si los números impresos no son los extraídos del archivo identificado, la oferta se rechaza.
   * Verifica COHERENCIA de los datos enviados; no certifica de forma independiente el contenido original del informe de PVsyst (quien recalcule la huella a propósito con datos falsos no queda impedido).
   */
  function cadenaDatos(gen, auto, exc, perfil) { return 'G:' + (gen || []).join(',') + '|A:' + (auto || []).join(',') + '|E:' + (exc || []).join(',') + '|U:' + (perfil || []).join(','); }

  raiz.PVSYST = { leerPdf, parsear, lineasDePagina, sha256, sha256Texto, cadenaDatos, MESES };
  if (typeof module !== 'undefined' && module.exports) module.exports = raiz.PVSYST;
})(typeof window !== 'undefined' ? window : globalThis);
