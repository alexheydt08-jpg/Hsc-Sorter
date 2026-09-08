/* ==========================================================================
   Flashcards: storage, scheduling, and the three Bank views.

   The Bank used to be a flat list of marked answers held as one JSON string in
   localStorage. That store could never hold a photo — a single phone picture
   base64-encoded is most of the 5MB budget — so cards live in IndexedDB
   instead, with uploaded images kept as Blobs.

   Images already in this repository cost nothing to reference: a question sent
   to the marker from Browse carries paths like img/trials/….webp, so the card
   stores the path rather than a copy. Only genuinely uploaded files become
   blobs.
   ========================================================================== */
"use strict";

const DB_NAME = "hsc-cards";
const DB_VER  = 1;
const LEGACY_BANK_KEY = "hsc-marker-bank";
const PREFS_KEY = "hsc-cards-prefs";

const DAY = 86400000;
const MIN = 60000;

/* ---------- IndexedDB, wrapped in promises ------------------------------- */
let _db = null;

function openDB(){
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")){
        const s = db.createObjectStore("cards", { keyPath: "id" });
        s.createIndex("due", "srs.due");
        s.createIndex("subject", "subject");
      }
      if (!db.objectStoreNames.contains("blobs"))
        db.createObjectStore("blobs", { keyPath: "id" });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn){
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && "onsuccess" in r){ r.onsuccess = () => { out = r.result; }; }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const dbAll    = store => tx(store, "readonly",  s => s.getAll());
const dbGet    = (store, id) => tx(store, "readonly",  s => s.get(id));
const dbPut    = (store, v)  => tx(store, "readwrite", s => s.put(v));
const dbDel    = (store, id) => tx(store, "readwrite", s => s.delete(id));
const dbClear  = store => tx(store, "readwrite", s => s.clear());

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- preferences -------------------------------------------------- */
const readPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; }
};
const writePrefs = p => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} };

let PREFS = Object.assign({ newPerDay: 20, lastExport: 0, hideBackupNote: false }, readPrefs());
const savePrefs = () => { writePrefs(PREFS); };

/* ---------- SM-2 ---------------------------------------------------------
   Anki's scheduler descends from SM-2: each card carries an ease factor that
   rises when recall is easy and falls when it is not, and the gap to the next
   review is the last gap multiplied by that ease. Getting it wrong sends the
   card back to short learning steps so it comes round again the same session.
   Kept as pure functions so the intervals can be checked without a browser. */

const LEARN_STEPS = [1 * MIN, 10 * MIN];
const EASE_MIN = 1.3, EASE_MAX = 3.0;
const clampEase = e => Math.max(EASE_MIN, Math.min(EASE_MAX, e));

function newSrs(){
  return { due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, state: "new", step: 0 };
}

/* rating: 1 again | 2 hard | 3 good | 4 easy */
function schedule(srs, rating, now = Date.now()){
  const s = Object.assign({}, srs);
  s.reps += 1;

  if (rating === 1){
    s.lapses += 1;
    s.ease = clampEase(s.ease - 0.20);
    s.state = "learning";
    s.step = 0;
    s.interval = 0;
    s.due = now + LEARN_STEPS[0];
    return s;
  }

  if (s.state === "new" || s.state === "learning"){
    const next = s.step + 1;
    if (rating === 4 || next >= LEARN_STEPS.length){
      s.state = "review";
      s.step = 0;
      s.interval = rating === 4 ? 4 : 1;          // easy graduates further out
      s.ease = clampEase(s.ease + (rating === 4 ? 0.15 : 0));
      s.due = now + s.interval * DAY;
    } else {
      s.state = "learning";
      s.step = next;
      s.due = now + LEARN_STEPS[next];
    }
    return s;
  }

  // review card
  const base = s.interval || 1;
  if (rating === 2){
    s.ease = clampEase(s.ease - 0.15);
    s.interval = Math.max(1, Math.round(base * 1.2));
  } else if (rating === 3){
    s.interval = base === 1 ? 6 : Math.max(1, Math.round(base * s.ease));
  } else {
    s.ease = clampEase(s.ease + 0.15);
    s.interval = base === 1 ? 6 : Math.max(1, Math.round(base * s.ease * 1.3));
  }
  s.state = "review";
  s.due = now + s.interval * DAY;
  return s;
}

