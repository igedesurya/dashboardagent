// Project mode: the dashboard talks to the local orchestrator (127.0.0.1:5180) and shows one project's team.
import { t, onLangChange } from './i18n.js';

const ORCH = `http://${location.hostname === 'localhost' ? 'localhost' : '127.0.0.1'}:5180`;
const LS_KEY = 'agent-hq-mode';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);
const ROLE_LABEL = { worker: 'Kerja', pm: 'PM', ba: 'BA', sa: 'SA', dev: 'Programmer', qa: 'QA', user: '', system: '' };
const ROLE_COLOR = { worker: '#9b6bff', pm: '#d97757', ba: '#1fa774', sa: '#4f8cff', dev: '#9b6bff', qa: '#f2a20c' };
const ENGINE_ORDER = ['claude', 'opencode', 'cursor', 'gemini'];
const WAITING_YOU = 'menunggu jawabanmu';
const WORK_ST = new Set(['dikerjakan', 'review_kode', 'perbaikan', 'run_aplikasi', 'testing']);
const isWorking = (a) => a && !['idle', 'error'].includes(a.state) && a.task !== WAITING_YOU;
const STATUS_COLOR = { butuh_keputusan: '#e5484d', testing: '#f2a20c', laporan: '#d97757', dikerjakan: '#9b6bff', review_kode: '#4f8cff', perbaikan: '#f2a20c', run_aplikasi: '#9b6bff', siap_qa: '#14b8c4', baru: '#8a8f98', tanya_pengguna: '#f2a20c', tunggu_klien: '#9b6bff', analisa_bisnis: '#1fa774', analisa_teknis: '#4f8cff', menunggu_persetujuan: '#e5484d', siap_dikerjakan: '#14b8c4', siap: '#14b8c4', selesai: '#1fa774', gagal: '#e5484d' };

async function api(method, p, body) {
  const r = await fetch(ORCH + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, data: j });
  return j;
}

