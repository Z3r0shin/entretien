'use strict';
/* Bon « Demande de suivi » (PDF format lettre), envoi, et scanner de code-barres.
   Utilise les fonctions de app.js (S, DB, post, bName, findBld, issueNo…). */

// Moustache en filigrane. Gabarit : « Flat hairy moustache icon » de Vexels (vexels.com).
const MOUSTACHE_PATH = 'M1016.54,612.736c56.693,2.207,94.802-9.964,118.482-33.729c20.404-36.67,20.079-95.025-1.695-126.131c-35.297-50.425-83.201-37.819-83.201-37.819c39.079,11.345,49.165,39.079,45.382,66.813c-3.991,29.271-33.93,57.76-88.243,66.812c-105.891,17.648-157.577-74.376-244.559-100.849C701.206,429.116,634.079,460.198,600,500.949c-34.079-40.752-101.206-71.834-162.707-53.116c-86.982,26.472-138.667,118.497-244.559,100.849c-54.313-9.052-84.251-37.541-88.243-66.812c-3.782-27.734,6.303-55.468,45.382-66.813c0,0-47.903-12.606-83.2,37.819c-21.639,30.914-22.094,88.741-2.071,125.449c25.024,25.315,64.726,36.48,118.858,34.411c-58.548,12.824-101.952,0.276-128.355-27.426c-0.448,15.956,2.818,77.916,77.12,109.603c0,0,32.958,60.78,91.924,75.246c12.512,1.794,25.272,2.508,37.806,2.301c1.711-0.197,3.414-0.368,5.155-0.649c0,0-0.086,0.198-0.235,0.518c29.8-1.069,57.891-7.296,77.506-16.719c-21.704,17.115-51.159,26.119-81.356,27.834c22.639,1.204,121.244,4.495,176.789-25.5c0,0,132.364-6.513,160.185-75.729c21.343,69.216,160.185,75.729,160.185,75.729c85.788,39.952,174.175,26.427,181.049,25.292c-33.813-1.161-66.102-10.726-85.616-27.626c22.618,10.596,49.95,16.113,77.588,16.894c-0.202-0.428-0.317-0.693-0.317-0.693c2.135,0.345,4.23,0.578,6.32,0.796c13.215,0.044,26.415-0.996,39.145-3.09c57.395-15.539,89.421-74.604,89.421-74.604c74.668-31.844,77.599-94.275,77.115-109.851C1116.896,613.958,1071.336,625.409,1016.54,612.736z M307.492,696.205c32.571-9.059,65.397-19.345,99.26-31.583C382.976,689.765,343.771,703.269,307.492,696.205z M352.61,599.2c58.735-19.542,110.269-94.138,173.705-58.654C460.038,522.224,417.245,596.331,352.61,599.2z M866.956,632.287c41.789,29.323,93.967,49.361,147.386,37.599C966.608,690.905,897.083,681.814,866.956,632.287z';
const MOUSTACHE_BOX = { x: 30, y: 410, w: 1140, h: 380 };   // partie utile du dessin (sur 1200 × 1200)

function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/jspdf.umd.min.js';
    s.onload = () => (window.jspdf ? res(window.jspdf.jsPDF) : rej(new Error('Module PDF illisible')));
    s.onerror = () => rej(new Error('Module PDF introuvable (ouvre l\'app une fois avec internet)'));
    document.head.appendChild(s);
  });
}
// Polices standard du PDF : seulement l'alphabet latin de base (les accents français passent).
const pdfText = s => String(s ?? '').replace(/[—–]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
  .replace(/[ -​ ]/g, ' ').replace(/[^\n\x20-\x7E\xA0-\xFF]/g, '');

function moustachePng() {
  if (moustachePng.url) return moustachePng.url;
  const k = 2, B = MOUSTACHE_BOX, c = document.createElement('canvas');
  c.width = B.w * k; c.height = B.h * k;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(k, 0, 0, k, -B.x * k, -B.y * k);
  g.fillStyle = '#ececec';   // noir à environ 7 % sur fond blanc
  g.fill(new Path2D(MOUSTACHE_PATH));
  return (moustachePng.url = c.toDataURL('image/jpeg', 0.92));
}
function imgSize(dataUrl) {
  return new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = dataUrl; });
}
// Photo de cet appareil, ou récupérée depuis Drive par le script (puis gardée ici pour la prochaine fois).
async function photoForPdf(id) {
  const p = await DB.get('photos', id);
  if (p && p.data) return p.data;
  if (!p || !p.fileId || !navigator.onLine || !S.settings.syncToken) return null;
  try {
    const j = await post({ action: 'photoData', fileId: p.fileId });
    if (!j.data) return null;
    p.data = 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data;
    await DB.put('photos', p);
    return p.data;
  } catch (e) { console.warn('photo Drive', e); return null; }
}

