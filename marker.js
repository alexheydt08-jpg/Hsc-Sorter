/* ==========================================================================
   AI marker and the bank of everything marked.

   There is no server: this calls the Anthropic API straight from the browser
   with a key you paste in, kept in this browser's localStorage. No key is ever
   committed or built into the published page — each person brings their own,
   so nobody can spend anyone else's credit.
   ========================================================================== */
"use strict";

const MAX_TOKENS = 4000;
const MAX_FILE_MB = 28;
const KEY_STORAGE = "hsc-marker-key";
const BANK_KEY = "hsc-marker-bank";
const UNSET = "Not set";

/* Modules as named in the NESA Stage 6 syllabuses. Adding a subject means
   adding an entry here and a button to the subject group in the header. */
const MODULES = {
  Physics: [
    "Module 1: Kinematics",
    "Module 2: Dynamics",
    "Module 3: Waves and Thermodynamics",
    "Module 4: Electricity and Magnetism",
    "Module 5: Advanced Mechanics",
    "Module 6: Electromagnetism",
    "Module 7: The Nature of Light",
    "Module 8: From the Universe to the Atom"
  ],
  Chemistry: [
    "Module 1: Properties and Structure of Matter",
    "Module 2: Introduction to Quantitative Chemistry",
    "Module 3: Reactive Chemistry",
    "Module 4: Drivers of Reactions",
    "Module 5: Equilibrium and Acid Reactions",
    "Module 6: Acid/base Reactions",
    "Module 7: Organic Chemistry",
    "Module 8: Applying Chemical Ideas"
  ]
};

const SUBJECT_CONVENTIONS = {
  Physics:
    "correct use of formulas, correct units carried through the working, correct " +
    "significant figures, clear identification of physical quantities and variables, " +
    "logical step-by-step working for calculations, and correct application of physics " +
    "concepts (forces, energy, motion, electricity, waves, modern physics) relevant to " +
    "the syllabus dot point being tested",
  Chemistry:
    "correct chemical equations (balanced, with states of matter where relevant), " +
    "correct IUPAC naming and formulas, correct significant figures and units, clear " +
    "identification of the relevant chemical concepts (equilibrium, acids and bases, " +
    "redox, organic chemistry, energy), and the terminology NESA expects"
};

