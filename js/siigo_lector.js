/**
 * SENERPOT — Lector de facturas electrónicas de venta emitidas en Siigo (se ejecuta en el navegador).
 *
 * Fuente de verdad: el QR de la DIAN que trae toda factura electrónica (número, fecha, NIT emisor, NIT adquirente,
 * base, IVA, total y CUFE). El texto de la factura (capa de texto del PDF, o OCR si el PDF es una imagen) solo
 * COMPLEMENTA (nombre del cliente, líneas, retenciones, vencimiento) y se CRUZA contra el QR:
 *   · base e IVA del texto deben ser iguales a los del QR;
 *   · base + IVA − retenciones debe ser igual al «Total a pagar».
 * Regla del sistema (igual que el lector de PVsyst): nada se estima. Lo que no se puede verificar se rechaza o se avisa.
 *
 * API:  SIIGO_LECTOR.leerArchivo(file, onProgreso) → { texto: [líneas], qr: {…}|null, via: 'texto'|'ocr', hash }
 *       SIIGO_LECTOR.parsearQR(texto) · SIIGO_LECTOR.parsear(líneas, qr) · SIIGO_LECTOR.dinero(s)
 * Las funciones puras (parsearQR, parsear, dinero) también se exportan a Node para las pruebas automáticas.
 */
