import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import "./sorter.css";
import { AiModePicker, AiMarkingCard, ApiKeyPanel } from "./AiMarking.jsx";
import { BANK_SUBJECT } from "./bankMeta.js";

/* The question bank carries ~1.1MB of exam data. Loading it lazily keeps the
   error book — the part used daily — fast to open on a phone. */
const QuestionBank = lazy(() => import("./QuestionBank.jsx"));
const PracticeTestBuilder = lazy(() =>
  import("./PracticeTest.jsx").then(m => ({ default: m.PracticeTestBuilder }))
);
const PracticeTestPaper = lazy(() =>
  import("./PracticeTest.jsx").then(m => ({ default: m.PracticeTestPaper }))
);

function BankLoading() {
  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: sans, fontSize: 14, color: C.faint }}>
      Loading the question bank…
    </div>
  );
}

/* ---------- palette & type ---------- */
const C = {
  paper: "#F7F6F1",
  panel: "#FFFFFF",
  ink: "#202733",
  faint: "#6B7280",
  rule: "#DEDFD6",
  red: "#C2382C",
  redSoft: "#FBEDEB",
  green: "#2F7A4D",
  greenSoft: "#EAF4EE",
  amber: "#B9821F",
  amberSoft: "#FBF3E2",
};
const serif = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif';
const sans = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

/* ---------- syllabus taxonomies ---------- */
const TAXONOMY = {
  chemistry: {
    label: "Chemistry",
    groupWord: "Module",
    groups: [
      { name: "Module 5 — Equilibrium", subs: ["Dynamic equilibrium", "Factors that affect equilibrium", "Calculating the equilibrium constant", "Solution equilibria"] },
      { name: "Module 6 — Acid–base reactions", subs: ["Properties of acids and bases", "Using Brønsted–Lowry theory", "Quantitative analysis"] },
      { name: "Module 7 — Organic chemistry", subs: ["Hydrocarbons", "Alcohols", "Organic acids", "Esters"] },
      { name: "Module 8 — Applying chemical ideas", subs: ["Analysis and uses of organic substances", "Analysis and uses of inorganic substances"] },
    ],
  },
  physics: {
    label: "Physics",
    groupWord: "Module",
    groups: [
      { name: "Module 5 — Advanced Mechanics", subs: ["Projectile Motion", "Circular Motion", "Motion in Gravitational Fields"] },
      { name: "Module 6 — Electromagnetism", subs: ["Charged Particles, Conductors and Electric and Magnetic Fields", "The Motor Effect", "Electromagnetic Induction", "Applications of the Motor Effect"] },
      { name: "Module 7 — The Nature of Light", subs: ["Electromagnetic Spectrum", "Light: Wave Model", "Light: Quantum Model", "Light and Special Relativity"] },
      { name: "Module 8 — From the Universe to the Atom", subs: ["Origins of the Elements", "Structure of the Atom", "Quantum Mechanical Nature of the Atom", "Properties of the Nucleus", "Deep inside the Atom"] },
    ],
  },
  mathsExt1: {
    label: "Maths Ext 1",
    groupWord: "Topic",
    groups: [
      { name: "Proof", subs: ["ME-P1 Proof by Mathematical Induction"] },
      { name: "Vectors", subs: ["ME-V1 Introduction to Vectors"] },
      { name: "Trigonometric Functions", subs: ["ME-T3 Trigonometric Equations"] },
      { name: "Calculus", subs: ["ME-C2 Further Calculus Skills", "ME-C3 Applications of Calculus"] },
      { name: "Statistical Analysis", subs: ["ME-S1 The Binomial Distribution"] },
    ],
  },
};
const ERROR_TYPES = ["Calculation error", "Conceptual misunderstanding", "Misread question", "Missed reasoning/explanation", "Terminology/definition error"];
const SUBJECTS = ["chemistry", "physics", "mathsExt1"];
const DAY = 86400000;

/* ---------- storage helpers (Supabase — syncs across every device using the same sync code) ---------- */
import { remoteGet, remoteSet, remoteDelete, generateSyncCode } from "./syncStore.js";

const SYNC_CODE_LOCAL_KEY = "redpen_sync_code"; // stored per-device only; the data itself lives in Supabase
export function getSavedSyncCode() { return localStorage.getItem(SYNC_CODE_LOCAL_KEY); }
export function setSavedSyncCode(code) { localStorage.setItem(SYNC_CODE_LOCAL_KEY, code); }

let _syncCode = null;
export function setActiveSyncCode(code) { _syncCode = code; }

/* mimics the window.storage.{get,set,delete} shape used elsewhere in this file */
window.storage = {
  get: async (key) => {
    const value = await remoteGet(_syncCode, key);
    return value === undefined ? null : { key, value };
  },
  set: async (key, value) => { await remoteSet(_syncCode, key, value); return { key, value }; },
  delete: async (key) => { await remoteDelete(_syncCode, key); return { key, deleted: true }; },
};
export { generateSyncCode };

async function loadJSON(key, fallback) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : fallback;
  } catch { return fallback; }
}
async function saveJSON(key, obj) {
  try { await window.storage.set(key, JSON.stringify(obj)); return true; }
  catch (e) { console.error("save failed", e); return false; }
}

/* downscale an image File/Blob to a modest JPEG data URL */
function shrinkImage(fileOrBlob, maxDim = 1100, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const fmtDate = (t) => new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

/* spaced-repetition steps (days): 2 → 7 → 14 → 30 (settled) */
function nextInterval(prev, correct) {
  if (!correct) return 2;
  if (prev < 7) return 7;
  if (prev < 14) return 14;
  return 30;
}

/* ---------- small shared UI ---------- */
function Btn({ children, onClick, tone = "ink", disabled, small }) {
  const bg = tone === "red" ? C.red : tone === "green" ? C.green : tone === "ghost" ? "transparent" : C.ink;
  const fg = tone === "ghost" ? C.ink : "#fff";
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: disabled ? C.rule : bg, color: disabled ? C.faint : fg,
        border: tone === "ghost" ? `1px solid ${C.rule}` : "none",
        borderRadius: 6, padding: small ? "5px 12px" : "9px 18px",
        fontFamily: sans, fontSize: small ? 13 : 14.5, fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
      }}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: C.faint, marginBottom: 5, fontFamily: sans }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 14.5,
  fontFamily: sans, color: C.ink, background: "#fff",
  border: `1px solid ${C.rule}`, borderRadius: 6, outline: "none",
};