// Very small markdown: code blocks, inline code, bold, line breaks.
function md(s) {
  const parts = String(s ?? '').split(/```[\w-]*\n?/);
  return parts
    .map((p, i) => (i % 2 ? `<pre>${esc(p.replace(/\n$/, ''))}</pre>` : esc(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')))
    .join('');
}

export function initProjectMode(hooks) {
  let mode = 'editors';
  let projectId = null;
  let state = { projects: [], engines: {} };
  let snap = null;
  let es = null;
  let tab = 'chat';
  let online = false;
  let structKey = '';
  let liveKey = '';
  let agentKey = '';
  let paintRev = 0;

  const chat = $('#chatPanel');
  const modal = $('#projModal');
  const sel = $('#projSelect');

  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (saved.project) projectId = saved.project;
    if (saved.mode === 'project') setTimeout(() => setMode('project'), 0);
  } catch {}
  const persist = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ mode, project: projectId }));
    } catch {}
  };

  // ---------- mode switch ----------
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
  async function setMode(m) {
    if (m === mode) return;
    mode = m;
    persist();
    syncPanelBtn();
    document.body.classList.toggle('project-mode', m === 'project');
    for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === m);
    hooks.resetWorld();
    if (m === 'editors') {
      es?.close();
      es = null;
      snap = null;
      hooks.setPanel(false);
      hooks.connectEditors();
      return;
    }
    hooks.disconnectEditors();
    hooks.setPanel(true);
    await loadState();
  }

  async function loadState() {
    try {
      state = await api('GET', '/api/state');
      online = true;
    } catch {
      online = false;
      state = { projects: [], engines: {} };
    }
    if (!state.projects.find((p) => p.id === projectId)) projectId = state.projects[0]?.id || null;
    renderSelect();
    if (projectId) connect();
    else {
      es?.close();
      snap = null;
      render();
      if (online) openModal(null);
    }
  }

  function renderSelect() {
    sel.innerHTML = state.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('') + `<option value="__new">${esc(t('proj.new'))}</option>`;
  }
  sel.addEventListener('change', () => {
    if (sel.value === '__new') {
      renderSelect();
      return openModal(null);
    }
    projectId = sel.value;
    persist();
    hooks.resetWorld();
    connect();
  });
  $('#projSettings').addEventListener('click', () => (online ? openModal(state.projects.find((p) => p.id === projectId) || null) : loadState()));

  function connect() {
    es?.close();
    persist();
    es = new EventSource(`${ORCH}/api/projects/${encodeURIComponent(projectId)}/stream`);
    es.onmessage = (e) => {
      online = true;
      snap = JSON.parse(e.data);
      const nextAgents = snap.agents.map((a) => `${a.id}\0${a.state}\0${a.task || ''}\0${a.tool || ''}`).join('\n');
      if (nextAgents !== agentKey) {
        agentKey = nextAgents;
        hooks.applySnapshot(snap.agents);
      }
      hooks.setModeText(`<i class="live"></i>${esc(snap.project.name)}`);
      render();
    };
    es.onerror = () => {
      online = false;
      hooks.setModeText(esc(t('proj.offlineShort')));
      render();
    };
  }

  // ---------- chat panel ----------
  const panelBtn = $('#panelBtn');
  function syncPanelBtn() {
    panelBtn.dataset.i18nTitle = mode === 'project' ? 'proj.cardToggle' : 'hud.tooltip.agents';
    panelBtn.title = t(panelBtn.dataset.i18nTitle);
  }

  const CP_KEY = 'agent-hq-cp';
  let cpW = 320;
  let cpH = 55;
  const wideScreen = () => window.innerWidth > 760;
  const maxW = () => Math.max(320, window.innerWidth - 36);
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }
  function applyCardSize() {
    const w = clamp(cpW, 280, maxW());
    const h = clamp(cpH, 28, 88);
    document.documentElement.style.setProperty('--cp-w', Math.round(w) + 'px');
    document.documentElement.style.setProperty('--cp-h', Math.round(h) + 'vh');
    $('#cpSmaller').disabled = wideScreen() ? w <= 280 : h <= 28;
    $('#cpBigger').disabled = wideScreen() ? w >= maxW() - 8 : h >= 88;
    $('#cpResize').setAttribute('aria-orientation', wideScreen() ? 'vertical' : 'horizontal');
    hooks.resize();
  }
  function saveCardSize() {
    try {
      localStorage.setItem(CP_KEY, JSON.stringify({ w: Math.round(cpW), h: Math.round(cpH) }));
    } catch {}
  }
  try {
    const savedCard = JSON.parse(localStorage.getItem(CP_KEY) || '{}');
    if (savedCard.w) cpW = savedCard.w;
    if (savedCard.h) cpH = savedCard.h;
  } catch {}
  applyCardSize();

  function stepCard(dir) {
    if (wideScreen()) cpW = clamp(cpW + dir * 160, 280, maxW());
    else cpH = clamp(cpH + dir * 12, 28, 88);
    applyCardSize();
    saveCardSize();
  }
  $('#cpSmaller').addEventListener('click', () => stepCard(-1));
  $('#cpBigger').addEventListener('click', () => stepCard(1));
  $('#cpHide').addEventListener('click', () => hooks.setPanel(false));
  $('#cpResize').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const wide = wideScreen();
    const start = wide ? e.clientX : e.clientY;
    const base = wide ? cpW : cpH;
    const vh = window.innerHeight / 100;
    document.body.classList.add('cp-drag');
    try { handle.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => {
      if (wide) cpW = clamp(base + (start - ev.clientX), 280, maxW());
      else cpH = clamp(base + (start - ev.clientY) / vh, 28, 88);
      applyCardSize();
    };
    const up = () => {
      document.body.classList.remove('cp-drag');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      saveCardSize();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  addEventListener('resize', () => applyCardSize());

  for (const b of chat.querySelectorAll('[data-tab]')) b.addEventListener('click', () => {
    tab = b.dataset.tab;
    render();
  });

  function render() {
    for (const b of chat.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
    const body = $('.cp-body', chat);
    const head = $('.cp-head', chat);
    const foot = $('.cp-foot', chat);
    if (!online) {
      head.innerHTML = `<b>${esc(t('proj.title'))}</b>`;
      body.innerHTML = `<div class="cp-empty"><b>${esc(t('proj.offline'))}</b><p>${esc(t('proj.offlineHint'))}</p><button id="cpRetry">${esc(t('proj.retry'))}</button></div>`;
      $('#cpRetry', body).onclick = loadState;
      foot.hidden = true;
      return;
    }
    if (!snap) {
      head.innerHTML = `<b>${esc(t('proj.title'))}</b>`;
      body.innerHTML = `<div class="cp-empty"><p>${esc(t('proj.none'))}</p><button id="cpNew">${esc(t('proj.new'))}</button></div>`;
      $('#cpNew', body).onclick = () => openModal(null);
      foot.hidden = true;
      return;
    }
    const working = snap.agents.filter(isWorking);
    const sk = structureKey();
    const lk = activityKey(working);
    if (sk === structKey && lk === liveKey) return;
    if (sk === structKey && tab === 'sop') {
      structKey = sk;
      liveKey = lk;
      paintTeam(working);
      return;
    }
    const activityOnly = sk === structKey && tab === 'chat' && body.querySelector('.msg, .cp-empty');
    structKey = sk;
    liveKey = lk;
    if (activityOnly) {
      paintTeam(working);
      paintTyping(body, working);
      return;
    }
    const paused = Object.entries(snap.paused || {});
    const team = teamHtml(working);
    head.innerHTML = `<div class="cp-title"><b>${esc(snap.project.name)}</b><small>${snap.project.folders.length} ${esc(t('proj.folders'))} · ${esc(t('proj.active', { n: snap.active, max: snap.maxActive }))}</small></div><div class="team">${team}</div>`;
    if (paused.length) head.innerHTML += `<div class="cp-pause">☕ ${esc(t('proj.paused', { e: paused.map(([e, ts]) => `${e} ${hhmm(ts)}`).join(', ') }))}</div>`;
    foot.hidden = tab !== 'chat';
    const needBrief = !(snap.project.brief?.jenis && snap.project.brief?.tujuan);
    if (needBrief && tab === 'chat') {
      body.innerHTML = `<div class="cp-empty"><b>${esc(t('brief.needTitle'))}</b><p>${esc(t('brief.needHint'))}</p><button id="cpBrief" class="primary">${esc(t('brief.fill'))}</button></div>`;
      $('#cpBrief', body).onclick = () => openModal(state.projects.find((p) => p.id === projectId) || snap.project);
      foot.hidden = true;
      return;
    }
    $('#cpStop', chat).hidden = !working.length;
    if (tab === 'sop') {
      renderSop(body);
      return;
    }
    if (tab === 'tickets') {
      const open = new Set([...body.querySelectorAll('details[open]')].map((d) => d.dataset.tk));
      body.innerHTML = snap.tickets.length ? [...snap.tickets].reverse().map((tk) => renderTicket(tk, open.has(tk.id))).join('') : `<div class="cp-empty"><p>${esc(t('proj.noTickets'))}</p></div>`;
      return;
    }
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    const pendingIds = new Set(snap.pending.map((p) => p.id));
    // Keep half-typed answers and the caret across re-renders.
    const drafts = {};
    for (const f of body.querySelectorAll('form.ans, form.rev')) drafts[f.dataset.q] = f.querySelector('textarea').value;
    const focused = document.activeElement?.closest?.('form.ans, form.rev')?.dataset.q;
    const caret = focused ? document.activeElement.selectionStart : 0;
    body.innerHTML = snap.chat.length ? snap.chat.map((m) => renderMsg(m, pendingIds)).join('') : `<div class="cp-empty"><p>${esc(t('proj.hello'))}</p></div>`;
    for (const a of working) body.innerHTML += `<div class="msg typing"><span class="who" style="color:${ROLE_COLOR[roleOf(a)]}">${esc(a.name)}</span><span>${esc(a.task || '…')}</span></div>`;
    for (const f of body.querySelectorAll('form.ans, form.rev')) {
      const ta = f.querySelector('textarea');
      if (drafts[f.dataset.q]) ta.value = drafts[f.dataset.q];
      if (f.dataset.q === focused) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    }
    if (atBottom || !body.dataset.init) body.scrollTop = body.scrollHeight;
    body.dataset.init = 1;
  }

  // Chat, tickets, and permissions. Activity text is intentionally not part of this.
  let sopName = '';
  async function renderSop(body) {
    const loop = snap.loop || { playbooks: [], toolbox: [] };
    const editing = document.activeElement?.id === 'sopText';
    const draft = editing ? document.activeElement.value : null;
    body.innerHTML = `<div class="sop"><p class="hint">${esc(t('proj.sopHint'))}</p>
      <b>${esc(t('proj.sopPlay'))}</b>
      <div class="sop-list">${loop.playbooks.map((n) => `<button data-sop="${esc(n)}" class="${n === sopName ? 'on' : ''}">${esc(n)}</button>`).join('') || `<span class="muted">${esc(t('proj.sopEmpty'))}</span>`}
      <button id="sopNew">${esc(t('proj.sopNew'))}</button></div>
      <textarea id="sopText" rows="12"></textarea>
      <div class="cp-actions"><button id="sopSave" class="primary">${esc(t('proj.sopSave'))}</button><button id="sopDelete">${esc(t('proj.sopDelete'))}</button></div>
      <b>${esc(t('proj.sopBox'))}</b>
      <div class="sop-list">${loop.toolbox.map((n) => `<span class="pill">${esc(n)}</span>`).join('') || `<span class="muted">—</span>`}</div></div>`;
    const area = $('#sopText', body);
    if (draft != null) area.value = draft;
    else if (sopName) {
      try {
        const r = await api('GET', `/api/projects/${projectId}/loop?name=${encodeURIComponent(sopName)}`);
        if ($('#sopText', body) === area) area.value = r.text || '';
      } catch {}
    }
    for (const b of body.querySelectorAll('[data-sop]')) b.onclick = () => {
      sopName = b.dataset.sop;
      renderSop(body);
    };
    $('#sopNew', body).onclick = () => {
      const nama = prompt(t('proj.sopNew'));
      if (!nama) return;
      sopName = nama;
      area.value = `# ${nama}\n\n## Langkah\n1. \n\n## Proof\n- [ ] \n`;
    };
    $('#sopSave', body).onclick = async () => {
      const nama = sopName || prompt(t('proj.sopNew'));
      if (!nama) return;
      sopName = nama;
      try {
        await api('PUT', `/api/projects/${projectId}/loop`, { kind: 'playbook', name: nama, text: area.value });
      } catch (err) {
        alert(err.message);
      }
    };
    $('#sopDelete', body).onclick = async () => {
      if (!sopName || !confirm(t('proj.sopDelete'))) return;
      try {
        await api('PUT', `/api/projects/${projectId}/loop`, { kind: 'playbook', name: sopName, hapus: true });
        sopName = '';
        area.value = '';
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function structureKey() {
    const chatSig = snap.chat.map((m) => `${m.id}:${m.answered ? 1 : 0}:${m.decision || ''}:${m.text?.length || 0}`).join(';');
    const ticketSig = snap.tickets.map((t) => `${t.id}:${t.status}:${t.updated}:${t.holder || ''}:${t.docs?.length || 0}:${t.plan?.status || ''}:${t.work?.round || 0}`).join(';');
    const loop = snap.loop || { playbooks: [], toolbox: [] };
    return [paintRev, tab, snap.project.name, snap.project.folders.length, snap.active, JSON.stringify(snap.paused || {}), snap.pending.map((p) => p.id).join(','), chatSig, ticketSig, loop.playbooks.join(','), loop.toolbox.join(',')].join('|');
  }
  function activityKey(working) {
    return working.map((a) => `${a.id}:${a.task || ''}`).join('|');
  }
  function teamHtml() {
    return snap.agents.map((a) => `<span class="team-chip ${isWorking(a) ? 'on' : ''}" title="${esc(a.source)} · ${esc(a.model)}" style="--c:${ROLE_COLOR[roleOf(a)] || '#888'}">${esc(a.name)}</span>`).join('');
  }
  function paintTeam() {
    const el = $('.team', chat);
    if (el) el.innerHTML = teamHtml();
    $('#cpStop', chat).hidden = !snap.agents.some(isWorking);
  }
  function paintTyping(body, working) {
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    for (const n of body.querySelectorAll('.msg.typing')) n.remove();
    const html = working.map((a) => `<div class="msg typing"><span class="who" style="color:${ROLE_COLOR[roleOf(a)]}">${esc(a.name)}</span><span>${esc(a.task || '…')}</span></div>`).join('');
    if (html) body.insertAdjacentHTML('beforeend', html);
    if (atBottom) body.scrollTop = body.scrollHeight;
  }

  function renderMsg(m, pendingIds) {
    const who = m.who || (ROLE_LABEL[m.from] ?? m.from);
    const time = `<time>${hhmm(m.t)}</time>`;
    if (m.from === 'system' && m.kind === 'handoff') return `<div class="msg sys handoff">${time} <b style="color:${ROLE_COLOR[m.by]}">${esc(ROLE_LABEL[m.by])}</b> → <b style="color:${ROLE_COLOR[m.to]}">${esc(ROLE_LABEL[m.to])}</b> <span class="tkid">${esc(m.ticket)}</span> ${esc(m.text.replace(/^[^:]+:\s*/, ''))}</div>`;
    if (m.from === 'system' && m.kind === 'work') return `<div class="msg sys work">${time} 🛠️ ${md(m.text)}</div>`;
    if (m.kind === 'escalation') {
      const tk = snap.tickets.find((x) => x.id === m.ticket);
      const open = !m.decision && tk?.status === 'butuh_keputusan';
      const btns = open ? `<div class="perm-btns" data-esc="${esc(m.ticket)}"><button data-ed="more">${esc(t('esc.more'))}</button><button data-ed="accept">${esc(t('esc.accept'))}</button><button data-ed="stop" class="no">${esc(t('esc.stop'))}</button></div>` : '';
      const done = m.decision ? `<div class="dec ${m.decision === 'stop' ? 'deny' : 'once'}">${esc(t('esc.done.' + m.decision))}</div>` : '';
      return `<div class="msg card perm ${open ? 'open' : ''}"><div class="card-h">⏸️ <b>${esc(t(m.esc === 'qa' ? 'esc.titleQa' : 'esc.titleReview'))}</b> <span class="tkid">${esc(m.ticket)}</span>${time}</div><div class="plan-text">${md(m.text)}</div><small>${esc(t('esc.hint'))}</small>${btns}${done}</div>`;
    }
    if (m.from === 'system') return `<div class="msg sys ${m.kind}">${time} ${md(m.text)}</div>`;
    if (m.kind === 'qa') return `<div class="msg card qa ${m.pass ? 'pass' : 'fix'}"><div class="card-h">🧪 <b style="color:${ROLE_COLOR.qa}">${esc(who)}</b> ${esc(t(m.pass ? 'qa.pass' : 'qa.fail'))} <span class="tkid">${esc(m.ticket)}</span>${time}</div><div class="plan-text">${md(m.text)}</div></div>`;
    if (m.kind === 'review') return `<div class="msg card review ${m.verdict}"><div class="card-h">🔍 <b style="color:${ROLE_COLOR.sa}">SA</b> ${esc(t(m.verdict === 'pass' ? 'review.pass' : 'review.fix'))} <span class="tkid">${esc(m.ticket)}</span>${time}</div>${md(m.text)}</div>`;
    if (m.kind === 'approval') {
      const tk = snap.tickets.find((x) => x.id === m.ticket);
      const waiting = !m.decision && tk?.status === 'menunggu_persetujuan';
      const done = m.decision ? `<div class="dec ${m.decision === 'approve' ? 'once' : 'deny'}">${esc(t('plan.done.' + m.decision))}${m.note ? ': ' + esc(m.note) : ''}</div>` : waiting ? '' : `<div class="dec">${esc(t('plan.superseded'))}</div>`;
      const form = waiting
        ? `<div class="plan-btns"><button class="primary" data-plan="approve" data-tk="${esc(m.ticket)}">✓ ${esc(t('plan.approve'))}</button></div><form class="rev" data-q="rev-${esc(m.id)}" data-tk="${esc(m.ticket)}"><textarea rows="2" placeholder="${esc(t('plan.revisePh'))}"></textarea><button>${esc(t('plan.revise'))}</button></form>`
        : '';
      return `<div class="msg card plan ${waiting ? 'open' : ''}"><div class="card-h">🧭 <b style="color:${ROLE_COLOR[m.from]}">${esc(who)}</b> ${esc(t('plan.asks'))} <span class="tkid">${esc(m.ticket)}</span>${time}</div><div class="plan-meta">👩‍💻 ${esc(t('plan.devs', { n: m.programmer }))} · 🧪 ${esc(t('plan.qas', { n: m.qa }))}</div><div class="plan-text">${md(m.text)}</div>${form}${done}</div>`;
    }
    if (m.from === 'user') return `<div class="msg me">${m.kind === 'answer' ? `<small>${esc(t('proj.answerTo', { q: m.question }))}</small>` : ''}${md(m.text)}${time}</div>`;
    if (m.kind === 'question') {
      const form = m.answered ? '' : `<form class="ans" data-q="${esc(m.question)}"><textarea rows="2" placeholder="${esc(t('proj.answerPh'))}"></textarea><button>${esc(t('proj.answer'))}</button></form>`;
      return `<div class="msg card q ${m.answered ? 'done' : ''}"><div class="card-h">❓ <b style="color:${ROLE_COLOR[m.from]}">${esc(who)}</b> ${esc(t('proj.asks'))} ${m.ticket ? `<span class="tkid">${esc(m.ticket)}</span>` : ''}${time}</div>${md(m.text)}${form}</div>`;
    }
    if (m.kind === 'permission') {
      const open = pendingIds.has(m.permission);
      const done = m.decision ? `<div class="dec ${m.decision}">${esc(t('perm.done.' + m.decision))}</div>` : open ? '' : `<div class="dec">${esc(t('perm.expired'))}</div>`;
      const btns = open ? `<div class="perm-btns" data-p="${esc(m.permission)}"><button data-d="once">${esc(t('perm.once'))}</button>${m.rememberable ? `<button data-d="always" title="${esc(t('perm.alwaysHint', { who }))}">${esc(t('perm.alwaysScoped', { who }))}</button>` : ''}<button data-d="deny" class="no">${esc(t('perm.deny'))}</button></div>` : '';
      return `<div class="msg card perm ${open ? 'open' : ''}"><div class="card-h">🔐 <b>${esc(who)}</b> ${esc(t('perm.asks'))}${time}</div><div>${esc(m.text)}</div><small>${esc(t('perm.reason'))}: ${esc(m.reason || '')}</small>${btns}${done}</div>`;
    }
    if (m.kind === 'report') return `<div class="msg card rep"><div class="card-h">📋 <b>${esc(who)}</b> ${esc(t('proj.report'))} ${m.ticket ? `<span class="tkid">${esc(m.ticket)}</span>` : ''}${time}</div>${md(m.text)}</div>`;
    return `<div class="msg them"><span class="who" style="color:${ROLE_COLOR[m.from] || '#d97757'}">${esc(who)}</span>${md(m.text)}${time}</div>`;
  }

  function roleOf(a) {
    return a.id.split(':')[2];
  }

  function renderTicket(tk, open) {
    const holder = tk.holder === 'user' ? t('tk.holderYou') : ROLE_LABEL[tk.holder] || '';
    const docs = (tk.docs || []).map((d) => `<div class="tk-doc"><b style="color:${ROLE_COLOR[d.role]}">${esc(ROLE_LABEL[d.role])}</b> · ${esc(t('doc.' + d.jenis))}<div>${md(d.isi)}</div></div>`).join('');
    const plan = tk.plan ? `<div class="tk-doc"><b style="color:${ROLE_COLOR.sa}">SA</b> · ${esc(t('plan.title'))} (${esc(t('plan.st.' + tk.plan.status))}; ${esc(t('plan.devs', { n: tk.plan.programmer }))}, ${esc(t('plan.qas', { n: tk.plan.qa }))})<div>${md(tk.plan.text)}</div></div>` : '';
    const w = tk.work;
    const anyBusy = snap.agents.some((a) => roleOf(a) === 'dev' && isWorking(a) && a.project);
    const work = w ? `<div class="tk-work">🌿 <code>ahq/${esc(tk.id)}</code> · ${w.repos.map((r) => esc(r.name)).join(', ')}<div class="devs">${Object.entries(w.devs).map(([n, d]) => `<span class="dev ${esc(d.status)}">P${esc(n)} · ${esc(t('dev.' + d.status))}</span>`).join('')}${Object.entries(w.qa || {}).map(([n, q]) => `<span class="dev qa-${esc(q.status)}">QA${esc(n)} · ${esc(t('qa.st.' + q.status))}</span>`).join('')}</div>${WORK_ST.has(tk.status) && !anyBusy ? `<button class="resume" data-resume="${esc(tk.id)}">▶ ${esc(t('tk.resume'))}</button>` : ''}</div>` : '';
    const more = docs || plan ? `<details data-tk="${esc(tk.id)}" ${open ? 'open' : ''}><summary>${esc(t('tk.docs', { n: (tk.docs || []).length + (tk.plan ? 1 : 0) }))}</summary>${docs}${plan}</details>` : '';
    return `<div class="tk"><div class="tk-top"><b>${esc(tk.id)}</b><span class="pill" style="--c:${STATUS_COLOR[tk.status] || '#8a8f98'}">${esc(t('tk.' + tk.status))}</span>${holder ? `<span class="holder" style="--c:${ROLE_COLOR[tk.holder] || '#e5484d'}">${esc(holder)}</span>` : ''}<small>${esc(t('tk.type.' + tk.jenis))}</small></div><div class="tk-title">${esc(tk.judul)}</div><div class="tk-sum">${esc(String(tk.ringkasan).slice(0, 220))}</div>${work}${more}</div>`;
  }

  chat.addEventListener('submit', async (e) => {
    const rev = e.target.closest('form.rev');
    if (rev) {
      e.preventDefault();
      const note = rev.querySelector('textarea').value.trim();
      if (!note) return alert(t('plan.needNote'));
      rev.querySelector('button').disabled = true;
      try {
        await api('POST', `/api/projects/${projectId}/plan`, { ticket: rev.dataset.tk, decision: 'revise', note });
      } catch (err) {
        alert(err.message);
        rev.querySelector('button').disabled = false;
      }
      return;
    }
    const f = e.target.closest('form.ans');
    if (!f) return;
    e.preventDefault();
    const text = f.querySelector('textarea').value.trim();
    if (!text) return;
    f.querySelector('button').disabled = true;
    try {
      await api('POST', `/api/projects/${projectId}/answer`, { question: f.dataset.q, text });
    } catch (err) {
      alert(err.message);
      f.querySelector('button').disabled = false;
    }
  });
  chat.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-ed]');
    if (ed) {
      const box = ed.parentElement;
      if (ed.dataset.ed === 'stop' && !confirm(t('esc.stopConfirm'))) return;
      for (const x of box.querySelectorAll('button')) x.disabled = true;
      try {
        await api('POST', `/api/projects/${projectId}/decide`, { ticket: box.dataset.esc, decision: ed.dataset.ed });
      } catch (err) {
        alert(err.message);
        for (const x of box.querySelectorAll('button')) x.disabled = false;
      }
      return;
    }
    const rs = e.target.closest('[data-resume]');
    if (rs) {
      rs.disabled = true;
      try {
        await api('POST', `/api/projects/${projectId}/resume`, { ticket: rs.dataset.resume });
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    const ap = e.target.closest('[data-plan]');
    if (ap) {
      ap.disabled = true;
      try {
        await api('POST', `/api/projects/${projectId}/plan`, { ticket: ap.dataset.tk, decision: 'approve' });
      } catch (err) {
        if (err.status === 409 && err.data?.dirty) {
          const list = err.data.dirty.map((d) => `• ${d.repo}: ${d.count} file (${d.sample.join(', ')}${d.count > d.sample.length ? ', …' : ''})`).join('\n');
          if (confirm(t('plan.dirty', { list }))) {
            try {
              await api('POST', `/api/projects/${projectId}/plan`, { ticket: ap.dataset.tk, decision: 'approve', force: true });
              return;
            } catch (e2) {
              alert(e2.message);
            }
          }
        } else alert(err.message);
        ap.disabled = false;
      }
      return;
    }
    const b = e.target.closest('.perm-btns button');
    if (!b) return;
    const id = b.parentElement.dataset.p;
    for (const x of b.parentElement.querySelectorAll('button')) x.disabled = true;
    try {
      await api('POST', `/api/permissions/${id}`, { decision: b.dataset.d });
    } catch (err) {
      alert(err.message);
    }
  });
  const input = $('#cpInput');
  input.placeholder = t('proj.inputPh');
  async function sendMsg() {
    const text = input.value.trim();
    if (!text || !projectId) return;
    input.disabled = true;
    try {
      await api('POST', `/api/projects/${projectId}/chat`, { text });
      input.value = '';
    } catch (err) {
      alert(err.message);
    }
    input.disabled = false;
    input.focus();
  }
  $('#cpSend').addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });
  $('#cpStop').addEventListener('click', () => projectId && api('POST', `/api/projects/${projectId}/stop`, {}).catch(() => {}));

  // ---------- project settings ----------
  let draft = null;
  let browse = null;
  // Model lists come from the engines themselves (opencode: every configured provider, including 9router).
  const models = {}; // engine -> { list, loading, error }
  async function loadModels(engine, refresh = false) {
    if (models[engine]?.list && !refresh) return;
    models[engine] = { loading: true };
    renderModal();
    try {
      const r = await api('GET', `/api/models?engine=${engine}${refresh ? '&refresh=1' : ''}`);
      models[engine] = { list: r.models };
    } catch (err) {
      models[engine] = { error: err.message };
    }
    if (!modal.hidden) renderModal();
  }
  function modelSelect(engine, current) {
    const m = models[engine] || {};
    if (m.loading) return `<select class="r-model" disabled><option>${esc(t('proj.modelsLoading'))}</option></select>`;
    const list = m.list || [];
    const groups = new Map();
    for (const x of list) {
      if (!groups.has(x.provider)) groups.set(x.provider, []);
      groups.get(x.provider).push(x);
    }
    const opt = (v, label) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(label)}</option>`;
    let html = opt('', t('proj.modelDefault', { m: state.engines[engine]?.defaultModel || 'auto' }));
    if (current && !list.some((x) => x.value === current)) html += opt(current, current);
    // Providers the user set up themselves (e.g. 9router) first, then the rest alphabetically.
    const order = [...groups.keys()].sort((a, b) => (a === 'opencode') - (b === 'opencode') || a.localeCompare(b));
    for (const g of order) html += `<optgroup label="${esc(g)} (${groups.get(g).length})">${groups.get(g).map((x) => opt(x.value, x.label + (x.free ? ' · ' + t('proj.free') : ''))).join('')}</optgroup>`;
    return `<select class="r-model">${html}</select>`;
  }
  function openModal(project) {
    const picked = Object.keys(state.engines).find((k) => state.engines[k]?.available) || 'cursor';
    draft = project ? structuredClone(project) : { id: null, name: '', folders: [], brief: {} };
    draft.worker = draft.worker || draft.roles?.dev || draft.roles?.pm || { engine: picked, model: '' };
    draft.qa = draft.qa || draft.roles?.qa || { engine: state.engines.gemini?.available ? 'gemini' : draft.worker.engine, model: '' };
    browse = null;
    modal.hidden = false;
    renderModal();
    loadModels(draft.worker.engine);
    loadModels(draft.qa.engine);
  }
  function renderModal() {
    const engOpts = (cur) => ENGINE_ORDER.map((k) => `<option value="${k}" ${cur === k ? 'selected' : ''} ${state.engines[k]?.available ? '' : 'disabled'}>${k}${state.engines[k]?.available ? '' : ' — ' + t('proj.notInstalled')}</option>`).join('');
    const rows = [['worker', t('proj.seatWorker')], ['qa', t('proj.seatQa')]].map(([seat, label]) => {
      const cfg = draft[seat];
      const err = models[cfg.engine]?.error ? `<small class="err">${esc(t('proj.modelsError'))}</small>` : /opus/i.test(cfg.model || '') ? `<small class="err">⚠️ ${esc(t('proj.heavyModel'))}</small>` : '';
      return `<div class="role-row" data-seat="${seat}"><div class="role-name" style="--c:${ROLE_COLOR[seat]}">${esc(label)}</div>
        <select class="r-engine">${engOpts(cfg.engine)}</select>
        <span class="modelrow">${modelSelect(cfg.engine, cfg.model)}<button type="button" class="r-reload" title="${esc(t('proj.modelsReload'))}">↻</button></span>${err}</div>`;
    }).join('');
    $('.pm-body', modal).innerHTML = `
      <label>${esc(t('proj.name'))}<input id="pmName" value="${esc(draft.name)}" placeholder="Gravis"></label>
      <div class="pm-sec"><b>${esc(t('proj.foldersTitle'))}</b><small>${esc(t('proj.foldersHint'))}</small>
        <ul class="flist">${draft.folders.map((f, i) => `<li><span title="${esc(f)}">📁 ${esc(f.replace(/^\/Users\/[^/]+/, '~'))}</span><button data-rm="${i}">✕</button></li>`).join('') || `<li class="muted">${esc(t('proj.noFolders'))}</li>`}</ul>
        ${browse ? renderBrowser() : `<button id="pmAdd">＋ ${esc(t('proj.addFolder'))}</button>`}
      </div>
      <div class="pm-sec brief"><b>${esc(t('brief.title'))}</b><small>${esc(t('brief.hint'))}</small>
        <label>${esc(t('brief.kind'))} *<select id="bJenis"><option value="">—</option>${['software', 'tulisan', 'lainnya'].map((k) => `<option value="${k}" ${draft.brief?.jenis === k ? 'selected' : ''}>${esc(t('brief.kind.' + k))}</option>`).join('')}</select></label>
        <label>${esc(t('brief.goal'))} *<textarea id="bTujuan" rows="3" placeholder="${esc(t('brief.goalPh'))}">${esc(draft.brief?.tujuan || '')}</textarea></label>
        ${draft.brief?.jenis === 'software' || !draft.brief?.jenis ? `<label>${esc(t('brief.run'))}<input id="bJalankan" value="${esc(draft.brief?.jalankan || '')}" placeholder="npm run dev · flutter run"></label>
        <label>${esc(t('brief.test'))}<input id="bUji" value="${esc(draft.brief?.uji || '')}" placeholder="npm test · flutter test"></label>` : ''}
        <label>${esc(t('brief.rules'))}<textarea id="bAturan" rows="2" placeholder="${esc(t('brief.rulesPh'))}">${esc(draft.brief?.aturan || '')}</textarea></label>
      </div>
      <div class="pm-sec"><b>${esc(t('proj.seatTitle'))}</b><small>${esc(t('proj.seatHint'))}</small>
        <div class="role-head"><span></span><span>${esc(t('proj.engine'))}</span><span>${esc(t('proj.model'))}</span></div>
        ${rows}
      </div>
      ${draft.id ? renderRemembered() : ''}`;
    for (const [id, field] of [['bJenis', 'jenis'], ['bTujuan', 'tujuan'], ['bJalankan', 'jalankan'], ['bUji', 'uji'], ['bAturan', 'aturan']]) {
      const el = $('#' + id, modal);
      if (!el) continue;
      el.oninput = el.onchange = () => {
        draft.brief = { ...(draft.brief || {}), [field]: el.value };
        if (field === 'jenis') renderModal();
      };
    }
    for (const b of modal.querySelectorAll('[data-forget]')) b.onclick = () => forget(JSON.parse(b.dataset.forget));
    const name = $('#pmName', modal);
    name.oninput = () => (draft.name = name.value);
    for (const row of modal.querySelectorAll('.role-row')) {
      const seat = row.dataset.seat;
      row.querySelector('.r-engine').onchange = (e) => {
        draft[seat] = { engine: e.target.value, model: '' };
        renderModal();
        loadModels(e.target.value);
      };
      row.querySelector('.r-model').onchange = (e) => (draft[seat] = { ...draft[seat], model: e.target.value });
      row.querySelector('.r-reload').onclick = () => loadModels(draft[seat].engine, true);
    }
    $('#pmAdd', modal)?.addEventListener('click', () => openBrowser(null));
    for (const b of modal.querySelectorAll('[data-rm]')) b.onclick = () => {
      draft.folders.splice(+b.dataset.rm, 1);
      renderModal();
    };
    for (const b of modal.querySelectorAll('[data-go]')) b.onclick = () => openBrowser(b.dataset.go);
    $('#fbPick', modal)?.addEventListener('click', () => {
      if (!draft.folders.includes(browse.path)) draft.folders.push(browse.path);
      browse = null;
      renderModal();
    });
    $('#fbClose', modal)?.addEventListener('click', () => {
      browse = null;
      renderModal();
    });
  }
  // "Always allow" entries of this project, per role, removable.
  function renderRemembered() {
    const list = (snap?.project?.id === draft.id && snap.remembered) || [];
    const rows = list.map((r) => `<li><span title="${esc(r.key)}"><b style="color:${ROLE_COLOR[r.role]}">${esc(ROLE_LABEL[r.role])}</b> · ${esc(r.summary || r.key)}</span><button data-forget="${esc(JSON.stringify({ role: r.role, key: r.key }))}">✕</button></li>`).join('');
    return `<div class="pm-sec"><b>${esc(t('perm.savedTitle'))}</b><small>${esc(t('perm.savedHint'))}</small>
      <ul class="flist">${rows || `<li class="muted">${esc(t('perm.savedNone'))}</li>`}</ul>
      ${list.length > 1 ? `<button data-forget='{"all":true}'>${esc(t('perm.savedClear'))}</button>` : ''}</div>`;
  }
  async function forget(what) {
    try {
      await api('POST', `/api/projects/${draft.id}/remembered`, what);
      setTimeout(renderModal, 300);
    } catch (err) {
      alert(err.message);
    }
  }

  function renderBrowser() {
    const crumbs = browse.path.replace(/^\/Users\/[^/]+/, '~');
    return `<div class="fbrowser"><div class="fb-head">${browse.parent ? `<button data-go="${esc(browse.parent)}">⬆</button>` : ''}<span title="${esc(browse.path)}">${esc(crumbs)}</span>${browse.git ? '<span class="git">git</span>' : ''}</div>
      <ul>${browse.dirs.map((d) => `<li data-go="${esc(d.path)}" role="button">📁 ${esc(d.name)}${d.git ? ' <span class="git">git</span>' : ''}</li>`).join('') || `<li class="muted">${esc(t('proj.emptyDir'))}</li>`}</ul>
      <div class="fb-foot"><button id="fbClose">${esc(t('proj.cancel'))}</button><button id="fbPick" class="primary">${esc(t('proj.pickThis'))}</button></div></div>`;
  }
  async function openBrowser(p) {
    try {
      browse = await api('GET', '/api/fs' + (p ? `?path=${encodeURIComponent(p)}` : ''));
    } catch (err) {
      alert(err.message);
    }
    renderModal();
  }
  $('#pmCancel').addEventListener('click', () => (modal.hidden = true));
  $('#pmSave').addEventListener('click', async () => {
    if (!draft.name.trim()) return alert(t('proj.needName'));
    if (!draft.brief?.jenis || !String(draft.brief?.tujuan || '').trim()) return alert(t('brief.needSave'));
    try {
      let p = draft.id ? null : await api('POST', '/api/projects', { name: draft.name });
      const id = draft.id || p.id;
      p = await api('PUT', `/api/projects/${id}`, { name: draft.name, folders: draft.folders, worker: draft.worker, qa: draft.qa, brief: draft.brief });
      projectId = id;
      modal.hidden = true;
      hooks.resetWorld();
      await loadState();
    } catch (err) {
      alert(err.message);
    }
  });

  onLangChange(() => {
    paintRev++;
    syncPanelBtn();
    input.placeholder = t('proj.inputPh');
    renderSelect();
    render();
    if (!modal.hidden) renderModal();
  });
}
