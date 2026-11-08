/* Clients — searchable, sortable directory of every client (potential, current, completed). */
(function () {
  'use strict';
  const RS = window.RS;
  const { h, raw, esc } = RS.util;

  /* ---------- transient UI state (survives re-render) ---------- */
  const state = {
    segment: 'all',      // all | potential | current | completed
    q: '',
    service: '',
    island: '',
    stage: '',
    sort: { key: 'updated', dir: 'desc' },
  };
  let mountRef = null;

  const SEGMENTS = [
    { id: 'all', label: 'All', test: () => true },
    { id: 'potential', label: 'Potential', test: c => c.stage === 'assessment' || c.stage === 'site_visit' },
    { id: 'current', label: 'Current', test: c => c.stage === 'in_progress' },
    { id: 'completed', label: 'Completed', test: c => c.stage === 'completed' },
  ];
  const SORT_PRESETS = [
    { value: 'updated:desc', label: 'Recently updated' },
    { value: 'name:asc', label: 'Name A–Z' },
    { value: 'quote:desc', label: 'Quote high→low' },
    { value: 'equip:desc', label: 'Most equipment' },
    { value: 'contact:asc', label: 'Last contact oldest' },
  ];
  const SORT_LABELS = { name: 'Client', stage: 'Stage', cameras: 'Cameras', accessPoints: 'Access points', switches: 'Switches', routers: 'Routers', quote: 'Quote', contact: 'Last contact', engagement: 'Engagement', updated: 'Recently updated', equip: 'Equipment' };
  const SERVICE_SHORT = { 'Security Cameras': 'Cameras', 'Network Installation': 'Install', 'Network Management': 'Mgmt', 'Maintenance & Support': 'Support' };
  const EQ_ICONS = { cameras: 'camera', accessPoints: 'wifi', switches: 'switch', routers: 'router' };
  const STAGE_ORDER = RS.STAGES.reduce((m, s, i) => (m[s.id] = i, m), {});
  // Default direction when a column header is first clicked.
  const DEFAULT_DIR = { name: 'asc', stage: 'asc', contact: 'asc', updated: 'desc', quote: 'desc', equip: 'desc', cameras: 'desc', accessPoints: 'desc', switches: 'desc', routers: 'desc', engagement: 'desc' };

  /* ---------- data helpers ---------- */
  const eqNum = (c, k) => Number(c.equipment && c.equipment[k]) || 0;
  const touchTime = c => { const d = RS.util.toDate(RS.store.lastTouch(c)); return d ? d.getTime() : 0; };
  function score(c) { try { const s = Number(RS.engagementScore(c)); return isNaN(s) ? 0 : Math.max(0, Math.min(100, Math.round(s))); } catch (e) { return 0; } }

  function matchesQuery(c, q) {
    if (!q) return true;
    const hay = [c.name, c.company, c.phone, c.email, c.address, c.notes].join(' \u0001 ').toLowerCase();
    if (hay.includes(q)) return true;
    const digits = q.replace(/\D/g, '');
    return digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(digits);
  }
  /** Clients passing search + service + island + stage filters (segment not applied). */
  function baseFiltered() {
    const q = state.q.trim().toLowerCase();
    return RS.store.clients().filter(c =>
      matchesQuery(c, q) &&
      (!state.service || c.services.includes(state.service)) &&
      (!state.island || c.island === state.island) &&
      (!state.stage || c.stage === state.stage));
  }
  function sortList(list) {
    const { key, dir } = state.sort;
    const val = {
      name: c => (c.name || '').toLowerCase(),
      stage: c => STAGE_ORDER[c.stage] ?? 0,
      quote: c => Number(c.quote) || 0,
      equip: c => RS.util.equipTotal(c.equipment),
      contact: touchTime,
      updated: c => c.updatedAt || '',
      engagement: c => c._score,
      cameras: c => eqNum(c, 'cameras'), accessPoints: c => eqNum(c, 'accessPoints'),
      switches: c => eqNum(c, 'switches'), routers: c => eqNum(c, 'routers'),
    }[key] || (c => c.updatedAt || '');
    const m = dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -m; if (va > vb) return m;
      return (a.name || '').localeCompare(b.name || '');
    });
  }
  function computeView() {
    const base = baseFiltered();
    const counts = {}; SEGMENTS.forEach(s => { counts[s.id] = base.filter(s.test).length; });
    const seg = SEGMENTS.find(s => s.id === state.segment) || SEGMENTS[0];
    const rows = base.filter(seg.test).map(c => ({ c, _score: score(c) }));
    // attach score for sorting without mutating store objects
    const scored = rows.map(r => Object.assign(Object.create(r.c), { _score: r._score }));
    return { counts, list: sortList(scored) };
  }

  /* ---------- small renderers ---------- */
  function servicesHtml(services) {
    if (!services.length) return '<span class="muted">—</span>';
    const shown = services.slice(0, 2).map(s => h`<span class="clients-svc" title="${s}">${SERVICE_SHORT[s] || s}</span>`).join('');
    const more = services.length > 2 ? h`<span class="clients-svc clients-svc--more" title="${services.slice(2).join(', ')}">+${services.length - 2}</span>` : '';
    return '<span class="clients-svcs">' + shown + more + '</span>';
  }
  function meterHtml(s) {
    const tone = s >= 70 ? 'good' : s >= 40 ? 'warn' : 'bad';
    return h`<span class="clients-meter clients-meter--${tone}" role="img" aria-label="Engagement ${s} out of 100"><span class="clients-meter__bar"><span class="clients-meter__fill" style="width:${s}%"></span></span><span class="clients-meter__num mono">${s}</span></span>`;
  }
  function contactHtml(c) {
    const t = RS.store.lastTouch(c);
    const d = RS.util.daysBetween(t);
    const stale = d != null && d > 14;
    return h`<span class="clients-contact${stale ? ' is-stale' : ''}" title="${RS.util.fmtDate(t)}">${RS.util.relDays(t)}</span>`;
  }
  const eqCell = n => n > 0 ? String(n) : '—';
  const money = n => RS.util.fmtMoney(n);

  function sortHeader(key, labelHtml, cls) {
    const on = state.sort.key === key;
    const ariaSort = on ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = on ? (state.sort.dir === 'asc' ? '↑' : '↓') : '';
    return `<th scope="col" class="${cls || ''}" aria-sort="${ariaSort}"><button type="button" class="clients-sort${on ? ' is-on' : ''}" data-sort="${key}">${labelHtml}<span class="clients-sort__arrow" aria-hidden="true">${arrow}</span></button></th>`;
  }
  function eqHeader(e) {
    return sortHeader(e.key, RS.ui.icon(EQ_ICONS[e.key]) + h`<span class="visually-hidden">${e.label}</span>`, 'num clients-eqcol');
  }

  /* ---------- results (table + cards) ---------- */
  function renderResults() {
    const mount = mountRef; if (!mount) return;
    const host = mount.querySelector('.clients-results'); if (!host) return;
    const { counts, list } = computeView();

    // update segment counts in place
    mount.querySelectorAll('.clients-seg__btn').forEach(b => {
      const n = b.querySelector('.clients-seg__count'); if (n) n.textContent = counts[b.dataset.seg];
      b.setAttribute('aria-pressed', String(b.dataset.seg === state.segment));
    });
    const sortSel = mount.querySelector('#clients-sort'); if (sortSel) syncSortSelect(sortSel);
    const status = mount.querySelector('#clients-status');
    if (status) status.textContent = list.length + (list.length === 1 ? ' client' : ' clients') + ' shown';

    if (!RS.store.clients().length) {
      host.innerHTML = RS.ui.empty('No clients yet', 'Add your first client or book a free assessment to start the directory.', '<button type="button" class="btn btn--primary" data-act="add">' + RS.ui.icon('plus') + 'Add client</button>');
      bindResults(host); return;
    }
    if (!list.length) {
      host.innerHTML = RS.ui.empty('No clients match', 'Try a different name or clear the filters', '<button type="button" class="btn" data-act="clear">Clear filters</button>');
      bindResults(host); return;
    }

    const tot = { cameras: 0, accessPoints: 0, switches: 0, routers: 0, quote: 0 };
    list.forEach(c => { RS.EQUIPMENT.forEach(e => { tot[e.key] += eqNum(c, e.key); }); tot.quote += Number(c.quote) || 0; });

    const rowsHtml = list.map(c => {
      const label = (c.name || 'Unnamed client') + (c.company ? ', ' + c.company : '');
      return h`<tr tabindex="0" data-id="${c.id}" class="clients-row clients-row--${c.stage}" aria-label="${'Open ' + label}">
        <td class="clients-namecell"><span class="clients-who">${raw(RS.ui.avatar(c.name))}<span class="clients-who__text"><span class="clients-who__name">${c.name || 'Unnamed client'}</span>${c.company ? raw(h`<span class="clients-who__co muted">${c.company}</span>`) : ''}</span></span></td>
        <td>${raw(RS.ui.stagePill(c.stage))}</td>
        <td>${raw(servicesHtml(c.services))}</td>
        ${raw(RS.EQUIPMENT.map(e => { const n = eqNum(c, e.key); return h`<td class="num clients-eqcol${n ? '' : ' is-zero'}"><span class="visually-hidden">${e.label}: </span>${eqCell(n)}</td>`; }).join(''))}
        <td class="num">${Number(c.quote) ? money(c.quote) : raw('<span class="muted">—</span>')}</td>
        <td>${raw(contactHtml(c))}</td>
        <td>${raw(meterHtml(c._score))}</td>
      </tr>`;
    }).join('');

    const table = `<div class="table-wrap clients-tablewrap"><table class="table clients-table">
      <caption class="visually-hidden">Client directory, sorted by ${esc(SORT_LABELS[state.sort.key] || 'update')} ${state.sort.dir === 'asc' ? 'ascending' : 'descending'}</caption>
      <thead><tr>
        ${sortHeader('name', 'Client')}
        ${sortHeader('stage', 'Stage')}
        <th scope="col">Services</th>
        ${RS.EQUIPMENT.map(eqHeader).join('')}
        ${sortHeader('quote', 'Quote', 'num')}
        ${sortHeader('contact', 'Last contact')}
        ${sortHeader('engagement', 'Engagement')}
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <th scope="row" colspan="3" class="clients-foot__label">${list.length} ${list.length === 1 ? 'client' : 'clients'}<span class="muted"> · totals</span></th>
        ${RS.EQUIPMENT.map(e => h`<td class="num clients-eqcol"><span class="visually-hidden">${e.label}: </span>${tot[e.key]}</td>`).join('')}
        <td class="num">${money(tot.quote)}</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table></div>`;

    const cards = '<ul class="clients-cards" role="list">' + list.map(c => h`<li><button type="button" class="clients-card clients-card--${c.stage}" data-id="${c.id}">
        <span class="clients-card__top"><span class="clients-card__who"><span class="clients-who__name">${c.name || 'Unnamed client'}</span>${c.company ? raw(h`<span class="clients-who__co muted">${c.company}</span>`) : ''}</span>${raw(RS.ui.stagePill(c.stage))}</span>
        <span class="clients-card__row">${raw(servicesHtml(c.services))}</span>
        <span class="clients-card__row">${raw(RS.ui.equipLine(c.equipment))}</span>
        <span class="clients-card__meta"><span class="mono clients-card__quote">${Number(c.quote) ? money(c.quote) : 'No quote'}</span><span class="clients-card__contact">Last contact ${raw(contactHtml(c))}</span></span>
      </button></li>`).join('') + '</ul>'
      + h`<p class="clients-cardtotals"><span><b class="mono">${list.length}</b> ${list.length === 1 ? 'client' : 'clients'}</span>${raw(RS.ui.equipLine(tot))}<span class="mono">${money(tot.quote)}</span></p>`;

    host.innerHTML = table + cards;
    bindResults(host);
  }

  function bindResults(host) {
    host.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] || 'asc' };
      renderResults();
      const again = mountRef && mountRef.querySelector('[data-sort="' + key + '"]'); if (again) again.focus();
    }));
    host.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => RS.openClient(tr.dataset.id));
      tr.addEventListener('keydown', e => {
        if (e.target !== tr) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); RS.openClient(tr.dataset.id); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const sib = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
          if (sib) sib.focus();
        }
      });
    });
    host.querySelectorAll('.clients-card').forEach(b => b.addEventListener('click', () => RS.openClient(b.dataset.id)));
    const clear = host.querySelector('[data-act="clear"]'); if (clear) clear.addEventListener('click', clearFilters);
    const add = host.querySelector('[data-act="add"]'); if (add) add.addEventListener('click', () => RS.editClient(null, {}));
  }

  function clearFilters() {
    Object.assign(state, { segment: 'all', q: '', service: '', island: '', stage: '' });
    if (mountRef) { render(mountRef); const s = mountRef.querySelector('#clients-search'); if (s) s.focus(); }
  }

  function syncSortSelect(sel) {
    const v = state.sort.key + ':' + state.sort.dir;
    const preset = SORT_PRESETS.find(p => p.value === v);
    let custom = sel.querySelector('option[data-custom]');
    if (preset) { if (custom) custom.remove(); sel.value = v; return; }
    if (!custom) { custom = document.createElement('option'); custom.dataset.custom = '1'; sel.appendChild(custom); }
    custom.value = v;
    custom.textContent = (SORT_LABELS[state.sort.key] || state.sort.key) + (state.sort.dir === 'asc' ? ' (low→high)' : ' (high→low)');
    sel.value = v;
  }

  /* ---------- CSV export ---------- */
  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from treating text as formulas
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCSV(list) {
    const head = ['name', 'company', 'phone', 'email', 'island', 'address', 'stage', 'services', 'cameras', 'accessPoints', 'switches', 'routers', 'quote', 'followUpOn', 'lastContact'];
    const stageLabel = id => (RS.STAGES.find(s => s.id === id) || {}).label || id;
    const lines = list.map(c => {
      const lt = RS.util.toDate(RS.store.lastTouch(c));
      const ltStr = lt ? lt.getFullYear() + '-' + String(lt.getMonth() + 1).padStart(2, '0') + '-' + String(lt.getDate()).padStart(2, '0') : '';
      return [c.name, c.company, c.phone, c.email, c.island, c.address, stageLabel(c.stage), c.services.join(';'),
        eqNum(c, 'cameras'), eqNum(c, 'accessPoints'), eqNum(c, 'switches'), eqNum(c, 'routers'),
        Number(c.quote) || 0, c.followUpOn || '', ltStr].map(csvCell).join(',');
    });
    return [head.join(',')].concat(lines).join('\r\n');
  }
  function exportCSV() {
    const { list } = computeView();
    const csv = buildCSV(list);
    const fname = 'clients-' + RS.util.todayStr() + '.csv';
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { /* download blocked: the modal below still offers the text */ }

    const m = RS.ui.modal({
      title: 'Export CSV',
      wide: true,
      body: h`<div class="clients-csv">
        <p class="muted">${list.length} ${list.length === 1 ? 'client' : 'clients'} from the current filters. If the ${fname} download did not start, copy the text below and paste it into a spreadsheet.</p>
        <label class="field__label" for="clients-csv-text">CSV text</label>
        <textarea id="clients-csv-text" class="textarea clients-csv__text mono" readonly rows="10" spellcheck="false">${csv}</textarea>
        <div class="modal__foot"><button type="button" class="btn btn--ghost" data-close>Close</button><button type="button" class="btn btn--primary" data-act="copy">Copy CSV</button></div>
      </div>`,
    });
    const ta = m.body.querySelector('#clients-csv-text');
    m.body.querySelector('[data-act="copy"]').addEventListener('click', () => {
      const fallback = () => { ta.focus(); ta.select(); RS.ui.toast('Press Ctrl+C to copy', 'info'); };
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
        navigator.clipboard.writeText(csv).then(() => RS.ui.toast('CSV copied')).catch(fallback);
      } catch (e) { fallback(); }
    });
  }

  /* ---------- main render ---------- */
  function render(mount) {
    mountRef = mount;
    const opt = (v, label, cur) => h`<option value="${v}"${raw(v === cur ? ' selected' : '')}>${label}</option>`;

    mount.innerHTML = `
      <div class="clients-head">
        <div class="clients-seg" role="group" aria-label="Filter by client status">
          ${SEGMENTS.map(s => h`<button type="button" class="clients-seg__btn clients-seg__btn--${s.id}" data-seg="${s.id}" aria-pressed="${String(s.id === state.segment)}"><span>${s.label}</span><span class="clients-seg__count mono">0</span></button>`).join('')}
        </div>
        <div class="clients-actions">
          <button type="button" class="btn" id="clients-export">${RS.ui.icon('download')}Export CSV</button>
          <button type="button" class="btn btn--primary" id="clients-add">${RS.ui.icon('plus')}Add client</button>
        </div>
      </div>
      <div class="toolbar clients-toolbar">
        <div class="search clients-search">
          <label class="visually-hidden" for="clients-search">Search clients</label>
          ${RS.ui.icon('search')}
          <input id="clients-search" class="input input--search" type="search" placeholder="Search name, company, phone, email, address, notes" value="${esc(state.q)}" autocomplete="off">
        </div>
        <div class="clients-filter">
          <label class="visually-hidden" for="clients-service">Service</label>
          <select id="clients-service" class="select">${opt('', 'All services', state.service)}${RS.SERVICES.map(s => opt(s, s, state.service)).join('')}</select>
        </div>
        <div class="clients-filter">
          <label class="visually-hidden" for="clients-island">Island</label>
          <select id="clients-island" class="select">${opt('', 'All islands', state.island)}${RS.ISLANDS.map(s => opt(s, s, state.island)).join('')}</select>
        </div>
        <div class="clients-filter">
          <label class="visually-hidden" for="clients-stage">Stage</label>
          <select id="clients-stage" class="select">${opt('', 'All stages', state.stage)}${RS.STAGES.map(s => opt(s.id, s.label, state.stage)).join('')}</select>
        </div>
        <div class="clients-filter clients-filter--sort">
          <label class="clients-sortlabel" for="clients-sort">Sort</label>
          <select id="clients-sort" class="select">${SORT_PRESETS.map(p => opt(p.value, p.label, '')).join('')}</select>
        </div>
      </div>
      <p id="clients-status" class="visually-hidden" role="status" aria-live="polite"></p>
      <div class="clients-results"></div>`;

    mount.querySelectorAll('.clients-seg__btn').forEach(b => b.addEventListener('click', () => { state.segment = b.dataset.seg; renderResults(); }));
    const search = mount.querySelector('#clients-search');
    search.addEventListener('input', () => { state.q = search.value; renderResults(); });
    search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; state.q = ''; renderResults(); } });
    [['#clients-service', 'service'], ['#clients-island', 'island'], ['#clients-stage', 'stage']].forEach(([sel, key]) => {
      const el = mount.querySelector(sel);
      el.addEventListener('change', () => { state[key] = el.value; renderResults(); });
    });
    const sortSel = mount.querySelector('#clients-sort');
    sortSel.addEventListener('change', () => { const [key, dir] = sortSel.value.split(':'); state.sort = { key, dir }; renderResults(); });
    mount.querySelector('#clients-add').addEventListener('click', () => RS.editClient(null, {}));
    mount.querySelector('#clients-export').addEventListener('click', exportCSV);

    renderResults();
  }

  RS.registerView({ id: 'clients', label: 'Clients', icon: 'clients', order: 3, render });
})();
