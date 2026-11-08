/* Client Desk — Engagement module.
 * View 'engagement': follow-up board, going-quiet list, engagement scores, activity feed, weekly touches chart.
 * Implements hooks RS.engagementScore(client) and RS.logActivity(clientId, type).
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { util, store, ui } = RS;
  const { h, raw, esc } = util;

  const TOUCH_TYPES = RS.ACTIVITY_TYPES.filter(t => t.id !== 'stage'); // call, email, text, meeting, note
  const TYPE_ICON = { call: 'phone', email: 'mail', text: 'message', meeting: 'calendar', note: 'note', stage: 'arrow' };
  const typeLabel = id => (RS.ACTIVITY_TYPES.find(t => t.id === id) || { label: id }).label;
  const stageGroup = id => (RS.STAGES.find(s => s.id === id) || {}).group;

  /* ---------- transient UI state ---------- */
  let feedFilter = 'all';
  let scoreSort = 'desc'; // 'desc' | 'asc'
  let snoozeOpen = null;  // client id whose snooze menu is open
  let mountRef = null;

  /* ---------- date helpers ---------- */
  function addDays(dateStr, n) {
    const d = util.toDate(dateStr) || new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function nowTime() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function timeAgo(iso) {
    const d = util.toDate(iso); if (!d) return '—';
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24 && util.daysBetween(iso) === 0) return hrs + ' hr ago';
    return util.relDays(iso);
  }

  /* ---------- engagement score ---------- */
  const SCORE = { recencyMax: 50, recencyDays: 30, perTouch: 6, freqMax: 30, perTwoWay: 5, twoWayMax: 20, windowDays: 30 };
  function recentTouches(c) {
    return (c.activities || []).filter(a => a.type !== 'stage' && (() => { const d = util.daysBetween(a.at); return d !== null && d >= 0 && d < SCORE.windowDays; })());
  }
  function scoreParts(c) {
    const days = Math.max(0, util.daysBetween(store.lastTouch(c)) ?? SCORE.recencyDays);
    const recFrac = Math.max(0, 1 - days / SCORE.recencyDays);
    const touches = recentTouches(c);
    const twoWay = touches.filter(a => a.type === 'call' || a.type === 'meeting').length;
    if (c.stage === 'completed') {
      return { days, touches: touches.length, twoWay, recency: Math.round(recFrac * 100), frequency: 0, twoWayPts: 0, completed: true };
    }
    return {
      days, touches: touches.length, twoWay,
      recency: Math.round(recFrac * SCORE.recencyMax),
      frequency: Math.min(SCORE.freqMax, touches.length * SCORE.perTouch),
      twoWayPts: Math.min(SCORE.twoWayMax, twoWay * SCORE.perTwoWay),
      completed: false,
    };
  }
  function engagementScore(c) {
    if (!c) return 0;
    const p = scoreParts(c);
    const total = p.recency + p.frequency + p.twoWayPts;
    return Math.max(0, Math.min(100, Math.round(total)));
  }
  function scoreTone(s) { return s >= 60 ? 'good' : s >= 30 ? 'warn' : 'bad'; }

  /* ---------- log activity modal ---------- */
  function logActivity(clientId, type) {
    const clients = store.clients().slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!clients.length) { ui.toast('Add a client before logging activity', 'warn'); return; }
    let selType = TOUCH_TYPES.some(t => t.id === type) ? type : 'call';
    const today = util.todayStr();
    const futureFollow = id => { const c = store.getClient(id); return c && c.followUpOn && c.followUpOn > today ? c.followUpOn : ''; };
    const preId = clientId && store.getClient(clientId) ? clientId : '';

    const body = h`<form class="form en-log" novalidate>
      <div class="field">
        <label for="en-log-client">Client <span aria-hidden="true">*</span></label>
        <select class="select" id="en-log-client" required>
          <option value="">Choose a client…</option>
          ${clients.map(c => raw(h`<option value="${c.id}"${raw(c.id === preId ? ' selected' : '')}>${c.name}${c.company ? ' — ' + c.company : ''}</option>`))}
        </select>
      </div>
      <div class="field">
        <span class="field__label" id="en-log-type-l">Type</span>
        <div class="en-seg" role="group" aria-labelledby="en-log-type-l">
          ${TOUCH_TYPES.map(t => raw(h`<button type="button" class="en-seg__btn" data-type="${t.id}" aria-pressed="${t.id === selType ? 'true' : 'false'}">${raw(ui.icon(TYPE_ICON[t.id]))}<span>${t.label}</span></button>`))}
        </div>
      </div>
      <div class="form-row">
        <div class="field"><label for="en-log-date">Date</label><input class="input" type="date" id="en-log-date" value="${today}" required></div>
        <div class="field"><label for="en-log-time">Time</label><input class="input" type="time" id="en-log-time" value="${nowTime()}" required></div>
      </div>
      <div class="field">
        <label for="en-log-text">What happened <span aria-hidden="true">*</span></label>
        <textarea class="textarea" id="en-log-text" required placeholder="Called about camera placement; sending a revised quote Friday."></textarea>
      </div>
      <div class="field">
        <label for="en-log-follow">Next follow-up <span class="muted">(optional)</span></label>
        <div class="en-follow">
          <input class="input en-follow__date" type="date" id="en-log-follow" value="${futureFollow(preId)}">
          <div class="chips" role="group" aria-label="Quick follow-up dates">
            <button type="button" class="chip" data-follow="1">Tomorrow</button>
            <button type="button" class="chip" data-follow="3">In 3 days</button>
            <button type="button" class="chip" data-follow="7">Next week</button>
            <button type="button" class="chip" data-follow="">None</button>
          </div>
        </div>
        <span class="field__hint">Leave empty to clear the client's follow-up date.</span>
      </div>
      <p class="en-log__err" id="en-log-err" role="alert" hidden></p>
      <div class="modal__foot">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">${raw(ui.icon('check'))}Save activity</button>
      </div>
    </form>`;

    const m = ui.modal({ title: 'Log activity', body });
    const form = m.body.querySelector('form');
    const $ = sel => m.body.querySelector(sel);
    const selClient = $('#en-log-client'), followIn = $('#en-log-follow'), err = $('#en-log-err');
    if (preId) setTimeout(() => $('#en-log-text').focus(), 40);

    function syncFollowChips() {
      m.body.querySelectorAll('[data-follow]').forEach(b => {
        const v = b.dataset.follow === '' ? '' : addDays(today, Number(b.dataset.follow));
        b.setAttribute('aria-pressed', String(followIn.value === v));
      });
    }
    syncFollowChips();
    selClient.addEventListener('change', () => { followIn.value = futureFollow(selClient.value); syncFollowChips(); });
    followIn.addEventListener('input', syncFollowChips);
    m.body.addEventListener('click', e => {
      const tb = e.target.closest('[data-type]');
      if (tb) { selType = tb.dataset.type; m.body.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', String(b === tb))); return; }
      const fb = e.target.closest('[data-follow]');
      if (fb) { followIn.value = fb.dataset.follow === '' ? '' : addDays(today, Number(fb.dataset.follow)); syncFollowChips(); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const id = selClient.value, text = $('#en-log-text').value.trim();
      const date = $('#en-log-date').value || today, time = $('#en-log-time').value || nowTime();
      const problems = [];
      if (!id) problems.push('choose a client');
      if (!text) problems.push('describe what happened');
      if (problems.length) {
        err.textContent = 'To save, ' + problems.join(' and ') + '.'; err.hidden = false;
        (id ? $('#en-log-text') : selClient).focus(); return;
      }
      const at = new Date(date + 'T' + time).toISOString();
      const c = store.getClient(id);
      const follow = followIn.value || '';
      m.close();
      store.addActivity(id, { type: selType, at, text });
      if (c && (c.followUpOn || '') !== follow) store.updateClient(id, { followUpOn: follow });
      ui.toast(typeLabel(selType) + ' logged with ' + (c ? c.name : 'client'));
    });
  }

  /* ---------- view sections ---------- */
  function lastActivity(c) { return (c.activities || [])[0] || null; }

  function boardRow(c, today) {
    const a = lastActivity(c);
    const overdue = c.followUpOn < today;
    const open = snoozeOpen === c.id;
    return h`<li class="en-fu" data-id="${c.id}">
      <div class="en-fu__top">
        <button type="button" class="en-link en-fu__name" data-open="${c.id}">${c.name}</button>
        ${raw(ui.stagePill(c.stage))}
      </div>
      <p class="en-fu__last">${a ? raw(h`<span class="en-fu__type">${typeLabel(a.type)}:</span> ${a.text || '—'} <span class="muted">· ${util.relDays(a.at)}</span>`) : raw('<span class="muted">No activity yet</span>')}</p>
      <div class="en-fu__foot">
        <span class="en-fu__date mono${overdue ? ' is-overdue' : ''}">${raw(ui.icon('flag'))}${util.fmtShort(c.followUpOn)}${overdue ? ' · ' + util.relDays(c.followUpOn) : ''}</span>
        <div class="en-fu__acts">
          <button type="button" class="btn btn--sm" data-call="${c.id}">${raw(ui.icon('phone'))}Call</button>
          <div class="en-snooze">
            <button type="button" class="btn btn--sm" data-snooze-toggle="${c.id}" aria-expanded="${open ? 'true' : 'false'}" aria-haspopup="true" id="en-snz-${c.id}">${raw(ui.icon('clock'))}Snooze</button>
            ${open ? raw(h`<div class="en-snooze__menu" role="menu" aria-labelledby="en-snz-${c.id}">
              <button type="button" role="menuitem" data-snooze="${c.id}" data-days="1">+1 day</button>
              <button type="button" role="menuitem" data-snooze="${c.id}" data-days="3">+3 days</button>
              <button type="button" role="menuitem" data-snooze="${c.id}" data-days="7">+7 days</button>
            </div>`) : ''}
          </div>
          <button type="button" class="btn btn--sm btn--ghost" data-done="${c.id}">${raw(ui.icon('check'))}Done</button>
        </div>
      </div>
    </li>`;
  }

  function renderBoard(active, today) {
    const in7 = addDays(today, 7);
    const withFu = active.filter(c => c.followUpOn).sort((a, b) => a.followUpOn < b.followUpOn ? -1 : a.followUpOn > b.followUpOn ? 1 : a.name.localeCompare(b.name));
    const cols = [
      { id: 'overdue', title: 'Overdue', tone: 'bad', items: withFu.filter(c => c.followUpOn < today), empty: 'Nothing overdue.' },
      { id: 'today', title: 'Today', tone: 'warn', items: withFu.filter(c => c.followUpOn === today), empty: 'No follow-ups due today.' },
      { id: 'week', title: 'Next 7 days', tone: 'info', items: withFu.filter(c => c.followUpOn > today && c.followUpOn <= in7), empty: 'Nothing scheduled this week.' },
    ];
    return h`<section class="card en-board" aria-labelledby="en-board-t">
      <div class="card__head"><h2 class="section-title" id="en-board-t">Follow-ups</h2>
        <button type="button" class="btn btn--primary btn--sm" data-log="">${raw(ui.icon('plus'))}Log activity</button></div>
      <div class="en-board__cols">
        ${cols.map(col => raw(h`<div class="en-col en-col--${col.id}">
          <h3 class="en-col__head"><span>${col.title}</span><span class="badge badge--${col.tone} mono">${col.items.length}</span></h3>
          ${col.items.length ? raw('<ul class="en-col__list">' + col.items.map(c => boardRow(c, today)).join('') + '</ul>') : raw(h`<p class="en-col__empty muted">${col.empty}</p>`)}
        </div>`))}
      </div>
    </section>`;
  }

  function renderQuiet(clients) {
    const quiet = clients.filter(c => stageGroup(c.stage) === 'potential' || stageGroup(c.stage) === 'current')
      .map(c => ({ c, d: util.daysBetween(store.lastTouch(c)) }))
      .filter(x => x.d !== null && x.d >= 14)
      .sort((a, b) => b.d - a.d);
    return h`<section class="card en-quiet" aria-labelledby="en-quiet-t">
      <div class="card__head"><h2 class="section-title" id="en-quiet-t">Going quiet</h2><span class="muted en-sub">Potential and current clients with no touch in 14+ days</span></div>
      ${quiet.length ? raw('<ul class="en-quiet__list">' + quiet.map(({ c, d }) => h`<li class="en-quiet__row">
          <span class="badge badge--${d >= 30 ? 'bad' : 'warn'} mono en-quiet__days">${d}d</span>
          <button type="button" class="en-link en-quiet__name" data-open="${c.id}">${c.name}</button>
          ${raw(ui.stagePill(c.stage))}
          <span class="muted en-quiet__when">Last touch ${util.fmtShort(store.lastTouch(c))}</span>
          <button type="button" class="btn btn--sm" data-call="${c.id}">${raw(ui.icon('phone'))}Call</button>
        </li>`).join('') + '</ul>') : raw(ui.empty('Everyone is in touch', 'Every potential and current client has been contacted in the last two weeks.'))}
    </section>`;
  }

  function renderScores(active) {
    const rows = active.map(c => ({ c, s: engagementScore(c), p: scoreParts(c) }))
      .sort((a, b) => (scoreSort === 'desc' ? b.s - a.s : a.s - b.s) || a.c.name.localeCompare(b.c.name));
    const ariaSort = scoreSort === 'desc' ? 'descending' : 'ascending';
    return h`<section class="card en-scores" aria-labelledby="en-scores-t">
      <div class="card__head"><h2 class="section-title" id="en-scores-t">Engagement scores</h2><span class="muted en-sub">${active.length} open clients</span></div>
      <details class="en-how">
        <summary>How the score works</summary>
        <div class="en-how__body">
          <p>Each open client gets a score from 0 to 100, made of three parts:</p>
          <ul>
            <li><b>Recency, up to 50 points.</b> A touch today earns 50. It drops evenly to 0 at 30 days since the last touch.</li>
            <li><b>Frequency, up to 30 points.</b> 6 points for each call, email, text, meeting or note in the last 30 days. Stage changes do not count.</li>
            <li><b>Two-way contact, up to 20 points.</b> 5 extra points for each call or meeting in the last 30 days.</li>
          </ul>
          <p>Completed clients are scored on recency alone, scaled to 100. Scores of 60 and up read as healthy, 30 to 59 as cooling, under 30 as cold.</p>
        </div>
      </details>
      ${rows.length ? raw(h`<div class="table-wrap"><table class="table en-table">
        <thead><tr>
          <th scope="col">Client</th>
          <th scope="col" aria-sort="${ariaSort}"><button type="button" class="en-sort" data-sort>Score <span aria-hidden="true">${scoreSort === 'desc' ? '↓' : '↑'}</span><span class="visually-hidden">, sorted ${ariaSort}. Activate to reverse.</span></button></th>
          <th scope="col">Last touch</th>
          <th scope="col" class="num">Touches (30d)</th>
          <th scope="col">Stage</th>
        </tr></thead>
        <tbody>${rows.map(({ c, s, p }) => raw(h`<tr data-row="${c.id}">
          <td><button type="button" class="en-link" data-open="${c.id}">${c.name}</button>${c.company ? raw(h`<span class="en-table__co muted">${c.company}</span>`) : ''}</td>
          <td><span class="en-meter en-meter--${scoreTone(s)}" title="Recency ${p.recency} + frequency ${p.frequency} + two-way ${p.twoWayPts}">
            <span class="en-meter__bar" role="img" aria-label="Score ${s} of 100"><span class="en-meter__fill" style="width:${s}%"></span></span>
            <span class="en-meter__num mono">${s}</span></span></td>
          <td class="en-nowrap"><span class="mono">${util.fmtShort(store.lastTouch(c))}</span> <span class="muted">${util.relDays(store.lastTouch(c))}</span></td>
          <td class="num">${p.touches}</td>
          <td>${raw(ui.stagePill(c.stage))}</td>
        </tr>`))}</tbody></table></div>`) : raw(ui.empty('No open clients', 'Scores appear here for clients who are not completed yet.'))}
    </section>`;
  }

  function renderFeed(clients) {
    let all = [];
    clients.forEach(c => (c.activities || []).forEach(a => all.push({ a, c })));
    all.sort((x, y) => (y.a.at > x.a.at ? 1 : y.a.at < x.a.at ? -1 : 0));
    const list = (feedFilter === 'all' ? all : all.filter(x => x.a.type === feedFilter)).slice(0, 30);
    const chips = [{ id: 'all', label: 'All' }].concat(RS.ACTIVITY_TYPES);
    return h`<section class="card en-feed" aria-labelledby="en-feed-t">
      <div class="card__head"><h2 class="section-title" id="en-feed-t">Activity feed</h2>
        <button type="button" class="btn btn--sm" data-log="">${raw(ui.icon('plus'))}Log activity</button></div>
      <div class="chips en-feed__chips" role="group" aria-label="Filter by activity type">
        ${chips.map(t => raw(h`<button type="button" class="chip" data-filter="${t.id}" aria-pressed="${feedFilter === t.id ? 'true' : 'false'}">${t.label}</button>`))}
      </div>
      ${list.length ? raw('<ol class="en-feed__list">' + list.map(({ a, c }) => h`<li class="en-act en-act--${a.type}">
          <span class="en-act__ico" title="${typeLabel(a.type)}">${raw(ui.icon(TYPE_ICON[a.type] || 'note'))}<span class="visually-hidden">${typeLabel(a.type)}</span></span>
          <div class="en-act__body">
            <div class="en-act__meta"><button type="button" class="en-link" data-open="${c.id}">${c.name}</button><time class="muted mono" datetime="${a.at}">${timeAgo(a.at)}</time></div>
            <p class="en-act__text">${a.text || typeLabel(a.type)}</p>
          </div>
        </li>`).join('') + '</ol>') : raw(ui.empty('No activity to show', feedFilter === 'all' ? 'Logged calls, emails, texts, meetings and notes appear here.' : 'Nothing logged of this type yet.'))}
    </section>`;
  }

  /* ---------- weekly chart ---------- */
  function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
  function weeklyData(clients) {
    const start0 = weekStart(new Date());
    const weeks = [];
    for (let i = 7; i >= 0; i--) { const s = new Date(start0); s.setDate(s.getDate() - i * 7); const e = new Date(s); e.setDate(e.getDate() + 7); weeks.push({ s, e, counts: Object.fromEntries(TOUCH_TYPES.map(t => [t.id, 0])), total: 0 }); }
    clients.forEach(c => (c.activities || []).forEach(a => {
      if (a.type === 'stage' || !(a.type in weeks[0].counts)) return;
      const d = util.toDate(a.at); if (!d) return;
      const w = weeks.find(w => d >= w.s && d < w.e); if (!w) return;
      w.counts[a.type]++; w.total++;
    }));
    return weeks;
  }
  function roundedTopPath(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  function drawChart(host, weeks) {
    const W = Math.max(280, Math.floor(host.clientWidth || 600)), H = 220;
    const m = { t: 12, r: 8, b: 26, l: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxT = Math.max(0, ...weeks.map(w => w.total));
    const yMax = Math.max(3, Math.ceil(maxT / 3) * 3);
    const y = v => m.t + ih - (v / yMax) * ih;
    const band = iw / weeks.length, bw = Math.min(44, band * 0.62);
    let s = `<svg class="en-chart__svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="en-chart-desc"><desc id="en-chart-desc">Touches per week for the last 8 weeks, stacked by type.</desc>`;
    for (let i = 0; i <= 3; i++) {
      const v = (yMax / 3) * i, yy = Math.round(y(v)) + 0.5;
      s += `<line class="${i === 0 ? 'en-chart__base' : 'en-chart__grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      s += `<text class="en-chart__ylab" x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${v}</text>`;
    }
    weeks.forEach((w, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      const label = util.fmtShort(w.s.toISOString());
      const segs = TOUCH_TYPES.map((t, ti) => ({ t, ti, n: w.counts[t.id] })).filter(g => g.n > 0);
      let acc = 0;
      segs.forEach((g, gi) => {
        const y0 = y(acc), y1 = y(acc + g.n); acc += g.n;
        const isTop = gi === segs.length - 1;
        const top = y1, bottom = gi === 0 ? y0 : y0 - 2; // 2px gap above the segment below
        const hgt = Math.max(1, bottom - top);
        const tip = `${esc(g.t.label)}: ${g.n} · week of ${esc(label)}`;
        const attrs = `class="en-chart__seg" style="fill:var(--en-c${g.ti + 1})" tabindex="0" data-tip="${tip}" aria-label="${tip}"`;
        s += isTop ? `<path ${attrs} d="${roundedTopPath(x, top, bw, hgt, 4)}"/>` : `<rect ${attrs} x="${x}" y="${top}" width="${bw}" height="${hgt}"/>`;
      });
      s += `<text class="en-chart__xlab" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(label)}</text>`;
    });
    s += '</svg>';
    host.innerHTML = s + '<div class="en-chart__tip" role="tooltip" hidden></div>';
    const tipEl = host.querySelector('.en-chart__tip');
    function show(seg) {
      tipEl.textContent = seg.dataset.tip; tipEl.hidden = false;
      const hb = host.getBoundingClientRect(), sb = seg.getBoundingClientRect();
      const left = Math.min(Math.max(4, sb.left - hb.left + sb.width / 2), hb.width - 4);
      tipEl.style.left = left + 'px'; tipEl.style.top = (sb.top - hb.top) + 'px';
    }
    host.onpointerover = e => { const seg = e.target.closest('.en-chart__seg'); if (seg) show(seg); };
    host.onpointerout = e => { if (e.target.closest('.en-chart__seg')) tipEl.hidden = true; };
    host.onfocusin = e => { const seg = e.target.closest('.en-chart__seg'); if (seg) show(seg); };
    host.onfocusout = () => { tipEl.hidden = true; };
  }
  function renderChartCard(weeks) {
    const total = weeks.reduce((n, w) => n + w.total, 0);
    return h`<section class="card en-chart" aria-labelledby="en-chart-t">
      <div class="card__head"><h2 class="section-title" id="en-chart-t">Weekly touches</h2><span class="muted en-sub"><span class="mono">${total}</span> in the last 8 weeks · stage changes excluded</span></div>
      <ul class="en-legend" aria-label="Legend">
        ${TOUCH_TYPES.map((t, i) => raw(h`<li><span class="en-legend__sw" style="background:var(--en-c${i + 1})"></span>${t.label}</li>`))}
      </ul>
      <div class="en-chart__host" id="en-chart-host"></div>
    </section>`;
  }

  /* ---------- render ---------- */
  function render(mount) {
    mountRef = mount;
    const clients = store.clients();
    const today = util.todayStr();
    const active = clients.filter(c => c.stage !== 'completed');
    const weeks = weeklyData(clients);
    mount.innerHTML = '<div class="en-wrap">'
      + renderBoard(active, today)
      + '<div class="en-split">' + renderQuiet(clients) + renderChartCard(weeks) + '</div>'
      + renderScores(active)
      + renderFeed(clients)
      + '</div>';
    const host = mount.querySelector('#en-chart-host');
    if (host) drawChart(host, weeks);
    mount.onclick = onClick;
    mount.onkeydown = e => { if (e.key === 'Escape' && snoozeOpen) { const id = snoozeOpen; snoozeOpen = null; RS.rerender(); const b = document.getElementById('en-snz-' + id); if (b) b.focus(); } };
  }

  function onClick(e) {
    const t = e.target.closest('button, tr[data-row]');
    if (!t) { if (snoozeOpen) { snoozeOpen = null; RS.rerender(); } return; }
    const d = t.dataset;
    if (d.snoozeToggle) { snoozeOpen = snoozeOpen === d.snoozeToggle ? null : d.snoozeToggle; RS.rerender(); const m = document.querySelector('.en-snooze__menu button'); if (m && snoozeOpen) m.focus(); return; }
    if (d.snooze) {
      const c = store.getClient(d.snooze); snoozeOpen = null;
      if (!c) return;
      const today = util.todayStr();
      const base = c.followUpOn && c.followUpOn > today ? c.followUpOn : today;
      const next = addDays(base, Number(d.days));
      store.updateClient(c.id, { followUpOn: next });
      ui.toast('Follow-up moved to ' + util.fmtShort(next));
      return;
    }
    if (snoozeOpen) { snoozeOpen = null; RS.rerender(); }
    if (d.open) { RS.openClient(d.open); return; }
    if (d.row) { RS.openClient(d.row); return; }
    if (d.call) { RS.logActivity(d.call, 'call'); return; }
    if (d.log !== undefined) { RS.logActivity(null); return; }
    if (d.done) { store.updateClient(d.done, { followUpOn: '' }); ui.toast('Follow-up cleared'); return; }
    if (d.sort !== undefined) { scoreSort = scoreSort === 'desc' ? 'asc' : 'desc'; RS.rerender(); return; }
    if (d.filter) { feedFilter = d.filter; RS.rerender(); return; }
  }

  // Redraw only the chart on resize (keeps SVG text crisp at any width).
  window.addEventListener('resize', util.debounce(() => {
    if (!mountRef || mountRef.dataset.view !== 'engagement') return;
    const host = mountRef.querySelector('#en-chart-host');
    if (host) drawChart(host, weeklyData(store.clients()));
  }, 150));

  function badge() {
    const today = util.todayStr();
    const n = store.clients().filter(c => c.stage !== 'completed' && c.followUpOn && c.followUpOn <= today).length;
    return n || '';
  }

  RS.engagementScore = engagementScore;
  RS.logActivity = logActivity;
  RS.registerView({ id: 'engagement', label: 'Engagement', icon: 'engagement', order: 7, render, badge });
})();
