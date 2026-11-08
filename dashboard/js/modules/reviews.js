/* Reviews — testimonials log, rating summary, review requests, owner replies.
 * Implements RS.addReview(clientId?) and registers view 'reviews'.
 */
(function () {
  'use strict';
  const RS = window.RS;
  const { esc } = RS.util;
  const LINK_KEY = 'rsvi.reviewLink';

  /* ---------- transient UI state (survives re-render) ---------- */
  const state = {
    rating: 'all',      // all | 5 | 4 | low
    source: 'all',
    needsReply: false,
    q: '',
    sort: 'newest',     // newest | lowest
    replyId: null,      // review id with the inline reply editor open
    replyDraft: '',
    editingLink: false,
  };

  /* ---------- helpers ---------- */
  function readLink() { try { return localStorage.getItem(LINK_KEY) || ''; } catch (e) { return memLink; } }
  let memLink = '';
  function writeLink(v) { memLink = v; try { if (v) localStorage.setItem(LINK_KEY, v); else localStorage.removeItem(LINK_KEY); } catch (e) { /* memory only */ } }

  function clientOf(r) { return r.clientId ? RS.store.getClient(r.clientId) : null; }
  function hasReply(r) { return !!String(r.reply || '').trim(); }
  function starsText(n) { return n + '-star'; }

  function testimonial(r) {
    const c = clientOf(r);
    const who = [r.author || (c && c.name) || 'Client', c && c.island].filter(Boolean).join(', ');
    return '“' + String(r.text || '').trim() + '” — ' + who;
  }

  function copyText(text, okMsg) {
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) { RS.ui.toast(okMsg); return; }
      // Last resort: show the text selected so the owner can copy it by hand.
      const m = RS.ui.modal({ title: 'Copy this text', body: '<div class="field"><label for="rv-copy-out">Select and copy</label><textarea id="rv-copy-out" class="textarea" readonly>' + esc(text) + '</textarea></div><div class="modal__foot"><button class="btn btn--primary" type="button" data-close>Done</button></div>' });
      const out = m.body.querySelector('#rv-copy-out'); setTimeout(() => { out.focus(); out.select(); }, 40);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => RS.ui.toast(okMsg)).catch(fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  function lastAsk(c) {
    const a = c.activities.find(x => /asked for a review/i.test(x.text || ''));
    return a ? a.at : '';
  }

  /* ---------- star rating input ---------- */
  function ratingInput(value) {
    let s = '<fieldset class="rv-rate" id="rv-rate"><legend class="field__label">Rating</legend><div class="rv-rate__row">';
    for (let i = 1; i <= 5; i++) {
      s += '<input class="visually-hidden rv-rate__input" type="radio" name="rv-rating" id="rv-rating-' + i + '" value="' + i + '"' + (i === value ? ' checked' : '') + '>' +
        '<label class="rv-rate__star" for="rv-rating-' + i + '" data-n="' + i + '"><span aria-hidden="true">★</span><span class="visually-hidden">' + i + (i === 1 ? ' star' : ' stars') + '</span></label>';
    }
    return s + '<span class="rv-rate__out mono" aria-hidden="true"></span></div></fieldset>';
  }
  const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  function wireRating(root) {
    const set = root.querySelector('.rv-rate');
    const stars = Array.from(set.querySelectorAll('.rv-rate__star'));
    const out = set.querySelector('.rv-rate__out');
    const checked = () => { const c = set.querySelector('input:checked'); return c ? Number(c.value) : 0; };
    function paint(n, preview) {
      stars.forEach(l => l.classList.toggle('is-lit', Number(l.dataset.n) <= n));
      set.classList.toggle('is-preview', !!preview);
      out.textContent = n ? n + '/5 · ' + RATING_WORDS[n] : '';
    }
    stars.forEach(l => {
      l.addEventListener('mouseenter', () => paint(Number(l.dataset.n), true));
    });
    set.querySelector('.rv-rate__row').addEventListener('mouseleave', () => paint(checked(), false));
    set.addEventListener('change', () => paint(checked(), false));
    paint(checked(), false);
    return checked;
  }

  /* ---------- add / edit modal ---------- */
  function reviewForm(existing, clientId) {
    const today = RS.util.todayStr();
    const r = existing || { clientId: clientId || '', author: '', rating: 5, source: 'Google', at: today, text: '', featured: false };
    const clients = RS.store.clients().slice().sort((a, b) => a.name.localeCompare(b.name));
    const pre = r.clientId ? RS.store.getClient(r.clientId) : null;
    const author = r.author || (pre ? pre.name : '');
    const opts = '<option value="">Not a tracked client</option>' + clients.map(c => '<option value="' + esc(c.id) + '"' + (c.id === r.clientId ? ' selected' : '') + '>' + esc(c.name + (c.company ? ' — ' + c.company : '')) + '</option>').join('');
    const body =
      '<form class="form" id="rv-form" novalidate>' +
        '<div class="form-row">' +
          '<div class="field"><label for="rv-f-client">Client</label><select class="select" id="rv-f-client">' + opts + '</select></div>' +
          '<div class="field"><label for="rv-f-author">Author name</label><input class="input" id="rv-f-author" autocomplete="off" value="' + esc(author) + '"></div>' +
        '</div>' +
        ratingInput(Number(r.rating) || 5) +
        '<div class="form-row">' +
          '<div class="field"><label for="rv-f-source">Source</label><select class="select" id="rv-f-source">' + RS.REVIEW_SOURCES.map(s => '<option' + (s === r.source ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
          '<div class="field"><label for="rv-f-date">Date</label><input class="input" type="date" id="rv-f-date" value="' + esc(r.at || today) + '" max="' + today + '"></div>' +
        '</div>' +
        '<div class="field"><label for="rv-f-text">Review text <span aria-hidden="true">*</span></label><textarea class="textarea" id="rv-f-text" required aria-describedby="rv-f-text-err">' + esc(r.text) + '</textarea><span class="field__hint rv-err" id="rv-f-text-err" hidden>Enter the review text.</span></div>' +
        '<label class="check"><input type="checkbox" id="rv-f-featured"' + (r.featured ? ' checked' : '') + '> Feature on website</label>' +
        '<div class="modal__foot"><button class="btn btn--ghost" type="button" data-close>Cancel</button><button class="btn btn--primary" type="submit">' + (existing ? 'Save changes' : 'Add review') + '</button></div>' +
      '</form>';
    const m = RS.ui.modal({ title: existing ? 'Edit review' : 'Add review', body });
    const f = m.body.querySelector('#rv-form');
    const getRating = wireRating(f);
    const selC = f.querySelector('#rv-f-client'), inA = f.querySelector('#rv-f-author');
    let authorTouched = !!(existing && existing.author);
    inA.addEventListener('input', () => { authorTouched = inA.value.trim() !== ''; });
    selC.addEventListener('change', () => {
      const c = RS.store.getClient(selC.value);
      if (!authorTouched || !inA.value.trim()) { inA.value = c ? c.name : ''; authorTouched = false; }
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const text = f.querySelector('#rv-f-text').value.trim();
      const err = f.querySelector('#rv-f-text-err');
      if (!text) { err.hidden = false; f.querySelector('#rv-f-text').setAttribute('aria-invalid', 'true'); f.querySelector('#rv-f-text').focus(); return; }
      const cid = selC.value;
      const c = cid ? RS.store.getClient(cid) : null;
      const data = {
        clientId: cid,
        author: inA.value.trim() || (c ? c.name : 'Anonymous'),
        rating: getRating() || 5,
        source: f.querySelector('#rv-f-source').value,
        at: f.querySelector('#rv-f-date').value || today,
        text,
        featured: f.querySelector('#rv-f-featured').checked,
      };
      m.close();
      if (existing) {
        RS.store.updateReview(existing.id, data);
        RS.ui.toast('Review updated');
      } else {
        RS.store.addReview(data);
        if (cid && c) RS.store.addActivity(cid, { type: 'note', text: 'Left a ' + data.rating + '-star review on ' + data.source });
        RS.ui.toast('Review added');
      }
    });
  }

  RS.addReview = function (clientId) { reviewForm(null, clientId || ''); };

  /* ---------- view sections ---------- */
  function summaryCard(all) {
    const n = all.length;
    const avg = n ? all.reduce((s, r) => s + (Number(r.rating) || 0), 0) / n : 0;
    const dist = [5, 4, 3, 2, 1].map(k => ({ k, c: all.filter(r => Math.round(Number(r.rating)) === k).length }));
    const bySource = RS.REVIEW_SOURCES.map(s => ({ s, c: all.filter(r => r.source === s).length })).filter(x => x.c);
    const unreplied = all.filter(r => !hasReply(r)).length;
    const featured = all.filter(r => r.featured).length;
    return '<section class="card rv-summary" aria-labelledby="rv-sum-title">' +
      '<h2 class="visually-hidden" id="rv-sum-title">Rating summary</h2>' +
      '<div class="rv-summary__score">' +
        '<p class="eyebrow">Average rating</p>' +
        '<p class="rv-avg">' + avg.toFixed(1) + '</p>' +
        RS.ui.stars(avg, 'lg') +
        '<p class="rv-from muted">from <span class="mono">' + n + '</span> review' + (n === 1 ? '' : 's') + '</p>' +
        '<p class="rv-mini"><span class="badge' + (unreplied ? ' badge--warn' : ' badge--good') + '"><span class="mono">' + unreplied + '</span> need a reply</span> <span class="badge badge--info"><span class="mono">' + featured + '</span> featured</span></p>' +
      '</div>' +
      '<div class="rv-summary__dist">' +
        '<p class="eyebrow">Rating distribution</p>' +
        '<ul class="rv-dist" role="list">' + dist.map(d => {
          const pct = n ? Math.round(d.c / n * 100) : 0;
          return '<li class="rv-dist__row"><span class="rv-dist__label">' + d.k + ' <span aria-hidden="true">★</span><span class="visually-hidden">stars</span></span>' +
            '<span class="rv-dist__track" aria-hidden="true"><span class="rv-dist__fill" style="width:' + pct + '%"></span></span>' +
            '<span class="rv-dist__count mono">' + d.c + ' <span class="muted">' + pct + '%</span></span></li>';
        }).join('') + '</ul>' +
        '<p class="eyebrow rv-src-title">By source</p>' +
        '<div class="chips rv-src">' + (bySource.length ? bySource.map(x => '<span class="rv-src__chip">' + esc(x.s) + ' <b class="mono">' + x.c + '</b></span>').join('') : '<span class="muted">No reviews yet</span>') + '</div>' +
      '</div>' +
    '</section>';
  }

  function requestsCard(all) {
    const reviewed = new Set(all.map(r => r.clientId).filter(Boolean));
    const list = RS.store.byStage('completed').filter(c => !reviewed.has(c.id))
      .sort((a, b) => String(b.job.completedAt || '').localeCompare(String(a.job.completedAt || '')));
    let rows = '';
    if (!list.length) rows = '<p class="muted rv-req__none">Every completed client has a review on file.</p>';
    else rows = '<ul class="rv-req__list" role="list">' + list.map(c => {
      const ask = lastAsk(c);
      return '<li class="rv-req__item">' + RS.ui.avatar(c.name) +
        '<div class="rv-req__who"><button class="rv-link" type="button" data-act="open" data-cid="' + esc(c.id) + '">' + esc(c.name) + '</button>' +
        '<span class="rv-req__meta muted">Completed <span class="mono">' + esc(RS.util.fmtShort(c.job.completedAt)) + '</span>' +
        (ask ? ' · <span class="badge badge--info">Asked ' + esc(RS.util.relDays(ask)) + '</span>' : ' · <span class="badge badge--warn">Not asked</span>') + '</span></div>' +
        '<div class="rv-req__acts"><button class="btn btn--sm" type="button" data-act="ask" data-cid="' + esc(c.id) + '">' + RS.ui.icon('message') + 'Log review request</button>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-act="add-for" data-cid="' + esc(c.id) + '">' + RS.ui.icon('plus') + 'Add review</button></div></li>';
    }).join('') + '</ul>';
    return '<section class="card rv-req" aria-labelledby="rv-req-title">' +
      '<div class="card__head"><h2 class="card__title" id="rv-req-title">Review requests</h2>' + (list.length ? '<span class="badge badge--warn"><span class="mono">' + list.length + '</span> without a review</span>' : '<span class="badge badge--good">All reviewed</span>') + '</div>' +
      rows + '</section>';
  }

  function linkCard() {
    const link = readLink();
    const editing = state.editingLink || !link;
    return '<section class="card rv-ask" aria-labelledby="rv-ask-title">' +
      '<div class="card__head"><h2 class="card__title" id="rv-ask-title">Where to ask for reviews</h2></div>' +
      '<p class="rv-ask__copy">Send your Google review link by text right after you mark a job complete — that is when clients are happiest and most likely to write one.</p>' +
      (editing
        ? '<form class="rv-ask__form" id="rv-link-form"><div class="field"><label for="rv-link-in">Your Google review link</label><input class="input" id="rv-link-in" type="url" inputmode="url" autocomplete="off" placeholder="https://g.page/r/…/review" value="' + esc(link) + '"><span class="field__hint">Saved in this browser only.</span></div>' +
          '<div class="rv-ask__btns"><button class="btn btn--primary btn--sm" type="submit">Save link</button>' + (link ? '<button class="btn btn--ghost btn--sm" type="button" data-act="link-cancel">Cancel</button>' : '') + '</div></form>'
        : '<div class="rv-ask__show"><code class="rv-ask__link mono" tabindex="0" aria-label="Google review link">' + esc(link) + '</code>' +
          '<div class="rv-ask__btns"><button class="btn btn--primary btn--sm" type="button" data-act="link-copy">Copy link</button><button class="btn btn--ghost btn--sm" type="button" data-act="link-edit">' + RS.ui.icon('edit') + 'Change</button></div></div>') +
    '</section>';
  }

  function filterBar() {
    const rOpts = [['all', 'All'], ['5', '5 ★'], ['4', '4 ★'], ['low', '3 & below']];
    return '<div class="toolbar rv-filters" role="search" aria-label="Filter reviews">' +
      '<div class="chips" role="group" aria-label="Rating">' + rOpts.map(([v, l]) => '<button type="button" class="chip" data-act="f-rating" data-v="' + v + '" aria-pressed="' + (state.rating === v) + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<button type="button" class="chip rv-chip-reply" data-act="f-reply" aria-pressed="' + state.needsReply + '">Needs reply</button>' +
      '<div class="field rv-filters__sel"><label class="visually-hidden" for="rv-f-src">Source</label><select class="select" id="rv-f-src"><option value="all">All sources</option>' + RS.REVIEW_SOURCES.map(s => '<option' + (state.source === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
      '<div class="field rv-filters__sel"><label class="visually-hidden" for="rv-f-sort">Sort</label><select class="select" id="rv-f-sort"><option value="newest"' + (state.sort === 'newest' ? ' selected' : '') + '>Newest first</option><option value="lowest"' + (state.sort === 'lowest' ? ' selected' : '') + '>Lowest rating first</option></select></div>' +
      '<div class="search rv-search">' + RS.ui.icon('search') + '<label class="visually-hidden" for="rv-q">Search reviews</label><input class="input input--search" id="rv-q" type="search" placeholder="Search text, author, client" value="' + esc(state.q) + '"></div>' +
    '</div>';
  }

  function applyFilters(all) {
    const q = state.q.trim().toLowerCase();
    let list = all.filter(r => {
      const n = Number(r.rating);
      if (state.rating === '5' && n !== 5) return false;
      if (state.rating === '4' && n !== 4) return false;
      if (state.rating === 'low' && n > 3) return false;
      if (state.source !== 'all' && r.source !== state.source) return false;
      if (state.needsReply && hasReply(r)) return false;
      if (q) {
        const c = clientOf(r);
        const hay = [r.text, r.author, r.reply, r.source, c && c.name, c && c.company].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byDate = (a, b) => String(b.at || '').localeCompare(String(a.at || ''));
    list = list.slice().sort(state.sort === 'lowest' ? ((a, b) => (Number(a.rating) - Number(b.rating)) || byDate(a, b)) : byDate);
    return list;
  }

  function reviewCard(r) {
    const c = clientOf(r);
    const low = Number(r.rating) <= 3;
    const replying = state.replyId === r.id;
    const replyBlock = replying
      ? '<form class="rv-replyform" data-rid="' + esc(r.id) + '"><div class="field"><label for="rv-reply-' + esc(r.id) + '">Your reply</label><textarea class="textarea" id="rv-reply-' + esc(r.id) + '" data-rid="' + esc(r.id) + '" placeholder="Thank them by name and mention the work you did.">' + esc(state.replyDraft) + '</textarea></div>' +
        '<div class="rv-replyform__btns"><button class="btn btn--primary btn--sm" type="submit">Save reply</button><button class="btn btn--ghost btn--sm" type="button" data-act="reply-cancel">Cancel</button>' + (hasReply(r) ? '<button class="btn btn--ghost btn--sm rv-danger-txt" type="button" data-act="reply-remove" data-rid="' + esc(r.id) + '">Remove reply</button>' : '') + '</div></form>'
      : (hasReply(r) ? '<div class="rv-reply"><p class="rv-reply__head eyebrow">Reply from Reliable Solutions VI</p><p class="rv-reply__text">' + esc(r.reply) + '</p></div>' : '');
    return '<article class="rv-card' + (low ? ' rv-card--low' : '') + (r.featured ? ' rv-card--featured' : '') + '" aria-labelledby="rv-a-' + esc(r.id) + '">' +
      '<header class="rv-card__head">' +
        RS.ui.stars(r.rating) +
        '<h3 class="rv-card__author" id="rv-a-' + esc(r.id) + '">' + esc(r.author || 'Anonymous') + '</h3>' +
        (c ? '<button class="rv-link rv-card__client" type="button" data-act="open" data-cid="' + esc(c.id) + '">' + esc(c.name) + '</button>' : '<span class="muted rv-card__client">Not a tracked client</span>') +
        '<span class="rv-card__spacer"></span>' +
        '<span class="badge rv-srcbadge">' + esc(r.source) + '</span>' +
        '<time class="mono rv-card__date" datetime="' + esc(r.at) + '">' + esc(RS.util.fmtDate(r.at)) + '</time>' +
      '</header>' +
      '<p class="rv-card__text">' + esc(r.text) + '</p>' +
      (!hasReply(r) && !replying ? '<p class="rv-card__flag"><span class="badge badge--warn">No reply yet</span></p>' : '') +
      replyBlock +
      '<footer class="rv-card__acts">' +
        '<button type="button" class="btn btn--sm rv-feat" data-act="feature" data-rid="' + esc(r.id) + '" aria-pressed="' + !!r.featured + '">' + (r.featured ? '★ Featured' : '☆ Feature') + '</button>' +
        (r.featured ? '<button type="button" class="btn btn--sm" data-act="copy" data-rid="' + esc(r.id) + '">Copy for website</button>' : '') +
        (low && c ? '<button type="button" class="btn btn--sm rv-followup" data-act="followup" data-cid="' + esc(c.id) + '">' + RS.ui.icon('phone') + 'Follow up with client</button>' : '') +
        '<span class="rv-card__spacer"></span>' +
        (!replying ? '<button type="button" class="btn btn--sm btn--ghost" data-act="reply" data-rid="' + esc(r.id) + '">' + RS.ui.icon('message') + (hasReply(r) ? 'Edit reply' : 'Reply') + '</button>' : '') +
        '<button type="button" class="btn btn--sm btn--ghost" data-act="edit" data-rid="' + esc(r.id) + '">' + RS.ui.icon('edit') + 'Edit</button>' +
        '<button type="button" class="btn btn--sm btn--ghost rv-danger-txt" data-act="delete" data-rid="' + esc(r.id) + '" aria-label="Delete review by ' + esc(r.author || 'Anonymous') + '">' + RS.ui.icon('trash') + 'Delete</button>' +
      '</footer>' +
    '</article>';
  }

  /* ---------- render ---------- */
  function render(mount) {
    const all = RS.store.reviews();
    if (state.replyId && !all.find(r => r.id === state.replyId)) { state.replyId = null; state.replyDraft = ''; }

    const head = '<div class="toolbar rv-top"><h2 class="section-title">Reviews &amp; testimonials</h2><span class="toolbar__spacer"></span><button class="btn btn--primary" type="button" data-act="add">' + RS.ui.icon('plus') + 'Add review</button></div>';

    if (!all.length) {
      mount.innerHTML = head + RS.ui.empty('No reviews yet', 'Log reviews from Google, Facebook or direct feedback here. Ask completed clients first — they know your work best.', '<button class="btn btn--primary" type="button" data-act="add">' + RS.ui.icon('plus') + 'Add the first review</button>') +
        '<div class="rv-side rv-side--empty">' + requestsCard(all) + linkCard() + '</div>';
    } else {
      const list = applyFilters(all);
      mount.innerHTML = head +
        '<div class="rv-layout">' +
          '<div class="rv-maincol">' + summaryCard(all) +
            '<section class="rv-listsec" aria-labelledby="rv-list-title"><div class="rv-listhead"><h2 class="card__title" id="rv-list-title">All reviews</h2><span class="muted mono rv-count">' + list.length + ' of ' + all.length + '</span></div>' +
            filterBar() +
            (list.length ? '<div class="rv-list">' + list.map(reviewCard).join('') + '</div>'
              : RS.ui.empty('No reviews match', 'Clear a filter or change the search to see more reviews.', '<button class="btn" type="button" data-act="clear">Clear filters</button>')) +
            '</section>' +
          '</div>' +
          '<aside class="rv-side">' + requestsCard(all) + linkCard() + '</aside>' +
        '</div>';
    }
    wire(mount);
  }

  const rerenderSoon = RS.util.debounce(() => RS.rerender(), 180);

  function wire(mount) {
    mount.onclick = onClick;
    mount.onsubmit = onSubmit;
    mount.onchange = e => {
      if (e.target.id === 'rv-f-src') { state.source = e.target.value; RS.rerender(); }
      else if (e.target.id === 'rv-f-sort') { state.sort = e.target.value; RS.rerender(); }
    };
    mount.oninput = e => {
      if (e.target.id === 'rv-q') { state.q = e.target.value; rerenderSoon(); }
      else if (e.target.matches('.rv-replyform textarea')) state.replyDraft = e.target.value;
    };
    mount.onkeydown = e => {
      if (e.key === 'Escape' && e.target.matches('.rv-replyform textarea')) { e.stopPropagation(); closeReply(); }
    };
  }

  function closeReply() { const id = state.replyId; state.replyId = null; state.replyDraft = ''; RS.rerender(); focusLater('[data-act="reply"][data-rid="' + id + '"]'); }
  function focusLater(sel) { setTimeout(() => { const el = document.querySelector('[data-view="reviews"] ' + sel); if (el) el.focus(); }, 0); }
  function getReview(id) { return RS.store.reviews().find(r => r.id === id) || null; }

  function onSubmit(e) {
    const f = e.target;
    if (f.id === 'rv-link-form') {
      e.preventDefault();
      const v = f.querySelector('#rv-link-in').value.trim();
      writeLink(v); state.editingLink = false;
      RS.rerender(); RS.ui.toast(v ? 'Review link saved' : 'Review link removed');
      focusLater(v ? '[data-act="link-copy"]' : '#rv-link-in');
      return;
    }
    if (f.classList.contains('rv-replyform')) {
      e.preventDefault();
      const id = f.dataset.rid;
      const text = f.querySelector('textarea').value.trim();
      if (!text) { f.querySelector('textarea').focus(); RS.ui.toast('Write a reply before saving', 'warn'); return; }
      state.replyId = null; state.replyDraft = '';
      RS.store.updateReview(id, { reply: text });
      RS.ui.toast('Reply saved');
      focusLater('[data-act="reply"][data-rid="' + id + '"]');
    }
  }

  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, rid = b.dataset.rid, cid = b.dataset.cid;
    switch (act) {
      case 'add': RS.addReview(); break;
      case 'add-for': RS.addReview(cid); break;
      case 'open': RS.openClient(cid); break;
      case 'ask': {
        RS.store.addActivity(cid, { type: 'text', text: 'Asked for a review' });
        RS.ui.toast('Review request logged');
        break;
      }
      case 'f-rating': state.rating = b.dataset.v; RS.rerender(); break;
      case 'f-reply': state.needsReply = !state.needsReply; RS.rerender(); break;
      case 'clear': Object.assign(state, { rating: 'all', source: 'all', needsReply: false, q: '' }); RS.rerender(); break;
      case 'feature': {
        const r = getReview(rid); if (!r) return;
        RS.store.updateReview(rid, { featured: !r.featured });
        RS.ui.toast(r.featured ? 'Review featured on website' : 'Review removed from website');
        focusLater('[data-act="feature"][data-rid="' + rid + '"]');
        break;
      }
      case 'copy': { const r = getReview(rid); if (r) copyText(testimonial(r), 'Testimonial copied'); break; }
      case 'followup': RS.logActivity(cid, 'call'); break;
      case 'reply': {
        const r = getReview(rid); if (!r) return;
        state.replyId = rid; state.replyDraft = r.reply || '';
        RS.rerender();
        setTimeout(() => { const t = document.getElementById('rv-reply-' + rid); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 0);
        break;
      }
      case 'reply-cancel': closeReply(); break;
      case 'reply-remove': {
        RS.ui.confirm('Remove your reply to this review?', { okLabel: 'Remove reply', danger: true, title: 'Remove reply' }).then(ok => {
          if (!ok) return;
          state.replyId = null; state.replyDraft = '';
          RS.store.updateReview(rid, { reply: '' }); RS.ui.toast('Reply removed');
        });
        break;
      }
      case 'edit': { const r = getReview(rid); if (r) reviewForm(r); break; }
      case 'delete': {
        const r = getReview(rid); if (!r) return;
        RS.ui.confirm('Delete the ' + starsText(r.rating) + ' review from ' + (r.author || 'Anonymous') + '? This cannot be undone.', { okLabel: 'Delete review', danger: true, title: 'Delete review' }).then(ok => {
          if (!ok) return;
          RS.store.deleteReview(rid); RS.ui.toast('Review deleted');
        });
        break;
      }
      case 'link-copy': copyText(readLink(), 'Review link copied'); break;
      case 'link-edit': state.editingLink = true; RS.rerender(); focusLater('#rv-link-in'); break;
      case 'link-cancel': state.editingLink = false; RS.rerender(); focusLater('[data-act="link-edit"]'); break;
    }
  }

  RS.registerView({
    id: 'reviews', label: 'Reviews', icon: 'reviews', order: 6,
    render,
    badge() { const n = RS.store.reviews().filter(r => !hasReply(r)).length; return n || ''; },
  });

})();
