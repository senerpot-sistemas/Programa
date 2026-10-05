/**
 * SENERPOT — api.js
 * Capa de comunicación con el backend (Google Apps Script).
 * Usa GET con parámetros en la URL — más compatible con GAS desde dominios externos.
 *
 * USO:
 *   const datos = await API.call('obtenerDatos');
 *   const res   = await API.call('guardarCliente', { empresa: 'ABC', nit: '123' });
 */

const API = {

  get url() {
    return (typeof CONFIG !== 'undefined' && CONFIG.apiUrl) ? CONFIG.apiUrl : '';
  },

  get key() {
    return (typeof CONFIG !== 'undefined' && CONFIG.apiKey) ? CONFIG.apiKey : '';
  },

  // Token de sesión de usuario (distinto de apiKey — apiKey identifica a
  // la app, token identifica a la persona y su rol). Se guarda en
  // sessionStorage: sobrevive a un refresh de la página, pero se pierde
  // al cerrar la pestaña — más seguro que localStorage en un equipo
  // compartido, sin obligar a re-loguear en cada F5.
  get token() {
    return sessionStorage.getItem('senerpot_token') || '';
  },

  // ── CLASIFICACIÓN DE ACCIONES ─────────────────────────────
  // Lista blanca de acciones de SOLO LECTURA: son las únicas que se pueden
  // volver a pedir sin riesgo si la respuesta no llega. Cualquier acción
  // que NO esté aquí (incluida una nueva que alguien agregue y olvide
  // registrar) se trata como ESCRITURA: se envía UNA sola vez y nunca se
  // reintenta sola — el servidor pudo haberla ejecutado aunque el navegador
  // no haya recibido la respuesta (el script de Apps Script termina bien
  // incluso cuando la entrega de Google falla con 404).
  ACCIONES_LECTURA: [
    'obtenerDatos', 'obtenerDatosERP', 'getDashboard', 'obtenerDetalleOferta',
    'obtenerDetalleNCR', 'obtenerPresupuestoProyecto', 'obtenerComentariosProyecto',
    'consultarHistorial', 'obtenerBancos', 'generarReporte', 'listarUsuarios',
    'obtenerProyectos', 'obtenerDetalleProyecto', 'obtenerAlmacen',
    'cargarDocEdicion', 'calcularIVA', 'calcularRenta'
  ],

  // login es la única "escritura" que sí se reintenta: lo único que hace en
  // el servidor es agregar una fila de sesión, así que repetirlo no duplica
  // ningún dato de negocio (a lo sumo queda una sesión sin usar que vence sola).
  esReintentable(action) {
    return this.ACCIONES_LECTURA.indexOf(action) !== -1 || action === 'login';
  },

  TIMEOUT_LECTURA_MS:       30000,        // por intento
  TIMEOUT_ESCRITURA_MS:     120000,       // una sola vez; cortar solo libera al navegador, no cancela al servidor
  ESPERAS_REINTENTO_MS:     [1500, 3000], // entre intento 1→2 y 2→3 (3 intentos en total)
  BLOQUEO_NO_CONFIRMADA_MS: 30000,        // tras un resultado desconocido, no se acepta el mismo envío idéntico
  MSG_NO_CONFIRMADO: 'Resultado no confirmado. La operación pudo haberse realizado en el servidor. Verifica el estado antes de volver a intentarlo.',
  MSG_SIN_CONEXION:  'No se pudo conectar con el servidor después de varios intentos. Revisa tu conexión a internet y vuelve a intentarlo en un momento.',

  // Escrituras con resultado desconocido: "acción|parámetros" -> hasta cuándo se bloquea.
  _noConfirmadas: {},

  _errorNoConfirmado(extra) {
    const e = new Error(this.MSG_NO_CONFIRMADO + (extra || ''));
    e.resultadoNoConfirmado = true;
    return e;
  },

  // Llamada principal — async/await
  // opciones.silencioso: solo suprime el aviso visual "Conexión lenta, reintentando..." (lo usa la
  // precarga automática del Home). No cambia timeouts, reintentos ni resultados; sin la opción, todo igual.
  async call(action, params = {}, opciones = {}) {
    const url = this.url;

    if (!url) {
      UI.toast('⚠️ API no configurada. Copia js/config.example.js a js/config.js y completa apiUrl/apiKey', 'warn');
      throw new Error('API_URL no configurada');
    }
    if (!this.key) {
      UI.toast('⚠️ Falta CONFIG.apiKey — la API rechazará la petición', 'warn');
    }

    const reintentable = this.esReintentable(action);
    const tokenUsado   = this.token; // con qué sesión se envió esta petición

    // Una escritura que ya terminó sin confirmación no se vuelve a aceptar
    // idéntica de inmediato: da tiempo a verificar el estado real (actualizar
    // la lista, revisar el historial) antes de repetirla a ciegas.
    const claveNoConf = reintentable ? null : action + '|' + JSON.stringify(params);
    if (claveNoConf) {
      const hasta = this._noConfirmadas[claveNoConf];
      if (hasta && Date.now() < hasta) {
        throw this._errorNoConfirmado(' (espera ' + Math.ceil((hasta - Date.now()) / 1000) + ' s)');
      }
      delete this._noConfirmadas[claveNoConf];
    }

    // GET con parámetros en URL — evita problemas de CORS con GAS
    const paramsStr = encodeURIComponent(JSON.stringify(params));
    const fullUrl   = `${url}?action=${encodeURIComponent(action)}&params=${paramsStr}&key=${encodeURIComponent(this.key)}&token=${encodeURIComponent(this.token)}`;

    // Google a veces responde 404 / HTML / 500 o se queda colgado en la capa
    // de entrega de Apps Script, intermitente y ajeno a nuestro código.
    // Lecturas: hasta 3 intentos de 30 s cada uno. Escrituras: un solo
    // intento. Los errores de negocio (ok:false, 401, 403) son respuestas
    // válidas del servidor y NUNCA se reintentan.
    const maxIntentos = reintentable ? this.ESPERAS_REINTENTO_MS.length + 1 : 1;
    const timeoutMs   = reintentable ? this.TIMEOUT_LECTURA_MS : this.TIMEOUT_ESCRITURA_MS;
    let json = null, fallo = null;

    for (let intento = 1; intento <= maxIntentos; intento++) {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(fullUrl, { redirect: 'follow', signal: ctrl.signal });
        if (res.status === 401 || res.status === 403) {
          const e = new Error('Acceso denegado (HTTP ' + res.status + ')');
          e.definitivo = true;
          throw e;
        }
        if (res.status === 404 || res.status >= 500) {
          const e = new Error('HTTP ' + res.status);
          e.httpTransitorio = true;
          throw e;
        }
        json = await res.json();
        if (json === null || typeof json !== 'object') throw new SyntaxError('La respuesta no es un objeto JSON');
        fallo = null;
        break;
      } catch (err) {
        fallo = err;
        const transitorio = !err.definitivo && (err.name === 'AbortError' || err instanceof TypeError || err instanceof SyntaxError || err.httpTransitorio === true);
        if (reintentable && transitorio && intento < maxIntentos) {
          console.warn(`[API] ${action} falló (intento ${intento}/${maxIntentos}) — reintentando:`, err.message);
          if (!opciones.silencioso) UI.toast('Conexión lenta, reintentando...', 'warn');
          await new Promise(r => setTimeout(r, this.ESPERAS_REINTENTO_MS[intento - 1]));
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (fallo) {
      console.error('[API]', action, fallo.message);
      if (fallo.definitivo) throw fallo;
      if (!reintentable) {
        // No se sabe si el servidor llegó a ejecutarla: NO se repite sola.
        this._noConfirmadas[claveNoConf] = Date.now() + this.BLOQUEO_NO_CONFIRMADA_MS;
        throw this._errorNoConfirmado();
      }
      // "Unexpected token" / errores de red crudos no significan nada para
      // alguien que no programa — se cambia por un mensaje que sí se entiende.
      throw new Error(this.MSG_SIN_CONEXION);
    }

    if (!json.ok) {
      if (json.codigo === 401 && action !== 'login') {
        // Sesión inválida/expirada: forzar de vuelta a la pantalla de
        // login en vez de dejar la app en un estado a medias. Solo si la
        // sesión sigue siendo la misma con la que se envió: una respuesta
        // tardía de una sesión ya cerrada no debe sacar a quien entró después.
        if (typeof AUTH !== 'undefined' && tokenUsado === this.token) AUTH.sesionExpirada();
      }
      // codigo 403 (permiso denegado) no se maneja aquí a propósito:
      // cada función que llama a la API ya tiene su propio catch que
      // muestra el mensaje — duplicar el toast aquí solo lo repetiría.
      throw new Error(json.error || 'Error en el servidor');
    }
    return json.data;
  },

  // ── CACHÉ LOCAL, solo para lecturas pesadas ──────────────
  // obtenerDatos/obtenerDatosERP/getDashboard traen listados completos
  // (el PUC solo ya son ~2.400 cuentas) — pedirlos de cero cada vez que se
  // abre una pestaña nueva o se recarga la página es la causa real de que
  // el Panel (y en general, entrar a cualquier módulo por primera vez) se
  // sienta lento. Si ya se pidió lo mismo hace poco, se devuelve al
  // instante desde localStorage sin tocar la red; si no, se pide normal y
  // se guarda para la próxima. NUNCA se usa para acciones que escriben
  // datos (guardar, anular, crear, eliminar...) — esas siempre van
  // directo al servidor, sin caché de por medio.
  // La clave incluye al usuario: dos personas que usen el mismo navegador
  // nunca comparten una copia (ver también AUTH._limpiarSesionLocal, que
  // borra todas las claves senerpot_cache_* al cerrar sesión).
  _clavesCache(action, params) {
    let usuario = '';
    try { usuario = sessionStorage.getItem('senerpot_usuario') || ''; } catch(e) {}
    return 'senerpot_cache_' + usuario + '|' + action + ':' + JSON.stringify(params || {});
  },

  // Peticiones idénticas en vuelo: clave -> promesa compartida.
  _enVuelo: {},

  // Dos módulos que pidan lo mismo a la vez comparten UNA sola llamada de red.
  async callCached(action, params = {}, ttlSegundos = 180, opciones = {}) {
    const clave = this._clavesCache(action, params);
    try {
      const raw = localStorage.getItem(clave);
      if (raw) {
        const { t, data } = JSON.parse(raw);
        if (Date.now() - t < ttlSegundos * 1000) return data;
      }
    } catch(e) {}

    if (this._enVuelo[clave]) return this._enVuelo[clave];

    const promesa = this.call(action, params, opciones)
      .then(data => {
        // Si mientras esperábamos se invalidó esta consulta (clearCache),
        // este resultado pudo quedar viejo: se entrega pero no se guarda.
        if (this._enVuelo[clave] === promesa) {
          try { localStorage.setItem(clave, JSON.stringify({ t: Date.now(), data })); } catch(e) {}
        }
        return data;
      })
      .finally(() => { if (this._enVuelo[clave] === promesa) delete this._enVuelo[clave]; });
    this._enVuelo[clave] = promesa;
    return promesa;
  },

  // Borra una entrada específica de la caché — usar después de cualquier
  // acción que cambie los datos que esa consulta trae, para que la
  // próxima vez que se pida no devuelva algo desactualizado.
  clearCache(action, params = {}) {
    const clave = this._clavesCache(action, params);
    delete this._enVuelo[clave];
    try { localStorage.removeItem(clave); } catch(e) {}
  }
};

// ─────────────────────────────────────────────
//  STORE — parcheo de estado local (Fase 3)
//  El backend ya no devuelve el ERP completo en cada guardado/borrado —
//  devuelve solo el registro afectado. Estas funciones actualizan el
//  arreglo en memoria del módulo (DB.clientes, DB.items, etc.) con ese
//  registro, en vez de reemplazar todo el arreglo con una recarga.
// ─────────────────────────────────────────────
const Store = {

  // Crea o actualiza: si ya existe un elemento con el mismo _rowIndex se
  // FUSIONAN los campos (Object.assign) sobre el existente — no se
  // reemplaza el objeto entero, porque algunas ediciones (p. ej. Servicios)
  // solo devuelven los campos que de verdad cambiaron y perder los demás
  // sería un retroceso de datos silencioso. Si no existe, se agrega.
  upsert(arr, record) {
    if (!record) return arr;
    const idx = arr.findIndex(x => String(x._rowIndex) === String(record._rowIndex));
    if (idx === -1) arr.push(record);
    else Object.assign(arr[idx], record);
    return arr;
  },

  // Quita el elemento borrado y corrige el _rowIndex de todo lo que
  // quedó después de él: Sheets recorre las filas hacia arriba al borrar
  // (deleteRow), así que cualquier _rowIndex cacheado mayor al eliminado
  // queda desfasado en 1 — si no se corrige aquí, la próxima edición de
  // esas filas apuntaría a la fila física equivocada.
  remove(arr, rowIndexEliminado) {
    const ri = parseInt(rowIndexEliminado);
    for (let i = arr.length - 1; i >= 0; i--) {
      const filaActual = parseInt(arr[i]._rowIndex);
      if (filaActual === ri) arr.splice(i, 1);
      else if (filaActual > ri) arr[i]._rowIndex = filaActual - 1;
    }
    return arr;
  }
};

// ─────────────────────────────────────────────
//  DATOS ERP — caché compartida entre módulos
//  Ofertas y Proyectos leen el mismo obtenerDatos() (clientes, ofertas,
//  proyectos, etc.). Antes cada uno pedía su propia copia la primera vez
//  que se abría — si entrabas a Ofertas y luego a Proyectos, la app hacía
//  la misma llamada pesada a Apps Script dos veces, sintiéndose lenta al
//  cambiar de módulo. Ahora el primero que la pide la comparte con el
//  segundo — una sola llamada por sesión, no una por módulo.
// ─────────────────────────────────────────────
const DatosERP = {
  _promesa: null,
  _resuelta: false,
  _vigenteHasta: 0,
  VIGENCIA_MS: 180000, // igual que el TTL de callCached: pasado este tiempo los datos dejan de considerarse vigentes

  obtener(opciones = {}) {
    // Una promesa YA resuelta que superó su vigencia no se reutiliza: la siguiente
    // solicitud vuelve a la red. No hay refrescos automáticos; el vencimiento solo
    // se evalúa cuando alguien pide los datos. Una carga todavía en vuelo se comparte siempre.
    if (this._promesa && this._resuelta && Date.now() > this._vigenteHasta) this._promesa = null;
    if (!this._promesa) {
      const p = API.callCached('obtenerDatos', {}, 180, opciones);
      this._promesa = p;
      this._resuelta = false;
      p.then(() => {
        if (this._promesa !== p) return; // se invalidó mientras cargaba: este resultado ya no cuenta
        this._resuelta = true;
        // La vigencia se cuenta desde que el servidor entregó los datos (marca de tiempo de la
        // misma entrada de localStorage que usa callCached), no desde que se leyeron: así unos
        // datos servidos desde esa copia nunca viven más de 180 s en total.
        let t = Date.now();
        try { const raw = localStorage.getItem(API._clavesCache('obtenerDatos', {})); if (raw) t = JSON.parse(raw).t || t; } catch (e) {}
        this._vigenteHasta = t + this.VIGENCIA_MS;
      }, () => {
        // Si falla, no se conserva la promesa rechazada: la próxima vez que alguien
        // pida los datos se intenta de nuevo en vez de repetir el mismo error.
        if (this._promesa === p) this._promesa = null;
      });
    }
    return this._promesa;
  },
  // Para recargas explícitas (p. ej. OFERTAS.recargar()) — el próximo
  // obtener() vuelve a pedir datos frescos en vez de reusar la caché (ni
  // la de memoria de esta pestaña, ni la de localStorage que sobrevive a
  // un F5).
  invalidar() { this._promesa = null; API.clearCache('obtenerDatos', {}); }
};

// ─────────────────────────────────────────────
//  UI — utilidades globales de interfaz
// ─────────────────────────────────────────────
const UI = {

  toast(msg, tipo = 'ok') {
    let el = document.getElementById('toast-global');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-global';
      el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;opacity:0;transition:opacity .3s;max-width:340px;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
      document.body.appendChild(el);
    }
    const colores = {
      ok:   { bg: '#009E60', txt: '#fff' },
      err:  { bg: '#EF4444', txt: '#fff' },
      warn: { bg: '#F59E0B', txt: '#fff' },
      info: { bg: '#3B82F6', txt: '#fff' }
    };
    const c = colores[tipo] || colores.ok;
    el.style.background = c.bg;
    el.style.color       = c.txt;
    el.innerText         = msg;
    el.style.opacity     = '1';
    clearTimeout(el._t);
    // los mensajes largos (p. ej. 'Resultado no confirmado...') necesitan más tiempo de lectura
    el._t = setTimeout(() => el.style.opacity = '0', String(msg).length > 80 ? 9000 : 3500);
  },

  spin(btn, on) {
    if (!btn) return;
    if (on) { btn._txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳ Procesando...'; }
    else    { btn.disabled = false; btn.innerHTML = btn._txt || 'Listo'; }
  },

  // Como spin(), pero para botones de solo ícono en columnas angostas de
  // tabla (filas de Ofertas/Proyectos/Clientes/etc.) — no agrega texto
  // "Procesando...", solo cambia el ícono a un reloj de arena, para no
  // volver a recortar esas columnas de ancho fijo (mismo bug que ya se
  // arregló antes en esta app con las columnas de acción).
  spinIcon(btn, on) {
    if (!btn) return;
    if (on) { btn._txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = '⏳'; }
    else    { btn.disabled = false; btn.innerHTML = btn._txt || ''; }
  },

  confirmar(msg) { return window.confirm(msg); },

  // Botón del ojo en campos de contraseña — el input es el hermano
  // anterior del botón en el HTML (misma .password-wrap). Emoji en vez de
  // la fuente de íconos (ver por qué en contabilidad.js/ofertas.js — la
  // misma fuente que fallaba en el botón de Anular).
  togglePassword(btn) {
    const input = btn.previousElementSibling;
    if (!input) return;
    const verla = input.type === 'password';
    input.type = verla ? 'text' : 'password';
    btn.textContent = verla ? '🙈' : '👁️';
  },

  moneda(n) {
    return '$ ' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
};
