'use strict';
/* Ukrainan sanat – sanatreeni välitoistolla.
 * Jokainen vastaus tallennetaan tapahtumana (event). Kortin tila lasketaan
 * toistamalla tapahtumat, joten lokit voi yhdistää laitteiden välillä
 * pelkällä unionilla. Synkronointi: yksityinen GitHub Gist (progress.json). */

const LS = { events: 'us.events.v1', settings: 'us.settings.v1' };
const GIST_DESC = 'ukraina-sanat progress';
const GIST_FILE = 'progress.json';
const DAY = 86400000;
const APP_VERSION = '2026-11-11c';
const DIRS = { uf: 'Ukraina → suomi', fu: 'Suomi → ukraina' };
const MODES = { card: 'Kortit', mc: 'Monivalinta', type: 'Kirjoitus' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let WORDS = [];          // {uk, fi, note, lesson, lessons: [id…], ex?: {uk, fi}}; lesson = ensisijainen osio
let LESSONS = [];        // {id, title}
let events = store.get(LS.events, []);
let settings = Object.assign({
  lessons: null, dir: 'uf', mode: 'card', size: 20, newPerSession: 10,
  token: '', gistId: '', lastSync: 0,
}, store.get(LS.settings, {}));
let cards = new Map();   // key "uk|dir" -> srs state
const app = document.getElementById('app');

/* ---------- Data ---------- */
async function loadWords() {
  const txt = await (await fetch('data/words.tsv', { cache: 'no-cache' })).text();
  // Sama sana voi kuulua useaan osioon: käännöksellinen rivi luo sanan (ensimmäinen on ensisijainen),
  // viiterivi (pelkkä ukrainankielinen sana) liittää sen myös toiseen osioon – missä kohtaa tiedostoa tahansa.
  // Edistyminen on sanakohtainen, joten se näkyy kaikissa osioissa.
  let lesson = null; const rows = [], seen = new Map();
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const [id, title, flag] = line.slice(1).split('\t');
      lesson = { id: id.trim(), title: (title || id).trim(), off: (flag || '').trim() === 'off' }; LESSONS.push(lesson); continue;
    }
    const [uk, fi, note] = line.split('\t').map(s => (s || '').trim());
    if (uk) rows.push({ uk, fi, note, lid: lesson ? lesson.id : '?', pos: rows.length });
  }
  for (const r of rows) if (r.fi && !seen.has(r.uk)) {
    const w = { uk: r.uk, fi: r.fi, note: r.note || '', lesson: r.lid, lessons: [], pos: {} };
    seen.set(r.uk, w); WORDS.push(w);
  }
  for (const r of rows) { const w = seen.get(r.uk); if (w && !(r.lid in w.pos)) { w.lessons.push(r.lid); w.pos[r.lid] = r.pos; } }
  await loadExamples();
  // Uudet osiot valitaan automaattisesti (paitsi "off"-merkityt), vanhat valinnat säilyvät
  const known = new Set(settings.knownLessons || (settings.lessons ? LESSONS.filter(l => settings.lessons.includes(l.id)).map(l => l.id) : []));
  const sel = new Set(settings.lessons || []);
  for (const l of LESSONS) if (!known.has(l.id) && !l.off) sel.add(l.id);
  settings.lessons = LESSONS.map(l => l.id).filter(id => sel.has(id));
  settings.knownLessons = LESSONS.map(l => l.id);
  saveSettings();
}

// Esimerkkilauseet: data/examples.tsv (ukraina<TAB>esimerkki<TAB>suomennos), *tähdet* = harjoiteltava sana.
// Puuttuva tiedosto ei estä treeniä.
async function loadExamples() {
  try {
    const r = await fetch('data/examples.tsv', { cache: 'no-cache' }); if (!r.ok) return;
    const ex = new Map();
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [uk, exUk, exFi] = line.replace(/\r$/, '').split('\t').map(s => (s || '').trim());
      if (uk && exUk) ex.set(uk, { uk: exUk, fi: exFi || '' });
    }
    for (const w of WORDS) w.ex = ex.get(w.uk);
  } catch {}
}
const exHtml = s => esc(s).replace(/\*(.+?)\*/g, '<b>$1</b>');
const exPlain = s => s.replace(/\*/g, '');
function exampleBlock(w) {
  if (!w.ex) return '';
  return `<div class="example"><div class="ex-uk">${exHtml(w.ex.uk)} <button class="speak" data-say="${esc(exPlain(w.ex.uk))}" aria-label="Kuuntele lause">🔊</button></div>${w.ex.fi ? `<div class="ex-fi">${esc(w.ex.fi)}</div>` : ''}</div>`;
}