function systemPrompt(subject, hasGuidelines){
  const all = Object.keys(SUBJECT_CONVENTIONS);
  const others = all.filter(s => s !== subject);
  const conventions = all.map(s => `- ${s}: ${SUBJECT_CONVENTIONS[s]}.`).join("\n");

  const criteriaStep = hasGuidelines
    ? `2. Break the supplied marking guidelines into individual mark-worthy points, and mark against those points exactly as written. Do not substitute your own criteria where the guidelines are explicit, and do not relax a criterion because the student came close to it.`
    : `2. No official marking guidelines were supplied. Construct a marking breakdown yourself from standard NESA conventions for this subject and question type — for example, one mark per correct linked idea or step in a 3-mark "explain" question, or marks for formula, substitution and answer-with-units in a calculation. Set the criteria at the standard a real HSC marking guideline would demand, not at a standard the answer in front of you happens to meet. State the breakdown you used so the student can see what you marked against.`;

  return `You are an experienced HSC (NSW Higher School Certificate) marker. You currently mark these subjects: ${all.join(", ")}.

The subject for this specific task is: ${subject}

Note: this marker is being actively developed and more HSC subjects will be added in future (e.g. Biology, Mathematics). For now, mark only according to the conventions of ${subject} — do not blend in conventions from ${others.join(", ") || "other subjects"} or any other subject.

You mark strictly and fairly according to official NESA HSC marking conventions for ${subject}, awarding marks incrementally for specific criteria met rather than on overall impression, the way real HSC markers do. This includes subject-specific expectations such as:

${conventions}

The material may arrive in several forms. A single attached file may contain both the question and the student's response — in that case, work out which part is the printed question and which is the student's own writing, and mark only the student's writing. A whole exam paper may be attached for context, with the specific question identified separately. Handwriting may be untidy; be generous in *deciphering* what the student wrote, and only treat something as absent if you genuinely cannot find it on the page. Being generous about legibility is not the same as being generous about marks — decipher charitably, then mark strictly on what the words actually say.

Your job for every response:
1. Identify how many marks the question is worth, from the question itself or from the marking guidelines. If the mark value is genuinely not stated anywhere, infer it from the depth the question demands and say so in your feedback.
${criteriaStep}
3. Assess the student's answer against each point of that breakdown, applying the strictness rules below.
4. Award partial marks only where the answer genuinely satisfies part of the criteria.
5. Give a total mark out of the maximum.
6. Give clear, constructive written feedback: what was correct, what was missing or wrong, and specifically what would have earned the remaining marks. Write it the way a real HSC marker's comment reads — direct, specific, tied to the criteria, not generic praise or criticism.

Mark strictly. Real HSC markers do not give the benefit of the doubt, and a mark that flatters the student now costs them in the actual exam. Apply these rules:

- Award a mark only when the answer explicitly states the required idea. Do not award marks for understanding you infer the student probably has but did not write down. If it is not on the page, it did not earn the mark.
- Vague, hand-waving, or imprecise wording does not earn a mark that calls for a specific concept or term. NESA expects correct technical terminology, and an approximate phrase in place of the right term is not worth the mark.
- Honour the question's verb. "Explain" requires cause and effect, not just a description. "Analyse", "assess" and "evaluate" require a judgement supported by reasoning. "Justify" requires the reasoning to be made explicit. An answer that only describes when the question said explain has not met the criterion, however accurate the description is.
- In calculations, penalise missing or incorrect units, incorrect significant figures, and absent working. A correct final number with no working does not earn the full allocation where the marks are for method.
- Where the answer is internally contradictory, or a correct statement sits beside an incorrect one that undermines it, do not award the mark. Do not let a correct fragment rescue a confused response.
- Do not award marks for restating the question, for generic preamble, or for content that is true but irrelevant to what was asked.
- Where the answer sits genuinely on the boundary between two marks, award the lower one.

Being strict is not being harsh in tone. Keep the written feedback fair, specific and encouraging about what the student can fix — the strictness belongs in the marks, not in how you speak to them.

Respond with a single valid JSON object and nothing else. No preamble, no markdown fences. Every numeric field must be a number, not a string.

{
  "subject": "string",
  "max_marks": number,
  "marking_breakdown": [
    { "criterion": "what earns this mark", "marks_available": number }
  ],
  "marks_awarded": [
    { "criterion": "matches a criterion above", "marks_given": number, "reason": "why" }
  ],
  "total_mark": number,
  "feedback": "overall constructive feedback in HSC marker style",
  "improvement_tips": ["string"]
}

Keep the feedback and tips concise enough that the whole JSON object fits comfortably in your reply and is never cut off mid-object.

If the guidelines are unclear, incomplete, or contradict the question, say so inside "feedback" rather than guessing silently.

If the answer is blank, illegible, or clearly does not attempt the question, award 0 and explain why in "feedback" rather than guessing at intent.`;
}

/* ---------- state -------------------------------------------------------- */
let mode = "split";
let busy = false;
let controller = null;
let lastResult = null;
let fromSorter = null;   // the sorter record a question was sent from, if any

const SLOTS = ["question","answer","combined","paper","paperanswer","guidelines"];
const files = Object.fromEntries(SLOTS.map(s => [s, []]));

/* ---------- API key ------------------------------------------------------ */
const readKey = () => { try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; } };
const getKey  = () => ($("#key").value || readKey()).trim();

function paintKey(){
  const saved = readKey();
  if (saved && !$("#key").value) $("#key").value = saved;
  $("#keyforget").classList.toggle("hidden", !saved);
  $("#keynote").textContent = saved
    ? "A key is saved in this browser. It is never committed or built into the published page — add it again on each device you use."
    : "Stored in this browser only — never in the repository or the published page. Get a key at console.anthropic.com and set a monthly spend limit while you're there.";
}
$("#keysave").onclick = () => {
  const v = $("#key").value.trim();
  try { v ? localStorage.setItem(KEY_STORAGE, v) : localStorage.removeItem(KEY_STORAGE); } catch {}
  paintKey();
};
$("#keyforget").onclick = () => {
  try { localStorage.removeItem(KEY_STORAGE); } catch {}
  $("#key").value = "";
  paintKey();
};
paintKey();

/* ---------- mode tabs ---------------------------------------------------- */
$$(".modes button").forEach(b => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  $$(".modes button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  $$("[data-pane]").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== mode));
}));