/* what each button will do, so the reviewer can label them honestly */
function previewIntervals(srs, now = Date.now()){
  return [1,2,3,4].map(r => {
    const s = schedule(srs, r, now);
    const ms = s.due - now;
    return ms < 45 * MIN ? Math.round(ms / MIN) + "m"
         : ms < 90 * DAY ? Math.max(1, Math.round(ms / DAY)) + "d"
         : Math.round(ms / (30 * DAY)) + "mo";
  });
}

/* ---------- cards -------------------------------------------------------- */
let CARDS = [];

function blankCard(subject){
  return {
    id: uid(), created: Date.now(),
    subject: subject || APP.subject,
    deck: { module: "", iqs: [] },
    front: { text: "", images: [] },
    back:  { text: "", images: [] },
    notes: "", tags: [], starred: false,
    srs: newSrs(), history: [],
  };
}

async function loadCards(){
  CARDS = await dbAll("cards");
  CARDS.sort((a, b) => b.created - a.created);
}

async function putCard(c){
  await dbPut("cards", c);
  const i = CARDS.findIndex(x => x.id === c.id);
  if (i === -1) CARDS.unshift(c); else CARDS[i] = c;
}

async function removeCard(c){
  for (const im of [...c.front.images, ...c.back.images])
    if (im.kind === "blob") await dbDel("blobs", im.id).catch(() => {});
  await dbDel("cards", c.id);
  CARDS = CARDS.filter(x => x.id !== c.id);
}

/* store an uploaded File and hand back a reference to it */
async function storeBlob(file){
  const id = uid();
  await dbPut("blobs", { id, blob: file });
  return { kind: "blob", id };
}

/* object URLs are revoked when the view is redrawn, so nothing leaks */
let liveUrls = [];
function releaseUrls(){ liveUrls.forEach(URL.revokeObjectURL); liveUrls = []; }

async function imgSrc(ref){
  if (ref.kind === "repo") return ref.src;
  const rec = await dbGet("blobs", ref.id);
  if (!rec) return "";
  const url = URL.createObjectURL(rec.blob);
  liveUrls.push(url);
  return url;
}

async function imagesHTML(refs, cls){
  const out = [];
  for (const r of refs || []){
    const src = await imgSrc(r);
    if (src) out.push(`<img class="${cls}" src="${esc(src)}" alt="">`);
  }
  return out.join("");
}

/* ---------- migration from the old bank ---------------------------------- */
async function migrateLegacy(){
  if (CARDS.length) return 0;
  let old = [];
  try { old = JSON.parse(localStorage.getItem(LEGACY_BANK_KEY) || "[]"); } catch { return 0; }
  if (!Array.isArray(old) || !old.length) return 0;

  for (const e of old.slice().reverse()){
    const c = blankCard(e.subject);
    c.id = "legacy-" + (e.id || uid());
    c.created = e.ts || Date.now();
    c.front.text = e.question || "";
    c.back.text = e.answer || "";
    c.notes = e.feedback || "";              // the marker's comment is kept
    c.deck.module = MODULE_LIST(c.subject).includes(e.module) ? e.module : "";
    if (e.source?.year) c.tags.push(String(e.source.year));
    await putCard(c);
  }
  /* the old key is deliberately left in place as a fallback */
  return old.length;
}

/* ---------- syllabus helpers (Year 12, modules 5-8) ---------------------- */
const MODULE_LIST = subject => Object.keys((typeof SYLLABUS !== "undefined" && SYLLABUS[subject]) || {});
const IQ_LIST = (subject, module) => {
  const topics = ((typeof SYLLABUS !== "undefined" && SYLLABUS[subject]) || {})[module] || [];
  return topics.map(topic => ({ topic, iq: IQ_FOR(subject, module, topic) }));
};
/* topic -> inquiry question, read off the tagged data so the strings match */
let _iqCache = null;
function IQ_FOR(subject, module, topic){
  if (!_iqCache){
    _iqCache = {};
    for (const r of (window.QDATA || []).concat(window.TDATA || []))
      for (const t of (r.tags || []))
        _iqCache[`${r.subject}||${t.module}||${t.topic}`] = t.iq;
  }
  return _iqCache[`${subject}||${module}||${topic}`] || topic;
}

/* ---------- the review queue --------------------------------------------
   Due review cards first, then up to newPerDay cards never seen before, so a
   session always clears the backlog before adding to it. */