/* ---------- SRS (SM-2 -tyylinen) ---------- */
function blank() { return { reps: 0, ivl: 0, ease: 2.5, due: 0, lapses: 0, n: 0, ok: 0, last: 0, lastG: -1 }; }
function apply(c, g, t) {
  c.n++; c.last = t; c.lastG = g;
  if (g >= 1) c.ok++;
  if (g === 0) {
    c.lapses += c.reps > 0 ? 1 : 0; c.reps = 0; c.ivl = 0;
    c.ease = Math.max(1.3, c.ease - 0.2); c.due = t + 60 * 1000;
  } else {
    if (g === 1) { c.ivl = c.reps === 0 ? 0.5 : Math.max(1, c.ivl * 1.2); c.ease = Math.max(1.3, c.ease - 0.15); }
    if (g === 2) { c.ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : c.ivl * c.ease; }
    if (g === 3) { c.ivl = c.reps === 0 ? 3 : Math.max(4, c.ivl * c.ease * 1.3); c.ease += 0.15; }
    c.reps++; c.due = t + c.ivl * DAY;
  }
  return c;
}
function rebuild() {
  cards = new Map();
  events.sort((a, b) => a.t - b.t);
  for (const e of events) {
    const k = e.w + '|' + e.d;
    apply(cards.get(k) || cards.set(k, blank()).get(k), e.g, e.t);
  }
}
const card = (w, d) => cards.get(w.uk + '|' + d);
function status(c) {
  if (!c || c.n === 0) return 'new';
  if (c.ivl < 3) return 'learn';
  if (c.ivl < 21) return 'known';
  return 'strong';
}
const STATUS = { new: 'Uusi', learn: 'Opettelussa', known: 'Osattu', strong: 'Vahva' };
// Hiiren alle tuleva selitys (title). Raja = seuraavan kertauksen väli, joka kasvaa jokaisesta oikeasta vastauksesta.
const STATUS_HELP = {
  new: 'Uusi: korttia ei ole vielä kysytty kertaakaan.',
  learn: 'Opettelussa: kortti on kysytty, mutta seuraava kertaus on alle 3 päivän päästä. Väärä vastaus palauttaa kortin tähän.',
  known: 'Osattu: seuraava kertaus aikaisintaan 3 päivän päästä. Yleensä kaksi oikeaa vastausta eri päivinä.',
  strong: 'Vahva: seuraava kertaus aikaisintaan 3 viikon päästä. Yleensä neljä oikeaa vastausta viikkojen aikana.',
};
const legendHtml = cnt => `<div class="legend">${['strong', 'known', 'learn', 'new'].map(k => `<span title="${STATUS_HELP[k]}"><i class="c-${k}"></i>${STATUS[k]}${cnt ? ' ' + cnt[k] : ''}</span>`).join('')}</div>`;
const barHtml = (cnt, tot, style = '') => `<div class="bar"${style}>${['strong', 'known', 'learn'].map(s => `<i class="c-${s}" title="${STATUS[s]}: ${cnt[s]} / ${tot} korttia (${pct(cnt[s], tot)} %). ${STATUS_HELP[s].replace(/^[^:]+: /, '')}" style="width:${pct(cnt[s], tot)}%"></i>`).join('')}</div>`;

function record(w, d, m, g, ms) {
  const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), t: Date.now(), w: w.uk, d, m, g, ms };
  events.push(e);
  apply(cards.get(w.uk + '|' + d) || cards.set(w.uk + '|' + d, blank()).get(w.uk + '|' + d), g, e.t);
  store.set(LS.events, events);
  pendingSync++;
  if (pendingSync >= 5) sync();
}

/* ---------- Synkronointi (GitHub Gist) ---------- */
let pendingSync = 0, syncing = false;
const syncEl = document.getElementById('sync');
function syncMsg(msg, err) { syncEl.hidden = !msg; syncEl.textContent = msg || ''; syncEl.classList.toggle('err', !!err); }
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, Object.assign({}, opts, {
    headers: { Authorization: 'Bearer ' + settings.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  }));
  if (!r.ok) throw new Error('GitHub ' + r.status + (r.status === 401 ? ' (token ei kelpaa tai on vanhentunut)'
    : r.status === 403 ? ' (tokenilta puuttuu oikeus Account permissions → Gists: Read and write)' : ''));
  return r.json();
}
async function findGist() {
  if (settings.gistId) return settings.gistId;
  for (let page = 1; page <= 5; page++) {
    const list = await gh('/gists?per_page=100&page=' + page);
    const g = list.find(x => x.description === GIST_DESC && x.files[GIST_FILE]);
    if (g) return (settings.gistId = g.id);
    if (list.length < 100) break;
  }
  return null;
}
async function sync() {
  if (!settings.token || syncing) return;
  syncing = true; syncMsg('Synkronoidaan…');
  try {
    let id = await findGist(), remote = [];
    if (id) {
      const g = await gh('/gists/' + id);
      const f = g.files[GIST_FILE];
      let content = f ? f.content : '';
      if (f && f.truncated) content = await (await fetch(f.raw_url)).text();
      if (content) remote = (JSON.parse(content).events) || [];
    }
    const ids = new Set(events.map(e => e.id)); let added = 0;
    for (const e of remote) if (!ids.has(e.id)) { events.push(e); added++; }
    if (added) { rebuild(); store.set(LS.events, events); }
    const body = JSON.stringify({ app: 'ukraina-sanat', version: 1, updated: new Date().toISOString(), events: events.sort((a, b) => a.t - b.t) });
    const payload = { files: { [GIST_FILE]: { content: body } } };
    if (id) await gh('/gists/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
    else { const g = await gh('/gists', { method: 'POST', body: JSON.stringify(Object.assign({ description: GIST_DESC, public: false }, payload)) }); settings.gistId = g.id; }
    settings.lastSync = Date.now(); saveSettings(); pendingSync = 0;
    syncMsg('Synkronoitu ' + new Date().toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }) + (added ? ` · ${added} uutta toisesta laitteesta` : ''));
    if (added && ['home', 'stats', 'words'].includes(view)) render();
  } catch (e) { syncMsg('Synkronointi epäonnistui: ' + e.message, true); }
  syncing = false;
}
// Lähtiessä lähetetään omat vastaukset, palatessa haetaan muiden laitteiden vastaukset
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (pendingSync) sync(); }
  else if (Date.now() - settings.lastSync > 30000) sync();
});
const syncLine = () => `${events.length} vastausta tällä laitteella · ${settings.lastSync ? 'synkronoitu ' + new Date(settings.lastSync).toLocaleString('fi-FI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ei synkronoitu'} · versio ${APP_VERSION}`;
function saveSettings() { store.set(LS.settings, settings); }

