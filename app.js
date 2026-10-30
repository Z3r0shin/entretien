'use strict';
/* Entretien préventif — app hors-ligne (PWA). Données dans IndexedDB sur l'appareil. */
const APP_VERSION = '1.1.0';
// Adresse retirée en 1.0.1 : elle pointait vers l'app d'inventaire des filtres, pas vers le script de cette app.
const RETIRED_SYNC_URL_PART = 'AKfycbwkJyZ63CFji';

// ---------- Utilitaires ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const fmtD = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtT = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDT = iso => { const d = new Date(iso); return `${fmtD(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtHuman = iso => new Date(iso).toLocaleString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtShort = iso => new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: '2-digit' });
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`;

const STATUS = {
  ok: { label: 'Fait', s: '✓' },
  fixed: { label: 'Corrigé', s: '🔧' },
  todo: { label: 'À suivre', s: '⚠' },
  na: { label: 'N/A', s: '–' }
};
const FREQS = [[0, 'Au besoin'], [1, 'Quotidienne'], [7, 'Hebdomadaire'], [14, 'Aux 2 semaines'], [30, 'Mensuelle'], [61, 'Aux 2 mois'], [91, 'Trimestrielle'], [182, '2 fois / an'], [365, 'Annuelle']];
const freqLabel = d => (FREQS.find(f => f[0] === d) || [d, `Aux ${d} jours`])[1];

// ---------- IndexedDB ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('entretien-preventif', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('kv');
        for (const s of ['rounds', 'issues', 'log', 'photos']) d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transaction annulée'));
    });
  },
  get(store, key) { return this.req(store, 'readonly', s => s.get(key)); },
  all(store) { return this.req(store, 'readonly', s => s.getAll()); },
  put(store, val, key) { return this.req(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key))); },
  del(store, key) { return this.req(store, 'readwrite', s => s.delete(key)); },
  clear(store) { return this.req(store, 'readwrite', s => s.clear()); }
};

// ---------- État ----------
const S = {
  settings: { worker: '', syncUrl: '', syncToken: '', autoSync: true, lastSync: null, lastBackup: null, device: '' },
  template: null, buildings: [], rounds: new Map(), issues: new Map(), log: [],
  ui: { filter: 'all', issueTab: 'open', issueBld: '', histBld: '', logBld: '', logQ: '', logLimit: 150, collapsed: {} }
};
let deferredInstall = null, syncing = false, swReg = null;

function slug(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function buildTemplate() {
  const D = window.EP_DATA;
  const mk = (secs, sug) => secs.map(sec => {
    const sid = (sug ? 's-' : 'b-') + slug(sec.name);
    return { id: sid, name: sec.name, suggested: sug, items: sec.items.map(it => {
      const iid = sid + '.' + slug(it.name);
      return { id: iid, name: it.name, tasks: it.tasks.map(t => ({ id: iid + '.' + slug(t[0]), name: t[0], freq: t[1] || 0, src: t[2] || '', ref: t[3] || '', active: !sug, suggested: sug })) };
    }) };
  });
  return { version: D.version, sections: [...mk(D.base, false), ...mk(D.suggested, true)] };
}
function flatTasks(activeOnly = true) {
  const out = [];
  for (const sec of S.template.sections) for (const item of sec.items) for (const task of item.tasks)
    if (!activeOnly || task.active) out.push({ sec, item, task });
  return out;
}
function findTask(id) { return flatTasks(false).find(x => x.task.id === id); }
const bName = id => (S.buildings.find(b => b.id === id) || { name: '(école supprimée)' }).name;
const activeBuildings = () => S.buildings.filter(b => !b.archived);
const openRoundFor = bid => [...S.rounds.values()].find(r => r.buildingId === bid && !r.endedAt);

// ---------- Persistance ----------
const saveSettings = () => DB.put('kv', S.settings, 'settings');
const saveTemplate = () => DB.put('kv', S.template, 'template');
const saveBuildings = () => DB.put('kv', S.buildings, 'buildings');
function saveRound(r) { r.rev = (r.rev || 0) + 1; r.dirty = 1; r.updatedAt = nowISO(); S.rounds.set(r.id, r); scheduleSync(); return DB.put('rounds', r); }
function saveIssue(i) { i.rev = (i.rev || 0) + 1; i.dirty = 1; i.updatedAt = nowISO(); S.issues.set(i.id, i); scheduleSync(); return DB.put('issues', i); }
function addLog(type, msg, ctx = {}) {
  const e = { id: uid(), ts: nowISO(), type, msg, buildingId: ctx.buildingId || '', roundId: ctx.roundId || '', taskId: ctx.taskId || '', issueId: ctx.issueId || '', synced: 0 };
  S.log.push(e);
  DB.put('log', e);
  scheduleSync();
  return e;
}

// ---------- Calculs ----------
function lastDoneMap(bid, excludeRoundId = "") {
  const m = {};
  for (const r of S.rounds.values()) {
    if (r.buildingId !== bid || r.id === excludeRoundId) continue;
    for (const [tid, res] of Object.entries(r.results)) {
      if (!res.status) continue;
      if (!m[tid] || res.at > m[tid].at) m[tid] = { at: res.at, status: res.status };
    }
  }
  return m;
}
function isDue(task, last) { return task.freq > 0 && (!last || daysSince(last.at) >= task.freq); }
function roundCounts(r) {
  const c = { ok: 0, fixed: 0, todo: 0, na: 0, done: 0 };
  for (const res of Object.values(r.results)) if (res.status) { c[res.status]++; c.done++; }
  return c;
}

// ---------- UI de base ----------
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function openSheet(html) { $('#sheetBody').innerHTML = '<div class="grab"></div>' + html; const d = $('#sheet'); if (!d.open) d.showModal(); fillPhotos($('#sheetBody')); }
function closeSheet() { const d = $('#sheet'); if (d.open) d.close(); }
function syncPill() {
  const pending = pendingCount();
  if (!S.settings.syncUrl) return navigator.onLine ? '<span class="pill">En ligne</span>' : '<span class="pill off">Hors-ligne</span>';
  if (syncing) return '<span class="pill">Synchro…</span>';
  if (pending) return `<span class="pill todo">${navigator.onLine ? '' : 'Hors-ligne · '}${pending} à envoyer</span>`;
  return '<span class="pill ok">Synchronisé</span>';
}
function pendingCount() {
  let n = S.log.filter(l => !l.synced).length;
  for (const r of S.rounds.values()) if (r.dirty) n++;
  for (const i of S.issues.values()) if (i.dirty) n++;
  return n;
}
function topBar(title, { back = '', sub = '', right = '' } = {}) {
  return `<header class="top"><div class="row">
    ${back ? `<button class="back" data-act="go" data-to="${esc(back)}" aria-label="Retour">‹</button>` : ''}
    <div class="grow"><h1>${esc(title)}</h1>${sub ? `<small>${sub}</small>` : ''}</div>${right}</div></header>`;
}

// ---------- Routeur ----------
function render() {
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
  const [p0, p1] = parts;
  const v = $('#view');
  let html, tab = p0 || 'home';
  switch (p0) {
    case 'tournee': html = viewRound(p1); tab = 'home'; break;
    case 'suivi': html = viewIssues(); break;
    case 'historique': html = viewHistory(); break;
    case 'rapport': html = viewReport(p1); tab = 'historique'; break;
    case 'matrice': html = viewMatrix(); tab = 'historique'; break;
    case 'journal': html = viewLog(); break;
    case 'reglages': html = viewSettings(); break;
    case 'modele': html = viewTemplate(); tab = 'reglages'; break;
    default: html = viewHome(); tab = 'home';
  }
  v.innerHTML = html;
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fillPhotos(v);
}
function refreshPill() { const p = $('#syncpill'); if (p) p.innerHTML = syncPill(); }

// ---------- Vue : Accueil ----------
function viewHome() {
  const today = new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let h = topBar('Entretien préventif', { sub: `${esc(today)}${S.settings.worker ? ' · ' + esc(S.settings.worker) : ''}`, right: `<span id="syncpill">${syncPill()}</span>` });
  if (deferredInstall) h += `<div class="card"><b>Installer l'app sur ce téléphone</b><p class="muted">Elle s'ouvrira comme une vraie app et marchera sans internet.</p><button class="btn primary" data-act="install">Installer</button></div>`;
  if (!S.settings.worker) h += `<div class="card"><label class="field"><span>Ton nom (apparaît dans les rapports et le journal)</span><input type="text" id="workerName" placeholder="Prénom Nom"></label><button class="btn primary" data-act="saveWorker">Enregistrer</button></div>`;
  const blds = activeBuildings();
  if (!blds.length) {
    h += `<div class="card"><h3>Ajoute tes écoles</h3><p class="muted">Une tournée est toujours liée à un bâtiment.</p>
      <label class="field"><span>Nom de l'école / du bâtiment</span><input type="text" id="newBld" placeholder="ex. École Saint-Jean"></label>
      <button class="btn primary" data-act="addBuilding">Ajouter</button>
      <p class="muted" style="margin-top:12px">Ou récupère tes écoles depuis ta feuille Google (après avoir configuré la synchro) :</p>
      <button class="btn" data-act="importBlds">Importer mes écoles</button></div>`;
    return h;
  }
  const tasks = flatTasks();
  for (const b of blds) {
    const last = lastDoneMap(b.id);
    const due = tasks.filter(x => isDue(x.task, last[x.task.id])).length;
    const open = [...S.issues.values()].filter(i => i.buildingId === b.id && i.status === 'open').length;
    const rounds = [...S.rounds.values()].filter(r => r.buildingId === b.id).sort((a, z) => z.startedAt.localeCompare(a.startedAt));
    const cur = rounds.find(r => !r.endedAt);
    const lastR = rounds.find(r => r.endedAt);
    h += `<div class="card"><div class="head"><div><h3>${esc(b.name)}</h3>
      ${b.address ? `<small>${esc(b.address)}</small><br>` : ''}<small>${lastR ? 'Dernière tournée : ' + fmtShort(lastR.startedAt) : 'Aucune tournée encore'}</small></div></div>
      <div class="stats">${due ? `<span class="pill due">${due} tâche${due > 1 ? 's' : ''} due${due > 1 ? 's' : ''}</span>` : '<span class="pill ok">Rien de dû</span>'}
      ${open ? `<a class="pill todo" href="#/suivi">${open} suivi${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}</a>` : ''}</div>
      <div class="actions">${cur
        ? `<button class="btn primary" data-act="go" data-to="#/tournee/${cur.id}">Continuer la tournée (${roundCounts(cur).done}/${tasks.length})</button>`
        : `<button class="btn primary" data-act="startRound" data-bld="${b.id}">Nouvelle tournée</button>`}
      <button class="btn" data-act="newIssue" data-bld="${b.id}">+ Suivi</button></div></div>`;
  }
  h += `<div class="actions noprint" style="margin-top:8px"><button class="btn" data-act="go" data-to="#/matrice">Tableau par école</button></div>`;
  return h;
}

// ---------- Vue : Tournée ----------
function viewRound(id) {
  const r = S.rounds.get(id);
  if (!r) return topBar('Tournée introuvable', { back: '#/' }) + '<p class="empty">Cette tournée n\'existe pas.</p>';
  const tasks = flatTasks();
  const last = lastDoneMap(r.buildingId, r.id);
  const c = roundCounts(r);
  const doneActive = tasks.filter(x => r.results[x.task.id]?.status).length;
  const pct = tasks.length ? Math.round(100 * doneActive / tasks.length) : 0;
  const f = S.ui.filter;
  let h = `<header class="top"><div class="row"><button class="back" data-act="go" data-to="#/" aria-label="Retour">‹</button>
    <div class="grow"><h1>${esc(bName(r.buildingId))}</h1><small>Début ${fmtHuman(r.startedAt)}${r.endedAt ? ' · Terminée ' + fmtT(r.endedAt) : ''}</small></div>
    <b id="rprog">${doneActive}/${tasks.length}</b></div>
    <div class="progress"><i id="rbar" style="width:${pct}%"></i></div>
    <div class="chips">${[['all', 'Tout'], ['left', 'À faire'], ['due', 'Dues'], ['todo', 'À suivre']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('')}</div></header>`;
  if (r.endedAt) h += `<div class="card"><b>Tournée terminée.</b> <span class="muted">Les modifications restent possibles et sont journalisées.</span><div class="actions" style="margin-top:8px"><button class="btn" data-act="go" data-to="#/rapport/${r.id}">Voir le rapport</button><button class="btn" data-act="reopenRound" data-round="${r.id}">Rouvrir</button></div></div>`;
  let shown = 0;
  for (const sec of S.template.sections) {
    let body = '';
    for (const item of sec.items) {
      const rows = item.tasks.filter(t => t.active && passFilter(f, r.results[t.id], t, last[t.id]));
      if (!rows.length) continue;
      body += `<div class="itemhead">${esc(item.name)}</div>` + rows.map(t => taskRow(r, { sec, item, task: t }, last[t.id])).join('');
      shown += rows.length;
    }
    if (body) {
      const open = !S.ui.collapsed[sec.id];
      h += `<details class="section" data-sec="${sec.id}" ${open ? 'open' : ''}><summary>${esc(sec.name)}<span class="muted">›</span></summary>${body}</details>`;
    }
  }
  if (!shown) h += `<p class="empty">${f === 'all' ? 'Aucune tâche active. Va dans Réglages › Liste de tâches.' : 'Rien dans ce filtre.'}</p>`;
  h += `<div class="card"><label class="field"><span>Notes générales de la tournée</span><textarea data-change="roundNote" data-round="${r.id}">${esc(r.notes || '')}</textarea></label>
    <div class="stats"><span class="pill ok">${c.ok} fait</span><span class="pill">${c.fixed} corrigé</span><span class="pill todo">${c.todo} à suivre</span><span class="pill off">${c.na} N/A</span></div>
    ${r.endedAt ? '' : `<button class="btn primary block" data-act="endRound" data-round="${r.id}">Terminer la tournée</button>`}
    <div class="actions" style="margin-top:8px"><button class="btn danger small" data-act="deleteRound" data-round="${r.id}">Supprimer la tournée</button></div></div>`;
  return h;
}
function passFilter(f, res, task, last) {
  if (f === 'left') return !res?.status;
  if (f === 'due') return !res?.status && isDue(task, last);
  if (f === 'todo') return res?.status === 'todo';
  return true;
}
function taskRow(r, { item, task }, last) {
  const res = r.results[task.id];
  const st = res?.status;
  const due = !st && isDue(task, last);
  const meta = [
    task.freq ? `<span class="pill">${esc(freqLabel(task.freq))}</span>` : '',
    last ? `<span class="pill">Dernier : ${fmtShort(last.at)}</span>` : '<span class="pill">Jamais fait</span>',
    due ? '<span class="pill due">DÛ</span>' : '',
    st ? `<span class="stamp ${st}">${STATUS[st].s} ${STATUS[st].label} · ${fmtT(res.at)}</span>` : '',
    res?.photos?.length ? `<span class="pill">📷 ${res.photos.length}</span>` : ''
  ].join('');
  return `<div class="task" id="t-${cssId(task.id)}">
    <button class="tname" data-act="taskSheet" data-round="${r.id}" data-task="${task.id}"><b>${esc(task.name)}</b><div class="meta">${meta}</div>
    ${res?.note ? `<div class="notepreview">${esc(res.note)}</div>` : ''}</button>
    <div class="seg">${Object.entries(STATUS).map(([k, s]) => `<button class="${k} ${st === k ? 'on' : ''}" data-act="setStatus" data-round="${r.id}" data-task="${task.id}" data-st="${k}"><span class="s">${s.s}</span>${s.label}</button>`).join('')}</div></div>`;
}
const cssId = id => id.replace(/[^a-zA-Z0-9_-]/g, '_');
function refreshTaskRow(r, taskId) {
  const ft = findTask(taskId); if (!ft) return;
  const el = document.getElementById('t-' + cssId(taskId));
  if (el) el.outerHTML = taskRow(r, ft, lastDoneMap(r.buildingId, r.id)[taskId]);
  const tasks = flatTasks();
  const done = tasks.filter(x => r.results[x.task.id]?.status).length;
  const p = $('#rprog'); if (p) p.textContent = `${done}/${tasks.length}`;
  const b = $('#rbar'); if (b) b.style.width = (tasks.length ? Math.round(100 * done / tasks.length) : 0) + '%';
}
async function startRound(bid) {
  const ex = openRoundFor(bid);
  if (ex) { location.hash = '#/tournee/' + ex.id; return; }
  const r = { id: uid(), buildingId: bid, worker: S.settings.worker || '', startedAt: nowISO(), endedAt: null, results: {}, notes: '' };
  await saveRound(r);
  addLog('tournee.debut', `Début de tournée — ${bName(bid)}`, { buildingId: bid, roundId: r.id });
  S.ui.filter = 'all';
  location.hash = '#/tournee/' + r.id;
  requestPersist();
}
async function setStatus(rid, tid, st) {
  const r = S.rounds.get(rid); const ft = findTask(tid); if (!r || !ft) return;
  const label = `${ft.item.name} › ${ft.task.name}`;
  const cur = r.results[tid];
  const ctx = { buildingId: r.buildingId, roundId: r.id, taskId: tid };
  if (cur && cur.status === st) {
    cur.status = null; cur.at = nowISO();
    addLog('tache.annulee', `${label} : statut retiré`, ctx);
    await dropAutoIssue(cur, ctx, label);
  } else {
    const res = Object.assign(cur || {}, { status: st, at: nowISO(), section: ft.sec.name, item: ft.item.name, task: ft.task.name });
    r.results[tid] = res;
    addLog('tache.statut', `${label} : ${STATUS[st].label}`, ctx);
    if (st === 'todo' && !res.issueId) {
      const i = { id: uid(), buildingId: r.buildingId, roundId: r.id, taskId: tid, label, createdAt: res.at, note: res.note || '', status: 'open', closedAt: null, closeNote: '', photos: [] };
      res.issueId = i.id;
      await saveIssue(i);
      addLog('suivi.ouvert', `Suivi ouvert : ${label}`, { ...ctx, issueId: i.id });
    } else if (st !== 'todo') {
      await dropAutoIssue(res, ctx, label);
    }
  }
  await saveRound(r);
  refreshTaskRow(r, tid);
  if (st === 'todo' && r.results[tid].status === 'todo') openTaskSheet(rid, tid, 'Décris ce qui est à faire (et ajoute une photo au besoin).');
  if (navigator.vibrate) navigator.vibrate(15);
}
async function dropAutoIssue(res, ctx, label) {
  if (!res.issueId) return;
  const i = S.issues.get(res.issueId);
  if (i && i.status === 'open') {
    i.status = 'cancelled'; i.closedAt = nowISO(); i.closeNote = 'Annulé (statut de la tâche changé)';
    await saveIssue(i);
    addLog('suivi.annule', `Suivi annulé : ${label}`, { ...ctx, issueId: i.id });
  }
  res.issueId = null;
}
function openTaskSheet(rid, tid, hint = '') {
  const r = S.rounds.get(rid); const ft = findTask(tid); if (!r || !ft) return;
  const res = r.results[tid] || {};
  const src = window.EP_DATA.sources[ft.task.src];
  const hist = [...S.rounds.values()].filter(o => o.buildingId === r.buildingId && o.id !== r.id && o.results[tid]?.status)
    .map(o => o.results[tid]).sort((a, z) => z.at.localeCompare(a.at)).slice(0, 5);
  openSheet(`<h3>${esc(ft.item.name)} › ${esc(ft.task.name)}</h3>
    <p class="muted" style="margin:4px 0 10px">${esc(ft.sec.name)} · ${esc(freqLabel(ft.task.freq))}${res.status ? ` · <span class="stamp ${res.status}">${STATUS[res.status].label} à ${fmtDT(res.at)}</span>` : ''}</p>
    ${hint ? `<p class="pill todo" style="white-space:normal">${esc(hint)}</p>` : ''}
    <div class="seg" style="margin:10px 0">${Object.entries(STATUS).map(([k, s]) => `<button class="${k} ${res.status === k ? 'on' : ''}" data-act="setStatusSheet" data-round="${rid}" data-task="${tid}" data-st="${k}"><span class="s">${s.s}</span>${s.label}</button>`).join('')}</div>
    <label class="field"><span>Note (horodatée au journal)</span><textarea id="taskNote" data-change="taskNote" data-round="${rid}" data-task="${tid}" placeholder="Ce qui a été fait, matériel utilisé, observation…">${esc(res.note || '')}</textarea></label>
    <div class="thumbs">${(res.photos || []).map(p => `<img data-photo="${p}" alt="Photo" data-act="viewPhoto" data-id="${p}">`).join('')}</div>
    <div class="actions"><button class="btn" data-act="addPhoto" data-round="${rid}" data-task="${tid}">📷 Ajouter une photo</button><button class="btn primary" data-act="closeSheet">Fermer</button></div>
    ${ft.task.ref || src ? `<h2>Référence</h2><p>${esc(ft.task.ref)}</p>${src ? `<p class="muted">Source : ${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src.name)}</p>` : ''}` : ''}
    ${hist.length ? `<h2>Historique (cette école)</h2><ul class="list">${hist.map(x => `<li><span class="stamp ${x.status}">${STATUS[x.status].label}</span> <span class="log-ts">${fmtDT(x.at)}</span>${x.note ? `<div class="notepreview">${esc(x.note)}</div>` : ''}</li>`).join('')}</ul>` : ''}`);
}
async function saveTaskNote(rid, tid, val) {
  const r = S.rounds.get(rid); const ft = findTask(tid); if (!r || !ft) return;
  const res = r.results[tid] || (r.results[tid] = { status: null, at: nowISO(), section: ft.sec.name, item: ft.item.name, task: ft.task.name });
  if ((res.note || '') === val) return;
  res.note = val; res.noteAt = nowISO();
  addLog('tache.note', `${ft.item.name} › ${ft.task.name} : note « ${val.slice(0, 80)}${val.length > 80 ? '…' : ''} »`, { buildingId: r.buildingId, roundId: rid, taskId: tid });
  if (res.issueId) { const i = S.issues.get(res.issueId); if (i && i.status === 'open') { i.note = val; await saveIssue(i); } }
  await saveRound(r);
  refreshTaskRow(r, tid);
}

// ---------- Photos ----------
let photoCtx = null;
function compressImage(file) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
    img.src = url;
  });
}
async function onPhotoPicked(file) {
  if (!file || !photoCtx) return;
  try {
    const data = await compressImage(file);
    const p = { id: uid(), at: nowISO(), data, ref: photoCtx, uploaded: 0, url: '' };
    await DB.put('photos', p);
    if (photoCtx.type === 'round') {
      const r = S.rounds.get(photoCtx.id); const ft = findTask(photoCtx.taskId);
      const res = r.results[photoCtx.taskId] || (r.results[photoCtx.taskId] = { status: null, at: nowISO(), section: ft.sec.name, item: ft.item.name, task: ft.task.name });
      (res.photos ||= []).push(p.id);
      addLog('photo', `Photo ajoutée : ${ft.item.name} › ${ft.task.name}`, { buildingId: r.buildingId, roundId: r.id, taskId: photoCtx.taskId });
      if (res.issueId) { const i = S.issues.get(res.issueId); if (i) { (i.photos ||= []).push(p.id); await saveIssue(i); } }
      await saveRound(r);
      refreshTaskRow(r, photoCtx.taskId);
      openTaskSheet(r.id, photoCtx.taskId);
    } else if (photoCtx.type === 'issue') {
      const i = S.issues.get(photoCtx.id);
      (i.photos ||= []).push(p.id);
      await saveIssue(i);
      addLog('photo', `Photo ajoutée au suivi : ${i.label}`, { buildingId: i.buildingId, issueId: i.id });
      openIssueSheet(i.id);
      if (location.hash.startsWith('#/suivi')) render();
    }
    toast('Photo enregistrée');
  } catch (e) { toast('Erreur photo : ' + e.message); }
}
async function fillPhotos(root) {
  for (const img of $$('img[data-photo]', root)) {
    if (img.src) continue;
    const p = await DB.get('photos', img.dataset.photo);
    if (p) img.src = p.data; else img.alt = 'Photo absente';
  }
}

// ---------- Vue : Suivis ----------
function viewIssues() {
  const tab = S.ui.issueTab, fb = S.ui.issueBld;
  let list = [...S.issues.values()].filter(i => (tab === 'open' ? i.status === 'open' : i.status !== 'open') && (!fb || i.buildingId === fb));
  list.sort((a, z) => (tab === 'open' ? a.createdAt.localeCompare(z.createdAt) : (z.closedAt || '').localeCompare(a.closedAt || '')));
  let h = topBar('Suivis', { sub: 'Travaux à faire trouvés en tournée' });
  h += `<div class="chips"><button class="chip ${tab === 'open' ? 'on' : ''}" data-act="issueTab" data-t="open">Ouverts</button><button class="chip ${tab !== 'open' ? 'on' : ''}" data-act="issueTab" data-t="closed">Réglés / annulés</button></div>`;
  h += bldSelect('issueBld', fb);
  if (!list.length) h += `<p class="empty">${tab === 'open' ? 'Aucun suivi ouvert. 👍' : 'Rien ici pour l\'instant.'}</p>`;
  for (const i of list) {
    const age = daysSince(i.createdAt);
    h += `<div class="card" data-act="issueSheet" data-id="${i.id}" style="cursor:pointer"><div class="head"><div><b>${esc(i.label)}</b><br><small>${esc(bName(i.buildingId))} · ouvert ${fmtShort(i.createdAt)}${i.status === 'open' ? ` (${age} j)` : ''}</small></div>
      <span class="pill ${i.status === 'open' ? 'todo' : i.status === 'closed' ? 'ok' : 'off'}">${i.status === 'open' ? 'Ouvert' : i.status === 'closed' ? 'Réglé' : 'Annulé'}</span></div>
      ${i.note ? `<div class="notepreview">${esc(i.note)}</div>` : ''}${i.closeNote ? `<div class="notepreview">→ ${esc(i.closeNote)}${i.closedAt ? ' (' + fmtShort(i.closedAt) + ')' : ''}</div>` : ''}
      ${i.photos?.length ? `<div class="thumbs">${i.photos.slice(0, 4).map(p => `<img data-photo="${p}" alt="Photo">`).join('')}</div>` : ''}</div>`;
  }
  h += `<div class="actions"><button class="btn" data-act="newIssue" data-bld="${fb}">+ Nouveau suivi</button><button class="btn" data-act="exportIssues">Exporter (CSV)</button></div>`;
  return h;
}
function bldSelect(key, val) {
  return `<label class="field"><span>École</span><select data-change="uiSel" data-key="${key}"><option value="">Toutes</option>${S.buildings.map(b => `<option value="${b.id}" ${b.id === val ? 'selected' : ''}>${esc(b.name)}${b.archived ? ' (archivée)' : ''}</option>`).join('')}</select></label>`;
}
function openIssueSheet(id) {
  const i = S.issues.get(id); if (!i) return;
  openSheet(`<h3>${esc(i.label)}</h3><p class="muted">${esc(bName(i.buildingId))} · ouvert le ${fmtDT(i.createdAt)}${i.closedAt ? ' · fermé le ' + fmtDT(i.closedAt) : ''}</p>
    <label class="field"><span>Description</span><textarea data-change="issueNote" data-id="${i.id}">${esc(i.note || '')}</textarea></label>
    <div class="thumbs">${(i.photos || []).map(p => `<img data-photo="${p}" alt="Photo" data-act="viewPhoto" data-id="${p}">`).join('')}</div>
    ${i.status === 'open'
      ? `<label class="field"><span>Ce qui a été fait (pour fermer)</span><textarea id="closeNote" placeholder="ex. Pièce remplacée, bon de travail #1234…"></textarea></label>
         <div class="actions"><button class="btn primary" data-act="closeIssue" data-id="${i.id}">✓ Marquer réglé</button><button class="btn" data-act="addIssuePhoto" data-id="${i.id}">📷 Photo</button><button class="btn" data-act="closeSheet">Fermer</button></div>`
      : `<p>${esc(i.closeNote || '')}</p><div class="actions"><button class="btn" data-act="reopenIssue" data-id="${i.id}">Rouvrir</button><button class="btn" data-act="closeSheet">Fermer</button></div>`}`);
}
function newIssueSheet(bid) {
  const blds = activeBuildings();
  if (!blds.length) { toast('Ajoute d\'abord une école.'); return; }
  openSheet(`<h3>Nouveau suivi</h3>
    <label class="field"><span>École</span><select id="niBld">${blds.map(b => `<option value="${b.id}" ${b.id === bid ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Endroit / élément</span><input type="text" id="niLabel" placeholder="ex. Local 204 — porte"></label>
    <label class="field"><span>Description</span><textarea id="niNote"></textarea></label>
    <div class="actions"><button class="btn primary" data-act="createIssue">Créer</button><button class="btn" data-act="closeSheet">Annuler</button></div>`);
}