/* ---------- files: dedupe, size guard, drag/drop, paste ------------------ */
const fmtSize = b => b < 1048576 ? Math.max(1, Math.round(b/1024)) + " KB"
                                 : (b/1048576).toFixed(1) + " MB";

function addFiles(slot, list){
  const rejected = [];
  for (const f of list){
    const ok = f.type === "application/pdf" || f.type.startsWith("image/");
    if (!ok){ rejected.push(`${f.name} is not an image or PDF`); continue; }
    if (f.size > MAX_FILE_MB*1048576){ rejected.push(`${f.name} is over ${MAX_FILE_MB} MB`); continue; }
    const dup = files[slot].some(x => x.name===f.name && x.size===f.size && x.lastModified===f.lastModified);
    if (!dup) files[slot].push(f);
  }
  drawFiles(slot);
  if (rejected.length) showError("Some files were not added", rejected.join(". ") + ".");
}

function drawFiles(slot){
  const ul = document.querySelector(`[data-list="${slot}"]`);
  if (!ul) return;
  ul.textContent = "";
  files[slot].forEach((f, i) => {
    const li = document.createElement("li");
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = f.name;
    const sz = document.createElement("span"); sz.className = "sz"; sz.textContent = fmtSize(f.size);
    const rm = document.createElement("button");
    rm.type = "button"; rm.textContent = "×";
    rm.setAttribute("aria-label", `Remove ${f.name}`);
    rm.addEventListener("click", e => { e.preventDefault(); files[slot].splice(i,1); drawFiles(slot); });
    li.append(nm, sz, rm);
    ul.appendChild(li);
  });
}

$$(".drop").forEach(zone => {
  const slot = zone.dataset.slot;
  const input = zone.querySelector("input[type=file]");
  input.addEventListener("change", e => { addFiles(slot, e.target.files); input.value = ""; });
  ["dragenter","dragover"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add("over");
  }));
  ["dragleave","drop"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove("over");
  }));
  zone.addEventListener("drop", e => { if (e.dataTransfer?.files?.length) addFiles(slot, e.dataTransfer.files); });
});

document.addEventListener("paste", e => {
  if (APP.view !== "marker") return;
  const imgs = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
  if (!imgs.length) return;
  const el = document.activeElement;
  const near = el?.closest?.("[data-pane], .field");
  let slot = near?.querySelector?.(".drop")?.dataset.slot;
  if (!slot) slot = mode === "combined" ? "combined" : mode === "paper" ? "paperanswer" : "answer";
  e.preventDefault();
  addFiles(slot, imgs);
});

function fileToBlock(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const data = s.slice(s.indexOf(",") + 1);
      if (!data) return reject(new Error(`${file.name} appears to be empty.`));
      resolve(file.type === "application/pdf"
        ? { type:"document", source:{ type:"base64", media_type:"application/pdf", data } }
        : { type:"image",    source:{ type:"base64", media_type:file.type,        data } });
    };
    r.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

/* ==========================================================================
   HAND-OFF FROM BROWSE
   The sorter already holds the exact question image and the official NESA
   marking guidelines, so sending a question here attaches both — the marker
   then marks against the real criteria rather than inferring its own.
   ========================================================================== */
async function pathToFile(path){
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  const blob = await res.blob();
  return new File([blob], path.split("/").pop(), { type: blob.type || "image/webp" });
}

