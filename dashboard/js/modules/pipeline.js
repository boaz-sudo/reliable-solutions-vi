/* Client Desk — Pipeline (kanban board).
 * Moves clients Free assessment → Site visit → In progress → Completed.
 * Drag-and-drop between columns, plus a keyboard/touch "Move" menu and a next-step button per card.
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, ui, store } = RS;
  const { h, raw, esc } = util;

  /* ---------- module state (survives re-render) ---------- */
  const state = { q: '', services: new Set(), island: '', onlyDue: false, menuFor: null };
  let dragId = null;

  const GROUP_LABEL = { potential: 'Potential', current: 'Current', completed: 'Done' };
  const SERVICE_SHORT = {
    'Security Cameras': 'Cameras',
    'Network Installation': 'Network install',
    'Network Management': 'Network mgmt',
    'Maintenance & Support': 'Support',
  };
  const NEXT = {
    assessment: { label: 'Schedule visit', icon: 'calendar' },
    site_visit: { label: 'Start job', icon: 'arrow' },
    in_progress: { label: 'Mark complete', icon: 'check' },
    completed: { label: 'Request review', icon: 'reviews' },
  };

  const stageOf = id => RS.STAGES.find(s => s.id === id);
  const today = () => util.todayStr();
  const followDue = c => !!c.followUpOn && c.followUpOn <= today();
  const filtersActive = () => !!(state.q.trim() || state.services.size || state.island || state.onlyDue);

  function matches(c) {
    const q = state.q.trim().toLowerCase();
    if (q && ![c.name, c.company, c.address].some(v => String(v || '').toLowerCase().includes(q))) return false;
    if (state.services.size && !c.services.some(s => state.services.has(s))) return false;
    if (state.island && c.island !== state.island) return false;
    if (state.onlyDue && !followDue(c)) return false;
    return true;
  }

  function sortCards(stageId, list) {
    const pri = c => (c.priority === 'high' ? 0 : c.priority === 'low' ? 2 : 1);
    return list.slice().sort((a, b) => {
      if (stageId === 'completed') return String(b.job.completedAt || b.stageChangedAt).localeCompare(String(a.job.completedAt || a.stageChangedAt));
      return pri(a) - pri(b) || (followDue(b) - followDue(a)) || String(a.stageChangedAt).localeCompare(String(b.stageChangedAt));
    });
  }

  /* ---------- card pieces ---------- */
  function contextLine(c) {
    const longDay = v => util.fmtDate(v, { weekday: 'short', month: 'short', day: 'numeric' });
    switch (c.stage) {
      case 'assessment': {
        const a = c.assessment;
        if (a.scheduledFor) return h`<p class="pl-ctx">${raw(ui.icon('calendar'))}<span>Assessment <span class="mono">${longDay(a.scheduledFor)}</span></span></p>`;
        return h`<p class="pl-ctx">${raw(ui.icon('clock'))}<span>Requested ${util.relDays(a.requestedAt || c.createdAt)}</span></p>`;
      }
      case 'site_visit': {
        const v = c.siteVisit;
        if (v.status === 'completed') return h`<p class="pl-ctx">${raw(ui.icon('check'))}<span>Visit done <span class="mono">${util.fmtShort(v.completedAt || v.date)}</span></span></p>`;
        if (v.date && v.status !== 'cancelled') return h`<p class="pl-ctx">${raw(ui.icon('calendar'))}<span>Visit <span class="mono">${longDay(v.date)}${v.time ? ' · ' + util.fmtTime(v.time) : ''}</span></span></p>`;
        return h`<p class="pl-ctx"><span class="badge badge--warn">${v.status === 'cancelled' ? 'Visit cancelled' : 'Not scheduled'}</span></p>`;
      }
      case 'in_progress': {
        const p = Math.max(0, Math.min(100, Number(c.job.progress) || 0));
        return h`<div class="pl-progress">
          <div class="pl-progress__meta"><span>${c.job.startedAt ? 'Started ' + util.fmtShort(c.job.startedAt) : 'Job underway'}</span><span class="mono">${p}%</span></div>
          <div class="pl-progress__track" role="progressbar" aria-label="Job progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span class="pl-progress__bar" style="width:${p}%"></span></div>
        </div>`;
      }
      case 'completed': {
        const paid = !!c.job.paid;
        return h`<p class="pl-ctx">${raw(ui.icon('check'))}<span>Completed <span class="mono">${util.fmtShort(c.job.completedAt || c.stageChangedAt)}</span></span>
          <span class="badge ${paid ? 'badge--good' : 'badge--warn'}">${paid ? 'Paid' : 'Unpaid'}</span></p>`;
      }
    }
    return '';
  }

  function followBadge(c) {
    if (!followDue(c)) return '';
    const n = util.daysBetween(c.followUpOn);
    if (n <= 0) return '<span class="badge badge--warn">Follow up today</span>';
    return h`<span class="badge badge--bad">Follow-up overdue ${n}d</span>`;
  }

  function moveMenu(c) {
    const others = RS.STAGES.filter(s => s.id !== c.stage);
    return h`<div class="pl-menu" role="group" aria-label="Move ${c.name} to">
      <p class="pl-menu__label eyebrow">Move to</p>
      ${others.map(s => raw(h`<button type="button" class="pl-menu__item" id="pl-mv-${c.id}-${s.id}" data-act="move" data-id="${c.id}" data-stage="${s.id}" style="--pl-c: var(--st-${s.id})"><span class="pl-menu__dot" aria-hidden="true"></span>${s.label}</button>`))}
    </div>`;
  }

  function card(c) {
    const next = NEXT[c.stage];
    const sub = [c.company, c.address].filter(Boolean).join(' · ') || c.island;
    const open = state.menuFor === c.id;
    return h`<article class="pl-card${c.priority === 'high' ? ' is-high' : ''}" draggable="true" data-id="${c.id}" aria-label="${c.name}">
      <div class="pl-card__top">
        <button type="button" class="pl-card__name" id="pl-open-${c.id}" data-act="open" data-id="${c.id}">${c.name || 'Unnamed client'}</button>
        ${c.priority === 'high' ? raw('<span class="pl-flag" title="High priority">' + ui.icon('flag') + '<span class="visually-hidden">High priority</span></span>') : ''}
      </div>
      <p class="pl-card__sub muted">${sub}</p>
      ${c.services.length ? raw(h`<div class="pl-tags">${c.services.map(s => raw(h`<span class="pl-tag">${SERVICE_SHORT[s] || s}</span>`))}</div>`) : ''}
      <div class="pl-card__eq">${raw(ui.equipLine(c.equipment))}</div>
      ${raw(contextLine(c))}
      ${followDue(c) ? raw('<div class="pl-card__flags">' + followBadge(c) + '</div>') : ''}
      <div class="pl-card__actions">
        <button type="button" class="btn btn--sm pl-next" id="pl-next-${c.id}" data-act="next" data-id="${c.id}">${raw(ui.icon(next.icon))}${next.label}</button>
        ${c.quote ? raw(h`<span class="pl-card__quote mono">${util.fmtMoney(c.quote)}</span>`) : raw('<span class="toolbar__spacer"></span>')}
        <button type="button" class="icon-btn pl-movebtn" id="pl-mvbtn-${c.id}" data-act="menu" data-id="${c.id}" aria-expanded="${open ? 'true' : 'false'}" aria-label="Move ${c.name} to another stage">${raw(ui.icon('arrow'))}</button>
      </div>
      ${open ? raw(moveMenu(c)) : ''}
    </article>`;
  }

  function column(s, cards) {
    const sum = cards.reduce((t, c) => t + (Number(c.quote) || 0), 0);
    return h`<section class="pl-col" data-stage="${s.id}" style="--pl-c: var(--st-${s.id}); --pl-soft: var(--st-${s.id}-soft)" aria-labelledby="pl-h-${s.id}">
      <header class="pl-col__head">
        <div class="pl-col__title">
          <h2 id="pl-h-${s.id}" class="pl-col__name">${s.label}</h2>
          <span class="pl-col__count mono" aria-label="${cards.length} clients">${cards.length}</span>
        </div>
        <div class="pl-col__meta">
          <span class="pl-col__sum mono" title="Total quoted">${util.fmtMoney(sum)}</span>
          ${s.id === 'assessment' ? raw('<button type="button" class="icon-btn pl-add" id="pl-add" data-act="add" aria-label="Add free assessment">' + ui.icon('plus') + '</button>') : ''}
        </div>
      </header>
      <div class="pl-col__list">
        ${cards.length ? cards.map(c => raw(card(c))) : raw('<p class="pl-drop">Drop a client here</p>')}
      </div>
    </section>`;
  }

  /* ---------- render ---------- */
  function render(mount) {
    const all = store.clients();
    if (state.menuFor && !store.getClient(state.menuFor)) state.menuFor = null;
    const shown = all.filter(matches);
    const dueCount = all.filter(followDue).length;

    const groups = [];
    RS.STAGES.forEach((s, i) => {
      const last = groups[groups.length - 1];
      if (last && last.group === s.group) last.span++;
      else groups.push({ group: s.group, start: i + 1, span: 1 });
    });

    mount.innerHTML = h`
      <div class="pl-toolbar">
        <div class="toolbar">
          <div class="search">
            ${raw(ui.icon('search'))}
            <label for="pl-search" class="visually-hidden">Search clients</label>
            <input id="pl-search" class="input input--search" type="search" placeholder="Search name, company, address" value="${state.q}" autocomplete="off">
          </div>
          <div class="pl-island">
            <label for="pl-island" class="visually-hidden">Island</label>
            <select id="pl-island" class="select">
              <option value="">All islands</option>
              ${RS.ISLANDS.map(i => raw(h`<option value="${i}"${state.island === i ? raw(' selected') : ''}>${i}</option>`))}
            </select>
          </div>
          <label class="check pl-due" for="pl-due"><input id="pl-due" type="checkbox"${state.onlyDue ? raw(' checked') : ''}>Only my follow-ups due${dueCount ? raw(h` <span class="badge badge--warn mono">${dueCount}</span>`) : ''}</label>
        </div>
        <div class="toolbar pl-toolbar__row2">
          <div class="chips" role="group" aria-label="Filter by service">
            ${RS.SERVICES.map((s, i) => raw(h`<button type="button" class="chip" id="pl-svc-${i}" data-act="svc" data-svc="${s}" aria-pressed="${state.services.has(s) ? 'true' : 'false'}">${s}</button>`))}
          </div>
          <span class="toolbar__spacer"></span>
          ${filtersActive() ? raw(h`<span class="muted pl-showing">Showing <span class="mono">${shown.length}</span> of <span class="mono">${all.length}</span></span><button type="button" class="btn btn--ghost btn--sm" id="pl-clear" data-act="clear">Clear filters</button>`) : ''}
        </div>
      </div>
      <div class="pl-scroll">
        <div class="pl-board">
          ${groups.map(g => raw(h`<p class="pl-group eyebrow" style="grid-column: ${g.start} / span ${g.span}">${GROUP_LABEL[g.group] || g.group}</p>`))}
          ${RS.STAGES.map(s => raw(column(s, sortCards(s.id, shown.filter(c => c.stage === s.id)))))}
        </div>
      </div>`;

    bind(mount);
  }

  /* ---------- events (property handlers so re-render never stacks listeners) ---------- */
  function bind(mount) {
    const search = mount.querySelector('#pl-search');
    search.oninput = () => { state.q = search.value; RS.rerender(); };
    mount.querySelector('#pl-island').onchange = e => { state.island = e.target.value; RS.rerender(); };
    mount.querySelector('#pl-due').onchange = e => { state.onlyDue = e.target.checked; RS.rerender(); };

    mount.onclick = e => {
      const b = e.target.closest('[data-act]');
      if (b && mount.contains(b)) {
        const id = b.dataset.id;
        switch (b.dataset.act) {
          case 'open': RS.openClient(id); return;
          case 'add': RS.newAssessment(); return;
          case 'svc': { const s = b.dataset.svc; state.services.has(s) ? state.services.delete(s) : state.services.add(s); RS.rerender(); return; }
          case 'clear': state.q = ''; state.services.clear(); state.island = ''; state.onlyDue = false; RS.rerender(); return;
          case 'menu': state.menuFor = state.menuFor === id ? null : id; RS.rerender(); focusLater(state.menuFor ? '#pl-mv-' + id + '-' + firstOther(id) : '#pl-mvbtn-' + id); return;
          case 'move': state.menuFor = null; moveTo(id, b.dataset.stage); return;
          case 'next': nextStep(id); return;
        }
        return;
      }
      if (e.target.closest('a, button, input, select, label, .pl-menu')) return;
      const c = e.target.closest('.pl-card');
      if (c) RS.openClient(c.dataset.id);
    };

    mount.onkeydown = e => {
      if (e.key === 'Escape' && state.menuFor) { const id = state.menuFor; state.menuFor = null; RS.rerender(); focusLater('#pl-mvbtn-' + id); }
    };

    /* drag and drop */
    const clearOver = () => mount.querySelectorAll('.pl-col.is-over').forEach(el => el.classList.remove('is-over'));
    mount.ondragstart = e => {
      const c = e.target.closest && e.target.closest('.pl-card');
      if (!c) return;
      dragId = c.dataset.id;
      c.classList.add('is-dragging');
      mount.querySelector('.pl-board').classList.add('is-dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
    };
    mount.ondragover = e => {
      const col = e.target.closest && e.target.closest('.pl-col');
      if (!col || !dragId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      if (!col.classList.contains('is-over')) { clearOver(); col.classList.add('is-over'); }
    };
    mount.ondragleave = e => {
      const col = e.target.closest && e.target.closest('.pl-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('is-over');
    };
    mount.ondrop = e => {
      const col = e.target.closest && e.target.closest('.pl-col');
      if (!col) return;
      e.preventDefault();
      let id = dragId;
      try { id = e.dataTransfer.getData('text/plain') || id; } catch (_) {}
      clearOver(); dragId = null;
      if (id) moveTo(id, col.dataset.stage);
    };
    mount.ondragend = () => {
      dragId = null; clearOver();
      mount.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    };
  }

  function firstOther(id) { const c = store.getClient(id); return (RS.STAGES.find(s => !c || s.id !== c.stage) || {}).id; }
  function focusLater(sel) { setTimeout(() => { const el = document.querySelector('[data-view="pipeline"] ' + sel); if (el) el.focus(); }, 0); }

  /* ---------- actions ---------- */
  function nextStep(id) {
    const c = store.getClient(id); if (!c) return;
    if (c.stage === 'assessment') RS.scheduleVisit(id);
    else if (c.stage === 'site_visit') moveTo(id, 'in_progress');
    else if (c.stage === 'in_progress') moveTo(id, 'completed');
    else reviewPrompt(id, false);
  }

  async function moveTo(id, stage) {
    const c = store.getClient(id); if (!c || c.stage === stage) return;
    const to = stageOf(stage); if (!to) return;
    if (stage === 'completed') {
      const ok = await ui.confirm('Mark the job for ' + (c.name || 'this client') + ' as complete? This sets progress to 100% and stamps today as the completion date.', { okLabel: 'Mark complete', title: 'Complete this job?' });
      if (!ok) { focusLater('#pl-open-' + id); return; }
      store.moveStage(id, stage);
      ui.toast('Marked complete — ask for a review?');
      reviewPrompt(id, true);
      return;
    }
    store.moveStage(id, stage);
    ui.toast((c.name || 'Client') + ' moved to ' + to.label);
    focusLater('#pl-open-' + id);
  }

  function reviewPrompt(id, justCompleted) {
    const c = store.getClient(id); if (!c) return;
    const m = ui.modal({
      title: justCompleted ? 'Job complete' : 'Request a review',
      body: h`<p class="confirm-msg">${justCompleted ? 'Job complete. ' : ''}Request a review from ${c.name || 'this client'}? Logging the request adds a text to their activity so you remember to check back.</p>
        <div class="modal__foot">
          <button type="button" class="btn btn--ghost" data-pl="no">Not now</button>
          <button type="button" class="btn" data-pl="add">Add their review</button>
          <button type="button" class="btn btn--primary" data-pl="log">Log review request</button>
        </div>`,
    });
    m.body.addEventListener('click', e => {
      const b = e.target.closest('[data-pl]'); if (!b) return;
      const act = b.dataset.pl;
      m.close();
      if (act === 'log') { store.addActivity(id, { type: 'text', text: 'Asked for a review' }); ui.toast('Review request logged'); }
      else if (act === 'add') RS.addReview(id);
    });
  }

  RS.registerView({
    id: 'pipeline', label: 'Pipeline', icon: 'pipeline', order: 2,
    render,
    badge: () => { const n = store.clients().filter(c => c.stage === 'assessment' || c.stage === 'site_visit').length; return n || ''; },
  });
})();