// ---------- Vue : Historique / Rapport / Matrice ----------
function viewHistory() {
  const fb = S.ui.histBld;
  const list = [...S.rounds.values()].filter(r => !fb || r.buildingId === fb).sort((a, z) => z.startedAt.localeCompare(a.startedAt));
  let h = topBar('Historique', { sub: `${list.length} tournée${list.length > 1 ? 's' : ''}` });
  h += `<div class="actions" style="margin-top:12px"><button class="btn" data-act="go" data-to="#/matrice">Tableau par école</button><button class="btn" data-act="exportResults">Exporter résultats (CSV)</button></div>`;
  h += bldSelect('histBld', fb);
  if (!list.length) h += '<p class="empty">Aucune tournée.</p>';
  for (const r of list) {
    const c = roundCounts(r);
    h += `<div class="card" data-act="go" data-to="#/rapport/${r.id}" style="cursor:pointer"><div class="head"><div><b>${esc(bName(r.buildingId))}</b><br><small>${fmtHuman(r.startedAt)}${r.endedAt ? ' · ' + fmtDur(minutesBetween(r.startedAt, r.endedAt)) : ''}</small></div>
      ${r.endedAt ? '<span class="pill ok">Terminée</span>' : '<span class="pill todo">En cours</span>'}</div>
      <div class="stats"><span class="pill">${c.done} tâches</span>${c.fixed ? `<span class="pill">${c.fixed} corrigé</span>` : ''}${c.todo ? `<span class="pill todo">${c.todo} à suivre</span>` : ''}</div></div>`;
  }
  return h;
}
function viewReport(id) {
  const r = S.rounds.get(id);
  if (!r) return topBar('Rapport', { back: '#/historique' }) + '<p class="empty">Introuvable.</p>';
  const c = roundCounts(r);
  let h = topBar('Rapport de tournée', { back: '#/historique', sub: esc(bName(r.buildingId)) });
  h += `<div class="card"><p class="print-only"><b>Entretien préventif — rapport de tournée</b></p>
    <b>${esc(bName(r.buildingId))}</b><br>
    Employé : ${esc(r.worker || '—')}<br>Début : ${fmtDT(r.startedAt)}<br>Fin : ${r.endedAt ? fmtDT(r.endedAt) + ' (' + fmtDur(minutesBetween(r.startedAt, r.endedAt)) + ')' : 'en cours'}<br>
    <div class="stats"><span class="pill ok">${c.ok} fait</span><span class="pill">${c.fixed} corrigé</span><span class="pill todo">${c.todo} à suivre</span><span class="pill off">${c.na} N/A</span></div>
    ${r.notes ? `<p><b>Notes :</b> ${esc(r.notes)}</p>` : ''}
    <div class="actions noprint"><button class="btn" data-act="print">Imprimer / PDF</button><button class="btn" data-act="exportRound" data-round="${r.id}">CSV</button>${r.endedAt ? '' : `<button class="btn primary" data-act="go" data-to="#/tournee/${r.id}">Continuer</button>`}<button class="btn" data-act="go" data-to="#/tournee/${r.id}">Modifier</button></div></div>`;
  h += '<div class="tablewrap"><table><thead><tr><th>Élément › tâche</th><th>Statut</th><th>Heure</th><th>Note</th></tr></thead><tbody>';
  const entries = Object.entries(r.results).filter(([, x]) => x.status);
  const bySec = {};
  for (const [tid, x] of entries) (bySec[x.section] ||= []).push([tid, x]);
  for (const [sec, rows] of Object.entries(bySec)) {
    h += `<tr class="grp"><td colspan="4">${esc(sec)}</td></tr>`;
    rows.sort((a, z) => a[1].at.localeCompare(z[1].at));
    for (const [, x] of rows) h += `<tr><td>${esc(x.item)} › ${esc(x.task)}</td><td class="c"><span class="stamp ${x.status}">${STATUS[x.status].s} ${STATUS[x.status].label}</span></td><td class="c">${fmtT(x.at)}</td><td>${esc(x.note || '')}${x.photos?.length ? ` 📷${x.photos.length}` : ''}</td></tr>`;
  }
  if (!entries.length) h += '<tr><td colspan="4" class="muted">Aucune tâche cochée.</td></tr>';
  h += '</tbody></table></div>';
  const skipped = flatTasks().filter(x => !r.results[x.task.id]?.status);
  if (skipped.length && r.endedAt) h += `<h2>Non faites (${skipped.length})</h2><p class="muted">${skipped.map(x => esc(x.item.name + ' › ' + x.task.name)).join(' · ')}</p>`;
  h += `<p class="muted print-only">Signature : ______________________ &nbsp; Date : ____________</p>`;
  return h;
}
function viewMatrix() {
  const blds = activeBuildings();
  let h = topBar('Tableau par école', { back: '#/historique', sub: 'Dernière date faite · rouge = dû' });
  if (!blds.length) return h + '<p class="empty">Aucune école.</p>';
  const maps = blds.map(b => lastDoneMap(b.id));
  h += `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Tâche</th><th>Fréq.</th>${blds.map(b => `<th>${esc(b.name)}</th>`).join('')}</tr></thead><tbody>`;
  for (const sec of S.template.sections) {
    const items = sec.items.filter(it => it.tasks.some(t => t.active));
    if (!items.length) continue;
    h += `<tr class="grp"><td colspan="${2 + blds.length}">${esc(sec.name)}</td></tr>`;
    for (const it of items) for (const t of it.tasks.filter(t => t.active)) {
      h += `<tr><td>${esc(it.name)} › ${esc(t.name)}</td><td class="c">${esc(freqLabel(t.freq))}</td>${maps.map(m => {
        const l = m[t.id]; const due = isDue(t, l);
        return `<td class="c ${due ? 'due' : l ? 'okc' : ''}">${l ? fmtShort(l.at) : '—'}</td>`;
      }).join('')}</tr>`;
    }
  }
  h += '</tbody></table></div><div class="actions noprint" style="margin-top:12px"><button class="btn" data-act="print">Imprimer / PDF</button></div>';
  return h;
}