async function sendToMarker(rec){
  setView("marker");
  mode = "split";
  $$(".modes button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.mode === "split")));
  $$("[data-pane]").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== "split"));

  if (rec.subject !== APP.subject) setSubject(rec.subject);

  /* clear anything left from a previous question, keep the user's own answer */
  ["question","guidelines"].forEach(s => { files[s].length = 0; drawFiles(s); });

  fromSorter = rec;
  const label = `${rec.year} HSC ${rec.subject} · Question ${rec.questionNumber} · ${rec.marks} mark${rec.marks===1?"":"s"}`;
  const box = $("#fromsorter");
  box.classList.remove("hidden");
  box.innerHTML = `<button class="x" id="fsx" aria-label="Detach this question">×</button>
    <b>From Browse — ${esc(label)}</b>
    <span id="fsstat">Attaching the question and its official marking guidelines…</span>`;
  $("#fsx").onclick = detachSorter;

  $("#mq").value = `${rec.questionText || ""}\n\n(${rec.marks} mark${rec.marks===1?"":"s"})`.trim();

  let gl = "";
  if (rec.section === "I" && rec.answer) gl = `Official answer key: the correct option is ${rec.answer}.`;
  if (rec.mgText) gl = (gl ? gl + "\n\n" : "") + rec.mgText;
  $("#g").value = gl;

  /* attach the real images so the marker sees the paper, not just OCR text */
  const stat = $("#fsstat");
  try {
    for (const p of (rec.questionImages || [])) files.question.push(await pathToFile(p));
    for (const p of (rec.mgImages || []))       files.guidelines.push(await pathToFile(p));
    drawFiles("question"); drawFiles("guidelines");
    stat.textContent = "The question image and the official NESA marking guidelines are attached below. Type your answer and mark it.";
  } catch {
    stat.textContent = "Question text and guidelines are filled in below. The images could not be attached — the text is enough to mark against.";
  }
  $("#ma").focus();
}
window.sendToMarker = sendToMarker;

function detachSorter(){
  fromSorter = null;
  $("#fromsorter").classList.add("hidden");
  $("#fromsorter").innerHTML = "";
}

/* ---------- message ------------------------------------------------------ */
async function attach(blocks, heading, slot, text, fallback){
  const has = files[slot].length > 0;
  const t = (text || "").trim();
  if (has){
    blocks.push({ type:"text", text:`${heading}\n[Attached below]` });
    for (const f of files[slot]) blocks.push(await fileToBlock(f));
    if (t) blocks.push({ type:"text", text:`Also given as text:\n${t}` });
  } else if (t){
    blocks.push({ type:"text", text:`${heading}\n${t}` });
  } else if (fallback){
    blocks.push({ type:"text", text:`${heading}\n${fallback}` });
  }
}

const hasGuidelines = () => !!($("#g").value.trim() || files.guidelines.length);

async function buildContent(){
  const blocks = [{ type:"text", text:`Subject: ${APP.subject}` }];

  if (mode === "combined"){
    const which = $("#cnote").value.trim();
    blocks.push({ type:"text", text:
      "The file below contains BOTH the question and the student's response. Identify which is the printed question and which is the student's own work, and mark only the student's work." +
      (which ? `\nMark this question specifically: ${which}` : "") });
    for (const f of files.combined) blocks.push(await fileToBlock(f));

  } else if (mode === "paper"){
    blocks.push({ type:"text", text:"EXAM PAPER:\n[Attached below]" });
    for (const f of files.paper) blocks.push(await fileToBlock(f));
    const qn = $("#qn").value.trim(), hint = $("#qhint").value.trim();
    blocks.push({ type:"text", text:
      `QUESTION TO MARK:\n${qn ? `Question ${qn}` : "See the answer below and locate the matching question."}${hint ? `\n${hint}` : ""}` });
    await attach(blocks, "STUDENT'S ANSWER:", "paperanswer", $("#pa").value, "Not provided.");

  } else {
    await attach(blocks, "QUESTION:", "question", $("#mq").value, "Not provided.");
    await attach(blocks, "STUDENT'S ANSWER:", "answer", $("#ma").value, "Not provided.");
  }

  await attach(blocks, "MARKING GUIDELINES:", "guidelines", $("#g").value,
    "None supplied. Build your own HSC-style breakdown and state it.");

  blocks.push({ type:"text", text:"Mark this response according to your instructions. Return the JSON only." });
  return blocks;
}

/* ---------- API ---------------------------------------------------------- */
async function callApi(key, model, content, signal){
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", signal,
      headers:{
        "content-type":"application/json",
        "x-api-key":key,
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true"
      },
      body: JSON.stringify({
        model, max_tokens: MAX_TOKENS,
        system: systemPrompt(APP.subject, hasGuidelines()),
        messages:[{ role:"user", content }]
      })
    });
  } catch (e){
    if (e.name === "AbortError") throw e;
    throw new Error("Could not reach the API. Check your internet connection, then mark again.");
  }

  if (!res.ok){
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    if (res.status === 401) throw new Error("That key was rejected. Check it is current and has not been revoked.");
    if (res.status === 403) throw new Error("That key is not permitted to use this model. Try a different model.");
    if (res.status === 429) throw new Error("Rate limit reached. Wait a moment, then mark again.");
    if (res.status === 413) throw new Error("The attachments are too large. Remove a file or use a smaller scan.");
    if (res.status >= 500)  throw new Error("The API is having trouble right now. Try again shortly.");
    if (/credit|balance/i.test(detail)) throw new Error("This account has no credit left. Top it up in the Anthropic Console.");
    throw new Error(detail || `The API returned ${res.status}.`);
  }

  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  if (!text) throw new Error("The API replied with nothing. Try marking again.");
  if (data.stop_reason === "max_tokens"){
    const e = new Error("The reply was cut off before it finished. Try a shorter answer or fewer attachments.");
    e.raw = text; throw e;
  }
  return text;
}

