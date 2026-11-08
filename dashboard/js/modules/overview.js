/* Overview — the morning home screen: KPIs, pipeline funnel, what needs attention, visits, equipment, lead trend. */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, ui, store } = RS;
  const h = util.h, raw = util.raw;

  const ATTN_CAP = 8;
  const QUIET_DAYS = 14;
  let resizeBound = false;

  /* ---------- helpers ---------- */
  function dateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function stageOf(id) { return RS.STAGES.find(s => s.id === id) || RS.STAGES[0]; }
  function sum(list, fn) { return list.reduce((s, x) => s + (Number(fn(x)) || 0), 0); }

  /* ---------- data ---------- */
  function computeKpis(clients, reviews) {
    const by = id => clients.filter(c => c.stage === id);
    const assess = by('assessment'), visits = by('site_visit'), active = by('in_progress'), done = by('completed');
    const open = clients.filter(c => c.stage !== 'completed');
    const recentDone = done.filter(c => { const d = util.daysBetween(c.job.completedAt || c.stageChangedAt); return d != null && d >= 0 && d <= 30; }).length;
    const rated = reviews.filter(r => Number(r.rating) > 0);
    const avg = rated.length ? sum(rated, r => r.rating) / rated.length : 0;
    return { assess: assess.length, visits: visits.length, active: active.length, done: done.length, recentDone, pipelineValue: sum(open, c => c.quote), avg, reviewCount: rated.length };
  }

  function attentionItems(clients, today, tomorrow) {
    const items = [];
    clients.forEach(c => {
      if (c.stage === 'completed') return;
      const reasons = [];
      if (c.followUpOn && c.followUpOn < today) {
        const n = util.daysBetween(c.followUpOn);
        reasons.push({ rank: 0, sub: -n, kind: 'bad', text: 'Follow-up overdue ' + plural(n, 'day') });
      } else if (c.followUpOn === today) {
        reasons.push({ rank: 2, sub: 0, kind: 'warn', text: 'Follow-up due today' });
      }
      const sv = c.siteVisit;
      if (sv.status === 'scheduled' && (sv.date === today || sv.date === tomorrow)) {
        reasons.push({ rank: sv.date === today ? 1 : 3, sub: sv.time || '99', kind: 'info', text: 'Visit ' + (sv.date === today ? 'today' : 'tomorrow') + (sv.time ? ' ' + util.fmtTime(sv.time) : '') });
      }
      if (c.stage === 'assessment' && c.assessment.status === 'requested') {
        const n = util.daysBetween(c.assessment.requestedAt) || 0;
        reasons.push({ rank: 4, sub: -n, kind: 'info', text: 'New request' + (n > 0 ? ' · ' + plural(n, 'day') : ' · today') });
      }
      const quiet = util.daysBetween(store.lastTouch(c));
      if (quiet != null && quiet >= QUIET_DAYS) {
        reasons.push({ rank: 5, sub: -quiet, kind: '', text: 'Quiet ' + quiet + ' days' });
      }
      if (!reasons.length) return;
      reasons.sort((a, b) => a.rank - b.rank || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0));
      items.push({ c, reasons, rank: reasons[0].rank, sub: reasons[0].sub });
    });
    items.sort((a, b) => a.rank - b.rank || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0));
    return items;
  }

  function weeklyLeads(clients) {
    const now = new Date();
    const monday = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -((now.getDay() + 6) % 7));
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = addDays(monday, -7 * i), end = addDays(start, 7);
      const count = clients.filter(c => { const d = util.toDate(c.createdAt); return d && d >= start && d < end; }).length;
      weeks.push({ start, count, current: i === 0 });
    }
    return weeks;
  }

  /* ---------- sections ---------- */
  function demoStrip() {
    if (!(store.meta() || {}).demo) return '';
    return h`<div class="ov-demo" role="note">
      ${raw(ui.icon('flag'))}
      <p class="ov-demo__text">You're looking at example clients. Clear them in Data when you're ready to start.</p>
      <a class="btn btn--sm" href="#data">Go to Data</a>
    </div>`;
  }

  function kpiRow(k) {
    const tile = (nav, label, value, sub, extraClass) => h`<button type="button" class="ov-kpi${extraClass ? ' ' + extraClass : ''}" data-nav="${nav}">
      <span class="eyebrow">${label}</span>
      <span class="ov-kpi__value">${raw(value)}</span>
      <span class="ov-kpi__sub">${raw(sub)}</span>
    </button>`;
    return '<section class="ov-kpis" aria-label="Key numbers">' +
      tile('pipeline', 'Potential clients', h`<span class="num">${k.assess + k.visits}</span>`, h`${plural(k.assess, 'assessment')} · ${plural(k.visits, 'site visit')}`) +
      tile('pipeline', 'Active jobs', h`<span class="num">${k.active}</span>`, h`<span class="num">${util.fmtMoney(k.pipelineValue)}</span> pipeline value`) +
      tile('pipeline', 'Completed', h`<span class="num">${k.done}</span>`, h`<span class="num">${k.recentDone}</span> in the last 30 days`) +
      tile('reviews', 'Average rating', k.reviewCount ? h`<span class="num">${k.avg.toFixed(1)}</span>${raw(ui.stars(k.avg))}` : '<span class="num">—</span>',
        k.reviewCount ? h`From ${plural(k.reviewCount, 'review')}` : 'No reviews yet') +
      '</section>';
  }

  function funnelCard(clients) {
    const total = clients.length;
    const stages = RS.STAGES.map(s => {
      const list = clients.filter(c => c.stage === s.id);
      return { s, count: list.length, value: sum(list, c => c.quote) };
    });
    const segs = stages.filter(x => x.count > 0).map(x => h`<button type="button" class="ov-funnel__seg" style="flex-grow:${x.count};background:var(--st-${x.s.id})"
        data-tip-title="${x.s.label}" data-tip-body="${plural(x.count, 'client')} · ${util.fmtMoney(x.value)} quoted"
        aria-label="${x.s.label}: ${plural(x.count, 'client')}, ${util.fmtMoney(x.value)} quoted" data-nav="pipeline"></button>`).join('');
    const legend = stages.map(x => h`<li class="ov-legend__item">
        <span class="ov-legend__name"><span class="ov-legend__dot" style="background:var(--st-${x.s.id})"></span>${x.s.label}</span>
        <span class="ov-legend__count num">${x.count}</span>
        <span class="ov-legend__money num">${util.fmtMoney(x.value)}</span>
      </li>`).join('');
    return h`<section class="card ov-funnel" aria-labelledby="ov-funnel-title">
      <div class="card__head">
        <h2 class="section-title" id="ov-funnel-title">Pipeline</h2>
        <span class="muted ov-head-meta"><span class="num">${total}</span> clients · <span class="num">${util.fmtMoney(sum(clients, c => c.quote))}</span> quoted</span>
      </div>
      <div class="ov-funnel__bar">${raw(segs)}</div>
      <ul class="ov-legend" aria-label="Clients and quoted value by stage">${raw(legend)}</ul>
      <p class="ov-legend__caption muted">Count of clients, then total quoted, per stage.</p>
    </section>`;
  }

  function attentionCard(items) {
    const rows = items.slice(0, ATTN_CAP).map(({ c, reasons }) => {
      const badges = reasons.slice(0, 2).map(r => h`<span class="badge${r.kind ? ' badge--' + r.kind : ''}">${r.text}</span>`).join('');
      const touch = util.relDays(store.lastTouch(c));
      const who = [c.company, c.island].filter(Boolean).join(' · ');
      return h`<li class="ov-attn__row ov-edge--${reasons[0].kind || 'none'}">
        ${raw(ui.avatar(c.name))}
        <div class="ov-attn__main">
          <div class="ov-attn__line">
            <button type="button" class="ov-attn__name" data-open="${c.id}">${c.name || 'Unnamed client'}</button>
            ${raw(ui.stagePill(c.stage))}
          </div>
          <div class="ov-attn__badges">${raw(badges)}</div>
          <p class="ov-attn__meta muted">${who ? who + ' · ' : ''}Last contact ${touch}</p>
        </div>
        <div class="ov-attn__acts">
          <button type="button" class="btn btn--sm" data-open="${c.id}">Open</button>
          <button type="button" class="btn btn--sm" data-call="${c.id}">${raw(ui.icon('phone'))}Log call</button>
        </div>
      </li>`;
    }).join('');
    const more = items.length > ATTN_CAP ? h`<span class="muted">Showing ${ATTN_CAP} of ${items.length}</span>` : '';
    return h`<section class="card ov-attn" aria-labelledby="ov-attn-title">
      <div class="card__head">
        <h2 class="section-title" id="ov-attn-title">Needs attention today <span class="ov-count num">${items.length}</span></h2>
        <a class="ov-link" href="#engagement">View all in Engagement ${raw(ui.icon('arrow'))}</a>
      </div>
      ${items.length ? raw('<ul class="ov-attn__list">' + rows + '</ul>') : raw('<p class="ov-calm">' + ui.icon('check') + '<span>Nothing is overdue, no visits today or tomorrow, and every client has been contacted in the last two weeks.</span></p>')}
      ${more ? raw('<div class="ov-attn__more">' + more + '</div>') : ''}
    </section>`;
  }

  function visitsCard(clients, today, tomorrow) {
    const list = clients.filter(c => c.siteVisit.status === 'scheduled' && c.siteVisit.date && c.siteVisit.date >= today)
      .sort((a, b) => (a.siteVisit.date + (a.siteVisit.time || '99')).localeCompare(b.siteVisit.date + (b.siteVisit.time || '99')))
      .slice(0, 5);
    const rows = list.map(c => {
      const sv = c.siteVisit;
      const when = sv.date === today ? 'Today' : sv.date === tomorrow ? 'Tomorrow' : util.fmtDate(sv.date, { weekday: 'short' });
      return h`<li><button type="button" class="ov-visit" data-open="${c.id}">
        <span class="ov-visit__date"><span class="num">${util.fmtShort(sv.date)}</span><span class="ov-visit__dow">${when}</span></span>
        <span class="ov-visit__main">
          <span class="ov-visit__name">${c.name || 'Unnamed client'}</span>
          <span class="ov-visit__meta muted">${sv.technician ? sv.technician : 'No technician assigned'}${c.island ? ' · ' + c.island : ''}</span>
        </span>
        <span class="ov-visit__time num">${sv.time ? util.fmtTime(sv.time) : 'No time'}</span>
      </button></li>`;
    }).join('');
    return h`<section class="card ov-visits" aria-labelledby="ov-visits-title">
      <div class="card__head">
        <h2 class="section-title" id="ov-visits-title">Upcoming site visits</h2>
        <a class="ov-link" href="#site-visits">All visits ${raw(ui.icon('arrow'))}</a>
      </div>
      ${list.length ? raw('<ul class="ov-visits__list">' + rows + '</ul>') : raw('<p class="ov-calm ov-calm--plain">' + ui.icon('calendar') + '<span>No site visits scheduled.</span></p>')}
    </section>`;
  }

  function equipmentCard(clients) {
    const potential = clients.filter(c => c.stage === 'assessment' || c.stage === 'site_visit');
    const active = clients.filter(c => c.stage === 'in_progress');
    const icons = { cameras: 'camera', accessPoints: 'wifi', switches: 'switch', routers: 'router' };
    const rows = RS.EQUIPMENT.map(e => {
      const p = sum(potential, c => c.equipment[e.key]), a = sum(active, c => c.equipment[e.key]);
      return { e, p, a, t: p + a };
    });
    const max = Math.max(1, ...rows.map(r => r.t));
    const items = rows.map(r => {
      const pw = (r.p / max) * 100, aw = (r.a / max) * 100;
      return h`<li class="ov-eq__item">
        <div class="ov-eq__top">
          <span class="ov-eq__icon">${raw(ui.icon(icons[r.e.key]))}</span>
          <span class="ov-eq__label">${r.e.label}</span>
          <span class="ov-eq__total num">${r.t}</span>
        </div>
        <div class="ov-eq__bar" role="img" aria-label="${r.e.label}: ${r.p} potential, ${r.a} in progress">
          ${r.p ? raw('<span class="ov-eq__seg ov-eq__seg--p" style="width:' + pw.toFixed(2) + '%"></span>') : ''}
          ${r.a ? raw('<span class="ov-eq__seg ov-eq__seg--a" style="width:' + aw.toFixed(2) + '%"></span>') : ''}
        </div>
        <div class="ov-eq__split muted"><span class="num">${r.p}</span> potential · <span class="num">${r.a}</span> in progress</div>
      </li>`;
    }).join('');
    return h`<section class="card ov-eq" aria-labelledby="ov-eq-title">
      <div class="card__head">
        <h2 class="section-title" id="ov-eq-title">Equipment in the pipeline</h2>
        <span class="ov-eq__key muted"><span class="ov-key ov-key--p"></span>Potential <span class="ov-key ov-key--a"></span>In progress</span>
      </div>
      <ul class="ov-eq__list">${raw(items)}</ul>
    </section>`;
  }

  function leadsCard(weeks) {
    const total = sum(weeks, w => w.count);
    const last = weeks[weeks.length - 1];
    const summary = weeks.map(w => 'week of ' + util.fmtShort(dateStr(w.start)) + ': ' + w.count).join(', ');
    return h`<section class="card ov-leads" aria-labelledby="ov-leads-title">
      <div class="card__head">
        <h2 class="section-title" id="ov-leads-title">New leads by week</h2>
        <span class="muted ov-head-meta"><span class="num">${total}</span> in 8 weeks · <span class="num">${last.count}</span> this week</span>
      </div>
      <div class="ov-spark" data-weeks="${JSON.stringify(weeks.map(w => [dateStr(w.start), w.count]))}" role="img" aria-label="New leads per week, last 8 weeks. ${summary}."></div>
    </section>`;
  }

  /* ---------- sparkline (drawn after layout so it is sized in real pixels) ---------- */
  function drawSpark(host) {
    const data = JSON.parse(host.dataset.weeks);
    const W = Math.max(240, Math.floor(host.clientWidth || 480)), H = 112;
    const padL = 26, padR = 30, padT = 12, padB = 22;
    const iw = W - padL - padR, ih = H - padT - padB;
    const maxV = Math.max(2, ...data.map(d => d[1]));
    const yMax = maxV % 2 ? maxV + 1 : maxV;
    const x = i => padL + (iw * i) / (data.length - 1);
    const y = v => padT + ih - (ih * v) / yMax;
    const pts = data.map((d, i) => [x(i), y(d[1])]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + y(0) + ' L' + pts[0][0].toFixed(1) + ' ' + y(0) + ' Z';
    const grid = [0, yMax / 2, yMax].map(v => '<line class="ov-spark__grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
      '<text class="ov-spark__axis" x="' + (padL - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + v + '</text>').join('');
    const end = pts[pts.length - 1];
    const hits = data.map((d, i) => {
      const w = iw / (data.length - 1);
      return '<rect class="ov-spark__hit" x="' + (x(i) - w / 2).toFixed(1) + '" y="0" width="' + w.toFixed(1) + '" height="' + H + '" data-i="' + i + '"/>';
    }).join('');
    host.innerHTML = '<svg class="ov-spark__svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      grid +
      '<path class="ov-spark__area" d="' + area + '"/>' +
      '<path class="ov-spark__line" d="' + line + '"/>' +
      '<circle class="ov-spark__hover" r="3.5" cx="0" cy="0" visibility="hidden"/>' +
      '<circle class="ov-spark__end-ring" cx="' + end[0] + '" cy="' + end[1] + '" r="6"/>' +
      '<circle class="ov-spark__end" cx="' + end[0] + '" cy="' + end[1] + '" r="3.5"/>' +
      '<text class="ov-spark__end-label" x="' + (end[0] + 9) + '" y="' + (end[1] + 4) + '">' + data[data.length - 1][1] + '</text>' +
      '<text class="ov-spark__axis" x="' + padL + '" y="' + (H - 5) + '" text-anchor="start">' + util.esc(util.fmtShort(data[0][0])) + '</text>' +
      '<text class="ov-spark__axis" x="' + (W - padR) + '" y="' + (H - 5) + '" text-anchor="end">This week</text>' +
      hits + '</svg>';
    const hover = host.querySelector('.ov-spark__hover');
    host.querySelectorAll('.ov-spark__hit').forEach(r => {
      const i = Number(r.dataset.i);
      r.addEventListener('mouseenter', () => {
        hover.setAttribute('cx', pts[i][0]); hover.setAttribute('cy', pts[i][1]); hover.setAttribute('visibility', 'visible');
        const d = data[i];
        showTip(host.closest('[data-view]'), r, i === data.length - 1 ? 'This week' : 'Week of ' + util.fmtShort(d[0]), plural(d[1], 'new lead'), pts[i][0] + host.getBoundingClientRect().left, pts[i][1] + host.getBoundingClientRect().top);
      });
      r.addEventListener('mouseleave', () => { hover.setAttribute('visibility', 'hidden'); hideTip(host.closest('[data-view]')); });
    });
  }

  /* ---------- tooltip ---------- */
  function showTip(mount, target, title, body, px, py) {
    const tip = mount && mount.querySelector('.ov-tip'); if (!tip) return;
    tip.innerHTML = h`<strong>${title}</strong><span>${body}</span>`;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const cx = px != null ? px : r.left + r.width / 2;
    const top = py != null ? py : r.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.min(window.innerWidth - tw - 8, Math.max(8, cx - tw / 2));
    let t = top - th - 10; if (t < 8) t = (py != null ? py : r.bottom) + 12;
    tip.style.left = left + 'px'; tip.style.top = t + 'px';
  }
  function hideTip(mount) { const tip = mount && mount.querySelector('.ov-tip'); if (tip) tip.hidden = true; }

  /* ---------- render ---------- */
  function render(mount) {
    const clients = store.clients();
    const reviews = store.reviews();

    mount.onclick = e => {
      const nav = e.target.closest('[data-nav]'); if (nav) { RS.navTo(nav.dataset.nav); return; }
      const call = e.target.closest('[data-call]'); if (call) { RS.logActivity(call.dataset.call, 'call'); return; }
      const open = e.target.closest('[data-open]'); if (open) { RS.openClient(open.dataset.open); return; }
      const add = e.target.closest('[data-ov-add]'); if (add) RS.newAssessment();
    };

    if (!clients.length) {
      mount.innerHTML = demoStrip() + '<div class="ov-empty">' + ui.empty('No clients yet', 'Add the first free-assessment request and this page will show your pipeline, follow-ups and upcoming site visits.',
        '<button type="button" class="btn btn--primary" data-ov-add>' + ui.icon('plus') + 'Add first assessment</button>') + '</div>';
      return;
    }

    const now = new Date();
    const today = util.todayStr();
    const tomorrow = dateStr(addDays(now, 1));
    const k = computeKpis(clients, reviews);
    const items = attentionItems(clients, today, tomorrow);

    mount.innerHTML =
      demoStrip() +
      kpiRow(k) +
      funnelCard(clients) +
      attentionCard(items) +
      '<div class="ov-pair">' + visitsCard(clients, today, tomorrow) + equipmentCard(clients) + '</div>' +
      leadsCard(weeklyLeads(clients)) +
      '<div class="ov-tip" role="tooltip" hidden></div>';

    mount.querySelectorAll('.ov-funnel__seg').forEach(seg => {
      const show = () => showTip(mount, seg, seg.dataset.tipTitle, seg.dataset.tipBody);
      const hide = () => hideTip(mount);
      seg.addEventListener('mouseenter', show); seg.addEventListener('focus', show);
      seg.addEventListener('mouseleave', hide); seg.addEventListener('blur', hide);
    });
    const spark = mount.querySelector('.ov-spark'); if (spark) drawSpark(spark);

    if (!resizeBound) {
      resizeBound = true;
      let lastW = window.innerWidth;
      window.addEventListener('resize', util.debounce(() => {
        if (window.innerWidth === lastW) return; lastW = window.innerWidth;
        const m = document.querySelector('[data-view="overview"] .ov-spark'); if (m) drawSpark(m);
      }, 150));
    }
  }

  RS.registerView({ id: 'overview', label: 'Overview', icon: 'overview', order: 1, render });
})();