// ---------- Vue : Journal ----------
function viewLog() {
  const fb = S.ui.logBld, q = S.ui.logQ.toLowerCase();
  const list = S.log.filter(l => (!fb || l.buildingId === fb) && (!q || l.msg.toLowerCase().includes(q))).sort((a, z) => z.ts.localeCompare(a.ts));
  let h = topBar('Journal', { sub: `${S.log.length} entrées horodatées` });
  h += bldSelect('logBld', fb);
  h += `<label class="field"><span>Rechercher</span><input type="search" data-input="logQ" value="${esc(S.ui.logQ)}" placeholder="ex. extincteur"></label>`;
  h += `<div class="card"><ul class="list">${list.slice(0, S.ui.logLimit).map(l => `<li><div class="log-ts">${fmtDT(l.ts)}${l.buildingId ? ' · ' + esc(bName(l.buildingId)) : ''}${l.synced ? '' : ' · <b>non envoyé</b>'}</div>${esc(l.msg)}</li>`).join('') || '<li class="muted">Vide.</li>'}</ul>
    ${list.length > S.ui.logLimit ? '<button class="linkbtn" data-act="logMore">Afficher plus</button>' : ''}</div>`;
  h += `<div class="actions"><button class="btn" data-act="exportLog">Exporter le journal (CSV)</button></div>`;
  return h;
}

