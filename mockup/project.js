// Project mode: the dashboard talks to the local orchestrator (127.0.0.1:5180) and shows one project's team.
import { t, onLangChange } from './i18n.js';

const ORCH = `http://${location.hostname === 'localhost' ? 'localhost' : '127.0.0.1'}:5180`;
const LS_KEY = 'agent-hq-mode';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hhmm = (ts) => new Date(ts).toTimeString().slice(0, 5);
const ROLE_LABEL = { pm: 'PM', ba: 'BA', sa: 'SA', dev: 'Programmer', qa: 'QA', user: '', system: '' };
const ROLE_ORDER = ['pm', 'ba', 'sa', 'dev', 'qa'];
const ROLE_COLOR = { pm: '#d97757', ba: '#1fa774', sa: '#4f8cff', dev: '#9b6bff', qa: '#f2a20c' };
const ENGINE_ORDER = ['claude', 'opencode', 'cursor', 'gemini'];
const WAITING_YOU = 'menunggu jawabanmu';
const WORK_ST = new Set(['dikerjakan', 'review_kode', 'perbaikan', 'run_aplikasi', 'testing']);
const isWorking = (a) => a && !['idle', 'error'].includes(a.state) && a.task !== WAITING_YOU;
const STATUS_COLOR = { testing: '#f2a20c', laporan: '#d97757', dikerjakan: '#9b6bff', review_kode: '#4f8cff', perbaikan: '#f2a20c', run_aplikasi: '#9b6bff', siap_qa: '#14b8c4', baru: '#8a8f98', tanya_pengguna: '#f2a20c', tunggu_klien: '#9b6bff', analisa_bisnis: '#1fa774', analisa_teknis: '#4f8cff', menunggu_persetujuan: '#e5484d', siap_dikerjakan: '#14b8c4', siap: '#14b8c4', selesai: '#1fa774', gagal: '#e5484d' };

