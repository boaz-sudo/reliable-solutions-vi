/* Reliable Solutions VI — Client Desk core.
 * Global namespace: window.RS
 * Every module is a plain <script> loaded after this file. Modules register
 * views with RS.registerView() and read/write data ONLY through RS.store.
 * Data lives in localStorage (key below) with an in-memory fallback.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'rsvi.clientdesk.v1';

  /* ---------- constants ---------- */
  const STAGES = [
    { id: 'assessment',  label: 'Free assessment', short: 'Assessment',  group: 'potential' },
    { id: 'site_visit',  label: 'Site visit',      short: 'Site visit',  group: 'potential' },
    { id: 'in_progress', label: 'In progress',     short: 'In progress', group: 'current'   },
    { id: 'completed',   label: 'Completed',       short: 'Completed',   group: 'completed' },
  ];
  const SERVICES = ['Security Cameras', 'Network Installation', 'Network Management', 'Maintenance & Support'];
  const EQUIPMENT = [
    { key: 'cameras',      label: 'Cameras',       short: 'Cam' },
    { key: 'accessPoints', label: 'Access points', short: 'AP'  },
    { key: 'switches',     label: 'Switches',      short: 'SW'  },
    { key: 'routers',      label: 'Routers',       short: 'RTR' },
  ];
  const ISLANDS = ['St. Thomas', 'St. John', 'St. Croix', 'Water Island'];
  const SOURCES = ['Website form', 'Referral', 'Phone call', 'Business card / QR', 'Walk-in', 'Social media', 'Repeat client'];
  const ACTIVITY_TYPES = [
    { id: 'call',    label: 'Call'    },
    { id: 'email',   label: 'Email'   },
    { id: 'text',    label: 'Text'    },
    { id: 'meeting', label: 'Meeting' },
    { id: 'note',    label: 'Note'    },
    { id: 'stage',   label: 'Stage change' }, // written automatically by moveStage
  ];
  const REVIEW_SOURCES = ['Google', 'Facebook', 'Direct', 'Website'];

  /* ---------- utilities ---------- */
  const util = {
    uid(prefix = 'id') { return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); },
    esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    nowISO() { return new Date().toISOString(); },
    /** 'YYYY-MM-DD' for today (local) */
    todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
    /** Parse 'YYYY-MM-DD' or ISO into Date (local for date-only strings) */
    toDate(v) { if (!v) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); } const d = new Date(v); return isNaN(d) ? null : d; },
    fmtDate(v, opts) { const d = util.toDate(v); return d ? d.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; },
    fmtShort(v) { return util.fmtDate(v, { month: 'short', day: 'numeric' }); },
    fmtTime(t) { if (!t) return ''; const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap; },
    fmtMoney(n) { return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); },
    /** whole days from a to b (b default now); positive if b after a */
    daysBetween(a, b) { const da = util.toDate(a), db = b ? util.toDate(b) : new Date(); if (!da || !db) return null; const MS = 86400000; const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate()); const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()); return Math.round((ub - ua) / MS); },
    relDays(v) { const n = util.daysBetween(v); if (n === null) return '—'; if (n === 0) return 'today'; if (n === 1) return 'yesterday'; if (n === -1) return 'tomorrow'; return n > 0 ? n + ' days ago' : 'in ' + (-n) + ' days'; },
    initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); },
    equipTotal(eq) { eq = eq || {}; return EQUIPMENT.reduce((s, e) => s + (Number(eq[e.key]) || 0), 0); },
    debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
    clone(o) { return JSON.parse(JSON.stringify(o)); },
    /** html tagged template: h`<b>${x}</b>` escapes interpolations; use util.raw() to skip escaping */
    raw(s) { return { __raw: String(s) }; },
    h(strings, ...vals) { return strings.reduce((out, s, i) => { const v = vals[i - 1]; const piece = v == null ? '' : Array.isArray(v) ? v.map(x => x && x.__raw !== undefined ? x.__raw : util.esc(x)).join('') : v.__raw !== undefined ? v.__raw : util.esc(v); return out + piece + s; }); },
  };

  /* ---------- persistence ---------- */
  let memory = null; // fallback when localStorage throws
  function readRaw() {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return memory; }
  }
  function writeRaw(data) {
    memory = data;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* in-memory only */ }
  }
  function emptyDB() { return { version: 1, clients: [], reviews: [], meta: { createdAt: util.nowISO(), seeded: false } }; }

  /** Ensure a client object has every field (safe for older/partial records). */
  function normalizeClient(c) {
    const base = {
      id: util.uid('cl'), name: '', company: '', phone: '', email: '', address: '', island: 'St. Thomas',
      source: 'Website form', services: [], stage: 'assessment', priority: 'normal', // low | normal | high
      equipment: { cameras: 0, accessPoints: 0, switches: 0, routers: 0 },
      quote: 0, notes: '', tags: [],
      assessment: { requestedAt: util.todayStr(), scheduledFor: '', completedAt: '', status: 'requested', // requested | scheduled | completed
        findings: '', recommendations: '', estimate: 0, free: true },
      siteVisit: { date: '', time: '', status: 'not_scheduled', // not_scheduled | scheduled | completed | cancelled
        technician: '', checklist: {}, notes: '', completedAt: '', survey: { cameras: 0, accessPoints: 0, switches: 0, routers: 0 } },
      job: { startedAt: '', completedAt: '', progress: 0, invoice: 0, paid: false },
      followUpOn: '', // 'YYYY-MM-DD' next planned touch
      activities: [], // {id, type, at (ISO), text}
      createdAt: util.nowISO(), updatedAt: util.nowISO(), stageChangedAt: util.nowISO(),
    };
    const out = Object.assign({}, base, c || {});
    out.equipment = Object.assign({}, base.equipment, (c && c.equipment) || {});
    out.assessment = Object.assign({}, base.assessment, (c && c.assessment) || {});
    out.siteVisit = Object.assign({}, base.siteVisit, (c && c.siteVisit) || {});
    out.siteVisit.survey = Object.assign({}, base.siteVisit.survey, (c && c.siteVisit && c.siteVisit.survey) || {});
    out.job = Object.assign({}, base.job, (c && c.job) || {});
    out.activities = Array.isArray(out.activities) ? out.activities : [];
    out.services = Array.isArray(out.services) ? out.services : [];
    if (!STAGES.find(s => s.id === out.stage)) out.stage = 'assessment';
    return out;
  }
  function normalizeReview(r) {
    return Object.assign({ id: util.uid('rv'), clientId: '', author: '', rating: 5, text: '', source: 'Direct', at: util.todayStr(), reply: '', featured: false }, r || {});
  }

  /* ---------- store ---------- */
  let db = null;
  const listeners = new Set();
  function load() {
    const raw = readRaw();
    db = raw && Array.isArray(raw.clients) ? raw : emptyDB();
    db.clients = db.clients.map(normalizeClient);
    db.reviews = (db.reviews || []).map(normalizeReview);
    db.meta = db.meta || {};
  }
  function commit(reason) {
    writeRaw(db);
    listeners.forEach(fn => { try { fn(reason); } catch (e) { console.error(e); } });
  }

  const store = {
    STORAGE_KEY,
    /** Subscribe to any change. fn(reason). Returns unsubscribe. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Read-only snapshot accessors (return live objects; do not mutate — use update methods). */
    clients() { return db.clients; },
    reviews() { return db.reviews; },
    meta() { return db.meta; },
    getClient(id) { return db.clients.find(c => c.id === id) || null; },
    byStage(stage) { return db.clients.filter(c => c.stage === stage); },

    /** Create client. Returns the new client. Logs a 'note' activity "Client added". */
    addClient(data) {
      const c = normalizeClient(Object.assign({}, data, { id: util.uid('cl'), createdAt: util.nowISO(), updatedAt: util.nowISO(), stageChangedAt: util.nowISO() }));
      if (!c.activities.length) c.activities.push({ id: util.uid('ac'), type: 'note', at: util.nowISO(), text: 'Client added (' + (c.source || 'unknown source') + ')' });
      db.clients.unshift(c); commit('client:add'); return c;
    },
    /** Shallow-merge patch into client; nested objects (equipment, assessment, siteVisit, job) are merged one level deep. */
    updateClient(id, patch) {
      const c = store.getClient(id); if (!c) return null;
      Object.keys(patch || {}).forEach(k => {
        const v = patch[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && c[k] && typeof c[k] === 'object' && !Array.isArray(c[k])) c[k] = Object.assign({}, c[k], v);
        else c[k] = v;
      });
      c.updatedAt = util.nowISO(); commit('client:update'); return c;
    },
    deleteClient(id) {
      db.clients = db.clients.filter(c => c.id !== id);
      db.reviews = db.reviews.filter(r => r.clientId !== id);
      commit('client:delete');
    },
    /** Move to a stage. Logs a 'stage' activity and stamps dates (job start/complete, assessment/site-visit complete). */
    moveStage(id, stage, note) {
      const c = store.getClient(id); if (!c || c.stage === stage) return c;
      const from = STAGES.find(s => s.id === c.stage), to = STAGES.find(s => s.id === stage); if (!to) return c;
      const today = util.todayStr();
      c.stage = stage; c.stageChangedAt = util.nowISO(); c.updatedAt = util.nowISO();
      if (stage === 'site_visit' && c.assessment.status !== 'completed') { c.assessment.status = 'completed'; c.assessment.completedAt = c.assessment.completedAt || today; }
      if (stage === 'in_progress' && !c.job.startedAt) c.job.startedAt = today;
      if (stage === 'completed') { c.job.completedAt = c.job.completedAt || today; c.job.progress = 100; }
      c.activities.unshift({ id: util.uid('ac'), type: 'stage', at: util.nowISO(), text: 'Moved from ' + (from ? from.label : '?') + ' to ' + to.label + (note ? ' — ' + note : '') });
      commit('client:stage'); return c;
    },
    /** Log engagement. act = {type, text, at?} */
    addActivity(id, act) {
      const c = store.getClient(id); if (!c) return null;
      const a = { id: util.uid('ac'), type: act.type || 'note', at: act.at || util.nowISO(), text: act.text || '' };
      c.activities.unshift(a); c.activities.sort((x, y) => (y.at > x.at ? 1 : -1));
      c.updatedAt = util.nowISO(); commit('activity:add'); return a;
    },
    deleteActivity(clientId, actId) {
      const c = store.getClient(clientId); if (!c) return;
      c.activities = c.activities.filter(a => a.id !== actId); commit('activity:delete');
    },
    addReview(r) { const rv = normalizeReview(Object.assign({}, r, { id: util.uid('rv') })); db.reviews.unshift(rv); commit('review:add'); return rv; },
    updateReview(id, patch) { const r = db.reviews.find(x => x.id === id); if (!r) return null; Object.assign(r, patch); commit('review:update'); return r; },
    deleteReview(id) { db.reviews = db.reviews.filter(r => r.id !== id); commit('review:delete'); },

    /** Last engagement timestamp (ISO) for a client, or createdAt. */
    lastTouch(c) { return (c.activities[0] && c.activities[0].at) || c.createdAt; },

    /** Whole-database operations */
    exportJSON() { return JSON.stringify(db, null, 2); },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.clients)) throw new Error('That file is not a Client Desk backup (no "clients" list found).');
      db = { version: 1, clients: data.clients.map(normalizeClient), reviews: (data.reviews || []).map(normalizeReview), meta: Object.assign({}, data.meta, { importedAt: util.nowISO() }) };
      commit('db:import');
    },
    /** Replace everything with given clients/reviews (used by seed). */
    replaceAll(clients, reviews, meta) { db = { version: 1, clients: clients.map(normalizeClient), reviews: (reviews || []).map(normalizeReview), meta: Object.assign({ createdAt: util.nowISO() }, meta || {}) }; commit('db:replace'); },
    clearAll() { db = emptyDB(); db.meta.seeded = true; commit('db:clear'); },
    isEmpty() { return db.clients.length === 0 && db.reviews.length === 0; },
  };

  /* ---------- UI helpers ---------- */
  const ui = {
    /** Toast message. kind: 'ok' | 'warn' | 'err' | 'info' */
    toast(msg, kind = 'ok') {
      let host = document.getElementById('toasts');
      const t = document.createElement('div');
      t.className = 'toast toast--' + kind; t.setAttribute('role', 'status'); t.textContent = msg;
      host.appendChild(t);
      setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 250); }, 2800);
    },
    /**
     * Modal dialog. Returns {el, body, close}.
     * opts: {title, body (html string), wide:bool, onClose}
     * Footer buttons belong inside body (use <div class="modal__foot">).
     */
    modal(opts) {
      const root = document.getElementById('overlay-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = '<div class="modal-scrim" data-close></div><div class="modal' + (opts.wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + util.esc(opts.title || 'Dialog') + '"><header class="modal__head"><h2 class="modal__title">' + util.esc(opts.title || '') + '</h2><button class="icon-btn" data-close aria-label="Close">' + ui.icon('x') + '</button></header><div class="modal__body"></div></div>';
      const body = wrap.querySelector('.modal__body'); body.innerHTML = opts.body || '';
      const prevFocus = document.activeElement;
      function close() { wrap.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
      function onKey(e) { if (e.key === 'Escape') close(); }
      wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
      document.addEventListener('keydown', onKey);
      root.appendChild(wrap);
      const f = wrap.querySelector('input, select, textarea, button:not([data-close])'); if (f) setTimeout(() => f.focus(), 30);
      return { el: wrap, body, close };
    },
    /** Side drawer (client detail). Same return shape as modal. */
    drawer(opts) {
      ui.closeDrawer();
      const root = document.getElementById('overlay-root');
      const wrap = document.createElement('div');
      wrap.className = 'drawer-wrap'; wrap.id = 'drawer';
      wrap.innerHTML = '<div class="modal-scrim" data-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + util.esc(opts.title || 'Details') + '"><div class="drawer__body"></div></aside>';
      const body = wrap.querySelector('.drawer__body'); body.innerHTML = opts.body || '';
      const prevFocus = document.activeElement;
      function close() { wrap.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); }
      function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) close(); }
      wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
      document.addEventListener('keydown', onKey);
      wrap._close = close;
      root.appendChild(wrap);
      return { el: wrap, body, close };
    },
    closeDrawer() { const d = document.getElementById('drawer'); if (d && d._close) d._close(); },
    /** In-page confirm (window.confirm is unavailable in some hosts). Returns Promise<boolean>. */
    confirm(message, { okLabel = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
      return new Promise(resolve => {
        let done = false;
        const m = ui.modal({ title, body: '<p class="confirm-msg">' + util.esc(message) + '</p><div class="modal__foot"><button class="btn btn--ghost" data-act="no">Cancel</button><button class="btn ' + (danger ? 'btn--danger' : 'btn--primary') + '" data-act="yes">' + util.esc(okLabel) + '</button></div>', onClose: () => { if (!done) resolve(false); } });
        m.body.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; done = true; resolve(b.dataset.act === 'yes'); m.close(); });
      });
    },
    stagePill(stageId) { const s = STAGES.find(x => x.id === stageId) || STAGES[0]; return '<span class="stage-pill stage-pill--' + s.id + '"><span class="stage-pill__dot"></span>' + util.esc(s.short) + '</span>'; },
    /** Compact equipment readout: "8 Cam · 4 AP · 2 SW · 1 RTR" (zeros skipped) */
    equipLine(eq) { eq = eq || {}; const parts = EQUIPMENT.filter(e => Number(eq[e.key]) > 0).map(e => '<span class="eq"><b>' + Number(eq[e.key]) + '</b> ' + e.short + '</span>'); return parts.length ? '<span class="eq-line">' + parts.join('') + '</span>' : '<span class="muted">No equipment listed</span>'; },
    stars(n, size) { n = Math.round(Number(n) || 0); let s = '<span class="stars' + (size ? ' stars--' + size : '') + '" role="img" aria-label="' + n + ' out of 5 stars">'; for (let i = 1; i <= 5; i++) s += '<span class="star' + (i <= n ? ' is-on' : '') + '">★</span>'; return s + '</span>'; },
    avatar(name) { return '<span class="avatar" aria-hidden="true">' + util.esc(util.initials(name)) + '</span>'; },
    empty(title, text, actionHtml) { return '<div class="empty"><p class="empty__title">' + util.esc(title) + '</p><p class="empty__text">' + util.esc(text) + '</p>' + (actionHtml || '') + '</div>'; },
    /** Inline SVG icon by name (stroke icons, 20px, currentColor). */
    icon(name) {
      const P = {
        overview: '<path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z"/>',
        pipeline: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z"/>',
        clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
        assessment: '<path d="M9 4h6M9 3h6v3H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="m8.5 13 2.3 2.3L15.5 10.5"/>',
        visit: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
        reviews: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
        engagement: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        data: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
        phone: '<path d="M5 3.5h3.5l1.8 4.6-2.3 1.4a11 11 0 0 0 6.5 6.5l1.4-2.3 4.6 1.8V19a1.5 1.5 0 0 1-1.6 1.5A17 17 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="m3.5 6 8.5 7 8.5-7"/>',
        message: '<path d="M4 5h16v11H9l-5 4z"/>', calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        note: '<path d="M5 3.5h10l4 4V20.5H5z"/><path d="M14.5 3.5v4.5h4.5M8 12h8M8 16h5"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        camera: '<rect x="2.5" y="7" width="13" height="10" rx="1.5"/><path d="m15.5 10.5 6-3v9l-6-3"/>', wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19" r="1"/>',
        switch: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01"/>', router: '<rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M7 13 5 6M17 13l2-7M7 16h.01M10 16h.01"/>',
        edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>', upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
      };
      return '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
    },
  };

  /* ---------- views & router ---------- */
  const views = []; // {id, label, icon, order, render(el, params), badge?()}
  let current = null;
  /**
   * Register a view.
   * view = { id, label, icon, order, render(mountEl), badge?: () => number|string|'' }
   * render() is called on navigation AND on every store change while the view is active,
   * so it must be idempotent (rebuild its own mountEl contents). Keep transient UI state
   * (filters, search text, open tabs) in module-level variables so re-render preserves it.
   */
  function registerView(v) { views.push(v); views.sort((a, b) => (a.order || 99) - (b.order || 99)); }
  function navTo(id) { if (location.hash !== '#' + id) location.hash = id; else route(); }
  function route() {
    const id = (location.hash || '').replace('#', '') || 'overview';
    const v = views.find(x => x.id === id) || views[0];
    if (!v) return;
    current = v;
    renderNav();
    renderCurrent();
    const main = document.getElementById('main'); if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  function renderCurrent() {
    if (!current) return;
    const mount = document.getElementById('view');
    const title = document.getElementById('view-title'); if (title) title.textContent = current.label;
    document.title = current.label + ' · Client Desk';
    const sx = window.scrollX, sy = window.scrollY;
    const focusedId = document.activeElement && document.activeElement.id;
    const selStart = document.activeElement && document.activeElement.selectionStart;
    mount.dataset.view = current.id;
    try { current.render(mount); } catch (e) { console.error(e); mount.innerHTML = '<div class="empty"><p class="empty__title">This view hit an error</p><p class="empty__text">' + util.esc(e.message) + '</p></div>'; }
    if (focusedId) { const el = document.getElementById(focusedId); if (el && el !== document.activeElement && mount.contains(el)) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (_) {} } }
    window.scrollTo(sx, sy);
  }
  function renderNav() {
    const nav = document.getElementById('nav'); if (!nav) return;
    nav.innerHTML = views.map(v => {
      const b = v.badge ? v.badge() : '';
      return '<a class="nav__item' + (current && current.id === v.id ? ' is-active' : '') + '" href="#' + v.id + '"' + (current && current.id === v.id ? ' aria-current="page"' : '') + '>' + ui.icon(v.icon) + '<span class="nav__label">' + util.esc(v.label) + '</span>' + (b ? '<span class="nav__badge">' + util.esc(b) + '</span>' : '') + '</a>';
    }).join('');
  }

  /* ---------- cross-module hooks (implemented by modules, safe defaults here) ---------- */
  const hooks = {
    /** Open client detail drawer. Implemented by client-drawer.js */
    openClient(id) { ui.toast('Client details are not available yet', 'warn'); },
    /** Open the new/edit client form. initial = partial client. Implemented by client-drawer.js. Resolves with the saved client or null. */
    editClient(id, initial) { ui.toast('Client form is not available yet', 'warn'); return Promise.resolve(null); },
    /** Open the free-assessment intake form. Implemented by assessments.js */
    newAssessment(prefill) { RS.editClient(null, Object.assign({ stage: 'assessment' }, prefill)); },
    /** Open the site-visit scheduler for a client. Implemented by site-visits.js */
    scheduleVisit(clientId) { ui.toast('Site visit scheduling is not available yet', 'warn'); },
    /** Open log-activity form. Implemented by engagement.js */
    logActivity(clientId, type) { ui.toast('Activity logging is not available yet', 'warn'); },
    /** Open add-review form. Implemented by reviews.js */
    addReview(clientId) { ui.toast('Reviews are not available yet', 'warn'); },
    /** Engagement score 0–100 for a client. Implemented by engagement.js; default is recency-based. */
    engagementScore(c) { const d = util.daysBetween(store.lastTouch(c)); return d == null ? 0 : Math.max(0, 100 - d * 4); },
  };

  /* ---------- boot ---------- */
  function boot() {
    load();
    if (store.isEmpty() && !db.meta.seeded && RS.seed) RS.seed(); // seed.js provides demo data on first run
    document.getElementById('quick-add').addEventListener('click', () => RS.newAssessment());
    store.subscribe(() => { renderNav(); renderCurrent(); });
    window.addEventListener('hashchange', route);
    route();
  }

  window.RS = Object.assign(window.RS || {}, { STAGES, SERVICES, EQUIPMENT, ISLANDS, SOURCES, ACTIVITY_TYPES, REVIEW_SOURCES, util, store, ui, registerView, navTo, rerender: renderCurrent, boot }, hooks);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => RS.boot()); else setTimeout(() => RS.boot(), 0);
})();
