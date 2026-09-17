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

  // Llamada principal — async/await
  async call(action, params = {}) {
    const url = this.url;

    if (!url) {
      UI.toast('⚠️ API no configurada. Copia js/config.example.js a js/config.js y completa apiUrl/apiKey', 'warn');
      throw new Error('API_URL no configurada');
    }
    if (!this.key) {
      UI.toast('⚠️ Falta CONFIG.apiKey — la API rechazará la petición', 'warn');
    }

    // Google a veces falla al abrir el archivo de Sheets del lado de
    // ellos y devuelve una página de error HTML en vez de JSON (el fetch
    // falla, o res.json() truena con "Unexpected token '<'") — confirmado
    // que es intermitente y del lado de Google (se reprodujo igual en dos
    // deployments distintos, sin relación con nuestro código). Reintentar
    // una vez con una pausa corta suele resolverlo solo. Nunca reintenta
    // errores de negocio reales (permiso denegado, validación, etc.) —
    // esos ya llegan como JSON válido con json.ok===false, no entran aquí.
    const MAX_INTENTOS = 2;
    let ultimoError;

    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        // GET con parámetros en URL — evita problemas de CORS con GAS
        const paramsStr = encodeURIComponent(JSON.stringify(params));
        const fullUrl   = `${url}?action=${encodeURIComponent(action)}&params=${paramsStr}&key=${encodeURIComponent(this.key)}&token=${encodeURIComponent(this.token)}`;

        const res  = await fetch(fullUrl, { redirect: 'follow' });
        const json = await res.json();

        if (!json.ok) {
          if (json.codigo === 401 && action !== 'login') {
            // Sesión inválida/expirada: forzar de vuelta a la pantalla de
            // login en vez de dejar la app en un estado a medias.
            if (typeof AUTH !== 'undefined') AUTH.sesionExpirada();
          }
          // codigo 403 (permiso denegado) no se maneja aquí a propósito:
          // cada función que llama a la API ya tiene su propio catch que
          // muestra el mensaje — duplicar el toast aquí solo lo repetiría.
          throw new Error(json.error || 'Error en el servidor');
        }
        return json.data;

      } catch (err) {
        ultimoError = err;
        var esFalloTransitorioDeGoogle = err instanceof SyntaxError || err.name === 'TypeError';
        if (intento < MAX_INTENTOS && esFalloTransitorioDeGoogle) {
          console.warn(`[API] ${action} falló (intento ${intento}/${MAX_INTENTOS}) — reintentando:`, err.message);
          UI.toast('Google tardó en responder, reintentando...', 'warn');
          await new Promise(r => setTimeout(r, 1200));
          continue;
        }
        console.error('[API]', action, err.message);
        throw err;
      }
    }
    throw ultimoError;
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
  _clavesCache(action, params) {
    return 'senerpot_cache_' + action + ':' + JSON.stringify(params || {});
  },

  async callCached(action, params = {}, ttlSegundos = 180) {
    const clave = this._clavesCache(action, params);
    try {
      const raw = localStorage.getItem(clave);
      if (raw) {
        const { t, data } = JSON.parse(raw);
        if (Date.now() - t < ttlSegundos * 1000) return data;
      }
    } catch(e) {}
    const data = await this.call(action, params);
    try { localStorage.setItem(clave, JSON.stringify({ t: Date.now(), data })); } catch(e) {}
    return data;
  },

  // Borra una entrada específica de la caché — usar después de cualquier
  // acción que cambie los datos que esa consulta trae, para que la
  // próxima vez que se pida no devuelva algo desactualizado.
  clearCache(action, params = {}) {
    try { localStorage.removeItem(this._clavesCache(action, params)); } catch(e) {}
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
  obtener() {
    if (!this._promesa) this._promesa = API.callCached('obtenerDatos', {}, 180);
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
    el._t = setTimeout(() => el.style.opacity = '0', 3500);
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
