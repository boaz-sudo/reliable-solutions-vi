/* Client Desk — Free assessments module.
 * View 'assessments' (queue + completed) and the RS.newAssessment(prefill) intake form.
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, store, ui } = RS;
  const { h, raw, esc } = util;

  /* ---------- transient UI state ---------- */
  let tab = 'queue';            // 'queue' | 'completed'
  let checklistOpen = false;

  const EQ_ICON = { cameras: 'camera', accessPoints: 'wifi', switches: 'switch', routers: 'router' };
  const EQ_ONE = { cameras: 'camera', accessPoints: 'access point', switches: 'switch', routers: 'router' };

  /* ---------- helpers ---------- */
  function thisMonth(v) {
    const d = util.toDate(v); if (!d) return false;
    const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }
  function parseMoney(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n) : 0; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function whenText(a) {
    if (!a.scheduledFor) return '';
    return util.fmtDate(a.scheduledFor, { weekday: 'short', month: 'short', day: 'numeric' }) + (a.scheduledTime ? ' · ' + util.fmtTime(a.scheduledTime) : '');
  }

  /** Four equipment steppers. ids: `${prefix}-cameras`, `${prefix}-accessPoints`, ... */
  function countersHtml(prefix, eq) {
    eq = eq || {};
    return '<div class="counter-grid">' + RS.EQUIPMENT.map(e => {
      const id = prefix + '-' + e.key, v = Number(eq[e.key]) || 0;
      return h`<div class="counter">
        <label class="counter__label" for="${id}">${raw(ui.icon(EQ_ICON[e.key]))}${e.label}</label>
        <div class="counter__ctl">
          <button type="button" data-step="-1" data-for="${id}" aria-label="${'Remove one ' + EQ_ONE[e.key]}">&minus;</button>
          <input class="input" type="number" inputmode="numeric" min="0" max="999" step="1" id="${id}" data-eq="${e.key}" value="${v}">
          <button type="button" data-step="1" data-for="${id}" aria-label="${'Add one ' + EQ_ONE[e.key]}">+</button>
        </div>
      </div>`;
    }).join('') + '</div>';
  }
  function bindCounters(root, prefix, onChange) {
    root.addEventListener('click', e => {
      const b = e.target.closest('button[data-step]'); if (!b || !b.dataset.for.startsWith(prefix + '-')) return;
      const inp = root.querySelector('#' + b.dataset.for);
      inp.value = Math.max(0, Math.min(999, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step)));
      onChange && onChange();
    });
    root.querySelectorAll('input[id^="' + prefix + '-"][data-eq]').forEach(inp => inp.addEventListener('input', () => onChange && onChange()));
  }
  function readCounters(root, prefix) {
    const out = {};
    RS.EQUIPMENT.forEach(e => { const inp = root.querySelector('#' + prefix + '-' + e.key); out[e.key] = Math.max(0, parseInt(inp && inp.value, 10) || 0); });
    return out;
  }

  function setError(root, fieldId, msg) {
    const f = root.querySelector('#' + fieldId), err = root.querySelector('#' + fieldId + '-err');
    if (f) { if (msg) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid'); }
    if (err) { err.textContent = msg || ''; err.hidden = !msg; }
  }

  /* ---------- RS.newAssessment(prefill): intake form ---------- */
  function newAssessment(prefill) {
    const p = Object.assign({}, prefill || {});
    const pa = p.assessment || {};
    const services = new Set(Array.isArray(p.services) ? p.services : []);
    const opt = (list, sel) => list.map(x => h`<option value="${x}"${raw(x === sel ? ' selected' : '')}>${x}</option>`).join('');

    const body = h`<form class="form as-intake" id="as-intake" novalidate>
      <p class="as-intake__lede">Book a free on-site assessment. Only the client name and the service are required — everything else can be filled in later.</p>

      <fieldset class="as-fs">
        <legend class="eyebrow">Client</legend>
        <div class="form-row">
          <div class="field">
            <label for="as-f-name">Client name <span class="as-req" aria-hidden="true">*</span></label>
            <input class="input" id="as-f-name" autocomplete="name" required aria-required="true" aria-describedby="as-f-name-err" value="${p.name || ''}">
            <p class="as-err" id="as-f-name-err" role="alert" hidden></p>
          </div>
          <div class="field">
            <label for="as-f-company">Company <span class="muted">(optional)</span></label>
            <input class="input" id="as-f-company" autocomplete="organization" value="${p.company || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="as-f-phone">Phone</label>
            <input class="input" id="as-f-phone" type="tel" autocomplete="tel" placeholder="340-555-0100" value="${p.phone || ''}">
          </div>
          <div class="field">
            <label for="as-f-email">Email</label>
            <input class="input" id="as-f-email" type="email" autocomplete="email" aria-describedby="as-f-email-err" value="${p.email || ''}">
            <p class="as-err" id="as-f-email-err" role="alert" hidden></p>
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="as-f-island">Island</label>
            <select class="select" id="as-f-island">${raw(opt(RS.ISLANDS, p.island || 'St. Thomas'))}</select>
          </div>
          <div class="field as-span2">
            <label for="as-f-address">Address / location</label>
            <input class="input" id="as-f-address" autocomplete="street-address" placeholder="Estate, street, or landmark" value="${p.address || ''}">
          </div>
          <div class="field">
            <label for="as-f-source">How they heard about us</label>
            <select class="select" id="as-f-source">${raw(opt(RS.SOURCES, p.source || 'Website form'))}</select>
          </div>
        </div>
      </fieldset>

      <fieldset class="as-fs">
        <legend class="eyebrow" id="as-f-services-label">Service requested <span class="as-req" aria-hidden="true">*</span></legend>
        <div class="chips as-chips" id="as-f-services" role="group" aria-labelledby="as-f-services-label" aria-describedby="as-f-services-err">
          ${raw(RS.SERVICES.map(s => h`<button type="button" class="chip${raw(services.has(s) ? ' is-on' : '')}" aria-pressed="${services.has(s) ? 'true' : 'false'}" data-service="${s}">${raw(ui.icon('check'))}${s}</button>`).join(''))}
        </div>
        <p class="as-err" id="as-f-services-err" role="alert" hidden></p>
      </fieldset>

      <fieldset class="as-fs">
        <div class="as-eqhead">
          <legend class="eyebrow">Equipment wanted</legend>
          <span class="as-eqtotal mono" id="as-eq-total" aria-live="polite"></span>
        </div>
        ${raw(countersHtml('as-eq', p.equipment))}
        <p class="field__hint">Best guess is fine — confirm on the site visit.</p>
      </fieldset>

      <fieldset class="as-fs">
        <legend class="eyebrow">Assessment</legend>
        <div class="form-row">
          <div class="field">
            <label for="as-f-date">Preferred date <span class="muted">(optional)</span></label>
            <input class="input" id="as-f-date" type="date" value="${pa.scheduledFor || ''}">
          </div>
          <div class="field">
            <label for="as-f-time">Preferred time</label>
            <input class="input" id="as-f-time" type="time" step="900" value="${pa.scheduledTime || ''}">
          </div>
        </div>
        <p class="field__hint">With a date it goes on the schedule; without one it waits in the queue as requested.</p>
        <div class="field">
          <label for="as-f-notes">Property notes and concerns</label>
          <textarea class="textarea" id="as-f-notes" placeholder="Break-ins at the back gate, Wi-Fi drops in the office upstairs, two-storey villa with concrete walls…">${p.notes || ''}</textarea>
        </div>
        <label class="check as-free" for="as-f-free"><input type="checkbox" id="as-f-free"${raw(pa.free === false ? '' : ' checked')}> Free assessment — no charge</label>
      </fieldset>

      <div class="modal__foot">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${raw(ui.icon('check'))}Add assessment</button>
      </div>
    </form>`;

    const m = ui.modal({ title: 'New free assessment', body, wide: true });
    const form = m.body.querySelector('#as-intake');
    const totalEl = form.querySelector('#as-eq-total');
    const updateTotal = () => { const n = util.equipTotal(readCounters(form, 'as-eq')); totalEl.textContent = plural(n, 'device'); totalEl.classList.toggle('is-zero', n === 0); };
    bindCounters(form, 'as-eq', updateTotal); updateTotal();

    form.querySelector('#as-f-services').addEventListener('click', e => {
      const b = e.target.closest('[data-service]'); if (!b) return;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-on', on);
      if (on) { services.add(b.dataset.service); setError(form, 'as-f-services', ''); } else services.delete(b.dataset.service);
    });
    form.querySelector('#as-f-name').addEventListener('input', () => setError(form, 'as-f-name', ''));
    form.querySelector('#as-f-email').addEventListener('input', () => setError(form, 'as-f-email', ''));

    form.addEventListener('submit', e => {
      e.preventDefault();
      const val = id => form.querySelector('#' + id).value.trim();
      const name = val('as-f-name'), email = val('as-f-email');
      const chosen = RS.SERVICES.filter(s => services.has(s));
      let firstBad = null;
      if (!name) { setError(form, 'as-f-name', 'Enter the client’s name.'); firstBad = firstBad || form.querySelector('#as-f-name'); }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(form, 'as-f-email', 'Check the email address — it looks incomplete.'); firstBad = firstBad || form.querySelector('#as-f-email'); }
      if (!chosen.length) { setError(form, 'as-f-services', 'Choose at least one service.'); firstBad = firstBad || form.querySelector('[data-service]'); }
      if (firstBad) { firstBad.focus(); return; }

      const today = util.todayStr();
      const date = val('as-f-date'), time = val('as-f-time');
      const c = store.addClient({
        stage: 'assessment', name, company: val('as-f-company'), phone: val('as-f-phone'), email,
        island: val('as-f-island'), address: val('as-f-address'), source: val('as-f-source'),
        services: chosen, equipment: readCounters(form, 'as-eq'), notes: val('as-f-notes'),
        assessment: { status: date ? 'scheduled' : 'requested', requestedAt: today, scheduledFor: date, scheduledTime: date ? time : '', free: form.querySelector('#as-f-free').checked },
        followUpOn: date || today,
      });
      store.addActivity(c.id, { type: 'note', text: 'Free assessment requested: ' + chosen.join(', ') + (date ? ' (scheduled for ' + util.fmtDate(date) + (time ? ' at ' + util.fmtTime(time) : '') + ')' : '') });
      m.close();
      ui.toast('Assessment added for ' + name);
    });
  }

  /* ---------- schedule modal ---------- */
  function openSchedule(id) {
    const c = store.getClient(id); if (!c) return;
    const a = c.assessment;
    const body = h`<form class="form" id="as-sched" novalidate>
      <p class="muted">${c.name}${c.address || c.island ? ' · ' : ''}${[c.address, c.island].filter(Boolean).join(', ')}</p>
      <div class="form-row">
        <div class="field">
          <label for="as-s-date">Assessment date</label>
          <input class="input" type="date" id="as-s-date" required aria-describedby="as-s-date-err" value="${a.scheduledFor || ''}">
          <p class="as-err" id="as-s-date-err" role="alert" hidden></p>
        </div>
        <div class="field">
          <label for="as-s-time">Time</label>
          <input class="input" type="time" id="as-s-time" step="900" value="${a.scheduledTime || ''}">
        </div>
      </div>
      <div class="modal__foot">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${raw(ui.icon('calendar'))}${a.status === 'scheduled' ? 'Reschedule' : 'Schedule assessment'}</button>
      </div>
    </form>`;
    const m = ui.modal({ title: a.status === 'scheduled' ? 'Reschedule assessment' : 'Schedule assessment', body });
    const form = m.body.querySelector('#as-sched');
    form.querySelector('#as-s-date').addEventListener('input', () => setError(form, 'as-s-date', ''));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const date = form.querySelector('#as-s-date').value, time = form.querySelector('#as-s-time').value;
      if (!date) { setError(form, 'as-s-date', 'Pick a date for the assessment.'); form.querySelector('#as-s-date').focus(); return; }
      m.close();
      store.updateClient(id, { assessment: { status: 'scheduled', scheduledFor: date, scheduledTime: time }, followUpOn: date });
      store.addActivity(id, { type: 'note', text: 'Free assessment scheduled for ' + util.fmtDate(date) + (time ? ' at ' + util.fmtTime(time) : '') });
      ui.toast('Assessment scheduled for ' + util.fmtShort(date));
    });
  }

  /* ---------- record results modal ---------- */
  function openResults(id) {
    const c = store.getClient(id); if (!c) return;
    const a = c.assessment;
    const est = a.estimate || c.quote || '';
    const body = h`<form class="form" id="as-res" novalidate>
      <p class="muted">${c.name} · ${c.services.join(', ') || 'No service listed'}</p>
      <div class="field">
        <label for="as-r-findings">Findings</label>
        <textarea class="textarea" id="as-r-findings" placeholder="What you saw on the property: blind spots, cabling, ISP setup, dead zones…">${a.findings || ''}</textarea>
      </div>
      <div class="field">
        <label for="as-r-recs">Recommendations</label>
        <textarea class="textarea" id="as-r-recs" placeholder="What you propose to install or fix.">${a.recommendations || ''}</textarea>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="as-r-estimate">Estimate (USD)</label>
          <div class="as-money"><span aria-hidden="true">$</span><input class="input mono" id="as-r-estimate" inputmode="decimal" placeholder="0" aria-describedby="as-r-estimate-err" value="${est}"></div>
          <p class="as-err" id="as-r-estimate-err" role="alert" hidden></p>
        </div>
      </div>
      <div class="field">
        <div class="as-eqhead"><span class="field__label">Equipment needed</span><span class="as-eqtotal mono" id="as-r-total" aria-live="polite"></span></div>
        ${raw(countersHtml('as-rr', c.equipment))}
      </div>
      <label class="check" for="as-r-visit"><input type="checkbox" id="as-r-visit"> Customer wants a site visit — move to Site visit and schedule it</label>
      <div class="modal__foot">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${raw(ui.icon('check'))}Save results</button>
      </div>
    </form>`;
    const m = ui.modal({ title: 'Assessment results', body, wide: true });
    const form = m.body.querySelector('#as-res');
    const totalEl = form.querySelector('#as-r-total');
    const upd = () => { totalEl.textContent = plural(util.equipTotal(readCounters(form, 'as-rr')), 'device'); };
    bindCounters(form, 'as-rr', upd); upd();
    const estInp = form.querySelector('#as-r-estimate');
    estInp.addEventListener('input', () => setError(form, 'as-r-estimate', ''));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const rawEst = estInp.value.trim();
      if (rawEst && !/\d/.test(rawEst)) { setError(form, 'as-r-estimate', 'Enter the estimate as a number, e.g. 2400.'); estInp.focus(); return; }
      const estimate = parseMoney(rawEst);
      const wantsVisit = form.querySelector('#as-r-visit').checked;
      const patch = {
        assessment: { status: 'completed', completedAt: util.todayStr(), findings: form.querySelector('#as-r-findings').value.trim(), recommendations: form.querySelector('#as-r-recs').value.trim(), estimate },
        quote: estimate, equipment: readCounters(form, 'as-rr'),
      };
      m.close();
      store.updateClient(id, patch);
      store.addActivity(id, { type: 'note', text: 'Free assessment completed' + (estimate ? ' — estimate ' + util.fmtMoney(estimate) : '') });
      ui.toast('Results saved for ' + c.name);
      if (wantsVisit) { store.moveStage(id, 'site_visit'); RS.scheduleVisit(id); }
    });
  }

  function bookVisit(id) { store.moveStage(id, 'site_visit'); RS.scheduleVisit(id); }

  /* ---------- view ---------- */
  function queueSort(list) {
    const rank = c => c.assessment.status === 'requested' ? 0 : c.assessment.status === 'scheduled' ? 1 : 2;
    return list.slice().sort((x, y) => {
      const r = rank(x) - rank(y); if (r) return r;
      if (rank(x) === 0) return (x.assessment.requestedAt || x.createdAt).localeCompare(y.assessment.requestedAt || y.createdAt);
      if (rank(x) === 1) return ((x.assessment.scheduledFor || '') + (x.assessment.scheduledTime || '')).localeCompare((y.assessment.scheduledFor || '') + (y.assessment.scheduledTime || ''));
      return (y.assessment.completedAt || '').localeCompare(x.assessment.completedAt || '');
    });
  }

  function cardHtml(c) {
    const a = c.assessment, today = util.todayStr();
    const waited = util.daysBetween(a.requestedAt || c.createdAt) || 0;
    let state, badges = '';
    if (a.status === 'requested') {
      state = waited > 3 ? 'late' : 'waiting';
      badges = waited > 3 ? h`<span class="badge badge--warn">${raw(ui.icon('clock'))}Waiting ${plural(waited, 'day')}</span>` : h`<span class="badge">Not scheduled</span>`;
    } else if (a.status === 'scheduled') {
      const past = a.scheduledFor && a.scheduledFor < today;
      state = past ? 'past' : 'scheduled';
      badges = past ? h`<span class="badge badge--bad">Date passed — record results or reschedule</span>`
        : a.scheduledFor === today ? h`<span class="badge badge--info">Today</span>` : h`<span class="badge badge--info">Scheduled ${util.relDays(a.scheduledFor)}</span>`;
    } else { state = 'done'; badges = h`<span class="badge badge--good">${raw(ui.icon('check'))}Results recorded</span>`; }
    if (a.free === false) badges += h`<span class="badge">Paid assessment</span>`;
    const loc = [c.address, c.island].filter(Boolean).join(', ');
    const actions = a.status === 'completed'
      ? h`<button type="button" class="btn btn--primary btn--sm" data-act="visit" data-id="${c.id}">${raw(ui.icon('visit'))}Book site visit</button>
          <button type="button" class="btn btn--sm" data-act="results" data-id="${c.id}">Edit results</button>`
      : h`<button type="button" class="btn btn--sm${raw(a.status === 'requested' ? ' btn--primary' : '')}" data-act="schedule" data-id="${c.id}">${raw(ui.icon('calendar'))}${a.status === 'scheduled' ? 'Reschedule' : 'Schedule'}</button>
          <button type="button" class="btn btn--sm${raw(a.status === 'scheduled' ? ' btn--primary' : '')}" data-act="results" data-id="${c.id}">${raw(ui.icon('note'))}Record results</button>`;
    return h`<article class="as-card as-card--${state}" aria-label="${c.name}">
      <div class="as-card__main">
        <div class="as-card__top">
          <h3 class="as-card__name">${c.name || 'Unnamed client'}</h3>
          ${raw(c.company ? h`<span class="as-card__co">${c.company}</span>` : '')}
          <span class="as-card__badges">${raw(badges)}</span>
        </div>
        <p class="as-card__loc">${raw(ui.icon('visit'))}<span>${loc || 'No address yet'}</span></p>
        <div class="as-card__svc">${raw(c.services.length ? c.services.map(s => h`<span class="as-svc">${s}</span>`).join('') : '<span class="muted">No service listed</span>')}</div>
        <div class="as-card__eq">${raw(ui.equipLine(c.equipment))}</div>
      </div>
      <dl class="as-card__dates">
        <div><dt>Requested</dt><dd class="mono">${util.fmtShort(a.requestedAt || c.createdAt)}</dd></div>
        <div><dt>${a.status === 'completed' ? 'Completed' : 'Scheduled'}</dt><dd class="mono">${a.status === 'completed' ? util.fmtShort(a.completedAt) : (whenText(a) || '—')}</dd></div>
        ${raw(a.status === 'completed' && a.estimate ? h`<div><dt>Estimate</dt><dd class="mono">${util.fmtMoney(a.estimate)}</dd></div>` : '')}
      </dl>
      <div class="as-card__actions">
        ${raw(actions)}
        <button type="button" class="btn btn--ghost btn--sm" data-act="open" data-id="${c.id}">Open${raw(ui.icon('arrow'))}</button>
      </div>
    </article>`;
  }

  function checklistHtml() {
    const groups = [
      ['Cameras', [
        ['Entry points and blind spots', 'Doors, gates, driveways, parking, back of the building, stairwells. Note where a face or plate needs to be readable.'],
        ['Lighting and night coverage', 'Check after-dark lighting, IR range, and glare from sun or water at each camera position.'],
        ['Storage and retention', 'How many days of recording they need, where the NVR will live, and whether off-site backup matters.'],
        ['Remote viewing', 'Who needs phone access, and whether the upload speed can carry the streams.'],
      ]],
      ['Network', [
        ['Existing cabling', 'Cat5e/Cat6 runs, conduit, and pathways between floors or buildings. Note anything damaged or undocumented.'],
        ['ISP and modem location', 'Provider, plan speed, and where the line enters the property; plan the rack or closet from there.'],
        ['Wi-Fi dead zones', 'Walk the property with a phone speed test; concrete walls, upstairs rooms, decks and pool areas.'],
      ]],
      ['Power and weather', [
        ['Power, UPS and surge protection', 'Outlets near equipment, UPS runtime, grounding, and surge protection for hurricane season and grid outages.'],
        ['Mounting and salt air', 'Mounting surfaces, weatherproof enclosures and corrosion-resistant hardware for exposed spots.'],
      ]],
    ];
    return h`<details class="card as-check" id="as-checklist"${raw(checklistOpen ? ' open' : '')}>
      <summary class="as-check__sum"><span class="card__title">Assessment checklist</span><span class="muted as-check__hint">What to look for on site</span></summary>
      <div class="as-check__body">
        ${raw(groups.map(([g, items]) => h`<section class="as-check__group"><h4 class="eyebrow">${g}</h4><ul>${raw(items.map(([t, d]) => h`<li><b>${t}</b><span>${d}</span></li>`).join(''))}</ul></section>`).join(''))}
      </div>
    </details>`;
  }

  function render(mount) {
    const all = store.clients();
    const queue = all.filter(c => c.stage === 'assessment');
    const requested = queue.filter(c => c.assessment.status === 'requested').length;
    const scheduled = queue.filter(c => c.assessment.status === 'scheduled').length;
    const doneAll = all.filter(c => c.assessment.status === 'completed');
    const doneMonth = doneAll.filter(c => thisMonth(c.assessment.completedAt)).length;
    const late = queue.filter(c => c.assessment.status === 'requested' && (util.daysBetween(c.assessment.requestedAt || c.createdAt) || 0) > 3).length;

    const stats = h`<div class="as-strip">
      <div class="as-stat as-stat--req"><span class="eyebrow">Requested</span><span class="as-stat__n">${requested}</span><span class="as-stat__sub">${late ? plural(late, 'waiting over 3 days', 'waiting over 3 days') : 'Not yet scheduled'}</span></div>
      <div class="as-stat as-stat--sch"><span class="eyebrow">Scheduled</span><span class="as-stat__n">${scheduled}</span><span class="as-stat__sub">On the calendar</span></div>
      <div class="as-stat as-stat--done"><span class="eyebrow">Completed this month</span><span class="as-stat__n">${doneMonth}</span><span class="as-stat__sub">${new Date().toLocaleDateString('en-US', { month: 'long' })}</span></div>
      <div class="as-strip__act"><button type="button" class="btn btn--primary" data-act="new">${raw(ui.icon('plus'))}New assessment</button></div>
    </div>`;

    const tabs = h`<div class="as-tabs" role="tablist" aria-label="Assessment lists">
      <button type="button" role="tab" id="as-tab-queue" aria-controls="as-panel" aria-selected="${tab === 'queue'}" tabindex="${tab === 'queue' ? 0 : -1}" data-tab="queue">Queue <span class="as-tabs__n mono">${queue.length}</span></button>
      <button type="button" role="tab" id="as-tab-completed" aria-controls="as-panel" aria-selected="${tab === 'completed'}" tabindex="${tab === 'completed' ? 0 : -1}" data-tab="completed">Completed assessments <span class="as-tabs__n mono">${doneAll.length}</span></button>
    </div>`;

    let panel;
    if (tab === 'queue') {
      panel = queue.length
        ? '<div class="as-list">' + queueSort(queue).map(cardHtml).join('') + '</div>'
        : ui.empty('No assessments waiting', 'New free assessment requests show up here, oldest first, until they are scheduled and completed.', '<button type="button" class="btn btn--primary" data-act="new">' + ui.icon('plus') + 'New assessment</button>');
    } else {
      const rows = doneAll.slice().sort((x, y) => (y.assessment.completedAt || '').localeCompare(x.assessment.completedAt || ''));
      panel = rows.length ? h`<div class="table-wrap"><table class="table as-table">
        <thead><tr><th scope="col">Client</th><th scope="col">Completed</th><th scope="col" class="num">Estimate</th><th scope="col">Stage now</th><th scope="col">Equipment</th></tr></thead>
        <tbody>${raw(rows.map(c => h`<tr data-open="${c.id}">
          <td><button type="button" class="as-link" data-act="open" data-id="${c.id}">${c.name || 'Unnamed client'}</button>${raw(c.services.length ? h`<span class="as-table__svc">${c.services.join(', ')}</span>` : '')}</td>
          <td class="mono">${util.fmtDate(c.assessment.completedAt)}</td>
          <td class="num">${c.assessment.estimate ? util.fmtMoney(c.assessment.estimate) : '—'}</td>
          <td>${raw(ui.stagePill(c.stage))}</td>
          <td>${raw(ui.equipLine(c.equipment))}</td>
        </tr>`).join(''))}</tbody></table></div>`
        : ui.empty('No completed assessments yet', 'Record results on a queued assessment and it will be listed here with its estimate.');
    }

    mount.innerHTML = stats + '<div class="as-layout"><div class="as-col">' + tabs + '<div id="as-panel" role="tabpanel" aria-labelledby="as-tab-' + tab + '">' + panel + '</div></div><aside class="as-side">' + checklistHtml() + '</aside></div>';

    mount.onclick = e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; render(mount); const nb = mount.querySelector('#as-tab-' + tab); if (nb) nb.focus(); return; }
      const b = e.target.closest('[data-act]');
      if (b) {
        const id = b.dataset.id;
        if (b.dataset.act === 'new') RS.newAssessment();
        else if (b.dataset.act === 'schedule') openSchedule(id);
        else if (b.dataset.act === 'results') openResults(id);
        else if (b.dataset.act === 'visit') bookVisit(id);
        else if (b.dataset.act === 'open') RS.openClient(id);
        return;
      }
      const row = e.target.closest('tr[data-open]'); if (row) RS.openClient(row.dataset.open);
    };
    mount.onkeydown = e => {
      const t = e.target.closest('[role="tab"]'); if (!t || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault(); tab = tab === 'queue' ? 'completed' : 'queue'; render(mount); mount.querySelector('#as-tab-' + tab).focus();
    };
    const det = mount.querySelector('#as-checklist');
    det.addEventListener('toggle', () => { checklistOpen = det.open; });
  }

  RS.newAssessment = newAssessment;
  RS.registerView({
    id: 'assessments', label: 'Free assessments', icon: 'assessment', order: 4, render,
    badge() { const n = store.clients().filter(c => c.stage === 'assessment' && c.assessment.status === 'requested').length; return n || ''; },
  });
})();