const ISSUE_STATE = i => i.status === 'closed' ? `Réglé le ${fmtD(i.closedAt)}${i.closeNote ? ' - ' + i.closeNote : ''}` : i.status === 'cancelled' ? `Annulé${i.closeNote ? ' - ' + i.closeNote : ''}` : 'Ouvert';
const fmtFr = iso => { const d = new Date(iso); return `${fmtD(iso)} à ${pad(d.getHours())} h ${pad(d.getMinutes())}`; };
const bonFileName = i => `${issueNo(i)} - ${i.label}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) + '.pdf';

async function buildBonPdf(i) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const PW = 612, PH = 792, M = 36, W = PW - 2 * M, FOOT = PH - 26;
  const no = issueNo(i), b = findBld(i.buildingId) || {};
  const gray = () => doc.setTextColor(110), ink = () => doc.setTextColor(26);
  const T = (s, x, y, o) => doc.text(pdfText(s), x, y, o);

  // Photos (dans l'ordre), avec leurs dimensions
  const photos = [];
  for (const id of i.photos || []) { const data = await photoForPdf(id); photos.push({ data, size: data ? await imgSize(data) : null }); }

  // Moustache : centrée dans la moitié haute de la page
  const mw = 470, mh = mw * MOUSTACHE_BOX.h / MOUSTACHE_BOX.w;
  doc.addImage(moustachePng(), 'JPEG', (PW - mw) / 2, PH / 4 - mh / 2, mw, mh);

  // En-tête
  let y = M;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); gray();
  T(`Entretien préventif - ${S.settings.subsector || 'Pointe-aux-Trembles'}`, M, y + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); ink();
  T('Demande de suivi', M, y + 27);
  doc.setFont('courier', 'bold'); doc.setFontSize(17);
  T(no, PW - M, y + 27, { align: 'right' });
  y += 34; doc.setDrawColor(26); doc.setLineWidth(1.2); doc.line(M, y, PW - M, y);

  // Infos sur 2 colonnes
  const colW = [W * 0.58 - 6, W * 0.42 - 6], colX = [M, M + W * 0.58 + 6];
  const cells = [
    ['École', [b.name || bName(i.buildingId)], b.address ? [b.address] : []],
    ['Endroit / élément', [i.label]],
    ['Ouvert le', [fmtFr(i.createdAt)]],
    ['Signalé par', [i.by || S.settings.worker || '-']],
    ['No requête CSSPI', [i.csspi || '-']],
    ['Statut', [ISSUE_STATE(i)]]
  ];
  y += 4;
  for (let r = 0; r < cells.length; r += 2) {
    let rowH = 0;
    const draw = [cells[r], cells[r + 1]].map((c, k) => {
      doc.setFont('helvetica', k === 0 && r === 0 ? 'bold' : 'normal'); doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(pdfText(c[1].join(' ')), colW[k]).slice(0, 2);
      doc.setFontSize(8.5);
      const sub = c[2] ? doc.splitTextToSize(pdfText(c[2].join(' ')), colW[k]).slice(0, 1) : [];
      const h = 13 + lines.length * 12.5 + sub.length * 10.5 + 4;
      rowH = Math.max(rowH, h);
      return { c, k, lines, sub };
    });
    for (const { c, k, lines, sub } of draw) {
      const x = colX[k];
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gray(); T(c[0], x, y + 10);
      doc.setFont('helvetica', k === 0 && r === 0 ? 'bold' : 'normal'); doc.setFontSize(10.5); ink();
      lines.forEach((l, n) => doc.text(l, x, y + 23 + n * 12.5));
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); gray();
      sub.forEach((l, n) => doc.text(l, x, y + 23 + lines.length * 12.5 + n * 10.5 - 2));
      doc.setDrawColor(225); doc.setLineWidth(0.6); doc.line(x, y + rowH, x + colW[k], y + rowH);
    }
    y += rowH;
  }

  // Description
  y += 10;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gray(); T('Description', M, y);
  doc.setFontSize(10.5); ink();
  let dl = doc.splitTextToSize(pdfText(i.note || '-'), W - 14);
  const maxLines = Math.max(3, Math.floor((PH - 300 - y) / 13));   // garder de la place pour la photo
  if (dl.length > maxLines) { dl = dl.slice(0, maxLines); dl[maxLines - 1] += ' (...)'; }
  const dh = dl.length * 13 + 10;
  doc.setDrawColor(210); doc.setLineWidth(0.6); doc.rect(M, y + 4, W, dh);
  dl.forEach((l, n) => doc.text(l, M + 7, y + 17 + n * 13));
  y += 4 + dh;

  // Photo en 4:3 (contenue, jamais coupée)
  const box = (p, idx, x, top, bw, bh) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gray();
    T(`Photo ${idx} de ${photos.length}`, x, top - 4);
    doc.setDrawColor(215); doc.setLineWidth(0.6); doc.rect(x, top, bw, bh);
    if (!p.data || !p.size) { doc.setFontSize(9); T('Photo non disponible sur cet appareil', x + bw / 2, top + bh / 2, { align: 'center' }); return; }
    const k = Math.min(bw / p.size.w, bh / p.size.h), w = p.size.w * k, h = p.size.h * k;
    doc.addImage(p.data, 'JPEG', x + (bw - w) / 2, top + (bh - h) / 2, w, h);
  };
  let rest = photos.slice();
  if (rest.length) {
    const top = y + 18, avail = FOOT - 10 - top;
    let bh = Math.min(W * 3 / 4, avail), bw = bh * 4 / 3;
    if (bh >= 200) { box(rest.shift(), 1, M + (W - bw) / 2, top, bw, bh); }
  }
  // Pages suivantes : 2 photos par page
  const first = photos.length - rest.length;
  for (let n = 0; n < rest.length; n += 2) {
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink(); T('Demande de suivi - photos (suite)', M, M + 10);
    doc.setFont('courier', 'bold'); T(no, PW - M, M + 10, { align: 'right' });
    doc.setDrawColor(26); doc.setLineWidth(0.8); doc.line(M, M + 16, PW - M, M + 16);
    const top0 = M + 34, gap = 22, bh = (FOOT - 10 - top0 - gap) / 2, bw = Math.min(W, bh * 4 / 3);
    box(rest[n], first + n + 1, M + (W - bw) / 2, top0, bw, bh);
    if (rest[n + 1]) box(rest[n + 1], first + n + 2, M + (W - bw) / 2, top0 + bh + gap, bw, bh);
  }
  // Pieds de page
  const pages = doc.getNumberOfPages(), made = nowISO();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(215); doc.setLineWidth(0.5); doc.line(M, FOOT - 9, PW - M, FOOT - 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); gray();
    T(p === 1 ? `Généré le ${fmtFr(made)}` : `${b.name || bName(i.buildingId)} - ${i.label}`, M, FOOT);
    T(`${no} - page ${p} / ${pages}`, PW - M, FOOT, { align: 'right' });
  }
  doc.setProperties({ title: `Demande de suivi ${no}`, subject: pdfText(i.label), author: pdfText(i.by || S.settings.worker || ''), creator: 'Entretien préventif' });
  return doc.output('blob');
}

const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

// Envoyer le bon : menu Partager (cell) ou téléchargement (PC). Une copie part ensuite dans Drive.
let readyBon = null, bonBusy = false;
const mobileShare = file => /Android|iPhone|iPad/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] });
async function sendBon(id) {
  const i = S.issues.get(id); if (!i || bonBusy) return;
  flushSheetNotes();
  const t0 = Date.now();
  toast('Préparation du PDF…', 8000);
  let blob;
  bonBusy = true;
  try { blob = await buildBonPdf(i); } catch (e) { toast('PDF impossible : ' + e.message, 6000); return; } finally { bonBusy = false; }
  const no = issueNo(i), school = bName(i.buildingId);
  readyBon = {
    id, blob, name: bonFileName(i), file: new File([blob], bonFileName(i), { type: 'application/pdf' }),
    subject: `Suivi ${no} - ${school} - ${i.label}`,
    body: `Bonjour,\n\nVoici la demande de suivi ${no} : ${i.label} (${school}).${i.csspi ? `\nRequête CSSPI : ${i.csspi}` : ''}\n\n${i.note || ''}\n\n${S.settings.worker || ''}`.trim()
  };
  // Android n'accepte le menu Partager que quelques secondes après le toucher :
  // si le PDF a pris plus de temps (photos venues de Drive), on demande un 2e toucher.
  if (mobileShare(readyBon.file) && Date.now() - t0 > 3500) return askShareBon();
  await deliverBon(false);
}
function askShareBon() {
  toast('PDF prêt', 1500);
  openSheet(`<h3>PDF prêt</h3><p class="muted">${esc(readyBon.name)}</p>
    <div class="actions"><button class="btn primary" data-act="shareBon">📤 Envoyer</button><button class="btn" data-act="closeSheet">Annuler</button></div>`);
}
async function deliverBon(fromPrompt = false) {
  const x = readyBon; if (!x) return;
  const i = S.issues.get(x.id); if (!i) return;
  let how = 'téléchargé';
  if (mobileShare(x.file)) {
    try { await navigator.share({ files: [x.file], title: x.subject, text: x.body }); how = 'partagé'; }
    catch (e) {
      if (e.name === 'AbortError') { toast('Envoi annulé'); return; }
      if (e.name === 'NotAllowedError' && !fromPrompt) return askShareBon();   // délai du toucher dépassé : 2e toucher
      saveBlob(x.blob, x.name);
    }
  } else saveBlob(x.blob, x.name);
  readyBon = null;
  const blob = x.blob, name = x.name, school = bName(i.buildingId), no = issueNo(i), id = i.id;
  // Trace + copie Drive (envoyée tout de suite si internet, sinon à la prochaine synchro)
  i.sentAt = nowISO(); await saveIssue(i);
  addLog('suivi.envoye', `Bon ${how} : ${no} - ${i.label}`, { buildingId: i.buildingId, issueId: i.id });
  const drive = !!S.settings.syncToken;   // sans synchro, pas de copie Drive (rien ne s'accumule ici)
  if (drive) {
    const q = (await DB.get('kv', 'bonQueue')) || [];
    await DB.put('kv', [...q.filter(x => x.issueId !== i.id), { issueId: i.id, no, filename: name, folder: school, data: await blobToB64(blob), at: i.sentAt }], 'bonQueue');
  }
  toast((how === 'partagé' ? 'Bon partagé ✓' : 'PDF téléchargé ✓') + (drive ? ' — copie Drive à la synchro' : ''), 4000);
  if ($('#sheet').open) openIssueSheet(id);
  if (location.hash.startsWith('#/suivi')) softRender();
  if (S.settings.autoSync) syncNow(false);
}
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
// Copies Drive en attente (appelé par la synchro, après l'envoi des fiches).
// Un bon qui échoue reste en attente sans bloquer le reste de la synchro.
async function uploadBons() {
  const q = (await DB.get('kv', 'bonQueue')) || [];
  let failed = 0;
  for (const x of q) {
    let url = '', err = '';
    try { url = (await post({ action: 'bon', no: x.no || '', filename: x.filename, folder: x.folder, data: x.data })).url; }
    catch (e) { err = e.message || String(e); failed++; }
    const now = (await DB.get('kv', 'bonQueue')) || [];
    const same = y => y.issueId === x.issueId && y.at === x.at;
    if (err) { await DB.put('kv', now.map(y => (same(y) ? { ...y, tries: (y.tries || 0) + 1, err } : y)), 'bonQueue'); continue; }
    await DB.put('kv', now.filter(y => !same(y)), 'bonQueue');
    const i = S.issues.get(x.issueId);
    if (i && url) { i.bonUrl = url; await saveIssue(i); }
  }
  return failed;
}

// ---------- Scanner de code-barres (lecteur intégré à Chrome sur Android) ----------
// Comme l'app de kilométrage : une lecture n'est acceptée qu'après 3 lectures identiques
// et nettement plus fréquente que toute autre (les codes 39 n'ont pas de chiffre de contrôle).
const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
async function scanBarcode() {
  const want = ['code_39', 'code_128', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'qr_code'];
  const supported = await BarcodeDetector.getSupportedFormats();
  const det = new BarcodeDetector({ formats: want.filter(f => supported.includes(f)) });
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }); }
  catch (e) { toast('Caméra refusée : scan impossible.', 4000); return null; }
  const dlg = document.createElement('dialog'); dlg.className = 'scan';
  dlg.innerHTML = `<video playsinline muted></video><div class="scanframe"></div>
    <p class="scanhint">Vise le code-barres de la requête</p>
    <div class="actions"><button class="btn" data-x="torch" hidden>🔦 Lampe</button><button class="btn" data-x="cancel">Annuler</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  const video = dlg.querySelector('video'); video.srcObject = stream; await video.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  const torchBtn = dlg.querySelector('[data-x="torch"]'); let torch = false;
  try { if (track.getCapabilities?.().torch) torchBtn.hidden = false; } catch (e) { /* pas de lampe */ }
  return new Promise(resolve => {
    let done = false; const counts = {};
    const finish = v => { if (done) return; done = true; stream.getTracks().forEach(t => t.stop()); dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    dlg.querySelector('[data-x="cancel"]').onclick = () => finish(null);
    torchBtn.onclick = async () => { torch = !torch; try { await track.applyConstraints({ advanced: [{ torch }] }); } catch (e) { /* ignoré */ } };
    const tick = async () => {
      if (done) return;
      try {
        for (const c of await det.detect(video)) {
          const v = String(c.rawValue || '').trim().toUpperCase(); if (!v) continue;
          counts[v] = (counts[v] || 0) + 1;
          const rival = Math.max(0, ...Object.entries(counts).filter(([k]) => k !== v).map(([, n]) => n));
          dlg.querySelector('.scanhint').textContent = `Lecture : ${v}`;
          if (counts[v] >= 3 && counts[v] >= rival * 2) { navigator.vibrate?.(80); finish(v); return; }
        }
      } catch (e) { /* image pas prête */ }
      setTimeout(tick, 120);
    };
    tick();
  });
}
// No de requête CSSPI : 3 chiffres (préfixe de l'école) + 1 lettre + 5 chiffres, ex. 057A12345.
const cleanCsspi = s => String(s || '').replace(/[\s-]+/g, '').toUpperCase();
function checkCsspi(v, buildingId) {
  if (!v) return '';
  if (!/^\d{3}[A-Z]\d{5}$/.test(v)) return `« ${v} » n'a pas la forme habituelle 000X00000 (3 chiffres, 1 lettre, 5 chiffres).`;
  const p = bldPrefix(buildingId);
  if (p && p !== '000' && !v.startsWith(p)) return `Ce numéro commence par ${v.slice(0, 3)}, mais le préfixe de ${bName(buildingId)} est ${p}.`;
  return '';
}