/* ---------- parse: tolerant of fences, prose, string numbers ------------- */
const num = v => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g,"")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseResult(raw){
  let s = raw.trim();
  if (s.startsWith("```")){
    s = s.slice(s.indexOf("\n") + 1);
    if (s.trimEnd().endsWith("```")) s = s.trimEnd().slice(0, -3);
    s = s.trim();
  }
  let obj = null;
  try { obj = JSON.parse(s); } catch {}
  if (!obj){
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a !== -1 && b > a){ try { obj = JSON.parse(s.slice(a, b+1)); } catch {} }
  }
  if (!obj || typeof obj !== "object"){
    const truncated = s.includes("{") && !s.trimEnd().endsWith("}");
    const e = new Error(truncated
      ? "The reply was cut off before it finished. Try marking again."
      : "The marker's reply was not in the expected format. Try marking again.");
    e.raw = raw; throw e;
  }
  return normalise(obj);
}

function normalise(o){
  const awarded = Array.isArray(o.marks_awarded) ? o.marks_awarded : [];
  const breakdown = Array.isArray(o.marking_breakdown) ? o.marking_breakdown : [];

  const rows = awarded.map(m => ({
    criterion: String(m?.criterion ?? "").trim() || "Unnamed criterion",
    given: num(m?.marks_given) ?? 0,
    available: num(m?.marks_available),
    reason: String(m?.reason ?? "").trim()
  }));

  rows.forEach(r => {
    if (r.available == null){
      const match = breakdown.find(b => String(b?.criterion ?? "").trim() === r.criterion);
      r.available = num(match?.marks_available) ?? null;
    }
  });

  let max = num(o.max_marks);
  if (max == null || max <= 0){
    const fromBreakdown = breakdown.reduce((t,b) => t + (num(b?.marks_available) ?? 0), 0);
    const fromRows = rows.reduce((t,r) => t + (r.available ?? 1), 0);
    max = fromBreakdown > 0 ? fromBreakdown : (fromRows > 0 ? fromRows : null);
  }

  let total = num(o.total_mark);
  if (total == null) total = rows.reduce((t,r) => t + r.given, 0);
  if (max != null) total = Math.min(Math.max(total, 0), max);

  const tips = Array.isArray(o.improvement_tips)
    ? o.improvement_tips.map(t => String(t).trim()).filter(Boolean)
    : (typeof o.improvement_tips === "string" && o.improvement_tips.trim() ? [o.improvement_tips.trim()] : []);

  return {
    subject: String(o.subject || APP.subject),
    max, total, rows, tips,
    feedback: String(o.feedback ?? "").trim(),
    inferred: !hasGuidelines()
  };
}

/* ---------- render ------------------------------------------------------- */
const out = $("#out");

function showBusy(){
  $("#copy").classList.add("hidden");
  out.innerHTML = `<div class="load"><span class="dot"></span>Reading the response against the criteria…</div>`;
}

function showError(title, detail, raw){
  $("#copy").classList.add("hidden");
  out.innerHTML =
    `<div class="err"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</div>` +
    (raw ? `<div class="raw">${esc(raw)}</div>` : "");
}