function StatusMark({ status, needsTagging }) {
  if (needsTagging) return <span style={{ color: C.amber, fontFamily: sans, fontSize: 13, fontWeight: 600 }}>needs tagging</span>;
  if (status === "redone-correct") return <span style={{ color: C.green, fontFamily: sans, fontSize: 13, fontWeight: 700 }}>✓ redone correct</span>;
  if (status === "redone-incorrect") return <span style={{ color: C.red, fontFamily: sans, fontSize: 13, fontWeight: 700 }}>✗ redone incorrect</span>;
  return <span style={{ color: C.faint, fontFamily: sans, fontSize: 13 }}>not yet redone</span>;
}

/* image capture box: paste or upload, shows thumbnails */
function ImageBox({ label, images, setImages }) {
  const fileRef = useRef(null);
  const addFiles = async (files) => {
    const out = [];
    for (const f of files) {
      if (f.type && f.type.startsWith("image/")) {
        try { out.push(await shrinkImage(f)); } catch {}
      }
    }
    if (out.length) setImages([...images, ...out]);
  };
  return (
    <div
      onPaste={(e) => {
        const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith("image/"));
        if (items.length) { e.preventDefault(); addFiles(items.map(i => i.getAsFile()).filter(Boolean)); }
      }}
      tabIndex={0}
      style={{ border: `1.5px dashed ${C.rule}`, borderRadius: 8, padding: 10, background: "#FCFCF9" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13, color: C.faint, fontFamily: sans }}>
          {label} — click here then paste a screenshot, or
        </div>
        <Btn small tone="ghost" onClick={() => fileRef.current?.click()}>Upload image</Btn>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
      </div>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {images.map((src, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={src} alt="" style={{ height: 90, borderRadius: 6, border: `1px solid ${C.rule}` }} />
              <button onClick={() => setImages(images.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: "20px", padding: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- main app ---------- */
function AppInner({ syncCode, onChangeSyncCode }) {
  const [subject, setSubject] = useState("chemistry");
  const [view, setView] = useState("due"); // due | add | browse | progress
  const [entries, setEntries] = useState([]);
  const [meta, setMeta] = useState({ attemptDates: [], clearedDates: [] });
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [redoQueue, setRedoQueue] = useState(null); // array of ids when in a redo session
  const [editId, setEditId] = useState(null); // entry being tagged/edited
  const [showSync, setShowSync] = useState(false);

  /* question-bank filter state, shared so the practice test can seed itself
     from whatever you're currently browsing */
  const [filters, setFilters] = useState({
    q: "", years: new Set(), section: "", marks: "",
    module: null, iq: null, openMods: new Set(),
  });
  const [paper, setPaper] = useState(null); // generated practice test, when open
  const bankSubject = BANK_SUBJECT[subject];

  /* reset the bank's tree selection when you change subject — the modules
     and inquiry questions differ between Chemistry and Physics */
  useEffect(() => {
    setFilters(f => ({ ...f, module: null, iq: null, openMods: new Set() }));
  }, [subject]);

  useEffect(() => {
    (async () => {
      const idx = await loadJSON("index", []);
      const m = await loadJSON("meta", { attemptDates: [], clearedDates: [] });
      setEntries(idx); setMeta(m); setLoading(false);
    })();
  }, []);

  const persistEntries = async (next) => {
    setEntries(next);
    const ok = await saveJSON("index", next);
    setSaveError(!ok);
  };
  const persistMeta = async (next) => { setMeta(next); await saveJSON("meta", next); };

  const subjEntries = useMemo(() => entries.filter(e => e.subject === subject), [entries, subject]);
  const now = Date.now();
  const dueEntries = subjEntries.filter(e => !e.needsTagging && e.nextReview <= now);
  const needsTagging = subjEntries.filter(e => e.needsTagging);

  const addEntry = async (entry, images) => {
    if (images.q.length || images.w.length || images.c.length) {
      const ok = await saveJSON("img:" + entry.id, images);
      if (!ok) { setSaveError(true); }
      entry.hasImages = true;
    }
    await persistEntries([entry, ...entries]);
  };

  const updateEntry = (id, patch) =>
    persistEntries(entries.map(e => (e.id === id ? { ...e, ...patch } : e)));

  const deleteEntry = async (id) => {
    await persistEntries(entries.filter(e => e.id !== id));
    try { await window.storage.delete("img:" + id); } catch {}
  };

  const recordAttempt = async (id, { response, correct, marksAwarded, aiMarking }) => {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    /* `correct` is always the student's own ✓/✗ — the AI's opinion is stored
       alongside it for reference but never drives the interval. */
    const interval = nextInterval(e.interval || 2, correct);
    const attempt = { date: Date.now(), response, correct, marksAwarded: marksAwarded ?? null, aiMarking: aiMarking ?? null };
    await persistEntries(entries.map(x => x.id === id ? {
      ...x,
      attempts: [...(x.attempts || []), attempt],
      status: correct ? "redone-correct" : "redone-incorrect",
      dateLastAttempted: Date.now(),
      interval,
      nextReview: Date.now() + interval * DAY,
    } : x));
    const t = todayKey();
    const m = { ...meta };
    if (!m.attemptDates.includes(t)) m.attemptDates = [...m.attemptDates, t];
    if (correct) m.clearedDates = [...(m.clearedDates || []), Date.now()];
    await persistMeta(m);
  };

  /* streak */
  const streak = useMemo(() => {
    const set = new Set(meta.attemptDates || []);
    let s = 0; const d = new Date();
    if (!set.has(todayKey(d))) d.setDate(d.getDate() - 1); // streak may end yesterday
    while (set.has(todayKey(d))) { s++; d.setDate(d.getDate() - 1); }
    return s;
  }, [meta]);
  const clearedThisWeek = (meta.clearedDates || []).filter(t => t > now - 7 * DAY).length;

  const tax = TAXONOMY[subject];

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.paper, display: "grid", placeItems: "center", fontFamily: sans, color: C.faint }}>
      Opening your error book…
    </div>
  );

  /* a generated practice test takes over the whole screen so it prints cleanly */
  if (paper) return (
    <Suspense fallback={<BankLoading />}>
      <PracticeTestPaper paper={paper} onBack={() => setPaper(null)} />
    </Suspense>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, paddingBottom: 60 }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "26px 18px 0" }}>

        {/* masthead */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontFamily: serif, fontSize: 30, margin: 0, fontWeight: 600 }}>
            Red Pen
            <span style={{ fontFamily: sans, fontSize: 13.5, color: C.faint, fontWeight: 400, marginLeft: 12 }}>
              HSC error book
            </span>
          </h1>
          <div style={{ fontFamily: sans, fontSize: 13, color: C.faint, display: "flex", alignItems: "center", gap: 12 }}>
            <span>{streak > 0 ? <>🔥 {streak}-day streak · </> : null}{clearedThisWeek} cleared this week</span>
            <button onClick={() => setShowSync(true)}
              style={{ background: "none", border: `1px solid ${C.rule}`, borderRadius: 14, padding: "3px 11px", fontFamily: sans, fontSize: 12.5, cursor: "pointer", color: C.ink }}>
              ⇄ Sync
            </button>
          </div>
        </div>

        {showSync && <SyncPanel syncCode={syncCode} onChangeSyncCode={onChangeSyncCode} onClose={() => setShowSync(false)} />}

        {/* subject tabs */}
        <div style={{ display: "flex", gap: 22, marginTop: 18, borderBottom: `1px solid ${C.rule}` }}>
          {SUBJECTS.map(s => {
            const active = s === subject;
            const dueCount = entries.filter(e => e.subject === s && !e.needsTagging && e.nextReview <= now).length;
            return (
              <button key={s} onClick={() => { setSubject(s); setRedoQueue(null); setEditId(null); }}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: "8px 2px 10px",
                  fontFamily: serif, fontSize: 17.5, color: active ? C.ink : C.faint,
                  borderBottom: active ? `3px solid ${C.red}` : "3px solid transparent",
                  marginBottom: -1,
                }}>
                {TAXONOMY[s].label}
                {dueCount > 0 && (
                  <span style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: "#fff", background: C.red, borderRadius: 9, padding: "1.5px 7px", marginLeft: 7, verticalAlign: "2px" }}>
                    {dueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* view nav */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {[["bank", "Question bank"], ["ptest", "Practice test"], ["due", `Due for redo${dueEntries.length ? ` (${dueEntries.length})` : ""}`], ["add", "Log an error"], ["browse", "Browse"], ["progress", "Progress"]].map(([v, lbl]) => (
            <button key={v} onClick={() => { setView(v); setRedoQueue(null); setEditId(null); }}
              style={{
                fontFamily: sans, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
                padding: "6px 13px", borderRadius: 16,
                border: `1px solid ${view === v ? C.ink : C.rule}`,
                background: view === v ? C.ink : "transparent",
                color: view === v ? "#fff" : C.ink,
              }}>
              {lbl}
            </button>
          ))}
        </div>

        {saveError && (
          <div style={{ marginTop: 12, background: C.redSoft, border: `1px solid ${C.red}`, borderRadius: 8, padding: "8px 12px", fontFamily: sans, fontSize: 13, color: C.red }}>
            Couldn't save to storage just now — your latest change may not persist. Try again in a moment.
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          {redoQueue ? (
            <RedoSession
              ids={redoQueue}
              entries={entries}
              tax={tax}
              onDone={() => setRedoQueue(null)}
              recordAttempt={recordAttempt}
            />
          ) : editId ? (
            <TagEditor
              entry={entries.find(e => e.id === editId)}
              tax={tax}
              onSave={(patch) => { updateEntry(editId, patch); setEditId(null); setView("browse"); }}
              onCancel={() => setEditId(null)}
            />
          ) : view === "bank" ? (
            bankSubject ? (
              <div className={`sorter${subject === "physics" ? " phys" : ""}`}>
                <Suspense fallback={<BankLoading />}>
                  <QuestionBank bankSubject={bankSubject} filters={filters} setFilters={setFilters} />
                </Suspense>
              </div>
            ) : (
              <NoBank label={TAXONOMY[subject].label} />
            )
          ) : view === "ptest" ? (
            bankSubject ? (
              <div className={`sorter${subject === "physics" ? " phys" : ""}`}>
                <Suspense fallback={<BankLoading />}>
                  <PracticeTestBuilder bankSubject={bankSubject} filters={filters} onGenerate={setPaper} />
                </Suspense>
              </div>
            ) : (
              <NoBank label={TAXONOMY[subject].label} />
            )
          ) : view === "due" ? (
            <DueView due={dueEntries} needsTagging={needsTagging} tax={tax}
              startRedo={() => setRedoQueue(dueEntries.map(e => e.id))}
              gotoAdd={() => setView("add")} gotoBrowse={() => setView("browse")}
              onTag={(id) => setEditId(id)} />
          ) : view === "add" ? (
            <AddView subject={subject} tax={tax} onSave={async (entry, images) => { await addEntry(entry, images); setView("due"); }} />
          ) : view === "browse" ? (
            <BrowseView entries={subjEntries} tax={tax}
              onRedo={(ids) => setRedoQueue(ids)}
              onTag={(id) => setEditId(id)}
              onDelete={deleteEntry} />
          ) : (
            <ProgressView entries={subjEntries} tax={tax} streak={streak} clearedThisWeek={clearedThisWeek} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- shown when a subject has no question bank (Maths Ext 1) ---------- */
function NoBank({ label }) {
  return (
    <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 28, textAlign: "center" }}>
      <div style={{ fontFamily: serif, fontSize: 21, marginBottom: 6 }}>No question bank for {label}</div>
      <div style={{ fontFamily: sans, fontSize: 14, color: C.faint }}>
        The bank covers HSC Chemistry and Physics, 2019–2025. Your {label} error
        book still works as normal — switch to Log an error or Browse.
      </div>
    </div>
  );
}

/* ---------- due queue (home) ---------- */
function DueView({ due, needsTagging, tax, startRedo, gotoAdd, gotoBrowse, onTag }) {
  return (
    <div>
      {due.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel }}>
          <div style={{ fontFamily: serif, fontSize: 21, marginBottom: 8 }}>Nothing due for redo</div>
          <div style={{ fontFamily: sans, fontSize: 14, color: C.faint, marginBottom: 18 }}>
            Log errors as you find them — they'll come back here when it's time to retry them.
          </div>
          <Btn onClick={gotoAdd} tone="red">Log an error</Btn>
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: serif, fontSize: 21 }}>{due.length} question{due.length > 1 ? "s" : ""} due for redo</div>
              <div style={{ fontFamily: sans, fontSize: 13.5, color: C.faint, marginTop: 3 }}>
                You won't see the answers until you've had another go.
              </div>
            </div>
            <Btn tone="red" onClick={startRedo}>Start redo session</Btn>
          </div>
          <div style={{ marginTop: 16 }}>
            {due.map(e => (
              <div key={e.id} style={{ borderTop: `1px solid ${C.rule}`, padding: "10px 2px", display: "flex", justifyContent: "space-between", gap: 10, fontFamily: sans, fontSize: 14 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.questionText ? e.questionText.slice(0, 80) : "(image question)"}
                </div>
                <div style={{ color: C.faint, fontSize: 13, flexShrink: 0 }}>{e.subtopic || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {needsTagging.length > 0 && (
        <div style={{ marginTop: 16, border: `1px solid ${C.amber}`, background: C.amberSoft, borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: C.amber, marginBottom: 8 }}>
            {needsTagging.length} quick-captured {needsTagging.length > 1 ? "entries need" : "entry needs"} tagging
          </div>
          {needsTagging.map(e => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", fontFamily: sans, fontSize: 14 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.questionText ? e.questionText.slice(0, 70) : "(image question)"} <span style={{ color: C.faint, fontSize: 12.5 }}>· {fmtDate(e.dateAdded)}</span>
              </div>
              <Btn small tone="ghost" onClick={() => onTag(e.id)}>Finish tagging</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- add / quick capture ---------- */
function AddView({ subject, tax, onSave }) {
  const [quick, setQuick] = useState(false);
  const [qText, setQText] = useState(""); const [qImgs, setQImgs] = useState([]);
  const [wText, setWText] = useState(""); const [wImgs, setWImgs] = useState([]);
  const [cText, setCText] = useState(""); const [cImgs, setCImgs] = useState([]);
  const [group, setGroup] = useState(""); const [sub, setSub] = useState("");
  const [errType, setErrType] = useState(""); const [source, setSource] = useState("");
  const [marksAvail, setMarksAvail] = useState(""); const [marksGot, setMarksGot] = useState("");
  const [aiMode, setAiMode] = useState("off");
  const [saving, setSaving] = useState(false);

  const groupObj = tax.groups.find(g => g.name === group);
  const canSave = quick
    ? (qText.trim() || qImgs.length)
    : (qText.trim() || qImgs.length) && group && sub;

  const save = async () => {
    setSaving(true);
    const entry = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      subject,
      module: quick ? "" : group,
      subtopic: quick ? "" : sub,
      questionText: qText.trim(), workingText: wText.trim(), criteriaText: cText.trim(),
      errorType: quick ? "" : errType,
      source: quick ? "" : source.trim(),
      marksAvailable: quick ? null : (marksAvail ? Number(marksAvail) : null),
      marksAwarded: quick ? null : (marksGot ? Number(marksGot) : null),
      aiMarkingMode: quick ? "off" : aiMode,
      status: "unattempted",
      needsTagging: quick,
      dateAdded: Date.now(), dateLastAttempted: null,
      interval: 2, nextReview: Date.now() + 2 * DAY,
      attempts: [],
      hasImages: false,
    };
    await onSave(entry, { q: qImgs, w: wImgs, c: cImgs });
    setSaving(false);
  };

  return (
    <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <div style={{ fontFamily: serif, fontSize: 21 }}>{quick ? "Quick capture" : `Log an error — ${tax.label}`}</div>
        <button onClick={() => setQuick(!quick)} style={{ background: "none", border: "none", color: C.red, fontFamily: sans, fontSize: 13.5, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>
          {quick ? "Switch to full form" : "In a rush? Quick capture"}
        </button>
      </div>
      {quick && (
        <div style={{ fontFamily: sans, fontSize: 13.5, color: C.faint, marginBottom: 14 }}>
          Just grab the question and your working — it'll sit in "needs tagging" until you fill in the rest.
        </div>
      )}

      <Field label="The question">
        <textarea value={qText} onChange={e => setQText(e.target.value)} rows={2} placeholder="Type or paste the question text (optional if you add an image)" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
        <ImageBox label="Question image" images={qImgs} setImages={setQImgs} />
      </Field>

      <Field label="Your working / response (the wrong one)">
        <textarea value={wText} onChange={e => setWText(e.target.value)} rows={2} placeholder="What you wrote at the time" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
        <ImageBox label="Working image" images={wImgs} setImages={setWImgs} />
      </Field>

      {!quick && (
        <>
          <Field label="Marking criteria / sample answer">
            <textarea value={cText} onChange={e => setCText(e.target.value)} rows={2} placeholder="Marking criteria or a sample answer" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
            <ImageBox label="Criteria image" images={cImgs} setImages={setCImgs} />
          </Field>

          <Field label="AI marking">
            <AiModePicker value={aiMode} onChange={setAiMode} C={C} sans={sans} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label={tax.groupWord}>
              <select value={group} onChange={e => { setGroup(e.target.value); setSub(""); }} style={inputStyle}>
                <option value="">Select…</option>
                {tax.groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Subtopic">
              <select value={sub} onChange={e => setSub(e.target.value)} style={inputStyle} disabled={!group}>
                <option value="">{group ? "Select…" : `Pick a ${tax.groupWord.toLowerCase()} first`}</option>
                {groupObj?.subs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Error type (optional)">
              <select value={errType} onChange={e => setErrType(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {ERROR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Source (optional)">
              <input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. 2025 Trial Q14, Textbook Ch. 4" style={inputStyle} />
            </Field>
            <Field label="Marks available (optional)">
              <input type="number" min="1" value={marksAvail} onChange={e => setMarksAvail(e.target.value)} placeholder="e.g. 4" style={inputStyle} />
            </Field>
            <Field label="Marks you got (optional)">
              <input type="number" min="0" value={marksGot} onChange={e => setMarksGot(e.target.value)} placeholder="e.g. 1" style={inputStyle} />
            </Field>
          </div>
        </>
      )}

      <div style={{ marginTop: 6 }}>
        <Btn tone="red" onClick={save} disabled={!canSave || saving}>
          {saving ? "Saving…" : quick ? "Capture it" : "Save to error book"}
        </Btn>
        {!canSave && <span style={{ marginLeft: 12, fontFamily: sans, fontSize: 12.5, color: C.faint }}>
          {quick ? "Add the question first" : "Needs a question and tagging"}
        </span>}
      </div>
    </div>
  );
}

/* ---------- tag editor (finish a quick capture / edit tags) ---------- */
function TagEditor({ entry, tax, onSave, onCancel }) {
  const [group, setGroup] = useState(entry?.module || "");
  const [sub, setSub] = useState(entry?.subtopic || "");
  const [errType, setErrType] = useState(entry?.errorType || "");
  const [source, setSource] = useState(entry?.source || "");
  const [cText, setCText] = useState(entry?.criteriaText || "");
  const [cImgs, setCImgs] = useState([]);
  const [marksAvail, setMarksAvail] = useState(entry?.marksAvailable ?? "");
  const [aiMode, setAiMode] = useState(entry?.aiMarkingMode || "off");
  if (!entry) return null;
  const groupObj = tax.groups.find(g => g.name === group);
  return (
    <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 20 }}>
      <div style={{ fontFamily: serif, fontSize: 21, marginBottom: 4 }}>Finish tagging</div>
      <div style={{ fontFamily: sans, fontSize: 14, color: C.faint, marginBottom: 16, whiteSpace: "pre-wrap" }}>
        {entry.questionText ? entry.questionText.slice(0, 160) : "(image question)"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={tax.groupWord}>
          <select value={group} onChange={e => { setGroup(e.target.value); setSub(""); }} style={inputStyle}>
            <option value="">Select…</option>
            {tax.groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Subtopic">
          <select value={sub} onChange={e => setSub(e.target.value)} style={inputStyle} disabled={!group}>
            <option value="">Select…</option>
            {groupObj?.subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Error type (optional)">
          <select value={errType} onChange={e => setErrType(e.target.value)} style={inputStyle}>
            <option value="">—</option>
            {ERROR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Source (optional)">
          <input value={source} onChange={e => setSource(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Marks available (optional)">
          <input type="number" min="1" value={marksAvail} onChange={e => setMarksAvail(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Field label="Marking criteria / sample answer (if you didn't capture it earlier)">
        <textarea value={cText} onChange={e => setCText(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
        <ImageBox label="Criteria image" images={cImgs} setImages={setCImgs} />
      </Field>
      <Field label="AI marking">
        <AiModePicker value={aiMode} onChange={setAiMode} C={C} sans={sans} />
      </Field>
      <div style={{ display: "flex", gap: 10 }}>
        <Btn tone="red" disabled={!group || !sub} onClick={async () => {
          if (cImgs.length) {
            const existing = await loadJSON("img:" + entry.id, { q: [], w: [], c: [] });
            existing.c = [...(existing.c || []), ...cImgs];
            await saveJSON("img:" + entry.id, existing);
          }
          onSave({
            module: group, subtopic: sub, errorType: errType, source: source.trim(),
            criteriaText: cText.trim(), needsTagging: false,
            aiMarkingMode: aiMode,
            marksAvailable: marksAvail ? Number(marksAvail) : null,
            hasImages: entry.hasImages || cImgs.length > 0,
          });
        }}>Save tags</Btn>
        <Btn tone="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ---------- browse / filter ---------- */
function BrowseView({ entries, tax, onRedo, onTag, onDelete }) {
  const [group, setGroup] = useState(""); const [sub, setSub] = useState("");
  const [errType, setErrType] = useState(""); const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [revealId, setRevealId] = useState(null);
  const [openImgs, setOpenImgs] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const groupObj = tax.groups.find(g => g.name === group);
  const filtered = entries.filter(e => {
    if (group && e.module !== group) return false;
    if (sub && e.subtopic !== sub) return false;
    if (errType && e.errorType !== errType) return false;
    if (status === "needs-tagging" ? !e.needsTagging : status && (e.needsTagging || e.status !== status)) return false;
    if (q) {
      const hay = ((e.questionText || "") + " " + (e.source || "")).toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  useEffect(() => {
    setOpenImgs(null); setRevealId(null);
    if (openId) {
      const e = entries.find(x => x.id === openId);
      if (e?.hasImages) loadJSON("img:" + openId, null).then(setOpenImgs);
    }
  }, [openId]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={group} onChange={e => { setGroup(e.target.value); setSub(""); }} style={{ ...inputStyle, width: "auto", flexGrow: 1 }}>
          <option value="">All {tax.groupWord.toLowerCase()}s</option>
          {tax.groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
        </select>
        <select value={sub} onChange={e => setSub(e.target.value)} style={{ ...inputStyle, width: "auto", flexGrow: 1 }} disabled={!group}>
          <option value="">All subtopics</option>
          {groupObj?.subs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={errType} onChange={e => setErrType(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">Any error type</option>
          {ERROR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">Any status</option>
          <option value="unattempted">Not yet redone</option>
          <option value="redone-correct">Redone correct</option>
          <option value="redone-incorrect">Redone incorrect</option>
          <option value="needs-tagging">Needs tagging</option>
        </select>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search question text or source…" style={{ ...inputStyle, marginBottom: 14 }} />

      {filtered.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Btn small tone="red" onClick={() => onRedo(filtered.filter(e => !e.needsTagging).map(e => e.id))}>
            Redo these {filtered.filter(e => !e.needsTagging).length}
          </Btn>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ fontFamily: sans, fontSize: 14, color: C.faint, padding: "30px 0", textAlign: "center" }}>
          No entries match — clear a filter or log a new error.
        </div>
      ) : filtered.map(e => {
        const open = openId === e.id;
        return (
          <div key={e.id} style={{ border: `1px solid ${C.rule}`, borderLeft: `4px solid ${e.needsTagging ? C.amber : e.status === "redone-correct" ? C.green : C.red}`, borderRadius: 8, background: C.panel, marginBottom: 10, padding: "12px 15px" }}>
            <div onClick={() => setOpenId(open ? null : e.id)} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, flexBasis: "70%", flexGrow: 1 }}>
                  {e.questionText ? (open ? e.questionText : e.questionText.slice(0, 110) + (e.questionText.length > 110 ? "…" : "")) : "(image question — open to view)"}
                </div>
                <StatusMark status={e.status} needsTagging={e.needsTagging} />
              </div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: C.faint, marginTop: 5 }}>
                {e.subtopic || "untagged"}{e.errorType ? ` · ${e.errorType}` : ""}{e.source ? ` · ${e.source}` : ""} · added {fmtDate(e.dateAdded)}
                {e.marksAvailable ? ` · ${e.marksAwarded ?? "?"}/${e.marksAvailable} marks` : ""}
                {!e.needsTagging && <> · next redo {fmtDate(e.nextReview)}</>}
              </div>
            </div>

            {open && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${C.rule}`, paddingTop: 10 }}>
                {openImgs?.q?.map((s, i) => <img key={i} src={s} alt="question" style={{ maxWidth: "100%", borderRadius: 6, marginBottom: 8 }} />)}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {!e.needsTagging && <Btn small tone="red" onClick={() => onRedo([e.id])}>Redo this one</Btn>}
                  {(e.needsTagging || true) && <Btn small tone="ghost" onClick={() => onTag(e.id)}>{e.needsTagging ? "Finish tagging" : "Edit tags"}</Btn>}
                  <Btn small tone="ghost" onClick={() => setRevealId(revealId === e.id ? null : e.id)}>
                    {revealId === e.id ? "Hide answer" : "Reveal answer"}
                  </Btn>
                  {confirmDel === e.id
                    ? <Btn small tone="red" onClick={() => { onDelete(e.id); setConfirmDel(null); setOpenId(null); }}>Really delete?</Btn>
                    : <Btn small tone="ghost" onClick={() => setConfirmDel(e.id)}>Delete</Btn>}
                </div>
                {revealId === e.id && (
                  <div style={{ background: C.paper, borderRadius: 8, padding: 12 }}>
                    {e.workingText && <div style={{ fontFamily: sans, fontSize: 13.5, marginBottom: 8 }}><span style={{ color: C.red, fontWeight: 700 }}>Your original working: </span>{e.workingText}</div>}
                    {openImgs?.w?.map((s, i) => <img key={i} src={s} alt="working" style={{ maxWidth: "100%", borderRadius: 6, marginBottom: 8 }} />)}
                    {e.criteriaText && <div style={{ fontFamily: sans, fontSize: 13.5, marginBottom: 8 }}><span style={{ color: C.green, fontWeight: 700 }}>Marking criteria: </span>{e.criteriaText}</div>}
                    {openImgs?.c?.map((s, i) => <img key={i} src={s} alt="criteria" style={{ maxWidth: "100%", borderRadius: 6 }} />)}
                    {!e.workingText && !e.criteriaText && !openImgs?.w?.length && !openImgs?.c?.length && (
                      <div style={{ fontFamily: sans, fontSize: 13, color: C.faint }}>No answer material saved for this one yet.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- redo session ---------- */
function RedoSession({ ids, entries, tax, onDone, recordAttempt }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState("attempt"); // attempt | reveal
  const [resp, setResp] = useState("");
  const [respImgs, setRespImgs] = useState([]);
  const [imgs, setImgs] = useState(null);
  const [marksGot, setMarksGot] = useState("");
  const [aiResult, setAiResult] = useState(null);
  const [results, setResults] = useState({ right: 0, wrong: 0 });

  const id = ids[i];
  const entry = entries.find(e => e.id === id);

  useEffect(() => {
    setPhase("attempt"); setResp(""); setRespImgs([]); setMarksGot(""); setImgs(null); setAiResult(null);
    if (entry?.hasImages) loadJSON("img:" + id, null).then(setImgs);
  }, [id]);

  if (!entry) return null;

  const finish = async (correct) => {
    await recordAttempt(id, { response: resp.trim(), correct, marksAwarded: marksGot ? Number(marksGot) : null, aiMarking: aiResult });
    setResults(r => ({ right: r.right + (correct ? 1 : 0), wrong: r.wrong + (correct ? 0 : 1) }));
    if (i + 1 < ids.length) setI(i + 1);
    else setPhase("done");
  };

  if (phase === "done") {
    return (
      <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 28, textAlign: "center" }}>
        <div style={{ fontFamily: serif, fontSize: 24, marginBottom: 6 }}>Session finished</div>
        <div style={{ fontFamily: sans, fontSize: 15 }}>
          <span style={{ color: C.green, fontWeight: 700 }}>{results.right} right</span>
          {" · "}
          <span style={{ color: C.red, fontWeight: 700 }}>{results.wrong} to see again</span>
        </div>
        <div style={{ fontFamily: sans, fontSize: 13.5, color: C.faint, margin: "10px 0 18px" }}>
          Correct ones come back later; wrong ones return in a couple of days.
        </div>
        <Btn onClick={onDone}>Back to the book</Btn>
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ fontFamily: serif, fontSize: 20 }}>Redo · question {i + 1} of {ids.length}</div>
        <button onClick={onDone} style={{ background: "none", border: "none", color: C.faint, fontFamily: sans, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>End session</button>
      </div>
      <div style={{ fontFamily: sans, fontSize: 12.5, color: C.faint, marginBottom: 10 }}>
        {entry.subtopic || "untagged"}{entry.source ? ` · ${entry.source}` : ""}{entry.marksAvailable ? ` · ${entry.marksAvailable} marks` : ""}
      </div>

      {/* the question */}
      <div style={{ background: C.paper, borderRadius: 8, padding: 14, marginBottom: 16 }}>
        {entry.questionText && <div style={{ fontFamily: sans, fontSize: 15, whiteSpace: "pre-wrap" }}>{entry.questionText}</div>}
        {imgs?.q?.map((s, k) => <img key={k} src={s} alt="question" style={{ maxWidth: "100%", borderRadius: 6, marginTop: 8 }} />)}
        {!entry.questionText && !imgs?.q?.length && entry.hasImages && <div style={{ fontFamily: sans, fontSize: 13, color: C.faint }}>Loading question image…</div>}
      </div>

      {phase === "attempt" ? (
        <>
          <Field label="Your new attempt — work it fully before you peek">
            <textarea value={resp} onChange={e => setResp(e.target.value)} rows={5} placeholder="Write your working/answer here (or attach a photo of your handwritten attempt)" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
            <ImageBox label="Attempt photo" images={respImgs} setImages={setRespImgs} />
          </Field>
          <Btn tone="ink" onClick={() => setPhase("reveal")} disabled={!resp.trim() && respImgs.length === 0}>
            Submit and check
          </Btn>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ border: `1px solid ${C.rule}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Your new attempt</div>
              <div style={{ fontFamily: sans, fontSize: 13.5, whiteSpace: "pre-wrap" }}>{resp || "(photo attempt)"}</div>
              {respImgs.map((s, k) => <img key={k} src={s} alt="attempt" style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6 }} />)}
            </div>
            <div style={{ border: `1px solid ${C.green}`, background: C.greenSoft, borderRadius: 8, padding: 12 }}>
              <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 6 }}>Marking criteria / sample answer</div>
              {entry.criteriaText && <div style={{ fontFamily: sans, fontSize: 13.5, whiteSpace: "pre-wrap" }}>{entry.criteriaText}</div>}
              {imgs?.c?.map((s, k) => <img key={k} src={s} alt="criteria" style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6 }} />)}
              {!entry.criteriaText && !imgs?.c?.length && <div style={{ fontFamily: sans, fontSize: 13, color: C.faint }}>No criteria saved — compare against your notes.</div>}
            </div>
          </div>

          <details style={{ marginBottom: 16 }}>
            <summary style={{ fontFamily: sans, fontSize: 13.5, color: C.red, cursor: "pointer", fontWeight: 600 }}>
              See your original (wrong) working
            </summary>
            <div style={{ background: C.redSoft, borderRadius: 8, padding: 12, marginTop: 8 }}>
              {entry.workingText && <div style={{ fontFamily: sans, fontSize: 13.5, whiteSpace: "pre-wrap" }}>{entry.workingText}</div>}
              {imgs?.w?.map((s, k) => <img key={k} src={s} alt="original working" style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6 }} />)}
              {!entry.workingText && !imgs?.w?.length && <div style={{ fontFamily: sans, fontSize: 13, color: C.faint }}>No original working saved.</div>}
            </div>
          </details>

          <AiMarkingCard
            entry={entry}
            attemptText={resp.trim()}
            onResult={setAiResult}
            onUseMark={(m) => setMarksGot(String(m))}
            C={C} sans={sans} serif={serif}
          />

          {entry.marksAvailable && (
            <Field label={`Marks this time (out of ${entry.marksAvailable})`}>
              <input type="number" min="0" max={entry.marksAvailable} value={marksGot} onChange={e => setMarksGot(e.target.value)} style={{ ...inputStyle, width: 120 }} />
            </Field>
          )}

          <div style={{ fontFamily: sans, fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>Did you get it right this time?</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn tone="green" onClick={() => finish(true)}>✓ Got it right</Btn>
            <Btn tone="red" onClick={() => finish(false)}>✗ Still wrong</Btn>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- progress ---------- */
function ProgressView({ entries, tax, streak, clearedThisWeek }) {
  const tagged = entries.filter(e => !e.needsTagging);
  const bySub = {};
  tagged.forEach(e => {
    const k = e.subtopic || "untagged";
    bySub[k] = bySub[k] || { total: 0, correct: 0, unresolved: 0, marksGot: 0, marksAvail: 0, group: e.module };
    const b = bySub[k];
    b.total++;
    if (e.status === "redone-correct") b.correct++;
    else b.unresolved++;
    const lastMarks = [...(e.attempts || [])].reverse().find(a => a.marksAwarded != null);
    const got = lastMarks ? lastMarks.marksAwarded : e.marksAwarded;
    if (e.marksAvailable && got != null) { b.marksAvail += e.marksAvailable; b.marksGot += got; }
  });
  const rows = Object.entries(bySub).sort((a, b) => b[1].unresolved - a[1].unresolved);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          [entries.length, "errors logged"],
          [tagged.filter(e => e.status === "redone-correct").length, "redone correct"],
          [streak, "day streak"],
          [clearedThisWeek, "cleared this week (all subjects)"],
        ].map(([n, lbl]) => (
          <div key={lbl} style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: "12px 18px", minWidth: 120 }}>
            <div style={{ fontFamily: serif, fontSize: 26 }}>{n}</div>
            <div style={{ fontFamily: sans, fontSize: 12.5, color: C.faint }}>{lbl}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ fontFamily: sans, fontSize: 14, color: C.faint }}>Nothing tagged yet in {tax.label} — stats appear once you've logged and tagged some errors.</div>
      ) : (
        <div style={{ border: `1px solid ${C.rule}`, borderRadius: 10, background: C.panel, padding: "6px 18px 14px" }}>
          <div style={{ fontFamily: serif, fontSize: 18, margin: "12px 0 4px" }}>Weakest subtopics first</div>
          {rows.map(([subName, b]) => {
            const pct = b.total ? Math.round((b.correct / b.total) * 100) : 0;
            return (
              <div key={subName} style={{ borderTop: `1px solid ${C.rule}`, padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontFamily: sans, fontSize: 14 }}>
                  <div style={{ fontWeight: 600 }}>{subName} <span style={{ color: C.faint, fontWeight: 400, fontSize: 12.5 }}>· {b.group || ""}</span></div>
                  <div style={{ color: C.faint, fontSize: 13 }}>
                    {b.unresolved > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{b.unresolved} unresolved · </span>}
                    {pct}% redone right
                    {b.marksAvail > 0 && <> · {b.marksGot}/{b.marksAvail} marks</>}
                  </div>
                </div>
                <div style={{ height: 6, background: C.paper, borderRadius: 3, marginTop: 7, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: pct >= 70 ? C.green : C.red, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- sync panel (view/change the code that ties devices together) ---------- */
function SyncPanel({ syncCode, onChangeSyncCode, onClose }) {
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(32,39,51,0.45)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.panel, borderRadius: 12, padding: 24, maxWidth: 420, width: "100%" }}>
        <div style={{ fontFamily: serif, fontSize: 20, marginBottom: 4 }}>Sync across devices</div>
        <div style={{ fontFamily: sans, fontSize: 13.5, color: C.faint, marginBottom: 16 }}>
          Enter this same code on any other phone or laptop to see the same error book there.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ ...inputStyle, fontFamily: "monospace", fontSize: 15, letterSpacing: 0.5, background: C.paper }}>{syncCode}</div>
          <Btn small tone="ghost" onClick={() => { navigator.clipboard.writeText(syncCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "Copied" : "Copy"}
          </Btn>
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: C.faint, marginBottom: 20 }}>
          Keep this private — anyone with this code can see and edit this error book.
        </div>

        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 16 }}>
          <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Switch to a different sync code
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Paste a code from another device" style={inputStyle} />
            <Btn small tone="ghost" disabled={!joinCode.trim()} onClick={() => setConfirming(true)}>Switch</Btn>
          </div>
          {confirming && (
            <div style={{ marginTop: 10, background: C.amberSoft, border: `1px solid ${C.amber}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontFamily: sans, fontSize: 13, color: C.amber, marginBottom: 8 }}>
                This reloads the app using the new code. You can always switch back with your current code: <b style={{ fontFamily: "monospace" }}>{syncCode}</b>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn small tone="red" onClick={() => onChangeSyncCode(joinCode.trim())}>Yes, switch</Btn>
                <Btn small tone="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
              </div>
            </div>
          )}
        </div>

        <ApiKeyPanel C={C} sans={sans} />

        <div style={{ marginTop: 18, textAlign: "right" }}>
          <Btn small tone="ghost" onClick={onClose}>Done</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- top-level app: gates on having a sync code before showing anything ---------- */
export default function App() {
  const [syncCode, setSyncCode] = useState(() => getSavedSyncCode());
  const [mode, setMode] = useState(null); // "create" | "join"
  const [joinInput, setJoinInput] = useState("");

  useEffect(() => { if (syncCode) setActiveSyncCode(syncCode); }, [syncCode]);

  const startWithCode = (code) => {
    setSavedSyncCode(code);
    setActiveSyncCode(code);
    setSyncCode(code);
  };

  if (!syncCode) {
    return (
      <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, display: "grid", placeItems: "center", padding: 20 }}>
        <div style={{ maxWidth: 440, width: "100%", background: C.panel, border: `1px solid ${C.rule}`, borderRadius: 12, padding: 28 }}>
          <div style={{ fontFamily: serif, fontSize: 26, marginBottom: 6 }}>Red Pen</div>
          <div style={{ fontFamily: sans, fontSize: 14, color: C.faint, marginBottom: 22 }}>
            Set up a sync code once, then use the same one on every device to keep your error book in sync.
          </div>

          {mode !== "join" && (
            <div style={{ marginBottom: 16 }}>
              <Btn tone="red" onClick={() => startWithCode(generateSyncCode())}>
                {mode === "create" ? "Generate my code" : "First time — create a new error book"}
              </Btn>
            </div>
          )}

          {mode !== "create" && (
            <>
              {mode !== "join" ? (
                <button onClick={() => setMode("join")} style={{ background: "none", border: "none", color: C.ink, fontFamily: sans, fontSize: 13.5, cursor: "pointer", textDecoration: "underline" }}>
                  I already have a sync code from another device
                </button>
              ) : (
                <div>
                  <div style={{ fontFamily: sans, fontSize: 13, color: C.faint, marginBottom: 6 }}>Enter your sync code</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={joinInput} onChange={e => setJoinInput(e.target.value)} placeholder="e.g. kx7q-m3np-9tzr-2vwd" style={inputStyle} />
                    <Btn tone="red" disabled={!joinInput.trim()} onClick={() => startWithCode(joinInput.trim())}>Connect</Btn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppInner
      syncCode={syncCode}
      onChangeSyncCode={(newCode) => { startWithCode(newCode); window.location.reload(); }}
    />
  );
}