// ---------- Vue : Réglages ----------
function viewSettings() {
  const st = S.settings;
  let h = topBar('Réglages', { sub: `Version ${APP_VERSION}` });
  h += `<div class="card"><h3>Employé</h3><label class="field"><span>Nom</span><input type="text" data-change="setting" data-key="worker" value="${esc(st.worker)}"></label>
    <label class="field"><span>Nom de cet appareil (optionnel)</span><input type="text" data-change="setting" data-key="device" value="${esc(st.device)}" placeholder="ex. Cell de Guillaume"></label></div>`;
  h += `<div class="card"><h3>Écoles / bâtiments</h3><ul class="list">${S.buildings.map(b => `<li class="switch"><span>${esc(b.name)}${b.archived ? ' <span class="pill off">archivée</span>' : ''}</span>
      <span class="actions"><button class="btn small" data-act="renameBld" data-id="${b.id}">Renommer</button><button class="btn small" data-act="archiveBld" data-id="${b.id}">${b.archived ? 'Réactiver' : 'Archiver'}</button></span></li>`).join('') || '<li class="muted">Aucune.</li>'}</ul>
    <label class="field"><span>Ajouter</span><input type="text" id="newBld" placeholder="Nom de l'école"></label><span class="actions"><button class="btn" data-act="addBuilding">Ajouter</button><button class="btn" data-act="importBlds">Importer de la feuille Google</button></span>
    ${S.settings.lastBuildingsImport ? `<p class="muted">Dernier import : ${fmtDT(S.settings.lastBuildingsImport)}${S.settings.subsector ? ' · ' + esc(S.settings.subsector) : ''}</p>` : ''}</div>`;
  const active = flatTasks().length, sug = flatTasks(false).filter(x => x.task.suggested && !x.task.active).length;
  h += `<div class="card"><h3>Liste de tâches</h3><p class="muted">${active} tâches actives · ${sug} suggestions désactivées (sources : RBQ, MEQ, SHQ, INSPQ…)</p><button class="btn" data-act="go" data-to="#/modele">Modifier la liste et les fréquences</button></div>`;
  h += `<div class="card"><h3>Google Sheets (synchronisation)</h3>
    <p class="muted">Quand il y a internet, l'app envoie tournées, résultats, suivis, journal et photos vers ta feuille Google via ton Apps Script. Sans internet, tout attend dans le téléphone.</p>
    <label class="field"><span>Adresse du script (se termine par /exec)</span><input type="url" data-change="setting" data-key="syncUrl" value="${esc(st.syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="field"><span>Jeton secret (le même que dans le script)</span><input type="password" data-change="setting" data-key="syncToken" value="${esc(st.syncToken)}"></label>
    <label class="switch"><span>Synchroniser automatiquement</span><input type="checkbox" data-change="settingBool" data-key="autoSync" ${st.autoSync ? 'checked' : ''}></label>
    <p class="muted">${st.lastSync ? 'Dernière synchro : ' + fmtDT(st.lastSync) : 'Jamais synchronisé'} · <span id="syncpill">${syncPill()}</span></p>
    <div class="actions"><button class="btn" data-act="testSync">Tester</button><button class="btn primary" data-act="syncNow">Synchroniser maintenant</button></div></div>`;
  h += `<div class="card"><h3>Sauvegarde</h3><p class="muted">${st.lastBackup ? 'Dernière sauvegarde : ' + fmtDT(st.lastBackup) : 'Aucune sauvegarde faite.'} Le fichier contient tout (photos incluses). Garde-le sur Drive ou ton ordi.</p>
    <div class="actions"><button class="btn primary" data-act="backup">Sauvegarder (fichier)</button><button class="btn" data-act="restore">Restaurer…</button></div>
    <p class="muted" id="persistInfo"></p></div>`;
  h += `<div class="card"><h3>À propos</h3><p class="muted">Données conservées dans ce téléphone (IndexedDB). Désinstaller l'app ou effacer les données du navigateur les supprime : fais des sauvegardes ou active la synchro Google.</p>
    <button class="btn small" data-act="checkUpdate">Chercher une mise à jour</button></div>`;
  setTimeout(showPersistInfo, 0);
  return h;
}
async function showPersistInfo() {
  const el = $('#persistInfo'); if (!el || !navigator.storage) return;
  const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
  el.textContent = `Stockage protégé : ${p ? 'oui' : 'non (le navigateur pourrait le vider si l\'espace manque)'}${est ? ` · utilisé : ${(est.usage / 1048576).toFixed(1)} Mo` : ''}`;
}
async function requestPersist() { try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (e) { /* ignoré */ } }