function showResult(r){
  lastResult = r;
  const rows = r.rows.map(m => {
    const cls = m.available != null && m.given > 0 && m.given < m.available ? "part"
              : m.given > 0 ? "won" : "";
    const label = m.available != null ? `${m.given}/${m.available}` : String(m.given);
    return `<li>
      <div class="mk ${cls}">${esc(m.given)}</div>
      <div class="txt"><b>${esc(m.criterion)}${m.available != null ? ` <span class="note">(${esc(label)})</span>` : ""}</b>
      ${m.reason ? `<span>${esc(m.reason)}</span>` : ""}</div>
    </li>`;
  }).join("");

  out.innerHTML = `
    <div class="tally">
      <span class="n">${esc(r.total)}</span>
      <span class="of">/ ${r.max != null ? esc(r.max) : "?"}</span>
      <span class="who">${esc(r.subject)}${fromSorter ? `<br>${esc(fromSorter.year)} HSC · Q${esc(fromSorter.questionNumber)}` : ""}</span>
    </div>
    ${r.inferred ? `<p class="caveat">Marked without official guidelines — the breakdown below was inferred from standard HSC conventions. Send a question from Browse and its real NESA guidelines come with it.</p>` : `<div style="height:14px"></div>`}
    ${rows ? `<p class="sec">Mark by mark</p><ul class="crit">${rows}</ul>` : ""}
    ${r.feedback ? `<p class="sec">Marker's comment</p><div class="comment">${esc(r.feedback)}</div>` : ""}
    ${r.tips.length ? `<p class="sec">To pick up the remaining marks</p><ul class="tips">${r.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    ${flagBlock(r)}
  `;
  fillModules($("#fmodsel"), r.subject in MODULES ? r.subject : APP.subject, false);
  /* if it came from Browse we already know the module — preselect it */
  if (fromSorter?.tags?.length){
    const want = fromSorter.tags[0].module.toLowerCase();
    const opt = Array.from($("#fmodsel").options).find(o => o.value.toLowerCase() === want);
    if (opt) $("#fmodsel").value = opt.value;
  }
  $("#fsave").addEventListener("click", () => saveToBank(r));
  $("#copy").classList.remove("hidden");
}

/* ==========================================================================
   BANK
   ========================================================================== */
let bank = [];
let memoryOnly = false;

const store = {
  read(){
    try { const v = localStorage.getItem(BANK_KEY); return v ? JSON.parse(v) : []; }
    catch { memoryOnly = true; return []; }
  },
  write(data){
    try { localStorage.setItem(BANK_KEY, JSON.stringify(data)); return true; }
    catch { memoryOnly = true; return false; }
  }
};

function saveBank(){ store.write(bank); drawCount(); }
function drawCount(){ $("#bankcount").textContent = String(bank.length); }

function fillModules(select, subject, includeAll){
  if (!select) return;
  select.textContent = "";
  const add = (v, label) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = label; select.appendChild(o);
  };
  if (includeAll) add("", "All modules");
  (MODULES[subject] || []).forEach(m => add(m, m));
  add(UNSET, UNSET);
}

function currentQuestionText(){
  if (fromSorter)
    return `${fromSorter.year} HSC ${fromSorter.subject} Q${fromSorter.questionNumber} — ${(fromSorter.questionText||"").slice(0,150)}`.trim();
  if (mode === "combined")
    return $("#cnote").value.trim() || (files.combined[0]?.name ? `From ${files.combined[0].name}` : "Attached file");
  if (mode === "paper"){
    const qn = $("#qn").value.trim(), h = $("#qhint").value.trim();
    return [qn && `Question ${qn}`, h].filter(Boolean).join(" — ") || "From attached paper";
  }
  return $("#mq").value.trim() || (files.question[0]?.name ? `Attached: ${files.question[0].name}` : "Attached question");
}

function currentAnswerText(){
  const t = (mode === "paper" ? $("#pa").value : mode === "combined" ? "" : $("#ma").value).trim();
  if (t) return t;
  const slot = mode === "paper" ? "paperanswer" : mode === "combined" ? "combined" : "answer";
  return files[slot][0]?.name ? `Attached: ${files[slot].map(f => f.name).join(", ")}` : "";
}

function flagBlock(r){
  const full = r.max != null && r.total >= r.max;
  return `<div class="flag" id="flag">
    <p class="t">${full ? "Full marks — save it anyway?" : "Dropped marks here"}</p>
    <p class="d">${full
      ? "Keep it in the bank if it is worth coming back to."
      : "Pick the module and this goes into your bank to redo later."}</p>
    <div class="pick">
      <select id="fmodsel" aria-label="Module"></select>
      <button type="button" class="btn" id="fsave">Save to bank</button>
    </div>
  </div>`;
}

