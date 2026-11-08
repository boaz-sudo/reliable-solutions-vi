/* Client Desk — client drawer + client form.
 * Implements cross-module hooks:
 *   RS.openClient(id)                 → side drawer with the full, live-updating client profile
 *   RS.editClient(id|null, initial)   → Promise<client|null>; wide modal with the full client form
 * Shared helpers (RS.ui):
 *   RS.ui.equipCounters(prefix, values) → HTML string for the four equipment steppers
 *   RS.ui.readEquipCounters(rootEl, prefix) → {cameras, accessPoints, switches, routers} (ints, 0..999)
 *   RS.ui.bindEquipCounters(rootEl)    → wires the −/+ buttons inside rootEl (safe to call twice)
 *
 * Counter markup (uses .counter-grid/.counter from app.css), for prefix "p":
 *   <div class="counter-grid" data-eq-prefix="p">
 *     <div class="counter">
 *       <label class="counter__label" for="p-cameras">[icon] Cameras</label>
 *       <div class="counter__ctl">
 *         <button type="button" data-eq-step="-1" data-eq-target="p-cameras" aria-label="Decrease cameras">−</button>
 *         <input class="input" type="number" id="p-cameras" name="cameras" min="0" max="999" step="1">
 *         <button type="button" data-eq-step="1" data-eq-target="p-cameras" aria-label="Increase cameras">+</button>
 *       </div>
 *     </div>
 *     … same for p-accessPoints, p-switches, p-routers
 *   </div>
 * Input ids are exactly `${prefix}-${equipmentKey}` with keys from RS.EQUIPMENT.
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, ui, store } = RS;
  const { h, raw, esc } = util;

  const EQ_ICON = { cameras: 'camera', accessPoints: 'wifi', switches: 'switch', routers: 'router' };
  const ACT_ICON = { call: 'phone', email: 'mail', text: 'message', meeting: 'calendar', note: 'note', stage: 'arrow' };
  const TABS = [
    { id: 'summary', label: 'Summary' },
    { id: 'assessment', label: 'Assessment' },
    { id: 'visit', label: 'Site visit' },
    { id: 'job', label: 'Job' },
    { id: 'activity', label: 'Activity' },
    { id: 'reviews', label: 'Reviews' },
  ];
  const AS_STATUS = { requested: ['Requested', 'info'], scheduled: ['Scheduled', 'warn'], completed: ['Completed', 'good'] };
  const SV_STATUS = { not_scheduled: ['Not scheduled', ''], scheduled: ['Scheduled', 'info'], completed: ['Completed', 'good'], cancelled: ['Cancelled', 'bad'] };
  const PRIO = { high: 'High priority', normal: 'Normal priority', low: 'Low priority' };

  let activeTab = 'summary';

  const clampInt = (v, lo, hi) => { const n = Math.round(Number(v)); return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); };
  const stageIdx = id => RS.STAGES.findIndex(s => s.id === id);
  const stageOf = id => RS.STAGES.find(s => s.id === id) || RS.STAGES[0];
  const badge = (pair) => '<span class="badge' + (pair[1] ? ' badge--' + pair[1] : '') + '">' + esc(pair[0]) + '</span>';
  const timeOf = iso => { const d = new Date(iso); if (isNaN(d)) return ''; return util.fmtTime(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')); };
  const humanize = k => String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

  /* =========================================================
   * Equipment counters (shared helper)
   * ======================================================= */
  ui.equipCounters = function (prefix, values) {
    values = values || {};
    return '<div class="counter-grid" data-eq-prefix="' + esc(prefix) + '">' + RS.EQUIPMENT.map(e => {
      const id = prefix + '-' + e.key, v = clampInt(values[e.key] || 0, 0, 999), lc = e.label.toLowerCase();
      return h`<div class="counter"><label class="counter__label" for="${id}">${raw(ui.icon(EQ_ICON[e.key]))}${e.label}</label><div class="counter__ctl"><button type="button" data-eq-step="-1" data-eq-target="${id}" aria-label="Decrease ${lc}">−</button><input class="input" type="number" id="${id}" name="${e.key}" min="0" max="999" step="1" inputmode="numeric" value="${v}"><button type="button" data-eq-step="1" data-eq-target="${id}" aria-label="Increase ${lc}">+</button></div></div>`;
    }).join('') + '</div>';
  };
  ui.readEquipCounters = function (rootEl, prefix) {
    const out = {};
    RS.EQUIPMENT.forEach(e => { const el = rootEl.querySelector('#' + CSS.escape(prefix + '-' + e.key)); out[e.key] = el ? clampInt(el.value || 0, 0, 999) : 0; });
    return out;
  };
  ui.bindEquipCounters = function (rootEl) {
    if (!rootEl || rootEl.dataset.eqBound) return;
    rootEl.dataset.eqBound = '1';
    rootEl.addEventListener('click', e => {
      const b = e.target.closest('[data-eq-step]'); if (!b || !rootEl.contains(b)) return;
      const input = rootEl.querySelector('#' + CSS.escape(b.dataset.eqTarget)); if (!input) return;
      input.value = clampInt((Number(input.value) || 0) + Number(b.dataset.eqStep), 0, 999);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    rootEl.addEventListener('change', e => {
      const t = e.target; if (!t.matches || !t.matches('.counter__ctl input')) return;
      const v = String(clampInt(t.value || 0, 0, 999)); if (t.value !== v) t.value = v;
    });
  };

  /* =========================================================
   * Drawer
   * ======================================================= */
  async function copyText(text, what) {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      ui.toast(what + ' copied');
    } catch (e) {
      ui.toast('Could not copy. Select the ' + what.toLowerCase() + ' and copy it manually.', 'warn');
    }
  }

  function contactItem(kind, icon, value, href) {
    if (!value) return h`<div class="cd-contact cd-contact--empty"><span class="cd-contact__ico">${raw(ui.icon(icon))}</span><span class="muted">No ${kind.toLowerCase()}</span></div>`;
    return h`<div class="cd-contact">${href ? raw(h`<a class="cd-contact__ico" href="${href}" aria-label="${kind === 'Phone' ? 'Call' : 'Email'} ${value}">${raw(ui.icon(icon))}</a>`) : raw(h`<span class="cd-contact__ico">${raw(ui.icon(icon))}</span>`)}<span class="cd-contact__val">${value}</span><button type="button" class="btn btn--ghost btn--sm cd-copy" data-copy="${value}" data-copy-what="${kind}" aria-label="Copy ${kind.toLowerCase()}">Copy</button></div>`;
  }

  function renderStepper(c) {
    const cur = stageIdx(c.stage);
    return '<ol class="cd-steps" aria-label="Pipeline stage">' + RS.STAGES.map((s, i) => {
      const state = i < cur ? 'done' : i === cur ? 'current' : 'upcoming';
      const stateLabel = state === 'done' ? 'done' : state === 'current' ? 'current stage' : 'upcoming';
      return h`<li class="cd-step cd-step--${state}" style="--cd-st: var(--st-${s.id}); --cd-st-soft: var(--st-${s.id}-soft)"><button type="button" class="cd-step__btn" data-stage="${s.id}" ${state === 'current' ? raw('aria-current="step"') : ''} aria-label="${s.label}, ${stateLabel}${state === 'current' ? '' : '. Move client here'}"><span class="cd-step__dot">${state === 'done' ? raw(ui.icon('check')) : String(i + 1)}</span><span class="cd-step__label">${s.short}</span></button></li>`;
    }).join('') + '</ol>';
  }

  function nextStepBtn(c) {
    const map = {
      assessment: ['visit', 'Schedule site visit', 'visit'],
      site_visit: ['start', 'Start job', 'arrow'],
      in_progress: ['complete', 'Mark complete', 'check'],
      completed: ['review', 'Add review', 'reviews'],
    };
    const [act, label, icon] = map[c.stage] || map.assessment;
    return h`<button type="button" class="btn btn--primary cd-next" data-act="next-${act}">${raw(ui.icon(icon))}${label}</button>`;
  }

  function tabSummary(c) {
    const score = clampInt(RS.engagementScore(c), 0, 100);
    const tone = score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad';
    const fu = c.followUpOn, fuDays = fu ? util.daysBetween(fu) : null;
    const fuNote = !fu ? '<span class="muted">No follow-up planned</span>' : fuDays > 0 ? '<span class="badge badge--bad">Overdue · ' + esc(util.relDays(fu)) + '</span>' : fuDays === 0 ? '<span class="badge badge--warn">Due today</span>' : '<span class="badge badge--info">' + esc(util.relDays(fu)) + '</span>';
    return h`
      <div class="cd-sec">
        <p class="eyebrow">Services requested</p>
        ${c.services.length ? raw('<div class="chips cd-services">' + c.services.map(s => h`<span class="chip is-on">${s}</span>`).join('') + '</div>') : raw('<p class="muted">No services selected</p>')}
      </div>
      <div class="cd-sec">
        <p class="eyebrow">Equipment</p>
        <div class="cd-eq">${raw(RS.EQUIPMENT.map(e => h`<div class="cd-eq__item${Number(c.equipment[e.key]) ? '' : ' is-zero'}">${raw(ui.icon(EQ_ICON[e.key]))}<span class="cd-eq__num">${Number(c.equipment[e.key]) || 0}</span><span class="cd-eq__label">${e.label}</span></div>`).join(''))}</div>
      </div>
      <dl class="cd-facts">
        <div><dt>Quote</dt><dd class="mono">${util.fmtMoney(c.quote)}</dd></div>
        <div><dt>Island</dt><dd>${c.island || '—'}</dd></div>
        <div><dt>Source</dt><dd>${c.source || '—'}</dd></div>
        <div><dt>Added</dt><dd class="mono">${util.fmtDate(c.createdAt)}</dd></div>
      </dl>
      <div class="cd-sec cd-fu">
        <div class="field"><label for="cd-followup">Next follow-up</label>
          <div class="cd-fu__row"><input class="input cd-fu__input" type="date" id="cd-followup" value="${fu || ''}">${fu ? raw('<button type="button" class="btn btn--ghost btn--sm" data-act="clear-followup">Clear</button>') : ''}</div>
        </div>
        <div class="cd-fu__note">${raw(fuNote)}</div>
      </div>
      <div class="cd-sec">
        <div class="cd-score__head"><p class="eyebrow">Engagement</p><span class="cd-score__num cd-tone--${tone}">${score}<span class="muted">/100</span></span></div>
        <div class="cd-meter" role="meter" aria-label="Engagement score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span class="cd-meter__fill cd-tone-bg--${tone}" style="width:${score}%"></span></div>
        <p class="field__hint">Last contact ${util.relDays(store.lastTouch(c))}</p>
      </div>
      <div class="cd-sec">
        <p class="eyebrow">Notes</p>
        ${c.notes ? raw(h`<p class="cd-prose">${c.notes}</p>`) : raw('<p class="muted">No notes yet</p>')}
      </div>`;
  }

  function tabAssessment(c) {
    const a = c.assessment;
    return h`
      <div class="cd-tabhead">${raw(badge(AS_STATUS[a.status] || [humanize(a.status || 'requested'), '']))}${a.free ? raw('<span class="badge">Free</span>') : ''}<span class="toolbar__spacer"></span><button type="button" class="btn btn--sm" data-act="edit">${raw(ui.icon('edit'))}Edit assessment</button></div>
      <dl class="cd-facts">
        <div><dt>Requested</dt><dd class="mono">${util.fmtDate(a.requestedAt)}</dd></div>
        <div><dt>Scheduled for</dt><dd class="mono">${util.fmtDate(a.scheduledFor)}</dd></div>
        <div><dt>Completed</dt><dd class="mono">${util.fmtDate(a.completedAt)}</dd></div>
        <div><dt>Estimate</dt><dd class="mono">${Number(a.estimate) ? util.fmtMoney(a.estimate) : '—'}</dd></div>
      </dl>
      <div class="cd-sec"><p class="eyebrow">Findings</p>${a.findings ? raw(h`<p class="cd-prose">${a.findings}</p>`) : raw('<p class="muted">No findings recorded</p>')}</div>
      <div class="cd-sec"><p class="eyebrow">Recommendations</p>${a.recommendations ? raw(h`<p class="cd-prose">${a.recommendations}</p>`) : raw('<p class="muted">No recommendations recorded</p>')}</div>`;
  }

  function checklistItems(cl) {
    if (!cl) return [];
    if (Array.isArray(cl)) return cl.map(x => typeof x === 'string' ? { label: x, done: true } : { label: x.label || x.text || x.id || '', done: !!(x.done || x.checked) });
    return Object.keys(cl).map(k => { const v = cl[k]; return (v && typeof v === 'object') ? { label: v.label || humanize(k), done: !!(v.done || v.checked) } : { label: humanize(k), done: !!v }; });
  }

  function tabVisit(c) {
    const v = c.siteVisit;
    const items = checklistItems(v.checklist);
    const doneN = items.filter(i => i.done).length;
    const rows = RS.EQUIPMENT.map(e => {
      const req = Number(c.equipment[e.key]) || 0, sur = Number(v.survey[e.key]) || 0, d = sur - req;
      const diff = d === 0 ? '<span class="muted">—</span>' : '<span class="cd-diff ' + (d > 0 ? 'cd-diff--up' : 'cd-diff--down') + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + '</span>';
      return h`<tr><th scope="row">${raw(ui.icon(EQ_ICON[e.key]))}${e.label}</th><td class="num">${req}</td><td class="num">${sur}</td><td class="num">${raw(diff)}</td></tr>`;
    }).join('');
    return h`
      <div class="cd-tabhead">${raw(badge(SV_STATUS[v.status] || [humanize(v.status || ''), '']))}<span class="toolbar__spacer"></span><button type="button" class="btn btn--sm" data-act="visit">${raw(ui.icon('calendar'))}Schedule / edit visit</button></div>
      <dl class="cd-facts">
        <div><dt>Date</dt><dd class="mono">${util.fmtDate(v.date)}</dd></div>
        <div><dt>Time</dt><dd class="mono">${v.time ? util.fmtTime(v.time) : '—'}</dd></div>
        <div><dt>Technician</dt><dd>${v.technician || '—'}</dd></div>
        <div><dt>Completed</dt><dd class="mono">${util.fmtDate(v.completedAt)}</dd></div>
      </dl>
      <div class="cd-sec">
        <p class="eyebrow">Checklist ${items.length ? raw('<span class="mono">' + doneN + '/' + items.length + '</span>') : ''}</p>
        ${items.length ? raw('<ul class="cd-checklist">' + items.map(i => h`<li class="${i.done ? 'is-done' : ''}"><span class="cd-checkbox" aria-hidden="true">${i.done ? raw(ui.icon('check')) : ''}</span><span>${i.label}</span><span class="visually-hidden">${i.done ? 'done' : 'not done'}</span></li>`).join('') + '</ul>') : raw('<p class="muted">No checklist items recorded</p>')}
      </div>
      <div class="cd-sec">
        <p class="eyebrow">Survey vs. requested</p>
        <div class="table-wrap"><table class="table cd-survey"><thead><tr><th scope="col">Equipment</th><th scope="col" class="num">Requested</th><th scope="col" class="num">Survey</th><th scope="col" class="num">Diff</th></tr></thead><tbody>${raw(rows)}</tbody></table></div>
      </div>
      <div class="cd-sec"><p class="eyebrow">Visit notes</p>${v.notes ? raw(h`<p class="cd-prose">${v.notes}</p>`) : raw('<p class="muted">No visit notes</p>')}</div>`;
  }

  function tabJob(c) {
    const j = c.job, p = clampInt(j.progress, 0, 100);
    return h`
      <div class="cd-sec">
        <div class="cd-score__head"><label class="eyebrow" for="cd-job-progress">Progress</label><output class="cd-score__num" id="cd-job-progress-out" for="cd-job-progress">${p}%</output></div>
        <input class="cd-range" type="range" id="cd-job-progress" min="0" max="100" step="5" value="${p}" style="--cd-p:${p}%">
      </div>
      <dl class="cd-facts">
        <div><dt>Started</dt><dd class="mono">${util.fmtDate(j.startedAt)}</dd></div>
        <div><dt>Completed</dt><dd class="mono">${util.fmtDate(j.completedAt)}</dd></div>
        <div><dt>Quote</dt><dd class="mono">${util.fmtMoney(c.quote)}</dd></div>
        <div><dt>Payment</dt><dd>${raw(j.paid ? '<span class="badge badge--good">Paid</span>' : Number(j.invoice) ? '<span class="badge badge--warn">Unpaid</span>' : '<span class="muted">Not invoiced</span>')}</dd></div>
      </dl>
      <div class="form-row cd-sec">
        <div class="field"><label for="cd-job-invoice">Invoice amount ($)</label><input class="input mono" type="number" id="cd-job-invoice" min="0" step="1" inputmode="decimal" value="${Number(j.invoice) || 0}"></div>
        <div class="field cd-paid"><span class="field__label">Payment</span><label class="check"><input type="checkbox" id="cd-job-paid" ${j.paid ? raw('checked') : ''}>Invoice paid</label></div>
      </div>`;
  }

  function tabActivity(c) {
    if (!c.activities.length) return ui.empty('No activity yet', 'Log a call, email, text or note to start this client\'s history.', '<button type="button" class="btn btn--sm" data-act="log" data-type="call">Log call</button>');
    return '<ol class="cd-timeline">' + c.activities.map(a => {
      const t = RS.ACTIVITY_TYPES.find(x => x.id === a.type) || { label: humanize(a.type || 'note') };
      return h`<li class="cd-tl cd-tl--${a.type}"><span class="cd-tl__ico">${raw(ui.icon(ACT_ICON[a.type] || 'note'))}</span><div class="cd-tl__main"><p class="cd-tl__meta"><b>${t.label}</b> <span class="mono">${util.fmtDate(a.at)} · ${timeOf(a.at)}</span></p><p class="cd-tl__text">${a.text || ''}</p></div><button type="button" class="icon-btn cd-tl__del" data-act="del-activity" data-id="${a.id}" aria-label="Delete ${t.label.toLowerCase()} from ${util.fmtDate(a.at)}">${raw(ui.icon('trash'))}</button></li>`;
    }).join('') + '</ol>';
  }

  function tabReviews(c) {
    const list = store.reviews().filter(r => r.clientId === c.id);
    const head = '<div class="cd-tabhead"><span class="muted">' + list.length + ' review' + (list.length === 1 ? '' : 's') + '</span><span class="toolbar__spacer"></span><button type="button" class="btn btn--sm" data-act="review">' + ui.icon('plus') + 'Add review</button></div>';
    if (!list.length) return head + ui.empty('No reviews yet', 'Ask for a review once the job is complete.');
    return head + '<ul class="cd-reviews">' + list.map(r => h`<li class="cd-review"><div class="cd-review__head">${raw(ui.stars(r.rating))}<span class="cd-review__by">${r.author || c.name}</span><span class="muted mono">${r.source} · ${util.fmtDate(r.at)}</span></div>${r.text ? raw(h`<p class="cd-prose">${r.text}</p>`) : ''}${r.reply ? raw(h`<p class="cd-review__reply"><span class="eyebrow">Reply</span> ${r.reply}</p>`) : ''}</li>`).join('') + '</ul>';
  }

  const TAB_RENDER = { summary: tabSummary, assessment: tabAssessment, visit: tabVisit, job: tabJob, activity: tabActivity, reviews: tabReviews };

  function renderDrawer(c) {
    const stage = stageOf(c.stage);
    const actCount = c.activities.length, revCount = store.reviews().filter(r => r.clientId === c.id).length;
    const counts = { activity: actCount, reviews: revCount };
    const prio = PRIO[c.priority] ? c.priority : 'normal';
    return h`
      <header class="cd-top" style="--cd-st: var(--st-${stage.id})">
        ${raw(ui.avatar(c.name).replace('class="avatar"', 'class="avatar cd-avatar"'))}
        <div class="cd-top__id">
          <h2 class="cd-name" id="cd-title">${c.name || 'Unnamed client'}</h2>
          <p class="cd-company">${c.company || 'No company'}</p>
          <div class="cd-top__tags">${raw(ui.stagePill(c.stage))}<span class="cd-prio cd-prio--${prio}">${raw(ui.icon('flag'))}${PRIO[prio]}</span></div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close client details">${raw(ui.icon('x'))}</button>
      </header>
      <div class="cd-contacts">
        ${raw(contactItem('Phone', 'phone', c.phone, c.phone ? 'tel:' + c.phone.replace(/[^\d+]/g, '') : ''))}
        ${raw(contactItem('Email', 'mail', c.email, c.email ? 'mailto:' + c.email : ''))}
        ${raw(contactItem('Address', 'visit', [c.address, c.island].filter(Boolean).join(', '), ''))}
      </div>
      <section class="cd-stage" aria-label="Stage">
        ${raw(renderStepper(c))}
        <div class="cd-stage__foot"><span class="muted">In ${stage.label.toLowerCase()} since <span class="mono">${util.fmtShort(c.stageChangedAt)}</span></span>${raw(nextStepBtn(c))}</div>
      </section>
      <div class="cd-actions" role="group" aria-label="Quick actions">
        <button type="button" class="btn btn--sm" data-act="log" data-type="call">${raw(ui.icon('phone'))}Log call</button>
        <button type="button" class="btn btn--sm" data-act="log" data-type="email">${raw(ui.icon('mail'))}Log email</button>
        <button type="button" class="btn btn--sm" data-act="log" data-type="text">${raw(ui.icon('message'))}Log text</button>
        <button type="button" class="btn btn--sm" data-act="log" data-type="note">${raw(ui.icon('note'))}Add note</button>
        <button type="button" class="btn btn--sm" data-act="edit">${raw(ui.icon('edit'))}Edit</button>
      </div>
      <div class="cd-tabs" role="tablist" aria-label="Client sections">
        ${raw(TABS.map(t => h`<button type="button" role="tab" class="cd-tab" id="cd-tab-${t.id}" aria-controls="cd-panel" aria-selected="${t.id === activeTab}" tabindex="${t.id === activeTab ? '0' : '-1'}" data-tab="${t.id}">${t.label}${counts[t.id] ? raw('<span class="cd-tab__n">' + counts[t.id] + '</span>') : ''}</button>`).join(''))}
      </div>
      <div class="cd-panel" id="cd-panel" role="tabpanel" aria-labelledby="cd-tab-${activeTab}">${raw((TAB_RENDER[activeTab] || tabSummary)(c))}</div>
      <footer class="cd-foot"><span class="muted">Updated <span class="mono">${util.fmtDate(c.updatedAt)}</span></span><button type="button" class="btn btn--danger btn--sm" data-act="delete">${raw(ui.icon('trash'))}Delete client</button></footer>`;
  }

  async function goStage(c, target) {
    if (c.stage === target) return;
    const to = stageOf(target);
    const backward = stageIdx(target) < stageIdx(c.stage);
    if (backward || target === 'completed') {
      const ok = await ui.confirm(backward ? 'Move ' + (c.name || 'this client') + ' back to ' + to.label + '? The stage change is logged in their activity.' : 'Mark ' + (c.name || 'this client') + ' as completed? Job progress is set to 100%.', { okLabel: backward ? 'Move back' : 'Mark complete', title: backward ? 'Move back a stage?' : 'Mark job complete?' });
      if (!ok) return;
    }
    store.moveStage(c.id, target);
    ui.toast('Moved to ' + to.label);
  }

  RS.openClient = function (id) {
    const c0 = store.getClient(id);
    if (!c0) { ui.toast('That client no longer exists', 'warn'); return; }
    let unsub = null;
    const d = ui.drawer({ title: c0.name || 'Client details', body: '', onClose: () => { if (unsub) unsub(); unsub = null; } });
    const body = d.body;
    const aside = d.el.querySelector('.drawer');
    aside.classList.add('cd-drawer');
    aside.removeAttribute('aria-label');
    aside.setAttribute('aria-labelledby', 'cd-title');

    function paint() {
      const c = store.getClient(id);
      if (!c) { d.close(); return; }
      const ae = document.activeElement;
      const focusId = ae && body.contains(ae) ? ae.id : null;
      const focusSel = !focusId && ae && body.contains(ae) && ae.dataset ? (ae.dataset.tab ? '[data-tab="' + ae.dataset.tab + '"]' : ae.dataset.stage ? '[data-stage="' + ae.dataset.stage + '"]' : ae.dataset.act ? '[data-act="' + ae.dataset.act + '"]' + (ae.dataset.type ? '[data-type="' + ae.dataset.type + '"]' : '') : null) : null;
      const st = aside.scrollTop;
      body.innerHTML = renderDrawer(c);
      aside.scrollTop = st;
      const f = focusId ? document.getElementById(focusId) : focusSel ? body.querySelector(focusSel) : null;
      if (f && f.focus) f.focus({ preventScroll: true });
    }

    body.onclick = async e => {
      const c = store.getClient(id); if (!c) return;
      const cp = e.target.closest('[data-copy]');
      if (cp) { copyText(cp.dataset.copy, cp.dataset.copyWhat); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { activeTab = tab.dataset.tab; paint(); const t = body.querySelector('[data-tab="' + activeTab + '"]'); if (t) t.focus(); return; }
      const step = e.target.closest('[data-stage]');
      if (step) { goStage(c, step.dataset.stage); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      switch (b.dataset.act) {
        case 'next-visit': RS.scheduleVisit(id); break;
        case 'next-start': goStage(c, 'in_progress'); break;
        case 'next-complete': goStage(c, 'completed'); break;
        case 'next-review': case 'review': RS.addReview(id); break;
        case 'visit': RS.scheduleVisit(id); break;
        case 'log': RS.logActivity(id, b.dataset.type); break;
        case 'edit': RS.editClient(id); break;
        case 'clear-followup': store.updateClient(id, { followUpOn: '' }); ui.toast('Follow-up cleared'); break;
        case 'del-activity': {
          const ok = await ui.confirm('Delete this activity entry? This cannot be undone.', { okLabel: 'Delete', danger: true, title: 'Delete activity?' });
          if (ok) { store.deleteActivity(id, b.dataset.id); ui.toast('Activity deleted'); }
          break;
        }
        case 'delete': {
          const ok = await ui.confirm('Delete ' + (c.name || 'this client') + ' and all of their activity and reviews? This cannot be undone.', { okLabel: 'Delete client', danger: true, title: 'Delete client?' });
          if (ok) { const name = c.name; store.deleteClient(id); ui.closeDrawer(); ui.toast((name || 'Client') + ' deleted'); }
          break;
        }
      }
    };
    body.onkeydown = e => {
      const tab = e.target.closest && e.target.closest('[role="tab"]');
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = TABS.findIndex(t => t.id === tab.dataset.tab);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      activeTab = TABS[n].id; paint();
      const t = body.querySelector('[data-tab="' + activeTab + '"]'); if (t) t.focus();
    };
    body.oninput = e => {
      if (e.target.id === 'cd-job-progress') {
        const out = body.querySelector('#cd-job-progress-out'); if (out) out.textContent = e.target.value + '%';
        e.target.style.setProperty('--cd-p', e.target.value + '%');
      }
    };
    body.onchange = e => {
      const t = e.target;
      if (t.id === 'cd-followup') { store.updateClient(id, { followUpOn: t.value || '' }); ui.toast(t.value ? 'Follow-up set' : 'Follow-up cleared'); }
      else if (t.id === 'cd-job-progress') { store.updateClient(id, { job: { progress: clampInt(t.value, 0, 100) } }); ui.toast('Progress saved'); }
      else if (t.id === 'cd-job-invoice') { const v = Math.max(0, Math.round(Number(t.value) || 0)); store.updateClient(id, { job: { invoice: v } }); ui.toast('Invoice set to ' + util.fmtMoney(v)); }
      else if (t.id === 'cd-job-paid') { store.updateClient(id, { job: { paid: t.checked } }); ui.toast(t.checked ? 'Marked paid' : 'Marked unpaid'); }
    };

    paint();
    unsub = store.subscribe(paint);
    const closeBtn = body.querySelector('[data-close]'); if (closeBtn) setTimeout(() => closeBtn.focus(), 30);
  };

  /* =========================================================
   * Client form (modal)
   * ======================================================= */
  function opts(list, sel) { return list.map(o => { const v = typeof o === 'string' ? o : o.id, l = typeof o === 'string' ? o : o.label; return h`<option value="${v}" ${v === sel ? raw('selected') : ''}>${l}</option>`; }).join(''); }
  const err = id => '<p class="cd-err" id="' + id + '-err" hidden></p>';

  RS.editClient = function (id, initial) {
    const existing = id ? store.getClient(id) : null;
    if (id && !existing) { ui.toast('That client no longer exists', 'warn'); return Promise.resolve(null); }
    const base = { name: '', company: '', phone: '', email: '', address: '', island: 'St. Thomas', source: 'Website form', services: [], stage: 'assessment', priority: 'normal', equipment: {}, quote: 0, followUpOn: '', notes: '', assessment: {} };
    const c = Object.assign({}, base, existing ? util.clone(existing) : {}, initial || {});
    c.equipment = Object.assign({ cameras: 0, accessPoints: 0, switches: 0, routers: 0 }, existing && existing.equipment, initial && initial.equipment);
    c.assessment = Object.assign({ status: 'requested', scheduledFor: '', findings: '', recommendations: '', estimate: 0 }, existing && existing.assessment, initial && initial.assessment);
    const services = new Set(Array.isArray(c.services) ? c.services : []);
    const islands = RS.ISLANDS.includes(c.island) || !c.island ? RS.ISLANDS : RS.ISLANDS.concat([c.island]);
    const sources = RS.SOURCES.includes(c.source) || !c.source ? RS.SOURCES : RS.SOURCES.concat([c.source]);

    const body = h`<form class="form cd-form" id="cd-form" novalidate>
      <div class="form-row">
        <div class="field"><label for="cd-f-name">Name <span class="cd-req" aria-hidden="true">*</span></label><input class="input" id="cd-f-name" name="name" autocomplete="off" required aria-describedby="cd-f-name-err" value="${c.name}">${raw(err('cd-f-name'))}</div>
        <div class="field"><label for="cd-f-company">Company</label><input class="input" id="cd-f-company" name="company" autocomplete="off" value="${c.company}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label for="cd-f-phone">Phone</label><input class="input" id="cd-f-phone" name="phone" type="tel" autocomplete="off" placeholder="(340) 555-0100" value="${c.phone}"></div>
        <div class="field"><label for="cd-f-email">Email</label><input class="input" id="cd-f-email" name="email" type="email" autocomplete="off" aria-describedby="cd-f-email-err" value="${c.email}">${raw(err('cd-f-email'))}</div>
      </div>
      <div class="form-row">
        <div class="field"><label for="cd-f-island">Island</label><select class="select" id="cd-f-island">${raw(opts(islands, c.island))}</select></div>
        <div class="field"><label for="cd-f-source">Source</label><select class="select" id="cd-f-source">${raw(opts(sources, c.source))}</select></div>
      </div>
      <div class="field"><label for="cd-f-address">Address</label><input class="input" id="cd-f-address" autocomplete="off" placeholder="Estate, street or building" value="${c.address}"></div>
      <div class="field" role="group" aria-labelledby="cd-f-services-label" aria-describedby="cd-f-services-err">
        <span class="field__label" id="cd-f-services-label">Services <span class="cd-req" aria-hidden="true">*</span></span>
        <div class="chips" id="cd-f-services">${raw(RS.SERVICES.map((s, i) => h`<button type="button" class="chip${services.has(s) ? ' is-on' : ''}" id="cd-f-svc-${i}" data-svc="${s}" aria-pressed="${services.has(s)}">${s}</button>`).join(''))}</div>
        ${raw(err('cd-f-services'))}
      </div>
      <div class="field"><span class="field__label">Equipment requested</span>${raw(ui.equipCounters('cd-f-eq', c.equipment))}</div>
      <div class="form-row">
        <div class="field"><label for="cd-f-stage">Stage</label><select class="select" id="cd-f-stage">${raw(opts(RS.STAGES, c.stage))}</select></div>
        <div class="field"><label for="cd-f-priority">Priority</label><select class="select" id="cd-f-priority">${raw(opts([{ id: 'low', label: 'Low' }, { id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }], c.priority))}</select></div>
        <div class="field"><label for="cd-f-quote">Quote ($)</label><input class="input mono" id="cd-f-quote" type="number" min="0" step="1" inputmode="decimal" aria-describedby="cd-f-quote-err" value="${Number(c.quote) || 0}">${raw(err('cd-f-quote'))}</div>
        <div class="field"><label for="cd-f-followup">Follow-up on</label><input class="input" id="cd-f-followup" type="date" value="${c.followUpOn || ''}"></div>
      </div>
      <div class="field"><label for="cd-f-notes">Notes</label><textarea class="textarea" id="cd-f-notes" rows="3">${c.notes}</textarea></div>
      <fieldset class="cd-fieldset">
        <legend>Assessment</legend>
        <div class="form-row">
          <div class="field"><label for="cd-f-as-status">Status</label><select class="select" id="cd-f-as-status">${raw(opts([{ id: 'requested', label: 'Requested' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'completed', label: 'Completed' }], c.assessment.status))}</select></div>
          <div class="field"><label for="cd-f-as-scheduled">Scheduled for</label><input class="input" id="cd-f-as-scheduled" type="date" value="${c.assessment.scheduledFor || ''}"></div>
          <div class="field"><label for="cd-f-as-estimate">Estimate ($)</label><input class="input mono" id="cd-f-as-estimate" type="number" min="0" step="1" inputmode="decimal" aria-describedby="cd-f-as-estimate-err" value="${Number(c.assessment.estimate) || 0}">${raw(err('cd-f-as-estimate'))}</div>
        </div>
        <div class="form-row">
          <div class="field"><label for="cd-f-as-findings">Findings</label><textarea class="textarea" id="cd-f-as-findings" rows="3">${c.assessment.findings}</textarea></div>
          <div class="field"><label for="cd-f-as-recs">Recommendations</label><textarea class="textarea" id="cd-f-as-recs" rows="3">${c.assessment.recommendations}</textarea></div>
        </div>
      </fieldset>
      <div class="modal__foot"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button type="submit" class="btn btn--primary">${raw(ui.icon('check'))}${existing ? 'Save client' : 'Add client'}</button></div>
    </form>`;

    return new Promise(resolve => {
      let done = false;
      const m = ui.modal({ title: existing ? 'Edit ' + (existing.name || 'client') : 'New client', body, wide: true, onClose: () => { if (!done) resolve(null); } });
      m.el.classList.add('cd-modal');
      const form = m.body.querySelector('#cd-form');
      const $ = sel => form.querySelector(sel);
      ui.bindEquipCounters(form);

      function setErr(fid, msg, inputSel) {
        const e = $('#' + fid + '-err'); if (!e) return;
        e.textContent = msg || ''; e.hidden = !msg;
        const inp = inputSel ? $(inputSel) : $('#' + fid);
        if (inp) { if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
      }

      form.addEventListener('click', e => {
        const chip = e.target.closest('[data-svc]'); if (!chip) return;
        const s = chip.dataset.svc;
        if (services.has(s)) services.delete(s); else services.add(s);
        chip.classList.toggle('is-on', services.has(s)); chip.setAttribute('aria-pressed', String(services.has(s)));
        if (services.size) setErr('cd-f-services', '', '#cd-f-services');
      });
      form.addEventListener('input', e => {
        const fid = e.target.id; if (fid && $('#' + fid + '-err') && !$('#' + fid + '-err').hidden) setErr(fid, '');
      });

      form.addEventListener('submit', e => {
        e.preventDefault();
        const val = sel => ($(sel).value || '').trim();
        const name = val('#cd-f-name'), email = val('#cd-f-email');
        const quoteRaw = val('#cd-f-quote'), estRaw = val('#cd-f-as-estimate');
        let firstBad = null;
        const fail = (fid, msg, focusSel) => { setErr(fid, msg, focusSel); if (!firstBad) firstBad = $(focusSel || '#' + fid); };
        ['cd-f-name', 'cd-f-email', 'cd-f-quote', 'cd-f-as-estimate'].forEach(f => setErr(f, ''));
        setErr('cd-f-services', '', '#cd-f-services');
        if (!name) fail('cd-f-name', 'Enter the client\'s name.');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('cd-f-email', 'Enter a valid email address, like name@example.com.');
        if (!services.size) fail('cd-f-services', 'Select at least one service.', '#cd-f-svc-0');
        if (quoteRaw && (isNaN(Number(quoteRaw)) || Number(quoteRaw) < 0)) fail('cd-f-quote', 'Quote must be zero or more.');
        if (estRaw && (isNaN(Number(estRaw)) || Number(estRaw) < 0)) fail('cd-f-as-estimate', 'Estimate must be zero or more.');
        if (firstBad) { firstBad.focus(); return; }

        const asStatus = val('#cd-f-as-status');
        const assessment = {
          status: asStatus, scheduledFor: val('#cd-f-as-scheduled'),
          findings: val('#cd-f-as-findings'), recommendations: val('#cd-f-as-recs'),
          estimate: Math.round(Number(estRaw) || 0),
        };
        if (asStatus === 'completed' && !c.assessment.completedAt) assessment.completedAt = util.todayStr();
        if (asStatus !== 'completed' && c.assessment.status === 'completed') assessment.completedAt = '';
        const data = {
          name, company: val('#cd-f-company'), phone: val('#cd-f-phone'), email,
          island: val('#cd-f-island'), source: val('#cd-f-source'), address: val('#cd-f-address'),
          services: RS.SERVICES.filter(s => services.has(s)).concat([...services].filter(s => !RS.SERVICES.includes(s))),
          equipment: ui.readEquipCounters(form, 'cd-f-eq'),
          priority: val('#cd-f-priority'), quote: Math.round(Number(quoteRaw) || 0),
          followUpOn: val('#cd-f-followup'), notes: val('#cd-f-notes'), assessment,
        };
        const stage = val('#cd-f-stage');
        let saved;
        if (existing) {
          saved = store.updateClient(existing.id, data);
          if (saved && stage !== saved.stage) saved = store.moveStage(existing.id, stage);
          ui.toast('Client saved');
        } else {
          const extra = Object.assign({}, initial || {});
          saved = store.addClient(Object.assign(extra, data, { stage, assessment: Object.assign({}, (initial && initial.assessment) || {}, assessment) }));
          ui.toast('Client added');
        }
        done = true;
        m.close();
        resolve(saved || null);
      });
    });
  };
})();
