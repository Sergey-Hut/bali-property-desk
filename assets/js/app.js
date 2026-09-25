/* Bali Property Desk — landing v5 (light).
   Engine reused from v4: session state, history back/forward, validation, relay delivery, event taxonomy.
   Rules: no PII in storage, console or analytics. lead_created fires ONLY after the relay confirms {ok:true}. */
(function () {
  'use strict';

  var BPD = window.BPD;
  if (!BPD || !document.getElementById('quiz')) return;

  var C = BPD.config;
  var T = BPD.copy;
  var Q = T.quiz.questions;
  var TOTAL = Q.length;
  var CONTACT = TOTAL;
  var NS = C.storage_ns;
  var KEY_SESSION = NS + '.session';
  var KEY_FT = NS + '.ft';
  var REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ADVANCE_MS = REDUCE ? 120 : 350;

  /* Motion mode: natively adapted React Bits mechanics (stepper, directional transitions,
     spotlight, magnet CTA, selection spark, button glare) are the default.
     ?motion=basic restores the plain v5 behavior for comparison. Visual layer only. */
  var MOTION = /[?&]motion=basic\b/.test(location.search) ? 'basic' : 'rb';
  var RB = MOTION === 'rb' && !REDUCE;
  var FINE = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var ENABLE_SELECTION_SPARK = true;
  if (MOTION === 'rb') document.body.classList.add('m-rb');
  if (RB) document.body.classList.add('rb-anim');

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function sget(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function sdel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* noop */ } }
  function fmt(s, map) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }); }
  function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
  function isMulti(q) { return !!q.multi; }

  /* ---------- first-touch attribution (session, no PII) ---------- */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  function firstTouch() {
    var ft = sget(KEY_FT);
    if (ft && ft.ts) return ft;
    var p = new URLSearchParams(location.search);
    var utm = {};
    UTM_KEYS.forEach(function (k) { var v = p.get(k); if (v) utm[k] = clip(v, 150); });
    ft = {
      utm: utm,
      landing_url: clip(location.origin + location.pathname + location.search, 500),
      referrer: clip(document.referrer || '', 500),
      ts: new Date().toISOString()
    };
    sset(KEY_FT, ft);
    return ft;
  }

  /* ---------- analytics ---------- */
  function track(name, params) {
    var ev = { event: name };
    if (params) Object.keys(params).forEach(function (k) { ev[k] = params[k]; });
    (window.dataLayer = window.dataLayer || []).push(ev);
    
    if (C.pixel_enabled && typeof window.oaiq === 'function') {
      try {
        if (name === 'lead_created') window.oaiq('measure', 'lead_created', { type: 'customer_action' });
        else if (name !== 'page_view') window.oaiq('measure', 'custom', { type: 'custom' }, { custom_event_name: name });
      } catch (e) { /* never break the flow on analytics */ }
    }
  }

  /* ---------- state ---------- */
  var VALID = {};
  Q.forEach(function (q) { VALID[q.key] = q.options.map(function (o) { return o.v; }); });

  function sanitizeAnswer(q, v) {
    if (isMulti(q)) {
      if (!Array.isArray(v)) return null;
      var arr = v.filter(function (x) { return VALID[q.key].indexOf(x) !== -1; });
      if (q.max) arr = arr.slice(0, q.max);
      return arr.length ? arr : null;
    }
    return VALID[q.key].indexOf(v) !== -1 ? v : null;
  }

  var saved = sget(KEY_SESSION) || {};
  var S = {
    answers: {},
    step: 0,
    started: !!saved.started,
    completed: false,
    formViewed: false,
    leadId: typeof saved.leadId === 'string' ? saved.leadId : null,
    sending: false,
    done: false,
    editing: false
  };
  if (saved.answers) Q.forEach(function (q) {
    var v = sanitizeAnswer(q, saved.answers[q.key]);
    if (v != null) S.answers[q.key] = v;
  });
  function answered(q) { var v = S.answers[q.key]; return isMulti(q) ? Array.isArray(v) && v.length > 0 : !!v; }
  function firstUnanswered() {
    for (var i = 0; i < TOTAL; i++) if (!answered(Q[i])) return i;
    return CONTACT;
  }
  if (typeof saved.step === 'number' && saved.step >= 0 && saved.step <= CONTACT) {
    S.step = Math.min(saved.step, firstUnanswered());
  }
  function persist() { sset(KEY_SESSION, { answers: S.answers, step: S.step, started: S.started, leadId: S.leadId }); }

  function labelsOf(key) {
    var q = Q.filter(function (x) { return x.key === key; })[0];
    if (!q) return '—';
    var v = S.answers[key];
    var arr = isMulti(q) ? (v || []) : (v ? [v] : []);
    var out = arr.map(function (x) {
      var o = q.options.filter(function (y) { return y.v === x; })[0];
      return o ? o.label : null;
    }).filter(Boolean);
    return out.length ? out.join(', ') : '—';
  }
  function genLeadId() {
    var rnd = '';
    try {
      var a = new Uint32Array(2); crypto.getRandomValues(a);
      rnd = (a[0].toString(36) + a[1].toString(36)).toUpperCase().slice(0, 6);
    } catch (e) { rnd = Math.random().toString(36).slice(2, 8).toUpperCase(); }
    return C.id_prefix + '-' + Date.now().toString(36).toUpperCase().slice(-5) + '-' + rnd;
  }

  /* ---------- DOM ---------- */
  var quiz = $('quiz'), vStep = $('qstep'), vContact = $('qcontact'), vSuccess = $('qsuccess'), vFail = $('qfail');
  var qBody = $('q-body'), qProgress = $('q-progress'), qFill = $('q-fill'), qBack = $('q-back'), qNext = $('q-next');
  var form = $('lead-form'), fName = $('f-name'), fCountry = $('f-country'), fPhone = $('f-phone'),
      fEmail = $('f-email'), fConsent = $('f-consent'), fCompany = $('f-company'),
      fTg = $('f-tg'), tgField = $('tg-field'), lblPhone = $('lbl-phone');
  var submitBtn = $('submit'), submitLabel = $('submit-label'), formAlert = $('form-alert');
  var sticky = $('sticky'), topbar = $('topbar'), quizSec = $('podbor');
  var timer = null;

  var CHECK_SVG = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false"><path d="M2 6.2l2.6 2.6L10 3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function showView(v) {
    [vStep, vContact, vSuccess, vFail].forEach(function (x) { x.hidden = x !== v; });
    quiz.setAttribute('data-state', v.id);
  }
  function setFill(ratio) { qFill.style.transform = 'scaleX(' + Math.max(0.04, Math.min(1, ratio)) + ')'; }
  function focusNoScroll(node) { if (!node) return; try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); } }
  function ensureQuizInView() {
    var top = quiz.getBoundingClientRect().top;
    var offset = (topbar ? topbar.offsetHeight : 0) + 12;
    if (top < offset || top > window.innerHeight * 0.5) {
      window.scrollTo({ top: window.pageYOffset + top - offset, behavior: REDUCE ? 'auto' : 'smooth' });
    }
  }

  /* ---------- history ---------- */
  var STACK = [], PTR = 0;
  function histPush(step) {
    STACK = STACK.slice(0, PTR + 1); STACK.push(step); PTR = STACK.length - 1;
    try { history.pushState({ bpd: step, seq: PTR }, '', location.href); } catch (e) { /* noop */ }
  }
  function histReplace(step) {
    STACK[PTR] = step;
    try { history.replaceState({ bpd: step, seq: PTR }, '', location.href); } catch (e) { /* noop */ }
  }
  window.addEventListener('popstate', function (e) {
    if (S.done || S.sending) return;
    var st = e.state && typeof e.state.bpd === 'number' ? e.state : null;
    clearTimeout(timer);
    if (st) { PTR = st.seq; render(Math.min(st.bpd, firstUnanswered()), { focus: true }); }
    else { STACK = [0]; PTR = 0; render(0, { focus: false }); }
  });

  /* ---------- stepper (motion=reactbits) ---------- */
  var stepperEl = null;
  function buildStepper() {
    if (MOTION !== 'rb' || stepperEl) return;
    var prog = vStep.querySelector('.progress');
    if (!prog) return;
    stepperEl = el('div', { 'class': 'stepper', 'aria-hidden': 'true' });
    Q.forEach(function (q, i) {
      if (i > 0) stepperEl.appendChild(el('i', { 'class': 'st-line' }));
      var s = el('span', { 'class': 'st', 'data-i': i });
      s.appendChild(el('b', { 'class': 'st-n num' }, (i < 9 ? '0' : '') + (i + 1)));
      s.appendChild(el('em', { 'class': 'st-l' }, q.summary));
      stepperEl.appendChild(s);
    });
    prog.parentNode.insertBefore(stepperEl, prog);
  }
  function updateStepper(cur) {
    if (!stepperEl) return;
    Array.prototype.forEach.call(stepperEl.querySelectorAll('.st'), function (s) {
      var i = +s.getAttribute('data-i');
      s.setAttribute('data-state', i < cur ? 'done' : i === cur ? 'cur' : 'todo');
    });
    Array.prototype.forEach.call(stepperEl.querySelectorAll('.st-line'), function (l, idx) {
      l.setAttribute('data-done', idx < cur ? 'true' : 'false');
    });
  }

  /* ---------- rendering ---------- */
  var swapT = null;
  function render(step, opt) {
    opt = opt || {};
    var dir = step >= S.step ? 'f' : 'b';
    S.step = step; persist();
    var go = function () {
      if (step >= CONTACT) renderContact(opt, dir); else renderQuestion(step, opt, dir);
    };
    var old = RB && !vStep.hidden && step < CONTACT ? qBody.firstChild : null;
    if (old) {
      old.classList.add('q-x-' + dir);
      clearTimeout(swapT);
      swapT = setTimeout(go, 230);
    } else go();
  }

  function updateMaxState(q) {
    if (!q.max) return;
    var sel = S.answers[q.key] || [];
    var maxed = sel.length >= q.max;
    Array.prototype.forEach.call(qBody.querySelectorAll('.opt'), function (b) {
      b.setAttribute('data-maxed', maxed ? 'true' : 'false');
    });
    var cnt = $('q-count');
    if (cnt) cnt.textContent = sel.length ? fmt(T.quiz.max_count, { n: sel.length }) : '';
  }

  function renderQuestion(i, opt, dir) {
    var q = Q[i];
    var multi = isMulti(q);
    showView(vStep);
    qProgress.textContent = fmt(T.quiz.progress, { n: i + 1, total: TOTAL });
    setFill((i + (answered(q) ? 1 : 0.3)) / TOTAL);
    updateStepper(i);
    qBack.setAttribute('aria-disabled', i === 0 ? 'true' : 'false');
    qBack.tabIndex = i === 0 ? -1 : 0;
    qNext.hidden = !multi;
    qNext.disabled = multi && !answered(q);

    var wrap = el('div', { 'class': 'q' + (RB ? ' q-in-' + (dir || 'f') : '') });
    var h = el('h3', { 'class': 'q__title', id: 'q-title', tabindex: '-1' }, q.title);
    wrap.appendChild(h);
    var subText = q.sub || (multi ? (q.max ? T.quiz.max_hint : T.quiz.multi_hint) : null);
    if (subText) wrap.appendChild(el('p', { 'class': 'q__sub', id: 'q-sub' }, subText));
    if (q.max) wrap.appendChild(el('p', { 'class': 'q__count num', id: 'q-count', 'aria-live': 'polite' }, ''));

    var group = el('div', { 'class': 'opts', role: 'group', 'aria-labelledby': 'q-title' });
    if (subText) group.setAttribute('aria-describedby', 'q-sub');
    q.options.forEach(function (o) {
      var on = multi ? (S.answers[q.key] || []).indexOf(o.v) !== -1 : S.answers[q.key] === o.v;
      var b = el('button', { type: 'button', 'class': 'opt ' + (multi ? 'opt--multi' : 'opt--single'), 'aria-pressed': on ? 'true' : 'false', 'data-v': o.v });
      var mark = el('span', { 'class': 'opt__mark', 'aria-hidden': 'true' });
      mark.innerHTML = CHECK_SVG;
      b.appendChild(mark);
      b.appendChild(el('span', { 'class': 'opt__label' }, o.label));
      b.addEventListener('click', function () { choose(i, o.v, b); });
      group.appendChild(b);
    });
    group.addEventListener('keydown', arrowNav);
    wrap.appendChild(group);
    qBody.innerHTML = '';
    qBody.appendChild(wrap);
    updateMaxState(q);
    if (opt.focus) { ensureQuizInView(); focusNoScroll(h); }
  }

  function arrowNav(e) {
    var keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    var btns = Array.prototype.slice.call(e.currentTarget.querySelectorAll('.opt'));
    var idx = btns.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    var next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (idx + keys[e.key] + btns.length) % btns.length;
    btns[next].focus();
  }

  function spawnSpark(btn) {
    if (!RB || !ENABLE_SELECTION_SPARK || !FINE) return;
    var mark = btn.querySelector('.opt__mark');
    if (!mark) return;
    var s = el('span', { 'class': 'spark', 'aria-hidden': 'true' });
    s.addEventListener('animationend', function () { if (s.parentNode) s.parentNode.removeChild(s); });
    mark.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 400);
  }

  function markStarted(source) {
    if (S.started) return;
    S.started = true; persist();
    track('quiz_start', { source: source });
  }

  function goNext(i) {
    var next = i + 1;
    if (next === CONTACT && !S.completed) { S.completed = true; track('quiz_complete', { answers: TOTAL }); }
    if (S.editing && next < CONTACT && firstUnanswered() >= CONTACT) next = CONTACT;
    S.editing = false;
    histPush(next);
    render(next, { focus: true });
  }

  function choose(i, v, btn) {
    if (S.done) return;
    var q = Q[i];
    markStarted('answer');
    if (isMulti(q)) {
      var sel = (S.answers[q.key] || []).slice();
      var at = sel.indexOf(v);
      if (at !== -1) sel.splice(at, 1);
      else {
        if (q.max && sel.length >= q.max) return;
        sel.push(v);
        spawnSpark(btn);
      }
      if (sel.length) S.answers[q.key] = sel; else delete S.answers[q.key];
      persist();
      btn.setAttribute('aria-pressed', at === -1 ? 'true' : 'false');
      updateMaxState(q);
      var wasOff = qNext.disabled;
      qNext.disabled = !answered(q);
      if (RB && wasOff && !qNext.disabled) {
        qNext.classList.remove('sheen-once');
        void qNext.offsetWidth;
        qNext.classList.add('sheen-once');
      }
      setFill((i + (answered(q) ? 1 : 0.3)) / TOTAL);
      return;
    }
    S.answers[q.key] = v; persist();
    Array.prototype.forEach.call(qBody.querySelectorAll('.opt'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false');
    });
    spawnSpark(btn);
    setFill((i + 1) / TOTAL);
    track('quiz_step_completed', { step: i + 1, question: q.key, answer: v });
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (S.answers[q.key] !== v || S.step !== i) return;
      goNext(i);
    }, ADVANCE_MS);
  }

  qNext.addEventListener('click', function () {
    var i = S.step, q = Q[i];
    if (!q || !isMulti(q) || !answered(q)) return;
    track('quiz_step_completed', { step: i + 1, question: q.key, answer: (S.answers[q.key] || []).join(',') });
    goNext(i);
  });

  qBack.addEventListener('click', function () {
    clearTimeout(timer);
    if (S.step <= 0) return;
    var prev = S.step - 1;
    S.editing = false;
    if (PTR > 0 && STACK[PTR - 1] === prev) { history.back(); return; }
    histReplace(prev);
    render(prev, { focus: true });
  });

  /* ---------- contact ---------- */
  function renderContact(opt, dir) {
    showView(vContact);
    if (RB) {
      vContact.classList.remove('q-in-f', 'q-in-b');
      void vContact.offsetWidth;
      vContact.classList.add('q-in-' + (dir || 'f'));
    }
    var dl = $('summary');
    dl.innerHTML = '';
    Q.forEach(function (q, i) {
      var item = el('div', { 'class': 'summary__item' });
      item.appendChild(el('dt', null, q.summary));
      var dd = el('dd');
      var b = el('button', { type: 'button', 'aria-label': q.summary + ': ' + labelsOf(q.key) + '. ' + T.contact.edit_hint });
      b.appendChild(el('b', null, q.summary + ':'));
      b.appendChild(el('span', null, ' ' + labelsOf(q.key)));
      b.addEventListener('click', function () { S.editing = true; histPush(i); render(i, { focus: true }); });
      dd.appendChild(b); item.appendChild(dd); dl.appendChild(item);
    });
    if (!S.formViewed) { S.formViewed = true; track('lead_form_view', {}); }
    if (opt.focus) { ensureQuizInView(); focusNoScroll($('contact-title')); }
  }

  function syncPhonePlaceholder() {
    fPhone.placeholder = fCountry.value === 'other' ? T.contact.phone_placeholder_other : T.contact.phone_placeholder;
  }
  fCountry.addEventListener('change', syncPhonePlaceholder);

  function messenger() {
    var r = form.elements.messenger;
    return (r && r.value) || 'whatsapp';
  }
  function syncMessenger() {
    var m = messenger();
    lblPhone.textContent = T.contact.phone_label[m] || T.contact.phone_label.whatsapp;
    tgField.hidden = m !== 'telegram';
    if (tgField.hidden) setErr(fTg, 'e-tg', '');
  }
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'messenger') syncMessenger();
  });

  function setErr(input, errId, msg) {
    var box = $(errId);
    box.textContent = msg || '';
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate() {
    var bad = [];
    var name = fName.value.trim().replace(/\s+/g, ' ');
    setErr(fName, 'e-name', name.length < 1 ? T.contact.err_name : '');
    if (name.length < 1) bad.push(fName);

    var raw = fPhone.value.trim();
    var code = fCountry.value;
    var digits = raw.replace(/\D/g, '');
    var whatsapp = null, iso = 'XX', phoneErr = '';
    if (!raw) phoneErr = T.contact.err_phone_required;
    else if (code === 'other') {
      if (raw.charAt(0) !== '+' || digits.length < 8 || digits.length > 15) phoneErr = T.contact.err_phone_other;
      else whatsapp = '+' + digits;
    } else {
      var cc = code.replace('+', '');
      if (raw.charAt(0) === '+' && digits.indexOf(cc) === 0) digits = digits.slice(cc.length);
      if (cc === '7' && digits.length === 11 && digits.charAt(0) === '8') digits = digits.slice(1);
      digits = digits.replace(/^0+/, '');
      if (digits.length < 6 || cc.length + digits.length > 15) phoneErr = T.contact.err_phone_invalid;
      else {
        whatsapp = '+' + cc + digits;
        var o = fCountry.options[fCountry.selectedIndex];
        iso = o ? o.getAttribute('data-iso') || 'XX' : 'XX';
      }
    }
    setErr(fPhone, 'e-phone', phoneErr);
    if (phoneErr) bad.push(fPhone);

    var msgr = messenger();
    var tg = fTg.value.trim().replace(/^@+/, '');
    var tgBad = msgr === 'telegram' && tg && !/^[A-Za-z0-9_]{5,32}$/.test(tg);
    setErr(fTg, 'e-tg', tgBad ? T.contact.err_tg : '');
    if (tgBad) bad.push(fTg);

    var email = fEmail.value.trim();
    var emailBad = email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    setErr(fEmail, 'e-email', emailBad ? T.contact.err_email : '');
    if (emailBad) bad.push(fEmail);

    setErr(fConsent, 'e-consent', fConsent.checked ? '' : T.contact.err_consent);
    if (!fConsent.checked) bad.push(fConsent);

    formAlert.textContent = bad.length ? T.contact.err_summary : '';
    if (bad.length) {
      focusNoScroll(bad[0]);
      bad[0].scrollIntoView({ block: 'center', behavior: REDUCE ? 'auto' : 'smooth' });
      return { ok: false, fields: bad.map(function (x) { return x.name; }) };
    }
    return { ok: true, data: {
      name: clip(name, 80),
      messenger: msgr,
      phone: whatsapp,
      tg_username: msgr === 'telegram' && tg ? '@' + tg : null,
      country: iso,
      email: clip(email, 120) || null
    } };
  }

  function buildPayload(d) {
    var ft = firstTouch();
    var p = {
      source: 'bpd',
      lead_id: S.leadId,
      submitted_at: new Date().toISOString(),
      landing_version: C.landing_version,
      language: T.meta.lang,
      name: d.name,
      messenger: d.messenger,
      phone: d.phone,
      tg_username: d.tg_username,
      country: d.country,
      email: d.email,
      goal: S.answers.goal || [],
      budget: S.answers.budget || null,
      area: S.answers.area || [],
      priority: S.answers.priority || [],
      timeline: S.answers.timeline || null,
      referrer: ft.referrer || null,
      landing_url: ft.landing_url || null,
      company: fCompany.value || ''
    };
    UTM_KEYS.forEach(function (k) { p[k] = (ft.utm && ft.utm[k]) || null; });
    return p;
  }

  function setBusy(on) {
    S.sending = on;
    submitBtn.disabled = on;
    submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    submitLabel.textContent = on ? T.contact.sending : T.contact.submit;
  }

  function send(d) {
    if (!S.leadId) { S.leadId = genLeadId(); persist(); }
    var payload = buildPayload(d);
    setBusy(true);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, C.relay_timeout_ms);
    fetch(C.relay_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      clearTimeout(to);
      if (res.ok && res.j && res.j.ok === true) onSuccess();
      else onFail('http_' + res.status);
    }).catch(function (err) {
      clearTimeout(to);
      onFail(err && err.name === 'AbortError' ? 'timeout' : 'network');
    });
  }

  function onSuccess() {
    S.done = true;
    setBusy(false);
    track('lead_created', { landing_version: C.landing_version, language: T.meta.lang });
    $('success-eyebrow').textContent = fmt(T.success.eyebrow, { id: S.leadId });
    var waLink = $('wa-link'), tgLink = $('tg-link');
    if (waLink) {
      waLink.hidden = !C.whatsapp_number;
      if (C.whatsapp_number) waLink.href = 'https://wa.me/' + C.whatsapp_number + '?text=' +
        encodeURIComponent(fmt(T.success.wa_prefill, { id: S.leadId }));
    }
    if (tgLink) {
      tgLink.hidden = !C.telegram_username;
      if (C.telegram_username) tgLink.href = 'https://t.me/' + C.telegram_username;
    }
    showView(vSuccess);
    form.reset();
    syncMessenger();
    sdel(KEY_SESSION);
    try { history.replaceState({ bpd: 'done' }, '', location.href); } catch (e) { /* noop */ }
    ensureQuizInView();
    focusNoScroll($('success-title'));
    updateSticky();
  }

  function onFail(reason) {
    setBusy(false);
    track('form_error', { type: 'delivery', reason: reason });
    var fw = $('fail-wa');
    if (fw) {
      fw.hidden = !C.whatsapp_number;
      if (C.whatsapp_number) {
        var parts = Q.map(function (q) { return q.summary + ': ' + labelsOf(q.key); });
        fw.href = 'https://wa.me/' + C.whatsapp_number + '?text=' +
          encodeURIComponent(fmt(T.fail.wa_prefill, { id: S.leadId || '—', summary: parts.join(' · ') }));
      }
    }
    showView(vFail);
    ensureQuizInView();
    focusNoScroll($('fail-title'));
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (S.sending || S.done) return;
    var v = validate();
    if (!v.ok) { track('form_error', { type: 'validation', fields: v.fields.join(',') }); return; }
    send(v.data);
  });
  var ERR_ID = { 'f-name': 'e-name', 'f-phone': 'e-phone', 'f-email': 'e-email', 'f-tg': 'e-tg' };
  [fName, fPhone, fEmail, fTg].forEach(function (inp) {
    inp.addEventListener('input', function () {
      if (inp.getAttribute('aria-invalid') === 'true') setErr(inp, ERR_ID[inp.id], '');
    });
  });
  fConsent.addEventListener('change', function () { if (fConsent.checked) setErr(fConsent, 'e-consent', ''); });

  var waBtn = $('wa-link'), tgBtn = $('tg-link'), failWaBtn = $('fail-wa');
  if (waBtn) waBtn.addEventListener('click', function () { track('whatsapp_click', { place: 'success' }); });
  if (tgBtn) tgBtn.addEventListener('click', function () { track('telegram_click', { place: 'success' }); });
  if (failWaBtn) failWaBtn.addEventListener('click', function () { track('whatsapp_click', { place: 'fail' }); });

  $('fail-retry').addEventListener('click', function () {
    showView(vContact);
    var v = validate();
    if (v.ok) send(v.data);
  });

  /* ---------- CTA links ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-cta]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      markStarted(a.getAttribute('data-cta'));
      var y = window.pageYOffset + quizSec.getBoundingClientRect().top - (topbar ? topbar.offsetHeight : 0) + 4;
      window.scrollTo({ top: y, behavior: REDUCE ? 'auto' : 'smooth' });
      var target = vStep.hidden ? (vContact.hidden ? null : $('contact-title')) : $('q-title');
      setTimeout(function () { focusNoScroll(target); }, REDUCE ? 0 : 420);
    });
  });

  /* ---------- spotlight + magnet (motion=reactbits, desktop pointer only) ---------- */
  if (RB && FINE) {
    var spotEl = null, spotX = 0, spotY = 0, spotPend = false;
    function applySpot() {
      spotPend = false;
      if (!spotEl) return;
      var r = spotEl.getBoundingClientRect();
      spotEl.style.setProperty('--mx', (spotX - r.left) + 'px');
      spotEl.style.setProperty('--my', (spotY - r.top) + 'px');
    }
    qBody.addEventListener('mousemove', function (e) {
      var c = e.target && e.target.closest ? e.target.closest('.opt') : null;
      if (!c) return;
      spotEl = c; spotX = e.clientX; spotY = e.clientY;
      if (!spotPend) { spotPend = true; requestAnimationFrame(applySpot); }
    }, { passive: true });

    var magEls = [document.querySelector('[data-cta="hero"]'), qNext, submitBtn].filter(Boolean);
    var magX = 0, magY = 0, magPend = false;
    function magTick() {
      magPend = false;
      magEls.forEach(function (b) {
        if (!b.offsetParent || b.disabled) {
          if (b.__mag) { b.style.transform = ''; b.__mag = false; }
          return;
        }
        var r = b.getBoundingClientRect();
        var dx = magX - (r.left + r.width / 2), dy = magY - (r.top + r.height / 2);
        if (Math.abs(dx) < r.width / 2 + 40 && Math.abs(dy) < r.height / 2 + 40) {
          var ox = Math.max(-4, Math.min(4, dx / 14)), oy = Math.max(-4, Math.min(4, dy / 14));
          b.style.transition = 'transform .25s ease-out';
          b.style.transform = 'translate3d(' + ox + 'px,' + oy + 'px,0)';
          b.__mag = true;
        } else if (b.__mag) {
          b.style.transition = 'transform .45s ease';
          b.style.transform = '';
          b.__mag = false;
        }
      });
    }
    window.addEventListener('mousemove', function (e) {
      magX = e.clientX; magY = e.clientY;
      if (!magPend) { magPend = true; requestAnimationFrame(magTick); }
    }, { passive: true });
  }

  /* ---------- areas: reveal chips when the row scrolls into view ---------- */
  var areasEl = document.querySelector('.areas');
  if (areasEl && RB && 'IntersectionObserver' in window) {
    var areasIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { areasEl.classList.add('is-in'); areasIo.disconnect(); }
      });
    }, { threshold: 0.25 });
    areasIo.observe(areasEl);
  } else if (areasEl) {
    areasEl.classList.add('is-in');
  }

  /* ---------- topbar + sticky CTA ---------- */
  var heroCta = document.querySelector('.hero__cta');
  var ticking = false;
  function updateSticky() {
    ticking = false;
    if (topbar) topbar.classList.toggle('is-solid', window.pageYOffset > 16);
    if (!sticky) return;
    var pastHero = heroCta ? heroCta.getBoundingClientRect().bottom < 0 : window.pageYOffset > 400;
    var quizTop = quizSec.getBoundingClientRect().top;
    var quizBottom = quizSec.getBoundingClientRect().bottom;
    var on = pastHero && (quizTop > window.innerHeight * 0.85 || quizBottom < window.innerHeight * 0.3) && !S.done;
    sticky.hidden = !on;
    sticky.classList.toggle('is-on', on);
    document.body.classList.toggle('has-sticky', on);
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(updateSticky); } }, { passive: true });
  window.addEventListener('resize', updateSticky, { passive: true });

  /* ---------- init ---------- */
  firstTouch();
  form.reset();
  var defCode = C.default_country;
  Array.prototype.forEach.call(fCountry.options, function (o) { if (o.value === defCode) fCountry.value = defCode; });
  syncPhonePlaceholder();
  syncMessenger();
  buildStepper();
  STACK = [S.step]; PTR = 0;
  try { history.replaceState({ bpd: S.step, seq: 0 }, '', location.href); } catch (e) { /* noop */ }
  render(S.step, { focus: false });
  updateSticky();
  track('page_view', { landing_version: C.landing_version, language: T.meta.lang });

  
})();
