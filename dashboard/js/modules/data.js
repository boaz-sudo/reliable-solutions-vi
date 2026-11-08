/* Client Desk — Data view: storage info, backup/restore, demo data, CSV import. */
(function () {
  'use strict';
  const RS = window.RS;
  const { esc, h, raw } = RS.util;
  const LAST_BACKUP_KEY = 'rsvi.lastBackup';
  const LIMIT_KB = 5 * 1024; // typical browser localStorage limit (~5 MB)

  /* ---------- transient UI state (survives re-render) ---------- */
  let mount = null;
  let restoreText = '';
  let restoreError = '';
  let restoreFileName = '';
  let csvText = '';
  let csvFileName = '';
  let csvError = '';
  let csvParsed = null; // {rows, mapping, ignored, skipped}

  /* ---------- helpers ---------- */
  function getLastBackup() { try { return localStorage.getItem(LAST_BACKUP_KEY) || ''; } catch (e) { return ''; } }
  function setLastBackup() { try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch (e) { /* ignore */ } }
  function storageWorks() {
    try { const k = 'rsvi.__probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
  }
  function usedKB() {
    let s = null;
    try { s = localStorage.getItem(RS.store.STORAGE_KEY); } catch (e) { s = null; }
    if (s == null) s = JSON.stringify(JSON.parse(RS.store.exportJSON()));
    return s.length / 1024;
  }
  function activityCount() { return RS.store.clients().reduce((n, c) => n + (c.activities ? c.activities.length : 0), 0); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  /** Local re-render (no store change) that keeps focus and caret in place. */
  function paint() {
    if (!mount || mount.dataset.view !== 'data' || !document.contains(mount)) return;
    const a = document.activeElement; const id = a && mount.contains(a) ? a.id : '';
    let ss = null, se = null; try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) { /* not a text field */ }
    const sx = window.scrollX, sy = window.scrollY;
    render(mount);
    if (id) { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } } }
    window.scrollTo(sx, sy);
  }

  /* ---------- backup ---------- */
  function downloadBackup() {
    const text = RS.store.exportJSON();
    const name = 'client-desk-backup-' + RS.util.todayStr() + '.json';
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setLastBackup();
      RS.ui.toast('Backup downloaded — ' + name);
    } catch (e) {
      RS.ui.toast('Download was blocked. Use "Show backup text" instead.', 'warn');
    }
    paint();
  }

  function showBackupText() {
    const text = RS.store.exportJSON();
    const n = RS.store.clients().length;
    const m = RS.ui.modal({
      title: 'Backup text',
      wide: true,
      body: h`<p class="dt-modal-lead">This is your full backup (${plural(n, 'client')}). Copy it and save it somewhere safe — an email to yourself or a notes app. To restore, paste it into "Paste backup text" on the Data page.</p>
        <label class="visually-hidden" for="dt-backup-text">Backup text</label>
        <textarea id="dt-backup-text" class="textarea dt-code" readonly rows="12" spellcheck="false">${text}</textarea>
        <div class="modal__foot"><button class="btn btn--ghost" data-close>Close</button><button class="btn btn--primary" data-act="copy">${raw(RS.ui.icon('check'))}Copy</button></div>`,
    });
    setLastBackup();
    paint();
    const ta = m.body.querySelector('#dt-backup-text');
    m.body.querySelector('[data-act="copy"]').addEventListener('click', () => {
      const fallback = () => { ta.focus(); ta.select(); RS.ui.toast('Text selected — press Ctrl+C (or Cmd+C) to copy', 'info'); };
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
        navigator.clipboard.writeText(text).then(() => { RS.ui.toast('Backup copied'); }, fallback);
      } catch (e) { fallback(); }
    });
  }

  /* ---------- restore ---------- */
  function explainParseError(e) {
    if (e instanceof SyntaxError) return 'This isn\'t readable backup text. It may be cut off or edited. Copy the whole backup again, from the first { to the last }, and try once more.';
    return e && e.message ? e.message : 'This backup could not be read.';
  }
  async function restoreFrom(text, label) {
    restoreError = '';
    text = String(text || '').trim();
    if (!text) { restoreError = 'Nothing to restore. Choose a backup file or paste backup text first.'; paint(); return; }
    let data;
    try {
      data = JSON.parse(text);
      if (!data || !Array.isArray(data.clients)) throw new Error('That ' + (label || 'text') + ' is not a Client Desk backup (no "clients" list found).');
    } catch (e) { restoreError = explainParseError(e); paint(); return; }
    const n = RS.store.clients().length, m = data.clients.length;
    const ok = await RS.ui.confirm('This replaces all ' + plural(n, 'client') + ' on this device with the ' + plural(m, 'client') + ' in the backup.', { danger: true, okLabel: 'Replace data', title: 'Restore backup?' });
    if (!ok) return;
    try {
      RS.store.importJSON(text);
    } catch (e) { restoreError = explainParseError(e); paint(); return; }
    restoreText = ''; restoreFileName = ''; restoreError = '';
    RS.ui.toast('Backup restored — ' + plural(m, 'client'));
    paint();
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('Could not read that file.'));
      r.readAsText(file);
    });
  }
  async function restoreFile(file) {
    if (!file) return;
    restoreFileName = file.name;
    try { const text = await readFile(file); await restoreFrom(text, 'file'); }
    catch (e) { restoreError = 'Could not read "' + file.name + '". ' + (e.message || ''); paint(); }
  }

  /* ---------- demo data ---------- */
  async function clearDemo() {
    const ok = await RS.ui.confirm('This removes all example clients and reviews so you can start with your own. It cannot be undone.', { danger: true, okLabel: 'Clear example data', title: 'Clear example data?' });
    if (!ok) return;
    RS.store.clearAll();
    RS.ui.toast('Example data cleared');
    RS.navTo('overview');
  }
  async function reloadDemo() {
    if (typeof RS.seed !== 'function') { RS.ui.toast('Example data is not available', 'warn'); return; }
    const n = RS.store.clients().length;
    const ok = await RS.ui.confirm('This replaces ' + (n ? 'all ' + plural(n, 'client') + ' on this device' : 'everything on this device') + ' with example clients.', { danger: n > 0, okLabel: 'Load example data', title: 'Reload example data?' });
    if (!ok) return;
    RS.seed();
    RS.ui.toast('Example data loaded');
  }
  function eraseAll() {
    const n = RS.store.clients().length, r = RS.store.reviews().length;
    const m = RS.ui.modal({
      title: 'Erase everything?',
      body: h`<p class="confirm-msg">This permanently deletes ${plural(n, 'client')} and ${plural(r, 'review')} from this device. Download a backup first if you might need them.</p>
        <div class="field dt-erase-field"><label for="dt-erase-input">Type ERASE to confirm</label><input id="dt-erase-input" class="input mono" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
        <div class="modal__foot"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--danger" data-act="erase" disabled>Erase everything</button></div>`,
    });
    const input = m.body.querySelector('#dt-erase-input');
    const btn = m.body.querySelector('[data-act="erase"]');
    const valid = () => input.value.trim() === 'ERASE';
    input.addEventListener('input', () => { btn.disabled = !valid(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && valid()) btn.click(); });
    btn.addEventListener('click', () => {
      if (!valid()) return;
      m.close();
      RS.store.clearAll();
      RS.ui.toast('All data erased');
    });
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    // auto-detect delimiter from header line: comma, semicolon or tab
    const firstLine = text.split(/\r\n|\n|\r/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    const delim = counts['\t'] > counts[','] && counts['\t'] >= counts[';'] ? '\t' : (counts[';'] > counts[','] ? ';' : ',');
    const rows = []; let row = []; let field = ''; let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') { inQ = true; }
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  const FIELD_ALIASES = {
    name: ['name', 'clientname', 'client', 'fullname', 'contact', 'contactname', 'customer', 'customername'],
    company: ['company', 'business', 'businessname', 'organization', 'organisation', 'companyname'],
    phone: ['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell'],
    email: ['email', 'emailaddress', 'mail'],
    island: ['island', 'location'],
    address: ['address', 'street', 'streetaddress', 'siteaddress'],
    services: ['services', 'service', 'servicesrequested', 'servicerequested'],
    stage: ['stage', 'status', 'pipelinestage'],
    cameras: ['cameras', 'camera', 'cams', 'cam'],
    accessPoints: ['accesspoints', 'accesspoint', 'aps', 'ap', 'wifiaps'],
    switches: ['switches', 'switch'],
    routers: ['routers', 'router'],
    quote: ['quote', 'quoteamount', 'amount', 'price', 'quoted'],
    notes: ['notes', 'note', 'comments', 'comment'],
  };
  const FIELD_LABELS = { name: 'Name', company: 'Company', phone: 'Phone', email: 'Email', island: 'Island', address: 'Address', services: 'Services', stage: 'Stage', cameras: 'Cameras', accessPoints: 'Access points', switches: 'Switches', routers: 'Routers', quote: 'Quote', notes: 'Notes' };
  const normKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function matchStage(v) {
    const k = normKey(v); if (!k) return 'assessment';
    const s = RS.STAGES.find(st => normKey(st.id) === k || normKey(st.label) === k || normKey(st.short) === k);
    if (s) return s.id;
    if (/assess/.test(k)) return 'assessment';
    if (/visit|survey/.test(k)) return 'site_visit';
    if (/progress|install|active|current/.test(k)) return 'in_progress';
    if (/complete|done|finished|closed/.test(k)) return 'completed';
    return 'assessment';
  }
  function matchIsland(v) {
    const k = normKey(v); if (!k) return '';
    const abbr = { stt: 'St. Thomas', stj: 'St. John', stx: 'St. Croix', wi: 'Water Island' };
    if (abbr[k]) return abbr[k];
    const hit = RS.ISLANDS.find(i => normKey(i) === k || normKey(i).replace(/^st/, 'saint') === k);
    return hit || String(v).trim();
  }
  function matchServices(v) {
    return String(v || '').split(/[;|]/).map(s => s.trim()).filter(Boolean).map(s => {
      const k = normKey(s);
      return RS.SERVICES.find(x => normKey(x) === k) ||
        RS.SERVICES.find(x => normKey(x).includes(k) || k.includes(normKey(x))) ||
        (/camera|cctv|surveil/.test(k) ? 'Security Cameras' : /maint|support|repair/.test(k) ? 'Maintenance & Support' : /manag|monitor/.test(k) ? 'Network Management' : /network|wifi|install|cabl/.test(k) ? 'Network Installation' : s);
    }).filter((s, i, a) => a.indexOf(s) === i);
  }
  const toInt = v => { const n = parseInt(String(v || '').replace(/[^\d-]/g, ''), 10); return isNaN(n) || n < 0 ? 0 : n; };
  const toMoney = v => { const n = parseFloat(String(v || '').replace(/[^\d.-]/g, '')); return isNaN(n) || n < 0 ? 0 : n; };

  function analyzeCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error(rows.length ? 'Only a header row was found. Add at least one client row below the column names.' : 'No rows found. Paste the spreadsheet with its header row first (Name, Company, Phone ...).');
    const header = rows[0].map(s => String(s).trim());
    const mapping = []; const ignored = []; const colFor = {};
    header.forEach((col, idx) => {
      const k = normKey(col);
      const field = Object.keys(FIELD_ALIASES).find(f => FIELD_ALIASES[f].includes(k));
      if (field && !(field in colFor)) { colFor[field] = idx; mapping.push({ col, field }); }
      else ignored.push(col || '(blank column ' + (idx + 1) + ')');
    });
    if (!('name' in colFor) && !('company' in colFor)) throw new Error('No "Name" column found. The first row must hold column names, including one called Name (or Company).');
    const get = (r, f) => (f in colFor ? String(r[colFor[f]] == null ? '' : r[colFor[f]]).trim() : '');
    let skipped = 0;
    const out = [];
    rows.slice(1).forEach(r => {
      const company = get(r, 'company');
      const name = get(r, 'name') || company;
      if (!name) { skipped++; return; }
      const c = {
        name, company, phone: get(r, 'phone'), email: get(r, 'email'), address: get(r, 'address'),
        services: matchServices(get(r, 'services')),
        stage: matchStage(get(r, 'stage')),
        equipment: { cameras: toInt(get(r, 'cameras')), accessPoints: toInt(get(r, 'accessPoints')), switches: toInt(get(r, 'switches')), routers: toInt(get(r, 'routers')) },
        quote: toMoney(get(r, 'quote')),
        notes: get(r, 'notes'),
      };
      const island = matchIsland(get(r, 'island'));
      if (island) c.island = island;
      out.push(c);
    });
    if (!out.length) throw new Error('No client rows have a name. Fill in the Name column and try again.');
    return { rows: out, mapping, ignored, skipped };
  }
  function runCSV(text) {
    csvText = text; csvError = ''; csvParsed = null;
    if (!String(text || '').trim()) { paint(); return; }
    try { csvParsed = analyzeCSV(text); } catch (e) { csvError = e.message; }
    paint();
  }
  function importCSV() {
    if (!csvParsed || !csvParsed.rows.length) return;
    const rows = csvParsed.rows; const n = rows.length;
    const stamp = new Date().toISOString();
    // addClient prepends; go in reverse so the spreadsheet's first row ends up on top
    for (let i = rows.length - 1; i >= 0; i--) {
      RS.store.addClient(Object.assign({}, rows[i], { activities: [{ id: RS.util.uid('ac'), type: 'note', at: stamp, text: 'Client added (imported from spreadsheet)' }] }));
    }
    csvText = ''; csvFileName = ''; csvParsed = null; csvError = '';
    RS.ui.toast('Imported ' + plural(n, 'client'));
    paint();
  }

  /* ---------- render ---------- */
  function storageCard() {
    const clients = RS.store.clients().length, reviews = RS.store.reviews().length, acts = activityCount();
    const kb = usedKB(); const pct = Math.min(100, (kb / LIMIT_KB) * 100);
    const last = getLastBackup();
    const days = last ? RS.util.daysBetween(last) : null;
    const stale = days == null || days >= 7;
    const persistent = storageWorks();
    const kbText = kb < 10 ? kb.toFixed(1) : Math.round(kb).toLocaleString('en-US');
    return h`<section class="card dt-card dt-store" aria-labelledby="dt-store-title">
      <div class="card__head"><h2 class="section-title" id="dt-store-title">Where your data is stored</h2>
        ${persistent ? raw('<span class="badge badge--good">Saved in this browser</span>') : raw('<span class="badge badge--bad">Browser storage blocked</span>')}</div>
      <p class="dt-lead">Clients are saved in this browser on this device only — not in the cloud. Another phone or computer will not see them, and clearing your browser data erases them. Download a backup regularly, and import that backup on another device to move your clients over.</p>
      ${persistent ? '' : raw('<p class="dt-alert dt-alert--bad">This browser is not letting the page save. Your changes will be lost when you close it. Download a backup before leaving.</p>')}
      <dl class="dt-stats">
        <div class="dt-stat"><dt>Clients</dt><dd class="num">${clients}</dd></div>
        <div class="dt-stat"><dt>Reviews</dt><dd class="num">${reviews}</dd></div>
        <div class="dt-stat"><dt>Activities</dt><dd class="num">${acts}</dd></div>
        <div class="dt-stat"><dt>Storage used</dt><dd class="num">${kbText}<span class="dt-unit"> KB</span></dd></div>
      </dl>
      <div class="dt-meter-row">
        <div class="dt-meter${pct > 70 ? ' is-warn' : ''}" role="meter" aria-label="Browser storage used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(1)}" aria-valuetext="${kbText} KB of about 5 MB"><span style="width:${Math.max(pct, 0.6).toFixed(2)}%"></span></div>
        <span class="dt-meter-cap mono">${pct < 1 ? '<1' : Math.round(pct)}% of ~5 MB</span>
      </div>
      <div class="dt-lastbk">
        <span class="muted">Last backup</span>
        <span class="mono">${last ? RS.util.fmtDate(last) + ' (' + RS.util.relDays(last) + ')' : 'Never'}</span>
        ${stale ? raw('<span class="badge badge--warn">No backup in 7+ days</span>') : raw('<span class="badge badge--good">Backed up</span>')}
      </div>
    </section>`;
  }

  function backupCard() {
    return h`<section class="card dt-card" aria-labelledby="dt-backup-title">
      <div class="card__head"><h2 class="section-title" id="dt-backup-title">Back up</h2></div>
      <p class="dt-lead">Saves every client, visit, activity and review into one file. Keep it in email, iCloud or Google Drive.</p>
      <div class="dt-actions">
        <button class="btn btn--primary" type="button" id="dt-download">${raw(RS.ui.icon('download'))}Download backup</button>
        <button class="btn" type="button" id="dt-show-text">${raw(RS.ui.icon('note'))}Show backup text</button>
      </div>
      <p class="field__hint">If the download does nothing (some previews block downloads), use "Show backup text" and copy it instead.</p>
    </section>`;
  }

  function restoreCard() {
    return h`<section class="card dt-card" aria-labelledby="dt-restore-title">
      <div class="card__head"><h2 class="section-title" id="dt-restore-title">Restore from backup</h2></div>
      <p class="dt-lead">Replaces the clients on this device with the ones in a backup. You confirm before anything changes.</p>
      <label class="dt-drop" id="dt-drop" for="dt-restore-file">
        ${raw(RS.ui.icon('upload'))}
        <span class="dt-drop__main"><b>Choose a backup file</b> or drop it here</span>
        <span class="dt-drop__sub mono">${restoreFileName || 'client-desk-backup-....json'}</span>
        <input type="file" id="dt-restore-file" class="dt-file" accept=".json,application/json">
      </label>
      <details class="dt-paste"${restoreText || restoreError ? ' open' : ''}>
        <summary>Paste backup text</summary>
        <div class="field">
          <label for="dt-restore-text">Backup text</label>
          <textarea id="dt-restore-text" class="textarea dt-code" rows="5" spellcheck="false" placeholder='{ "version": 1, "clients": [ ... ] }'>${restoreText}</textarea>
        </div>
        <div class="dt-actions"><button class="btn" type="button" id="dt-restore-paste">${raw(RS.ui.icon('upload'))}Restore pasted text</button></div>
      </details>
      ${restoreError ? raw('<p class="dt-alert dt-alert--bad" role="alert" id="dt-restore-error">' + esc(restoreError) + '</p>') : ''}
    </section>`;
  }

  function demoCard() {
    const demo = !!RS.store.meta().demo;
    const canSeed = typeof RS.seed === 'function';
    return h`<section class="card dt-card${demo ? ' dt-demo-on' : ''}" aria-labelledby="dt-demo-title">
      <div class="card__head"><h2 class="section-title" id="dt-demo-title">${demo ? "You're viewing example clients" : 'Example data and reset'}</h2>
        ${demo ? raw('<span class="badge badge--info">Demo</span>') : ''}</div>
      ${demo ? raw('<p class="dt-lead">The clients here are made up so you can explore Client Desk. When you are ready to track real clients, clear them and start fresh.</p><div class="dt-actions"><button class="btn btn--danger" type="button" id="dt-clear-demo">' + RS.ui.icon('trash') + 'Clear example data and start fresh</button></div>') : raw('<p class="dt-lead">Load made-up clients to try features, or erase everything on this device.</p>')}
      <div class="dt-actions dt-actions--minor">
        <button class="btn btn--ghost" type="button" id="dt-reload-demo"${canSeed ? '' : ' disabled'}>Reload example data</button>
        <button class="btn btn--ghost dt-danger-text" type="button" id="dt-erase">${raw(RS.ui.icon('trash'))}Erase everything</button>
      </div>
      ${canSeed ? '' : raw('<p class="field__hint">Example data is not available in this build.</p>')}
    </section>`;
  }

  function csvPreview() {
    if (csvError) return raw('<p class="dt-alert dt-alert--bad" role="alert">' + esc(csvError) + '</p>');
    if (!csvParsed) return '';
    const p = csvParsed; const n = p.rows.length;
    const map = p.mapping.map(m => '<li class="dt-map__item"><span class="mono">' + esc(m.col) + '</span>' + RS.ui.icon('arrow') + '<b>' + esc(FIELD_LABELS[m.field]) + '</b></li>').join('');
    const ign = p.ignored.length ? '<p class="field__hint">Ignored columns: ' + p.ignored.map(esc).join(', ') + '</p>' : '';
    const rows = p.rows.slice(0, 5).map(c => '<tr><td><div class="dt-cell-name">' + esc(c.name) + '</div>' + (c.company && c.company !== c.name ? '<div class="muted dt-cell-sub">' + esc(c.company) + '</div>' : '') + '</td><td>' + RS.ui.stagePill(c.stage) + '</td><td class="dt-cell-sub">' + (c.services.length ? esc(c.services.join(', ')) : '<span class="muted">—</span>') + '</td><td>' + RS.ui.equipLine(c.equipment) + '</td><td class="num">' + (c.quote ? esc(RS.util.fmtMoney(c.quote)) : '<span class="muted">—</span>') + '</td></tr>').join('');
    return raw('<div class="dt-csv-result">' +
      '<div class="dt-csv-sum"><span class="badge badge--good">' + plural(n, 'client') + ' ready</span>' + (p.skipped ? '<span class="badge badge--warn">' + plural(p.skipped, 'row') + ' without a name skipped</span>' : '') + '</div>' +
      '<div><p class="eyebrow">Detected columns</p><ul class="dt-map">' + map + '</ul>' + ign + '</div>' +
      '<p class="eyebrow">Preview' + (n > 5 ? ' — first 5 of ' + n : '') + '</p>' +
      '<div class="table-wrap dt-table"><table class="table"><thead><tr><th>Name</th><th>Stage</th><th>Services</th><th>Equipment</th><th class="num">Quote</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="dt-actions"><button class="btn btn--primary" type="button" id="dt-csv-import">' + RS.ui.icon('plus') + 'Import ' + plural(n, 'client') + '</button><button class="btn btn--ghost" type="button" id="dt-csv-clear">Clear</button></div>' +
      '</div>');
  }

  function csvCard() {
    return h`<section class="card dt-card" aria-labelledby="dt-csv-title">
      <div class="card__head"><h2 class="section-title" id="dt-csv-title">Import clients from a spreadsheet</h2></div>
      <p class="dt-lead">Move an existing client list in. Save your spreadsheet as CSV (Excel, Numbers and Google Sheets all can), then choose the file or paste its contents. New clients are added alongside the ones already here.</p>
      <p class="field__hint">Recognized columns: Name, Company, Phone, Email, Island, Address, Services (separate several with ;), Stage, Cameras, Access points, Switches, Routers, Quote, Notes. Unknown stages become Free assessment.</p>
      <div class="dt-csv-inputs">
        <div class="field">
          <label for="dt-csv-file">CSV file</label>
          <input type="file" id="dt-csv-file" class="input dt-file-input" accept=".csv,.txt,text/csv">
          ${csvFileName ? raw('<span class="field__hint mono">' + esc(csvFileName) + '</span>') : ''}
        </div>
        <div class="field">
          <label for="dt-csv-text">Or paste CSV text</label>
          <textarea id="dt-csv-text" class="textarea dt-code" rows="4" spellcheck="false" placeholder="Name,Company,Phone,Services,Stage,Cameras&#10;Dana Hodge,Bluebeard Villas,340-555-0101,Security Cameras;Network Installation,Site visit,8">${csvText}</textarea>
        </div>
      </div>
      ${csvPreview()}
    </section>`;
  }

  function installCard() {
    return h`<section class="card dt-card dt-tip" aria-labelledby="dt-install-title">
      ${raw(RS.ui.icon('phone'))}
      <div class="dt-tip__body">
        <h2 class="card__title" id="dt-install-title">Install on your phone</h2>
        <p class="muted">Open this page in Safari (iPhone) or Chrome (Android), tap Share or the menu, then choose <b>Add to Home Screen</b>. Client Desk opens like an app. Your clients on the phone are separate from this computer — use a backup to copy them across.</p>
      </div>
    </section>`;
  }

  function render(el) {
    mount = el;
    el.innerHTML = '<div class="dt-wrap">' + storageCard() +
      '<div class="dt-grid">' + backupCard() + restoreCard() + '</div>' +
      csvCard() +
      '<div class="dt-grid">' + demoCard() + installCard() + '</div></div>';
    bind(el);
  }

  function bind(el) {
    const $ = s => el.querySelector(s);
    $('#dt-download').addEventListener('click', downloadBackup);
    $('#dt-show-text').addEventListener('click', showBackupText);

    const file = $('#dt-restore-file');
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; restoreFile(f); });
    const drop = $('#dt-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'dragend'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('is-over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) restoreFile(f);
    });
    const rt = $('#dt-restore-text');
    rt.addEventListener('input', () => { restoreText = rt.value; });
    $('#dt-restore-paste').addEventListener('click', () => restoreFrom(rt.value, 'text'));

    const clr = $('#dt-clear-demo'); if (clr) clr.addEventListener('click', clearDemo);
    $('#dt-reload-demo').addEventListener('click', reloadDemo);
    $('#dt-erase').addEventListener('click', eraseAll);

    const cf = $('#dt-csv-file');
    cf.addEventListener('change', async () => {
      const f = cf.files && cf.files[0]; if (!f) return;
      csvFileName = f.name;
      try { runCSV(await readFile(f)); } catch (e) { csvError = 'Could not read "' + f.name + '".'; paint(); }
    });
    const ct = $('#dt-csv-text');
    const reparse = RS.util.debounce(() => { csvFileName = ''; runCSV(ct.value); }, 350);
    ct.addEventListener('input', () => { csvText = ct.value; reparse(); });
    const imp = $('#dt-csv-import'); if (imp) imp.addEventListener('click', importCSV);
    const cc = $('#dt-csv-clear'); if (cc) cc.addEventListener('click', () => { csvText = ''; csvFileName = ''; csvParsed = null; csvError = ''; paint(); });
  }

  RS.registerView({
    id: 'data', label: 'Data', icon: 'data', order: 8, render,
    badge() { try { return RS.store.meta().demo ? 'Demo' : ''; } catch (e) { return ''; } },
  });
})();