/* ---------- Puhe ---------- */
let ukVoice = null;
function pickVoice() { ukVoice = (speechSynthesis.getVoices() || []).find(v => /^uk/i.test(v.lang)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speakSynth(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'uk-UA'; if (ukVoice) u.voice = ukVoice; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
// Ensisijaisesti valmis neuroääni audio/<sha1(teksti)[:16]>.mp3 (tools/make_audio.py), muuten selaimen puhesynteesi
// Tiedostonimet lasketaan valmiiksi latauksen jälkeen, jotta soitto alkaa suoraan napautuksesta (iOS vaatii).
let audioEl = null; const audioUrls = new Map();
async function audioUrl(text) {
  if (audioUrls.has(text)) return audioUrls.get(text);
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const url = 'audio/' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16) + '.mp3';
  audioUrls.set(text, url); return url;
}
async function prepareAudio() {
  try { for (const w of WORDS) { await audioUrl(w.uk); if (w.ex) await audioUrl(exPlain(w.ex.uk)); } } catch {}
}
function speak(text) {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (audioEl) audioEl.pause();
  // Varaääni vain, jos tiedostoa ei saada soimaan. Keskeytys (uusi 🔊-painallus, AbortError) ei ole virhe.
  const play = url => {
    const a = audioEl = new Audio(url);
    a.play().catch(e => { if (e.name !== 'AbortError' && audioEl === a) speakSynth(text); });
  };
  const url = audioUrls.get(text);
  if (url) play(url); else audioUrl(text).then(play, () => speakSynth(text));
}

/* ---------- Apu ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const dayKey = t => new Date(t).toLocaleDateString('sv-SE');
const norm = s => s.toLowerCase().replace(/[ʼ’'`]/g, "'").replace(/\(.*?\)/g, '').replace(/[.,!?…;:]/g, ' ').replace(/\s+/g, ' ').trim();
function accepted(answer) {
  const base = answer.replace(/\(.*?\)/g, '');
  const parts = base.split(/[,;/]/).map(norm).filter(Boolean);
  return new Set([norm(answer), norm(base), ...parts]);
}
const lessonTitle = id => (LESSONS.find(l => l.id === id) || {}).title || id;
const dirsFor = d => d === 'mix' ? ['uf', 'fu'] : [d];

/* ---------- Näkymät ---------- */
let view = 'home';
function go(v) { view = v; document.querySelectorAll('.top nav button').forEach(b => b.classList.toggle('active', b.dataset.go === v)); render(); window.scrollTo(0, 0); }
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { if (session && view === 'session' && !confirm('Lopetetaanko treeni?')) return; session = null; go(b.dataset.go); }));
function render() { ({ home, stats, words: wordsView, grammar: grammarView, settings: settingsView, session: sessionView, summary }[view] || home)(); }

/* ---------- Kielioppi ---------- */
let GRAMMAR = null;
async function grammarView() {
  if (!GRAMMAR) {
    app.innerHTML = '<p class="muted center">Ladataan…</p>';
    try { GRAMMAR = await (await fetch('data/kielioppi.html', { cache: 'no-cache' })).text(); }
    catch (e) { app.innerHTML = `<p class="center">Kieliopin lataus epäonnistui: ${esc(e.message)}</p>`; return; }
  }
  app.innerHTML = `<h1>Kielioppi</h1><p class="muted">Kaikki kurssilla tähän mennessä esiin tullut kielioppi. Avaa "Testaa itsesi" vasta, kun olet vastannut ääneen.</p>
    <nav class="toc" id="toc"></nav><div class="grammar">${GRAMMAR}</div>`;
  const toc = app.querySelector('#toc');
  toc.innerHTML = [...app.querySelectorAll('.grammar section')].map(s => `<a href="#${s.id}">${esc(s.querySelector('h2').textContent)}</a>`).join('');
  toc.addEventListener('click', e => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1)).scrollIntoView({ behavior: 'smooth' }); });
  // Itsetestaus: kysymykset näkyvät avattaessa, vastaukset vasta erillisestä napista
  app.querySelectorAll('details.quiz').forEach(d => {
    const b = document.createElement('button'); b.className = 'btn reveal'; b.textContent = 'Näytä vastaukset';
    b.onclick = () => { d.classList.toggle('show'); b.textContent = d.classList.contains('show') ? 'Piilota vastaukset' : 'Näytä vastaukset'; };
    d.querySelector('.ans').before(b);
  });
  const h = location.hash.slice(1); if (h && document.getElementById(h)) document.getElementById(h).scrollIntoView();
}