function saveToBank(r){
  bank.unshift({
    id: String(Date.now()) + Math.random().toString(36).slice(2,7),
    ts: Date.now(),
    subject: r.subject || APP.subject,
    module: $("#fmodsel")?.value || UNSET,
    total: r.total, max: r.max,
    question: currentQuestionText(),
    answer: currentAnswerText(),
    feedback: r.feedback,
    tips: r.tips,
    rows: r.rows,
    source: fromSorter ? { id: fromSorter.id, year: fromSorter.year, q: fromSorter.questionNumber } : null
  });
  saveBank();
  const el = $("#flag");
  if (el){
    el.classList.add("saved");
    el.innerHTML = `<p class="t">Saved to your bank</p><p class="d" style="margin:0">Find it under Bank, filtered by subject and module.</p>`;
  }
  drawBank();
}

function drawBank(){
  const list = $("#banklist");
  const fs = $("#fsub").value, fm = $("#fmod").value;
  const shownEntries = bank.filter(e => (!fs || e.subject === fs) && (!fm || e.module === fm));

  list.textContent = "";

  if (!bank.length){
    list.innerHTML = `<p class="empty">Nothing banked yet. Whenever a response drops marks, save it here and it stacks up into a set of questions worth redoing.</p>`;
    return;
  }
  if (!shownEntries.length){
    list.innerHTML = `<p class="empty">No questions match this filter. Widen it to see the rest of your bank.</p>`;
    return;
  }

  shownEntries.forEach(e => {
    const wrap = document.createElement("div");
    wrap.className = "entry";
    const cls = e.max != null && e.total >= e.max ? "won"
              : e.max != null && e.total > 0 ? "part" : "";
    const when = new Date(e.ts).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" });

    const top = document.createElement("button");
    top.type = "button"; top.className = "top";
    top.setAttribute("aria-expanded", "false");
    top.innerHTML = `
      <span class="score ${cls}">${esc(e.total)}/${e.max != null ? esc(e.max) : "?"}</span>
      <span class="mid">
        <span class="qt">${esc(e.question)}</span>
        <span class="meta">${esc(e.subject)} · ${esc(e.module)} · ${esc(when)}</span>
      </span>
      <span class="chev">▾</span>`;

    const more = document.createElement("div");
    more.className = "more hidden";
    more.innerHTML = `
      ${e.answer ? `<h4>Your answer</h4><p>${esc(e.answer)}</p>` : ""}
      ${e.feedback ? `<h4>Marker's comment</h4><p class="fb">${esc(e.feedback)}</p>` : ""}
      ${e.tips?.length ? `<h4>To fix</h4><ul class="tips" style="margin-bottom:13px">${e.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`;

    /* a banked question that came from Browse can be reopened there */
    if (e.source?.id && DATA.some(r => r.id === e.source.id)){
      const again = document.createElement("button");
      again.type = "button"; again.className = "rm";
      again.style.marginRight = "14px";
      again.textContent = "Try it again";
      again.addEventListener("click", () => {
        const rec = DATA.find(r => r.id === e.source.id);
        if (rec) sendToMarker(rec);
      });
      more.appendChild(again);
    }

    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "rm"; rm.textContent = "Remove from bank";
    rm.addEventListener("click", () => {
      bank = bank.filter(x => x.id !== e.id);
      saveBank(); drawBank();
    });
    more.appendChild(rm);

    top.addEventListener("click", () => {
      const open = more.classList.toggle("hidden");
      top.setAttribute("aria-expanded", String(!open));
      top.querySelector(".chev").textContent = open ? "▾" : "▴";
    });

    wrap.append(top, more);
    list.appendChild(wrap);
  });
}

function initBankFilters(){
  const fs = $("#fsub");
  fs.innerHTML = `<option value="">All subjects</option>` +
    Object.keys(MODULES).map(s => `<option value="${s}">${s}</option>`).join("");
  fs.addEventListener("change", () => {
    const s = fs.value;
    if (s) fillModules($("#fmod"), s, true);
    else {
      $("#fmod").innerHTML = `<option value="">All modules</option>` +
        Object.values(MODULES).flat().map(m => `<option value="${m}">${m}</option>`).join("") +
        `<option value="${UNSET}">${UNSET}</option>`;
    }
    drawBank();
  });
  fs.dispatchEvent(new Event("change"));
  $("#fmod").addEventListener("change", drawBank);
}

$("#bexport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(bank, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hsc-bank-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$("#bimport").addEventListener("change", e => {
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    let incoming;
    try { incoming = JSON.parse(String(r.result)); } catch { incoming = null; }
    if (!Array.isArray(incoming))
      return void ($("#banklist").innerHTML = `<p class="empty">That file was not a bank export. Pick a file saved with Export.</p>`);
    const ids = new Set(bank.map(x => x.id));
    bank = bank.concat(incoming.filter(x => x && x.id && !ids.has(x.id)))
               .sort((a,b) => (b.ts||0) - (a.ts||0));
    saveBank(); drawBank();
  };
  r.readAsText(f);
  e.target.value = "";
});