async function api(method, p, body) {
  const r = await fetch(ORCH + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
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
      hooks.applySnapshot(snap.agents);
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
    const paused = Object.entries(snap.paused || {});
    const team = snap.agents.map((a) => `<span class="team-chip ${isWorking(a) ? 'on' : ''}" title="${esc(a.source)} · ${esc(a.model)}" style="--c:${ROLE_COLOR[roleOf(a)] || '#888'}">${esc(a.name)}</span>`).join('');
    head.innerHTML = `<div class="cp-title"><b>${esc(snap.project.name)}</b><small>${snap.project.folders.length} ${esc(t('proj.folders'))} · ${esc(t('proj.active', { n: snap.active, max: snap.maxActive }))}</small></div><div class="team">${team}</div>`;
    if (paused.length) head.innerHTML += `<div class="cp-pause">☕ ${esc(t('proj.paused', { e: paused.map(([e, ts]) => `${e} ${hhmm(ts)}`).join(', ') }))}</div>`;
    foot.hidden = tab !== 'chat';
    $('#cpStop', chat).hidden = !working.length;
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

  function renderMsg(m, pendingIds) {
    const who = m.who || (ROLE_LABEL[m.from] ?? m.from);
    const time = `<time>${hhmm(m.t)}</time>`;
    if (m.from === 'system' && m.kind === 'handoff') return `<div class="msg sys handoff">${time} <b style="color:${ROLE_COLOR[m.by]}">${esc(ROLE_LABEL[m.by])}</b> → <b style="color:${ROLE_COLOR[m.to]}">${esc(ROLE_LABEL[m.to])}</b> <span class="tkid">${esc(m.ticket)}</span> ${esc(m.text.replace(/^[^:]+:\s*/, ''))}</div>`;
    if (m.from === 'system' && m.kind === 'work') return `<div class="msg sys work">${time} 🛠️ ${md(m.text)}</div>`;
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
      const btns = open ? `<div class="perm-btns" data-p="${esc(m.permission)}"><button data-d="once">${esc(t('perm.once'))}</button><button data-d="always">${esc(t('perm.always'))}</button><button data-d="deny" class="no">${esc(t('perm.deny'))}</button></div>` : '';
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
        alert(err.message);
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
    draft = project ? structuredClone(project) : { id: null, name: '', folders: [], roles: { pm: { engine: Object.keys(state.engines).find((k) => state.engines[k]?.available) || 'claude', model: '' } } };
    browse = null;
    modal.hidden = false;
    renderModal();
    for (const e of new Set(ROLE_ORDER.map((r) => roleCfg(r).engine))) loadModels(e);
  }
  const roleCfg = (role) => draft.roles[role] || draft.roles.pm || { engine: 'claude', model: '' };
  function renderModal() {
    const engOpts = (cur) => ENGINE_ORDER.map((k) => `<option value="${k}" ${cur === k ? 'selected' : ''} ${state.engines[k]?.available ? '' : 'disabled'}>${k}${state.engines[k]?.available ? '' : ' — ' + t('proj.notInstalled')}</option>`).join('');
    const rows = ROLE_ORDER.map((role) => {
      const r = state.roles?.[role] || {};
      const cfg = roleCfg(role);
      const later = r.active === false ? `<small class="later">${esc(t('proj.roleLater', { n: r.stage }))}</small>` : '';
      const err = models[cfg.engine]?.error ? `<small class="err">${esc(t('proj.modelsError'))}</small>` : '';
      return `<div class="role-row" data-role="${role}"><div class="role-name" style="--c:${ROLE_COLOR[role]}">${esc(ROLE_LABEL[role])}${later}</div>
        <select class="r-engine">${engOpts(cfg.engine)}</select>
        <span class="modelrow">${modelSelect(cfg.engine, cfg.model, role)}<button type="button" class="r-reload" title="${esc(t('proj.modelsReload'))}">↻</button></span>${err}</div>`;
    }).join('');
    $('.pm-body', modal).innerHTML = `
      <label>${esc(t('proj.name'))}<input id="pmName" value="${esc(draft.name)}" placeholder="Gravis"></label>
      <div class="pm-sec"><b>${esc(t('proj.foldersTitle'))}</b><small>${esc(t('proj.foldersHint'))}</small>
        <ul class="flist">${draft.folders.map((f, i) => `<li><span title="${esc(f)}">📁 ${esc(f.replace(/^\/Users\/[^/]+/, '~'))}</span><button data-rm="${i}">✕</button></li>`).join('') || `<li class="muted">${esc(t('proj.noFolders'))}</li>`}</ul>
        ${browse ? renderBrowser() : `<button id="pmAdd">＋ ${esc(t('proj.addFolder'))}</button>`}
      </div>
      <div class="pm-sec"><b>${esc(t('proj.teamTitle'))}</b><small>${esc(t('proj.teamHint'))}</small>
        <div class="role-head"><span></span><span>${esc(t('proj.engine'))}</span><span>${esc(t('proj.model'))}</span></div>
        ${rows}
      </div>`;
    const name = $('#pmName', modal);
    name.oninput = () => (draft.name = name.value);
    for (const row of modal.querySelectorAll('.role-row')) {
      const role = row.dataset.role;
      row.querySelector('.r-engine').onchange = (e) => {
        draft.roles[role] = { engine: e.target.value, model: '' };
        renderModal();
        loadModels(e.target.value);
      };
      row.querySelector('.r-model').onchange = (e) => (draft.roles[role] = { ...roleCfg(role), model: e.target.value });
      row.querySelector('.r-reload').onclick = () => loadModels(roleCfg(role).engine, true);
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
    try {
      let p = draft.id ? null : await api('POST', '/api/projects', { name: draft.name });
      const id = draft.id || p.id;
      p = await api('PUT', `/api/projects/${id}`, { name: draft.name, folders: draft.folders, roles: draft.roles });
      projectId = id;
      modal.hidden = true;
      hooks.resetWorld();
      await loadState();
    } catch (err) {
      alert(err.message);
    }
  });

  onLangChange(() => {
    input.placeholder = t('proj.inputPh');
    renderSelect();
    render();
    if (!modal.hidden) renderModal();
  });
}
