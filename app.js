/* =====================================================================
   Marcianos de la Risa · app.js
   JavaScript vanilla · Supabase v2 (Auth anónima + RPC + Realtime + RLS)
   ---------------------------------------------------------------------
   Índice
     1. Arranque y estado          8. Panel vendedor / Vender / Pedidos
     2. Utilidades                 9. Panel cocina / Lote / Producción / Horario
     3. UI: toasts, modal, banner 10. Inventario y Productos
     4. Datos: RPC, caché offline 11. Incentivos y Pagos
     5. Sesión y login            12. Usuarios, claves y permisos
     6. Tiempo real + presencia   13. Reportes (CSV/PDF) y Auditoría
     7. Rutas y Dashboard         14. Configuración y Perfil
   ===================================================================== */
(() => {
  'use strict';

  // ===================================================================
  // 1. ARRANQUE Y ESTADO
  // ===================================================================
  const CFG = window.MARCIANOS_CONFIG || {};
  const CONFIGURADO = !!(window.supabase && CFG.SUPABASE_URL && !/TU-PROYECTO/.test(CFG.SUPABASE_URL));
  let sb = null;

  const S = {
    perfil: null,        // { id, nombre, rol, branch_id, permisos[], config }
    cfg: null,           // fila de configuracion
    branches: [], flavors: [], admins: [],
    ruta: null,
    filtroSucursal: '',  // filtro del Super Admin en dashboard
    presentes: new Map(),
    oyentes: [],         // suscripciones de la vista actual a cambios realtime
    intervalos: [],
    editando: null,      // { tabla, id, version } para avisar conflictos en vivo
    online: navigator.onLine,
    instalar: null,      // evento beforeinstallprompt
    uid: null
  };

  const NIVEL_EMOJI = { Novato: '🌱', Bronce: '🥉', Plata: '🥈', Oro: '🥇', Platino: '💎' };
  const CANALES = { local: 'Local', instagram: 'Instagram', whatsapp: 'WhatsApp' };
  const ESTADOS_DELIVERY = { pendiente: 'Pendiente', en_camino: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado' };
  const ROLES = { superadmin: 'Super Admin', gerente: 'Gerente', cocina: 'Cocina', vendedor: 'Vendedor', lectura: 'Solo lectura' };

  // ===================================================================
  // 2. UTILIDADES
  // ===================================================================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Lima';
  const fmtSoles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soles = (n) => fmtSoles.format(Number(n) || 0).replace(/ /g, ' ');
  const entero = (n) => new Intl.NumberFormat('es-PE').format(Number(n) || 0);
  const pct = (n, d = 1) => (n == null || isNaN(n)) ? '—' : `${(Number(n) * 100).toFixed(d)} %`;
  const fFecha = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fDia = new Intl.DateTimeFormat('es-PE', { timeZone: TZ, day: '2-digit', month: 'short' });
  const fDiaSemana = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short', day: '2-digit' });
  const fecha = (v) => (v ? fFecha.format(new Date(v)) : '—');
  const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lunesDe = (iso) => { const d = new Date(`${iso}T12:00:00Z`); const w = (d.getUTCDay() + 6) % 7; return sumarDias(iso, -w); };
  const inicioMes = () => `${hoyISO().slice(0, 8)}01`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const iniciales = (n) => (n || '?').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const rol = () => S.perfil?.rol;
  const puede = (p) => rol() === 'superadmin' || (S.perfil?.permisos || []).includes(p);
  const esGlobal = () => rol() === 'superadmin' || (rol() === 'lectura' && !S.perfil?.branch_id);
  const sucursal = (id) => S.branches.find((b) => b.id === id);
  const nombreSucursal = (id) => sucursal(id)?.nombre || '—';
  const sabor = (id) => S.flavors.find((f) => f.id === id) || { nombre: 'Sabor', emoji: '🍧' };
  const persona = (id) => S.admins.find((a) => a.id === id);
  const nombrePersona = (id) => persona(id)?.nombre || (id === S.perfil?.id ? S.perfil.nombre : '—');
  const opciones = (lista, sel, { vacio } = {}) =>
    (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(sel ?? '') ? 'selected' : ''}>${esc(o.t)}</option>`).join('');
  const optSucursales = (sel, vacio) => opciones(S.branches.filter((b) => b.activo).map((b) => ({ v: b.id, t: b.nombre })), sel, { vacio });
  const optSabores = (sel, vacio) => opciones(S.flavors.filter((f) => f.activo).map((f) => ({ v: f.id, t: `${f.emoji || ''} ${f.nombre}` })), sel, { vacio });
  const vacio = (ico, txt) => `<div class="vacio"><span class="vacio__ico" aria-hidden="true">${ico}</span>${txt}</div>`;
  const chipEstado = (e) => ({
    pendiente: '<span class="chip chip--aviso">⏳ Pendiente</span>',
    aprobado: '<span class="chip chip--exito">✓ Aprobado</span>',
    rechazado: '<span class="chip chip--peligro">✕ Rechazado</span>',
    en_camino: '<span class="chip chip--info">🛵 En camino</span>',
    entregado: '<span class="chip chip--exito">✓ Entregado</span>',
    cancelado: '<span class="chip chip--peligro">✕ Cancelado</span>',
    pagado: '<span class="chip chip--exito">✓ Pagado</span>',
    anulado: '<span class="chip chip--peligro">Anulado</span>'
  }[e] || `<span class="chip">${esc(e)}</span>`);

  /** Progreso a hitos (500/1000/2000…) calculado con la configuración */
  function progresoNivel(vendidos) {
    const hitos = [...(S.cfg?.hitos || [])].sort((a, b) => a.umbral - b.umbral);
    let nivel = S.cfg?.nivel_base || 'Novato', desde = 0, sig = null;
    for (const h of hitos) { if (vendidos >= h.umbral) { nivel = h.nivel; desde = h.umbral; } else if (!sig) sig = h; }
    const progreso = sig ? Math.max(0, Math.min(1, (vendidos - desde) / (sig.umbral - desde))) : 1;
    return { nivel, sig, faltan: sig ? sig.umbral - vendidos : 0, progreso, hitos };
  }

  // ===================================================================
  // 3. UI: TOASTS, MODAL, CONFIRMACIONES, BANNERS, TOOLTIP
  // ===================================================================
  function toast(msg, tipo = 'info', ms = 4200) {
    const t = document.createElement('div');
    t.className = `toast toast--${tipo}`;
    t.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    t.innerHTML = `<span aria-hidden="true">${{ exito: '✅', error: '⚠️', fiesta: '🎉', aviso: '🔔' }[tipo] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function abrirModal(html, alAbrir) {
    const m = $('#modal');
    $('#modal-cuerpo').innerHTML = html;
    if (!m.open) m.showModal();
    alAbrir?.($('#modal-cuerpo'));
    return m;
  }
  function cerrarModal() { const m = $('#modal'); if (m.open) m.close(); }
  $('#modal').addEventListener('close', () => { S.editando = null; });

  function confirmar(titulo, texto, { ok = 'Confirmar', peligro = false } = {}) {
    return new Promise((res) => {
      abrirModal(`<h2>${esc(titulo)}</h2><p>${texto}</p>
        <div class="modal__pie"><button class="btn btn--fantasma" data-r="0">Cancelar</button>
        <button class="btn ${peligro ? 'btn--peligro' : 'btn--primario'}" data-r="1">${esc(ok)}</button></div>`, (el) => {
        let r = false;
        el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { r = b.dataset.r === '1'; cerrarModal(); } });
        $('#modal').addEventListener('close', () => res(r), { once: true });
      });
    });
  }

  function pedirTexto(titulo, etiqueta, { requerido = false, valor = '' } = {}) {
    return new Promise((res) => {
      abrirModal(`<h2>${esc(titulo)}</h2><form class="rejilla-form" id="f-txt">
        <label class="campo"><span class="campo__etiqueta">${esc(etiqueta)}</span>
        <input class="campo__input" name="v" value="${esc(valor)}" ${requerido ? 'required' : ''}></label>
        <div class="modal__pie"><button type="button" class="btn btn--fantasma" data-cancelar>Cancelar</button>
        <button class="btn btn--primario">Aceptar</button></div></form>`, (el) => {
        let r = null;
        $('[name=v]', el).focus();
        $('[data-cancelar]', el).onclick = () => cerrarModal();
        $('#f-txt', el).onsubmit = (e) => { e.preventDefault(); r = e.target.v.value.trim(); cerrarModal(); };
        $('#modal').addEventListener('close', () => res(r), { once: true });
      });
    });
  }

  /** Aviso de conflicto (last write wins con version): Recargar o Sobrescribir */
  function avisoConflicto(texto = 'Otra persona modificó este registro mientras lo editabas.') {
    return new Promise((res) => {
      const b = $('#banner-conflicto');
      b.innerHTML = `<span>⚠️ ${esc(texto)}</span>
        <button class="btn btn--chico btn--primario" data-c="recargar">Recargar</button>
        <button class="btn btn--chico btn--fantasma" data-c="sobrescribir">Guardar de todos modos</button>`;
      b.hidden = false;
      b.onclick = (e) => {
        const c = e.target.closest('[data-c]')?.dataset.c; if (!c) return;
        b.hidden = true; res(c);
      };
    });
  }

  // Tooltip para gráficos (hover en escritorio, toque en móvil)
  const tip = $('#tooltip');
  function moverTip(x, y) {
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 14)}px`;
  }
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]'); if (!t) return;
    tip.innerHTML = t.dataset.tip; tip.hidden = false; moverTip(e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', (e) => { if (!tip.hidden && e.target.closest('[data-tip]')) moverTip(e.clientX, e.clientY); });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
  document.addEventListener('scroll', () => { tip.hidden = true; }, true);

  // Botones "Copiar" en cualquier parte (incluido el modal)
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Copiado.', 'exito', 1800); } catch (_) { toast('No se pudo copiar.', 'error'); }
  });

  function marcarOnline(ok) {
    S.online = ok;
    $('#banner-offline').hidden = ok;
  }
  addEventListener('online', () => { marcarOnline(true); RT.reconectarYa(); });
  addEventListener('offline', () => marcarOnline(false));

  // ===================================================================
  // 4. DATOS: RPC, CONSULTAS, CACHÉ OFFLINE, ACTUALIZACIÓN CON VERSIÓN
  // ===================================================================
  function mensajeError(e) {
    const m = e?.message || String(e || 'Error');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet.';
    if (/JWT|jwt expired/i.test(m)) return 'Tu sesión expiró. Vuelve a ingresar.';
    return m;
  }

  async function rpc(fn, args = {}, { silencioso = false } = {}) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      if (error.code === '28000') sesionPerdida('Tu sesión ya no es válida. Ingresa otra vez con tu clave.');
      if (!silencioso) toast(mensajeError(error), 'error', 7000);
      throw error;
    }
    return data;
  }

  async function consulta(q, { silencioso = false } = {}) {
    const { data, error } = await q;
    if (error) { if (!silencioso) toast(mensajeError(error), 'error', 6000); throw error; }
    return data;
  }

  const cache = {
    clave: (k) => `mr:${S.perfil?.id}:${k}`,
    poner(k, v) { try { localStorage.setItem(this.clave(k), JSON.stringify({ t: Date.now(), v })); } catch (_) {} },
    leer(k) { try { return JSON.parse(localStorage.getItem(this.clave(k))); } catch (_) { return null; } }
  };

  /** Pide datos; si no hay red, devuelve el último resultado guardado (lectura offline) */
  async function conCache(clave, fn) {
    try {
      const v = await fn();
      cache.poner(clave, v);
      if (!S.online) marcarOnline(true);
      return { v, cacheado: false };
    } catch (e) {
      const c = cache.leer(clave);
      if (c) { marcarOnline(false); return { v: c.v, cacheado: true, t: c.t }; }
      toast(mensajeError(e), 'error');
      throw e;
    }
  }
  const avisoCache = (r) => (r.cacheado ? `<div class="alerta alerta--aviso">📡 <span>Datos guardados de <b>${fecha(r.t)}</b>. Se actualizarán al volver la conexión.</span></div>` : '');

  /** UPDATE con control de versión. Devuelve la fila guardada o null (recargar). */
  async function actualizarConVersion(tabla, fila, cambios) {
    const { data, error } = await sb.from(tabla).update(cambios).eq('id', fila.id).eq('version', fila.version).select();
    if (error) { toast(mensajeError(error), 'error', 6000); throw error; }
    if (data.length) return data[0];
    const decision = await avisoConflicto();
    if (decision === 'sobrescribir') {
      const r = await consulta(sb.from(tabla).update(cambios).eq('id', fila.id).select());
      if (!r.length) { toast('No tienes permiso para modificar este registro.', 'error'); return null; }
      return r[0];
    }
    await navegar();
    return null;
  }

  /** RPC que puede devolver {conflicto:true}: reintenta sin versión si el usuario lo decide */
  async function rpcConVersion(fn, args) {
    const r = await rpc(fn, args);
    if (r && r.conflicto) {
      const d = await avisoConflicto('Este registro cambió hace un momento (otro usuario).');
      if (d === 'sobrescribir') return rpc(fn, { ...args, p_version: null });
      await navegar(); return null;
    }
    return r;
  }

  async function cargarCatalogos() {
    const [b, f, a] = await Promise.all([
      consulta(sb.from('branches').select('*').order('nombre'), { silencioso: true }),
      consulta(sb.from('flavors').select('*').order('nombre'), { silencioso: true }),
      consulta(sb.from('admins').select('id,nombre,email,telefono,rol_id,branch_id,activo,last_login,version').order('nombre'), { silencioso: true })
    ]);
    S.branches = b; S.flavors = f; S.admins = a;
    cache.poner('catalogos', { b, f, a });
  }

  // ===================================================================
  // 5. SESIÓN Y LOGIN (clave generada por el Super Admin)
  // ===================================================================
  function mostrar(id) {
    ['#pantalla-login', '#pantalla-config', '#app'].forEach((s) => { $(s).hidden = s !== id; });
  }

  function mostrarLogin(mensaje) {
    mostrar('#pantalla-login');
    const err = $('#login-error');
    err.textContent = mensaje || sessionStorage.getItem('mr:msg') || '';
    sessionStorage.removeItem('mr:msg');
    setTimeout(() => $('#login-clave').focus(), 50);
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const clave = $('#login-clave').value.trim();
    if (!clave) return;
    btn.disabled = true; btn.textContent = 'Verificando…';
    $('#login-error').textContent = '';
    try {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        // Sesión técnica anónima de Supabase Auth; la identidad real la da la clave
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw new Error(/anonymous/i.test(error.message)
          ? 'Falta activar "Anonymous sign-ins" en Supabase (ver README).' : error.message);
        session = data.session;
      }
      const r = await rpc('canjear_clave', { p_clave: clave }, { silencioso: true });
      if (!r?.ok) throw new Error(r?.error || 'Clave inválida.');
      $('#login-clave').value = '';
      await iniciarApp(r.perfil);
    } catch (err) {
      $('#login-error').textContent = mensajeError(err);
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });

  async function iniciarApp(perfil, { offline = false } = {}) {
    S.perfil = perfil; S.cfg = perfil.config;
    try { localStorage.setItem('mr:perfil', JSON.stringify(perfil)); } catch (_) {}
    aplicarMarca(S.cfg);
    try { await cargarCatalogos(); } catch (e) {
      const c = cache.leer('catalogos'); if (c) { S.branches = c.v.b; S.flavors = c.v.f; S.admins = c.v.a; marcarOnline(false); }
    }
    mostrar('#app');
    $('#avatar').textContent = iniciales(perfil.nombre);
    construirNav();
    if (!offline) RT.iniciar();
    clearInterval(S.latidoTimer);
    S.latidoTimer = setInterval(latido, CFG.LATIDO_MS || 25000);
    if (!location.hash || location.hash === '#') location.hash = '#/inicio'; else navegar();
  }

  async function latido() {
    try {
      const { data, error } = await sb.rpc('latido');
      if (error) throw error;
      marcarOnline(true);
      if (!data?.activa) sesionPerdida('Tu sesión fue cerrada por el administrador.');
    } catch (e) {
      if (/fetch|network|Load failed/i.test(e?.message || '')) marcarOnline(false);
    }
  }

  let saliendo = false;
  async function salir(mensaje) {
    if (saliendo) return; saliendo = true;
    try { await sb.rpc('cerrar_mi_sesion'); } catch (_) {}
    RT.detener();
    try { await sb.auth.signOut(); } catch (_) {}
    try { localStorage.removeItem('mr:perfil'); } catch (_) {}
    if (mensaje) sessionStorage.setItem('mr:msg', mensaje);
    location.hash = '';
    location.reload();
  }
  function sesionPerdida(msg) { toast(msg, 'error', 6000); setTimeout(() => salir(msg), 1200); }

  // Aplica colores y nombre de marca desde Configuración (variables CSS)
  function aplicarMarca(c) {
    if (!c) return;
    const r = document.documentElement.style;
    const mapa = { color_primario: '--marca-primario', color_secundario: '--marca-secundario', color_acento: '--marca-acento',
      color_alerta: '--marca-alerta', color_tinta: '--marca-tinta' };
    Object.entries(mapa).forEach(([k, v]) => { if (c[k]) r.setProperty(v, c[k]); });
    $('#nombre-negocio').textContent = c.nombre_negocio || 'Marcianos de la Risa';
    document.title = `${c.nombre_negocio || 'Marcianos de la Risa'} · Panel`;
  }

  function aplicarTema(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('marcianos-tema', t); } catch (_) {}
  }
  $('#btn-tema').addEventListener('click', () => aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#btn-colapsar').addEventListener('click', () => {
    $('#app').classList.toggle('colapsada');
    try { localStorage.setItem('mr:colapsada', $('#app').classList.contains('colapsada') ? '1' : ''); } catch (_) {}
  });
  if (localStorage.getItem('mr:colapsada')) $('#app').classList.add('colapsada');

  // ===================================================================
  // 6. TIEMPO REAL (Postgres Changes) + PRESENCIA + RECONEXIÓN
  // ===================================================================
  const TABLAS_RT = ['pedidos', 'sales', 'inventory', 'production_batches', 'payments', 'bonuses',
    'seller_progress', 'sesiones', 'flavors', 'configuracion', 'access_keys'];

  const RT = {
    canal: null, presencia: null, intento: 0, timer: null, cerrando: false, perdido: false,

    async iniciar() {
      this.detener();
      this.cerrando = false;
      estadoRT('conectando');
      try {
        const { data: { session } } = await sb.auth.getSession();
        S.uid = session?.user?.id;
        if (session) sb.realtime.setAuth(session.access_token); // necesario para canales privados
      } catch (_) {}

      // Un canal con un listener por tabla. RLS filtra qué filas recibe cada usuario.
      const ch = sb.channel(`cambios-${S.perfil.id}`);
      TABLAS_RT.forEach((tabla) => {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, (p) => this.evento(tabla, p));
      });
      ch.subscribe((estado) => {
        if (this.cerrando) return;
        if (estado === 'SUBSCRIBED') {
          this.intento = 0; estadoRT('ok');
          if (this.perdido) { this.perdido = false; refrescarVista(); } // recupera eventos perdidos
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {
          estadoRT('error'); this.perdido = true; this.reprogramar();
        }
      });
      this.canal = ch;
      this.iniciarPresencia();
    },

    iniciarPresencia() {
      const ch = sb.channel('presencia', { config: { private: !!CFG.PRESENCIA_PRIVADA, presence: { key: S.perfil.id } } });
      ch.on('presence', { event: 'sync' }, () => {
        const estado = ch.presenceState();
        S.presentes = new Map(Object.entries(estado).map(([k, metas]) => [k, metas[metas.length - 1]]));
        pintarPresencia();
      });
      ch.subscribe(async (estado) => {
        if (estado === 'SUBSCRIBED') {
          await ch.track({ id: S.perfil.id, nombre: S.perfil.nombre, rol: S.perfil.rol,
            branch_id: S.perfil.branch_id, desde: new Date().toISOString() });
        }
      });
      this.presencia = ch;
    },

    // Backoff exponencial con jitter: 1s, 2s, 4s… máx 30s
    reprogramar() {
      if (this.timer || this.cerrando) return;
      const espera = Math.min(30000, 1000 * 2 ** this.intento) + Math.random() * 400;
      this.intento += 1;
      this.timer = setTimeout(() => { this.timer = null; this.iniciar(); }, espera);
    },
    reconectarYa() { if (!S.perfil) return; clearTimeout(this.timer); this.timer = null; this.intento = 0; this.perdido = true; this.iniciar(); },

    detener() {
      this.cerrando = true;
      clearTimeout(this.timer); this.timer = null;
      if (this.canal) { sb.removeChannel(this.canal); this.canal = null; }
      if (this.presencia) { sb.removeChannel(this.presencia); this.presencia = null; }
    },

    evento(tabla, p) {
      const fila = p.new && Object.keys(p.new).length ? p.new : p.old;
      // Cierre de sesión remoto
      if (tabla === 'sesiones' && p.new?.auth_uid === S.uid && p.new?.activa === false) {
        return sesionPerdida('Tu sesión fue cerrada por el administrador.');
      }
      if (tabla === 'configuracion' && p.new) { S.cfg = { ...S.cfg, ...p.new }; aplicarMarca(S.cfg); }
      if (tabla === 'flavors' && p.new) {
        const i = S.flavors.findIndex((f) => f.id === p.new.id);
        if (i >= 0) S.flavors[i] = p.new; else S.flavors.push(p.new);
      }
      // Aviso si alguien cambia lo que estoy editando
      if (S.editando && S.editando.tabla === tabla && fila?.id === S.editando.id && (fila.version || 0) > S.editando.version) {
        const av = $('#aviso-edicion');
        if (av) { av.hidden = false; av.innerHTML = '⚠️ <span>Otra persona acaba de cambiar este registro. Al guardar podrás recargar o sobrescribir.</span>'; }
      }
      S.oyentes.forEach((o) => { if (o.tablas.includes(tabla)) o.fn(p); });
    }
  };

  function estadoRT(e) {
    const el = $('#estado-rt');
    el.dataset.estado = e;
    $('.estado-rt__txt', el).textContent = { ok: 'En vivo', error: 'Reconectando…', conectando: 'Conectando…' }[e];
  }

  function pintarPresencia() {
    $$('[data-online]').forEach((el) => { el.hidden = !S.presentes.has(el.dataset.online); });
    const lista = $('[data-presencia-lista]');
    if (!lista) return;
    let gente = [...S.presentes.values()];
    if (!esGlobal()) gente = gente.filter((g) => g.branch_id === S.perfil.branch_id || g.id === S.perfil.id);
    lista.innerHTML = gente.length ? gente.map((g) => `<li><span class="punto-online"></span>
      <div class="lista__principal"><div class="lista__titulo">${esc(g.nombre)}</div>
      <div class="lista__det">${esc(ROLES[g.rol] || g.rol)} · ${esc(nombreSucursal(g.branch_id))}</div></div>
      <span class="muted" style="font-size:.78rem">desde ${fecha(g.desde)}</span></li>`).join('')
      : `<li class="muted">Nadie más conectado.</li>`;
  }

  // ===================================================================
  // 7. RUTAS, NAVEGACIÓN Y DASHBOARD
  // ===================================================================
  const RUTAS = {
    inicio:     { t: () => (['vendedor', 'cocina'].includes(rol()) ? 'Mi panel' : 'Dashboard'), ico: '🏠', ver: () => true, render: vistaInicio },
    vender:     { t: 'Registrar venta', corto: 'Vender', ico: '🛒', ver: () => puede('ventas:editar'), render: vistaVender },
    pedidos:    { t: 'Mis pedidos', corto: 'Pedidos', ico: '🛵', ver: () => rol() === 'vendedor', render: vistaMisPedidos },
    ventas:     { t: 'Ventas y delivery', corto: 'Ventas', ico: '🧾', ver: () => puede('ventas:ver') && rol() !== 'vendedor', render: vistaVentas },
    lote:       { t: 'Registrar lote', corto: 'Lote', ico: '🧊', ver: () => puede('produccion:editar'), render: vistaLote },
    produccion: { t: 'Producción', ico: '🧊', ver: () => puede('produccion:ver') && rol() !== 'cocina', render: vistaProduccion },
    horario:    { t: 'Mi disponibilidad', corto: 'Horario', ico: '🗓️', ver: () => rol() === 'cocina' && puede('horario:editar'), render: vistaHorario },
    inventario: { t: 'Inventario', ico: '📦', ver: () => puede('inventario:ver') && rol() !== 'vendedor', render: vistaInventario },
    productos:  { t: 'Sabores y precios', corto: 'Sabores', ico: '🍧', ver: () => puede('productos:ver'), render: vistaProductos },
    incentivos: { t: 'Incentivos y niveles', corto: 'Incentivos', ico: '🏆', ver: () => puede('incentivos:ver') && rol() !== 'vendedor', render: vistaIncentivos },
    pagos:      { t: 'Pagos y nómina', corto: 'Pagos', ico: '💸', ver: () => puede('pagos:ver') && !['cocina', 'vendedor'].includes(rol()), render: vistaPagos },
    equipo:     { t: () => (rol() === 'superadmin' ? 'Usuarios y claves' : 'Mi equipo'), corto: 'Equipo', ico: '👥', ver: () => puede('usuarios:ver') || puede('equipo:ver'), render: vistaUsuarios },
    reportes:   { t: 'Reportes', ico: '📊', ver: () => puede('reportes:ver'), render: vistaReportes },
    auditoria:  { t: 'Auditoría', ico: '🕵️', ver: () => puede('auditoria:ver'), render: vistaAuditoria },
    config:     { t: 'Configuración', ico: '⚙️', ver: () => puede('configuracion:editar'), render: vistaConfig },
    perfil:     { t: 'Mi perfil', corto: 'Perfil', ico: '👤', ver: () => true, render: vistaPerfil }
  };
  const tituloDe = (id) => { const t = RUTAS[id].t; return typeof t === 'function' ? t() : t; };
  const cortoDe = (id) => RUTAS[id].corto || tituloDe(id);

  function rutasInferior() {
    switch (rol()) {
      case 'vendedor': return ['inicio', 'vender', 'pedidos', 'perfil'];
      case 'cocina': return ['inicio', 'lote', 'horario', 'perfil'];
      case 'lectura': return ['inicio', 'ventas', 'reportes', 'mas', 'perfil'];
      default: return ['inicio', 'ventas', 'produccion', 'mas', 'perfil'];
    }
  }

  function construirNav() {
    const visibles = Object.keys(RUTAS).filter((id) => RUTAS[id].ver());
    $('#nav-lateral').innerHTML = visibles.map((id) =>
      `<a href="#/${id}" data-ruta="${id}"><span class="ico" aria-hidden="true">${RUTAS[id].ico}</span><span class="txt">${esc(tituloDe(id))}</span></a>`).join('');
    const inf = rutasInferior().filter((id) => id === 'mas' || RUTAS[id].ver());
    $('#nav-inferior').innerHTML = inf.map((id) => id === 'mas'
      ? `<button type="button" id="btn-mas"><span class="ico" aria-hidden="true">☰</span>Más</button>`
      : `<a href="#/${id}" data-ruta="${id}"><span class="ico" aria-hidden="true">${RUTAS[id].ico}</span>${esc(id === 'inicio' ? 'Inicio' : cortoDe(id))}</a>`).join('');
    const enMas = visibles.filter((id) => !inf.includes(id));
    $('#nav-mas').innerHTML = enMas.map((id) =>
      `<a href="#/${id}" data-ruta="${id}"><span class="ico" aria-hidden="true">${RUTAS[id].ico}</span>${esc(cortoDe(id))}</a>`).join('');
    $('#btn-mas')?.addEventListener('click', () => $('#hoja-mas').showModal());
  }
  $('#hoja-mas').addEventListener('click', (e) => {
    if (e.target.closest('a,[data-cerrar]') || e.target === e.currentTarget) $('#hoja-mas').close();
  });

  function marcarNav(id) {
    $$('[data-ruta]').forEach((a) => { if (a.dataset.ruta === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const enMas = $(`#nav-mas [data-ruta="${id}"]`);
    const bm = $('#btn-mas');
    if (bm) { if (enMas) bm.setAttribute('aria-current', 'page'); else bm.removeAttribute('aria-current'); }
  }

  function actualizarFab(id) {
    const fab = $('#fab');
    let destino = null, txt = '';
    if (rol() === 'cocina') { destino = 'lote'; txt = 'Lote'; } else if (puede('ventas:editar')) { destino = 'vender'; txt = 'Vender'; }
    const ocultarEn = ['vender', 'lote', 'config', 'perfil', 'auditoria', 'reportes', 'equipo'];
    fab.hidden = !destino || ocultarEn.includes(id);
    if (destino) { fab.href = `#/${destino}`; $('.fab__txt', fab).textContent = txt; }
  }

  function limpiarVista() {
    S.oyentes = [];
    S.intervalos.forEach(clearInterval); S.intervalos = [];
    S.editando = null;
    $('#banner-conflicto').hidden = true;
  }
  /** Suscribe la vista actual a cambios realtime de ciertas tablas */
  const alCambiar = (tablas, fn) => S.oyentes.push({ tablas, fn: debounce(fn, 300) });
  const refrescarVista = debounce(() => { if (S.ruta && !$('#modal').open) navegar(); }, 300);

  async function navegar() {
    if (!S.perfil) return;
    const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
    const r = RUTAS[id];
    if (!r || !r.ver()) { location.hash = '#/inicio'; return; }
    limpiarVista();
    S.ruta = id;
    marcarNav(id);
    $('#titulo-vista').textContent = tituloDe(id);
    $('#subtitulo-vista').textContent = `${S.perfil.nombre} · ${ROLES[rol()]}${S.perfil.branch_id ? ` · ${nombreSucursal(S.perfil.branch_id)}` : ''}`;
    actualizarFab(id);
    // Contenedor nuevo en cada vista: elimina los listeners de la vista anterior
    const viejo = $('#contenido');
    const el = viejo.cloneNode(false);
    viejo.replaceWith(el);
    el.innerHTML = '<div class="esqueleto"></div><div class="esqueleto"></div>';
    try { await r.render(el); } catch (e) {
      console.error(e);
      el.innerHTML = vacio('😵', `No se pudo cargar esta sección.<br><small>${esc(mensajeError(e))}</small>`);
    }
    pintarPresencia();
  }
  addEventListener('hashchange', navegar);

  function vistaInicio(el) {
    if (rol() === 'vendedor') return panelVendedor(el);
    if (rol() === 'cocina') return panelCocina(el);
    return vistaDashboard(el);
  }

  // ---------- Gráficos SVG (una serie, sin leyenda; tooltip por marca) ----------
  function escalaMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; }
  function barraV(x, y, w, h, r = 4) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barraH(x, y, w, h, r = 4) {
    if (w <= 0) return '';
    r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  /** Columnas verticales: ventas por día (30 días) */
  function graficoColumnas(serie, { valor = 'monto', fmt = soles, W = 640 } = {}) {
    const H = W < 500 ? 180 : 240, L = 52, B = 26, T = 10;
    const n = serie.length || 1;
    const max = escalaMax(Math.max(...serie.map((d) => Number(d[valor]) || 0)));
    const paso = (W - L) / n, ancho = Math.max(2, paso - 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let s = `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas por día, últimos ${n} días">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      s += `<line class="rejilla-l" x1="${L}" x2="${W}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${valor === 'monto' ? `S/${Math.round(v)}` : Math.round(v)}</text>`;
    }
    serie.forEach((d, i) => {
      const v = Number(d[valor]) || 0, x = L + i * paso + 1, yy = y(v);
      const dia = fDia.format(new Date(`${d.dia}T12:00:00-05:00`));
      s += `<g data-tip="${esc(`${dia}: ${fmt(v)} · ${entero(d.unidades)} marcianos`)}">
        <rect class="hit" x="${L + i * paso}" y="${T}" width="${paso}" height="${H - T - B}"/>
        <path class="marca" d="${barraV(x, yy, ancho, H - B - yy)}"/></g>`;
      const k = W < 500 ? 7 : 5;
      if ((i % k === 0 && n - 1 - i >= k / 2) || i === n - 1) s += `<text x="${x + ancho / 2}" y="${H - 8}" text-anchor="middle">${esc(dia)}</text>`;
    });
    return `${s}<line class="eje" x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}"/></svg>`;
  }

  /** Barras horizontales: comparativas por categoría (sucursales, margen por sabor) */
  function graficoBarras(items, { etq, valor, fmt, max, objetivo, bajo, tip: tipFn, W = 640 } = {}) {
    if (!items.length) return vacio('📉', 'Sin datos todavía.');
    const fila = 34, L = W < 420 ? 96 : 130, R = 92, H = items.length * fila + (objetivo != null ? 22 : 6);
    const mx = max || escalaMax(Math.max(...items.map(valor)));
    const x = (v) => L + (W - L - R) * Math.max(0, v) / mx;
    let s = `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img">`;
    items.forEach((it, i) => {
      const v = valor(it), yy = i * fila + 6, esBajo = bajo?.(it);
      s += `<g data-tip="${esc(tipFn ? tipFn(it) : `${etq(it)}: ${fmt(v)}`)}">
        <rect class="hit" x="0" y="${yy - 4}" width="${W}" height="${fila}"/>
        <text class="etq-cat" x="${L - 8}" y="${yy + 16}" text-anchor="end">${esc(etq(it))}</text>
        <path class="marca ${esBajo ? 'marca--baja' : ''}" d="${barraH(L, yy + 2, x(v) - L, 20)}"/>
        <text class="etq-valor" x="${x(v) + 6}" y="${yy + 16}">${esBajo ? '⚠ ' : ''}${esc(fmt(v))}</text></g>`;
    });
    if (objetivo != null) {
      const xo = x(objetivo);
      s += `<line class="objetivo" x1="${xo}" x2="${xo}" y1="0" y2="${H - 18}"/><text class="objetivo-txt" x="${xo}" y="${H - 4}" text-anchor="middle">Objetivo ${pct(objetivo, 0)}</text>`;
    }
    return `${s}</svg>`;
  }

  /** Gráficos diferidos: se dibujan al ancho real del contenedor (y al redimensionar) */
  const GRAFICOS = new Map();
  function grafico(id, fn) { GRAFICOS.set(id, fn); return `<div class="grafico-caja" data-grafico="${id}"></div>`; }
  function dibujarGraficos(raiz = document) {
    $$('[data-grafico]', raiz).forEach((c) => {
      const fn = GRAFICOS.get(c.dataset.grafico);
      if (fn) c.innerHTML = fn(Math.max(280, Math.round(c.clientWidth)));
    });
  }
  addEventListener('resize', debounce(() => dibujarGraficos(), 200));

  async function vistaDashboard(el) {
    const selector = esGlobal()
      ? `<div class="filtros no-imprimir"><label class="campo"><span class="campo__etiqueta">Sucursal</span>
         <select class="campo__input" id="f-suc">${optSucursales(S.filtroSucursal, 'Todas (consolidado)')}</select></label></div>` : '';
    el.innerHTML = `${selector}<div id="dash" class="rejilla"></div>`;
    $('#f-suc')?.addEventListener('change', (e) => { S.filtroSucursal = e.target.value; cargar(); });
    const cargar = async () => {
      const r = await conCache(`dash:${S.filtroSucursal}`, () => rpc('dashboard_kpis', { p_branch: S.filtroSucursal || null }, { silencioso: true }));
      pintarDashboard($('#dash'), r);
    };
    await cargar();
    alCambiar(['sales', 'pedidos', 'inventory', 'production_batches', 'seller_progress', 'flavors', 'access_keys', 'configuracion'], cargar);
  }

  function pintarDashboard(el, r) {
    const d = r.v, m = d.mes || {}, h = d.hoy || {}, a = d.alertas || {};
    const obj = Number(S.cfg.margen_objetivo);
    const alertas = [
      ...(a.margen_bajo || []).map((x) => `<div class="alerta alerta--peligro">⚠️ <span><b>Margen bajo:</b> ${esc(x.emoji)} ${esc(x.sabor)} está en ${pct(x.margen)} (objetivo ${pct(obj, 0)}). Precio sugerido ${soles(x.sugerido)}</span></div>`),
      ...(a.delivery_pendientes || []).map((x) => `<div class="alerta alerta--info">🛵 <span><b>Delivery ${esc(ESTADOS_DELIVERY[x.estado])}:</b> ${entero(x.cantidad)} marcianos · ${esc(x.cliente || 'Cliente')} · ${esc(x.sucursal)} · ${fecha(x.fecha)}</span></div>`),
      ...(a.lotes_pendientes ? [`<div class="alerta alerta--aviso">🧊 <span><b>${a.lotes_pendientes} lote(s)</b> esperando aprobación. <a href="#/produccion">Revisar</a></span></div>`] : []),
      ...(a.stock_bajo || []).map((x) => `<div class="alerta alerta--aviso">📦 <span><b>Stock bajo:</b> ${esc(x.emoji)} ${esc(x.sabor)} en ${esc(x.sucursal)} — quedan ${entero(x.stock)}</span></div>`),
      ...(a.sin_rotacion || []).map((x) => `<div class="alerta alerta--info">🐢 <span><b>Sin rotación:</b> ${esc(x.emoji)} ${esc(x.sabor)} en ${esc(x.sucursal)} — ${entero(x.vendidos)} vendidos en ${S.cfg.dias_sin_rotacion} días (stock ${entero(x.stock)})</span></div>`),
      ...(a.claves_por_vencer || []).map((x) => `<div class="alerta alerta--aviso">🔑 <span><b>Clave por vencer:</b> ${esc(x.persona)} — vence ${fecha(x.expira)}</span></div>`),
    ];
    const totalCanal = (m.local || 0) + (m.delivery || 0);
    el.innerHTML = `${avisoCache(r)}
      <section class="kpis" aria-label="Indicadores">
        <div class="kpi kpi--destacado"><div class="kpi__etq">Ventas hoy</div><div class="kpi__val">${soles(h.monto)}</div><div class="kpi__det">${entero(h.unidades)} marcianos · ${entero(h.pedidos)} pedidos</div></div>
        <div class="kpi"><div class="kpi__etq">Ventas del mes</div><div class="kpi__val">${soles(m.monto)}</div><div class="kpi__det">${entero(m.unidades)} vendidos</div></div>
        <div class="kpi"><div class="kpi__etq">Margen bruto</div><div class="kpi__val" style="color:${m.margen_pct != null && m.margen_pct < obj ? 'var(--peligro)' : 'inherit'}">${pct(m.margen_pct)}</div><div class="kpi__det">Neto de comisiones: ${pct(m.margen_neto_pct)}</div></div>
        <div class="kpi"><div class="kpi__etq">Producidos / vendidos</div><div class="kpi__val">${entero(m.producidos)} / ${entero(m.unidades)}</div><div class="kpi__det">este mes</div></div>
        <div class="kpi"><div class="kpi__etq">Ticket promedio</div><div class="kpi__val">${soles(m.ticket_promedio)}</div><div class="kpi__det">${entero(m.pedidos)} pedidos</div></div>
        <div class="kpi"><div class="kpi__etq">Delivery vs local</div><div class="kpi__val">${entero(m.delivery)} / ${entero(m.local)}</div><div class="kpi__det">${totalCanal ? pct((m.delivery || 0) / totalCanal, 0) : '—'} delivery · IG ${entero(m.instagram)} · WA ${entero(m.whatsapp)}</div></div>
      </section>
      ${alertas.length ? `<section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Alertas</h2><span class="chip chip--aviso">${alertas.length}</span></div><div class="rejilla" style="gap:8px">${alertas.slice(0, 4).join('')}${alertas.length > 4 ? `<details><summary class="btn btn--chico btn--fantasma">Ver ${alertas.length - 4} alertas más</summary><div class="rejilla" style="gap:8px;margin-top:8px">${alertas.slice(4).join('')}</div></details>` : ''}</div></section>` : ''}
      <section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Ventas por día</h2><p class="tarjeta__sub">Últimos 30 días · S/ por día</p></div></div>
        ${grafico('serie', (W) => graficoColumnas(d.serie_30d || [], { W }))}</section>
      <div class="rejilla rejilla--2">
        ${esGlobal() && !S.filtroSucursal ? `<section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Ventas por sucursal</h2><p class="tarjeta__sub">Mes actual</p></div></div>
          ${grafico('suc', (W) => graficoBarras(d.por_sucursal || [], { W, etq: (x) => x.nombre, valor: (x) => Number(x.monto), fmt: soles, tip: (x) => `${x.nombre}: ${soles(x.monto)} · ${entero(x.unidades)} u · margen ${pct(x.margen_pct)}` }))}</section>` : ''}
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Margen por sabor</h2><p class="tarjeta__sub">(precio − costo de insumos) ÷ precio</p></div></div>
          ${grafico('margen', (W) => graficoBarras(d.margen_sabores || [], { W, etq: (x) => x.nombre, valor: (x) => Number(x.margen), fmt: (v) => pct(v), max: 1, objetivo: obj, bajo: (x) => Number(x.margen) < obj, tip: (x) => `${x.nombre}: costo ${soles(x.costo)} · precio ${soles(x.precio)} · sugerido ${soles(x.sugerido)}` }))}</section>
      </div>
      <div class="rejilla rejilla--3">
        <section class="tarjeta"><h2 class="tarjeta__titulo">Ranking de sabores</h2>
          ${(d.ranking_sabores || []).length ? `<ol class="lista">${d.ranking_sabores.map((s, i) => `<li><span class="emoji">${esc(s.emoji)}</span><div class="lista__principal"><div class="lista__titulo">${i + 1}. ${esc(s.nombre)}</div><div class="lista__det">${soles(s.monto)} · margen ${pct(s.margen_pct)}</div></div><span class="lista__valor">${entero(s.unidades)}</span></li>`).join('')}</ol>` : vacio('🍧', 'Aún no hay ventas este mes.')}</section>
        <section class="tarjeta"><h2 class="tarjeta__titulo">Ranking de vendedores</h2>
          ${(d.ranking_vendedores || []).length ? `<ol class="lista">${d.ranking_vendedores.map((s, i) => `<li><span class="emoji">${['🥇', '🥈', '🥉'][i] || '🛵'}</span><div class="lista__principal"><div class="lista__titulo">${esc(s.nombre)}</div><div class="lista__det">${soles(s.monto)}</div></div><span class="lista__valor">${entero(s.unidades)}</span></li>`).join('')}</ol>` : vacio('🛵', 'Sin ventas aún.')}</section>
        <section class="tarjeta"><h2 class="tarjeta__titulo">Progreso de incentivos</h2><p class="tarjeta__sub">Periodo ${esc(d.periodo)}</p>
          ${(d.incentivos || []).length ? `<ul class="lista">${d.incentivos.map((s) => { const p = progresoNivel(s.vendidos); return `<li><span class="emoji">${NIVEL_EMOJI[p.nivel] || '⭐'}</span><div class="lista__principal"><div class="lista__titulo">${esc(s.nombre)}</div><div class="barra barra--chica" style="margin:4px 0"><div class="barra__relleno" style="width:${(p.progreso * 100).toFixed(1)}%"></div></div><div class="lista__det">${esc(p.nivel)} · ${p.sig ? `faltan ${entero(p.faltan)} para ${esc(p.sig.nivel)}` : 'nivel máximo'}</div></div><span class="lista__valor">${entero(s.vendidos)}</span></li>`; }).join('')}</ul>` : vacio('🏆', 'Sin progreso registrado.')}</section>
      </div>
      <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Conectados ahora</h2><span class="chip chip--exito">● en vivo</span></div><ul class="lista" data-presencia-lista></ul></section>`;
    dibujarGraficos(el);
    pintarPresencia();
  }

  // ===================================================================
  // 8. VENDEDOR: PANEL, VENDER, MIS PEDIDOS
  // ===================================================================
  async function panelVendedor(el) {
    const cargar = async () => {
      const r = await conCache('panel-v', () => rpc('panel_vendedor', {}, { silencioso: true }));
      const p = r.v, din = p.dinero || {};
      const prog = progresoNivel(p.vendidos);
      el.innerHTML = `${avisoCache(r)}
        <section class="heroe" aria-label="Dinero acumulado">
          <div class="heroe__etq">Ganado en el periodo ${esc(p.periodo)}</div>
          <div class="heroe__monto">${soles(din.total)}</div>
          <div class="heroe__det"><span>Comisiones ${soles(din.comisiones)}</span><span>Bonos ${soles(din.bonos)}</span>${Number(din.ajustes) ? `<span>Ajustes ${soles(din.ajustes)}</span>` : ''}<span>Por cobrar ${soles(din.pendiente)}</span></div>
          <div class="heroe__mini">
            <div><b>${entero(p.hoy.unidades)}</b><span>vendidos hoy</span></div>
            <div><b>${soles(p.hoy.comision)}</b><span>ganado hoy</span></div>
            <div><b>${entero(p.vendidos)}</b><span>en el periodo</span></div>
          </div>
        </section>
        <section class="tarjeta">
          <div class="nivel">
            <div class="insignia" data-nivel="${esc(prog.nivel)}" aria-hidden="true">${NIVEL_EMOJI[prog.nivel] || '⭐'}</div>
            <div>
              <div class="tarjeta__sub">Tu nivel</div>
              <div class="nivel__nombre">${esc(prog.nivel)}</div>
              ${p.racha ? `<span class="racha">🔥 ${p.racha} ${p.racha === 1 ? 'día' : 'días'} seguidos vendiendo</span>` : ''}
            </div>
          </div>
          <div style="margin-top:14px">
            <div class="resumen__fila" style="margin-bottom:6px"><b>${prog.sig ? `Te faltan ${entero(prog.faltan)} marcianos para ${esc(prog.sig.nivel)}` : '¡Llegaste al nivel máximo! 🚀'}</b>
              ${prog.sig ? `<span class="chip chip--exito">+${soles(prog.sig.bono)}</span>` : ''}</div>
            <div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog.progreso * 100)}"><div class="barra__relleno" style="width:${(prog.progreso * 100).toFixed(1)}%"></div></div>
          </div>
          <div class="hitos">${prog.hitos.map((h) => `<div class="hito ${p.vendidos >= h.umbral ? 'hito--logrado' : ''}"><b>${entero(h.umbral)}</b>${esc(h.nivel)}<br>${soles(h.bono)} ${p.vendidos >= h.umbral ? '✓' : ''}</div>`).join('')}</div>
          <p class="campo__ayuda" style="margin-top:10px">Ganas ${soles(p.pago_unitario)} por cada marciano vendido. Los bonos se acumulan y se reinician cada periodo.</p>
        </section>
        ${(p.bonos || []).length ? `<section class="tarjeta"><h2 class="tarjeta__titulo">Mis bonos</h2><ul class="lista">${p.bonos.map((b) => `<li><span class="emoji">${NIVEL_EMOJI[b.nivel] || '🎁'}</span><div class="lista__principal"><div class="lista__titulo">Nivel ${esc(b.nivel)} (${entero(b.hito)})</div><div class="lista__det">${fecha(b.fecha)}</div></div>${b.pagado ? chipEstado('pagado') : b.aprobado ? chipEstado('aprobado') : '<span class="chip chip--aviso">Por aprobar</span>'}<span class="lista__valor">${soles(b.monto)}</span></li>`).join('')}</ul></section>` : ''}
        <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Últimos pedidos</h2><a class="btn btn--chico btn--fantasma" href="#/pedidos">Ver todos</a></div>
          ${listaPedidosVendedor(p.pedidos || [])}</section>
        <a class="btn btn--acento btn--grande btn--bloque" href="#/vender">🛒 Registrar venta</a>`;
    };
    enlazarAccionesPedido(el, () => cargar());
    await cargar();
    alCambiar(['sales', 'pedidos', 'payments', 'bonuses', 'seller_progress', 'configuracion'], cargar);
  }

  function listaPedidosVendedor(pedidos) {
    if (!pedidos.length) return vacio('🛒', 'Todavía no registras ventas.');
    return `<ul class="lista">${pedidos.map((pe) => `<li>
      <span class="emoji">${pe.delivery ? '🛵' : '🏪'}</span>
      <div class="lista__principal">
        <div class="lista__titulo">${entero(pe.cantidad_total)} marcianos ${pe.cliente ? `· ${esc(pe.cliente)}` : ''}</div>
        <div class="lista__det">${fecha(pe.fecha)} · ${esc(CANALES[pe.canal])}${pe.delivery ? ` · ${pe.envio_gratis ? 'envío gratis' : 'no apto envío gratis'}` : ''}</div>
        ${pe.anulado ? chipEstado('anulado') : pe.delivery ? `<div class="acciones" style="margin-top:6px">${chipEstado(pe.delivery_estado)}
          ${pe.delivery_estado === 'pendiente' ? `<button class="btn btn--chico btn--primario" data-delivery="${pe.id}" data-estado="en_camino" data-version="${pe.version}">🛵 Salir</button>` : ''}
          ${pe.delivery_estado === 'en_camino' ? `<button class="btn btn--chico btn--exito" data-delivery="${pe.id}" data-estado="entregado" data-version="${pe.version}">✓ Entregado</button>` : ''}</div>` : ''}
      </div>
      <span class="lista__valor">${soles(pe.total)}</span></li>`).join('')}</ul>`;
  }

  function enlazarAccionesPedido(el, recargar) {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-delivery]'); if (!b) return;
      b.disabled = true;
      try {
        const r = await rpcConVersion('cambiar_estado_delivery', { p_pedido: b.dataset.delivery, p_estado: b.dataset.estado, p_version: Number(b.dataset.version) });
        if (r) toast(`Pedido marcado como ${ESTADOS_DELIVERY[b.dataset.estado]}.`, 'exito');
        recargar();
      } catch (_) { b.disabled = false; }
    });
  }

  async function vistaMisPedidos(el) {
    let filtro = 'todos';
    const cargar = async () => {
      let q = sb.from('pedidos').select('*').order('fecha', { ascending: false }).limit(60);
      if (filtro === 'delivery') q = q.eq('delivery', true).in('delivery_estado', ['pendiente', 'en_camino']).eq('anulado', false);
      const r = await conCache(`mis-pedidos:${filtro}`, () => consulta(q, { silencioso: true }));
      $('#lista-ped').innerHTML = avisoCache(r) + listaPedidosVendedor(r.v);
    };
    el.innerHTML = `<div class="segmento" role="group" aria-label="Filtro">
        <button type="button" data-f="todos" aria-pressed="true">Todos</button>
        <button type="button" data-f="delivery" aria-pressed="false">🛵 Delivery por entregar</button></div>
      <section class="tarjeta" id="lista-ped"></section>`;
    $('.segmento', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      filtro = b.dataset.f; $$('.segmento button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); cargar();
    });
    enlazarAccionesPedido(el, cargar);
    await cargar();
    alCambiar(['pedidos'], cargar);
  }

  async function vistaVender(el) {
    const c = S.cfg;
    const st = {
      branch: rol() === 'superadmin' ? (S.branches.find((b) => b.activo)?.id || '') : S.perfil.branch_id,
      seller: S.perfil.id, canal: 'local', delivery: false, items: {}, precios: []
    };
    const vendedores = () => S.admins.filter((a) => a.activo && ['vendedor', 'gerente', 'superadmin'].includes(a.rol_id)
      && (a.branch_id === st.branch || a.id === S.perfil.id));

    el.innerHTML = `
      <form id="f-venta" class="rejilla" novalidate>
        ${rol() !== 'vendedor' ? `<section class="tarjeta rejilla-form rejilla-form--2">
          ${rol() === 'superadmin' ? `<label class="campo"><span class="campo__etiqueta">Punto de venta</span><select class="campo__input" id="v-branch">${optSucursales(st.branch)}</select></label>` : ''}
          <label class="campo"><span class="campo__etiqueta">Vendedor (recibe la comisión)</span><select class="campo__input" id="v-seller"></select></label>
        </section>` : ''}
        <section class="tarjeta rejilla-form">
          <div class="campo"><span class="campo__etiqueta">Canal</span>
            <div class="segmento" id="v-canal" role="group" aria-label="Canal">${Object.entries(CANALES).map(([k, v]) => `<button type="button" data-canal="${k}" aria-pressed="${k === 'local'}">${v}</button>`).join('')}</div></div>
          <label class="switch"><span>🛵 Es delivery</span><input type="checkbox" id="v-delivery"></label>
          <div id="v-delivery-campos" class="rejilla-form rejilla-form--2" hidden>
            <label class="campo"><span class="campo__etiqueta">Cliente</span><input class="campo__input" id="v-cliente" placeholder="Nombre o @usuario"></label>
            <label class="campo"><span class="campo__etiqueta">Dirección de entrega</span><input class="campo__input" id="v-direccion" placeholder="Av., Jr., referencia"></label>
          </div>
        </section>
        <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Sabores</h2><span class="tarjeta__sub" id="v-suc-nombre"></span></div>
          <div class="sabores" id="v-sabores"></div></section>
        <section class="tarjeta rejilla-form rejilla-form--2">
          <label class="campo"><span class="campo__etiqueta">Descuento total (S/)</span><input class="campo__input num" id="v-descuento" type="number" min="0" step="0.10" inputmode="decimal" value="0"></label>
          <label class="campo"><span class="campo__etiqueta">Nota (opcional)</span><input class="campo__input" id="v-nota"></label>
        </section>
        <section class="resumen" aria-live="polite">
          <div class="resumen__fila"><span><b id="r-cant">0</b> marcianos</span><span class="resumen__total" id="r-total">S/ 0.00</span></div>
          <div id="r-delivery"></div>
          <div class="resumen__fila"><span class="muted" id="r-comision"></span>
            <button class="btn btn--primario btn--grande" id="v-enviar" type="submit">Registrar venta</button></div>
        </section>
      </form>`;

    const pintarVendedores = () => {
      const sel = $('#v-seller'); if (!sel) return;
      const lista = vendedores();
      if (!lista.some((a) => a.id === st.seller)) st.seller = S.perfil.id;
      sel.innerHTML = opciones(lista.map((a) => ({ v: a.id, t: `${a.nombre} (${ROLES[a.rol_id]})` })), st.seller);
    };

    const cargarPrecios = async () => {
      if (!st.branch) { $('#v-sabores').innerHTML = vacio('🏪', 'Selecciona el punto de venta.'); return; }
      const r = await conCache(`precios:${st.branch}`, () => rpc('precios_sucursal', { p_branch: st.branch }, { silencioso: true }));
      st.precios = r.v;
      $('#v-suc-nombre').textContent = nombreSucursal(st.branch);
      pintarSabores();
    };

    const pintarSabores = () => {
      $('#v-sabores').innerHTML = st.precios.length ? st.precios.map((p) => {
        const q = st.items[p.flavor_id] || 0;
        const promo = Number(p.precio_final) < Number(p.precio_especial ?? p.precio_base);
        return `<div class="sabor ${q ? 'sabor--activo' : ''}" data-sabor="${p.flavor_id}">
          <div class="sabor__cab"><span class="emoji">${esc(p.emoji)}</span><div>
            <div class="sabor__nombre">${esc(p.nombre)}</div>
            <div class="sabor__precio">${promo ? `<s>${soles(p.precio_especial ?? p.precio_base)}</s> ` : ''}<b>${soles(p.precio_final)}</b>${p.promo_nombre ? ` · <span class="chip chip--exito">${esc(p.promo_nombre)}</span>` : ''}</div>
            <div class="sabor__stock">Stock: ${entero(p.stock)}</div></div></div>
          <div class="stepper"><button type="button" data-paso="-1" aria-label="Quitar uno">−</button>
            <input type="number" min="0" inputmode="numeric" value="${q}" aria-label="Cantidad de ${esc(p.nombre)}">
            <button type="button" data-paso="1" aria-label="Agregar uno">＋</button></div>
          <div class="rapidos"><button type="button" data-paso="5">+5</button><button type="button" data-paso="10">+10</button><button type="button" data-paso="20">+20</button></div>
        </div>`;
      }).join('') : vacio('🍧', 'No hay sabores activos.');
      resumir();
    };

    const resumir = () => {
      let cant = 0, sub = 0;
      st.precios.forEach((p) => { const q = st.items[p.flavor_id] || 0; cant += q; sub += q * Number(p.precio_final); });
      const desc = Math.min(sub, Math.max(0, Number($('#v-descuento').value) || 0));
      const costoDel = st.delivery && cant < c.delivery_minimo && c.delivery_modo === 'cobrar' ? Number(c.costo_delivery) : 0;
      $('#r-cant').textContent = entero(cant);
      $('#r-total').textContent = soles(sub - desc + costoDel);
      $('#r-comision').textContent = cant ? `Comisión: ${soles(cant * Number(c.pago_vendedor))}` : '';
      const rd = $('#r-delivery');
      if (!st.delivery) rd.innerHTML = '';
      else if (cant >= c.delivery_minimo) rd.innerHTML = `<div class="alerta alerta--exito">✓ <span><b>Envío gratis</b> (mínimo ${c.delivery_minimo} cumplido)</span></div>`;
      else rd.innerHTML = `<div class="alerta alerta--peligro">⚠️ <span><b>Mínimo ${c.delivery_minimo} para envío gratis</b> · faltan ${c.delivery_minimo - cant}. ${c.delivery_modo === 'bloquear' ? 'El pedido será rechazado.' : `Se cobrará delivery ${soles(c.costo_delivery)}.`}</span></div>`;
    };

    // Eventos
    $('#v-branch')?.addEventListener('change', (e) => { st.branch = e.target.value; st.items = {}; pintarVendedores(); cargarPrecios(); });
    $('#v-seller')?.addEventListener('change', (e) => { st.seller = e.target.value; });
    $('#v-canal').addEventListener('click', (e) => {
      const b = e.target.closest('[data-canal]'); if (!b) return;
      st.canal = b.dataset.canal; $$('#v-canal button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    });
    $('#v-delivery').addEventListener('change', (e) => { st.delivery = e.target.checked; $('#v-delivery-campos').hidden = !st.delivery; resumir(); });
    $('#v-descuento').addEventListener('input', resumir);
    $('#v-sabores').addEventListener('click', (e) => {
      const b = e.target.closest('[data-paso]'); if (!b) return;
      const card = b.closest('[data-sabor]'), id = card.dataset.sabor;
      st.items[id] = Math.max(0, (st.items[id] || 0) + Number(b.dataset.paso));
      $('input', card).value = st.items[id];
      card.classList.toggle('sabor--activo', st.items[id] > 0);
      resumir();
    });
    $('#v-sabores').addEventListener('input', (e) => {
      const card = e.target.closest('[data-sabor]'); if (!card) return;
      st.items[card.dataset.sabor] = Math.max(0, parseInt(e.target.value, 10) || 0);
      card.classList.toggle('sabor--activo', st.items[card.dataset.sabor] > 0);
      resumir();
    });

    $('#f-venta').addEventListener('submit', async (e) => {
      e.preventDefault();
      const lineas = st.precios.filter((p) => (st.items[p.flavor_id] || 0) > 0)
        .map((p) => ({ flavor_id: p.flavor_id, cantidad: st.items[p.flavor_id], sub: st.items[p.flavor_id] * Number(p.precio_final) }));
      if (!lineas.length) return toast('Agrega al menos un marciano.', 'aviso');
      // Reparte el descuento total entre las líneas (proporcional, en céntimos)
      const sub = lineas.reduce((a, l) => a + l.sub, 0);
      let resto = Math.round(Math.min(sub, Math.max(0, Number($('#v-descuento').value) || 0)) * 100);
      lineas.forEach((l, i) => {
        const d = i === lineas.length - 1 ? resto : Math.min(resto, Math.round((l.sub / sub) * resto));
        l.descuento = d / 100; resto -= d; delete l.sub;
      });
      const btn = $('#v-enviar'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const r = await rpc('registrar_venta', {
          p_items: lineas, p_canal: st.canal, p_delivery: st.delivery,
          p_cliente: $('#v-cliente').value, p_direccion: $('#v-direccion').value,
          p_branch: rol() === 'superadmin' ? st.branch : null,
          p_seller: rol() !== 'vendedor' ? st.seller : null, p_nota: $('#v-nota').value
        });
        toast(`Venta registrada: ${entero(r.cantidad)} marcianos · ${soles(r.total)} · comisión ${soles(r.comision)}`, 'exito', 5000);
        (r.bonos_nuevos || []).forEach((b) => toast(`¡Nivel ${b.nivel} desbloqueado! Bono de ${soles(b.monto)} por llegar a ${entero(b.hito)} marcianos`, 'fiesta', 9000));
        st.items = {}; $('#v-descuento').value = 0; $('#v-nota').value = ''; $('#v-cliente').value = ''; $('#v-direccion').value = '';
        await cargarPrecios();
      } catch (_) { /* el toast ya muestra el motivo (p. ej. mínimo de delivery) */ } finally {
        btn.disabled = false; btn.textContent = 'Registrar venta';
      }
    });

    pintarVendedores();
    await cargarPrecios();
    alCambiar(['inventory', 'flavors'], async () => { const prev = { ...st.items }; await cargarPrecios(); st.items = prev; pintarSabores(); });
  }

  /** Historial de ventas con filtros (gerente, super admin, solo lectura) */
  async function vistaVentas(el) {
    const f = { branch: '', seller: '', flavor: '', desde: sumarDias(hoyISO(), -6), hasta: hoyISO(), canal: '', delivery: '' };
    el.innerHTML = `
      <section class="tarjeta no-imprimir"><div class="filtros">
        ${esGlobal() ? `<label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" data-f="branch">${optSucursales('', 'Todas')}</select></label>` : ''}
        <label class="campo"><span class="campo__etiqueta">Vendedor</span><select class="campo__input" data-f="seller">${opciones(S.admins.filter((a) => ['vendedor', 'gerente', 'superadmin'].includes(a.rol_id)).map((a) => ({ v: a.id, t: a.nombre })), '', { vacio: 'Todos' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Sabor</span><select class="campo__input" data-f="flavor">${optSabores('', 'Todos')}</select></label>
        <label class="campo"><span class="campo__etiqueta">Canal</span><select class="campo__input" data-f="canal">${opciones(Object.entries(CANALES).map(([v, t]) => ({ v, t })), '', { vacio: 'Todos' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Tipo</span><select class="campo__input" data-f="delivery">${opciones([{ v: 'si', t: 'Solo delivery' }, { v: 'no', t: 'Solo local' }], '', { vacio: 'Todos' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Desde</span><input class="campo__input" type="date" data-f="desde" value="${f.desde}"></label>
        <label class="campo"><span class="campo__etiqueta">Hasta</span><input class="campo__input" type="date" data-f="hasta" value="${f.hasta}"></label>
      </div></section>
      <section class="kpis" id="v-tot"></section>
      <section class="tarjeta" id="v-lista"><div class="esqueleto"></div></section>`;
    $$('[data-f]', el).forEach((i) => i.addEventListener('change', () => { f[i.dataset.f] = i.value; cargar(); }));

    const cargar = async () => {
      const ini = new Date(`${f.desde}T00:00:00-05:00`).toISOString();
      const fin = new Date(`${sumarDias(f.hasta, 1)}T00:00:00-05:00`).toISOString();
      let q = sb.from('pedidos').select(`*, sales${f.flavor ? '!inner' : ''}(id, flavor_id, cantidad, precio_unitario, total)`)
        .gte('fecha', ini).lt('fecha', fin).order('fecha', { ascending: false }).limit(200);
      if (f.branch) q = q.eq('branch_id', f.branch);
      if (f.seller) q = q.eq('seller_id', f.seller);
      if (f.canal) q = q.eq('canal', f.canal);
      if (f.delivery) q = q.eq('delivery', f.delivery === 'si');
      if (f.flavor) q = q.eq('sales.flavor_id', f.flavor);
      const r = await conCache(`ventas:${JSON.stringify(f)}`, () => consulta(q, { silencioso: true }));
      const ped = r.v, validos = ped.filter((p) => !p.anulado);
      $('#v-tot').innerHTML = `<div class="kpi"><div class="kpi__etq">Pedidos</div><div class="kpi__val">${entero(validos.length)}</div></div>
        <div class="kpi"><div class="kpi__etq">Marcianos</div><div class="kpi__val">${entero(validos.reduce((a, p) => a + p.sales.reduce((b, s) => b + s.cantidad, 0), 0))}</div></div>
        <div class="kpi"><div class="kpi__etq">Total</div><div class="kpi__val">${soles(validos.reduce((a, p) => a + (f.flavor ? p.sales.reduce((b, s) => b + Number(s.total), 0) : Number(p.total)), 0))}</div></div>`;
      $('#v-lista').innerHTML = avisoCache(r) + (ped.length ? `<ul class="lista">${ped.map((p) => {
        const lineas = p.sales.map((s) => `${s.cantidad} ${sabor(s.flavor_id).emoji} ${esc(sabor(s.flavor_id).nombre)}`).join(', ');
        const repartidores = S.admins.filter((a) => a.rol_id === 'vendedor' && a.activo && a.branch_id === p.branch_id);
        return `<li style="align-items:flex-start">
          <span class="emoji">${p.delivery ? '🛵' : '🏪'}</span>
          <div class="lista__principal">
            <div class="lista__titulo">${entero(p.cantidad_total)} marcianos · ${esc(nombrePersona(p.seller_id))}</div>
            <div class="lista__det">${fecha(p.fecha)} · ${esc(nombreSucursal(p.branch_id))} · ${esc(CANALES[p.canal])}${p.cliente ? ` · ${esc(p.cliente)}` : ''}</div>
            <div class="lista__det">${lineas}</div>
            <div class="acciones" style="margin-top:6px">
              ${p.anulado ? `${chipEstado('anulado')} <span class="lista__det">${esc(p.motivo_anulacion || '')}</span>` : ''}
              ${p.delivery && !p.anulado ? `${p.envio_gratis ? '<span class="chip chip--exito">Envío gratis</span>' : '<span class="chip chip--aviso">No apto envío gratis</span>'}
                ${puede('ventas:editar') ? `<select class="campo__input btn--chico" style="width:auto;min-height:36px" data-estado-pedido="${p.id}" data-version="${p.version}" aria-label="Estado delivery">${opciones(Object.entries(ESTADOS_DELIVERY).map(([v, t]) => ({ v, t })), p.delivery_estado)}</select>` : chipEstado(p.delivery_estado)}
                ${puede('equipo:editar') ? `<select class="campo__input btn--chico" style="width:auto;min-height:36px" data-repartidor="${p.id}" aria-label="Repartidor">${opciones(repartidores.map((a) => ({ v: a.id, t: `🛵 ${a.nombre}` })), p.repartidor_id, { vacio: 'Sin repartidor' })}</select>` : ''}` : ''}
              ${!p.anulado && puede('ventas:anular') ? `<button class="btn btn--chico btn--peligro" data-anular="${p.id}">Anular</button>` : ''}
            </div>
          </div>
          <span class="lista__valor">${soles(p.total)}</span></li>`;
      }).join('')}</ul>` : vacio('🧾', 'No hay ventas con estos filtros.'));
    };

    el.addEventListener('change', async (e) => {
      const s = e.target.closest('[data-estado-pedido]');
      if (s) { await rpcConVersion('cambiar_estado_delivery', { p_pedido: s.dataset.estadoPedido, p_estado: s.value, p_version: Number(s.dataset.version) }).catch(() => {}); return cargar(); }
      const rp = e.target.closest('[data-repartidor]');
      if (rp) { await rpc('asignar_repartidor', { p_pedido: rp.dataset.repartidor, p_repartidor: rp.value || null }).then(() => toast('Repartidor asignado.', 'exito')).catch(() => {}); }
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-anular]'); if (!b) return;
      const motivo = await pedirTexto('Anular pedido', 'Motivo de la anulación', { requerido: true });
      if (!motivo) return;
      try { await rpc('anular_pedido', { p_pedido: b.dataset.anular, p_motivo: motivo }); toast('Pedido anulado: stock, pagos y bonos revertidos.', 'exito'); cargar(); } catch (_) {}
    });
    await cargar();
    alCambiar(['pedidos', 'sales'], cargar);
  }

  // ===================================================================
  // 9. COCINA: PANEL, LOTE, PRODUCCIÓN, DISPONIBILIDAD
  // ===================================================================
  async function panelCocina(el) {
    const cargar = async () => {
      const r = await conCache('panel-c', () => rpc('panel_cocina', {}, { silencioso: true }));
      const p = r.v, din = p.dinero || {};
      el.innerHTML = `${avisoCache(r)}
        <section class="heroe">
          <div class="heroe__etq">Acumulado del periodo ${esc(p.periodo)}</div>
          <div class="heroe__monto">${soles(din.total)}</div>
          <div class="heroe__det"><span>Pagado ${soles(din.pagado)}</span><span>Por cobrar ${soles(din.pendiente)}</span></div>
          <div class="heroe__mini">
            <div><b>${entero(p.hoy)}</b><span>preparados hoy</span></div>
            <div><b>${entero(p.preparados)}</b><span>en el periodo</span></div>
            <div><b>${entero(p.preparados_total)}</b><span>histórico</span></div>
          </div>
        </section>
        <p class="campo__ayuda">Ganas ${soles(p.pago_unitario)} por cada marciano preparado.</p>
        <a class="btn btn--acento btn--grande btn--bloque" href="#/lote">🧊 Registrar lote preparado</a>
        <section class="tarjeta"><h2 class="tarjeta__titulo">Mis lotes</h2>
          ${(p.lotes || []).length ? `<ul class="lista">${p.lotes.map((l) => `<li><span class="emoji">${esc(l.emoji)}</span>
            <div class="lista__principal"><div class="lista__titulo">${entero(l.cantidad)} ${esc(l.sabor)}</div>
            <div class="lista__det">${fecha(l.fecha)} · insumos ${soles(l.costo_total)}</div>
            <div style="margin-top:4px">${l.anulado ? chipEstado('anulado') : chipEstado(l.estado)}</div></div>
            <span class="lista__valor">${soles(l.pago_cocinero)}</span></li>`).join('')}</ul>` : vacio('🧊', 'Aún no registras lotes.')}
        </section>`;
    };
    await cargar();
    alCambiar(['production_batches', 'payments'], cargar);
  }

  async function vistaLote(el) {
    const c = S.cfg;
    const cocineros = S.admins.filter((a) => a.activo && (a.rol_id === 'cocina' || a.id === S.perfil.id));
    let branch = S.perfil.branch_id || S.branches.find((b) => b.activo)?.id;
    el.innerHTML = `<form id="f-lote" class="rejilla">
      <section class="tarjeta rejilla-form">
        <label class="campo"><span class="campo__etiqueta">Sabor</span><select class="campo__input" id="l-sabor" required>${optSabores('', 'Elige un sabor')}</select></label>
        <div class="campo"><span class="campo__etiqueta">Cantidad preparada</span>
          <div class="stepper" style="grid-template-columns:56px 1fr 56px"><button type="button" data-p="-10">−10</button>
          <input id="l-cant" type="number" min="1" inputmode="numeric" value="50" style="font-size:1.8rem;height:56px">
          <button type="button" data-p="10">+10</button></div></div>
        <label class="campo"><span class="campo__etiqueta">Costo de insumos del lote (S/)</span>
          <input class="campo__input num" id="l-costo" type="number" min="0" step="0.10" inputmode="decimal">
          <span class="campo__ayuda" id="l-costo-ayuda">Se calcula con el costo del sabor; puedes corregirlo.</span></label>
        ${rol() !== 'cocina' ? `<div class="rejilla-form rejilla-form--2">
          ${rol() === 'superadmin' ? `<label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" id="l-branch">${optSucursales(branch)}</select></label>` : ''}
          <label class="campo"><span class="campo__etiqueta">Cocinero</span><select class="campo__input" id="l-cook"></select></label></div>` : ''}
        <label class="campo"><span class="campo__etiqueta">Nota (opcional)</span><input class="campo__input" id="l-nota"></label>
      </section>
      <section class="resumen"><div class="resumen__fila"><span>Pago al cocinero</span><span class="resumen__total" id="l-pago">S/ 0.00</span></div>
        <button class="btn btn--primario btn--grande btn--bloque" id="l-enviar">Registrar lote</button></section>
    </form>`;
    let costoManual = false;
    const pintarCocineros = () => {
      const s = $('#l-cook'); if (!s) return;
      s.innerHTML = opciones(cocineros.filter((a) => a.branch_id === branch || a.id === S.perfil.id).map((a) => ({ v: a.id, t: a.nombre })), '');
    };
    const calc = () => {
      const q = Math.max(0, parseInt($('#l-cant').value, 10) || 0);
      const f = S.flavors.find((x) => x.id === $('#l-sabor').value);
      if (!costoManual) $('#l-costo').value = f ? (q * Number(f.costo_insumos)).toFixed(2) : '';
      $('#l-pago').textContent = soles(q * Number(c.pago_cocinero));
    };
    $('#l-sabor').addEventListener('change', calc);
    $('#l-cant').addEventListener('input', calc);
    $('#l-costo').addEventListener('input', () => { costoManual = true; });
    $('#l-branch')?.addEventListener('change', (e) => { branch = e.target.value; pintarCocineros(); });
    $('.stepper', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      $('#l-cant').value = Math.max(1, (parseInt($('#l-cant').value, 10) || 0) + Number(b.dataset.p)); calc();
    });
    $('#f-lote').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!$('#l-sabor').value) return toast('Elige un sabor.', 'aviso');
      const btn = $('#l-enviar'); btn.disabled = true;
      try {
        const r = await rpc('registrar_lote', {
          p_flavor: $('#l-sabor').value, p_cantidad: parseInt($('#l-cant').value, 10),
          p_costo_total: $('#l-costo').value === '' ? null : Number($('#l-costo').value),
          p_branch: rol() === 'superadmin' ? branch : null, p_cook: $('#l-cook')?.value || null, p_nota: $('#l-nota').value
        });
        toast(`Lote registrado: ${entero(r.cantidad)} marcianos · pago ${soles(r.pago_cocinero)}${r.estado === 'pendiente' ? ' (por aprobar)' : ''}`, 'exito', 5000);
        location.hash = rol() === 'cocina' ? '#/inicio' : '#/produccion';
      } catch (_) {} finally { btn.disabled = false; }
    });
    pintarCocineros(); calc();
  }

  async function vistaProduccion(el) {
    let pestana = 'lotes', soloPend = false, semana = lunesDe(hoyISO());
    el.innerHTML = `<div class="acciones no-imprimir"><div class="segmento" id="p-tab" style="flex:1">
        <button type="button" data-t="lotes" aria-pressed="true">🧊 Lotes</button><button type="button" data-t="disp" aria-pressed="false">🗓️ Disponibilidad</button></div>
        ${puede('produccion:editar') ? '<a class="btn btn--primario" href="#/lote">＋ Lote</a>' : ''}</div>
      <div id="p-cont" class="rejilla"></div>`;
    $('#p-tab').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      pestana = b.dataset.t; $$('#p-tab button').forEach((x) => x.setAttribute('aria-pressed', x === b)); cargar();
    });

    const cargar = async () => {
      const cont = $('#p-cont');
      if (pestana === 'lotes') {
        let q = sb.from('production_batches').select('*').order('fecha', { ascending: false }).limit(100);
        if (soloPend) q = q.eq('estado', 'pendiente').eq('anulado', false);
        if (S.filtroSucursal && esGlobal()) q = q.eq('branch_id', S.filtroSucursal);
        const r = await conCache(`lotes:${soloPend}`, () => consulta(q, { silencioso: true }));
        cont.innerHTML = `${avisoCache(r)}<section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Lotes registrados</h2>
          <label class="switch" style="min-height:0;gap:.5rem"><span class="tarjeta__sub">Solo pendientes</span><input type="checkbox" id="p-pend" ${soloPend ? 'checked' : ''}></label></div>
          ${r.v.length ? `<ul class="lista">${r.v.map((l) => `<li style="align-items:flex-start"><span class="emoji">${esc(sabor(l.flavor_id).emoji)}</span>
            <div class="lista__principal"><div class="lista__titulo">${entero(l.cantidad)} ${esc(sabor(l.flavor_id).nombre)} · ${esc(nombrePersona(l.cook_id))}</div>
            <div class="lista__det">${fecha(l.fecha)} · ${esc(nombreSucursal(l.branch_id))} · insumos ${soles(l.costo_total)}${l.nota ? ` · ${esc(l.nota)}` : ''}</div>
            <div class="acciones" style="margin-top:6px">${l.anulado ? chipEstado('anulado') : chipEstado(l.estado)}
            ${!l.anulado && l.estado === 'pendiente' && puede('produccion:aprobar') ? `<button class="btn btn--chico btn--exito" data-lote="${l.id}" data-ok="1" data-version="${l.version}">✓ Aprobar</button><button class="btn btn--chico btn--peligro" data-lote="${l.id}" data-ok="0" data-version="${l.version}">✕ Rechazar</button>` : ''}</div></div>
            <span class="lista__valor">${soles(l.pago_cocinero)}</span></li>`).join('')}</ul>` : vacio('🧊', 'No hay lotes.')}</section>`;
        $('#p-pend').onchange = (e) => { soloPend = e.target.checked; cargar(); };
      } else {
        const fin = sumarDias(semana, 6);
        const r = await conCache(`disp:${semana}`, () => consulta(sb.from('disponibilidad').select('*').gte('dia', semana).lte('dia', fin).order('desde'), { silencioso: true }));
        const editable = puede('equipo:editar');
        cont.innerHTML = `${avisoCache(r)}<section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Disponibilidad de cocina</h2>
          <div class="acciones"><button class="btn btn--chico btn--fantasma" data-sem="-7">◀</button><span class="tarjeta__sub">${fDia.format(new Date(`${semana}T12:00:00Z`))} – ${fDia.format(new Date(`${fin}T12:00:00Z`))}</span><button class="btn btn--chico btn--fantasma" data-sem="7">▶</button>
          ${editable ? '<button class="btn btn--chico btn--primario" data-nuevo-turno>＋ Turno</button>' : ''}</div></div>
          ${calendarioSemana(semana, r.v, { mostrarNombre: true, borrar: editable })}</section>`;
      }
    };

    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-lote]');
      if (b) {
        b.disabled = true;
        try { const r = await rpcConVersion('aprobar_lote', { p_lote: b.dataset.lote, p_aprobar: b.dataset.ok === '1', p_version: Number(b.dataset.version) }); if (r) toast(b.dataset.ok === '1' ? 'Lote aprobado.' : 'Lote rechazado: stock y pago revertidos.', 'exito'); } catch (_) {}
        return cargar();
      }
      const s = e.target.closest('[data-sem]'); if (s) { semana = sumarDias(semana, Number(s.dataset.sem)); return cargar(); }
      if (e.target.closest('[data-nuevo-turno]')) return modalTurno(cargar, { elegirCocinero: true });
      const del = e.target.closest('[data-borrar-turno]');
      if (del && await confirmar('Eliminar turno', '¿Seguro que deseas eliminar este turno?', { ok: 'Eliminar', peligro: true })) {
        await consulta(sb.from('disponibilidad').delete().eq('id', del.dataset.borrarTurno)).catch(() => {}); cargar();
      }
    });
    await cargar();
    alCambiar(['production_batches'], () => { if (pestana === 'lotes') cargar(); });
  }

  function calendarioSemana(lunes, turnos, { mostrarNombre = false, borrar = false } = {}) {
    const hoy = hoyISO();
    return `<div class="semana">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const dia = sumarDias(lunes, i);
      const t = turnos.filter((x) => x.dia === dia);
      return `<div class="dia ${dia === hoy ? 'dia--hoy' : ''}"><div class="dia__cab">${esc(fDiaSemana.format(new Date(`${dia}T12:00:00Z`)))}</div><div>
        ${t.map((x) => `<div class="turno"><b>${x.desde.slice(0, 5)}–${x.hasta.slice(0, 5)}</b>${mostrarNombre ? `<br>${esc(nombrePersona(x.cook_id))}` : ''}${x.nota ? `<br><span class="muted">${esc(x.nota)}</span>` : ''}
          ${borrar ? ` <button class="btn-icono" style="width:28px;height:28px;font-size:.75rem" data-borrar-turno="${x.id}" aria-label="Eliminar turno">✕</button>` : ''}</div>`).join('') || '<span class="muted">—</span>'}</div></div>`;
    }).join('')}</div>`;
  }

  function modalTurno(alGuardar, { elegirCocinero = false } = {}) {
    const cocineros = S.admins.filter((a) => a.activo && a.rol_id === 'cocina' && (esGlobal() || a.branch_id === S.perfil.branch_id));
    abrirModal(`<h2>Nuevo turno disponible</h2><form id="f-turno" class="rejilla-form">
      ${elegirCocinero ? `<label class="campo"><span class="campo__etiqueta">Cocinero</span><select class="campo__input" name="cook" required>${opciones(cocineros.map((a) => ({ v: a.id, t: a.nombre })), '')}</select></label>` : ''}
      <label class="campo"><span class="campo__etiqueta">Día</span><input class="campo__input" type="date" name="dia" value="${hoyISO()}" required></label>
      <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Desde</span><input class="campo__input" type="time" name="desde" value="09:00" required></label>
      <label class="campo"><span class="campo__etiqueta">Hasta</span><input class="campo__input" type="time" name="hasta" value="13:00" required></label></div>
      <label class="campo"><span class="campo__etiqueta">Nota</span><input class="campo__input" name="nota" placeholder="Ej. puedo preparar 200"></label>
      <div class="modal__pie"><button class="btn btn--primario">Guardar turno</button></div></form>`, (m) => {
      $('#f-turno', m).onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const cook = elegirCocinero ? f.cook.value : S.perfil.id;
        const fila = { cook_id: cook, branch_id: persona(cook)?.branch_id ?? S.perfil.branch_id, dia: f.dia.value, desde: f.desde.value, hasta: f.hasta.value, nota: f.nota.value || null };
        if (fila.hasta <= fila.desde) return toast('La hora final debe ser mayor a la inicial.', 'aviso');
        try { await consulta(sb.from('disponibilidad').insert(fila)); toast('Turno guardado.', 'exito'); cerrarModal(); alGuardar(); } catch (_) {}
      };
    });
  }

  async function vistaHorario(el) {
    let semana = lunesDe(hoyISO());
    const cargar = async () => {
      const fin = sumarDias(semana, 6);
      const r = await conCache(`mi-disp:${semana}`, () => consulta(sb.from('disponibilidad').select('*').eq('cook_id', S.perfil.id).gte('dia', semana).lte('dia', fin).order('desde'), { silencioso: true }));
      el.innerHTML = `${avisoCache(r)}<section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Cuándo puedo preparar</h2><p class="tarjeta__sub">Tu gerente ve estos turnos para planificar.</p></div>
        <div class="acciones"><button class="btn btn--chico btn--fantasma" data-sem="-7" aria-label="Semana anterior">◀</button><button class="btn btn--chico btn--fantasma" data-sem="7" aria-label="Semana siguiente">▶</button></div></div>
        ${calendarioSemana(semana, r.v, { borrar: true })}</section>
        <button class="btn btn--acento btn--grande btn--bloque" data-nuevo-turno>＋ Agregar turno</button>`;
    };
    el.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-sem]'); if (s) { semana = sumarDias(semana, Number(s.dataset.sem)); return cargar(); }
      if (e.target.closest('[data-nuevo-turno]')) return modalTurno(cargar);
      const del = e.target.closest('[data-borrar-turno]');
      if (del && await confirmar('Eliminar turno', '¿Eliminar este turno?', { ok: 'Eliminar', peligro: true })) {
        await consulta(sb.from('disponibilidad').delete().eq('id', del.dataset.borrarTurno)).catch(() => {}); cargar();
      }
    });
    await cargar();
  }

  // ===================================================================
  // 10. INVENTARIO Y PRODUCTOS
  // ===================================================================
  async function vistaInventario(el) {
    const cargar = async () => {
      const [inv, mov] = await Promise.all([
        conCache('inv', () => consulta(sb.from('inventory').select('*'), { silencioso: true })),
        conCache('inv-mov', () => consulta(sb.from('inventory_movements').select('*').order('fecha', { ascending: false }).limit(40), { silencioso: true }))
      ]);
      const sucs = esGlobal() ? S.branches.filter((b) => b.activo) : S.branches.filter((b) => b.id === S.perfil.branch_id);
      const umbral = S.cfg.stock_bajo_umbral;
      const stock = (f, b) => inv.v.find((i) => i.flavor_id === f && i.branch_id === b)?.stock ?? 0;
      el.innerHTML = `${avisoCache(inv)}
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Stock por sabor y sucursal</h2><p class="tarjeta__sub">⚠ = igual o menor a ${umbral} unidades</p></div>
          ${puede('inventario:editar') ? '<button class="btn btn--primario btn--chico" data-ajuste>± Ajuste manual</button>' : ''}</div>
          <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Sabor</th>${sucs.map((b) => `<th class="num">${esc(b.nombre)}</th>`).join('')}${sucs.length > 1 ? '<th class="num">Total</th>' : ''}</tr></thead>
          <tbody>${S.flavors.filter((f) => f.activo).map((f) => {
            const vals = sucs.map((b) => stock(f.id, b.id));
            return `<tr><td>${esc(f.emoji)} ${esc(f.nombre)}</td>${vals.map((v) => `<td class="num ${v <= umbral ? 'celda-baja' : ''}">${v <= umbral ? '⚠ ' : ''}${entero(v)}</td>`).join('')}${sucs.length > 1 ? `<td class="num"><b>${entero(vals.reduce((a, b) => a + b, 0))}</b></td>` : ''}</tr>`;
          }).join('')}</tbody></table></div></section>
        <section class="tarjeta"><h2 class="tarjeta__titulo">Últimos movimientos</h2>
          ${mov.v.length ? `<ul class="lista">${mov.v.map((m) => `<li><span class="emoji">${{ produccion: '🧊', venta: '🛒', ajuste: '✏️', reversion: '↩️' }[m.tipo]}</span>
            <div class="lista__principal"><div class="lista__titulo">${esc(sabor(m.flavor_id).nombre)} · ${esc(nombreSucursal(m.branch_id))}</div>
            <div class="lista__det">${fecha(m.fecha)} · ${esc(m.tipo)}${m.motivo ? ` · ${esc(m.motivo)}` : ''}${m.admin_id ? ` · ${esc(nombrePersona(m.admin_id))}` : ''}</div></div>
            <span class="lista__valor" style="color:${m.cantidad < 0 ? 'var(--peligro)' : 'var(--exito)'}">${m.cantidad > 0 ? '+' : ''}${entero(m.cantidad)}</span></li>`).join('')}</ul>` : vacio('📦', 'Sin movimientos.')}</section>`;
    };
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-ajuste]')) return;
      abrirModal(`<h2>Ajuste manual de inventario</h2><form id="f-aj" class="rejilla-form">
        <label class="campo"><span class="campo__etiqueta">Sabor</span><select class="campo__input" name="f" required>${optSabores('')}</select></label>
        ${esGlobal() ? `<label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" name="b">${optSucursales('')}</select></label>` : ''}
        <label class="campo"><span class="campo__etiqueta">Cantidad (+ entra / − sale)</span><input class="campo__input num" type="number" name="d" required placeholder="-5 por merma"></label>
        <label class="campo"><span class="campo__etiqueta">Motivo</span><input class="campo__input" name="m" required placeholder="Merma, conteo físico, regalo…"></label>
        <div class="modal__pie"><button class="btn btn--primario">Guardar ajuste</button></div></form>`, (m) => {
        $('#f-aj', m).onsubmit = async (ev) => {
          ev.preventDefault(); const f = ev.target;
          try {
            await rpc('ajustar_inventario', { p_flavor: f.f.value, p_branch: f.b?.value || S.perfil.branch_id, p_delta: parseInt(f.d.value, 10), p_motivo: f.m.value });
            toast('Ajuste registrado.', 'exito'); cerrarModal(); cargar();
          } catch (_) {}
        };
      });
    });
    await cargar();
    alCambiar(['inventory'], cargar);
  }

  async function vistaProductos(el) {
    const editable = puede('productos:editar');
    const obj = () => Number(S.cfg.margen_objetivo);
    const sugerido = (costo) => Number(costo) / (1 - obj());
    const cargar = async () => {
      const [fl, bp, pr] = await Promise.all([
        conCache('flavors', () => consulta(sb.from('flavors').select('*').order('nombre'), { silencioso: true })),
        conCache('bprices', () => consulta(sb.from('branch_prices').select('*'), { silencioso: true })),
        conCache('promos', () => consulta(sb.from('promotions').select('*').order('created_at', { ascending: false }), { silencioso: true }))
      ]);
      S.flavors = fl.v;
      el.innerHTML = `${avisoCache(fl)}
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Sabores</h2><p class="tarjeta__sub">Precio sugerido = costo ÷ (1 − ${pct(obj(), 0)}) · rango ${soles(S.cfg.precio_min)}–${soles(S.cfg.precio_max)}</p></div>
          ${editable ? '<button class="btn btn--primario btn--chico" data-sabor-nuevo>＋ Sabor</button>' : ''}</div>
          <ul class="lista">${fl.v.map((f) => `<li>
            <span class="emoji" style="background:${esc(f.color)}33">${esc(f.emoji)}</span>
            <div class="lista__principal"><div class="lista__titulo">${esc(f.nombre)} ${f.activo ? '' : '<span class="chip">Inactivo</span>'}</div>
              <div class="lista__det">Costo ${soles(f.costo_insumos)} · Sugerido ${soles(sugerido(f.costo_insumos))}</div>
              <div style="margin-top:4px">${Number(f.margen) >= obj() ? `<span class="chip chip--exito">Margen ${pct(f.margen)}</span>` : `<span class="chip chip--peligro">⚠ Margen ${pct(f.margen)} · bajo ${pct(obj(), 0)}</span>`}</div></div>
            <span class="lista__valor">${soles(f.precio_venta)}</span>
            ${editable ? `<button class="btn btn--chico btn--fantasma" data-sabor-editar="${f.id}">Editar</button>` : ''}</li>`).join('')}</ul></section>
        <div class="rejilla rejilla--2">
          <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Precios especiales por sucursal</h2>${editable ? '<button class="btn btn--chico btn--fantasma" data-bp-nuevo>＋ Precio</button>' : ''}</div>
            ${bp.v.length ? `<ul class="lista">${bp.v.map((b) => `<li><span class="emoji">${esc(sabor(b.flavor_id).emoji)}</span><div class="lista__principal"><div class="lista__titulo">${esc(sabor(b.flavor_id).nombre)}</div><div class="lista__det">${esc(nombreSucursal(b.branch_id))} ${b.activo ? '' : '· inactivo'}</div></div><span class="lista__valor">${soles(b.precio)}</span>
              ${editable ? `<button class="btn btn--chico btn--fantasma" data-bp-toggle="${b.id}" data-v="${b.version}" data-activo="${b.activo}">${b.activo ? 'Desactivar' : 'Activar'}</button>` : ''}</li>`).join('')}</ul>` : vacio('🏷️', 'Todas las sucursales usan el precio base.')}</section>
          <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Promociones y descuentos</h2>${editable ? '<button class="btn btn--chico btn--fantasma" data-promo-nueva>＋ Promo</button>' : ''}</div>
            ${pr.v.length ? `<ul class="lista">${pr.v.map((p) => `<li><span class="emoji">🎉</span><div class="lista__principal"><div class="lista__titulo">${esc(p.nombre)}</div>
              <div class="lista__det">${p.tipo === 'porcentaje' ? `${p.valor} %` : `−${soles(p.valor)} c/u`} · ${p.flavor_id ? esc(sabor(p.flavor_id).nombre) : 'Todos los sabores'} · ${p.branch_id ? esc(nombreSucursal(p.branch_id)) : 'Todas las sucursales'}</div>
              <div class="lista__det">${fecha(p.desde)} → ${p.hasta ? fecha(p.hasta) : 'sin fin'}</div></div>
              ${p.activo ? '<span class="chip chip--exito">Activa</span>' : '<span class="chip">Inactiva</span>'}
              ${editable ? `<button class="btn btn--chico btn--fantasma" data-promo-toggle="${p.id}" data-v="${p.version}" data-activo="${p.activo}">${p.activo ? 'Pausar' : 'Activar'}</button>` : ''}</li>`).join('')}</ul>` : vacio('🎉', 'Sin promociones.')}</section>
        </div>`;
    };

    const modalSabor = (f) => {
      const nuevo = !f;
      f = f || { nombre: '', emoji: '🍧', color: '#36E4D7', costo_insumos: 0.6, precio_venta: 2, activo: true };
      if (!nuevo) S.editando = { tabla: 'flavors', id: f.id, version: f.version };
      abrirModal(`<h2>${nuevo ? 'Nuevo sabor' : `Editar ${esc(f.nombre)}`}</h2>
        <div class="alerta alerta--aviso" id="aviso-edicion" hidden></div>
        <form id="f-sabor" class="rejilla-form">
          <div class="rejilla-form rejilla-form--3">
            <label class="campo" style="grid-column:span 2"><span class="campo__etiqueta">Nombre</span><input class="campo__input" name="nombre" value="${esc(f.nombre)}" required></label>
            <label class="campo"><span class="campo__etiqueta">Emoji</span><input class="campo__input" name="emoji" value="${esc(f.emoji)}" maxlength="4"></label></div>
          <div class="rejilla-form rejilla-form--3">
            <label class="campo"><span class="campo__etiqueta">Costo insumos (S/)</span><input class="campo__input num" name="costo" type="number" min="0" step="0.01" value="${f.costo_insumos}" required></label>
            <label class="campo"><span class="campo__etiqueta">Precio venta (S/)</span><input class="campo__input num" name="precio" type="number" min="${S.cfg.precio_min}" max="${S.cfg.precio_max}" step="0.10" value="${f.precio_venta}" required></label>
            <label class="campo"><span class="campo__etiqueta">Color</span><input class="campo__input" name="color" type="color" value="${esc(f.color || '#36E4D7')}"></label></div>
          <div id="s-calc" class="alerta alerta--info"></div>
          <label class="switch"><span>Activo (visible para vender)</span><input type="checkbox" name="activo" ${f.activo ? 'checked' : ''}></label>
          <div class="modal__pie"><button type="button" class="btn btn--fantasma" data-usar-sugerido>Usar precio sugerido</button><button class="btn btn--primario">Guardar</button></div>
        </form>`, (m) => {
        const form = $('#f-sabor', m);
        const calc = () => {
          const c = Number(form.costo.value) || 0, p = Number(form.precio.value) || 0;
          const mg = p > 0 ? (p - c) / p : 0, sug = sugerido(c);
          const box = $('#s-calc', m);
          box.className = `alerta ${mg < obj() ? 'alerta--peligro' : 'alerta--exito'}`;
          box.innerHTML = `${mg < obj() ? '⚠️' : '✓'} <span>Margen bruto <b>${pct(mg)}</b> · sugerido para ${pct(obj(), 0)}: <b>${soles(sug)}</b>${sug > S.cfg.precio_max ? ` (supera el máximo ${soles(S.cfg.precio_max)}: revisa costos)` : ''}</span>`;
        };
        form.addEventListener('input', calc); calc();
        $('[data-usar-sugerido]', m).onclick = () => {
          const s = Math.min(S.cfg.precio_max, Math.max(S.cfg.precio_min, Math.ceil(sugerido(form.costo.value) * 10) / 10));
          form.precio.value = s.toFixed(2); calc();
        };
        form.onsubmit = async (e) => {
          e.preventDefault();
          const datos = { nombre: form.nombre.value.trim(), emoji: form.emoji.value || '🍧', color: form.color.value,
            costo_insumos: Number(form.costo.value), precio_venta: Number(form.precio.value), activo: form.activo.checked };
          try {
            const g = nuevo ? (await consulta(sb.from('flavors').insert(datos).select()))[0] : await actualizarConVersion('flavors', f, datos);
            if (!g) return;
            cerrarModal();
            if (Number(g.margen) < obj()) toast(`Margen de ${g.nombre} cayó a ${pct(g.margen)} (bajo ${pct(obj(), 0)}). Precio sugerido ${soles(sugerido(g.costo_insumos))}.`, 'aviso', 9000);
            else toast(`${g.nombre} guardado · margen ${pct(g.margen)}.`, 'exito');
            cargar();
          } catch (_) {}
        };
      });
    };

    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-sabor-nuevo]')) return modalSabor(null);
      const ed = e.target.closest('[data-sabor-editar]');
      if (ed) return modalSabor(S.flavors.find((x) => x.id === ed.dataset.saborEditar));
      if (e.target.closest('[data-bp-nuevo]')) {
        return abrirModal(`<h2>Precio especial por sucursal</h2><form id="f-bp" class="rejilla-form">
          <label class="campo"><span class="campo__etiqueta">Sabor</span><select class="campo__input" name="f">${optSabores('')}</select></label>
          <label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" name="b">${optSucursales('')}</select></label>
          <label class="campo"><span class="campo__etiqueta">Precio (S/)</span><input class="campo__input num" type="number" step="0.10" min="0.10" name="p" required></label>
          <div class="modal__pie"><button class="btn btn--primario">Guardar</button></div></form>`, (m) => {
          $('#f-bp', m).onsubmit = async (ev) => {
            ev.preventDefault(); const f = ev.target;
            try { await consulta(sb.from('branch_prices').upsert({ flavor_id: f.f.value, branch_id: f.b.value, precio: Number(f.p.value), activo: true }, { onConflict: 'flavor_id,branch_id' })); cerrarModal(); toast('Precio especial guardado.', 'exito'); cargar(); } catch (_) {}
          };
        });
      }
      if (e.target.closest('[data-promo-nueva]')) {
        return abrirModal(`<h2>Nueva promoción</h2><form id="f-pr" class="rejilla-form">
          <label class="campo"><span class="campo__etiqueta">Nombre</span><input class="campo__input" name="n" required placeholder="Verano 10 %"></label>
          <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Sabor</span><select class="campo__input" name="f">${optSabores('', 'Todos')}</select></label>
          <label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" name="b">${optSucursales('', 'Todas')}</select></label></div>
          <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Tipo</span><select class="campo__input" name="t"><option value="porcentaje">% de descuento</option><option value="monto">S/ menos por unidad</option></select></label>
          <label class="campo"><span class="campo__etiqueta">Valor</span><input class="campo__input num" type="number" step="0.01" min="0.01" name="v" required></label></div>
          <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Desde</span><input class="campo__input" type="date" name="d" value="${hoyISO()}"></label>
          <label class="campo"><span class="campo__etiqueta">Hasta (opcional)</span><input class="campo__input" type="date" name="h"></label></div>
          <div class="modal__pie"><button class="btn btn--primario">Crear promoción</button></div></form>`, (m) => {
          $('#f-pr', m).onsubmit = async (ev) => {
            ev.preventDefault(); const f = ev.target;
            const fila = { nombre: f.n.value, flavor_id: f.f.value || null, branch_id: f.b.value || null, tipo: f.t.value, valor: Number(f.v.value),
              desde: new Date(`${f.d.value}T00:00:00-05:00`).toISOString(), hasta: f.h.value ? new Date(`${sumarDias(f.h.value, 1)}T00:00:00-05:00`).toISOString() : null };
            try { await consulta(sb.from('promotions').insert(fila)); cerrarModal(); toast('Promoción creada.', 'exito'); cargar(); } catch (_) {}
          };
        });
      }
      const tg = e.target.closest('[data-bp-toggle],[data-promo-toggle]');
      if (tg) {
        const tabla = tg.dataset.bpToggle ? 'branch_prices' : 'promotions';
        const g = await actualizarConVersion(tabla, { id: tg.dataset.bpToggle || tg.dataset.promoToggle, version: Number(tg.dataset.v) }, { activo: tg.dataset.activo !== 'true' }).catch(() => null);
        if (g) cargar();
      }
    });
    await cargar();
    alCambiar(['flavors'], () => { if (!$('#modal').open) cargar(); });
  }

  // ===================================================================
  // 11. INCENTIVOS Y PAGOS
  // ===================================================================
  async function vistaIncentivos(el) {
    const per = S.perfil.periodo;
    const cargar = async () => {
      const [sp, bo] = await Promise.all([
        conCache('progreso', () => consulta(sb.from('seller_progress').select('*').eq('periodo', per), { silencioso: true })),
        conCache('bonos', () => consulta(sb.from('bonuses').select('*').eq('anulado', false).order('fecha', { ascending: false }).limit(100), { silencioso: true }))
      ]);
      const vendedores = S.admins.filter((a) => a.rol_id === 'vendedor' && a.activo);
      const filas = vendedores.map((v) => ({ v, sp: sp.v.find((x) => x.seller_id === v.id) || { marcianos_vendidos: 0, bonos_ganados: 0 } }))
        .sort((a, b) => b.sp.marcianos_vendidos - a.sp.marcianos_vendidos);
      el.innerHTML = `${avisoCache(sp)}
        <section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Niveles del equipo</h2><p class="tarjeta__sub">Periodo ${esc(per)} · hitos ${(S.cfg.hitos || []).map((h) => `${entero(h.umbral)} → ${h.nivel} (${soles(h.bono)})`).join(' · ')}</p></div></div>
          ${filas.length ? `<ul class="lista">${filas.map(({ v, sp: s }) => { const p = progresoNivel(s.marcianos_vendidos); return `<li>
            <div class="insignia" data-nivel="${esc(p.nivel)}" style="width:48px;height:48px;font-size:1.3rem;border-width:2px">${NIVEL_EMOJI[p.nivel] || '⭐'}</div>
            <div class="lista__principal"><div class="lista__titulo">${esc(v.nombre)} <span class="punto-online" data-online="${v.id}" hidden style="display:inline-block"></span></div>
              <div class="barra barra--chica" style="margin:5px 0"><div class="barra__relleno" style="width:${(p.progreso * 100).toFixed(1)}%"></div></div>
              <div class="lista__det">${esc(p.nivel)} · ${esc(nombreSucursal(v.branch_id))} · ${p.sig ? `faltan ${entero(p.faltan)} para ${esc(p.sig.nivel)}` : 'nivel máximo'} · bonos ${soles(s.bonos_ganados)}</div></div>
            <span class="lista__valor">${entero(s.marcianos_vendidos)}</span></li>`; }).join('')}</ul>` : vacio('🛵', 'No hay vendedores activos.')}</section>
        <section class="tarjeta"><h2 class="tarjeta__titulo">Bonos generados</h2>
          ${bo.v.length ? `<ul class="lista">${bo.v.map((b) => `<li><span class="emoji">${NIVEL_EMOJI[b.nivel] || '🎁'}</span>
            <div class="lista__principal"><div class="lista__titulo">${esc(nombrePersona(b.seller_id))} · ${esc(b.nivel)} (${entero(b.hito)})</div><div class="lista__det">${esc(b.periodo)} · ${fecha(b.fecha)}</div></div>
            ${b.pagado ? chipEstado('pagado') : b.aprobado ? chipEstado('aprobado') : (puede('incentivos:aprobar') ? `<button class="btn btn--chico btn--exito" data-aprobar-bono="${b.id}">Aprobar</button>` : '<span class="chip chip--aviso">Por aprobar</span>')}
            <span class="lista__valor">${soles(b.monto)}</span></li>`).join('')}</ul>` : vacio('🎁', 'Aún no hay bonos.')}</section>`;
      pintarPresencia();
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-aprobar-bono]'); if (!b) return;
      b.disabled = true;
      try { await rpc('aprobar_bono', { p_bono: b.dataset.aprobarBono }); toast('Bono aprobado.', 'exito'); } catch (_) {}
      cargar();
    });
    await cargar();
    alCambiar(['seller_progress', 'bonuses'], cargar);
  }

  async function vistaPagos(el) {
    let per = S.perfil.periodo;
    const cargar = async () => {
      const r = await conCache(`pagos:${per}`, () => consulta(sb.from('payments').select('*').eq('periodo', per).neq('estado', 'anulado'), { silencioso: true }));
      const porPersona = new Map();
      r.v.forEach((p) => {
        const o = porPersona.get(p.admin_id) || { cocina: 0, venta: 0, bono: 0, ajuste: 0, total: 0, pagado: 0, pendiente: 0, branch: p.branch_id };
        o[p.tipo] += Number(p.monto); o.total += Number(p.monto); o[p.estado] += Number(p.monto);
        porPersona.set(p.admin_id, o);
      });
      const filas = [...porPersona.entries()].sort((a, b) => b[1].total - a[1].total);
      const tot = filas.reduce((a, [, o]) => { Object.keys(a).forEach((k) => { a[k] += o[k]; }); return a; }, { cocina: 0, venta: 0, bono: 0, ajuste: 0, total: 0, pagado: 0, pendiente: 0 });
      el.innerHTML = `${avisoCache(r)}
        <section class="tarjeta no-imprimir"><div class="filtros"><label class="campo"><span class="campo__etiqueta">Periodo</span><input class="campo__input" id="pg-per" value="${esc(per)}" placeholder="2026-11"></label>
          <button class="btn btn--fantasma" id="pg-ir">Ver</button></div><p class="campo__ayuda" style="margin-top:6px">Los bonos solo se liquidan si están aprobados.</p></section>
        <section class="kpis"><div class="kpi kpi--destacado"><div class="kpi__etq">Nómina del periodo</div><div class="kpi__val">${soles(tot.total)}</div></div>
          <div class="kpi"><div class="kpi__etq">Cocina</div><div class="kpi__val">${soles(tot.cocina)}</div></div>
          <div class="kpi"><div class="kpi__etq">Comisiones</div><div class="kpi__val">${soles(tot.venta)}</div></div>
          <div class="kpi"><div class="kpi__etq">Bonos</div><div class="kpi__val">${soles(tot.bono)}</div></div>
          <div class="kpi"><div class="kpi__etq">Pagado</div><div class="kpi__val">${soles(tot.pagado)}</div></div>
          <div class="kpi"><div class="kpi__etq">Pendiente</div><div class="kpi__val">${soles(tot.pendiente)}</div></div></section>
        <div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Persona</th><th>Sucursal</th><th class="num">Cocina</th><th class="num">Comisiones</th><th class="num">Bonos</th><th class="num">Ajustes</th><th class="num">Total</th><th class="num">Pendiente</th><th></th></tr></thead>
          <tbody>${filas.map(([id, o]) => `<tr><td>${esc(nombrePersona(id))}</td><td>${esc(nombreSucursal(o.branch))}</td><td class="num">${soles(o.cocina)}</td><td class="num">${soles(o.venta)}</td><td class="num">${soles(o.bono)}</td><td class="num">${soles(o.ajuste)}</td><td class="num"><b>${soles(o.total)}</b></td><td class="num">${soles(o.pendiente)}</td>
            <td>${puede('pagos:liquidar') && o.pendiente > 0 ? `<button class="btn btn--chico btn--exito" data-liquidar="${id}">Marcar pagado</button>` : (o.pendiente <= 0 ? chipEstado('pagado') : '')}</td></tr>`).join('') || `<tr><td colspan="9">${vacio('💸', 'Sin pagos en este periodo.')}</td></tr>`}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="num">${soles(tot.cocina)}</td><td class="num">${soles(tot.venta)}</td><td class="num">${soles(tot.bono)}</td><td class="num">${soles(tot.ajuste)}</td><td class="num">${soles(tot.total)}</td><td class="num">${soles(tot.pendiente)}</td><td></td></tr></tfoot></table></div>`;
      $('#pg-ir').onclick = () => { per = $('#pg-per').value.trim() || S.perfil.periodo; cargar(); };
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-liquidar]'); if (!b) return;
      if (!await confirmar('Marcar como pagado', `¿Confirmas el pago a <b>${esc(nombrePersona(b.dataset.liquidar))}</b> del periodo ${esc(per)}?`, { ok: 'Sí, pagado' })) return;
      try { const r = await rpc('liquidar_pagos', { p_admin: b.dataset.liquidar, p_periodo: per }); toast(`${r.pagos} pagos liquidados por ${soles(r.total)}.`, 'exito'); } catch (_) {}
      cargar();
    });
    await cargar();
    alCambiar(['payments'], cargar);
  }

  // ===================================================================
  // 12. USUARIOS, CLAVES Y PERMISOS
  // ===================================================================
  async function vistaUsuarios(el) {
    const sa = rol() === 'superadmin';
    let pestana = 'personas';
    const gestionable = (a) => sa || (puede('equipo:editar') && a.branch_id === S.perfil.branch_id && ['cocina', 'vendedor'].includes(a.rol_id));
    el.innerHTML = `<div class="segmento no-imprimir" id="u-tab">
        <button type="button" data-t="personas" aria-pressed="true">👥 Personas</button>
        <button type="button" data-t="claves" aria-pressed="false">🔑 Claves</button>
        ${sa ? '<button type="button" data-t="permisos" aria-pressed="false">🛡️ Permisos</button>' : ''}</div>
      <div id="u-cont" class="rejilla"></div>`;
    $('#u-tab').addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      pestana = b.dataset.t; $$('#u-tab button').forEach((x) => x.setAttribute('aria-pressed', x === b)); cargar();
    });

    const cargar = async () => {
      const cont = $('#u-cont');
      if (pestana === 'personas') {
        await cargarCatalogos().catch(() => {});
        const lista = sa ? S.admins : S.admins.filter((a) => a.id !== S.perfil.id);
        cont.innerHTML = `<section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">${sa ? 'Todas las personas' : `Equipo de ${esc(nombreSucursal(S.perfil.branch_id))}`}</h2>
          ${sa ? '<button class="btn btn--primario btn--chico" data-persona-nueva>＋ Persona</button>' : ''}</div>
          <ul class="lista">${lista.map((a) => `<li style="align-items:flex-start;flex-wrap:wrap">
            <span class="avatar" style="width:40px;height:40px;font-size:.85rem">${esc(iniciales(a.nombre))}</span>
            <div class="lista__principal" style="min-width:180px">
              <div class="lista__titulo">${esc(a.nombre)} <span class="punto-online" data-online="${a.id}" hidden style="display:inline-block" title="En línea"></span></div>
              <div class="lista__det">${esc(ROLES[a.rol_id])} · ${esc(a.branch_id ? nombreSucursal(a.branch_id) : 'Todas')} · último ingreso ${fecha(a.last_login)}</div>
              ${a.activo ? '' : '<span class="chip chip--peligro">Desactivado</span>'}
            </div>
            ${gestionable(a) && a.id !== S.perfil.id ? `<div class="acciones">
              <button class="btn btn--chico btn--primario" data-clave="${a.id}">🔑 Clave</button>
              <button class="btn btn--chico btn--fantasma" data-reset="${a.id}">Restablecer</button>
              <button class="btn btn--chico btn--fantasma" data-cerrar="${a.id}">Cerrar sesión</button>
              ${sa ? `<button class="btn btn--chico btn--fantasma" data-editar-persona="${a.id}">Editar</button>` : ''}</div>`
              : (a.id === S.perfil.id && sa ? `<div class="acciones"><button class="btn btn--chico btn--fantasma" data-clave="${a.id}">🔑 Mi clave nueva</button><button class="btn btn--chico btn--fantasma" data-editar-persona="${a.id}">Editar</button></div>` : '')}
          </li>`).join('')}</ul></section>`;
        pintarPresencia();
      } else if (pestana === 'claves') {
        const r = await consulta(sb.from('access_keys').select('*').eq('activo', true).gt('expira', new Date().toISOString()).order('expira'));
        cont.innerHTML = `<section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Claves activas</h2><span class="chip">${r.length}</span></div>
          ${r.length ? `<ul class="lista">${r.map((k) => `<li style="flex-wrap:wrap"><span class="emoji">🔑</span>
            <div class="lista__principal" style="min-width:160px"><div class="lista__titulo">${esc(nombrePersona(k.admin_id))}</div>
            <div class="lista__det"><code data-clave-txt="${esc(k.key)}">••••-${esc(k.key.slice(-4))}</code> · ${k.tipo === 'un_uso' ? 'un solo uso' : 'temporal'} · vence ${fecha(k.expira)} · usos ${k.usos}</div></div>
            <div class="acciones"><button class="btn btn--chico btn--fantasma" data-ver-clave>👁 Ver</button><button class="btn btn--chico btn--fantasma" data-copiar="${esc(k.key)}">Copiar</button><button class="btn btn--chico btn--peligro" data-revocar="${k.id}">Revocar</button></div></li>`).join('')}</ul>` : vacio('🔑', 'No hay claves activas.')}</section>`;
      } else {
        const [roles, perms, rp] = await Promise.all([
          consulta(sb.from('roles').select('*').order('orden')), consulta(sb.from('permissions').select('*').order('modulo')), consulta(sb.from('role_permissions').select('*'))
        ]);
        const tiene = (r, p) => r === 'superadmin' || rp.some((x) => x.role_id === r && x.permission_id === p);
        let modulo = '';
        cont.innerHTML = `<section class="tarjeta"><div class="tarjeta__cab"><div><h2 class="tarjeta__titulo">Matriz de permisos</h2><p class="tarjeta__sub">Rol → módulo → acción. El Super Admin siempre tiene todo. La visibilidad por sucursal la impone RLS.</p></div></div>
          <div class="tabla-envoltura"><table class="tabla matriz"><thead><tr><th>Módulo / acción</th>${roles.map((r) => `<th>${esc(ROLES[r.id] || r.nombre)}</th>`).join('')}</tr></thead><tbody>
          ${perms.map((p) => { const cab = p.modulo !== modulo ? `<tr><td colspan="${roles.length + 1}" style="background:var(--superficie-2);font-weight:800;text-transform:capitalize">${esc(p.modulo)}</td></tr>` : ''; modulo = p.modulo;
            return `${cab}<tr><td>${esc(p.nombre)} <span class="muted">(${esc(p.accion)})</span></td>${roles.map((r) => `<td><input type="checkbox" aria-label="${esc(r.id)} ${esc(p.id)}" data-rp="${esc(r.id)}|${esc(p.id)}" ${tiene(r.id, p.id) ? 'checked' : ''} ${r.id === 'superadmin' ? 'disabled' : ''}></td>`).join('')}</tr>`; }).join('')}
          </tbody></table></div></section>`;
      }
    };

    const mostrarClave = (persona_, r) => abrirModal(`<h2>Clave para ${esc(persona_?.nombre || '')}</h2>
      <p class="campo__ayuda">Compártela por un canal privado. ${r.expira ? `Vence ${fecha(r.expira)}.` : ''}</p>
      <div class="kpi" style="text-align:center;margin:12px 0"><div class="kpi__val" style="font-family:ui-monospace,monospace;letter-spacing:.06em">${esc(r.key)}</div></div>
      <div class="modal__pie"><button class="btn btn--fantasma" data-copiar="${esc(r.key)}">Copiar</button>
        <a class="btn btn--exito" target="_blank" rel="noopener" href="https://wa.me/${esc((persona_?.telefono || '').replace(/\D/g, ''))}?text=${encodeURIComponent(`Hola ${persona_?.nombre || ''}, tu clave para el panel de Marcianos de la Risa es: ${r.key}\nIngresa en: ${location.origin}${location.pathname}`)}">Enviar por WhatsApp</a></div>`);

    el.addEventListener('click', async (e) => {
      const t = e.target;
      const id = (s) => t.closest(`[${s}]`)?.getAttribute(s);
      if (t.closest('[data-ver-clave]')) { const c = $('[data-clave-txt]', t.closest('li')); c.textContent = c.dataset.claveTxt; return; }
      if (t.closest('[data-clave]')) {
        const a = persona(id('data-clave'));
        return abrirModal(`<h2>Generar clave para ${esc(a.nombre)}</h2><form id="f-clave" class="rejilla-form">
          <label class="campo"><span class="campo__etiqueta">Tipo</span><select class="campo__input" name="t"><option value="temporal">Temporal (reutilizable hasta vencer)</option><option value="un_uso">Un solo uso</option></select></label>
          <label class="campo"><span class="campo__etiqueta">Vigencia</span><select class="campo__input" name="h"><option value="24">24 horas</option><option value="72" selected>3 días</option><option value="168">7 días</option><option value="720">30 días</option><option value="2160">90 días</option></select></label>
          <div class="modal__pie"><button class="btn btn--primario">Generar</button></div></form>`, (m) => {
          $('#f-clave', m).onsubmit = async (ev) => {
            ev.preventDefault();
            try { const r = await rpc('generar_clave', { p_admin: a.id, p_tipo: ev.target.t.value, p_horas: Number(ev.target.h.value) }); mostrarClave(a, r); } catch (_) {}
          };
        });
      }
      if (t.closest('[data-reset]')) {
        const a = persona(id('data-reset'));
        if (!await confirmar('Restablecer acceso', `Se revocan todas las claves de <b>${esc(a.nombre)}</b>, se cierran sus sesiones y se genera una clave nueva (3 días).`, { ok: 'Restablecer', peligro: true })) return;
        try { const r = await rpc('resetear_acceso', { p_admin: a.id }); mostrarClave(a, r); } catch (_) {}
        return;
      }
      if (t.closest('[data-cerrar]')) {
        const a = persona(id('data-cerrar'));
        if (!await confirmar('Cerrar sesión remota', `¿Cerrar todas las sesiones de <b>${esc(a.nombre)}</b>? Tendrá que volver a ingresar con una clave válida.`, { ok: 'Cerrar sesiones', peligro: true })) return;
        try { const n = await rpc('cerrar_sesiones', { p_admin: a.id }); toast(`${n} sesión(es) cerrada(s).`, 'exito'); } catch (_) {}
        return;
      }
      if (t.closest('[data-revocar]')) {
        if (!await confirmar('Revocar clave', 'La clave dejará de funcionar de inmediato.', { ok: 'Revocar', peligro: true })) return;
        try { await rpc('revocar_clave', { p_key_id: id('data-revocar') }); toast('Clave revocada.', 'exito'); cargar(); } catch (_) {}
        return;
      }
      if (t.closest('[data-persona-nueva]') || t.closest('[data-editar-persona]')) {
        const a = persona(id('data-editar-persona')) || { nombre: '', email: '', telefono: '', rol_id: 'vendedor', branch_id: S.branches[0]?.id, activo: true };
        if (a.id) S.editando = { tabla: 'admins', id: a.id, version: a.version };
        return abrirModal(`<h2>${a.id ? 'Editar persona' : 'Nueva persona'}</h2><div class="alerta alerta--aviso" id="aviso-edicion" hidden></div>
          <form id="f-persona" class="rejilla-form">
          <label class="campo"><span class="campo__etiqueta">Nombre</span><input class="campo__input" name="n" value="${esc(a.nombre)}" required></label>
          <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Email</span><input class="campo__input" type="email" name="e" value="${esc(a.email || '')}"></label>
          <label class="campo"><span class="campo__etiqueta">Teléfono / WhatsApp</span><input class="campo__input" name="t" inputmode="tel" value="${esc(a.telefono || '')}" placeholder="51999888777"></label></div>
          <div class="rejilla-form rejilla-form--2"><label class="campo"><span class="campo__etiqueta">Rol</span><select class="campo__input" name="r">${opciones(Object.entries(ROLES).map(([v, t2]) => ({ v, t: t2 })), a.rol_id)}</select></label>
          <label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" name="b">${optSucursales(a.branch_id, 'Ninguna / todas')}</select></label></div>
          <label class="switch"><span>Activo</span><input type="checkbox" name="a" ${a.activo ? 'checked' : ''}></label>
          <div class="modal__pie"><button class="btn btn--primario">Guardar</button></div></form>`, (m) => {
          $('#f-persona', m).onsubmit = async (ev) => {
            ev.preventDefault(); const f = ev.target;
            const args = { p_id: a.id || null, p_nombre: f.n.value, p_email: f.e.value, p_telefono: f.t.value, p_rol: f.r.value, p_branch: f.b.value || null, p_activo: f.a.checked, p_version: a.version ?? null };
            try {
              const r = await rpcConVersion('guardar_admin', args);
              if (!r) return;
              toast('Persona guardada.', 'exito');
              await cargarCatalogos();
              if (!a.id) { const k = await rpc('generar_clave', { p_admin: r.id, p_tipo: 'temporal', p_horas: 72 }); mostrarClave(r, k); } else cerrarModal();
              cargar();
            } catch (_) {}
          };
        });
      }
    });
    el.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-rp]'); if (!c) return;
      const [role_id, permission_id] = c.dataset.rp.split('|');
      try {
        if (c.checked) await consulta(sb.from('role_permissions').insert({ role_id, permission_id }));
        else await consulta(sb.from('role_permissions').delete().eq('role_id', role_id).eq('permission_id', permission_id));
        toast('Permiso actualizado (aplica desde el próximo ingreso de esa persona).', 'exito', 2500);
      } catch (_) { c.checked = !c.checked; }
    });
    await cargar();
    alCambiar(['access_keys', 'sesiones'], () => { if (pestana === 'claves') cargar(); });
  }

  // ===================================================================
  // 13. REPORTES (CSV / PDF) Y AUDITORÍA
  // ===================================================================
  const ETIQUETAS = {
    fecha: 'Fecha', sucursal: 'Sucursal', vendedor: 'Vendedor', sabor: 'Sabor', cantidad: 'Cantidad', precio_unitario: 'P. unit.',
    descuento: 'Descuento', total: 'Total', costo: 'Costo', canal: 'Canal', delivery: 'Delivery', comision: 'Comisión',
    persona: 'Persona', rol: 'Rol', periodo: 'Periodo', pago_cocina: 'Pago cocina', comisiones: 'Comisiones', bonos: 'Bonos',
    ajustes: 'Ajustes', pagado: 'Pagado', pendiente: 'Pendiente', unidades: 'Unidades', ventas: 'Ventas', ganancia_bruta: 'Ganancia bruta',
    margen_pct: 'Margen %', pedidos: 'Pedidos', ticket_promedio: 'Ticket prom.', producidos: 'Producidos'
  };
  // Orden de columnas por reporte (JSONB no conserva el orden de las claves)
  const COLUMNAS = {
    ventas: ['fecha', 'sucursal', 'vendedor', 'sabor', 'cantidad', 'precio_unitario', 'descuento', 'total', 'costo', 'canal', 'delivery', 'comision'],
    nomina: ['persona', 'rol', 'sucursal', 'periodo', 'pago_cocina', 'comisiones', 'bonos', 'ajustes', 'total', 'pagado', 'pendiente'],
    margen_sabor: ['sabor', 'unidades', 'ventas', 'costo', 'ganancia_bruta', 'margen_pct'],
    sucursales: ['sucursal', 'pedidos', 'unidades', 'ventas', 'margen_pct', 'ticket_promedio', 'producidos']
  };
  const COL_SOLES = ['precio_unitario', 'descuento', 'total', 'costo', 'comision', 'pago_cocina', 'comisiones', 'bonos', 'ajustes', 'pagado', 'pendiente', 'ventas', 'ganancia_bruta', 'ticket_promedio'];
  const COL_SUMA = ['cantidad', 'descuento', 'total', 'costo', 'comision', 'pago_cocina', 'comisiones', 'bonos', 'ajustes', 'pagado', 'pendiente', 'unidades', 'ventas', 'ganancia_bruta', 'pedidos', 'producidos'];

  async function vistaReportes(el) {
    const f = { tipo: 'ventas', desde: inicioMes(), hasta: hoyISO(), branch: '' };
    const TIPOS = { ventas: 'Ventas por período', nomina: 'Nómina (cocina + vendedores)', margen_sabor: 'Margen por sabor', sucursales: 'Rendimiento por sucursal' };
    let filas = [];
    el.innerHTML = `<section class="tarjeta no-imprimir"><div class="filtros">
        <label class="campo" style="flex-basis:220px"><span class="campo__etiqueta">Reporte</span><select class="campo__input" data-f="tipo">${opciones(Object.entries(TIPOS).map(([v, t]) => ({ v, t })), f.tipo)}</select></label>
        <label class="campo"><span class="campo__etiqueta">Desde</span><input class="campo__input" type="date" data-f="desde" value="${f.desde}"></label>
        <label class="campo"><span class="campo__etiqueta">Hasta</span><input class="campo__input" type="date" data-f="hasta" value="${f.hasta}"></label>
        ${esGlobal() ? `<label class="campo"><span class="campo__etiqueta">Sucursal</span><select class="campo__input" data-f="branch">${optSucursales('', 'Todas')}</select></label>` : ''}
      </div><div class="acciones" style="margin-top:10px"><button class="btn btn--primario" id="r-csv">⬇ CSV</button><button class="btn btn--fantasma" id="r-pdf">🖨 PDF</button></div></section>
      <div class="solo-imprimir" id="r-cab-print"></div>
      <div id="r-tabla"></div>`;
    $$('[data-f]', el).forEach((i) => i.addEventListener('change', () => { f[i.dataset.f] = i.value; cargar(); }));
    const cols = () => (filas[0] ? (COLUMNAS[f.tipo] || Object.keys(filas[0])).filter((k) => k in filas[0] && !k.startsWith('_')) : []);
    const fmtCelda = (k, v) => (COL_SOLES.includes(k) ? soles(v) : k === 'margen_pct' ? `${v ?? '—'} %` : k === 'canal' ? esc(CANALES[v] || v) : typeof v === 'number' ? entero(v) : esc(v ?? ''));

    const cargar = async () => {
      const r = await conCache(`rep:${JSON.stringify(f)}`, () => rpc('reporte', { p_tipo: f.tipo, p_desde: f.desde, p_hasta: f.hasta, p_branch: f.branch || null }, { silencioso: true }));
      filas = r.v || [];
      const c = cols();
      const sumas = Object.fromEntries(c.filter((k) => COL_SUMA.includes(k)).map((k) => [k, filas.reduce((a, x) => a + Number(x[k] || 0), 0)]));
      $('#r-cab-print').innerHTML = `<h2>${esc(S.cfg.nombre_negocio)} · ${esc(TIPOS[f.tipo])}</h2><p>${esc(f.desde)} al ${esc(f.hasta)} · ${esc(f.branch ? nombreSucursal(f.branch) : 'Todas las sucursales')} · generado ${fecha(new Date())}</p><br>`;
      $('#r-tabla').innerHTML = avisoCache(r) + (filas.length ? `<div class="tabla-envoltura"><table class="tabla"><thead><tr>${c.map((k) => `<th class="${COL_SUMA.includes(k) || COL_SOLES.includes(k) || k === 'margen_pct' ? 'num' : ''}">${esc(ETIQUETAS[k] || k)}</th>`).join('')}</tr></thead>
        <tbody>${filas.map((x) => `<tr>${c.map((k) => `<td class="${typeof x[k] === 'number' ? 'num' : ''}">${fmtCelda(k, x[k])}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr>${c.map((k, i) => `<td class="num">${k in sumas ? fmtCelda(k, Math.round(sumas[k] * 100) / 100) : i === 0 ? 'Total' : ''}</td>`).join('')}</tr></tfoot></table></div>
        <p class="campo__ayuda">${entero(filas.length)} filas${filas.length >= 5000 ? ' (límite alcanzado: reduce el rango)' : ''}.</p>` : vacio('📊', 'Sin datos para este rango.'));
    };
    $('#r-csv').onclick = () => {
      if (!filas.length) return toast('No hay datos para exportar.', 'aviso');
      const c = cols();
      const celda = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = [c.map((k) => ETIQUETAS[k] || k).join(','), ...filas.map((x) => c.map((k) => celda(x[k])).join(','))].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      a.download = `marcianos_${f.tipo}_${f.desde}_${f.hasta}.csv`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('#r-pdf').onclick = () => { if (!filas.length) return toast('No hay datos para exportar.', 'aviso'); window.print(); };
    await cargar();
  }

  async function vistaAuditoria(el) {
    const sa = rol() === 'superadmin';
    const f = { admin: '', modulo: '', accion: '', desde: sumarDias(hoyISO(), -6), hasta: hoyISO() };
    const abiertos = new Set();
    const MODULOS = ['ventas', 'produccion', 'inventario', 'productos', 'usuarios', 'incentivos', 'pagos', 'configuracion'];
    el.innerHTML = `<section class="tarjeta no-imprimir"><div class="filtros">
        <label class="campo"><span class="campo__etiqueta">Usuario</span><select class="campo__input" data-f="admin">${opciones(S.admins.map((a) => ({ v: a.id, t: a.nombre })), '', { vacio: 'Todos' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Módulo</span><select class="campo__input" data-f="modulo">${opciones(MODULOS.map((m) => ({ v: m, t: m })), '', { vacio: 'Todos' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Acción</span><select class="campo__input" data-f="accion">${opciones(['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'REVERTIR', 'CERRAR_SESION_REMOTA'].map((m) => ({ v: m, t: m })), '', { vacio: 'Todas' })}</select></label>
        <label class="campo"><span class="campo__etiqueta">Desde</span><input class="campo__input" type="date" data-f="desde" value="${f.desde}"></label>
        <label class="campo"><span class="campo__etiqueta">Hasta</span><input class="campo__input" type="date" data-f="hasta" value="${f.hasta}"></label>
      </div><p class="campo__ayuda" style="margin-top:8px">Registro permanente (no se puede editar ni borrar) · se actualiza cada ${Math.round((CFG.AUDITORIA_REFRESCO_MS || 10000) / 1000)} s.</p></section>
      <section class="tarjeta" id="a-lista"><div class="esqueleto"></div></section>`;
    $$('[data-f]', el).forEach((i) => i.addEventListener('change', () => { f[i.dataset.f] = i.value; cargar(); }));
    const ICO = { INSERT: '➕', UPDATE: '✏️', DELETE: '🗑️', LOGIN: '🔓', LOGOUT: '🔒', REVERTIR: '↩️', CERRAR_SESION_REMOTA: '⛔' };
    const OCULTAR = ['version', 'updated_at', 'created_at'];
    const valor = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    const diff = (a, n) => {
      const claves = [...new Set([...Object.keys(a || {}), ...Object.keys(n || {})])].filter((k) => !OCULTAR.includes(k));
      const cambian = claves.filter((k) => valor(a?.[k]) !== valor(n?.[k]));
      const mostrar = a && n ? cambian : claves;
      return `<div class="diff"><div class="diff__fila"><span class="diff__k">Campo</span><span class="muted">Anterior</span><span class="muted">Nuevo</span></div>${mostrar.map((k) => `<div class="diff__fila"><span class="diff__k">${esc(k)}</span><span class="diff__a">${esc(valor(a?.[k]))}</span><span class="diff__n">${esc(valor(n?.[k]))}</span></div>`).join('')}</div>`;
    };
    const revertible = (x) => sa && !x.revertido && ['INSERT', 'UPDATE', 'DELETE'].includes(x.accion) && x.tabla !== 'sales'
      && !(x.tabla === 'access_keys' && x.accion !== 'INSERT');

    const cargar = async () => {
      $$('details[data-id]', el).forEach((d) => { if (d.open) abiertos.add(d.dataset.id); else abiertos.delete(d.dataset.id); });
      let q = sb.from('v_audit').select('*').order('timestamp', { ascending: false }).limit(150)
        .gte('timestamp', new Date(`${f.desde}T00:00:00-05:00`).toISOString()).lt('timestamp', new Date(`${sumarDias(f.hasta, 1)}T00:00:00-05:00`).toISOString());
      if (f.admin) q = q.eq('admin_id', f.admin);
      if (f.modulo) q = q.eq('modulo', f.modulo);
      if (f.accion) q = q.eq('accion', f.accion);
      const r = await conCache(`audit:${JSON.stringify(f)}`, () => consulta(q, { silencioso: true }));
      $('#a-lista').innerHTML = avisoCache(r) + (r.v.length ? `<ul class="lista">${r.v.map((x) => `<li style="align-items:flex-start">
        <span class="emoji">${ICO[x.accion] || '•'}</span>
        <div class="lista__principal">
          <div class="lista__titulo">${esc(x.admin_nombre || 'sistema')} · ${esc(x.accion)} · ${esc(x.tabla || '')}</div>
          <div class="lista__det">#${x.id} · ${fecha(x.timestamp)} · ${esc(x.modulo || '')}${x.ip ? ` · IP ${esc(x.ip)}` : ''}${x.dispositivo ? ` · ${esc(x.dispositivo.slice(0, 60))}` : ''}</div>
          ${x.nota ? `<div class="lista__det">📝 ${esc(x.nota)}</div>` : ''}
          <div class="acciones" style="margin-top:4px">${x.revertido ? '<span class="chip chip--aviso">↩ Revertido</span>' : ''}${x.revierte_a ? `<span class="chip chip--info">Revierte #${x.revierte_a}</span>` : ''}
            ${revertible(x) ? `<button class="btn btn--chico btn--peligro" data-revertir="${x.id}">↩ Revertir</button>` : ''}</div>
          ${x.valor_anterior || x.valor_nuevo ? `<details data-id="${x.id}" ${abiertos.has(String(x.id)) ? 'open' : ''}><summary class="lista__det" style="cursor:pointer">Ver cambios</summary>${diff(x.valor_anterior, x.valor_nuevo)}</details>` : ''}
        </div></li>`).join('')}</ul>` : vacio('🕵️', 'Sin registros con estos filtros.'));
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revertir]'); if (!b) return;
      if (!await confirmar('Revertir cambio', `Se revertirá la acción #${b.dataset.revertir}. Si es una venta: se devuelve el stock y se recalculan pagos y bonos. La reversión también queda auditada.`, { ok: 'Revertir', peligro: true })) return;
      try { const r = await rpc('revertir_auditoria', { p_audit_id: Number(b.dataset.revertir) }); toast(r.resultado, 'exito', 6000); await cargarCatalogos().catch(() => {}); } catch (_) {}
      cargar();
    });
    await cargar();
    // Cuasi tiempo real: refresco cada 10 s (no crítico)
    S.intervalos.push(setInterval(() => { if (!document.hidden && !$('#modal').open) cargar().catch(() => {}); }, CFG.AUDITORIA_REFRESCO_MS || 10000));
  }

  // ===================================================================
  // 14. CONFIGURACIÓN Y PERFIL
  // ===================================================================
  async function vistaConfig(el) {
    const cargar = async () => {
      const [c] = await consulta(sb.from('configuracion').select('*').eq('id', 1));
      const br = await consulta(sb.from('branches').select('*').order('nombre'));
      S.cfg = c; S.branches = br;
      S.editando = { tabla: 'configuracion', id: 1, version: c.version };
      const n = (name, val, extra = '') => `<input class="campo__input num" type="number" name="${name}" value="${esc(val)}" ${extra}>`;
      el.innerHTML = `<div class="alerta alerta--aviso" id="aviso-edicion" hidden></div>
      <form id="f-config" class="rejilla">
        <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Negocio y marca</h2>
          <div class="rejilla-form rejilla-form--2">
            <label class="campo"><span class="campo__etiqueta">Nombre del negocio</span><input class="campo__input" name="nombre_negocio" value="${esc(c.nombre_negocio)}"></label>
            <label class="campo"><span class="campo__etiqueta">URL del logo</span><input class="campo__input" name="logo_url" value="${esc(c.logo_url || '')}"></label></div>
          <div class="rejilla-form rejilla-form--3">
            ${[['color_primario', 'Primario (cielo)'], ['color_secundario', 'Secundario (turquesa)'], ['color_acento', 'Acento (naranja)'], ['color_alerta', 'Alerta (coral)'], ['color_tinta', 'Tinta (azul marino)']]
              .map(([k, t]) => `<label class="campo"><span class="campo__etiqueta">${t}</span><input class="campo__input" type="color" name="${k}" value="${esc(c[k])}" data-color></label>`).join('')}</div>
          <p class="campo__ayuda">Los colores se aplican en vivo como variables CSS para todo el equipo.</p></section>
        <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Pagos y márgenes</h2>
          <div class="rejilla-form rejilla-form--3">
            <label class="campo"><span class="campo__etiqueta">Pago por marciano preparado (S/)</span>${n('pago_cocinero', c.pago_cocinero, 'step="0.01" min="0"')}</label>
            <label class="campo"><span class="campo__etiqueta">Pago por marciano vendido (S/)</span>${n('pago_vendedor', c.pago_vendedor, 'step="0.01" min="0"')}</label>
            <label class="campo"><span class="campo__etiqueta">Margen objetivo (%)</span>${n('margen_objetivo_pct', (c.margen_objetivo * 100).toFixed(0), 'step="1" min="0" max="95"')}</label>
            <label class="campo"><span class="campo__etiqueta">Precio mínimo (S/)</span>${n('precio_min', c.precio_min, 'step="0.10" min="0"')}</label>
            <label class="campo"><span class="campo__etiqueta">Precio máximo (S/)</span>${n('precio_max', c.precio_max, 'step="0.10" min="0"')}</label></div></section>
        <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Incentivos de vendedores</h2>
          <div class="rejilla-form rejilla-form--2">
            <label class="campo"><span class="campo__etiqueta">Periodo (los hitos se reinician)</span><select class="campo__input" name="periodo_incentivo">${opciones([{ v: 'mensual', t: 'Mensual' }, { v: 'quincenal', t: 'Quincenal' }, { v: 'semanal', t: 'Semanal' }], c.periodo_incentivo)}</select></label>
            <label class="campo"><span class="campo__etiqueta">Nivel inicial</span><input class="campo__input" name="nivel_base" value="${esc(c.nivel_base)}"></label></div>
          <div id="hitos" class="rejilla" style="gap:8px">${(c.hitos || []).map((h) => filaHito(h)).join('')}</div>
          <button type="button" class="btn btn--fantasma btn--chico" data-hito-nuevo>＋ Agregar hito (ej. Platino)</button></section>
        <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Inventario y alertas</h2>
          <div class="rejilla-form rejilla-form--3">
            <label class="campo"><span class="campo__etiqueta">Umbral de stock bajo</span>${n('stock_bajo_umbral', c.stock_bajo_umbral, 'min="0"')}</label>
            <label class="campo"><span class="campo__etiqueta">"Sin rotación": días (N)</span>${n('dias_sin_rotacion', c.dias_sin_rotacion, 'min="1"')}</label>
            <label class="campo"><span class="campo__etiqueta">"Sin rotación": vendidos menos de (X)</span>${n('ventas_min_rotacion', c.ventas_min_rotacion, 'min="1"')}</label>
            <label class="campo"><span class="campo__etiqueta">Avisar claves que vencen en (días)</span>${n('dias_aviso_clave', c.dias_aviso_clave, 'min="1"')}</label></div>
          <label class="switch"><span>Permitir vender sin stock registrado</span><input type="checkbox" name="permitir_stock_negativo" ${c.permitir_stock_negativo ? 'checked' : ''}></label></section>
        <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Delivery</h2>
          <div class="rejilla-form rejilla-form--3">
            <label class="campo"><span class="campo__etiqueta">Mínimo para envío gratis</span>${n('delivery_minimo', c.delivery_minimo, 'min="1"')}</label>
            <label class="campo"><span class="campo__etiqueta">Si no llega al mínimo</span><select class="campo__input" name="delivery_modo">${opciones([{ v: 'bloquear', t: 'Rechazar el pedido' }, { v: 'cobrar', t: 'Cobrar delivery' }], c.delivery_modo)}</select></label>
            <label class="campo"><span class="campo__etiqueta">Costo de delivery (S/)</span>${n('costo_delivery', c.costo_delivery, 'step="0.50" min="0"')}</label></div></section>
        <button class="btn btn--primario btn--grande btn--bloque">Guardar configuración</button>
      </form>
      <section class="tarjeta"><div class="tarjeta__cab"><h2 class="tarjeta__titulo">Sucursales</h2><button class="btn btn--chico btn--primario" data-suc-nueva>＋ Sucursal</button></div>
        <ul class="lista">${br.map((b) => `<li><span class="emoji">🏪</span><div class="lista__principal"><div class="lista__titulo">${esc(b.nombre)} ${b.activo ? '' : '<span class="chip">Inactiva</span>'}</div><div class="lista__det">${esc(b.direccion || '')}</div></div>
          <button class="btn btn--chico btn--fantasma" data-suc-editar="${b.id}">Editar</button></li>`).join('')}</ul></section>`;

      const form = $('#f-config');
      $$('[data-color]', form).forEach((i) => i.addEventListener('input', () => aplicarMarca({ ...S.cfg, [i.name]: i.value })));
      $('[data-hito-nuevo]', form).onclick = () => $('#hitos').insertAdjacentHTML('beforeend', filaHito({ umbral: '', bono: 0, nivel: 'Platino' }));
      $('#hitos').addEventListener('click', (e) => { if (e.target.closest('[data-hito-quitar]')) e.target.closest('.rejilla-form').remove(); });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const hitos = $$('#hitos .rejilla-form').map((r) => ({ umbral: parseInt($('[data-h=umbral]', r).value, 10), bono: Number($('[data-h=bono]', r).value), nivel: $('[data-h=nivel]', r).value.trim() }))
          .filter((h) => h.umbral > 0 && h.nivel).sort((a, b) => a.umbral - b.umbral);
        const numeros = ['pago_cocinero', 'pago_vendedor', 'precio_min', 'precio_max', 'stock_bajo_umbral', 'dias_sin_rotacion', 'ventas_min_rotacion', 'dias_aviso_clave', 'delivery_minimo', 'costo_delivery'];
        const cambios = {
          nombre_negocio: fd.get('nombre_negocio'), logo_url: fd.get('logo_url'),
          color_primario: fd.get('color_primario'), color_secundario: fd.get('color_secundario'), color_acento: fd.get('color_acento'),
          color_alerta: fd.get('color_alerta'), color_tinta: fd.get('color_tinta'),
          margen_objetivo: Number(fd.get('margen_objetivo_pct')) / 100, periodo_incentivo: fd.get('periodo_incentivo'),
          nivel_base: fd.get('nivel_base'), delivery_modo: fd.get('delivery_modo'), permitir_stock_negativo: form.permitir_stock_negativo.checked, hitos
        };
        numeros.forEach((k) => { cambios[k] = Number(fd.get(k)); });
        try {
          const g = await actualizarConVersion('configuracion', { id: 1, version: c.version }, cambios);
          if (g) { S.cfg = g; S.perfil.config = g; aplicarMarca(g); toast('Configuración guardada.', 'exito'); cargar(); }
        } catch (_) {}
      };
    };
    const filaHito = (h) => `<div class="rejilla-form rejilla-form--3" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end">
      <label class="campo"><span class="campo__etiqueta">Marcianos</span><input class="campo__input num" type="number" min="1" data-h="umbral" value="${esc(h.umbral)}"></label>
      <label class="campo"><span class="campo__etiqueta">Bono (S/)</span><input class="campo__input num" type="number" min="0" step="1" data-h="bono" value="${esc(h.bono)}"></label>
      <label class="campo"><span class="campo__etiqueta">Nivel</span><input class="campo__input" data-h="nivel" value="${esc(h.nivel)}"></label>
      <button type="button" class="btn-icono" data-hito-quitar aria-label="Quitar hito">✕</button></div>`;

    el.addEventListener('click', (e) => {
      const ed = e.target.closest('[data-suc-editar]');
      if (!e.target.closest('[data-suc-nueva]') && !ed) return;
      const b = ed ? S.branches.find((x) => x.id === ed.dataset.sucEditar) : { nombre: '', direccion: '', activo: true };
      abrirModal(`<h2>${b.id ? 'Editar sucursal' : 'Nueva sucursal'}</h2><form id="f-suc" class="rejilla-form">
        <label class="campo"><span class="campo__etiqueta">Nombre</span><input class="campo__input" name="n" value="${esc(b.nombre)}" required></label>
        <label class="campo"><span class="campo__etiqueta">Dirección</span><input class="campo__input" name="d" value="${esc(b.direccion || '')}"></label>
        <label class="switch"><span>Activa</span><input type="checkbox" name="a" ${b.activo ? 'checked' : ''}></label>
        <div class="modal__pie"><button class="btn btn--primario">Guardar</button></div></form>`, (m) => {
        $('#f-suc', m).onsubmit = async (ev) => {
          ev.preventDefault(); const f = ev.target;
          const datos = { nombre: f.n.value.trim(), direccion: f.d.value.trim() || null, activo: f.a.checked };
          try {
            if (b.id) { if (!await actualizarConVersion('branches', b, datos)) return; } else await consulta(sb.from('branches').insert(datos));
            cerrarModal(); toast('Sucursal guardada.', 'exito'); cargar();
          } catch (_) {}
        };
      });
    });
    await cargar();
  }

  function vistaPerfil(el) {
    const p = S.perfil;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    el.innerHTML = `
      <section class="tarjeta"><div class="nivel"><span class="avatar" style="width:64px;height:64px;font-size:1.4rem">${esc(iniciales(p.nombre))}</span>
        <div><h2 style="font-size:1.4rem">${esc(p.nombre)}</h2><div class="lista__det">${esc(ROLES[p.rol])}${p.branch_id ? ` · ${esc(nombreSucursal(p.branch_id))}` : ' · Todas las sucursales'}</div>
        <div class="lista__det">Último ingreso ${fecha(p.last_login)}</div></div></div></section>
      <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Apariencia</h2>
        <div class="segmento" id="pf-tema">${['light', 'dark'].map((t) => `<button type="button" data-tema="${t}" aria-pressed="${document.documentElement.dataset.theme === t}">${t === 'light' ? '☀️ Claro' : '🌙 Oscuro'}</button>`).join('')}</div></section>
      <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">App en tu celular</h2>
        ${instalada ? '<div class="alerta alerta--exito">✓ <span>La app ya está instalada en este dispositivo.</span></div>'
          : ios ? '<div class="alerta alerta--info">📲 <span>En iPhone: abre en <b>Safari</b>, toca <b>Compartir</b> y luego <b>"Agregar a pantalla de inicio"</b>.</span></div>'
          : `<button class="btn btn--primario btn--bloque" id="pf-instalar" ${S.instalar ? '' : 'disabled'}>📲 Instalar app</button><p class="campo__ayuda">${S.instalar ? '' : 'Si el botón está desactivado: menú ⋮ del navegador → "Instalar app" / "Agregar a pantalla principal".'}</p>`}
        <button class="btn btn--fantasma btn--bloque" id="pf-actualizar">🔄 Buscar actualización</button></section>
      <section class="tarjeta rejilla-form"><h2 class="tarjeta__titulo">Sesión</h2>
        <p class="lista__det">Conexión: ${S.online ? 'en línea' : 'sin conexión'} · tiempo real: ${esc($('.estado-rt__txt').textContent)}</p>
        <button class="btn btn--peligro btn--grande btn--bloque" id="pf-salir">Salir</button></section>`;
    $('#pf-tema').onclick = (e) => { const b = e.target.closest('[data-tema]'); if (!b) return; aplicarTema(b.dataset.tema); $$('#pf-tema button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
    $('#pf-instalar')?.addEventListener('click', async () => { if (!S.instalar) return; S.instalar.prompt(); await S.instalar.userChoice; S.instalar = null; vistaPerfil(el); });
    $('#pf-actualizar').onclick = async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.update(); toast('Buscando actualización…', 'info', 2000); setTimeout(() => location.reload(), 1500); } else location.reload();
    };
    $('#pf-salir').onclick = async () => { if (await confirmar('Salir', 'Para volver a entrar necesitarás una clave vigente.', { ok: 'Salir', peligro: true })) salir(); };
  }

  // ===================================================================
  // PWA: service worker e instalación
  // ===================================================================
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.instalar = e; });
  function registrarSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Hay una versión nueva del panel. Se aplicará al recargar.', 'aviso', 8000);
        });
      });
    }).catch(() => {});
  }

  // ===================================================================
  // INICIO
  // ===================================================================
  async function arrancar() {
    registrarSW();
    marcarOnline(navigator.onLine);
    if (!CONFIGURADO) { mostrar('#pantalla-config'); return; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'marcianos-auth' },
      realtime: { params: { eventsPerSecond: 20 }, heartbeatIntervalMs: 15000 }
    });
    // Si el token se renueva, se actualiza también en Realtime
    sb.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'TOKEN_REFRESHED' && sesion) sb.realtime.setAuth(sesion.access_token);
    });
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      try {
        const p = await rpc('mi_perfil', {}, { silencioso: true });
        if (p) return iniciarApp(p);
      } catch (e) {
        // Sin red: abrir en modo lectura con el último perfil y datos guardados
        const c = localStorage.getItem('mr:perfil');
        if (c && /fetch|network|Load failed/i.test(e?.message || '')) { marcarOnline(false); return iniciarApp(JSON.parse(c), { offline: true }); }
      }
    }
    mostrarLogin();
  }

  arrancar();
})();