(function (raiz) {
  'use strict';
  const SEP = ' | ';
  const PDFJS_VERSION = '3.11.174', CDN_PDF = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
  const URL_JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  const URL_TESSERACT = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';

  // ───────────────────────── Funciones puras ─────────────────────────
  /** '2,415,000.00' · '2,500.000.00' (coma leída como punto por el OCR) · '2.415.000,00' · '475000' → número. Si no es dinero → null. */
  function dinero(s) {
    s = String(s == null ? '' : s).replace(/[^\d.,]/g, '');
    if (!s) return null;
    const m = /^(.*?)[.,](\d{2})$/.exec(s);          // los dos últimos dígitos tras el último separador son los decimales
    const ent = (m ? m[1] : s).replace(/[.,]/g, '');
    if (!ent) return null;
    return Math.round((parseInt(ent, 10) + (m ? parseInt(m[2], 10) / 100 : 0)) * 100) / 100;
  }
  const redondear = n => Math.round(n * 100) / 100;
  const fm = n => '$ ' + Number(n).toLocaleString('es-CO');
  const soloDigitos = s => String(s || '').replace(/\D/g, '');

  /** Texto del QR de la DIAN → objeto. Devuelve null si no tiene la estructura de una factura electrónica. */
  function parsearQR(texto) {
    if (!texto) return null;
    const campo = k => { const m = new RegExp('(?:^|\\n)\\s*' + k + '\\s*:\\s*([^\\n\\r]*)', 'i').exec(String(texto)); return m ? m[1].trim() : ''; };
    const q = {
      numero: campo('NumFac'), fecha: campo('FecFac'), hora: campo('HorFac'), nitEmisor: soloDigitos(campo('NitFac')),
      nitAdquirente: soloDigitos(campo('DocAdq')), base: dinero(campo('ValFac')), iva: dinero(campo('ValIva')),
      otrosImpuestos: dinero(campo('ValOtroIm')), totalFactura: dinero(campo('ValTolFac')), cufe: campo('CUFE').toLowerCase()
    };
    if (!q.numero || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha) || !q.nitEmisor || q.base == null || q.iva == null || q.totalFactura == null) return null;
    q.cufeValido = /^[0-9a-f]{96}$/.test(q.cufe);
    return q;
  }

  /**
   * Interpreta las líneas de texto de la factura y las cruza con el QR.
   * Devuelve { factura, checks[], avisos[], errores[], ok }.  ok=false si hay algún error (no se debe importar).
   */
  function parsear(lineas, qr) {
    const avisos = [], errores = [], checks = [];
    const L = (lineas || []).map(l => String(l).replace(/\s\|\s/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const checkear = (ok, texto, esError) => { checks.push({ ok: !!ok, texto }); if (!ok) (esError === false ? avisos : errores).push(texto); return !!ok; };

    if (!qr) { errores.push('No se pudo leer el código QR de la factura. Suba el PDF original descargado de Siigo (no una foto ni una captura borrosa).'); return { factura: null, checks, avisos, errores, ok: false }; }
    checkear(qr.cufeValido, qr.cufeValido ? 'CUFE leído del QR (96 caracteres)' : 'El CUFE del QR no tiene el formato correcto (96 caracteres hexadecimales).');
    checkear(Math.abs(redondear(qr.base + qr.iva) - qr.totalFactura) < 0.01, 'El QR es coherente: base + IVA = total de la factura (' + fm(qr.totalFactura) + ')', true);

    const T = L.join(' ');
    const iFin = L.findIndex(l => /^Total\s*items/i.test(l));
    const iObs = L.findIndex(l => /^Observaciones/i.test(l));
    const iHeader = L.findIndex(l => /Descripci[oó]n.*Cantidad.*Vr\.?\s*Total/i.test(l));
    const zonaTotales = L.slice(iFin >= 0 ? iFin : 0, iObs >= 0 ? iObs : L.length).join(' ');
    const MONEDA = '(\\d[\\d.,]*[.,]\\d{2})(?!\\d)';

    // ── Totales impresos ──
    const f = { numero: qr.numero, fecha: qr.fecha, nitEmisor: qr.nitEmisor, nitCliente: qr.nitAdquirente, cufe: qr.cufe };
    const mBruto = new RegExp('Total\\s*Bruto\\s+' + MONEDA, 'i').exec(zonaTotales);
    const mIva = new RegExp('IVA\\s*(\\d{1,2}(?:[.,]\\d+)?)\\s*%\\s+' + MONEDA, 'i').exec(zonaTotales);
    const mPagar = new RegExp('Total\\s*a\\s*Pagar\\s+' + MONEDA, 'i').exec(zonaTotales);
    f.base = qr.base; f.iva = qr.iva; f.pctIva = mIva ? parseFloat(mIva[1].replace(',', '.')) : (qr.iva > 0 ? redondear(qr.iva * 100 / qr.base) : 0);
    f.retenciones = [];
    const reRet = new RegExp('Rete\\s*(fuente|ica|iva)\\s*(\\d+(?:[.,]\\d+)?)?\\s*%?\\s+' + MONEDA, 'gi');
    let r; while ((r = reRet.exec(zonaTotales))) f.retenciones.push({ tipo: ({ fuente: 'RETEFUENTE', ica: 'RETEICA', iva: 'RETEIVA' })[r[1].toLowerCase()], pct: r[2] ? parseFloat(r[2].replace(',', '.')) : null, valor: dinero(r[3]) });
    if (/Descuento/i.test(zonaTotales)) avisos.push('La factura parece traer un descuento: revise que base, IVA y total cuadren (el sistema ya los cruza con el QR).');
    f.totalPagar = mPagar ? dinero(mPagar[1]) : null;
    const sumaRet = redondear(f.retenciones.reduce((a, x) => a + (x.valor || 0), 0));

    if (mBruto) checkear(Math.abs(dinero(mBruto[1]) - qr.base) < 0.01, 'El «Total Bruto» impreso (' + fm(dinero(mBruto[1])) + ') coincide con la base del QR (' + fm(qr.base) + ')');
    else checkear(false, 'No se pudo leer el «Total Bruto» impreso: no se puede cruzar con el QR.');
    if (mIva) checkear(Math.abs(dinero(mIva[2]) - qr.iva) < 0.01, 'El IVA impreso (' + fm(dinero(mIva[2])) + ') coincide con el IVA del QR (' + fm(qr.iva) + ')');
    else if (qr.iva === 0) checks.push({ ok: true, texto: 'La factura no tiene IVA (QR: 0)' });
    else checkear(false, 'No se pudo leer el IVA impreso: no se puede cruzar con el QR.');
    if (f.totalPagar == null) checkear(false, 'No se pudo leer el «Total a Pagar».');
    else {
      checkear(Math.abs(redondear(qr.base + qr.iva - sumaRet) - f.totalPagar) < 0.01,
        'Base + IVA − retenciones = Total a pagar (' + fm(qr.base) + ' + ' + fm(qr.iva) + ' − ' + fm(sumaRet) + ' = ' + fm(redondear(qr.base + qr.iva - sumaRet)) + ' · impreso: ' + fm(f.totalPagar) + ')');
    }
    f.totalRetenciones = sumaRet;

    // ── Cliente ──
    { const l = L.find(x => /^Se[ñn]\S{0,6}\s+\S/.test(x)); let nombre = '';   // sensible a mayúsculas: no debe confundirse con «SENERPOT»
      if (l) nombre = l.replace(/^Se[ñn]\S{0,6}\s+/, '').replace(/\s+(Generaci[oó]n|NIT|Tel[eé]fono|Direcci[oó]n)\b.*$/i, '').trim();
      f.nombreCliente = nombre; f.nombreDeOcr = false;
      if (!nombre) avisos.push('No se pudo leer el nombre del cliente: escríbalo en la vista previa (el NIT sí viene verificado del QR).'); }
    { const m = /NIT\s+(\d{1,3}(?:\.\d{3}){1,3})\s*-\s*(\d)\b/g; let x, ult = null; while ((x = m.exec(T))) { if (soloDigitos(x[1]) === qr.nitAdquirente) ult = x[2]; } f.dvCliente = ult; }

    // ── Líneas de la factura ──
    f.lineas = [];
    if (iHeader >= 0 && iFin > iHeader) {
      const reNum = /\d[\d.,]*[.,]\d{2}(?!\d)/g;
      L.slice(iHeader + 1, iFin).forEach(l => {
        const nums = l.match(reNum);
        if (/^\d{1,3}\s/.test(l) && nums && nums.length >= 2) {
          const sinIdx = l.replace(/^\d{1,3}\s+[—–-]?\s*/, '');
          f.lineas.push({ n: parseInt(l, 10), descripcion: sinIdx.slice(0, sinIdx.lastIndexOf(nums[nums.length - 2])).trim(), cantidad: dinero(nums[nums.length - 2]), valorImpreso: dinero(nums[nums.length - 1]) });
        } else if (f.lineas.length && l.length >= 8 && (l.match(/[A-Za-zÁÉÍÓÚáéíóúñÑ]/g) || []).length / l.length > 0.6 && !/^Total/i.test(l)) {
          const ult = f.lineas[f.lineas.length - 1]; ult.descripcion = (ult.descripcion + ' ' + l).trim();
        }
      });
    }
    const mItems = /Total\s*items:?\s*(\d+)/i.exec(L[iFin] || '');
    if (mItems) checkear(parseInt(mItems[1], 10) === f.lineas.length, 'Líneas leídas (' + f.lineas.length + ') = «Total items» impreso (' + mItems[1] + ')', false);
    if (!f.lineas.length) { f.lineas = [{ n: 1, descripcion: 'Servicios según factura Siigo ' + qr.numero, cantidad: 1, valorImpreso: qr.base }]; avisos.push('No se pudieron leer las líneas de la factura: se registra un solo concepto por el total de la base.'); }
    // Siigo imprime el «Vr. Total» de cada línea con IVA y retención ya aplicados (p. ej. base × 1,15 = base + 19 % − 4 %).
    // Por eso la base de cada línea se REPARTE sobre el Total Bruto verificado con el QR (nunca se toma el valor impreso como base).
    const sumaImpresa = redondear(f.lineas.reduce((a, x) => a + (x.valorImpreso || 0), 0));
    let acumulado = 0;
    f.lineas.forEach((x, i) => {
      x.base = i === f.lineas.length - 1 ? redondear(qr.base - acumulado) : redondear((x.valorImpreso || 0) * qr.base / (sumaImpresa || 1));
      acumulado = redondear(acumulado + x.base);
    });
    if (sumaImpresa && Math.abs(sumaImpresa - qr.base) > 0.01) {
      const factorEsperado = f.totalPagar ? f.totalPagar / qr.base : null;
      if (factorEsperado && Math.abs(sumaImpresa - f.totalPagar) < 0.5) avisos.push('Siigo muestra cada línea con IVA y retención incluidos; la base de cada línea se repartió sobre el Total Bruto verificado con el QR.');
      else avisos.push('La suma de las líneas impresas (' + sumaImpresa + ') no es la base ni el total a pagar: la base de cada línea se repartió en proporción sobre el Total Bruto del QR. Revise la distribución.');
    }
    if (f.lineas.some(x => x.base <= 0)) errores.push('Alguna línea quedó con base cero o negativa: revise la factura.');

    // ── Fechas, forma de pago, observaciones ──
    { const m = /Vencimiento\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(T) || null; let venc = m ? m[3] + '-' + m[2] + '-' + m[1] : '';
      if (!venc) { const m2 = /vence\s+el\s+(\d{4}-\d{2}-\d{2})/i.exec(T); venc = m2 ? m2[1] : ''; }
      f.fechaVence = venc && venc >= qr.fecha ? venc : '';
      if (venc && venc < qr.fecha) avisos.push('El vencimiento impreso (' + venc + ') es anterior a la fecha de la factura: se ignora.');
      if (!venc) avisos.push('No se pudo leer el vencimiento: se usará la fecha de la factura (plazo 0).');
      f.plazoDias = f.fechaVence ? Math.round((Date.parse(f.fechaVence) - Date.parse(qr.fecha)) / 86400000) : 0; }
    { const i = T.search(/Forma\s*de\s*pago/i); const tr = i >= 0 ? T.slice(i, i + 160) : ''; f.formaPago = /Cr[eé]dito/i.test(tr) ? 'CREDITO' : /Contado/i.test(tr) ? 'CONTADO' : '';
      if (f.formaPago === 'CONTADO') avisos.push('Factura de CONTADO: el cobro NO se registra solo. Quedará pendiente en cartera hasta que se registre el Recibo de Caja.'); }
    if (iObs >= 0) {
      const iFinObs = L.findIndex((l, i) => i > iObs && /^A esta factura/i.test(l));
      let o = ''; L.slice(iObs, iFinObs > iObs ? iFinObs : iObs + 4).forEach((l, i) => { l = i === 0 ? l.replace(/^Observaciones:?\s*/i, '') : l; o += (o && !/-$/.test(o) ? ' ' : '') + l; });
      f.observaciones = o.trim();
    } else f.observaciones = '';
    { const m = /\bOferta\s+([A-Z]{2,6}-\d{2}-\d{2,5})/i.exec(f.observaciones); f.ofertaRef = m ? m[1].toUpperCase() : ''; }
    f.ok = errores.length === 0;
    return { factura: f, checks, avisos, errores, ok: errores.length === 0 };
  }

  // ───────────────────────── Lectura del archivo (solo navegador) ─────────────────────────
  function cargarScript(src, msg) { return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => mal(new Error(msg || ('No se pudo cargar ' + src))); document.head.appendChild(s); }); }
  async function prepararPdfJs() {
    if (!raiz.pdfjsLib) await cargarScript(CDN_PDF + 'pdf.min.js', 'No se pudo cargar el lector de PDF (revise la conexión a internet).');
    if (!raiz.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      try { const r = await fetch(CDN_PDF + 'pdf.worker.min.js'); const b = await r.blob(); raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b); }
      catch (e) { raiz.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_PDF + 'pdf.worker.min.js'; }
    }
    return raiz.pdfjsLib;
  }
  function lineasDePagina(items) {
    const t = items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    t.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = [];
    t.forEach(it => { const l = lineas.find(l => Math.abs(l.y - it.y) < 2.5); if (l) l.items.push(it); else lineas.push({ y: it.y, items: [it] }); });
    lineas.sort((a, b) => b.y - a.y);
    return lineas.map(l => { l.items.sort((a, b) => a.x - b.x); return l.items.map(i => i.s).join(SEP); });
  }
  async function huellaSHA256(buffer) {
    const h = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function leerQR(canvasDe) {
    if (!raiz.jsQR) await cargarScript(URL_JSQR, 'No se pudo cargar el lector de códigos QR (revise la conexión a internet).');
    for (const escala of [3, 4, 2, 5]) {          // el QR de Siigo se lee mejor entre 3× y 4×; se prueba en ese orden
      const cv = await canvasDe(escala); const ctx = cv.getContext('2d', { willReadFrequently: true });
      const img = ctx.getImageData(0, 0, cv.width, cv.height);
      const r = raiz.jsQR(img.data, img.width, img.height);
      if (r && r.data) return { texto: r.data, canvas: cv };
    }
    return { texto: '', canvas: null };
  }

  async function leerArchivo(archivo, onProgreso) {
    const avisar = m => { try { onProgreso && onProgreso(m); } catch (e) {} };
    const buf = await archivo.arrayBuffer();
    const hash = await huellaSHA256(buf);
    let canvasDe, lineas = [], via = 'texto';
    if (/^image\//.test(archivo.type)) {
      const bmp = await createImageBitmap(new Blob([buf], { type: archivo.type }));
      canvasDe = async escala => { const cv = document.createElement('canvas'); const e = Math.min(escala / 3, 1.5); cv.width = Math.round(bmp.width * e); cv.height = Math.round(bmp.height * e); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); return cv; };
      via = 'ocr';
    } else {
      avisar('Abriendo el PDF…');
      const lib = await prepararPdfJs();
      const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      if (doc.numPages > 3) throw new Error('El archivo tiene ' + doc.numPages + ' páginas: una factura de Siigo debe tener 1 (suba una factura a la vez).');
      const pag = await doc.getPage(1);
      for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); lineas.push(...lineasDePagina(tc.items)); }
      canvasDe = async escala => { const vp = pag.getViewport({ scale: escala }); const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; return cv; };
    }
    avisar('Leyendo el código QR de la DIAN…');
    const rq = await leerQR(canvasDe);
    const qr = parsearQR(rq.texto);
    if (lineas.join('').replace(/\s/g, '').length < 80) {      // PDF sin capa de texto (impreso como imagen): OCR
      via = 'ocr';
      avisar('El PDF es una imagen: leyendo el texto por OCR (la primera vez descarga el idioma, puede tardar un minuto)…');
      if (!raiz.Tesseract) await cargarScript(URL_TESSERACT, 'No se pudo cargar el lector OCR (revise la conexión a internet).');
      const cv = rq.canvas || await canvasDe(3);
      const w = await raiz.Tesseract.createWorker('spa', 1, { logger: m => { if (m && m.status === 'recognizing text') avisar('Leyendo el texto (OCR) ' + Math.round(m.progress * 100) + ' %'); } });
      try { const r = await w.recognize(cv); lineas = String(r.data.text || '').split(/\r?\n/); } finally { await w.terminate(); }
    }
    return { texto: lineas, qr, qrTexto: rq.texto, via, hash, nombreArchivo: archivo.name, tamano: archivo.size };
  }

  const API_PUBLICA = { dinero, parsearQR, parsear, leerArchivo, redondear };
  raiz.SIIGO_LECTOR = API_PUBLICA;
  if (typeof module !== 'undefined' && module.exports) module.exports = API_PUBLICA;
})(typeof window !== 'undefined' ? window : globalThis);