$("#bclear").addEventListener("click", function(){
  if (this.dataset.armed !== "1"){
    this.dataset.armed = "1";
    this.textContent = "Tap again to confirm";
    setTimeout(() => { this.dataset.armed = ""; this.textContent = "Delete all"; }, 4000);
    return;
  }
  this.dataset.armed = ""; this.textContent = "Delete all";
  bank = [];
  saveBank(); drawBank();
});

/* ---------- actions ------------------------------------------------------ */
$("#copy").addEventListener("click", async () => {
  if (!lastResult) return;
  const r = lastResult;
  const txt = [
    `${r.subject} — ${r.total}/${r.max ?? "?"}`, "",
    ...r.rows.map(m => `[${m.given}${m.available != null ? "/"+m.available : ""}] ${m.criterion}\n    ${m.reason}`),
    "", r.feedback, "",
    ...r.tips.map(t => `- ${t}`)
  ].join("\n").trim();
  try { await navigator.clipboard.writeText(txt); } catch { return; }
  const b = $("#copy"); b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1400);
});

$("#mclear").addEventListener("click", () => {
  ["#mq","#ma","#g","#cnote","#qn","#qhint","#pa"].forEach(s => { const el = $(s); if (el) el.value = ""; });
  SLOTS.forEach(s => { files[s].length = 0; drawFiles(s); });
  lastResult = null;
  detachSorter();
  $("#copy").classList.add("hidden");
  out.innerHTML = `<p class="empty">Cleared. Hand in a new question and answer whenever you're ready.</p>`;
});

function validate(){
  if (!getKey()) return "Add your Anthropic API key at the top of this page first.";
  if (mode === "combined"){
    if (!files.combined.length) return "Attach the file that holds the question and the answer.";
  } else if (mode === "paper"){
    if (!files.paper.length) return "Attach the exam paper.";
    if (!$("#qn").value.trim() && !$("#qhint").value.trim()) return "Say which question to mark.";
    if (!$("#pa").value.trim() && !files.paperanswer.length) return "Add your answer.";
  } else {
    if (!$("#mq").value.trim() && !files.question.length) return "Add the question — typed or as a photo.";
    if (!$("#ma").value.trim() && !files.answer.length) return "Add your answer — typed or as a photo.";
  }
  return null;
}

$("#go").addEventListener("click", async () => {
  const btn = $("#go");
  if (busy){ controller?.abort(); return; }

  const problem = validate();
  if (problem) return showError(problem, "");

  busy = true;
  controller = new AbortController();
  btn.textContent = "Cancel";
  showBusy();

  try {
    const content = await buildContent();
    const raw = await callApi(getKey(), $("#model").value, content, controller.signal);
    showResult(parseResult(raw));
  } catch (err){
    if (err?.name === "AbortError") showError("Marking cancelled", "Nothing was charged for a cancelled request.");
    else showError(err.message || "Something went wrong.", "", err.raw);
  } finally {
    busy = false;
    controller = null;
    btn.textContent = "Mark this response";
  }
});

APP.onView.push(v => { if (v === "bank") drawBank(); });

/* ---------- start -------------------------------------------------------- */
initBankFilters();
bank = store.read();
if (!Array.isArray(bank)) bank = [];
drawCount();
drawBank();
if (memoryOnly){
  const p = document.createElement("p");
  p.className = "note";
  p.style.cssText = "margin:10px 0 0;flex-basis:100%";
  p.textContent = "This browser is blocking storage, so the bank will empty when you close the tab. Use Export to keep a copy.";
  $(".bankfoot")?.appendChild(p);
}