function todayKey(d = new Date()){ return d.toISOString().slice(0, 10); }

function studiedToday(){
  const k = todayKey();
  return CARDS.reduce((n, c) =>
    n + (c.history || []).filter(h => todayKey(new Date(h.ts)) === k).length, 0);
}

function newSeenToday(){
  const k = todayKey();
  return CARDS.filter(c => (c.history || []).some(h =>
    h.first && todayKey(new Date(h.ts)) === k)).length;
}

function queueFor(filter){
  const now = Date.now();
  const pool = CARDS.filter(filter || (() => true));
  const due = pool.filter(c => c.srs.state !== "new" && c.srs.due <= now)
                  .sort((a, b) => a.srs.due - b.srs.due);
  const fresh = pool.filter(c => c.srs.state === "new")
                    .slice(0, Math.max(0, PREFS.newPerDay - newSeenToday()));
  return due.concat(fresh);
}

function streak(){
  const days = new Set();
  CARDS.forEach(c => (c.history || []).forEach(h => days.add(todayKey(new Date(h.ts)))));
  let n = 0;
  const d = new Date();
  /* today not yet studied should not break a run that is still alive */
  if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(todayKey(d))){ n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- Bank shell --------------------------------------------------- */
let bankTab = "study";
let studyState = null;     // { queue, i, revealed, filter, label }
let editing = null;        // card being edited in the Add/Edit tab

function setBankTab(t){
  bankTab = t;
  $$("#banktabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
  drawBank();
}

function drawBank(){
  releaseUrls();
  const host = $("#bankbody");
  if (!host) return;
  /* §40: while a card is up, hide everything that is not the card */
  const panel = host.closest(".panel");
  if (panel) panel.classList.toggle("studying", bankTab === "study" && !!studyState);
  if (bankTab === "study") drawStudy(host);
  else if (bankTab === "cards") drawCardList(host);
  else drawEditor(host);
  drawBackupNote();
  const n = queueFor().length;
  const badge = $("#bankcount");
  if (badge) badge.textContent = String(n);
}

function drawBackupNote(){
  const el = $("#backupnote");
  if (!el) return;
  const stale = !PREFS.lastExport || (Date.now() - PREFS.lastExport) > 30 * DAY;
  const show = CARDS.length > 0 && stale && !PREFS.hideBackupNote;
  el.classList.toggle("hidden", !show);
  if (show && !el.dataset.wired){
    el.dataset.wired = "1";
    el.querySelector(".x").onclick = () => {
      PREFS.hideBackupNote = true; savePrefs(); drawBackupNote();
    };
  }
}

/* ---------- study -------------------------------------------------------- */
function drawStudy(host){
  const due = queueFor().length;
  const total = CARDS.length;
  const newLeft = Math.max(0, PREFS.newPerDay - newSeenToday());

  if (!studyState){
    const byDeck = {};
    CARDS.forEach(c => {
      const k = `${c.subject} · ${c.deck.module || "No module"}`;
      byDeck[k] = byDeck[k] || { due: 0, total: 0 };
      byDeck[k].total++;
      if (queueFor(x => x.id === c.id).length) byDeck[k].due++;
    });
    const decks = Object.entries(byDeck).sort((a, b) => b[1].due - a[1].due);

    host.innerHTML = `
      <div class="dash">
        <div class="stat"><b>${due}</b><span>due now</span></div>
        <div class="stat"><b>${newLeft}</b><span>new left today</span></div>
        <div class="stat"><b>${studiedToday()}</b><span>reviewed today</span></div>
        <div class="stat"><b>${streak()}</b><span>day streak</span></div>
        <div class="stat"><b>${total}</b><span>cards</span></div>
      </div>
      ${total === 0
        ? `<p class="empty">No cards yet. Mark an answer and save it, or add one under <b>Add card</b>.</p>`
        : due === 0
          ? `<p class="empty">Nothing due. ${CARDS.filter(c=>c.srs.state==="new").length
              ? "You have hit today's new-card limit — raise it below or come back tomorrow."
              : "Everything is scheduled ahead; come back later."}</p>`
          : `<button class="go" id="startstudy">Study ${due} card${due===1?"":"s"}</button>`}

      ${decks.length ? `<div class="decks">${decks.map(([k, v]) => `
        <button class="deck" data-deck="${esc(k)}">
          <span class="dn">${esc(k)}</span>
          <span class="dc ${v.due ? "on" : ""}">${v.due}</span>
          <span class="dt">/ ${v.total}</span>
        </button>`).join("")}</div>` : ""}

      <div class="custom">
        <span class="lbl">Custom study</span>
        <button class="btn" data-cs="starred">Starred</button>
        <button class="btn" data-cs="hard">Difficult</button>
        <button class="btn" data-cs="all">All cards, shuffled</button>
        <label class="npd">New cards a day
          <input type="number" id="npd" min="0" max="200" value="${PREFS.newPerDay}">
        </label>
      </div>`;

    const start = $("#startstudy");
    if (start) start.onclick = () => beginStudy(null, "All due");
    host.querySelectorAll(".deck").forEach(b => b.onclick = () => {
      const k = b.dataset.deck;
      beginStudy(c => `${c.subject} · ${c.deck.module || "No module"}` === k, k);
    });
    host.querySelectorAll("[data-cs]").forEach(b => b.onclick = () => {
      const kind = b.dataset.cs;
      if (kind === "starred") beginStudy(c => c.starred, "Starred", true);
      else if (kind === "hard") beginStudy(c => (c.srs.lapses || 0) >= 2, "Difficult", true);
      else beginStudy(() => true, "All cards", true);
    });
    $("#npd").onchange = e => {
      PREFS.newPerDay = Math.max(0, Math.min(200, +e.target.value || 0));
      savePrefs(); drawBank();
    };
    return;
  }

  drawReviewer(host);
}

/* `ignoreSchedule` powers custom study: take the cards regardless of due date */
function beginStudy(filter, label, ignoreSchedule){
  const pool = ignoreSchedule
    ? shuffleCards(CARDS.filter(filter || (() => true)))
    : queueFor(filter);
  if (!pool.length){ return; }
  studyState = { queue: pool, i: 0, revealed: false, label };
  drawBank();
}

function shuffleCards(a){
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

async function drawReviewer(host){
  const st = studyState;
  if (st.i >= st.queue.length){
    host.innerHTML = `<div class="done">
      <p class="t">Done — ${st.queue.length} card${st.queue.length===1?"":"s"} reviewed.</p>
      <button class="btn" id="backtodash">Back to the dashboard</button></div>`;
    $("#backtodash").onclick = () => { studyState = null; drawBank(); };
    return;
  }
  const c = st.queue[st.i];
  const prev = previewIntervals(c.srs);
  const frontImgs = await imagesHTML(c.front.images, "cardimg");
  const backImgs  = await imagesHTML(c.back.images, "cardimg");

  host.innerHTML = `
    <div class="reviewer ${st.revealed ? "open" : ""}">
      <div class="rhead">
        <span class="pos">${st.i + 1} / ${st.queue.length} · ${esc(st.label)}</span>
        <button class="star ${c.starred ? "on" : ""}" id="rstar" title="Star this card">${c.starred ? "★" : "☆"}</button>
        <button class="btn" id="rquit">Stop</button>
      </div>

      <div class="face front">
        ${c.front.text ? `<div class="ftext">${esc(c.front.text)}</div>` : ""}
        ${frontImgs}
      </div>

      ${st.revealed ? `
        <div class="face back">
          <p class="sec">Answer</p>
          ${c.back.text ? `<div class="ftext">${esc(c.back.text)}</div>` : ""}
          ${backImgs}
          ${!c.back.text && !backImgs ? `<p class="note">This card has no answer yet — edit it under Cards.</p>` : ""}
          ${c.notes ? `<p class="sec">Notes</p><div class="ftext note">${esc(c.notes)}</div>` : ""}
        </div>
        <div class="rate">
          <button data-r="1"><b>Again</b><span>${prev[0]}</span></button>
          <button data-r="2"><b>Hard</b><span>${prev[1]}</span></button>
          <button data-r="3"><b>Good</b><span>${prev[2]}</span></button>
          <button data-r="4"><b>Easy</b><span>${prev[3]}</span></button>
        </div>
        <p class="hint">Keys 1–4</p>`
      : `<button class="go" id="reveal">Show answer</button><p class="hint">Space</p>`}
    </div>`;

  const rev = $("#reveal");
  if (rev) rev.onclick = () => { st.revealed = true; drawBank(); };
  $("#rquit").onclick = () => { studyState = null; drawBank(); };
  $("#rstar").onclick = async () => { c.starred = !c.starred; await putCard(c); drawBank(); };
  host.querySelectorAll(".rate button").forEach(b =>
    b.onclick = () => rate(+b.dataset.r));
}

async function rate(r){
  const st = studyState;
  if (!st || !st.revealed) return;
  const c = st.queue[st.i];
  const first = (c.history || []).length === 0;
  c.srs = schedule(c.srs, r);
  c.history = (c.history || []).concat({ ts: Date.now(), rating: r, interval: c.srs.interval, first });
  await putCard(c);
  /* Again keeps the card in this session, as Anki does */
  if (r === 1) st.queue.push(c);
  st.i += 1;
  st.revealed = false;
  drawBank();
}

document.addEventListener("keydown", e => {
  if (APP.view !== "bank" || bankTab !== "study" || !studyState) return;
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space" && !studyState.revealed){
    e.preventDefault(); studyState.revealed = true; drawBank(); return;
  }
  if (studyState.revealed && ["1","2","3","4"].includes(e.key)){
    e.preventDefault(); rate(+e.key);
  }
});

/* ---------- card browser ------------------------------------------------- */
const listState = { q: "", subject: "", module: "", starred: false, sort: "created" };

function cardMatches(c){
  if (listState.subject && c.subject !== listState.subject) return false;
  if (listState.module && c.deck.module !== listState.module) return false;
  if (listState.starred && !c.starred) return false;
  const q = listState.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [c.front.text, c.back.text, c.notes, c.deck.module,
               (c.deck.iqs || []).join(" "), (c.tags || []).join(" ")].join(" ").toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

function dueLabel(c){
  if (c.srs.state === "new") return "new";
  const ms = c.srs.due - Date.now();
  if (ms <= 0) return "due";
  return ms < DAY ? Math.max(1, Math.round(ms / (60 * MIN))) + "h"
       : Math.round(ms / DAY) + "d";
}

function drawCardList(host){
  const subs = [...new Set(CARDS.map(c => c.subject))].sort();
  const mods = [...new Set(CARDS.filter(c => !listState.subject || c.subject === listState.subject)
                               .map(c => c.deck.module).filter(Boolean))].sort();
  const rows = CARDS.filter(cardMatches);
  rows.sort((a, b) => listState.sort === "due" ? a.srs.due - b.srs.due : b.created - a.created);

  host.innerHTML = `
    <div class="cardbar">
      <input type="search" id="csearch" placeholder="Search questions, answers, notes, tags…" value="${esc(listState.q)}">
      <select id="csub"><option value="">Any subject</option>${subs.map(s =>
        `<option ${s===listState.subject?"selected":""}>${esc(s)}</option>`).join("")}</select>
      <select id="cmod"><option value="">Any module</option>${mods.map(m =>
        `<option ${m===listState.module?"selected":""}>${esc(m)}</option>`).join("")}</select>
      <button class="btn ${listState.starred?"on":""}" id="cstar">★ Starred</button>
      <select id="csort">
        <option value="created" ${listState.sort==="created"?"selected":""}>Newest first</option>
        <option value="due" ${listState.sort==="due"?"selected":""}>Due first</option>
      </select>
    </div>
    <p class="count">${rows.length} of ${CARDS.length} card${CARDS.length===1?"":"s"}</p>
    <div class="ctable">${rows.length ? rows.map(c => `
      <div class="crow" data-id="${esc(c.id)}">
        <span class="cstar ${c.starred?"on":""}" data-star="${esc(c.id)}">${c.starred?"★":"☆"}</span>
        <span class="cfront">
          <b>${esc((c.front.text || "(image only)").slice(0, 110))}</b>
          <i>${esc(c.deck.module || "No module")}${c.deck.iqs?.length ? " · " + esc(c.deck.iqs.length + " IQ") : ""}${c.front.images.length||c.back.images.length ? " · 🖼" : ""}</i>
        </span>
        <span class="cdue ${c.srs.state==="new"?"new":(c.srs.due<=Date.now()?"on":"")}">${dueLabel(c)}</span>
        <button class="btn" data-edit="${esc(c.id)}">Edit</button>
      </div>`).join("") : `<p class="empty">No cards match. Widen the search.</p>`}</div>`;

  $("#csearch").oninput = e => { listState.q = e.target.value; drawCardList(host); };
  $("#csub").onchange = e => { listState.subject = e.target.value; listState.module = ""; drawCardList(host); };
  $("#cmod").onchange = e => { listState.module = e.target.value; drawCardList(host); };
  $("#csort").onchange = e => { listState.sort = e.target.value; drawCardList(host); };
  $("#cstar").onclick = () => { listState.starred = !listState.starred; drawCardList(host); };
  host.querySelectorAll("[data-star]").forEach(el => el.onclick = async () => {
    const c = CARDS.find(x => x.id === el.dataset.star);
    c.starred = !c.starred; await putCard(c); drawCardList(host);
  });
  host.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
    editing = CARDS.find(x => x.id === b.dataset.edit);
    setBankTab("add");
  });
}

/* ---------- editor (Add card, and Edit from the browser) ----------------- */
let draft = null;

function ensureDraft(){
  if (editing){
    draft = JSON.parse(JSON.stringify(editing));
    editing = null;
  }
  if (!draft) draft = blankCard(APP.subject);
  return draft;
}

async function drawEditor(host){
  const c = ensureDraft();
  const isEdit = CARDS.some(x => x.id === c.id);
  const mods = MODULE_LIST(c.subject);
  const frontImgs = await imagesHTML(c.front.images, "thumb");
  const backImgs  = await imagesHTML(c.back.images, "thumb");

  host.innerHTML = `
    <div class="editor">
      <div class="erow">
        <label>Subject
          <select id="esub">${["Chemistry","Physics"].map(s =>
            `<option ${s===c.subject?"selected":""}>${esc(s)}</option>`).join("")}</select>
        </label>
        <label>Module
          <select id="emod"><option value="">— none —</option>${mods.map(m =>
            `<option ${m===c.deck.module?"selected":""}>${esc(m)}</option>`).join("")}</select>
        </label>
      </div>

      <div class="field">
        <label>Inquiry questions <span class="note">— tick any that apply, across modules</span></label>
        <div class="iqpick" id="eiq">${iqPickerHTML(c)}</div>
      </div>

      <div class="field">
        <label for="efront">Front <span class="note">— the question</span></label>
        <div class="inputbox">
          <textarea id="efront" placeholder="Type the question, or paste a screenshot below.">${esc(c.front.text)}</textarea>
          <label class="drop" data-eslot="front">
            <input type="file" accept="image/*" multiple>
            <span class="clip" aria-hidden="true">▤</span> Attach an image — or drop and paste here
          </label>
        </div>
        <div class="thumbs">${frontImgs}${c.front.images.map((_, i) =>
          `<button class="tx" data-rm="front:${i}" title="Remove image">×</button>`).join("")}</div>
      </div>

      <div class="field">
        <label for="eback">Back <span class="note">— the correct answer</span></label>
        <div class="inputbox">
          <textarea id="eback" placeholder="Type the answer, or paste the worked solution below.">${esc(c.back.text)}</textarea>
          <label class="drop" data-eslot="back">
            <input type="file" accept="image/*" multiple>
            <span class="clip" aria-hidden="true">▤</span> Attach an image — or drop and paste here
          </label>
        </div>
        <div class="thumbs">${backImgs}${c.back.images.map((_, i) =>
          `<button class="tx" data-rm="back:${i}" title="Remove image">×</button>`).join("")}</div>
      </div>

      <details class="optional">
        <summary>Notes and tags <span class="note">— optional</span></summary>
        <div class="field">
          <textarea id="enotes" placeholder="Anything to remind yourself when the answer appears.">${esc(c.notes)}</textarea>
          <input id="etags" type="text" placeholder="Tags, comma separated — e.g. Trial, 2024, James Ruse"
                 value="${esc((c.tags||[]).join(", "))}" style="margin-top:8px">
        </div>
      </details>

      <div class="ebtns">
        <button class="go" id="esave">${isEdit ? "Save changes" : "Add card"}</button>
        ${isEdit ? `<button class="btn danger" id="edel">Delete card</button>` : ""}
        <button class="btn" id="ereset">${isEdit ? "Cancel" : "Clear"}</button>
      </div>
      ${isEdit && c.history?.length ? `<p class="hist">${c.history.length} review${c.history.length===1?"":"s"} ·
        ${c.srs.state === "new" ? "not yet studied" : "next in " + dueLabel(c)} ·
        ease ${c.srs.ease.toFixed(2)} · ${c.srs.lapses || 0} lapse${(c.srs.lapses||0)===1?"":"s"}
        <br><span class="note">Editing keeps this history.</span></p>` : ""}
    </div>`;

  wireEditor(host, c, isEdit);
}

function iqPickerHTML(c){
  const subject = c.subject;
  const mods = MODULE_LIST(subject);
  if (!mods.length) return `<p class="note">No syllabus loaded.</p>`;
  return mods.map(m => `
    <div class="iqmod"><span class="mn">${esc(m)}</span>
      ${IQ_LIST(subject, m).map(({ topic, iq }) => `
        <label class="iqopt"><input type="checkbox" value="${esc(iq)}"
          ${(c.deck.iqs || []).includes(iq) ? "checked" : ""}>
          <span>${esc(topic)}</span></label>`).join("")}
    </div>`).join("");
}

function wireEditor(host, c, isEdit){
  $("#esub").onchange = e => { c.subject = e.target.value; c.deck.module = ""; c.deck.iqs = []; drawBank(); };
  $("#emod").onchange = e => { c.deck.module = e.target.value; };
  $("#efront").oninput = e => { c.front.text = e.target.value; };
  $("#eback").oninput  = e => { c.back.text  = e.target.value; };
  const notes = $("#enotes"); if (notes) notes.oninput = e => { c.notes = e.target.value; };
  const tags = $("#etags");
  if (tags) tags.oninput = e => {
    c.tags = e.target.value.split(",").map(t => t.trim()).filter(Boolean);
  };
  host.querySelectorAll("#eiq input").forEach(cb => cb.onchange = () => {
    c.deck.iqs = Array.from(host.querySelectorAll("#eiq input:checked")).map(x => x.value);
  });

  host.querySelectorAll("[data-eslot]").forEach(zone => {
    const slot = zone.dataset.eslot;
    const input = zone.querySelector("input[type=file]");
    input.onchange = async e => {
      for (const f of e.target.files) c[slot].images.push(await storeBlob(f));
      input.value = ""; drawBank();
    };
    ["dragenter","dragover"].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); zone.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev => zone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", async e => {
      for (const f of e.dataTransfer?.files || []) if (f.type.startsWith("image/"))
        c[slot].images.push(await storeBlob(f));
      drawBank();
    });
  });

  host.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
    const [slot, i] = b.dataset.rm.split(":");
    const ref = c[slot].images[+i];
    if (ref?.kind === "blob") await dbDel("blobs", ref.id).catch(() => {});
    c[slot].images.splice(+i, 1);
    drawBank();
  });

  $("#esave").onclick = async () => {
    if (!c.front.text.trim() && !c.front.images.length){
      $("#efront").focus();
      return;
    }
    await putCard(c);
    draft = null;
    if (isEdit){ setBankTab("cards"); }
    else {
      /* stay put so the next card can be typed straight away */
      drawBank();
      const t = $("#efront"); if (t) t.focus();
    }
  };
  $("#ereset").onclick = () => { draft = null; setBankTab(isEdit ? "cards" : "add"); };
  const del = $("#edel");
  if (del) del.onclick = async () => {
    await removeCard(c); draft = null; setBankTab("cards");
  };
}