function home() {
  const now = Date.now(), sel = new Set(settings.lessons), dirs = dirsFor(settings.dir);
  let due = 0, fresh = 0;
  for (const w of WORDS) if (w.lessons.some(id => sel.has(id))) for (const d of dirs) { const c = card(w, d); if (!c || !c.n) fresh++; else if (c.due <= now) due++; }
  const today = events.filter(e => dayKey(e.t) === dayKey(now)).length;
  app.innerHTML = `
    <h1>Treeni</h1>
    <p class="muted">${due} kerrattavaa · ${fresh} uutta valituissa osioissa · tänään ${today} vastausta</p>
    <div class="panel">
      <div class="row"><span class="grow">Suunta</span>
        <div class="seg" id="dir">${Object.entries({ uf: 'UA → FI', fu: 'FI → UA', mix: 'Molemmat' }).map(([k, v]) => `<button data-v="${k}" class="${settings.dir === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="row" style="margin-top:10px"><span class="grow">Tapa</span>
        <div class="seg" id="mode">${Object.entries(MODES).map(([k, v]) => `<button data-v="${k}" class="${settings.mode === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="row" style="margin-top:10px"><span class="grow">Kortteja / uusia</span>
        <div class="seg" id="size">${[10, 20, 40].map(n => `<button data-v="${n}" class="${settings.size === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="seg" id="newn">${[0, 5, 10, 20].map(n => `<button data-v="${n}" class="${settings.newPerSession === n ? 'on' : ''}">+${n}</button>`).join('')}</div></div>
    </div>
    <button class="btn primary big" id="start" ${due + fresh ? '' : 'disabled'}>Aloita treeni</button>
    <h2>Osiot</h2>
    <div class="row small" style="margin-bottom:6px"><button class="btn" id="all">Kaikki</button><button class="btn" id="none">Ei mitään</button></div>
    <div class="lessons">${LESSONS.map(l => {
      const ws = WORDS.filter(w => w.lessons.includes(l.id)); const cnt = { new: 0, learn: 0, known: 0, strong: 0 };
      for (const w of ws) for (const d of dirs) cnt[status(card(w, d))]++;
      const tot = ws.length * dirs.length;
      return `<label class="lesson"><input type="checkbox" value="${l.id}" ${sel.has(l.id) ? 'checked' : ''}>
        <span class="name">${esc(l.title)}${barHtml(cnt, tot, ' style="margin-top:6px"')}</span>
        <span class="meta">${ws.length} sanaa</span></label>`;
    }).join('')}</div>
    ${legendHtml()}
    <p class="small muted" style="margin-top:14px">${syncLine()}</p>
    ${settings.token ? '' : `<p class="small muted" style="margin-top:20px">Tulokset tallentuvat nyt vain tähän selaimeen. Ota synkronointi käyttöön <a href="#" id="toset">asetuksissa</a>, niin edistyminen näkyy myös muilla laitteilla ja Clauden analyysissä.</p>`}`;
  const segs = { dir: v => settings.dir = v, mode: v => settings.mode = v, size: v => settings.size = +v, newn: v => settings.newPerSession = +v };
  for (const [id, fn] of Object.entries(segs)) app.querySelector('#' + id).addEventListener('click', e => { const v = e.target.dataset.v; if (v === undefined) return; fn(v); saveSettings(); home(); });
  app.querySelectorAll('.lesson input').forEach(i => i.addEventListener('change', () => { settings.lessons = [...app.querySelectorAll('.lesson input:checked')].map(x => x.value); saveSettings(); home(); }));
  app.querySelector('#all').onclick = () => { settings.lessons = LESSONS.map(l => l.id); saveSettings(); home(); };
  app.querySelector('#none').onclick = () => { settings.lessons = []; saveSettings(); home(); };
  app.querySelector('#start').onclick = startSession;
  const ts = app.querySelector('#toset'); if (ts) ts.onclick = e => { e.preventDefault(); go('settings'); };
}

/* ---------- Treenisessio ---------- */
let session = null;
function startSession() {
  const now = Date.now(), sel = new Set(settings.lessons), dirs = dirsFor(settings.dir);
  const due = [], fresh = [];
  for (const w of WORDS) if (w.lessons.some(id => sel.has(id))) for (const d of dirs) {
    const c = card(w, d);
    if (!c || !c.n) fresh.push({ w, d }); else if (c.due <= now) due.push({ w, d, due: c.due });
  }
  due.sort((a, b) => a.due - b.due);
  // Uudet sanat valittujen osioiden omassa järjestyksessä (sana, joka on myös aiemmassa osiossa, tulee tämän osion kohdalla)
  const rank = w => Math.min(...w.lessons.filter(id => sel.has(id)).map(id => w.pos[id]));
  fresh.sort((a, b) => rank(a.w) - rank(b.w));
  // Ensin erääntyneet kertaukset (sekoitettuna), sitten uudet sanat osion järjestyksessä
  const dueTake = due.slice(0, settings.size);
  const newTake = fresh.slice(0, Math.max(0, Math.min(settings.newPerSession, settings.size - dueTake.length)));
  if (!dueTake.length && !newTake.length) { alert('Ei kerrattavaa juuri nyt. Lisää uusia sanoja (+5 / +10) tai valitse lisää osioita.'); return; }
  session = { queue: shuffle(dueTake).concat(newTake), i: 0, results: [], again: new Map(), mode: settings.mode };
  go('session');
}
function current() { return session.queue[session.i]; }
function sessionView() {
  const it = current(); if (!it) return endSession();
  const { w, d } = it, front = d === 'uf' ? w.uk : w.fi, back = d === 'uf' ? w.fi : w.uk;
  const c = card(w, d), isNew = !c || !c.n;
  session.shown = Date.now(); session.revealed = false;
  app.innerHTML = `
    <div class="row small muted"><span class="grow">${esc(lessonTitle(w.lessons.find(id => settings.lessons.includes(id)) || w.lesson))}</span><span>${session.i + 1} / ${session.queue.length}</span></div>
    <div class="progress"><i style="width:${pct(session.i, session.queue.length)}%"></i></div>
    <div class="card" id="card">
      <div class="dirlbl">${DIRS[d]} ${isNew ? '<span class="tag">uusi</span>' : ''}</div>
      <div class="prompt">${esc(front)}</div>
      ${d === 'uf' ? `<button class="speak" data-say="${esc(w.uk)}">🔊 kuuntele</button>` : ''}
      <div id="reveal"></div>
    </div>
    <div id="controls"></div>`;
  wireSpeak();
  const ctl = app.querySelector('#controls');
  if (session.mode === 'card') {
    ctl.innerHTML = `<button class="btn primary big" id="flip" style="margin-top:14px">Näytä vastaus</button><div class="hint">Välilyönti = näytä · 1–4 = arvio</div>`;
    ctl.querySelector('#flip').onclick = flip;
  } else if (session.mode === 'mc') {
    const pool = WORDS.filter(x => x !== w && (d === 'uf' ? x.fi : x.uk) !== back);
    const same = shuffle(pool.filter(x => x.lesson === w.lesson)), other = shuffle(pool.filter(x => x.lesson !== w.lesson));
    const opts = shuffle([w, ...same.concat(other).slice(0, 3)]);
    session.opts = opts;
    ctl.innerHTML = `<div class="choices">${opts.map((o, i) => `<button data-i="${i}">${esc(d === 'uf' ? o.fi : o.uk)}<kbd>${i + 1}</kbd></button>`).join('')}</div>`;
    ctl.querySelectorAll('button').forEach(b => b.onclick = () => choose(+b.dataset.i));
  } else {
    ctl.innerHTML = `<form class="typein" id="tf"><input id="ti" autocomplete="off" autocapitalize="off" spellcheck="false" lang="${d === 'uf' ? 'fi' : 'uk'}" placeholder="${d === 'uf' ? 'Kirjoita suomeksi' : 'Напишіть українською'}"><button class="btn primary">OK</button></form>
      <div class="hint">${d === 'fu' ? 'Tarvitset ukrainan näppäimistön. ' : ''}Tyhjä vastaus = en tiedä</div>`;
    const inp = ctl.querySelector('#ti'); inp.focus();
    ctl.querySelector('#tf').onsubmit = e => { e.preventDefault(); typed(inp.value); };
  }
}
function wireSpeak() { app.querySelectorAll('[data-say]').forEach(b => b.onclick = () => speak(b.dataset.say)); }
function showBack(extraClass) {
  const { w, d } = current(), back = d === 'uf' ? w.fi : w.uk;
  const r = app.querySelector('#reveal');
  r.innerHTML = `<div class="answer">${esc(back)}</div>${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}${d === 'fu' ? `<button class="speak" data-say="${esc(w.uk)}">🔊 kuuntele</button>` : ''}${exampleBlock(w)}`;
  if (extraClass) app.querySelector('#card').classList.add(extraClass);
  wireSpeak(); session.revealed = true;
}
function flip() {
  if (session.revealed) return;
  session.ms = Date.now() - session.shown; showBack();
  const { w, d } = current(), c = Object.assign(blank(), card(w, d) || {});
  const nxt = g => { const x = apply(Object.assign({}, c), g, Date.now()); return g === 0 ? '<1 min' : x.ivl < 1 ? '12 h' : Math.round(x.ivl) + ' pv'; };
  app.querySelector('#controls').innerHTML = `<div class="grades">
    <button class="g0" data-g="0">En muistanut<small>${nxt(0)}</small></button>
    <button class="g1" data-g="1">Vaikea<small>${nxt(1)}</small></button>
    <button class="g2" data-g="2">Muistin<small>${nxt(2)}</small></button>
    <button class="g3" data-g="3">Helppo<small>${nxt(3)}</small></button></div>
    <div class="hint">1 = en muistanut · 2 = vaikea · 3 = muistin · 4 = helppo</div>`;
  app.querySelectorAll('.grades button').forEach(b => b.onclick = () => grade(+b.dataset.g));
}
function choose(i) {
  if (session.revealed) return;
  const { w } = current(), ok = session.opts[i] === w, ms = Date.now() - session.shown;
  const btns = app.querySelectorAll('.choices button');
  btns.forEach((b, j) => { b.disabled = true; if (session.opts[j] === w) b.classList.add('right'); });
  if (!ok) btns[i].classList.add('wrong');
  showBack(ok ? 'ok' : 'ko');
  const g = ok ? (ms < 6000 ? 2 : 1) : 0;
  nextAfter(g, ms, ok);
}
function typed(val) {
  if (session.revealed) return;
  const { w, d } = current(), back = d === 'uf' ? w.fi : w.uk, ms = Date.now() - session.shown;
  const ok = !!val.trim() && accepted(back).has(norm(val));
  showBack(ok ? 'ok' : 'ko');
  const ctl = app.querySelector('#controls');
  ctl.innerHTML = `<div class="verdict ${ok ? 'ok' : 'ko'}">${ok ? 'Oikein!' : val.trim() ? `Vastasit: <b>${esc(val)}</b>` : 'Ei vastausta'}</div>
    ${ok ? '' : '<button class="btn" id="override" style="margin-top:8px">Vastaukseni oli oikein</button>'}`;
  const g = ok ? 2 : 0;
  session.pending = { g, ms };
  if (!ok) ctl.querySelector('#override').onclick = () => { session.pending.g = 2; ctl.querySelector('.verdict').className = 'verdict ok'; ctl.querySelector('.verdict').textContent = 'Merkitty oikeaksi'; ctl.querySelector('#override').remove(); };
  ctl.insertAdjacentHTML('beforeend', '<button class="btn primary big" id="next" style="margin-top:10px">Seuraava</button>');
  ctl.querySelector('#next').onclick = () => { const p = session.pending; session.pending = null; grade(p.g, p.ms); };
  ctl.querySelector('#next').focus();
}
function nextAfter(g, ms, ok) {
  const ctl = app.querySelector('#controls');
  ctl.insertAdjacentHTML('beforeend', `<button class="btn primary big" id="next" style="margin-top:12px">Seuraava</button><div class="hint">Enter = seuraava</div>`);
  ctl.querySelector('#next').onclick = () => grade(g, ms);
  ctl.querySelector('#next').focus();
}
function grade(g, ms) {
  const it = current(); if (!it) return;
  record(it.w, it.d, session.mode, g, ms ?? session.ms ?? (Date.now() - session.shown));
  session.results.push({ w: it.w, d: it.d, g });
  if (g === 0) {
    const k = it.w.uk + '|' + it.d, n = session.again.get(k) || 0;
    if (n < 2) { session.again.set(k, n + 1); session.queue.splice(Math.min(session.queue.length, session.i + 4), 0, { w: it.w, d: it.d }); }
  }
  session.i++; session.revealed = false; sessionView();
}
function endSession() { view = 'summary'; sync(); render(); }
function summary() {
  const r = session ? session.results : [];
  const firstTry = new Map(); for (const x of r) { const k = x.w.uk + '|' + x.d; if (!firstTry.has(k)) firstTry.set(k, x); }
  const ft = [...firstTry.values()], ok = ft.filter(x => x.g >= 1).length;
  const missed = ft.filter(x => x.g === 0);
  app.innerHTML = `<h1>Valmis!</h1>
    <div class="kpis"><div class="kpi"><b>${ft.length}</b><span>korttia</span></div><div class="kpi"><b>${pct(ok, ft.length)}%</b><span>oikein 1. yrityksellä</span></div>
      <div class="kpi"><b>${missed.length}</b><span>kerrattavaksi</span></div><div class="kpi"><b>${r.length}</b><span>vastausta</span></div></div>
    ${missed.length ? `<h2>Nämä jäivät vielä hakusalle</h2><div class="panel"><table>${missed.map(x => `<tr><td class="uk">${esc(x.w.uk)}</td><td>${esc(x.w.fi)}</td><td class="muted small">${x.d === 'uf' ? 'UA→FI' : 'FI→UA'}</td></tr>`).join('')}</table></div>` : '<p>Kaikki meni ensimmäisellä kerralla. Hienoa!</p>'}
    <div class="row" style="margin-top:16px"><button class="btn primary grow" id="again">Uusi treeni</button><button class="btn grow" id="tostats">Tilastot</button></div>`;
  app.querySelector('#again').onclick = () => { session = null; go('home'); };
  app.querySelector('#tostats').onclick = () => { session = null; go('stats'); };
}
document.addEventListener('keydown', e => {
  if (view !== 'session' || !session || e.target.tagName === 'INPUT') return;
  if (session.mode === 'card') {
    if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); }
    else if (session.revealed && '1234'.includes(e.key)) grade(+e.key - 1);
  } else if (session.mode === 'mc' && !session.revealed && '1234'.includes(e.key)) choose(+e.key - 1);
});

/* ---------- Tilastot ---------- */
function stats() {
  const now = Date.now(), all = WORDS.length * 2;
  const cnt = { new: 0, learn: 0, known: 0, strong: 0 }; let due = 0;
  for (const w of WORDS) for (const d of ['uf', 'fu']) { const c = card(w, d); cnt[status(c)]++; if (c && c.n && c.due <= now) due++; }
  const days = new Set(events.map(e => dayKey(e.t)));
  let streak = 0; for (let t = now; days.has(dayKey(t)); t -= DAY) streak++;
  const last7 = events.filter(e => e.t > now - 7 * DAY), acc7 = pct(last7.filter(e => e.g >= 1).length, last7.length);
  const perDay = []; for (let i = 13; i >= 0; i--) { const k = dayKey(now - i * DAY); perDay.push({ k, n: events.filter(e => dayKey(e.t) === k).length }); }
  const maxN = Math.max(1, ...perDay.map(x => x.n));
  const byDir = d => { const es = events.filter(e => e.d === d); return `${pct(es.filter(e => e.g >= 1).length, es.length)}% (${es.length})`; };
  const hard = [];
  for (const w of WORDS) for (const d of ['uf', 'fu']) { const c = card(w, d); if (c && c.n >= 2) hard.push({ w, d, c, acc: c.ok / c.n }); }
  hard.sort((a, b) => a.acc - b.acc || b.c.lapses - a.c.lapses);
  app.innerHTML = `<h1>Tilastot</h1>
    <div class="kpis"><div class="kpi"><b>${cnt.known + cnt.strong}</b><span>osattua korttia / ${all}</span></div>
      <div class="kpi"><b>${due}</b><span>kerrattavaa nyt</span></div><div class="kpi"><b>${acc7}%</b><span>oikein 7 pv</span></div><div class="kpi"><b>${streak}</b><span>päivän putki</span></div></div>
    <div class="panel">${barHtml(cnt, all)}
      ${legendHtml(cnt)}
      <p class="small muted" style="margin:10px 0 0">${syncLine()}</p>
      <p class="small muted" style="margin:10px 0 0">Kortti = sana yhteen suuntaan, eli jokaisella sanalla on kaksi korttia. "Osattu" = seuraava kertaus aikaisintaan 3 päivän päästä, "vahva" = 3 viikon päästä.</p></div>
    <h2>Vastaukset 14 päivää</h2>
    <div class="panel"><div style="display:flex;align-items:flex-end;gap:4px;height:90px">${perDay.map(x => `<div title="${x.k}: ${x.n}" style="flex:1;background:var(--accent);opacity:${x.n ? 1 : .15};height:${Math.max(3, 90 * x.n / maxN)}px;border-radius:4px 4px 0 0"></div>`).join('')}</div>
      <p class="small muted" style="margin:8px 0 0">Oikein-%: UA→FI ${byDir('uf')} · FI→UA ${byDir('fu')}</p></div>
    <h2>Vaikeimmat sanat</h2>
    <div class="panel">${hard.length ? `<table><tr><th>Sana</th><th>Suomeksi</th><th>Suunta</th><th>Oikein</th></tr>${hard.slice(0, 15).map(x => `<tr><td class="uk">${esc(x.w.uk)}</td><td>${esc(x.w.fi)}</td><td class="small muted">${x.d === 'uf' ? 'UA→FI' : 'FI→UA'}</td><td>${x.c.ok}/${x.c.n}</td></tr>`).join('')}</table>` : '<p class="muted">Tähän tulee lista, kun olet vastannut samaan korttiin vähintään kahdesti.</p>'}</div>`;
}

/* ---------- Sanasto ---------- */
function wordsView() {
  app.innerHTML = `<h1>Sanasto</h1><p class="muted">${WORDS.length} sanaa · pisteen väri = UA→FI / FI→UA</p>
    <input class="search" id="q" placeholder="Hae ukrainaksi tai suomeksi">
    <div id="list"></div>`;
  const colors = { new: 'var(--s-new)', learn: 'var(--s-learn)', known: 'var(--s-known)', strong: 'var(--s-strong)' };
  const draw = q => {
    q = norm(q || '');
    app.querySelector('#list').innerHTML = LESSONS.map(l => {
      const ws = WORDS.filter(w => w.lessons.includes(l.id) && (!q || norm(w.uk).includes(q) || norm(w.fi).includes(q) || (w.ex && norm(exPlain(w.ex.uk)).includes(q))));
      if (!ws.length) return '';
      return `<h2>${esc(l.title)}</h2><div class="panel"><table>${ws.map(w => `<tr>
        <td style="white-space:nowrap">${['uf', 'fu'].map(d => `<span class="dot" title="${DIRS[d]}: ${STATUS[status(card(w, d))]}" style="background:${colors[status(card(w, d))]}"></span>`).join('')}</td>
        <td class="uk">${esc(w.uk)} <button class="speak" data-say="${esc(w.uk)}" aria-label="Kuuntele">🔊</button></td><td>${esc(w.fi)}${w.note ? `<div class="small muted">${esc(w.note)}</div>` : ''}${w.ex ? `<div class="small ex-row"><span class="uk">${exHtml(w.ex.uk)}</span> <button class="speak" data-say="${esc(exPlain(w.ex.uk))}" aria-label="Kuuntele lause">🔊</button><br><span class="muted">${esc(w.ex.fi)}</span></div>` : ''}</td></tr>`).join('')}</table></div>`;
    }).join('');
    wireSpeak();
  };
  app.querySelector('#q').addEventListener('input', e => draw(e.target.value)); draw('');
}

/* ---------- Asetukset ---------- */
function settingsView() {
  app.innerHTML = `<h1>Asetukset</h1>
    <h2>Synkronointi GitHubiin</h2>
    <div class="panel">
      <p class="small">Tulokset tallennetaan yksityiseen GitHub Gistiin, jotta ne näkyvät kaikilla laitteillasi ja Claude voi analysoida edistymistäsi.</p>
      <ol class="steps small">
        <li>Avaa <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
        <li>Nimi: <code>ukraina-sanat</code>, voimassaolo vapaavalintainen</li>
        <li>Account permissions → <b>Gists: Read and write</b> (muita oikeuksia ei tarvita)</li>
        <li>Luo token ja liitä se alle. Toista sama jokaisella laitteella.</li>
      </ol>
      <div class="field"><label for="tok">GitHub-token</label><input id="tok" type="password" value="${esc(settings.token)}" placeholder="github_pat_…" autocomplete="off"></div>
      <div class="row"><button class="btn primary" id="save">Tallenna ja synkronoi</button>${settings.token ? '<button class="btn" id="forget">Poista token</button>' : ''}</div>
      <p class="small muted">${settings.gistId ? `Gist: <a href="https://gist.github.com/${esc(settings.gistId)}" target="_blank" rel="noopener">${esc(settings.gistId.slice(0, 10))}…</a> · ` : ''}${settings.lastSync ? 'Viimeksi synkronoitu ' + new Date(settings.lastSync).toLocaleString('fi-FI') : 'Ei vielä synkronoitu'}</p>
      <p class="small muted">Token tallentuu vain tämän selaimen muistiin. Sillä pääsee käsiksi ainoastaan Gisteihisi.</p>
    </div>
    <h2>Tiedot</h2>
    <div class="panel">
      <p class="small muted" style="margin-top:0">${events.length} vastausta tallessa tässä selaimessa.</p>
      <div class="row"><button class="btn" id="export">Vie JSON</button><label class="btn">Tuo JSON<input type="file" id="import" accept="application/json" hidden></label><button class="btn" id="reset" style="color:var(--bad)">Nollaa tiedot</button></div>
    </div>`;
  app.querySelector('#save').onclick = async () => { settings.token = app.querySelector('#tok').value.trim(); settings.gistId = ''; saveSettings(); await sync(); settingsView(); };
  const f = app.querySelector('#forget'); if (f) f.onclick = () => { settings.token = ''; settings.gistId = ''; saveSettings(); syncMsg(''); settingsView(); };
  app.querySelector('#export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'ukraina-sanat', version: 1, events }, null, 1)], { type: 'application/json' }));
    a.download = 'ukraina-sanat-' + dayKey(Date.now()) + '.json'; a.click();
  };
  app.querySelector('#import').onchange = async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text()), ids = new Set(events.map(x => x.id)); let n = 0;
      for (const x of data.events || []) if (!ids.has(x.id)) { events.push(x); n++; }
      rebuild(); store.set(LS.events, events); alert(n + ' vastausta tuotu.'); settingsView();
    } catch (err) { alert('Tuonti epäonnistui: ' + err.message); }
  };
  app.querySelector('#reset').onclick = () => {
    if (!confirm('Poistetaanko kaikki tämän selaimen tulokset? Gistissä olevat tulokset säilyvät ja palaavat seuraavassa synkronoinnissa.')) return;
    events = []; store.set(LS.events, events); rebuild(); settingsView();
  };
}

/* ---------- Käynnistys ---------- */
(async () => {
  try { await loadWords(); } catch (e) { app.innerHTML = `<p class="center">Sanaston lataus epäonnistui: ${esc(e.message)}</p>`; return; }
  rebuild(); go('home'); prepareAudio();
  if (settings.token) sync();
})();
