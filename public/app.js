/* Quran Khatmah — client app. Talks to the server over Socket.IO; the server
   is the source of truth and broadcasts full room state on every change. */
(function () {
  const socket = io();
  const t = (k, p) => window.I18n.t(k, p);

  // ---- persisted prefs ----
  const PREF_LANG = 'khatmah:lang';
  const PREF_SCRIPT = 'khatmah:script';
  let lang = localStorage.getItem(PREF_LANG) || 'en';
  let script = localStorage.getItem(PREF_SCRIPT) || 'uthmani';

  // ---- session ----
  let state = null; // latest RoomState
  let code = null; // active room code
  let membership = null; // { participantId, name, adminToken, partIndex }
  let subscribed = false;

  // ---- membership storage (per room) ----
  const memKey = (c) => `khatmah:room:${c}`;
  function loadMembership(c) {
    try {
      return JSON.parse(localStorage.getItem(memKey(c))) || {};
    } catch {
      return {};
    }
  }
  function saveMembership() {
    if (code) localStorage.setItem(memKey(code), JSON.stringify(membership || {}));
  }

  // ---- dom helpers ----
  const $ = (id) => document.getElementById(id);
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function show(view) {
    $('homeView').hidden = view !== 'home';
    $('roomView').hidden = view !== 'room';
    // Arriving via a room code means you're joining — hide the "create" card.
    const invited = !!code;
    $('createCard').hidden = invited;
    $('homeOr').hidden = invited;
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2500);
  }
  function homeError(key) {
    const el = $('homeError');
    if (!key) {
      el.hidden = true;
      return;
    }
    el.textContent = t('errors.' + key) === 'errors.' + key ? t('errors.generic') : t('errors.' + key);
    el.hidden = false;
  }

  // ---- socket emit with promise + error handling ----
  function emit(event, payload) {
    return new Promise((resolve) => {
      socket.emit(event, payload, (res) => resolve(res || { ok: false, error: 'generic' }));
    });
  }
  function errText(code) {
    const k = 'errors.' + code;
    const v = t(k);
    return v === k ? t('errors.generic') : v;
  }

  // ---- time formatting ----
  function fmtDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString(lang === 'bn' ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // ===================== flows =====================
  async function createRoom() {
    homeError(null);
    const participantCount = parseInt($('createCount').value, 10);
    const dedication = $('createDedication').value;
    const res = await emit('createRoom', { participantCount, dedication });
    if (!res.ok) return homeError(res.error);
    code = res.code;
    membership = { adminToken: res.adminToken };
    saveMembership();
    history.replaceState(null, '', `?code=${code}`);
    await watch();
  }

  async function joinRoom(name, participantId) {
    homeError(null);
    const res = await emit('joinRoom', { code, name, participantId });
    if (!res.ok) return homeError(res.error);
    membership = Object.assign(loadMembership(code), { participantId, name, partIndex: res.partIndex });
    saveMembership();
    subscribed = true;
    state = res.state;
    show('room');
    render();
  }

  async function watch() {
    const res = await emit('watchRoom', { code });
    if (!res.ok) {
      show('home');
      homeError(res.error);
      return;
    }
    subscribed = true;
    state = res.state;
    show('room');
    render();
  }

  // ===================== rendering =====================
  // A participant can hold several parts; identity is the participantId.
  function isMine(p) {
    return !!(p.assignee && membership && membership.participantId && p.assignee.id === membership.participantId);
  }
  function myParts() {
    if (!state) return [];
    return state.parts.filter(isMine);
  }
  // "Active" = assigned to me but not finished. Limited to one at a time.
  const hasActivePart = () => myParts().some((p) => p.status !== 'done');
  const isAdmin = () => !!(membership && membership.adminToken);

  function statusBadge(s) {
    const label = { open: 'part.statusOpen', in_progress: 'part.statusInProgress', done: 'part.statusDone' }[s];
    return `<span class="badge ${s}">${escapeHtml(t(label))}</span>`;
  }
  function juzLabel(p) {
    return p.juzFrom === p.juzTo ? t('part.juzSingle', { n: p.juzFrom }) : t('part.juz', { from: p.juzFrom, to: p.juzTo });
  }
  function ar(text, cls) {
    return `<span class="arabic ${script === 'indopak' ? 'indopak' : ''} ${cls || ''}" dir="rtl">${escapeHtml(text)}</span>`;
  }
  function refBlock(which, ref) {
    return `
      <div class="ref">
        <div class="lbl">${escapeHtml(t('part.' + which))} · ${escapeHtml(t('part.page', { n: ref.page }))}</div>
        <div class="sname">${ar(ref.surahName)} <span class="muted small">${escapeHtml(ref.surahTranslit)} · ${escapeHtml(
          t('part.ayah', { n: ref.ayah })
        )}</span></div>
        <div class="ayah-text">${ar(ref.text[script])}</div>
      </div>`;
  }
  function timerBlock(p) {
    if (p.status === 'in_progress' && p.startedAt) {
      return `<span class="timer js-timer" data-start="${p.startedAt}">${fmtDuration(Date.now() - p.startedAt)}</span>`;
    }
    if (p.status === 'done' && p.startedAt && p.endedAt) {
      return `<span class="timer">${fmtDuration(p.endedAt - p.startedAt)}</span>`;
    }
    return '';
  }
  function actionButtons(p) {
    const mine = isMine(p);
    const admin = isAdmin();
    let btns = '';
    // Start/finish are owner-only — an admin must take a part to control it.
    if (mine && p.status !== 'done' && p.status !== 'in_progress')
      btns += `<button class="btn start small" data-action="start" data-idx="${p.index}">${escapeHtml(t('part.start'))}</button>`;
    if (mine && p.status === 'in_progress')
      btns += `<button class="btn end small" data-action="end" data-idx="${p.index}">${escapeHtml(t('part.end'))}</button>`;
    // Owner can stop & pass any unfinished part of theirs.
    if (mine && p.status !== 'done')
      btns += `<button class="btn ghost small" data-action="pass" data-idx="${p.index}">${escapeHtml(t('part.pass'))}</button>`;
    // Any joined participant with no active part can take an open part.
    if (!p.assignee && p.status === 'open' && membership && membership.participantId && !mine && !hasActivePart())
      btns += `<button class="btn start small" data-action="claim" data-idx="${p.index}">${escapeHtml(t('part.take'))}</button>`;
    if (admin && p.assignee && p.status !== 'done')
      btns += `<button class="btn ghost small" data-action="release" data-idx="${p.index}">${escapeHtml(t('admin.release'))}</button>`;
    return btns ? `<div class="actions">${btns}</div>` : '';
  }
  function partCard(p) {
    const mine = isMine(p);
    const reader = p.assignee
      ? `<span class="muted">${escapeHtml(t('part.assignedTo'))}:</span> <b>${escapeHtml(p.assignee.name)}</b>`
      : `<span class="muted">${escapeHtml(t('part.unassigned'))}</span>`;
    return `
      <div class="part ${p.status} ${mine ? 'mine' : ''}">
        <div class="part-top">
          <span class="part-idx">#${p.index}</span>
          ${statusBadge(p.status)}
        </div>
        <div class="juz">${escapeHtml(juzLabel(p))} · ${escapeHtml(t('part.pages', { from: p.pageFrom, to: p.pageTo }))}</div>
        ${refBlock('from', p.start)}
        ${refBlock('to', p.end)}
        <div class="assignee">${reader} ${timerBlock(p)}</div>
        ${actionButtons(p)}
      </div>`;
  }

  function renderYourParts() {
    const wrap = $('yourPart');
    const mine = myParts();
    const openAvailable = state.parts.some((p) => p.status === 'open' && !p.assignee);
    if (mine.length) {
      const hint = !hasActivePart() && openAvailable ? `<p class="small muted">${escapeHtml(t('part.takeHint'))}</p>` : '';
      wrap.innerHTML = `<h3>${escapeHtml(t('part.yourPartsTitle'))}</h3>${hint}${mine.map((p) => partCard(p)).join('')}`;
      return;
    }
    // Already joined but holding no part (e.g. passed it back) — reuse their
    // stored identity; the board's "Take this part" buttons re-claim for them.
    if (membership && membership.participantId) {
      wrap.innerHTML = `
        <div class="yourpart-empty">
          <h3>${escapeHtml(t('part.noActiveTitle'))}</h3>
          <p class="small">${escapeHtml(openAvailable ? t('part.takeHint') : t('errors.FULL'))}</p>
        </div>`;
      return;
    }
    // Not yet joined — capture name/ID once.
    const full = state.assignedCount >= state.totalParts;
    wrap.innerHTML = `
      <div class="yourpart-empty">
        <h3>${escapeHtml(t('part.claimTitle'))}</h3>
        <p class="small">${escapeHtml(full ? t('errors.FULL') : t('part.claimHint'))}</p>
        ${
          full
            ? ''
            : `<div class="cards" style="gap:10px;justify-content:center">
                 <input id="claimName" placeholder="${escapeHtml(t('home.join.namePlaceholder'))}" style="max-width:200px" />
                 <input id="claimId" placeholder="${escapeHtml(t('home.join.idPlaceholder'))}" style="max-width:200px" />
                 <button id="claimBtn" class="btn primary" style="max-width:200px">${escapeHtml(t('part.claimButton'))}</button>
               </div>`
        }
      </div>`;
    const cb = $('claimBtn');
    if (cb)
      cb.onclick = () => {
        const name = $('claimName').value.trim();
        const id = $('claimId').value.trim();
        if (!name) return toast(errText('NO_NAME'));
        if (!id) return toast(errText('NO_ID'));
        joinRoom(name, id);
      };
  }

  function renderFeed() {
    const ul = $('feed');
    ul.innerHTML = state.feed
      .map((e) => `<li>${escapeHtml(t('feed.' + e.key, e.params))}<div class="when">${escapeHtml(fmtTime(e.at))}</div></li>`)
      .join('');
  }

  function render() {
    if (!state) return;
    $('roomCode').textContent = state.code;

    const ded = $('dedicationWrap');
    if (state.dedication) {
      ded.hidden = false;
      $('dedicationText').textContent = state.dedication;
    } else ded.hidden = true;

    const pct = state.totalParts ? Math.round((state.doneCount / state.totalParts) * 100) : 0;
    $('progressFill').style.width = pct + '%';
    $('progressText').textContent = t('progress.text', { done: state.doneCount, total: state.totalParts });

    $('completedBanner').hidden = state.status !== 'completed';

    renderYourParts();
    $('board').innerHTML = state.parts.map((p) => partCard(p)).join('');
    $('adminPanel').hidden = !isAdmin();
    $('shareAdminBtn').hidden = !isAdmin();
    const canExport = isAdmin() && state.status === 'completed';
    $('exportBtn').hidden = !canExport;
    $('exportHint').hidden = !isAdmin() || canExport;
    renderFeed();

    // wire board/your-part action buttons
    document.querySelectorAll('[data-action]').forEach((btn) => {
      btn.onclick = () => onAction(btn.getAttribute('data-action'), parseInt(btn.getAttribute('data-idx'), 10));
    });
  }

  async function onAction(action, index) {
    const base = { code, index, participantId: membership && membership.participantId, adminToken: membership && membership.adminToken };
    let res;
    if (action === 'start') res = await emit('startPart', base);
    else if (action === 'end') res = await emit('endPart', base);
    else if (action === 'release') res = await emit('releasePart', { code, index, adminToken: membership.adminToken });
    else if (action === 'claim')
      res = await emit('claimPart', { code, index, name: membership && membership.name, participantId: membership && membership.participantId });
    else if (action === 'pass') {
      if (!confirm(t('part.confirmPass'))) return;
      res = await emit('passPart', base);
    }
    if (res && !res.ok) toast(errText(res.error));
  }

  // ---- export "proof" certificate ----
  function fmtDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-US');
  }
  function leaveRoom() {
    if (code) localStorage.removeItem(memKey(code));
    subscribed = false;
    membership = null;
    state = null;
    code = null;
    history.replaceState(null, '', location.pathname);
    show('home');
  }
  // Open a self-contained printable certificate window from the exported data.
  function buildCertificate(data) {
    const dir = ['ar', 'ur'].includes(lang) ? 'rtl' : 'ltr';
    const partsRows = data.parts
      .map((p) => {
        const range = `${p.juzFrom === p.juzTo ? 'Juz ' + p.juzFrom : 'Juz ' + p.juzFrom + '–' + p.juzTo} · ${t('part.pages', {
          from: p.pageFrom,
          to: p.pageTo,
        })}`;
        const reader = p.assignee ? `${escapeHtml(p.assignee.name)} (${escapeHtml(p.assignee.id)})` : '—';
        return `<tr>
          <td>#${p.index}</td>
          <td>${escapeHtml(range)}</td>
          <td dir="rtl">${escapeHtml(p.start.surahName)} → ${escapeHtml(p.end.surahName)}</td>
          <td>${escapeHtml(reader)}</td>
          <td>${escapeHtml(t('cert.status_' + p.status))}</td>
          <td>${escapeHtml(fmtDateTime(p.endedAt))}</td>
        </tr>`;
      })
      .join('');
    const feedRows = data.events
      .map((e) => `<li>${escapeHtml(t('feed.' + e.key, e.params))} <span class="when">${escapeHtml(fmtDateTime(e.at))}</span></li>`)
      .join('');
    const html = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8" />
      <title>${escapeHtml(t('cert.title'))} · ${escapeHtml(data.code)}</title>
      <style>
        :root { --green:#0f5132; --gold:#c8a24a; --ink:#1f2a24; --muted:#6b7d72; --line:#e3e0d4; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, 'Noto Sans Bengali', sans-serif; color: var(--ink); margin: 40px; }
        .sheet { max-width: 900px; margin: 0 auto; border: 3px double var(--gold); border-radius: 14px; padding: 32px 40px; }
        h1 { color: var(--green); text-align: center; margin: 0 0 4px; }
        .proof { text-align: center; color: var(--muted); margin: 0 0 24px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 0 0 24px; }
        .meta div { padding: 6px 0; border-bottom: 1px solid var(--line); }
        .meta b { color: var(--green); }
        table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 13px; }
        th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: start; }
        th { background: #f6f4ec; color: var(--green); }
        h2 { color: var(--green); border-bottom: 2px solid var(--gold); padding-bottom: 4px; }
        ul.activity { font-size: 12px; color: var(--ink); padding-inline-start: 18px; }
        ul.activity .when { color: var(--muted); }
        .credit { text-align: center; color: var(--muted); font-size: 12px; margin-top: 28px; border-top: 1px solid var(--line); padding-top: 12px; }
        .credit a { color: var(--green); }
        @media print { body { margin: 0; } .sheet { border: none; } }
      </style></head><body>
      <div class="sheet">
        <h1>${escapeHtml(t('app.title'))}</h1>
        <p class="proof">${escapeHtml(t('cert.proof'))}</p>
        <div class="meta">
          <div><b>${escapeHtml(t('room.code'))}:</b> ${escapeHtml(data.code)}</div>
          <div><b>${escapeHtml(t('cert.participants'))}:</b> ${data.participantCount}</div>
          <div><b>${escapeHtml(t('cert.createdOn'))}:</b> ${escapeHtml(fmtDateTime(data.createdAt))}</div>
          <div><b>${escapeHtml(t('cert.completedOn'))}:</b> ${escapeHtml(fmtDateTime(data.completedAt))}</div>
          ${data.dedication ? `<div style="grid-column:1/-1"><b>${escapeHtml(t('room.dedication'))}:</b> ${escapeHtml(data.dedication)}</div>` : ''}
        </div>
        <h2>${escapeHtml(t('board.title'))}</h2>
        <table>
          <thead><tr>
            <th>#</th><th>${escapeHtml(t('cert.range'))}</th><th>${escapeHtml(t('cert.surahs'))}</th>
            <th>${escapeHtml(t('cert.reader'))}</th><th>${escapeHtml(t('cert.status'))}</th><th>${escapeHtml(t('cert.completedOn'))}</th>
          </tr></thead>
          <tbody>${partsRows}</tbody>
        </table>
        <h2>${escapeHtml(t('feed.title'))}</h2>
        <ul class="activity">${feedRows}</ul>
        <p class="credit">${escapeHtml(t('cert.generatedOn'))}: ${escapeHtml(fmtDateTime(Date.now()))}<br />
          © ${new Date().getFullYear()} <a href="https://www.devxhub.com">Devxhub Limited</a> · ${escapeHtml(t('footer.rights'))}</p>
      </div>
      <script>window.onload = function () { window.print(); };<\/script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      toast(t('cert.popupBlocked'));
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ---- live timers ----
  setInterval(() => {
    document.querySelectorAll('.js-timer[data-start]').forEach((el) => {
      el.textContent = fmtDuration(Date.now() - Number(el.getAttribute('data-start')));
    });
  }, 1000);

  // ===================== wiring =====================
  function applyLangScript() {
    window.I18n.apply();
    if (state) render();
  }

  function setupControls() {
    const langSel = $('langSelect');
    const scriptSel = $('scriptSelect');
    langSel.value = lang;
    scriptSel.value = script;
    langSel.onchange = async () => {
      lang = langSel.value;
      localStorage.setItem(PREF_LANG, lang);
      await window.I18n.load(lang);
      applyLangScript();
    };
    scriptSel.onchange = () => {
      script = scriptSel.value;
      localStorage.setItem(PREF_SCRIPT, script);
      if (state) render();
    };

    $('createBtn').onclick = createRoom;
    $('joinBtn').onclick = () => {
      code = ($('joinCode').value || '').trim().toUpperCase();
      if (!code) return homeError('NO_ROOM');
      joinRoom($('joinName').value.trim(), $('joinId').value.trim());
    };

    $('shareBtn').onclick = () => {
      const link = `${location.origin}/?code=${code}`;
      navigator.clipboard.writeText(link).then(() => toast(t('toast.linkCopied')));
    };
    $('shareAdminBtn').onclick = () => {
      const link = `${location.origin}/?code=${code}&admin=${membership.adminToken}`;
      navigator.clipboard.writeText(link).then(() => toast(t('toast.adminCopied')));
    };
    $('resetBtn').onclick = async () => {
      if (!confirm(t('admin.confirmReset'))) return;
      const res = await emit('resetRoom', { code, adminToken: membership.adminToken });
      if (!res.ok) toast(errText(res.error));
    };
    $('exportBtn').onclick = async () => {
      if (!confirm(t('admin.confirmExport'))) return;
      const res = await emit('closeKhatmah', { code, adminToken: membership.adminToken });
      if (!res.ok) return toast(errText(res.error));
      buildCertificate(res.export);
      toast(t('toast.closed'));
      leaveRoom();
    };
  }

  // live state updates
  socket.on('state', (s) => {
    if (s && s.code === code) {
      state = s;
      render();
    }
  });
  // re-subscribe to room after a reconnect
  socket.on('connect', () => {
    if (code && subscribed) {
      if (membership && membership.participantId) emit('joinRoom', { code, name: membership.name, participantId: membership.participantId });
      else emit('watchRoom', { code });
    }
  });
  // the khatmah was exported + closed by the admin — everyone returns home
  socket.on('closed', (m) => {
    if (m && m.code === code) {
      toast(t('toast.closed'));
      leaveRoom();
    }
  });

  async function boot() {
    await window.I18n.load(lang);
    window.I18n.apply();
    $('footerYear').textContent = new Date().getFullYear();
    setupControls();

    const url = new URL(location.href);
    const qsCode = (url.searchParams.get('code') || '').trim().toUpperCase();
    const qsAdmin = url.searchParams.get('admin');

    if (qsCode) {
      code = qsCode;
      membership = loadMembership(code);
      if (qsAdmin) {
        membership.adminToken = qsAdmin;
        saveMembership();
        history.replaceState(null, '', `?code=${code}`); // keep token out of the visible URL
      }
      if (membership.participantId) {
        await joinRoom(membership.name, membership.participantId);
      } else if (membership.adminToken) {
        await watch();
      } else {
        show('home');
        $('joinCode').value = code;
      }
    } else {
      show('home');
    }
  }

  boot();
})();
