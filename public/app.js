/* SB Truckin driver pay: single page app for drivers (mobile) and office (desktop + mobile). */
(() => {
  'use strict';

  // ---------- tiny helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  // html`...` escapes every value unless it is raw() or an array of html`` results.
  const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => {
    let v = i < vals.length ? vals[i] : '';
    if (Array.isArray(v)) v = v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v instanceof Raw) v = v.s;
    else if (v === false || v == null) v = '';
    else v = esc(v);
    return out + s + v;
  }, ''));

  const money = (n) => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hrs = (n) => Number(n || 0).toFixed(2);
  const pd = (s) => new Date(s + 'T00:00:00');
  const auDate = (s) => (s ? pd(s).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const nice = (s) => (s ? pd(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const short = (s) => (s ? pd(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
  const weekStart = (s) => { const d = pd(s); d.setDate(d.getDate() - d.getDay()); return iso(d); };
  const today = () => iso(new Date());
  const stamp = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const span = (a, b) => { const x = toMin(a); const y = toMin(b); if (x == null || y == null) return null; let d = y - x; if (d < 0) d += 1440; return d; };
  const STATUS = { submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', in_progress: 'This week', awaiting_rcti: 'Awaiting RCTI', rcti_issued: 'Payment pending', paid: 'Paid' };
  const pill = (s) => html`<span class="pill ${s}">${STATUS[s] || s}</span>`;

  async function api(path, opts = {}) {
    const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
    if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    const res = await fetch(path, o);
    if (res.status === 401 && path !== '/api/login') { state.me = null; render(); throw new Error('Please log in'); }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, err) {
    $('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }
  const fail = (e) => toast(e.message || String(e), true);

  function dialog(title, body, onMount) {
    const d = document.createElement('dialog');
    d.innerHTML = html`<div class="dh">${title}</div><div class="db">${body}</div>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.showModal();
    onMount && onMount(d);
    return d;
  }

  // ---------- icons & brand ----------
  const I = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    bank: '<path d="M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pay: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    dash: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    truck: '<path d="M1 6h13v10H1zM14 9h4l3 4v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    doc: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  };
  const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`);
  const logoSrc = () => (state.config.has_logo ? '/api/logo' : '/brand/sbt-logo-light.png');
  const brand = () => html`<a class="brand" href="#/"><img class="logo" src="${logoSrc()}" alt="SB"><span class="wordmark">TRUCKIN<small>Driver Pay</small></span></a>`;

  // ---------- state & routing ----------
  const state = { me: null, config: { has_logo: false }, cache: {} };
  const route = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
  window.addEventListener('hashchange', render);

  const DRIVER_TABS = [['/', 'Home', 'home'], ['/pay', 'My RCTIs', 'doc'], ['/profile', 'Profile', 'user']];
  const OFFICE_TABS = [['/', 'Dashboard', 'dash'], ['/entry', 'Enter times', 'clock'], ['/runsheets', 'Runsheets', 'list'], ['/rctis', 'Pay & RCTIs', 'doc'], ['/payments', 'Payments', 'bank'], ['/drivers', 'Drivers', 'truck'], ['/settings', 'Settings', 'cog'], ['/emails', 'Email log', 'mail']];

  function frame(content) {
    const r = '/' + (route().split('/')[1] || '');
    const me = state.me;
    const top = html`<header class="topbar">${brand()}<div class="spacer"></div><div class="who"><b>${me.name}</b>${me.role === 'office' ? 'Office' : 'Driver'}</div><button class="iconbtn" data-act="logout">Log out</button></header>`;
    if (me.role === 'driver') {
      return html`${top}<div class="driver"><main id="view">${content}</main></div>
        <nav class="tabbar">${DRIVER_TABS.map(([p, t, i, cls]) => html`<a href="#${p}" class="${r === p || (p === '/pay' && r === '/rcti') ? 'on' : ''} ${cls || ''}">${cls ? html`<span class="fab">${icon(i)}</span>` : icon(i)}${t}</a>`)}</nav>`;
    }
    return html`${top}<div class="shell"><nav class="side">${OFFICE_TABS.map(([p, t, i]) => html`<a href="#${p}" class="${r === p || (p === '/rctis' && r === '/rcti') || (p === '/drivers' && r === '/driver') || (p === '/runsheets' && r === '/runsheet') ? 'on' : ''}">${icon(i)}<span>${t}</span></a>`)}</nav><main id="view">${content}</main></div>`;
  }

  // Copy each column heading onto its cells so phones can show tables as labelled cards (see styles.css).
  function labelTables(root) {
    for (const t of root.querySelectorAll('.tablewrap table')) {
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      for (const tr of t.querySelectorAll('tbody tr, tfoot tr')) {
        let col = 0;
        for (const td of tr.children) {
          const span = Number(td.getAttribute('colspan') || 1);
          if (span > 1 && span >= heads.length - 1) td.classList.add('full');
          else if (span === 1 && heads[col]) td.dataset.label = heads[col];
          col += span;
        }
      }
    }
  }
  new MutationObserver(() => labelTables(document)).observe(document.getElementById('app'), { childList: true, subtree: true });

  async function render() {
    const app = $('#app');
    if (!state.me) { app.innerHTML = loginView(); bindLogin(); return; }
    const r = route();
    const parts = r.split('/').filter(Boolean);
    const views = state.me.role === 'driver' ? DRIVER : OFFICE;
    const view = views[parts[0] || ''] || views[''];
    app.innerHTML = frame(raw('<div class="spinner"></div>'));
    bindFrame();
    try {
      const out = await view(...parts.slice(1));
      if (route() !== r) return; // navigated away while loading
      $('#view').innerHTML = out.html ?? out;
      out.bind && out.bind($('#view'));
      window.scrollTo(0, 0);
    } catch (e) {
      if (state.me) $('#view').innerHTML = html`<div class="notice err">${e.message}</div>`;
    }
  }
  function bindFrame() {
    $('[data-act=logout]')?.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); state.me = null; location.hash = '#/'; render(); });
  }

  // ---------- login ----------
  function loginView() {
    return html`<div class="login"><div class="box">
      <div class="hero"><img class="logo" src="${logoSrc()}" alt="SB"><div class="wordmark">TRUCKIN<small>Driver Pay &amp; Runsheets</small></div></div>
      <form class="card" id="loginForm">
        <h2>Sign in</h2>
        <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div id="loginErr"></div>
        <button class="btn block xl">Sign in</button>
        <p class="small muted" style="text-align:center;margin:14px 0 0">Drivers: your login comes from the SB Truckin office.</p>
      </form><div class="road"></div></div></div>`.s;
  }
  function bindLogin() {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
        state.me = await api('/api/me');
        location.hash = '#/';
        render();
      } catch (err) { $('#loginErr').innerHTML = html`<div class="notice err">${err.message}</div>`; }
    });
  }

  // =====================================================================
  // DRIVER
  // =====================================================================
  const DRIVER = {
    async ''() {
      const rctis = await api('/api/rctis');
      const owed = rctis.filter((r) => !r.paid_at).reduce((a, r) => a + r.total, 0);
      const paid = rctis.filter((r) => r.paid_at).reduce((a, r) => a + r.total, 0);
      return html`
        <h1 style="margin-top:4px">G'day, ${state.me.name.split(' ')[0]}</h1>
        <div class="paycards">
          <div class="stat amber"><div class="k">Unpaid</div><div class="v">${money(owed)}</div><div class="s">On RCTIs not paid yet</div></div>
          <div class="stat dark"><div class="k">Paid</div><div class="v">${money(paid)}</div><div class="s">Paid to your account</div></div>
        </div>
        <div class="card flush"><div style="padding:16px 16px 0"><h2>Latest RCTIs</h2></div>${rctiList(rctis.slice(0, 4))}
          ${rctis.length > 4 ? html`<div style="padding:0 16px 16px"><a class="btn ghost sm" href="#/pay">See all RCTIs</a></div>` : ''}</div>
        <p class="small muted">The office enters your hours from your runsheets. Each week's RCTI shows here once the office sends it to you.</p>`;
    },

    async pay() {
      const rctis = await api('/api/rctis');
      return html`<h1>My RCTIs</h1>
        <div class="card flush">${rctiList(rctis)}</div>
        <p class="small muted">Weeks run Sunday to Saturday. Your rate includes GST if you're registered. Something wrong? Call the office.</p>`;
    },

    async rcti(id) {
      const r = await api('/api/rctis/' + id);
      return html`<a href="#/pay" class="muted small">← My RCTIs</a><h1 style="margin-top:8px">${r.number}</h1>
        <div class="card"><div>${r.paid_at ? html`<span class="pill paid">Paid ${auDate(r.paid_at)}</span>` : html`<span class="pill rcti_issued">Unpaid</span>`}</div>
          <dl class="kv" style="margin-top:14px"><dt>Week</dt><dd>${short(r.period_start)} – ${short(r.period_end)}</dd><dt>Hours</dt><dd>${hrs(r.total_hours)}</dd>
            <dt>Ex GST</dt><dd>${money(r.subtotal)}</dd><dt>GST</dt><dd>${money(r.gst)}</dd><dt>Total</dt><dd><b>${money(r.total)}</b></dd></dl>
          <a class="btn dark block" href="/api/rctis/${r.id}/pdf" target="_blank" style="margin-top:14px">View PDF</a></div>
        <div class="card flush"><div class="tablewrap"><table><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Breaks (not deducted)</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>
          <tbody>${r.runsheets.map((s) => html`<tr><td>${nice(s.work_date)}</td><td>${s.start_time}</td><td>${s.finish_time}</td><td class="muted">${s.breaks.map((b) => `${b.start}–${b.end}`).join(', ') || '—'}</td><td class="num">${hrs(s.hours)}</td><td class="num">${money(s.amount)}</td></tr>`)}</tbody></table></div></div>
        <p class="small muted">Only the office can change an RCTI. Call them if something is wrong.</p>`;
    },

    async profile() {
      const me = await api('/api/me');
      state.me = me;
      return {
        html: html`<h1>Profile</h1>
          <div class="card"><h2>Details on your RCTI</h2><dl class="kv">
            <dt>Name</dt><dd>${me.name}</dd><dt>Business</dt><dd>${me.business_name || '—'}</dd><dt>ABN</dt><dd>${me.abn || '—'}</dd>
            <dt>GST</dt><dd>${me.gst_registered ? 'Registered' : 'Not registered'}</dd><dt>Address</dt><dd>${me.address || '—'}</dd>
            <dt>Mobile</dt><dd>${me.phone || '—'}</dd><dt>Hourly rate</dt><dd>${money(me.hourly_rate)}/hr incl. GST</dd></dl></div>
          <div class="card"><h2>Pay into</h2><dl class="kv"><dt>Account name</dt><dd>${me.bank_account_name || '—'}</dd><dt>BSB</dt><dd>${me.bank_bsb || '—'}</dd><dt>Account</dt><dd>${me.bank_account_number ? '•••• ' + me.bank_account_number.slice(-4) : '—'}</dd></dl>
            <p class="small muted">To change any of these, contact the SB Truckin office.</p></div>
          ${passwordCard()}`,
        bind: bindPassword,
      };
    },
  };

  function rctiList(rctis) {
    if (!rctis.length) return html`<div class="empty">Your RCTIs will appear here once the office sends them.</div>`;
    return html`<ul class="list">${rctis.map((r) => html`<li><a class="row" href="#/rcti/${r.id}"><div class="grow"><b>${short(r.period_start)} – ${short(r.period_end)}</b><div class="small muted">${r.number} · ${hrs(r.total_hours)} hrs</div>
      <div style="margin-top:4px">${r.paid_at ? html`<span class="pill paid">Paid ${auDate(r.paid_at)}</span>` : html`<span class="pill rcti_issued">Unpaid</span>`}</div></div><div class="amount">${money(r.total)}</div></a></li>`)}</ul>`;
  }

  function passwordCard() {
    return html`<form class="card" id="pwForm"><h2>Change password</h2>
      <div class="field"><label>Current password</label><input type="password" name="current" required autocomplete="current-password"></div>
      <div class="field"><label>New password</label><input type="password" name="next" required minlength="8" autocomplete="new-password"></div>
      <button class="btn dark">Update password</button></form>`;
  }
  function bindPassword(v) {
    $('#pwForm', v)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: { current: e.target.current.value, next: e.target.next.value } }); e.target.reset(); toast('Password updated'); } catch (err) { fail(err); }
    });
  }

  function confirmDialog(title, body, okLabel = 'OK', danger) {
    return new Promise((resolve) => {
      let answered = false;
      dialog(title, html`${body}<div class="actions" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${okLabel}</button></div>`, (d) => {
        $('[data-no]', d).onclick = () => d.close();
        $('[data-yes]', d).onclick = () => { answered = true; d.close(); };
        d.addEventListener('close', () => resolve(answered));
      });
    });
  }

  // =====================================================================
  // OFFICE
  // =====================================================================
  async function drivers() {
    if (!state.cache.drivers) state.cache.drivers = await api('/api/drivers');
    return state.cache.drivers;
  }

  const OFFICE = {
    async ''() {
      const d = await api('/api/office/dashboard');
      return html`<h1>Dashboard</h1>
        ${state.config.storage_safe === false ? html`<div class="notice err"><b>Data is not being kept.</b> No storage volume is attached in Railway, so drivers, runsheets and RCTIs are wiped every time a new version goes live.</div>` : ''}
        ${d.missing_details.length ? html`<div class="notice warn"><b>Missing RCTI details:</b> ${d.missing_details.map((x, i) => html`${i ? ', ' : ''}<a href="#/driver/${x.id}">${x.name}</a>`)} need a rate, ABN or bank details before their RCTIs are complete.</div>` : ''}
        <div class="grid g4" style="margin-bottom:16px">
          <div class="stat dark"><div class="k">This week</div><div class="v">${hrs(d.this_week.hours)}<span style="font-size:16px"> hrs</span></div><div class="s">${d.this_week.n} runsheets · ${money(d.this_week.amount)}</div></div>
          <a class="stat amber" href="#/rctis" style="text-decoration:none"><div class="k">Unpaid RCTIs</div><div class="v">${d.unpaid_rctis.n}</div><div class="s">${money(d.unpaid_rctis.total)} owing</div></a>
          <a class="stat" href="#/rctis" style="text-decoration:none"><div class="k">Not sent yet</div><div class="v">${d.not_pushed}</div><div class="s">Drivers can't see these</div></a>
          <a class="stat" href="#/payments" style="text-decoration:none"><div class="k">Paid this month</div><div class="v">${money(d.paid_month.total)}</div><div class="s">${d.paid_month.n} RCTIs</div></a>
        </div>
        <div class="grid g2 stack">
          <div class="card"><h2>Last week</h2><p class="muted" style="margin-top:-6px">${short(d.last_week.start)} – ${short(d.last_week.end)}</p>
            <div class="grid g2"><div><div class="muted small">Hours</div><div class="amount">${hrs(d.last_week.hours)}</div></div><div><div class="muted small">Amount</div><div class="amount">${money(d.last_week.amount)}</div></div></div>
            ${d.uninvoiced_past ? html`<div class="notice warn" style="margin-top:14px">${d.uninvoiced_past} runsheet(s) from past weeks are not on an RCTI yet.</div>` : ''}
            <a class="btn dark" href="#/rctis?week=${d.last_week.start}" style="margin-top:12px">Open last week's RCTIs</a></div>
          <div class="card"><h2>Quick links</h2><div class="actions">
            <a class="btn" href="#/entry">Enter driver times</a><a class="btn ghost" href="#/payments">Payments for BAS</a><a class="btn ghost" href="#/drivers">Drivers &amp; rates</a></div>
            <p class="small muted" style="margin-top:14px">Enter each driver's week from their runsheets, then press Finish week to make the RCTI and send it on WhatsApp. Anything left over is made into RCTIs automatically every Sunday at 1am. Drivers only see an RCTI once you send it.</p></div>
        </div>`;
    },

    async runsheets() {
      const q = query();
      const ds = await drivers();
      const wk = q.get('week') || '';
      const params = new URLSearchParams();
      for (const k of ['driver_id', 'status']) if (q.get(k)) params.set(k, q.get(k));
      if (wk) { params.set('from', wk); params.set('to', addDays(wk, 6)); }
      const rows = await api('/api/runsheets?' + params);
      const tot = rows.filter((r) => r.status !== 'rejected').reduce((a, r) => ({ h: a.h + r.hours, m: a.m + r.amount }), { h: 0, m: 0 });
      return {
        html: html`<div class="toolbar"><h1 style="margin:0">Runsheets</h1>
            <div class="filters">
              <select data-f="driver_id"><option value="">All drivers</option>${ds.map((d) => html`<option value="${d.id}" ${String(d.id) === q.get('driver_id') ? 'selected' : ''}>${d.name}</option>`)}</select>
              <select data-f="status"><option value="">Any status</option>${['submitted', 'approved', 'rejected'].map((s) => html`<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${STATUS[s]}</option>`)}</select>
              <input type="date" data-f="week" value="${wk}" title="Week containing this date">
              <a class="btn sm dark" href="#/entry${q.get('driver_id') ? '?driver_id=' + q.get('driver_id') : ''}">+ Enter times</a>
            </div></div>
          <div class="card flush"><div class="tablewrap"><table>
            <thead><tr><th>Date</th><th>Driver</th><th>Start</th><th>Finish</th><th>Breaks</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th><th>Status</th><th>RCTI</th><th></th></tr></thead>
            <tbody>${rows.length ? rows.map((r) => html`<tr class="click" data-go="#/runsheet/${r.id}"><td class="nowrap">${nice(r.work_date)}</td><td>${r.driver_name}</td><td>${r.start_time}</td><td>${r.finish_time}</td><td class="muted">${r.break_minutes ? r.break_minutes + ' min' : '—'}</td><td class="num">${hrs(r.hours)}</td><td class="num">${money(r.rate)}</td><td class="num">${money(r.amount)}</td><td>${pill(r.status)}</td><td class="small">${r.rcti_number ? r.rcti_number + (r.rcti_paid_at ? ' ✓' : '') : '—'}</td><td class="nowrap"><a class="btn sm ghost" href="#/runsheet/${r.id}">Edit</a> <button type="button" class="btn sm danger" data-del="${r.id}">Delete</button></td></tr>`) : html`<tr><td colspan="11" class="empty">No runsheets match.</td></tr>`}</tbody>
            ${rows.length ? html`<tfoot><tr><td colspan="5">${rows.length} runsheets (excl. rejected in totals)</td><td class="num">${hrs(tot.h)}</td><td></td><td class="num">${money(tot.m)}</td><td colspan="3"></td></tr></tfoot>` : ''}
          </table></div></div>`,
        bind(v) {
          $$('[data-f]', v).forEach((el) => el.addEventListener('change', () => {
            const p = new URLSearchParams(location.hash.split('?')[1] || '');
            let val = el.value;
            if (el.dataset.f === 'week' && val) val = weekStart(val);
            val ? p.set(el.dataset.f, val) : p.delete(el.dataset.f);
            location.hash = '#/runsheets?' + p;
          }));
          bindRows(v);
          $$('[data-del]', v).forEach((b) => (b.onclick = () => deleteRunsheet(rows.find((x) => String(x.id) === b.dataset.del), render)));
        },
      };
    },

    async runsheet(id) {
      const r = await api('/api/runsheets/' + id);
      const paidRcti = r.rcti_id && (await api('/api/rctis/' + r.rcti_id)).paid_at;
      return {
        html: html`<a href="#/runsheets" class="muted small">← Runsheets</a>
          <div class="toolbar" style="margin-top:8px"><h1 style="margin:0">${r.driver_name} · ${nice(r.work_date)}</h1><div>${pill(r.status)}</div></div>
          ${paidRcti ? html`<div class="notice warn">This runsheet is on an RCTI that's already marked paid. You can still change or delete it, and the RCTI total will update, so check what was paid.</div>` : ''}
          <div class="split">
            <div>${r.has_photo ? html`<div class="photo-frame"><img src="/api/runsheets/${r.id}/photo" alt="Runsheet photo" onclick="window.open(this.src)"></div><p class="small muted">Tap the photo to open it full size.</p>` : html`<div class="card empty">No runsheet photo attached</div>`}
              ${r.extracted ? html`<div class="card small"><b>Read from photo:</b> ${r.extracted.start_time || '?'} – ${r.extracted.finish_time || '?'}, breaks ${(r.extracted.breaks || []).map((b) => `${b.start}–${b.end}`).join(', ') || 'none'} (${r.extracted.confidence} confidence)</div>` : ''}
            </div>
            <form class="card" id="edit">
              <h2>Runsheet</h2>
              <div class="grid g3"><div class="field"><label>Date</label><input type="date" name="work_date" value="${r.work_date}"></div><div class="field"><label>Start</label><input type="time" name="start_time" value="${r.start_time}"></div><div class="field"><label>Finish</label><input type="time" name="finish_time" value="${r.finish_time}"></div></div>
              <label>Breaks <span class="muted">(shown, not deducted)</span></label>
              <div class="breaks" id="breaks"></div>
              <button type="button" class="btn ghost sm" id="addBreak" style="margin-bottom:14px">+ Add break</button>
              <div class="grid g2"><div class="field"><label>Rate ($/hr)</label><input type="number" step="0.01" min="0" name="rate" value="${r.rate}"></div><div class="field"><label>Truck rego</label><input name="truck_rego" value="${r.truck_rego || ''}"></div></div>
              <div class="calcbox" id="calc"></div>
              <div class="field"><label>Driver notes</label><textarea name="notes">${r.notes || ''}</textarea></div>
              <div class="field"><label>Office notes <span class="muted">(driver can see these)</span></label><textarea name="office_notes">${r.office_notes || ''}</textarea></div>
              <div class="field"><label>Status</label><select name="status">${['submitted', 'approved', 'rejected'].map((s) => html`<option value="${s}" ${r.status === s ? 'selected' : ''}>${STATUS[s]}</option>`)}</select></div>
              <div class="actions"><button class="btn">Save changes</button>${r.status !== 'approved' ? html`<button type="button" class="btn green" id="approve">Approve</button>` : ''}
                <button type="button" class="btn ghost sm" id="resend">Email to office</button><button type="button" class="btn danger sm" id="del">Delete</button></div>
              <p class="small muted" style="margin-top:12px">Submitted ${stamp(r.submitted_at)}${r.office_emailed_at ? ` · emailed to office ${stamp(r.office_emailed_at)}` : ''}${r.rcti_id ? ' · on an RCTI (saving re-totals it)' : ''}</p>
            </form>
          </div>`,
        bind(v) {
          const f = $('#edit', v);
          const addBreak = (b = {}) => {
            const row = document.createElement('div');
            row.className = 'brk';
            row.innerHTML = html`<div><input type="time" class="bs" value="${b.start || ''}"></div><div><input type="time" class="be" value="${b.end || ''}"></div><button type="button" class="btn danger sm">✕</button>`.s;
            row.querySelector('button').onclick = () => { row.remove(); calc(); };
            row.querySelectorAll('input').forEach((i) => i.addEventListener('input', calc));
            $('#breaks', v).appendChild(row);
          };
          const breaks = () => $$('.brk', v).map((x) => ({ start: $('.bs', x).value, end: $('.be', x).value })).filter((b) => b.start && b.end);
          const calc = () => {
            const m = span(f.start_time.value, f.finish_time.value);
            const bm = breaks().reduce((a, b) => a + (span(b.start, b.end) || 0), 0);
            $('#calc', v).innerHTML = m == null ? '' : html`<div class="big">${hrs(m / 60)} hrs</div><div class="row"><span>Breaks ${bm} min (not deducted)</span><span style="color:#fff;font-weight:700">${money(Math.round(m / 60 * 100) / 100 * (+f.rate.value || 0))}</span></div>`.s;
          };
          r.breaks.forEach(addBreak);
          calc();
          ['start_time', 'finish_time', 'rate'].forEach((n) => f[n].addEventListener('input', calc));
          $('#addBreak', v).onclick = () => addBreak();
          const save = async (extra = {}) => {
            await api('/api/runsheets/' + r.id, { method: 'PUT', body: { work_date: f.work_date.value, start_time: f.start_time.value, finish_time: f.finish_time.value, breaks: breaks(), rate: +f.rate.value, truck_rego: f.truck_rego.value, notes: f.notes.value, office_notes: f.office_notes.value, status: f.status.value, ...extra } });
          };
          f.addEventListener('submit', async (e) => { e.preventDefault(); try { await save(); toast('Saved'); render(); } catch (err) { fail(err); } });
          $('#approve', v) && ($('#approve', v).onclick = async () => { try { await save({ status: 'approved' }); toast('Approved'); render(); } catch (err) { fail(err); } });
          $('#resend', v).onclick = async () => { try { const o = await api(`/api/runsheets/${r.id}/email-office`, { method: 'POST' }); emailToast(o); } catch (err) { fail(err); } };
          $('#del', v).onclick = () => deleteRunsheet(r, () => { location.hash = '#/runsheets'; });
        },
      };
    },

    async rctis() {
      const wk = weekStart(query().get('week') || addDays(weekStart(today()), -7));
      const [list, sheets, ds] = await Promise.all([api('/api/rctis?week=' + wk), api(`/api/runsheets?from=${wk}&to=${addDays(wk, 6)}&limit=1000`), drivers()]);
      const byDriver = new Map();
      for (const s of sheets) {
        if (s.status === 'rejected') continue;
        const x = byDriver.get(s.driver_id) || { name: s.driver_name, n: 0, h: 0, m: 0, open: 0 };
        x.n++; x.h += s.hours; x.m += s.amount; if (!s.rcti_id) x.open++;
        byDriver.set(s.driver_id, x);
      }
      const openDrivers = [...byDriver.entries()].filter(([, x]) => x.open);
      return {
        html: html`<div class="toolbar"><h1 style="margin:0">Pay &amp; RCTIs</h1>
            <div class="weeknav"><a class="btn ghost sm" href="#/rctis?week=${addDays(wk, -7)}">◀</a><b>${short(wk)} – ${short(addDays(wk, 6))}</b><a class="btn ghost sm" href="#/rctis?week=${addDays(wk, 7)}">▶</a></div></div>
          ${openDrivers.length ? html`<div class="card"><h2>Ready to invoice</h2>
            <p class="muted" style="margin-top:-6px">${openDrivers.map(([, x], i) => html`${i ? ', ' : ''}${x.name} (${x.open})`)} have runsheets this week not yet on an RCTI.${wk >= weekStart(today()) ? ' This week is still running.' : ''}</p>
            <div class="actions"><button class="btn" id="gen">Create RCTIs for this week</button><label class="check small"><input type="checkbox" id="genMail" checked> Email office copies</label></div></div>` : ''}
          <div class="card flush"><div class="tablewrap"><table>
            <thead><tr><th>RCTI</th><th>Driver</th><th class="num">Days</th><th class="num">Hours</th><th class="num">Ex GST</th><th class="num">GST</th><th class="num">Total</th><th>Office copy</th><th>Send to driver</th><th>Paid</th><th></th></tr></thead>
            <tbody>${list.length ? list.map((r) => html`<tr>
              <td><a href="#/rcti/${r.id}"><b>${r.number}</b></a></td><td>${r.driver_name}</td><td class="num">${r.runsheet_count}</td><td class="num">${hrs(r.total_hours)}</td><td class="num">${money(r.subtotal)}</td><td class="num">${money(r.gst)}</td><td class="num"><b>${money(r.total)}</b></td>
              <td>${r.office_emailed_at ? html`<span class="pill approved">Emailed</span>` : html`<button class="btn sm ghost" data-mail="${r.id}">Email</button>`}</td>
              <td class="nowrap"><button class="btn sm wa" data-wa="${r.id}">WhatsApp</button> ${r.pushed_at ? html`<span class="pill paid">Sent</span>` : html`<button class="btn sm ghost" data-push="${r.id}">In app</button>`}</td>
              <td class="nowrap">${r.paid_at ? html`<span class="pill paid">Paid ${auDate(r.paid_at)}</span> <button class="btn sm ghost" data-unpaid="${r.id}">Unpaid</button>` : html`<span class="pill rcti_issued">Unpaid</span> <button class="btn sm green" data-paid="${r.id}">Mark paid</button>`}</td>
              <td><a class="btn sm ghost" href="/api/rctis/${r.id}/pdf" target="_blank">PDF</a></td></tr>`) : html`<tr><td colspan="11" class="empty">No RCTIs for this week yet.</td></tr>`}</tbody>
            ${list.length ? html`<tfoot><tr><td colspan="3">${list.length} RCTIs</td><td class="num">${hrs(list.reduce((a, r) => a + r.total_hours, 0))}</td><td class="num">${money(list.reduce((a, r) => a + r.subtotal, 0))}</td><td class="num">${money(list.reduce((a, r) => a + r.gst, 0))}</td><td class="num">${money(list.reduce((a, r) => a + r.total, 0))}</td><td colspan="4"></td></tr></tfoot>` : ''}
          </table></div></div>
          ${list.some((r) => !r.pushed_at) ? html`<div class="actions"><button class="btn dark" id="pushAll">Show all in drivers' app</button></div>` : ''}`,
        bind(v) {
          $('#gen', v) && ($('#gen', v).onclick = async () => {
            try {
              const o = await api('/api/rctis/generate', { method: 'POST', body: { week: wk, email_office: $('#genMail', v).checked } });
              toast(`${o.created} RCTI(s) created`);
              if (o.emailed) emailToast(o.emailed);
              render();
            } catch (err) { fail(err); }
          });
          $$('[data-mail]', v).forEach((b) => (b.onclick = async () => { try { emailToast(await api(`/api/rctis/${b.dataset.mail}/email-office`, { method: 'POST' })); render(); } catch (err) { fail(err); } }));
          $$('[data-push]', v).forEach((b) => (b.onclick = () => pushDialog([b.dataset.push])));
          $$('[data-paid]', v).forEach((b) => (b.onclick = () => paidDialog(b.dataset.paid)));
          $$('[data-unpaid]', v).forEach((b) => (b.onclick = () => markUnpaid(b.dataset.unpaid)));
          $$('[data-wa]', v).forEach((b) => (b.onclick = () => waDialog(b.dataset.wa)));
          $('#pushAll', v) && ($('#pushAll', v).onclick = () => pushDialog(list.filter((r) => !r.pushed_at).map((r) => r.id)));
        },
      };
    },

    async rcti(id) {
      const r = await api('/api/rctis/' + id);
      return {
        html: html`<a href="#/rctis?week=${r.period_start}" class="muted small">← Pay &amp; RCTIs</a>
          <div class="toolbar" style="margin-top:8px"><h1 style="margin:0">${r.number} · ${r.driver_name}</h1>
            <div class="actions">${r.paid_at ? html`<span class="pill paid">Paid ${auDate(r.paid_at)}${r.payment_ref ? ' · ' + r.payment_ref : ''}</span>` : html`<span class="pill rcti_issued">Unpaid</span>`} ${r.pushed_at ? html`<span class="pill paid">Sent to driver</span>` : html`<span class="pill">Not sent to driver</span>`}</div></div>
          <div class="grid g4" style="margin-bottom:16px">
            <div class="stat"><div class="k">Week</div><div class="v" style="font-size:22px">${short(r.period_start)} – ${short(r.period_end)}</div></div>
            <div class="stat"><div class="k">Hours</div><div class="v">${hrs(r.total_hours)}</div></div>
            <div class="stat"><div class="k">GST</div><div class="v">${money(r.gst)}</div></div>
            <div class="stat dark"><div class="k">Total</div><div class="v">${money(r.total)}</div></div>
          </div>
          <div class="card actions">
            <button class="btn wa" id="wa">Send on WhatsApp</button>
            <a class="btn dark" href="/api/rctis/${r.id}/pdf" target="_blank">View PDF</a>
            <button class="btn ghost" id="mail">Email office copy</button>
            ${r.pushed_at ? html`<button class="btn ghost" id="unpush">Hide from driver</button>` : html`<button class="btn ghost" id="push">Show in driver's app</button>`}
            ${r.paid_at ? html`<button class="btn ghost" id="unpaid">Mark unpaid</button>` : html`<button class="btn green" id="paid">Mark paid</button>`}
            ${!r.paid_at ? html`<button class="btn ghost" id="rebuild" title="Re-total after edits and pick up late runsheets">Re-total</button><button class="btn danger" id="void">Void RCTI</button>` : ''}
          </div>
          <div class="card flush"><div class="tablewrap"><table><thead><tr><th>Date</th><th>Start</th><th>Finish</th><th>Breaks (not deducted)</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${r.runsheets.map((s) => html`<tr class="click" data-go="#/runsheet/${s.id}"><td>${nice(s.work_date)}</td><td>${s.start_time}</td><td>${s.finish_time}</td><td class="muted">${s.breaks.map((b) => `${b.start}–${b.end}`).join(', ') || '—'}</td><td class="num">${hrs(s.hours)}</td><td class="num">${money(s.rate)}</td><td class="num">${money(s.amount)}</td><td>${pill(s.status)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="4">Subtotal ${money(r.subtotal)} + GST ${money(r.gst)}</td><td class="num">${hrs(r.total_hours)}</td><td></td><td class="num">${money(r.total)}</td><td></td></tr></tfoot></table></div></div>`,
        bind(v) {
          bindRows(v);
          const act = (sel, fn) => { const b = $(sel, v); if (b) b.onclick = async () => { try { await fn(); } catch (err) { fail(err); } }; };
          act('#mail', async () => { emailToast(await api(`/api/rctis/${r.id}/email-office`, { method: 'POST' })); render(); });
          act('#push', async () => pushDialog([r.id]));
          act('#unpush', async () => { await api(`/api/rctis/${r.id}/unpush`, { method: 'POST' }); toast('Hidden from driver'); render(); });
          act('#paid', async () => paidDialog(r.id));
          act('#unpaid', async () => markUnpaid(r.id));
          act('#wa', async () => waDialog(r.id));
          act('#rebuild', async () => { await api(`/api/rctis/${r.id}/rebuild`, { method: 'POST' }); toast('RCTI re-totalled'); render(); });
          act('#void', async () => {
            if (!(await confirmDialog('Void this RCTI?', html`<p>${r.number} will be deleted and its runsheets released so a new RCTI can be created.</p>`, 'Void', true))) return;
            await api('/api/rctis/' + r.id, { method: 'DELETE' }); toast('RCTI voided'); location.hash = '#/rctis?week=' + r.period_start;
          });
        },
      };
    },

    // Office types a driver's week straight off the runsheets: one row per day, Sunday to Saturday.
    async entry() {
      const q = query();
      const ds = (await drivers()).filter((x) => x.active);
      const wk = weekStart(q.get('week') || today());
      const d = ds.find((x) => String(x.id) === q.get('driver_id'));
      const [sheets, rctis] = d ? await Promise.all([api(`/api/runsheets?driver_id=${d.id}&from=${wk}&to=${addDays(wk, 6)}&limit=100`), api(`/api/rctis?driver_id=${d.id}&week=${wk}`)]) : [[], []];
      const rows = [];
      for (let i = 0; i < 7; i++) {
        const day = addDays(wk, i);
        const got = sheets.filter((s) => s.work_date === day && s.status !== 'rejected').sort((a, b) => a.start_time.localeCompare(b.start_time));
        if (got.length) rows.push(...got); else rows.push({ work_date: day });
      }
      const link = (p) => '#/entry?' + new URLSearchParams({ ...(d ? { driver_id: d.id } : {}), week: p });
      const row = (s) => {
        const lock = s.breaks && s.breaks.length > 1;
        const b = (s.breaks && s.breaks[0]) || {};
        return html`<tr data-date="${s.work_date}" data-id="${s.id || ''}" data-rate="${s.id ? s.rate : d.hourly_rate}" ${lock ? 'data-lock="1"' : ''}>
          <td class="nowrap"><b>${nice(s.work_date)}</b></td>
          <td><input type="time" class="st" value="${s.start_time || ''}"></td><td><input type="time" class="fi" value="${s.finish_time || ''}"></td>
          <td>${lock ? html`<span class="small muted">${s.breaks.map((x) => `${x.start}–${x.end}`).join(', ')}</span>` : html`<div class="brkpair"><input type="time" class="bs" value="${b.start || ''}"><span>to</span><input type="time" class="be" value="${b.end || ''}"></div>`}</td>
          <td class="num hh">—</td><td class="num am">—</td>
          <td class="nowrap">${s.id ? html`${s.rcti_number ? html`<span class="pill approved">${s.rcti_number}</span> ` : ''}<button type="button" class="btn sm danger" data-del="${s.id}" title="Delete this day">✕</button>` : ''}</td></tr>`;
      };
      return {
        html: html`<div class="toolbar"><h1 style="margin:0">Enter times</h1>
            <div class="weeknav"><a class="btn ghost sm" href="${link(addDays(wk, -7))}">◀</a><b>${short(wk)} – ${short(addDays(wk, 6))}</b><a class="btn ghost sm" href="${link(addDays(wk, 7))}">▶</a></div></div>
          <div class="card"><div class="field" style="margin:0"><label>Driver</label><select id="drv"><option value="">Pick a driver…</option>${ds.map((x) => html`<option value="${x.id}" ${d && x.id === d.id ? 'selected' : ''}>${x.name}</option>`)}</select></div>
            ${d && !d.hourly_rate ? html`<div class="notice warn" style="margin:12px 0 0">${d.name} has no hourly rate yet. <a href="#/driver/${d.id}">Set it on their page</a> first.</div>` : ''}</div>
          ${d ? html`
            ${rctis.length ? html`<div class="notice info">This week already has ${rctis.map((r, i) => html`${i ? ', ' : ''}<a href="#/rcti/${r.id}">${r.number}</a>${r.paid_at ? ' (paid)' : ''}`)}. Saving changes re-totals it.</div>` : ''}
            <div class="card flush"><div class="tablewrap"><table class="entry">
              <thead><tr><th>Day</th><th>Start</th><th>Finish</th><th>Break</th><th class="num">Hours</th><th class="num">Amount</th><th></th></tr></thead>
              <tbody>${rows.map(row)}</tbody>
              <tfoot><tr><td colspan="4">Week total at ${money(d.hourly_rate)}/hr incl. GST</td><td class="num" id="tH">0.00</td><td class="num" id="tA">$0.00</td><td></td></tr></tfoot>
            </table></div></div>
            <p class="small muted">Leave a day blank if they didn't work. Paid hours run start to finish; the break is recorded only.</p>
            <div class="actions"><button class="btn ghost xl" id="save">Save week</button><button class="btn xl" id="finish">Finish week &amp; make RCTI</button></div>` : html`<div class="empty card">Pick a driver to enter their week.</div>`}`,
        bind(v) {
          $('#drv', v).onchange = (e) => { location.hash = '#/entry?' + new URLSearchParams({ ...(e.target.value ? { driver_id: e.target.value } : {}), week: wk }); };
          if (!d) return;
          const trs = $$('tbody tr', v);
          const calc = () => {
            let th = 0; let ta = 0;
            for (const tr of trs) {
              const m = span($('.st', tr).value, $('.fi', tr).value);
              const h = m ? Math.round(m / 60 * 100) / 100 : 0;
              const a = Math.round(h * Number(tr.dataset.rate || 0) * 100) / 100;
              $('.hh', tr).textContent = h ? hrs(h) : '—';
              $('.am', tr).textContent = h ? money(a) : '—';
              th += h; ta += a;
            }
            $('#tH', v).textContent = hrs(th);
            $('#tA', v).textContent = money(ta);
          };
          $$('input', v).forEach((i) => i.addEventListener('input', calc));
          calc();
          $$('[data-del]', v).forEach((b) => (b.onclick = () => deleteRunsheet(sheets.find((x) => String(x.id) === b.dataset.del), render)));
          const save = async () => {
            const days = [];
            for (const tr of trs) {
              const st = $('.st', tr).value; const fi = $('.fi', tr).value;
              if (!st && !fi) continue;
              if (!st || !fi) throw new Error(`${nice(tr.dataset.date)}: enter both start and finish`);
              const x = { work_date: tr.dataset.date, start_time: st, finish_time: fi };
              if (tr.dataset.id) x.id = Number(tr.dataset.id);
              if (!tr.dataset.lock) { const bs = $('.bs', tr).value; const be = $('.be', tr).value; x.breaks = bs && be ? [{ start: bs, end: be }] : []; }
              days.push(x);
            }
            if (!days.length) throw new Error('Enter at least one day');
            return api('/api/runsheets/week', { method: 'POST', body: { driver_id: d.id, week: wk, days } });
          };
          const busy = (on) => { $('#save', v).disabled = on; $('#finish', v).disabled = on; };
          $('#save', v).onclick = async () => { busy(true); try { const o = await save(); toast(`Saved: ${o.added} added, ${o.changed} changed`); render(); } catch (err) { busy(false); fail(err); } };
          $('#finish', v).onclick = async () => {
            busy(true);
            try {
              await save();
              const o = await api('/api/rctis/finish-week', { method: 'POST', body: { driver_id: d.id, week: wk } });
              toast('RCTI ready. Send it on WhatsApp.');
              location.hash = '#/rcti/' + o.id;
            } catch (err) { busy(false); fail(err); }
          };
        },
      };
    },

    // Every payment made to contractors, by month, with BAS quarter totals.
    async payments() {
      const fyq = query().get('fy');
      const p = await api('/api/payments' + (fyq ? '?fy=' + fyq : ''));
      const sum = (rs) => rs.reduce((a, r) => ({ n: a.n + 1, ex: a.ex + r.subtotal, gst: a.gst + r.gst, t: a.t + r.total }), { n: 0, ex: 0, gst: 0, t: 0 });
      const months = new Map();
      for (const r of p.rows) { const m = r.paid_at.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(r); }
      const monthName = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      const quarters = [['Q1', 'Jul – Sep', [7, 8, 9]], ['Q2', 'Oct – Dec', [10, 11, 12]], ['Q3', 'Jan – Mar', [1, 2, 3]], ['Q4', 'Apr – Jun', [4, 5, 6]]]
        .map(([q, label, ms]) => [q, label, sum(p.rows.filter((r) => ms.includes(+r.paid_at.slice(5, 7))))]);
      const all = sum(p.rows);
      return {
        html: html`<div class="toolbar"><h1 style="margin:0">Payments</h1>
            <div class="filters"><select id="fy">${p.years.map((y) => html`<option value="${y}" ${y === p.fy ? 'selected' : ''}>FY ${y - 1}–${String(y).slice(2)}</option>`)}</select>
              <a class="btn sm dark" href="/api/payments.csv?fy=${p.fy}">Download for accountant (CSV)</a></div></div>
          <p class="muted" style="margin-top:-6px">Every RCTI marked paid, by the date it was paid (${auDate(p.from)} to ${auDate(p.to)}).${p.unpaid.n ? html` <a href="#/rctis">${p.unpaid.n} RCTI${p.unpaid.n === 1 ? '' : 's'} (${money(p.unpaid.total)})</a> not paid yet.` : ''}</p>
          <div class="card flush"><div style="padding:16px 16px 0"><h2>BAS quarters</h2></div><div class="tablewrap"><table>
            <thead><tr><th>Quarter</th><th>Months</th><th class="num">Payments</th><th class="num">Ex GST</th><th class="num">GST</th><th class="num">Total paid</th></tr></thead>
            <tbody>${quarters.map(([q, label, x]) => html`<tr><td><b>${q}</b></td><td>${label}</td><td class="num">${x.n}</td><td class="num">${money(x.ex)}</td><td class="num">${money(x.gst)}</td><td class="num"><b>${money(x.t)}</b></td></tr>`)}</tbody>
            <tfoot><tr><td colspan="2">Financial year</td><td class="num">${all.n}</td><td class="num">${money(all.ex)}</td><td class="num">${money(all.gst)}</td><td class="num">${money(all.t)}</td></tr></tfoot></table></div></div>
          ${months.size ? [...months.entries()].reverse().map(([m, rs]) => { const x = sum(rs); return html`<div class="card flush"><div style="padding:16px 16px 0"><h2>${monthName(m)} <span class="muted small" style="text-transform:none;font-family:var(--body);margin-left:auto">${money(x.t)} · GST ${money(x.gst)}</span></h2></div><div class="tablewrap"><table>
            <thead><tr><th>Paid</th><th>Contractor</th><th>ABN</th><th>RCTI</th><th>Week</th><th class="num">Ex GST</th><th class="num">GST</th><th class="num">Total</th><th>Ref</th></tr></thead>
            <tbody>${rs.map((r) => html`<tr class="click" data-go="#/rcti/${r.id}"><td class="nowrap">${auDate(r.paid_at)}</td><td>${r.driver_name}${r.business_name ? html`<div class="small muted">${r.business_name}</div>` : ''}</td><td class="nowrap">${r.abn || '—'}</td><td>${r.number}</td><td class="nowrap">${short(r.period_start)} – ${short(r.period_end)}</td><td class="num">${money(r.subtotal)}</td><td class="num">${money(r.gst)}</td><td class="num"><b>${money(r.total)}</b></td><td class="small">${r.payment_ref || ''}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="5">${rs.length} payment${rs.length === 1 ? '' : 's'}</td><td class="num">${money(x.ex)}</td><td class="num">${money(x.gst)}</td><td class="num">${money(x.t)}</td><td></td></tr></tfoot></table></div></div>`; }) : html`<div class="card empty">No payments marked paid in this financial year yet.</div>`}`,
        bind(v) {
          $('#fy', v).onchange = (e) => { location.hash = '#/payments?fy=' + e.target.value; };
          bindRows(v);
        },
      };
    },

    async drivers() {
      state.cache.drivers = null;
      const driverTable = (list, empty) => html`<div class="card flush"><div class="tablewrap"><table><thead><tr><th>Name</th><th>Business / ABN</th><th class="num">Rate</th><th>GST</th><th>Bank</th><th>Login</th><th></th></tr></thead>
          <tbody>${list.length ? list.map((d) => html`<tr class="click" data-go="#/driver/${d.id}"><td><b>${d.name}</b><div class="small muted">${d.phone || ''}</div></td><td>${d.business_name || '—'}<div class="small muted">${d.abn || 'No ABN'}</div></td><td class="num">${d.hourly_rate ? money(d.hourly_rate) : html`<span class="pill rejected">Set rate</span>`}</td><td>${d.gst_registered ? 'Yes' : 'No'}</td><td class="small">${d.bank_bsb ? `${d.bank_bsb} · ${d.bank_account_number}` : html`<span class="pill rejected">Missing</span>`}</td><td class="small">${d.email}</td><td>${d.active ? '' : html`<span class="pill">Left</span>`}</td></tr>`) : html`<tr><td colspan="7" class="empty">${empty}</td></tr>`}</tbody></table></div></div>`;
      const ds = await drivers();
      return {
        html: html`<div class="toolbar"><h1 style="margin:0">Drivers</h1><a class="btn" href="#/driver/new">+ Add driver</a></div>
          ${driverTable(ds.filter((d) => d.active), 'No drivers yet. Add your first driver to get started.')}
          ${ds.some((d) => !d.active) ? html`<details class="card" style="padding:0"><summary style="padding:16px;cursor:pointer"><b>Former drivers (${ds.filter((d) => !d.active).length})</b> <span class="small muted">· left, kept for records</span></summary>${driverTable(ds.filter((d) => !d.active), '')}</details>` : ''}`,
        bind: bindRows,
      };
    },

    async driver(id) {
      const isNew = id === 'new';
      const d = isNew ? { active: 1, gst_registered: 1, hourly_rate: '' } : (await api('/api/drivers')).find((x) => String(x.id) === id);
      if (!d) throw new Error('Driver not found');
      const sum = isNew ? null : await api('/api/pay/summary?driver_id=' + id);
      const f = (name, label, attrs = '', hint = '') => html`<div class="field"><label>${label}</label><input name="${name}" value="${d[name] ?? ''}" ${raw(attrs)}>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
      return {
        html: html`<a href="#/drivers" class="muted small">← Drivers</a><h1 style="margin-top:8px">${isNew ? 'Add driver' : d.name}</h1>
          ${sum ? html`<div class="grid g3" style="margin-bottom:16px"><div class="stat amber"><div class="k">Pending</div><div class="v">${money(sum.pending)}</div></div><div class="stat dark"><div class="k">Cleared</div><div class="v">${money(sum.cleared)}</div></div><div class="stat"><div class="k">This week</div><div class="v">${hrs(sum.this_week.hours)} hrs</div></div></div>
            <div class="actions" style="margin-bottom:16px"><a class="btn sm" href="#/entry?driver_id=${d.id}">Enter times</a><a class="btn ghost sm" href="#/runsheets?driver_id=${d.id}">Runsheets</a><a class="btn ghost sm" href="#/rctis">RCTIs</a></div>` : ''}
          <form id="dForm">
            <div class="card"><h2>Driver &amp; login</h2><div class="grid g2 stack">
              ${f('name', 'Full name', 'required')}${f('phone', 'Mobile', 'type="tel"', 'Used to send RCTIs on WhatsApp')}
              ${f('email', 'Email (login)', 'type="email" required')}
              <div class="field"><label>${isNew ? 'Starting password' : 'Reset password'}</label><input name="password" type="text" ${isNew ? 'required minlength="8"' : 'minlength="8" placeholder="Leave blank to keep"'} autocomplete="off"><div class="hint">At least 8 characters. Give this to the driver.</div></div>
            </div><label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active (can log in and see their RCTIs)</label></div>
            <div class="card"><h2>Pay rate</h2><div class="grid g2 stack">
              ${f('hourly_rate', 'Hourly rate ($ incl. GST)', 'type="number" step="0.01" min="0" required')}
              ${isNew ? '' : html`<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="apply_rate_to_open"> Apply new rate to runsheets not yet on an RCTI</label></div>`}
            </div></div>
            <div class="card"><h2>Company details for RCTI</h2><div class="grid g2 stack">
              ${f('business_name', 'Business / trading name', '', 'Leave blank if they trade under their own name')}${f('abn', 'ABN', 'inputmode="numeric"', '11 digits')}
            </div>${f('address', 'Business address')}
            <label class="check"><input type="checkbox" name="gst_registered" ${d.gst_registered ? 'checked' : ''}> Registered for GST (the RCTI shows the GST inside the rate)</label></div>
            <div class="card"><h2>Nominated bank account</h2><div class="grid g3 stack">
              ${f('bank_account_name', 'Account name')}${f('bank_bsb', 'BSB', 'inputmode="numeric" placeholder="000-000"')}${f('bank_account_number', 'Account number', 'inputmode="numeric"')}
            </div></div>
            <div class="actions"><button class="btn xl">${isNew ? 'Add driver' : 'Save driver'}</button></div>
          </form>
          ${isNew ? '' : html`<div class="card" style="margin-top:16px"><h2>Driver has left</h2>
            ${d.active ? html`<p class="muted">Marking them as left stops their login and takes them off Enter times. Their RCTIs and payments are kept for your BAS, and you can bring them back any time.</p>
              <div class="actions"><button class="btn danger" id="leave">Mark as left</button></div>`
            : html`<p class="muted">${d.name} has left and can't log in. Their RCTIs and payments are kept.</p>
              <div class="actions"><button class="btn" id="back">Bring back</button><button class="btn ghost danger" id="delDrv">Delete for good</button></div>
              <p class="hint">Delete for good only works if they have no RCTIs, for example a driver added by mistake.</p>`}</div>`}`,
        bind(v) {
          const setActive = async (on) => {
            try { await api('/api/drivers/' + id, { method: 'PUT', body: { active: on } }); state.cache.drivers = null; toast(on ? `${d.name} is back` : `${d.name} marked as left`); render(); } catch (err) { fail(err); }
          };
          $('#leave', v) && ($('#leave', v).onclick = async () => { if (await confirmDialog(`Mark ${d.name} as left?`, html`<p>They can't log in any more and won't show on Enter times. Their RCTIs and payments stay.</p>`, 'Mark as left', true)) setActive(false); });
          $('#back', v) && ($('#back', v).onclick = () => setActive(true));
          $('#delDrv', v) && ($('#delDrv', v).onclick = async () => {
            if (!(await confirmDialog(`Delete ${d.name} for good?`, html`<p>Their details and any times not on an RCTI are removed permanently. This can't be undone.</p>`, 'Delete', true))) return;
            try { await api('/api/drivers/' + id, { method: 'DELETE' }); state.cache.drivers = null; toast('Driver deleted'); location.hash = '#/drivers'; } catch (err) { fail(err); }
          });
          $('#dForm', v).addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const body = Object.fromEntries([...fd.entries()].map(([k, x]) => [k, typeof x === 'string' ? x.trim() : x]));
            body.active = e.target.active.checked;
            body.gst_registered = e.target.gst_registered.checked;
            body.apply_rate_to_open = !!e.target.apply_rate_to_open?.checked;
            if (!body.password) delete body.password;
            try {
              const out = await api(isNew ? '/api/drivers' : '/api/drivers/' + id, { method: isNew ? 'POST' : 'PUT', body });
              state.cache.drivers = null;
              toast(isNew ? 'Driver added' : 'Saved');
              location.hash = '#/driver/' + out.id;
              if (!isNew) render();
            } catch (err) { fail(err); }
          });
        },
      };
    },

    async settings() {
      const [s, staff] = await Promise.all([api('/api/settings'), api('/api/staff')]);
      const f = (name, label, attrs = '', hint = '') => html`<div class="field"><label>${label}</label><input name="${name}" value="${s[name] ?? ''}" ${raw(attrs)}>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
      return {
        html: html`<h1>Settings</h1>
          <div class="grid g2 stack" style="margin-bottom:16px">
            <div class="notice ${s.smtp ? 'ok' : 'warn'}" style="margin:0"><b>Email:</b> ${s.smtp ? 'sending from your email account.' : 'not connected yet. Add a Brevo API key below. Until then emails are only saved in the Email log.'}</div>
            ${s.storage_safe ? '' : html`<div class="notice err" style="margin:0;grid-column:1/-1"><b>Data is not being kept.</b> No storage volume is attached in Railway, so drivers, runsheets and RCTIs are wiped every time a new version goes live.</div>`}
          </div>
          ${s.smtp_from_env || s.brevo_from_env ? '' : html`<form class="card" id="mailForm"><h2>Email account (sends runsheets and RCTIs)</h2>
            ${state.mailResult ? html`<div class="notice ${state.mailResult.ok ? 'ok' : 'warn'}">${state.mailResult.text}</div>` : ''}
            <div class="grid g2 stack"><div class="field"><label>Send from (email address)</label><input name="smtp_user" type="email" value="${s.smtp_user || ''}" required><div class="hint">Must be a sender Brevo accepts (a Gmail address will not work). Replies go to the company email below.</div></div>
              <div class="field"><label>Brevo API key</label><input name="brevo_api_key" type="password" autocomplete="off" placeholder="${s.brevo_key_set ? 'Saved. Paste a new one to replace it' : 'Starts with xkeysib-'}"><div class="hint">Free at brevo.com. In Brevo open SMTP &amp; API, then API Keys, and create a key called SB Pay.</div></div></div>
            <details style="margin:4px 0 12px"><summary class="small muted">Use a Gmail app password instead (only works on paid hosting)</summary>
              <div class="field" style="margin-top:8px"><label>Gmail app password</label><input name="smtp_pass" type="password" autocomplete="new-password" placeholder="${s.smtp_pass_set ? 'Saved. Type a new one to replace it' : '16 letters from Google'}"></div></details>
            <div class="actions"><button class="btn dark">Save and send test email</button>${s.brevo_key_set || s.smtp_pass_set ? html`<button type="button" class="btn danger sm" id="mailOff">Stop sending</button>` : ''}</div>
            <p class="hint">The test email goes to the office email below. After saving, the key box goes blank on purpose; it is kept safely.</p></form>`}
          <form id="sForm">
            <div class="card"><h2>Company details (on every RCTI)</h2><div class="grid g2 stack">
              ${f('company_name', 'Company name', 'required')}${f('company_abn', 'ABN')}${f('company_phone', 'Phone')}${f('company_email', 'Email (sender)', 'type="email"')}
            </div>${f('company_address', 'Address')}</div>
            <div class="card"><h2>Office copies</h2>${f('office_email', 'Office email for runsheets and RCTI copies', 'type="email"', 'Office copies of RCTIs are sent here.')}
              <label class="check"><input type="checkbox" name="auto_weekly_rcti" ${s.auto_weekly_rcti === '1' ? 'checked' : ''}> Create RCTIs automatically every Sunday 1am (${s.timezone}) and email office copies</label></div>
            <div class="card"><h2>RCTI</h2><div class="grid g2 stack">${f('rcti_prefix', 'Number prefix')}${f('rcti_next_number', 'Next number', 'type="number" min="1"')}</div>
              <div class="field"><label>Payment terms</label><textarea name="payment_terms">${s.payment_terms}</textarea></div>
              <div class="field"><label>RCTI agreement wording</label><textarea name="rcti_agreement" style="min-height:120px">${s.rcti_agreement}</textarea><div class="hint">Printed on every RCTI. Have your accountant check it matches your written RCTI agreements with drivers.</div></div></div>
            <div class="actions" style="margin-bottom:16px"><button class="btn xl">Save settings</button></div>
          </form>
          <form class="card" id="logoForm"><h2>Logo</h2>${s.has_logo ? html`<img src="/api/logo?${Date.now()}" style="max-height:70px;background:#15181c;padding:8px;border-radius:8px;margin-bottom:10px">` : html`<p class="muted">Using the SB logo supplied with the app.</p>`}
            <div class="actions"><input type="file" name="logo" accept="image/png,image/jpeg" style="max-width:320px"><button class="btn dark">Upload logo</button></div><p class="hint">Shows in the app header and on RCTIs. A light logo on transparent PNG looks best on the dark header.</p></form>
          <div class="card"><h2>Office logins</h2><ul class="list">${staff.map((u) => html`<li><div class="grow"><b>${u.name}</b><div class="small muted">${u.email}</div></div>${u.active ? '' : html`<span class="pill">Off</span>`}${u.id !== state.me.id ? html`<button class="btn sm ghost" data-toggle="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Switch off' : 'Switch on'}</button>` : html`<span class="small muted">You</span>`}</li>`)}</ul>
            <form id="staffForm" class="grid g4 stack" style="margin-top:12px;align-items:end"><div><label>Name</label><input name="name" required></div><div><label>Email</label><input name="email" type="email" required></div><div><label>Password</label><input name="password" minlength="8" required></div><button class="btn dark">Add office login</button></form></div>
          ${passwordCard()}`,
        bind(v) {
          $('#sForm', v).addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = Object.fromEntries(new FormData(e.target));
            body.auto_weekly_rcti = e.target.auto_weekly_rcti.checked ? '1' : '0';
            try { await api('/api/settings', { method: 'PUT', body }); toast('Settings saved'); } catch (err) { fail(err); }
          });
          $('#mailForm', v)?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = { smtp_user: e.target.smtp_user.value };
            if (e.target.smtp_pass.value) body.smtp_pass = e.target.smtp_pass.value;
            if (e.target.brevo_api_key.value) body.brevo_api_key = e.target.brevo_api_key.value;
            const btn = e.target.querySelector('button.dark'); btn.disabled = true; btn.textContent = 'Sending test email...';
            try {
              await api('/api/settings/email', { method: 'PUT', body });
              const o = await api('/api/settings/test-email', { method: 'POST' });
              state.mailResult = o.ok && o.mode === 'smtp' ? { ok: true, text: 'Email works. A test email was sent to the office email.' }
                : { ok: false, text: o.ok ? 'Nothing is connected yet, so the test was only saved in the Email log.' : 'Test email failed: ' + (o.error || o.reason || 'unknown error') };
              render();
            } catch (err) { btn.disabled = false; btn.textContent = 'Save and send test email'; fail(err); }
          });
          $('#mailOff', v) && ($('#mailOff', v).onclick = async () => { try { await api('/api/settings/email', { method: 'PUT', body: { smtp_pass: '', brevo_api_key: '' } }); state.mailResult = null; toast('Email sending stopped'); render(); } catch (err) { fail(err); } });
          $('#logoForm', v).addEventListener('submit', async (e) => {
            e.preventDefault();
            try { await api('/api/settings/logo', { method: 'POST', body: new FormData(e.target) }); state.config = await api('/api/config'); toast('Logo updated'); render(); } catch (err) { fail(err); }
          });
          $('#staffForm', v).addEventListener('submit', async (e) => {
            e.preventDefault();
            try { await api('/api/staff', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Office login added'); render(); } catch (err) { fail(err); }
          });
          $$('[data-toggle]', v).forEach((b) => (b.onclick = async () => { try { await api('/api/staff/' + b.dataset.toggle, { method: 'PUT', body: { active: b.dataset.on === '1' } }); render(); } catch (err) { fail(err); } }));
          bindPassword(v);
        },
      };
    },

    async emails() {
      const rows = await api('/api/email-log');
      return html`<h1>Email log</h1><p class="muted">Every runsheet and RCTI email the app has sent or saved.</p>
        <div class="card flush"><div class="tablewrap"><table><thead><tr><th>When</th><th>To</th><th>Subject</th><th>How</th><th>Result</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => html`<tr><td class="nowrap small">${stamp(r.created_at)}</td><td>${r.to_addr}</td><td>${r.subject}</td><td>${r.mode === 'smtp' ? 'Sent' : 'Outbox'}</td><td>${r.status === 'sent' ? html`<span class="pill paid">${r.mode === 'smtp' ? 'Sent' : 'Saved'}</span>` : html`<span class="pill rejected">${r.status}</span>`} <span class="small muted">${r.status !== 'sent' ? r.detail : ''}</span></td></tr>`) : html`<tr><td colspan="5" class="empty">Nothing yet.</td></tr>`}</tbody></table></div></div>`;
    },
  };

  async function deleteRunsheet(r, after) {
    const onRcti = r.rcti_id ? html`<p>It's on ${r.rcti_number || 'an RCTI'}${r.rcti_paid_at ? ', which is already marked paid' : ''}. That RCTI will be re-totalled.</p>` : '';
    if (!(await confirmDialog('Delete runsheet?', html`<p>This removes ${r.driver_name}'s runsheet for ${nice(r.work_date)} permanently.</p>${onRcti}`, 'Delete', true))) return;
    try { await api('/api/runsheets/' + r.id, { method: 'DELETE' }); toast('Runsheet deleted'); after(); } catch (err) { fail(err); }
  }

  function bindRows(v) { $$('tr[data-go]', v).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.go; })); }

  function emailToast(o) {
    if (!o) return;
    if (o.skipped) toast(o.reason || 'No office email set (Settings)', true);
    else if (!o.ok) toast('Email failed: ' + (o.error || ''), true);
    else toast(o.mode === 'smtp' ? 'Email sent' : 'Email saved to outbox (mail not connected)');
  }

  function pushDialog(ids) {
    dialog(ids.length > 1 ? `Push ${ids.length} RCTIs to drivers` : 'Push RCTI to driver', html`
      <p>The driver${ids.length > 1 ? 's' : ''} will see ${ids.length > 1 ? 'their RCTIs' : 'this RCTI'} in the app and can download the PDF.</p>
      <label class="check"><input type="checkbox" id="pMail"> Also email a copy to the driver</label>
      <div class="actions" style="justify-content:flex-end;margin-top:18px"><button class="btn ghost" data-no>Cancel</button><button class="btn dark" data-yes>Push</button></div>`, (d) => {
      $('[data-no]', d).onclick = () => d.close();
      $('[data-yes]', d).onclick = async () => {
        try {
          for (const id of ids) await api(`/api/rctis/${id}/push`, { method: 'POST', body: { email_driver: $('#pMail', d).checked } });
          d.close(); toast(ids.length > 1 ? `${ids.length} RCTIs pushed` : 'RCTI pushed to driver'); render();
        } catch (err) { fail(err); }
      };
    });
  }

  function paidDialog(id) {
    dialog('Mark RCTI paid', html`<div class="field"><label>Paid on</label><input type="date" id="pOn" value="${today()}"></div><div class="field"><label>Payment reference <span class="muted">(optional)</span></label><input id="pRef" placeholder="e.g. EFT batch or bank ref"></div>
      <div class="actions" style="justify-content:flex-end"><button class="btn ghost" data-no>Cancel</button><button class="btn green" data-yes>Mark paid</button></div>`, (d) => {
      $('[data-no]', d).onclick = () => d.close();
      $('[data-yes]', d).onclick = async () => {
        try { await api(`/api/rctis/${id}/paid`, { method: 'POST', body: { paid_on: $('#pOn', d).value, payment_ref: $('#pRef', d).value } }); d.close(); toast('Marked paid. Driver sees it as cleared.'); render(); } catch (err) { fail(err); }
      };
    });
  }

  async function markUnpaid(id) {
    if (!(await confirmDialog('Mark RCTI unpaid?', html`<p>The payment date and reference are cleared, it comes off the Payments list, and the driver sees it as unpaid again.</p>`, 'Mark unpaid'))) return;
    try { await api(`/api/rctis/${id}/paid`, { method: 'POST', body: { paid: false } }); toast('Marked unpaid'); render(); } catch (err) { fail(err); }
  }

  // WhatsApp without a paid API: on a phone, share the PDF file straight into WhatsApp;
  // anywhere, open a WhatsApp chat with the driver holding a message and a private link to the PDF.
  async function waDialog(id) {
    let info;
    try { info = await api(`/api/rctis/${id}/share`); } catch (err) { return fail(err); }
    let file = null;
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && window.File) {
      try {
        const blob = await (await fetch(info.link)).blob();
        const f = new File([blob], info.number + '.pdf', { type: 'application/pdf' });
        if (navigator.canShare({ files: [f] })) file = f;
      } catch { /* fall back to the link */ }
    }
    const msg = `${info.text}\n\nRCTI PDF: ${info.link}`;
    const waUrl = `https://wa.me/${info.phone}?text=${encodeURIComponent(msg)}`;
    const sent = () => api(`/api/rctis/${id}/push`, { method: 'POST', body: {} }).then(() => render()).catch(fail);
    dialog(`Send ${info.number} on WhatsApp`, html`
      ${info.phone ? html`<p>To <b>+${info.phone}</b> (the driver's mobile).</p>` : html`<div class="notice warn">No mobile saved for this driver, so WhatsApp will ask you to pick the chat. Add it on the driver's page.</div>`}
      <div class="actions" style="flex-direction:column;align-items:stretch">
        ${file ? html`<button class="btn wa xl" data-file>Send PDF in WhatsApp</button><p class="hint" style="margin:-4px 0 6px">Your phone's share menu opens. Pick WhatsApp, then the driver.</p>` : ''}
        <a class="btn ${file ? 'ghost' : 'wa xl'}" data-link href="${waUrl}" target="_blank" rel="noopener">${file ? 'Send a link instead' : 'Open WhatsApp chat'}</a>
        <p class="hint" style="margin:0">${file ? 'The link opens the same PDF without logging in.' : 'The message has a private link that opens the RCTI PDF without logging in.'}</p>
      </div>
      <p class="small muted">Sending also shows the RCTI in the driver's app.</p>
      <div class="actions" style="justify-content:flex-end"><button class="btn ghost" data-no>Close</button></div>`, (d) => {
      $('[data-no]', d).onclick = () => d.close();
      $('[data-link]', d).onclick = () => { sent(); d.close(); };
      const fb = $('[data-file]', d);
      if (fb) fb.onclick = async () => {
        try { await navigator.share({ files: [file], text: info.text }); sent(); d.close(); }
        catch (e) { if (e.name !== 'AbortError') fail(e); }
      };
    });
  }

  // ---------- boot ----------
  (async () => {
    try { state.config = await api('/api/config'); } catch {}
    try { state.me = await api('/api/me'); } catch { state.me = null; }
    render();
  })();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
