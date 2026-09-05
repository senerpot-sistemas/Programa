/**
 * SENERPOT — auth.js
 * Login, sesión y control de qué módulos ve cada rol.
 *
 * Importante: ocultar botones/menús aquí es solo para que la interfaz
 * tenga sentido para cada persona — la seguridad real (qué puede hacer
 * cada rol) se aplica en el servidor (ver accionPermitida() en Auth.gs).
 * Alguien con conocimientos técnicos podría saltarse lo que se oculta
 * aquí; no podría saltarse el rechazo del backend.
 */

const AUTH = {
  rol: '',
  nombre: '',
  usuario: '',

  // Qué módulos (data-modulo en el HTML) puede ver cada rol.
  MODULOS_POR_ROL: {
    ADMINISTRADOR:  ['home','panel','ofertas','proyectos','contabilidad','almacen','reportes','usuarios'],
    COMERCIAL:      ['home','panel','ofertas','proyectos'],
    ADMINISTRATIVO: ['home','panel','contabilidad','almacen','reportes'],
    TECNICO:        ['home','proyectos','almacen'],
    INGENIERIA:     ['home','panel','ofertas','proyectos','almacen']
  },

  init() {
    const token = sessionStorage.getItem('senerpot_token');
    const rol   = sessionStorage.getItem('senerpot_rol');
    if (token && rol) {
      this.rol     = rol;
      this.nombre  = sessionStorage.getItem('senerpot_nombre') || '';
      this.usuario = sessionStorage.getItem('senerpot_usuario') || '';
      this.mostrarApp();
    } else {
      this.mostrarLogin();
    }
  },

  mostrarLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display = 'none';
    const pass = document.getElementById('login-password');
    if (pass) pass.value = '';
  },

  mostrarApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'flex';
    this.aplicarRol();

    const NOMBRES_ROL = { ADMINISTRADOR: 'Administrador', COMERCIAL: 'Comercial', ADMINISTRATIVO: 'Administrativo', TECNICO: 'Técnico', INGENIERIA: 'Ingeniería' };
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('user-nombre-actual', this.nombre || this.usuario);
    set('user-rol-actual', NOMBRES_ROL[this.rol] || this.rol);
    const avatar = document.getElementById('user-avatar-letra');
    if (avatar) avatar.textContent = (this.nombre || this.usuario || '?').charAt(0).toUpperCase();

    if (typeof navegarA === 'function') navegarA('home');
  },

  // Muestra/oculta cada elemento marcado con data-modulo="xxx" según el
  // rol actual. Se aplica tanto al menú lateral como a las tarjetas del
  // Inicio, para que nadie vea una tarjeta de un módulo al que no entra.
  aplicarRol() {
    const permitidos = this.MODULOS_POR_ROL[this.rol] || [];
    document.querySelectorAll('[data-modulo]').forEach(el => {
      el.style.display = permitidos.includes(el.dataset.modulo) ? '' : 'none';
    });
  },

  async login() {
    const usuario  = document.getElementById('login-usuario')?.value?.trim();
    const password = document.getElementById('login-password')?.value;
    const errorEl  = document.getElementById('login-error');
    if (errorEl) errorEl.style.display = 'none';

    if (!usuario || !password) {
      if (errorEl) { errorEl.textContent = 'Usuario y contraseña son requeridos.'; errorEl.style.display = 'block'; }
      return;
    }

    const btn = document.getElementById('login-btn');
    UI.spin(btn, true);
    try {
      const res = await API.call('login', { usuario, password });
      if (!res.exito) {
        if (errorEl) { errorEl.textContent = res.error; errorEl.style.display = 'block'; }
        return;
      }
      sessionStorage.setItem('senerpot_token', res.token);
      sessionStorage.setItem('senerpot_rol', res.rol);
      sessionStorage.setItem('senerpot_nombre', res.nombre || usuario);
      sessionStorage.setItem('senerpot_usuario', usuario);
      this.rol = res.rol; this.nombre = res.nombre || usuario; this.usuario = usuario;
      this.mostrarApp();
    } catch (e) {
      if (errorEl) { errorEl.textContent = e.message; errorEl.style.display = 'block'; }
    } finally {
      UI.spin(btn, false);
    }
  },

  async logout() {
    try { await API.call('logout', {}); } catch (e) { /* si ya no hay sesión válida, no importa */ }
    this._limpiarSesionLocal();
    this.mostrarLogin();
  },

  // Se dispara desde API.call() cuando el servidor responde 401 en medio
  // del uso normal (sesión expiró, o fue invalidada) — saca a la persona
  // a la pantalla de login en vez de dejar la app en un estado a medias
  // donde los botones no funcionan sin explicación.
  sesionExpirada() {
    UI.toast('Tu sesión expiró — inicia sesión de nuevo', 'warn');
    this._limpiarSesionLocal();
    this.mostrarLogin();
  },

  _limpiarSesionLocal() {
    sessionStorage.removeItem('senerpot_token');
    sessionStorage.removeItem('senerpot_rol');
    sessionStorage.removeItem('senerpot_nombre');
    sessionStorage.removeItem('senerpot_usuario');
    this.rol = ''; this.nombre = ''; this.usuario = '';
  },

  async cambiarPasswordPropia() {
    const actual  = document.getElementById('pwd-actual')?.value;
    const nueva   = document.getElementById('pwd-nueva')?.value;
    const repetir = document.getElementById('pwd-repetir')?.value;
    if (!nueva || nueva.length < 6) { UI.toast('La contraseña nueva debe tener al menos 6 caracteres', 'warn'); return; }
    if (nueva !== repetir) { UI.toast('Las contraseñas nuevas no coinciden', 'warn'); return; }
    // Verificamos la contraseña actual re-logueando contra ella antes de
    // cambiarla — así no se puede cambiar la clave desde una sesión
    // abierta que alguien dejó sin cerrar en un equipo compartido.
    try {
      const check = await API.call('login', { usuario: this.usuario, password: actual });
      if (!check.exito) { UI.toast('La contraseña actual no es correcta', 'err'); return; }
      const res = await API.call('cambiarPasswordPropia', { password: nueva });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      UI.toast('Contraseña actualizada', 'ok');
      this.cerrarModal('modal-cambiar-password');
      ['pwd-actual','pwd-nueva','pwd-repetir'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  abrirModalCambiarPassword() {
    ['pwd-actual','pwd-nueva','pwd-repetir'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('modal-cambiar-password')?.classList.add('open');
  },

  cerrarModal(id) { document.getElementById(id)?.classList.remove('open'); }
};

/* ═══════════════════════════════════════════════
   USUARIOS — administración (solo rol ADMINISTRADOR,
   tanto en la UI — oculta el módulo — como en el
   servidor, que rechaza estas acciones a cualquier
   otro rol aunque alguien las llame directo).
═══════════════════════════════════════════════ */
const USUARIOS = {
  DB: [],

  async init() {
    try {
      this.DB = await API.call('listarUsuarios');
      this.render();
    } catch (e) { UI.toast('Error cargando usuarios: ' + e.message, 'err'); }
  },

  render() {
    const tbody = document.getElementById('usr-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const NOMBRES_ROL = { ADMINISTRADOR: 'Administrador', COMERCIAL: 'Comercial', ADMINISTRATIVO: 'Administrativo', TECNICO: 'Técnico', INGENIERIA: 'Ingeniería' };
    (this.DB || []).forEach(u => {
      const activo = u.ACTIVO === true || String(u.ACTIVO).toUpperCase() === 'TRUE';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.USUARIO}</td>
        <td>${u.NOMBRE || '-'}</td>
        <td><span class="badge ${activo ? 'badge-blue' : 'badge-gray'}">${NOMBRES_ROL[u.ROL] || u.ROL}</span></td>
        <td><span class="badge ${activo ? 'badge-green' : 'badge-red'}">${activo ? 'Activo' : 'Deshabilitado'}</span></td>
        <td>
          <button class="btn-icon btn-icon-edit" onclick='USUARIOS.abrirModal(${JSON.stringify(u).replace(/'/g,"&#39;")})' title="Editar"><i class="ti ti-edit"></i></button>
          <button class="btn-icon btn-icon-del" onclick="USUARIOS.eliminarUI('${u.USUARIO}')" title="Eliminar"><i class="ti ti-trash"></i></button>
        </td>`;
      tbody.appendChild(tr);
    });
  },

  abrirModal(u = null) {
    document.getElementById('usr-modal-title').textContent = u ? 'Editar Usuario' : 'Nuevo Usuario';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('usr-usuario', u?.USUARIO);
    document.getElementById('usr-usuario').disabled = !!u; // el nombre de usuario no se cambia una vez creado
    set('usr-nombre', u?.NOMBRE);
    set('usr-password', '');
    // La contraseña actual nunca se puede mostrar (se guarda como hash, no
    // en texto plano — ver hashPassword en Auth.gs) — este campo, al editar,
    // es para RESTABLECER a una contraseña nueva, no para ver ni corregir la
    // que ya tiene. El label y la ayuda dejan eso explícito para que no se
    // confunda con "aquí está en blanco por un error".
    document.getElementById('usr-password').placeholder = u ? 'Nueva contraseña (dejar en blanco para no cambiarla)' : 'Contraseña (mínimo 6 caracteres)';
    const lblPassword = document.getElementById('usr-password-label');
    if (lblPassword) lblPassword.textContent = u ? 'Restablecer contraseña' : 'Contraseña';
    const hintPassword = document.getElementById('usr-password-hint');
    if (hintPassword) hintPassword.style.display = u ? 'block' : 'none';
    const selRol = document.getElementById('usr-rol');
    if (selRol) selRol.value = u?.ROL || 'COMERCIAL';
    const chkActivo = document.getElementById('usr-activo');
    if (chkActivo) chkActivo.checked = u ? (u.ACTIVO === true || String(u.ACTIVO).toUpperCase() === 'TRUE') : true;
    document.getElementById('usr-modal')?.classList.add('open');
  },

  async guardar() {
    const usuario  = document.getElementById('usr-usuario')?.value?.trim();
    const nombre   = document.getElementById('usr-nombre')?.value?.trim();
    const password = document.getElementById('usr-password')?.value;
    const rol      = document.getElementById('usr-rol')?.value;
    const activo   = document.getElementById('usr-activo')?.checked;
    const esEdicion = document.getElementById('usr-usuario')?.disabled;

    if (!usuario || !rol) { UI.toast('Usuario y rol son requeridos', 'warn'); return; }
    if (!esEdicion && (!password || password.length < 6)) { UI.toast('La contraseña debe tener al menos 6 caracteres', 'warn'); return; }

    try {
      let res;
      if (esEdicion) {
        const payload = { usuario, nombre, rol, activo };
        if (password) payload.password = password;
        res = await API.call('editarUsuario', payload);
      } else {
        res = await API.call('crearUsuario', { usuario, nombre, rol, password });
      }
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      Store.upsert(this.DB, res.data);
      this.render();
      document.getElementById('usr-modal')?.classList.remove('open');
      UI.toast('Usuario guardado', 'ok');
    } catch (e) { UI.toast(e.message, 'err'); }
  },

  cerrarModal() { document.getElementById('usr-modal')?.classList.remove('open'); },

  async eliminarUI(usuario) {
    if (usuario === AUTH.usuario) { UI.toast('No puedes eliminar tu propio usuario mientras tienes la sesión abierta', 'warn'); return; }
    if (!UI.confirmar(`¿Eliminar el usuario "${usuario}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await API.call('eliminarUsuario', { usuario });
      if (!res.exito) { UI.toast(res.error, 'err'); return; }
      this.DB = this.DB.filter(u => u.USUARIO !== usuario);
      this.render();
      UI.toast('Usuario eliminado', 'ok');
    } catch (e) { UI.toast(e.message, 'err'); }
  }
};