// ---------- Vue : Modèle ----------
function viewTemplate() {
  let h = topBar('Liste de tâches', { back: '#/reglages', sub: 'Les suggestions sont grises : coche pour les activer' });
  h += `<p class="muted">Changer la liste n'efface pas l'historique (chaque résultat garde le nom de la tâche au moment où il a été fait).</p>`;
  for (const sec of S.template.sections) {
    h += `<details class="section" ${sec.suggested ? '' : 'open'}><summary>${esc(sec.name)}${sec.suggested ? ' <span class="pill">suggestions</span>' : ''}<span class="muted">›</span></summary><div style="padding:0 14px 12px">`;
    for (const it of sec.items) {
      h += `<div class="itemhead" style="padding-left:0;display:flex;justify-content:space-between;align-items:center">${esc(it.name)}<span><button class="iconbtn" data-act="tplRenameItem" data-sec="${sec.id}" data-item="${it.id}" title="Renommer">✎</button> <button class="iconbtn" data-act="tplAddTask" data-sec="${sec.id}" data-item="${it.id}" title="Ajouter une tâche">＋</button></span></div>`;
      for (const t of it.tasks) {
        const src = window.EP_DATA.sources[t.src];
        h += `<div class="edit-task ${t.active ? '' : 'inactive'}"><div class="nm"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-change="tplActive" data-task="${t.id}" ${t.active ? 'checked' : ''}> <span>${esc(t.name)}</span></label>
          ${src && t.src !== 'SUG' ? `<small>${esc(src.name.split(' – ')[0])}</small>` : ''}</div>
          <div class="ctl"><select data-change="tplFreq" data-task="${t.id}">${FREQS.map(([d, l]) => `<option value="${d}" ${d === t.freq ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="iconbtn" data-act="tplRenameTask" data-task="${t.id}" title="Renommer">✎</button><button class="iconbtn" data-act="tplDelTask" data-task="${t.id}" title="Supprimer">🗑</button></div></div>`;
      }
    }
    h += `<div class="actions" style="margin-top:8px"><button class="btn small" data-act="tplAddItem" data-sec="${sec.id}">+ Élément</button></div></div></details>`;
  }
  h += `<div class="actions"><button class="btn" data-act="tplAddSection">+ Section</button><button class="btn danger" data-act="tplReset">Remettre la liste d'origine</button></div>`;
  return h;
}
function tplFind(tid) { for (const sec of S.template.sections) for (const it of sec.items) { const i = it.tasks.findIndex(t => t.id === tid); if (i >= 0) return { sec, it, i, t: it.tasks[i] }; } return null; }

// ---------- Exports ----------
function csv(rows) {
  const q = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n');
}
async function download(name, content, type) {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}
const stamp = () => fmtD(nowISO()).replace(/-/g, '') + '-' + fmtT(nowISO()).replace(':', '');
const H_RESULTS = ['ID', 'ID tournée', 'École', 'Date', 'Heure', 'Section', 'Élément', 'Tâche', 'Statut', 'Note', 'Photos', 'Employé', 'Modifié le', 'BâtimentID'];
const H_ROUNDS = ['ID', 'École', 'Employé', 'Début', 'Fin', 'Durée (min)', 'Tâches cochées', 'Fait', 'Corrigé', 'À suivre', 'N/A', 'Notes', 'Modifié le', 'BâtimentID'];
const H_ISSUES = ['ID', 'École', 'Élément / tâche', 'Ouvert le', 'Statut', 'Description', 'Fermé le', 'Note de fermeture', 'ID tournée', 'Photos', 'Modifié le', 'BâtimentID'];
const H_LOG = ['ID', 'Horodatage', 'Type', 'École', 'Détail', 'Appareil', 'ID tournée'];
const ISSUE_ST = { open: 'Ouvert', closed: 'Réglé', cancelled: 'Annulé' };
function resultRows(r) {
  return Object.entries(r.results).map(([tid, x]) => [r.id + '|' + tid, r.id, bName(r.buildingId), fmtD(x.at), fmtT(x.at), x.section, x.item, x.task,
    x.status ? STATUS[x.status].label : '(retiré)', x.note || '', (x.photos || []).map(p => (x.photoUrls || {})[p] || '(photo locale)').join(' '), r.worker || '', fmtDT(r.updatedAt || nowISO()), (S.buildings.find(b => b.id === r.buildingId) || {}).extId || '']);
}
function roundRow(r) {
  const c = roundCounts(r);
  return [r.id, bName(r.buildingId), r.worker || '', fmtDT(r.startedAt), r.endedAt ? fmtDT(r.endedAt) : '', r.endedAt ? minutesBetween(r.startedAt, r.endedAt) : '', c.done, c.ok, c.fixed, c.todo, c.na, r.notes || '', fmtDT(r.updatedAt || nowISO()), (S.buildings.find(b => b.id === r.buildingId) || {}).extId || ''];
}
function issueRow(i) {
  return [i.id, bName(i.buildingId), i.label, fmtDT(i.createdAt), ISSUE_ST[i.status] || i.status, i.note || '', i.closedAt ? fmtDT(i.closedAt) : '', i.closeNote || '', i.roundId || '', (i.photos || []).map(p => (i.photoUrls || {})[p] || '(photo locale)').join(' '), fmtDT(i.updatedAt || nowISO()), (S.buildings.find(b => b.id === i.buildingId) || {}).extId || ''];
}
const logRow = l => [l.id, fmtDT(l.ts), l.type, l.buildingId ? bName(l.buildingId) : '', l.msg, S.settings.device || '', l.roundId || ''];

async function backup() {
  const photos = await DB.all('photos');
  const data = { app: 'entretien-preventif', version: APP_VERSION, exportedAt: nowISO(), settings: { ...S.settings, syncToken: '' }, template: S.template, buildings: S.buildings,
    rounds: [...S.rounds.values()], issues: [...S.issues.values()], log: S.log, photos };
  const ok = await download(`entretien-preventif-sauvegarde-${stamp()}.json`, JSON.stringify(data), 'application/json');
  if (ok) { S.settings.lastBackup = nowISO(); await saveSettings(); addLog('sauvegarde', 'Sauvegarde exportée'); render(); }
}
async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast('Fichier illisible.'); return; }
  if (data.app !== 'entretien-preventif') { toast('Ce n\'est pas une sauvegarde de cette app.'); return; }
  if (!confirm(`Remplacer TOUTES les données de ce téléphone par la sauvegarde du ${fmtDT(data.exportedAt)} ?`)) return;
  for (const s of ['rounds', 'issues', 'log', 'photos']) await DB.clear(s);
  const tok = S.settings.syncToken;
  S.settings = { ...S.settings, ...data.settings, syncToken: tok };
  S.template = data.template; S.buildings = data.buildings || [];
  await saveSettings(); await saveTemplate(); await saveBuildings();
  S.rounds = new Map(); S.issues = new Map(); S.log = [];
  for (const r of data.rounds || []) { S.rounds.set(r.id, r); await DB.put('rounds', r); }
  for (const i of data.issues || []) { S.issues.set(i.id, i); await DB.put('issues', i); }
  for (const l of data.log || []) { S.log.push(l); await DB.put('log', l); }
  for (const p of data.photos || []) await DB.put('photos', p);
  addLog('restauration', `Données restaurées depuis la sauvegarde du ${fmtDT(data.exportedAt)}`);
  toast('Restauration terminée.'); location.hash = '#/'; render();
}

// ---------- Synchronisation Google Apps Script ----------
async function post(payload) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 90000);
  try {
    const res = await fetch(S.settings.syncUrl.trim(), { method: 'POST', body: JSON.stringify({ ...payload, token: S.settings.syncToken }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch (e) {
      throw new Error(/accounts\.google|ServiceLogin|signin/i.test(txt + res.url) ? 'Le script demande une connexion Google : redéploie-le avec l\'accès « Tout le monde ».' : 'Réponse inattendue du script (vérifie l\'adresse /exec).');
    }
    if (!j.ok) throw new Error(j.error || 'Erreur du script');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Délai dépassé');
    if (e instanceof TypeError) throw new Error('Impossible de joindre le script (réseau ou accès « Tout le monde » manquant).');
    throw e;
  } finally { clearTimeout(t); }
}
async function importBuildings() {
  const j = await post({ action: 'buildings' });
  let added = 0, renamed = 0;
  for (const rb of j.buildings || []) {
    const key = rb.name.trim().toLowerCase();
    let b = S.buildings.find(x => x.extId === rb.id) || S.buildings.find(x => !x.extId && x.name.trim().toLowerCase() === key);
    if (!b) {
      b = { id: uid(), name: rb.name, address: rb.address || '', extId: rb.id, archived: false, createdAt: nowISO() };
      S.buildings.push(b); added++;
      addLog('ecole.ajout', `École importée de la feuille : ${rb.name}`, { buildingId: b.id });
    } else {
      b.extId = rb.id; b.address = rb.address || b.address || '';
      if (b.name !== rb.name) { addLog('ecole.renommee', `École renommée (feuille) : ${b.name} → ${rb.name}`, { buildingId: b.id }); b.name = rb.name; renamed++; }
    }
  }
  await saveBuildings();
  S.settings.subsector = j.subsector || ''; S.settings.lastBuildingsImport = nowISO(); await saveSettings();
  return { added, renamed, total: (j.buildings || []).length, subsector: j.subsector || '' };
}
let syncTimer = null;
function scheduleSync() {
  refreshPill();
  if (!S.settings.autoSync || !S.settings.syncUrl) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 20000);
}
async function syncNow(manual) {
  if (!S.settings.syncUrl || !S.settings.syncToken) { if (manual) toast('Entre l\'adresse du script et le jeton dans Réglages.'); return; }
  if (!navigator.onLine) { if (manual) toast('Pas d\'internet : les données attendent dans le téléphone.'); return; }
  if (syncing) return;
  syncing = true; refreshPill();
  try {
    // 1) Photos non envoyées
    const photos = (await DB.all('photos')).filter(p => !p.uploaded);
    for (const p of photos) {
      const ref = p.ref || {};
      const owner = ref.type === 'round' ? S.rounds.get(ref.id) : S.issues.get(ref.id);
      const bid = owner ? owner.buildingId : '';
      const j = await post({ action: 'photo', id: p.id, folder: bName(bid), filename: `${fmtD(p.at)}_${fmtT(p.at).replace(':', 'h')}_${p.id}.jpg`, data: p.data.split(',')[1] });
      p.uploaded = 1; p.url = j.url; await DB.put('photos', p);
      if (owner && ref.type === 'round') { const res = owner.results[ref.taskId]; if (res) { (res.photoUrls ||= {})[p.id] = j.url; await saveRound(owner); } }
      for (const i of S.issues.values()) if (i.photos?.includes(p.id)) { (i.photoUrls ||= {})[p.id] = j.url; await saveIssue(i); }
    }
    // 2) Données
    const rounds = [...S.rounds.values()].filter(r => r.dirty), issues = [...S.issues.values()].filter(i => i.dirty), logs = S.log.filter(l => !l.synced);
    if (rounds.length || issues.length || logs.length) {
      const snap = { r: rounds.map(r => [r, r.rev]), i: issues.map(i => [i, i.rev]) };
      await post({ action: 'sync', device: S.settings.device || '', tables: [
        { name: 'Tournées', headers: H_ROUNDS, rows: rounds.map(roundRow) },
        { name: 'Résultats', headers: H_RESULTS, rows: rounds.flatMap(resultRows) },
        { name: 'Suivis', headers: H_ISSUES, rows: issues.map(issueRow) },
        { name: 'Journal', headers: H_LOG, rows: logs.map(logRow) }] });
      for (const [r, rev] of snap.r) if (r.rev === rev) { r.dirty = 0; await DB.put('rounds', r); }
      for (const [i, rev] of snap.i) if (i.rev === rev) { i.dirty = 0; await DB.put('issues', i); }
      for (const l of logs) { l.synced = 1; await DB.put('log', l); }
    }
    let imp = null;
    try { imp = await importBuildings(); } catch (e) { console.warn('écoles', e); }
    S.settings.lastSync = nowISO(); await saveSettings();
    if (manual) toast('Synchronisation réussie ✓' + (imp && imp.added ? ` — ${imp.added} école(s) ajoutée(s)` : ''));
  } catch (e) {
    if (manual) toast('Synchro : ' + e.message, 5000);
    console.warn('sync', e);
  } finally {
    syncing = false; refreshPill();
    if (location.hash.startsWith('#/reglages') || location.hash.startsWith('#/journal')) render();
  }
}

// ---------- Actions (délégation) ----------
const ACT = {
  go: b => { location.hash = b.dataset.to; },
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); },
  saveWorker: async () => { const v = $('#workerName').value.trim(); if (!v) return; S.settings.worker = v; await saveSettings(); addLog('reglage', `Employé : ${v}`); render(); },
  addBuilding: async () => {
    const v = $('#newBld').value.trim(); if (!v) { toast('Entre un nom.'); return; }
    const b = { id: uid(), name: v, archived: false, createdAt: nowISO() };
    S.buildings.push(b); await saveBuildings(); addLog('ecole.ajout', `École ajoutée : ${v}`, { buildingId: b.id }); render(); toast('École ajoutée');
  },
  renameBld: async b => {
    const x = S.buildings.find(y => y.id === b.dataset.id); const v = prompt('Nouveau nom', x.name); if (!v || v.trim() === x.name) return;
    addLog('ecole.renommee', `École renommée : ${x.name} → ${v.trim()}`, { buildingId: x.id }); x.name = v.trim(); await saveBuildings(); render();
  },
  archiveBld: async b => {
    const x = S.buildings.find(y => y.id === b.dataset.id); x.archived = !x.archived; await saveBuildings();
    addLog('ecole.archive', `École ${x.archived ? 'archivée' : 'réactivée'} : ${x.name}`, { buildingId: x.id }); render();
  },
  startRound: b => startRound(b.dataset.bld),
  filter: b => { S.ui.filter = b.dataset.f; render(); },
  setStatus: b => setStatus(b.dataset.round, b.dataset.task, b.dataset.st),
  setStatusSheet: async b => { await setStatus(b.dataset.round, b.dataset.task, b.dataset.st); if (b.dataset.st !== 'todo' || !S.rounds.get(b.dataset.round).results[b.dataset.task].status) openTaskSheet(b.dataset.round, b.dataset.task); },
  taskSheet: b => openTaskSheet(b.dataset.round, b.dataset.task),
  closeSheet: () => closeSheet(),
  addPhoto: b => { photoCtx = { type: 'round', id: b.dataset.round, taskId: b.dataset.task }; flushSheetNotes(); $('#photoInput').click(); },
  addIssuePhoto: b => { photoCtx = { type: 'issue', id: b.dataset.id }; flushSheetNotes(); $('#photoInput').click(); },
  viewPhoto: async b => { const p = await DB.get('photos', b.dataset.id); if (p) { const w = window.open(); if (w) w.document.write(`<title>Photo</title><img src="${p.data}" style="max-width:100%">`); } },
  endRound: async b => {
    const r = S.rounds.get(b.dataset.round); const total = flatTasks().length, done = flatTasks().filter(x => r.results[x.task.id]?.status).length;
    if (done < total && !confirm(`${total - done} tâche(s) non cochée(s). Terminer quand même ?`)) return;
    r.endedAt = nowISO(); await saveRound(r);
    addLog('tournee.fin', `Fin de tournée — ${bName(r.buildingId)} (${done}/${total} tâches, ${fmtDur(minutesBetween(r.startedAt, r.endedAt))})`, { buildingId: r.buildingId, roundId: r.id });
    if (S.settings.autoSync) syncNow(false);
    location.hash = '#/rapport/' + r.id;
  },
  reopenRound: async b => { const r = S.rounds.get(b.dataset.round); r.endedAt = null; await saveRound(r); addLog('tournee.rouverte', `Tournée rouverte — ${bName(r.buildingId)}`, { buildingId: r.buildingId, roundId: r.id }); render(); },
  deleteRound: async b => {
    const r = S.rounds.get(b.dataset.round);
    if (!confirm('Supprimer cette tournée ? (Le journal garde la trace de la suppression.)')) return;
    for (const res of Object.values(r.results)) if (res.issueId) { const i = S.issues.get(res.issueId); if (i && i.status === 'open') { i.status = 'cancelled'; i.closedAt = nowISO(); i.closeNote = 'Tournée supprimée'; await saveIssue(i); } }
    S.rounds.delete(r.id); await DB.del('rounds', r.id);
    addLog('tournee.supprimee', `Tournée supprimée — ${bName(r.buildingId)} du ${fmtDT(r.startedAt)}`, { buildingId: r.buildingId, roundId: r.id });
    location.hash = '#/';
  },
  issueTab: b => { S.ui.issueTab = b.dataset.t; render(); },
  issueSheet: b => openIssueSheet(b.dataset.id),
  newIssue: b => newIssueSheet(b.dataset.bld),
  createIssue: async () => {
    const bid = $('#niBld').value, label = $('#niLabel').value.trim(), note = $('#niNote').value.trim();
    if (!label) { toast('Indique l\'endroit / élément.'); return; }
    const i = { id: uid(), buildingId: bid, roundId: '', taskId: '', label, createdAt: nowISO(), note, status: 'open', closedAt: null, closeNote: '', photos: [] };
    await saveIssue(i); addLog('suivi.ouvert', `Suivi ouvert : ${label}`, { buildingId: bid, issueId: i.id });
    closeSheet(); toast('Suivi créé'); render();
  },
  closeIssue: async b => {
    const i = S.issues.get(b.dataset.id); flushSheetNotes();
    i.status = 'closed'; i.closedAt = nowISO(); i.closeNote = ($('#closeNote')?.value || '').trim();
    await saveIssue(i); addLog('suivi.ferme', `Suivi réglé : ${i.label}${i.closeNote ? ' — ' + i.closeNote : ''}`, { buildingId: i.buildingId, issueId: i.id });
    closeSheet(); toast('Suivi réglé ✓'); render();
  },
  reopenIssue: async b => {
    const i = S.issues.get(b.dataset.id); i.status = 'open'; i.closedAt = null;
    await saveIssue(i); addLog('suivi.rouvert', `Suivi rouvert : ${i.label}`, { buildingId: i.buildingId, issueId: i.id }); closeSheet(); render();
  },
  logMore: () => { S.ui.logLimit += 300; render(); },
  print: () => window.print(),
  exportRound: b => { const r = S.rounds.get(b.dataset.round); download(`tournee-${slug(bName(r.buildingId))}-${fmtD(r.startedAt)}.csv`, csv([H_RESULTS, ...resultRows(r).filter(x => x[8] !== '(retiré)')]), 'text/csv'); },
  exportResults: () => download(`resultats-${stamp()}.csv`, csv([H_RESULTS, ...[...S.rounds.values()].sort((a, z) => a.startedAt.localeCompare(z.startedAt)).flatMap(resultRows).filter(x => x[8] !== '(retiré)')]), 'text/csv'),
  exportIssues: () => download(`suivis-${stamp()}.csv`, csv([H_ISSUES, ...[...S.issues.values()].map(issueRow)]), 'text/csv'),
  exportLog: () => download(`journal-${stamp()}.csv`, csv([H_LOG, ...[...S.log].sort((a, z) => a.ts.localeCompare(z.ts)).map(logRow)]), 'text/csv'),
  backup: () => backup(),
  restore: () => $('#importInput').click(),
  testSync: async () => {
    if (!S.settings.syncUrl) { toast('Entre l\'adresse du script.'); return; }
    try {
      const j = await post({ action: 'ping' });
      const imp = await importBuildings();
      toast(`Connexion OK ✓ — ${j.sheet || 'feuille'} · ${imp.total} école(s) ${imp.subsector}${imp.added ? `, ${imp.added} ajoutée(s)` : ''}`, 5000);
      render();
    } catch (e) { toast('Échec : ' + e.message, 6000); }
  },
  syncNow: () => syncNow(true),
  importBlds: async () => {
    if (!S.settings.syncUrl || !S.settings.syncToken) { toast('Configure d\'abord la synchro Google (Réglages).'); location.hash = '#/reglages'; return; }
    try { const imp = await importBuildings(); toast(`${imp.total} école(s) ${imp.subsector} · ${imp.added} ajoutée(s)`, 4000); render(); } catch (e) { toast('Échec : ' + e.message, 6000); }
  },
  checkUpdate: async () => { if (swReg) { await swReg.update(); toast(swReg.waiting ? 'Mise à jour prête.' : 'Tu as la dernière version.'); showUpdateBanner(); } else toast('Hors-ligne ou service non disponible.'); },
  // Modèle
  tplRenameTask: async b => { const f = tplFind(b.dataset.task); const v = prompt('Nom de la tâche', f.t.name); if (!v?.trim()) return; addLog('modele', `Tâche renommée : ${f.t.name} → ${v.trim()}`); f.t.name = v.trim(); await saveTemplate(); render(); },
  tplDelTask: async b => { const f = tplFind(b.dataset.task); if (!confirm(`Supprimer « ${f.it.name} › ${f.t.name} » ? (Conseil : décocher suffit pour la masquer.)`)) return; f.it.tasks.splice(f.i, 1); addLog('modele', `Tâche supprimée : ${f.it.name} › ${f.t.name}`); await saveTemplate(); render(); },
  tplAddTask: async b => {
    const sec = S.template.sections.find(s => s.id === b.dataset.sec); const it = sec.items.find(i => i.id === b.dataset.item);
    const v = prompt(`Nouvelle tâche dans « ${it.name} »`); if (!v?.trim()) return;
    it.tasks.push({ id: it.id + '.' + slug(v) + '-' + uid().slice(-4), name: v.trim(), freq: 0, src: '', ref: '', active: true, suggested: false });
    addLog('modele', `Tâche ajoutée : ${it.name} › ${v.trim()}`); await saveTemplate(); render();
  },
  tplRenameItem: async b => { const sec = S.template.sections.find(s => s.id === b.dataset.sec); const it = sec.items.find(i => i.id === b.dataset.item); const v = prompt('Nom de l\'élément', it.name); if (!v?.trim()) return; addLog('modele', `Élément renommé : ${it.name} → ${v.trim()}`); it.name = v.trim(); await saveTemplate(); render(); },
  tplAddItem: async b => {
    const sec = S.template.sections.find(s => s.id === b.dataset.sec); const v = prompt(`Nouvel élément dans « ${sec.name} » (ex. Escaliers)`); if (!v?.trim()) return;
    sec.items.push({ id: sec.id + '.' + slug(v) + '-' + uid().slice(-4), name: v.trim(), tasks: [] }); addLog('modele', `Élément ajouté : ${sec.name} › ${v.trim()}`); await saveTemplate(); render();
  },
  tplAddSection: async () => { const v = prompt('Nom de la section (ex. Cour arrière)'); if (!v?.trim()) return; S.template.sections.push({ id: 'u-' + slug(v) + '-' + uid().slice(-4), name: v.trim(), suggested: false, items: [] }); addLog('modele', `Section ajoutée : ${v.trim()}`); await saveTemplate(); render(); },
  tplReset: async () => { if (!confirm('Remettre la liste d\'origine ? Tes modifications de liste seront perdues (l\'historique reste).')) return; S.template = buildTemplate(); await saveTemplate(); addLog('modele', 'Liste de tâches remise à l\'origine'); render(); }
};
const CHG = {
  roundNote: async el => { const r = S.rounds.get(el.dataset.round); if ((r.notes || '') === el.value) return; r.notes = el.value; await saveRound(r); addLog('tournee.note', `Note de tournée : « ${el.value.slice(0, 80)} »`, { buildingId: r.buildingId, roundId: r.id }); },
  taskNote: el => saveTaskNote(el.dataset.round, el.dataset.task, el.value.trim()),
  issueNote: async el => { const i = S.issues.get(el.dataset.id); if ((i.note || '') === el.value.trim()) return; i.note = el.value.trim(); await saveIssue(i); addLog('suivi.note', `Suivi « ${i.label} » : note modifiée`, { buildingId: i.buildingId, issueId: i.id }); },
  uiSel: el => { S.ui[el.dataset.key] = el.value; render(); },
  setting: async el => {
    const k = el.dataset.key, v = el.value.trim(); if (S.settings[k] === v) return;
    S.settings[k] = v; await saveSettings();
    if (k !== 'syncToken') addLog('reglage', `Réglage « ${k} » modifié`);
    if (k === 'syncUrl' || k === 'syncToken') scheduleSync();
  },
  settingBool: async el => { S.settings[el.dataset.key] = el.checked; await saveSettings(); },
  tplActive: async el => { const f = tplFind(el.dataset.task); f.t.active = el.checked; addLog('modele', `Tâche ${el.checked ? 'activée' : 'désactivée'} : ${f.it.name} › ${f.t.name}`); await saveTemplate(); el.closest('.edit-task').classList.toggle('inactive', !el.checked); },
  tplFreq: async el => { const f = tplFind(el.dataset.task); f.t.freq = +el.value; addLog('modele', `Fréquence : ${f.it.name} › ${f.t.name} = ${freqLabel(f.t.freq)}`); await saveTemplate(); }
};
function flushSheetNotes() { for (const el of $$('#sheetBody [data-change]')) if (el.tagName === 'TEXTAREA') CHG[el.dataset.change]?.(el); }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(b, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && CHG[el.dataset.change]) CHG[el.dataset.change](el); });
document.addEventListener('input', e => {
  const el = e.target.closest('[data-input]'); if (!el) return;
  if (el.dataset.input === 'logQ') { S.ui.logQ = el.value; clearTimeout(ACT._q); ACT._q = setTimeout(() => { render(); const i = $('[data-input="logQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }
});
document.addEventListener('toggle', e => { const d = e.target; if (d.matches?.('details.section[data-sec]')) S.ui.collapsed[d.dataset.sec] = !d.open; }, true);
$('#sheet').addEventListener('close', flushSheetNotes);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
$('#photoInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; onPhotoPicked(f); });
$('#importInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); });
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('online', () => { refreshPill(); if (S.settings.autoSync) syncNow(false); });
window.addEventListener('offline', refreshPill);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (!location.hash || location.hash === '#/') render(); });

// ---------- Service worker (hors-ligne) ----------
function showUpdateBanner() {
  if (!swReg?.waiting) return;
  const b = $('#banner'); b.hidden = false;
  b.innerHTML = 'Nouvelle version disponible <button class="btn small" id="doUpdate">Mettre à jour</button>';
  $('#doUpdate').onclick = () => swReg.waiting.postMessage('skipWaiting');
}
async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    showUpdateBanner();
    swReg.addEventListener('updatefound', () => { const w = swReg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(); }); });
    // Recharger seulement lors d'une mise à jour (pas à la toute première installation).
    let reloaded = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  } catch (e) { console.warn('SW', e); }
}

