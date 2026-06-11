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

  // Llamada principal — async/await
  async call(action, params = {}) {
    const url = this.url;

    if (!url) {
      UI.toast('⚠️ API no configurada. Agrega la URL del backend en CONFIG.apiUrl', 'warn');
      throw new Error('API_URL no configurada');
    }

    try {
      // GET con parámetros en URL — evita problemas de CORS con GAS
      const paramsStr = encodeURIComponent(JSON.stringify(params));
      const fullUrl   = `${url}?action=${encodeURIComponent(action)}&params=${paramsStr}`;

      const res  = await fetch(fullUrl, { redirect: 'follow' });
      const json = await res.json();

      if (!json.ok) throw new Error(json.error || 'Error en el servidor');
      return json.data;

    } catch (err) {
      console.error('[API]', action, err.message);
      throw err;
    }
  }
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

  confirmar(msg) { return window.confirm(msg); },

  moneda(n) {
    return '$ ' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
};