/* paste a screenshot straight into whichever side was last focused */
document.addEventListener("paste", async e => {
  if (APP.view !== "bank" || bankTab !== "add" || !draft) return;
  const imgs = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
  if (!imgs.length) return;
  e.preventDefault();
  const active = document.activeElement?.id;
  const slot = active === "eback" ? "back" : "front";
  for (const f of imgs) draft[slot].images.push(await storeBlob(f));
  drawBank();
});

/* ---------- export / import ---------------------------------------------
   One file holds cards, review history and the uploaded images, so a laptop
   collection can be carried to a phone. Repo-referenced images are paths and
   need no copying. Import merges on card id and keeps whichever side has the
   later review, so importing never silently discards progress made on the
   device you are importing into. */
const blobToDataURL = b => new Promise(res => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.readAsDataURL(b);
});

async function exportCards(){
  const blobs = await dbAll("blobs");
  const images = {};
  for (const b of blobs) images[b.id] = await blobToDataURL(b.blob);
  const payload = { format: "hsc-cards", version: 1, exported: Date.now(),
                    cards: CARDS, images };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `hsc-flashcards-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  PREFS.lastExport = Date.now(); PREFS.hideBackupNote = false; savePrefs();
  drawBank();
}

async function importCards(file){
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return { error: "That file is not valid JSON." }; }
  if (data.format !== "hsc-cards" || !Array.isArray(data.cards))
    return { error: "That does not look like a flashcard export from this app." };

  for (const [id, dataUrl] of Object.entries(data.images || {})){
    if (await dbGet("blobs", id)) continue;
    const blob = await (await fetch(dataUrl)).blob();
    await dbPut("blobs", { id, blob });
  }
  let added = 0, updated = 0;
  for (const inc of data.cards){
    const mine = CARDS.find(c => c.id === inc.id);
    if (!mine){ await putCard(inc); added++; continue; }
    const incLast = (inc.history || []).length ? inc.history[inc.history.length-1].ts : 0;
    const myLast  = (mine.history || []).length ? mine.history[mine.history.length-1].ts : 0;
    if (incLast > myLast){ await putCard(inc); updated++; }
  }
  await loadCards();
  drawBank();
  return { added, updated, total: data.cards.length };
}

/* ---------- the save panel the marker shows after a mark ------------------ */
/* payload: { subject, front:{text,images}, back:{text,images}, notes, tags, iqs, module } */
function renderSavePanel(host, payload){
  const c = blankCard(payload.subject);
  c.front = payload.front;
  c.back = payload.back;
  c.notes = payload.notes || "";
  c.tags = payload.tags || [];
  c.deck.module = payload.module && MODULE_LIST(c.subject).includes(payload.module) ? payload.module : "";
  c.deck.iqs = payload.iqs || [];

  const mods = MODULE_LIST(c.subject);
  host.innerHTML = `
    <div class="savecard">
      <p class="t">Add this to your flashcards</p>
      <p class="d">${payload.backNote || "The question goes on the front, the correct answer on the back."}</p>
      <div class="erow">
        <label>Module
          <select id="svmod"><option value="">— none —</option>${mods.map(m =>
            `<option ${m===c.deck.module?"selected":""}>${esc(m)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="iqpick" id="sviq">${iqPickerHTML(c)}</div>
      <div class="ebtns">
        <button class="btn primary" id="svsave">Add flashcard</button>
      </div>
    </div>`;

  $("#svmod").onchange = e => { c.deck.module = e.target.value; };
  host.querySelectorAll("#sviq input").forEach(cb => cb.onchange = () => {
    c.deck.iqs = Array.from(host.querySelectorAll("#sviq input:checked")).map(x => x.value);
  });
  $("#svsave").onclick = async () => {
    await putCard(c);
    host.innerHTML = `<div class="savecard saved">
      <p class="t">Added to your flashcards</p>
      <p class="d" style="margin:0">It is scheduled to come round under <b>Bank → Study</b>.</p></div>`;
    drawBank();
  };
}

/* ---------- boot --------------------------------------------------------- */
async function initCards(){
  try {
    await loadCards();
    const n = await migrateLegacy();
    if (n) await loadCards();
    if (n) {
      const note = $("#migrated");
      if (note){
        note.textContent = `${n} saved answer${n===1?"":"s"} from your old bank ${n===1?"has":"have"} been turned into flashcards.`;
        note.classList.remove("hidden");
      }
    }
  } catch (err){
    const host = $("#bankbody");
    if (host) host.innerHTML = `<p class="empty">Flashcards need browser storage, which this browser has blocked
      (private mode can do this). Everything else in the app still works.</p>`;
    return;
  }

  $$("#banktabs button").forEach(b => b.onclick = () => { if (b.dataset.tab !== "add") draft = null; setBankTab(b.dataset.tab); });
  $("#cexport").onclick = exportCards;
  $("#cimport").onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = await importCards(f);
    const msg = $("#importmsg");
    msg.textContent = r.error ? r.error
      : `Imported: ${r.added} new, ${r.updated} updated, out of ${r.total}.`;
    msg.classList.remove("hidden");
    e.target.value = "";
  };
  drawBank();
}

/* the reviewer counts and the due badge follow the subject, so redraw on both */
APP.onView.push(v => { if (v === "bank") drawBank(); else releaseUrls(); });

window.renderSavePanel = renderSavePanel;
/* marker.js hands over File objects the user attached; they become blobs here */
window.storeUploaded = storeBlob;
window.cardsReady = initCards();