// ---------- Démarrage ----------
(async function init() {
  try {
    await DB.open();
    const [settings, template, buildings, rounds, issues, log] = await Promise.all([DB.get('kv', 'settings'), DB.get('kv', 'template'), DB.get('kv', 'buildings'), DB.all('rounds'), DB.all('issues'), DB.all('log')]);
    if (settings) S.settings = { ...S.settings, ...settings };
    if ((S.settings.syncUrl || '').includes(RETIRED_SYNC_URL_PART)) { S.settings.syncUrl = ''; await saveSettings(); }
    S.template = template || buildTemplate();
    if (!template) { await saveTemplate(); }
    S.buildings = buildings || [];
    for (const r of rounds) S.rounds.set(r.id, r);
    for (const i of issues) S.issues.set(i.id, i);
    S.log = log;
    if (!log.length) addLog('app', `Première ouverture de l'app (v${APP_VERSION})`);
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><b>Impossible d'ouvrir le stockage local.</b><p class="muted">${esc(e.message)}</p><p class="muted">Navigation privée ? Ouvre l'app dans un onglet normal.</p></div>`;
    return;
  }
  render();
  registerSW();
  if (S.settings.autoSync && pendingCount()) setTimeout(() => syncNow(false), 3000);
  setInterval(() => { if (S.settings.autoSync && navigator.onLine && pendingCount()) syncNow(false); }, 5 * 60000);
})();
