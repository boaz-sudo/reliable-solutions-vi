/* Client Desk — Site visits module.
 * View 'site-visits' (agenda, needs scheduling, recent reports) plus hooks
 * RS.scheduleVisit(clientId) and RS.recordVisit(clientId).
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, ui, store } = RS;
  const { esc, h, raw } = util;

  const TECHS = ['Michael Gooding', 'Andre Thomas'];
  const CHECKS = [
    { id: 'power',          label: 'Power outlets & UPS location' },
    { id: 'network_closet', label: 'Network closet / rack location' },
    { id: 'isp',            label: 'ISP modem & service checked' },
    { id: 'mounting',       label: 'Camera mounting points confirmed' },
    { id: 'wifi_survey',    label: 'Wi‑Fi coverage walk-through' },
    { id: 'lighting',       label: 'Night lighting / IR needs' },
    { id: 'storage',        label: 'Recording storage & retention agreed' },
    { id: 'remote_view',    label: 'Remote viewing app set up plan' },
  ];
  const EQ_ICON = { cameras: 'camera', accessPoints: 'wifi', switches: 'switch', routers: 'router' };
  const PHOTO_LIMIT = 3 * 1024 * 1024; // characters of data URL ≈ bytes in localStorage
  const MAX_PX = 800;

  /* ---------- helpers ---------- */
  function addDays(str, n) {
    const d = util.toDate(str); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayLabel(dateStr, today) {
    if (dateStr === today) return 'Today';
    if (dateStr === addDays(today, 1)) return 'Tomorrow';
    return util.fmtDate(dateStr, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function checksDone(sv) { const c = (sv && sv.checklist) || {}; return CHECKS.filter(k => c[k.id]).length; }
  function photoBytes(list) { return (list || []).reduce((s, p) => s + ((p && p.dataUrl) ? p.dataUrl.length : 0), 0); }
  function fmtMB(n) { return (n / (1024 * 1024)).toFixed(n < 1024 * 1024 ? 2 : 1) + ' MB'; }
  function placeLine(c) { return [c.address, c.island].filter(Boolean).join(' · '); }
  function isScheduled(c) { return c.siteVisit && c.siteVisit.status === 'scheduled' && c.siteVisit.date; }
  function needsReportCount() {
    const today = util.todayStr();
    return store.clients().filter(c => isScheduled(c) && c.siteVisit.date <= today).length;
  }
  function setErr(form, name, msg) {
    const el = form.querySelector('[data-err="' + name + '"]');
    const input = form.querySelector('[name="' + name + '"]');
    if (el) { el.textContent = msg || ''; el.hidden = !msg; }
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function errSlot(name, id) { return '<p class="sv-err" id="' + id + '" data-err="' + name + '" role="alert" hidden></p>'; }

  /** Equipment stepper markup (ids sv-eq-<key> or sv-<prefix>-<key>). */
  function counters(prefix, values, requested) {
    return '<div class="counter-grid sv-counters">' + RS.EQUIPMENT.map(e => {
      const id = prefix + '-' + e.key, v = Number(values[e.key]) || 0;
      const req = requested ? Number(requested[e.key]) || 0 : null;
      return '<div class="counter sv-counter" data-key="' + e.key + '">' +
        '<label class="counter__label" for="' + id + '">' + ui.icon(EQ_ICON[e.key]) + esc(e.label) + '</label>' +
        '<div class="counter__ctl"><button type="button" class="sv-step" data-step="-1" data-for="' + id + '" aria-label="Decrease ' + esc(e.label) + '">−</button>' +
        '<input class="input" type="number" inputmode="numeric" min="0" max="999" id="' + id + '" name="' + id + '" value="' + v + '">' +
        '<button type="button" class="sv-step" data-step="1" data-for="' + id + '" aria-label="Increase ' + esc(e.label) + '">+</button></div>' +
        (req !== null ? '<p class="sv-counter__req" data-req="' + req + '" aria-live="polite"></p>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  function readCounters(root, prefix) {
    const out = {};
    RS.EQUIPMENT.forEach(e => { const el = root.querySelector('#' + prefix + '-' + e.key); out[e.key] = Math.max(0, Math.round(Number(el && el.value) || 0)); });
    return out;
  }
  function bindCounters(root) {
    const refresh = () => root.querySelectorAll('.sv-counter').forEach(box => {
      const p = box.querySelector('.sv-counter__req'); if (!p) return;
      const req = Number(p.dataset.req) || 0, v = Math.max(0, Number(box.querySelector('input').value) || 0), d = v - req;
      p.innerHTML = 'Requested <b class="mono">' + req + '</b> <span class="sv-diff ' + (d === 0 ? 'is-same' : d > 0 ? 'is-up' : 'is-down') + ' mono">' + (d === 0 ? 'match' : (d > 0 ? '+' : '−') + Math.abs(d)) + '</span>';
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('.sv-step'); if (!b) return;
      const input = root.querySelector('#' + b.dataset.for);
      input.value = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
      refresh();
    });
    root.addEventListener('input', e => { if (e.target.closest('.sv-counter')) refresh(); });
    refresh();
  }

  /* ---------- schedule modal ---------- */
  function scheduleVisit(clientId) {
    const c = store.getClient(clientId);
    if (!c) { ui.toast('That client could not be found', 'err'); return; }
    const sv = c.siteVisit || {};
    const isResched = sv.status === 'scheduled' && sv.date;
    const access = sv.accessNotes != null ? sv.accessNotes : (sv.status === 'scheduled' ? sv.notes : '');
    const body = h`
      <form class="form sv-form" novalidate>
        <div class="form-row">
          <div class="field"><label for="sv-s-date">Date *</label>
            <input class="input" type="date" id="sv-s-date" name="date" value="${sv.date || ''}" min="${util.todayStr()}" aria-describedby="sv-s-date-err" required>
            ${raw(errSlot('date', 'sv-s-date-err'))}</div>
          <div class="field"><label for="sv-s-time">Time *</label>
            <input class="input" type="time" id="sv-s-time" name="time" value="${sv.time || '09:00'}" step="900" aria-describedby="sv-s-time-err" required>
            ${raw(errSlot('time', 'sv-s-time-err'))}</div>
        </div>
        <div class="field"><label for="sv-s-tech">Technician</label>
          <input class="input" id="sv-s-tech" name="technician" list="sv-s-techs" value="${sv.technician || TECHS[0]}" autocomplete="off">
          <datalist id="sv-s-techs">${TECHS.map(t => raw('<option value="' + esc(t) + '">'))}</datalist></div>
        <div class="field"><label for="sv-s-addr">Address</label>
          <input class="input" id="sv-s-addr" name="address" value="${c.address}" autocomplete="street-address">
          <p class="field__hint">${c.island}. Changes here update the client record.</p></div>
        <div class="field"><label for="sv-s-access">Access notes</label>
          <textarea class="textarea" id="sv-s-access" name="access" rows="3" placeholder="Gate code, parking, dogs on property">${access || ''}</textarea></div>
        <div class="field"><span class="field__label">Equipment to verify</span>
          ${raw(counters('sv-s-eq', c.equipment, null))}
          <p class="field__hint">From the client's request. The technician confirms counts on site.</p></div>
        <div class="modal__foot">
          ${raw(isResched ? '<button type="button" class="btn btn--ghost sv-cancel-visit" data-act="cancel-visit">Cancel visit</button><span class="toolbar__spacer"></span>' : '')}
          <button type="button" class="btn btn--ghost" data-close>Close</button>
          <button type="submit" class="btn btn--primary">${raw(ui.icon('calendar'))}${isResched ? 'Reschedule visit' : 'Schedule visit'}</button>
        </div>
      </form>`;
    const m = ui.modal({ title: (isResched ? 'Reschedule site visit — ' : 'Schedule site visit — ') + c.name, body });
    const form = m.body.querySelector('form');
    bindCounters(form);
    form.addEventListener('input', e => { if (e.target.name === 'date' || e.target.name === 'time') setErr(form, e.target.name, ''); });

    const cancelBtn = form.querySelector('[data-act="cancel-visit"]');
    if (cancelBtn) cancelBtn.addEventListener('click', async () => {
      const ok = await ui.confirm('Cancel the site visit for ' + c.name + ' on ' + util.fmtDate(sv.date) + '?', { okLabel: 'Cancel visit', danger: true, title: 'Cancel site visit' });
      if (!ok) return;
      store.updateClient(c.id, { siteVisit: { status: 'cancelled' } });
      store.addActivity(c.id, { type: 'meeting', text: 'Site visit for ' + util.fmtDate(sv.date) + ' cancelled' });
      m.close(); ui.toast('Site visit cancelled', 'info');
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const date = String(fd.get('date') || ''), time = String(fd.get('time') || '');
      let bad = false;
      if (!date) { setErr(form, 'date', 'Pick the visit date.'); bad = true; }
      else if (date < util.todayStr() && !isResched) { setErr(form, 'date', 'Pick today or a later date.'); bad = true; }
      if (!time) { setErr(form, 'time', 'Pick a start time.'); bad = true; }
      if (bad) { const f = form.querySelector('[aria-invalid="true"]'); if (f) f.focus(); return; }
      const tech = String(fd.get('technician') || '').trim();
      const accessNotes = String(fd.get('access') || '').trim();
      const address = String(fd.get('address') || '').trim();
      if (c.stage === 'assessment') store.moveStage(c.id, 'site_visit');
      store.updateClient(c.id, {
        address,
        equipment: readCounters(form, 'sv-s-eq'),
        siteVisit: { date, time, technician: tech, status: 'scheduled', notes: accessNotes, accessNotes },
        followUpOn: date,
      });
      store.addActivity(c.id, { type: 'meeting', text: 'Site visit ' + (isResched ? 'rescheduled' : 'scheduled') + ' for ' + util.fmtDate(date) + ' ' + util.fmtTime(time) + (tech ? ' with ' + tech : '') });
      m.close();
      ui.toast(isResched ? 'Site visit rescheduled' : 'Site visit scheduled');
    });
  }

  /* ---------- photo handling ---------- */
  function downscale(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read ' + file.name));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error(file.name + ' is not a readable image'));
        img.onload = () => {
          const scale = Math.min(1, MAX_PX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const w = Math.max(1, Math.round(img.naturalWidth * scale)), hgt = Math.max(1, Math.round(img.naturalHeight * scale));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hgt); // JPEG has no alpha
          ctx.drawImage(img, 0, 0, w, hgt);
          resolve({ name: file.name, dataUrl: cv.toDataURL('image/jpeg', 0.7) });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- record (report) modal ---------- */
  function recordVisit(clientId) {
    const c = store.getClient(clientId);
    if (!c) { ui.toast('That client could not be found', 'err'); return; }
    const sv = c.siteVisit || {};
    const surveyHas = util.equipTotal(sv.survey) > 0;
    const survey0 = surveyHas ? sv.survey : c.equipment;
    let photos = Array.isArray(sv.photos) ? sv.photos.slice() : [];
    const quote0 = Number(c.quote) || Number(c.assessment && c.assessment.estimate) || '';
    const findings0 = sv.status === 'completed' ? (sv.notes || '') : '';
    const when = sv.date ? util.fmtDate(sv.date, { weekday: 'short', month: 'short', day: 'numeric' }) + (sv.time ? ' · ' + util.fmtTime(sv.time) : '') : 'Not scheduled';

    const body = h`
      <form class="form sv-report" novalidate>
        <div class="sv-report__meta">
          <p class="sv-report__client">${c.name}${c.company ? ' · ' + c.company : ''}</p>
          <p class="muted">${placeLine(c) || 'No address on file'}</p>
          <p class="muted"><span class="mono">${when}</span>${sv.technician ? ' · ' + sv.technician : ''}</p>
          ${raw(sv.accessNotes ? '<p class="sv-report__access"><b>Access:</b> ' + esc(sv.accessNotes) + '</p>' : '')}
        </div>

        <fieldset class="sv-fs">
          <legend class="sv-legend">Checklist <span class="sv-count mono" id="sv-r-checkcount"></span></legend>
          <div class="sv-checks">
            ${CHECKS.map(k => raw('<label class="sv-check" for="sv-chk-' + k.id + '"><input type="checkbox" id="sv-chk-' + k.id + '" name="chk_' + k.id + '" data-check="' + k.id + '"' + ((sv.checklist || {})[k.id] ? ' checked' : '') + '><span class="sv-check__box" aria-hidden="true">' + ui.icon('check') + '</span><span class="sv-check__text">' + esc(k.label) + '</span></label>'))}
          </div>
        </fieldset>

        <fieldset class="sv-fs">
          <legend class="sv-legend">Measured on site</legend>
          ${raw(counters('sv-eq', survey0, c.equipment))}
          <label class="check sv-update-eq" for="sv-r-updeq"><input type="checkbox" id="sv-r-updeq" name="updateEq" checked> Update client equipment to surveyed counts</label>
        </fieldset>

        <div class="form-row">
          <div class="field"><label for="sv-r-cable">Cable run estimate (ft)</label>
            <input class="input mono" type="number" inputmode="numeric" min="0" step="10" id="sv-r-cable" name="cableFt" value="${sv.cableFt || ''}" aria-describedby="sv-r-cable-err">
            ${raw(errSlot('cableFt', 'sv-r-cable-err'))}</div>
          <div class="field"><label for="sv-r-quote">Quote for the job ($)</label>
            <input class="input mono" type="number" inputmode="decimal" min="0" step="50" id="sv-r-quote" name="quote" value="${quote0}" aria-describedby="sv-r-quote-err">
            ${raw(errSlot('quote', 'sv-r-quote-err'))}</div>
        </div>
        <div class="field"><label for="sv-r-mount">Mounting heights</label>
          <textarea class="textarea" id="sv-r-mount" name="mounting" rows="2" placeholder="e.g. Front gate 10 ft on post; rear eave 12 ft, needs ladder">${sv.mountingNotes || ''}</textarea></div>
        <div class="field"><label for="sv-r-notes">Findings and notes</label>
          <textarea class="textarea" id="sv-r-notes" name="notes" rows="4" placeholder="What you found, risks, what the client asked for">${findings0}</textarea></div>

        <fieldset class="sv-fs">
          <legend class="sv-legend">Photos <span class="sv-count mono" id="sv-r-photosize"></span></legend>
          <div class="sv-photos" id="sv-r-photos"></div>
          <label class="btn sv-photo-add" for="sv-r-file">${raw(ui.icon('camera'))}Add photos</label>
          <input class="visually-hidden" type="file" id="sv-r-file" accept="image/*" multiple>
          <p class="field__hint" id="sv-r-photohint">Photos are shrunk to 800 px. Up to 3 MB total fits in browser storage.</p>
        </fieldset>

        <fieldset class="sv-fs" aria-describedby="sv-r-outcome-err">
          <legend class="sv-legend">Outcome *</legend>
          <div class="sv-outcomes">
            <label class="sv-outcome sv-outcome--ready" for="sv-out-ready"><input type="radio" name="outcome" id="sv-out-ready" value="ready"><span><b>Ready to start job</b><small>Moves the client to In progress</small></span></label>
            <label class="sv-outcome sv-outcome--follow" for="sv-out-follow"><input type="radio" name="outcome" id="sv-out-follow" value="follow"><span><b>Needs follow-up</b><small>Stays in Site visit with a follow-up date</small></span></label>
            <label class="sv-outcome sv-outcome--declined" for="sv-out-declined"><input type="radio" name="outcome" id="sv-out-declined" value="declined"><span><b>Client declined</b><small>Stays in Site visit, priority set to low</small></span></label>
          </div>
          ${raw(errSlot('outcome', 'sv-r-outcome-err'))}
          <div class="field sv-follow" id="sv-r-followbox" hidden><label for="sv-r-follow">Follow up on</label>
            <input class="input" type="date" id="sv-r-follow" name="followUpOn" value="${addDays(util.todayStr(), 3)}" aria-describedby="sv-r-follow-err">
            ${raw(errSlot('followUpOn', 'sv-r-follow-err'))}</div>
          <div class="field sv-follow" id="sv-r-declinebox" hidden><label for="sv-r-decline">Reason declined</label>
            <input class="input" id="sv-r-decline" name="declineReason" placeholder="e.g. Over budget, chose another installer"></div>
        </fieldset>

        <div class="modal__foot sv-report__foot">
          <button type="button" class="btn btn--ghost" data-close>Close</button>
          <button type="submit" class="btn btn--primary">${raw(ui.icon('check'))}Save report</button>
        </div>
      </form>`;
    const m = ui.modal({ title: 'Site visit report', body, wide: true });
    const form = m.body.querySelector('form');
    bindCounters(form);

    const countEl = form.querySelector('#sv-r-checkcount');
    const refreshChecks = () => { countEl.textContent = form.querySelectorAll('[data-check]:checked').length + '/' + CHECKS.length; };
    refreshChecks();

    const photoBox = form.querySelector('#sv-r-photos'), sizeEl = form.querySelector('#sv-r-photosize'), hint = form.querySelector('#sv-r-photohint');
    function renderPhotos() {
      photoBox.innerHTML = photos.map((p, i) => '<figure class="sv-photo"><img src="' + esc(p.dataUrl) + '" alt="' + esc(p.name || 'Site photo ' + (i + 1)) + '"><button type="button" class="sv-photo__rm" data-rm="' + i + '" aria-label="Remove photo ' + esc(p.name || i + 1) + '">' + ui.icon('x') + '</button></figure>').join('');
      const bytes = photoBytes(photos);
      sizeEl.textContent = photos.length ? photos.length + ' · ' + fmtMB(bytes) : '';
      sizeEl.classList.toggle('is-warn', bytes > PHOTO_LIMIT * 0.8);
    }
    renderPhotos();
    photoBox.addEventListener('click', e => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      photos.splice(Number(b.dataset.rm), 1); renderPhotos();
      hint.classList.remove('is-warn'); hint.textContent = 'Photo removed.';
    });
    const fileInput = form.querySelector('#sv-r-file');
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []); fileInput.value = '';
      let added = 0, refused = 0;
      for (const f of files) {
        if (f.type && !/^image\//.test(f.type)) { refused++; continue; }
        try {
          const p = await downscale(f);
          if (photoBytes(photos) + p.dataUrl.length > PHOTO_LIMIT) { refused++; continue; }
          photos.push(p); added++; renderPhotos();
        } catch (err) { refused++; }
      }
      if (refused) {
        hint.classList.add('is-warn');
        hint.textContent = refused + ' photo' + (refused > 1 ? 's' : '') + ' not added: photos are limited to 3 MB total so the report fits in browser storage. Remove a photo to add another.';
        ui.toast('Photo storage is full (3 MB)', 'warn');
      } else if (added) { hint.classList.remove('is-warn'); hint.textContent = added + ' photo' + (added > 1 ? 's' : '') + ' added.'; }
    });

    const followBox = form.querySelector('#sv-r-followbox'), declineBox = form.querySelector('#sv-r-declinebox');
    form.addEventListener('change', e => {
      if (e.target.dataset.check) refreshChecks();
      if (e.target.name === 'outcome') {
        setErr(form, 'outcome', '');
        followBox.hidden = e.target.value !== 'follow';
        declineBox.hidden = e.target.value !== 'declined';
      }
    });
    form.addEventListener('input', e => { if (['cableFt', 'quote', 'followUpOn'].includes(e.target.name)) setErr(form, e.target.name, ''); });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const outcome = fd.get('outcome');
      const cableRaw = String(fd.get('cableFt') || '').trim(), quoteRaw = String(fd.get('quote') || '').trim();
      const followUpOn = String(fd.get('followUpOn') || '');
      let bad = false;
      if (cableRaw && !(Number(cableRaw) >= 0)) { setErr(form, 'cableFt', 'Enter feet as a number, 0 or more.'); bad = true; }
      if (quoteRaw && !(Number(quoteRaw) >= 0)) { setErr(form, 'quote', 'Enter the quote as a dollar amount.'); bad = true; }
      if (!outcome) { setErr(form, 'outcome', 'Choose how the visit ended.'); bad = true; }
      if (outcome === 'follow' && !followUpOn) { setErr(form, 'followUpOn', 'Pick a follow-up date.'); bad = true; }
      if (bad) {
        const f = form.querySelector('[aria-invalid="true"]') || (!outcome && form.querySelector('#sv-out-ready'));
        if (f) { f.focus(); if (f.scrollIntoView) f.scrollIntoView({ block: 'center' }); }
        return;
      }
      const checklist = {}; CHECKS.forEach(k => { checklist[k.id] = !!form.querySelector('#sv-chk-' + k.id).checked; });
      const done = CHECKS.filter(k => checklist[k.id]).length;
      const survey = readCounters(form, 'sv-eq');
      const patch = {
        siteVisit: {
          status: 'completed', completedAt: util.todayStr(), checklist, survey, photos,
          notes: String(fd.get('notes') || '').trim(), mountingNotes: String(fd.get('mounting') || '').trim(),
          cableFt: cableRaw ? Math.round(Number(cableRaw)) : 0, outcome,
        },
        quote: quoteRaw ? Number(quoteRaw) : (Number(c.quote) || 0),
      };
      if (fd.get('updateEq')) patch.equipment = survey;
      if (outcome === 'follow') patch.followUpOn = followUpOn;
      if (outcome === 'declined') { patch.priority = 'low'; patch.followUpOn = ''; }
      store.updateClient(c.id, patch);
      store.addActivity(c.id, { type: 'meeting', text: 'Site visit completed: ' + done + ' of ' + CHECKS.length + ' checks' });
      if (outcome === 'declined') {
        const why = String(fd.get('declineReason') || '').trim();
        store.addActivity(c.id, { type: 'note', text: 'Client declined after site visit' + (why ? ': ' + why : '') });
      }
      if (outcome === 'ready' && c.stage !== 'in_progress' && c.stage !== 'completed') store.moveStage(c.id, 'in_progress', 'site visit report');
      m.close();
      ui.toast(outcome === 'ready' ? 'Visit report saved — job ready to start' : 'Visit report saved');
    });
  }

  /* ---------- view ---------- */
  function rowHtml(c, opts) {
    const sv = c.siteVisit;
    const overdue = opts && opts.overdue;
    return '<li class="sv-row' + (overdue ? ' sv-row--overdue' : '') + '">' +
      '<div class="sv-row__time mono">' + (overdue ? '<span class="sv-row__date">' + esc(util.fmtShort(sv.date)) + '</span>' : '') + esc(sv.time ? util.fmtTime(sv.time) : 'No time') + '</div>' +
      '<div class="sv-row__main">' +
        '<p class="sv-row__name"><button type="button" class="sv-link" data-act="open" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>' + ui.stagePill(c.stage) +
          (overdue ? '<span class="badge badge--warn">' + esc(util.relDays(sv.date)) + '</span>' : '') + '</p>' +
        '<p class="sv-row__place">' + ui.icon('visit') + '<span>' + esc(placeLine(c) || 'No address on file') + '</span></p>' +
        '<p class="sv-row__meta"><span class="sv-row__tech">' + esc(sv.technician || 'No technician') + '</span>' + ui.equipLine(c.equipment) + '</p>' +
        (sv.accessNotes ? '<p class="sv-row__access">' + esc(sv.accessNotes) + '</p>' : '') +
      '</div>' +
      '<div class="sv-row__acts">' +
        '<button type="button" class="btn btn--primary btn--sm" data-act="record" data-id="' + esc(c.id) + '">' + ui.icon('note') + 'Start report</button>' +
        '<button type="button" class="btn btn--sm" data-act="schedule" data-id="' + esc(c.id) + '">' + ui.icon('calendar') + 'Reschedule</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-act="open" data-id="' + esc(c.id) + '">Open</button>' +
      '</div></li>';
  }

  function groupHtml(title, rows, mod, extra) {
    return '<section class="sv-day' + (mod ? ' sv-day--' + mod : '') + '"><h3 class="sv-day__head"><span>' + esc(title) + '</span>' + (extra || '') + '<span class="sv-day__n mono">' + rows.length + '</span></h3><ul class="sv-list">' + rows.join('') + '</ul></section>';
  }

  function render(mount) {
    const today = util.todayStr(), end = addDays(today, 13);
    const all = store.clients();
    const scheduled = all.filter(isScheduled).sort((a, b) => (a.siteVisit.date + (a.siteVisit.time || '99')).localeCompare(b.siteVisit.date + (b.siteVisit.time || '99')));
    const overdue = scheduled.filter(c => c.siteVisit.date < today);
    const upcoming = scheduled.filter(c => c.siteVisit.date >= today && c.siteVisit.date <= end);
    const later = scheduled.filter(c => c.siteVisit.date > end);
    const todays = upcoming.filter(c => c.siteVisit.date === today);
    const unsched = all.filter(c => c.stage === 'site_visit' && c.siteVisit.status !== 'completed' && (c.siteVisit.status === 'not_scheduled' || c.siteVisit.status === 'cancelled' || !c.siteVisit.date))
      .sort((a, b) => String(a.stageChangedAt).localeCompare(String(b.stageChangedAt)));
    const recent = all.filter(c => c.siteVisit.status === 'completed')
      .sort((a, b) => String(b.siteVisit.completedAt || '').localeCompare(String(a.siteVisit.completedAt || '')) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10);

    const stat = (n, label, mod) => '<div class="sv-stat' + (mod && n ? ' sv-stat--' + mod : '') + '"><span class="sv-stat__n">' + n + '</span><span class="sv-stat__l">' + esc(label) + '</span></div>';
    let html = '<div class="sv-stats">' + stat(todays.length, 'Today', 'today') + stat(upcoming.length, 'Next 14 days') + stat(overdue.length, 'Need a report', 'warn') + stat(unsched.length, 'Need scheduling', 'warn') + '</div>';

    /* agenda */
    html += '<section class="sv-block" aria-labelledby="sv-h-agenda"><div class="sv-block__head"><h2 class="section-title" id="sv-h-agenda">Agenda</h2><span class="muted">' + esc(util.fmtShort(today)) + ' – ' + esc(util.fmtShort(end)) + '</span></div>';
    if (overdue.length) html += groupHtml('Needs a report', overdue.map(c => rowHtml(c, { overdue: true })), 'overdue', '<span class="badge badge--warn">Past due</span>');
    if (!todays.length) html += '<section class="sv-day sv-day--today"><h3 class="sv-day__head"><span>Today</span><span class="sv-day__n mono">0</span></h3><p class="sv-none">No visits today.</p></section>';
    const byDay = new Map();
    upcoming.forEach(c => { const d = c.siteVisit.date; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(c); });
    byDay.forEach((list, d) => {
      html += groupHtml(dayLabel(d, today), list.map(c => rowHtml(c)), d === today ? 'today' : '', d !== today && d !== addDays(today, 1) ? '' : '<span class="sv-day__date mono">' + esc(util.fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })) + '</span>');
    });
    if (!upcoming.length && !overdue.length) html += '<p class="sv-none">Nothing booked in the next two weeks.</p>';
    if (later.length) html += groupHtml('Later', later.map(c => rowHtml(c).replace('<div class="sv-row__time mono">', '<div class="sv-row__time mono"><span class="sv-row__date">' + esc(util.fmtShort(c.siteVisit.date)) + '</span>')), 'later');
    html += '</section>';

    /* needs scheduling */
    html += '<section class="sv-block" aria-labelledby="sv-h-unsched"><div class="sv-block__head"><h2 class="section-title" id="sv-h-unsched">Needs scheduling</h2>' + (unsched.length ? '<span class="badge badge--warn">' + unsched.length + '</span>' : '') + '</div>';
    if (unsched.length) {
      html += '<ul class="sv-list sv-list--card">' + unsched.map(c => '<li class="sv-row sv-row--compact">' +
        '<div class="sv-row__main"><p class="sv-row__name"><button type="button" class="sv-link" data-act="open" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>' + (c.siteVisit.status === 'cancelled' ? '<span class="badge">Cancelled</span>' : '') + '</p>' +
        '<p class="sv-row__place">' + ui.icon('visit') + '<span>' + esc(placeLine(c) || 'No address on file') + '</span></p>' +
        '<p class="sv-row__meta"><span class="muted">In site visit stage ' + esc(util.relDays(c.stageChangedAt)) + '</span>' + ui.equipLine(c.equipment) + '</p></div>' +
        '<div class="sv-row__acts"><button type="button" class="btn btn--primary btn--sm" data-act="schedule" data-id="' + esc(c.id) + '">' + ui.icon('calendar') + 'Schedule</button></div></li>').join('') + '</ul>';
    } else html += '<p class="sv-none">Every client in the site visit stage has a visit booked.</p>';
    html += '</section>';

    /* recently completed */
    html += '<section class="sv-block" aria-labelledby="sv-h-done"><div class="sv-block__head"><h2 class="section-title" id="sv-h-done">Recently completed visits</h2></div>';
    if (recent.length) {
      html += '<ul class="sv-list sv-list--card">' + recent.map(c => {
        const sv = c.siteVisit, n = checksDone(sv), ph = (sv.photos || []).length;
        return '<li class="sv-row sv-row--done">' +
          '<div class="sv-row__time mono">' + esc(sv.completedAt ? util.fmtShort(sv.completedAt) : '—') + '</div>' +
          '<div class="sv-row__main"><p class="sv-row__name"><button type="button" class="sv-link" data-act="open" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>' + ui.stagePill(c.stage) + '</p>' +
          '<p class="sv-row__meta"><span class="badge ' + (n === CHECKS.length ? 'badge--good' : 'badge--warn') + ' mono" title="Checklist items done">' + n + '/' + CHECKS.length + '</span>' +
          '<span class="sv-chip mono">' + ph + ' photo' + (ph === 1 ? '' : 's') + '</span>' +
          (sv.cableFt ? '<span class="sv-chip mono">' + Number(sv.cableFt) + ' ft cable</span>' : '') +
          (c.quote ? '<span class="sv-chip mono">' + esc(util.fmtMoney(c.quote)) + '</span>' : '') +
          '<span class="sv-row__tech">' + esc(sv.technician || '') + '</span></p></div>' +
          '<div class="sv-row__acts"><button type="button" class="btn btn--sm" data-act="record" data-id="' + esc(c.id) + '">' + ui.icon('edit') + 'Edit report</button></div></li>';
      }).join('') + '</ul>';
    } else html += '<p class="sv-none">No site visit reports yet.</p>';
    html += '</section>';

    mount.innerHTML = '<div class="sv-wrap">' + html + '</div>';
    mount.onclick = e => {
      const b = e.target.closest('[data-act]'); if (!b || !mount.contains(b)) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'record') RS.recordVisit(id);
      else if (b.dataset.act === 'schedule') RS.scheduleVisit(id);
      else if (b.dataset.act === 'open') RS.openClient(id);
    };
  }

  RS.scheduleVisit = scheduleVisit;
  RS.recordVisit = recordVisit;
  RS.SITE_VISIT_CHECKS = CHECKS;
  RS.registerView({
    id: 'site-visits', label: 'Site visits', icon: 'visit', order: 5, render,
    badge() { const n = needsReportCount(); return n || ''; },
  });
})();
