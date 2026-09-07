import { useState, useMemo } from "react";
import {
  DATA,
  TAX,
  modulesFor,
  modOrder,
  ptTime,
  shuffle,
  allocate,
} from "./questionData.js";

/* the three pools a paper is built from, for the currently ticked topics */
function pools(bankSubject, checked) {
  const pool = DATA.filter(
    (r) => r.subject === bankSubject && r.tags.some((t) => checked.has(t.iq))
  );
  return {
    mc: pool.filter((r) => r.section === "I"),
    short: pool.filter((r) => r.section === "II" && r.marks <= 4),
    ext: pool.filter((r) => r.section === "II" && r.marks >= 5),
  };
}

export function PracticeTestBuilder({ bankSubject, filters, onGenerate }) {
  /* seed the topic picks from whatever is selected in the question bank */
  const [checked, setChecked] = useState(() => {
    const tax = TAX[bankSubject] || {};
    if (filters.iq) return new Set([filters.iq]);
    if (filters.module) return new Set(Object.keys(tax[filters.module] || {}));
    return new Set();
  });
  const [want, setWant] = useState({ mc: 10, short: 20, ext: 15 });
  const [error, setError] = useState("");

  const tax = TAX[bankSubject] || {};
  const mods = modulesFor(bankSubject);
  const p = useMemo(() => pools(bankSubject, checked), [bankSubject, checked]);

  const avail = {
    mc: p.mc.length,
    short: p.short.reduce((s, r) => s + r.marks, 0),
    ext: p.ext.reduce((s, r) => s + r.marks, 0),
  };
  const total = (+want.mc || 0) + (+want.short || 0) + (+want.ext || 0);

  const toggleIq = (iq) => {
    const next = new Set(checked);
    next.has(iq) ? next.delete(iq) : next.add(iq);
    setChecked(next);
  };
  const toggleMod = (m, on) => {
    const next = new Set(checked);
    for (const iq of Object.keys(tax[m] || {})) on ? next.add(iq) : next.delete(iq);
    setChecked(next);
  };

  const generate = () => {
    const mcN = Math.min(+want.mc || 0, p.mc.length);
    const mc = shuffle(p.mc).slice(0, mcN);
    const short = allocate(p.short, +want.short || 0);
    const ext = allocate(p.ext, +want.ext || 0);
    const sii = short
      .concat(ext)
      .sort((a, b) => a.marks - b.marks || b.year - a.year);
    const marks = mc.length + sii.reduce((s, r) => s + r.marks, 0);
    if (!marks) {
      setError("No questions matched — select more topics or increase the marks.");
      return;
    }
    setError("");

    /* topics grouped by module, for the title page */
    const byMod = {};
    for (const iq of checked) {
      for (const m of Object.keys(tax)) {
        if (tax[m][iq]) (byMod[m] = byMod[m] || []).push(tax[m][iq]);
      }
    }
    const topics = Object.keys(byMod)
      .sort((a, b) => modOrder(a) - modOrder(b))
      .map((m) => ({
        module: m,
        whole: byMod[m].length === Object.keys(tax[m]).length,
        list: byMod[m],
      }));

    onGenerate({ subject: bankSubject, mc, sii, total: marks, topics });
  };

  const availClass = (a, w) => `pt-avail${(+w || 0) > a ? " short" : ""}`;

  return (
    <div className="ptpanel">
      <h3>Create a practice test — {bankSubject}</h3>
      <p className="hint">
        Tick whole modules or individual inquiry questions, set how many marks of
        each question type you want, then generate. You'll get a formatted paper
        with a title page and an answer sheet of the official marking guidelines.
      </p>

      <div className="pt-tree">
        {mods.map((m) => {
          const iqs = tax[m];
          const all = Object.keys(iqs).every((iq) => checked.has(iq));
          return (
            <div key={m} className="pt-mod">
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => toggleMod(m, e.target.checked)}
                />
                {m}
              </label>
              {Object.keys(iqs).map((iq) => (
                <label key={iq} className="pt-iq">
                  <input
                    type="checkbox"
                    checked={checked.has(iq)}
                    onChange={() => toggleIq(iq)}
                  />
                  <span>
                    <b>{iqs[iq]}</b> — <i>{iq}</i>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
      </div>

      <div className="pt-marks">
        <label>
          <b>Multiple choice</b>
          <input
            type="number"
            min="0"
            value={want.mc}
            onChange={(e) => setWant({ ...want, mc: e.target.value })}
          />
          <span className={availClass(avail.mc, want.mc)}>
            {avail.mc} marks available
          </span>
        </label>
        <label>
          <b>Short answer (2–4)</b>
          <input
            type="number"
            min="0"
            value={want.short}
            onChange={(e) => setWant({ ...want, short: e.target.value })}
          />
          <span className={availClass(avail.short, want.short)}>
            {avail.short} marks available
          </span>
        </label>
        <label>
          <b>Long response (5+)</b>
          <input
            type="number"
            min="0"
            value={want.ext}
            onChange={(e) => setWant({ ...want, ext: e.target.value })}
          />
          <span className={availClass(avail.ext, want.ext)}>
            {avail.ext} marks available
          </span>
        </label>
      </div>

      <div className="pt-total">
        <b>{total} marks</b> · recommended working time ≈ {ptTime(total)}
        {!checked.size && (
          <span style={{ color: "#b04216" }}> — select at least one topic</span>
        )}
      </div>

      {error && (
        <div className="pt-total" style={{ color: "#b04216" }} role="alert">
          {error}
        </div>
      )}

      <div className="btns">
        <button
          type="button"
          className="ptbtn"
          disabled={!checked.size || !total}
          onClick={generate}
        >
          Generate practice test
        </button>
      </div>
    </div>
  );
}

/* the generated paper — rendered full-screen, printable via the browser */
export function PracticeTestPaper({ paper, onBack }) {
  const { subject, mc, sii, total, topics } = paper;
  const today = new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const ordered = mc.concat(sii);
  const siiMarks = sii.reduce((s, r) => s + r.marks, 0);

  const question = (r, n) => (
    <div className="ptq" key={`q${r.id}`}>
      <div className="qlbl">
        Question {n}{" "}
        <span style={{ fontWeight: 400 }}>
          ({r.marks} mark{r.marks === 1 ? "" : "s"})
        </span>
      </div>
      <div className="src">
        Source: {r.year} HSC {r.subject} · Q{r.questionNumber}
      </div>
      {r.questionImages.map((p) => (
        <img key={p} src={p} alt="" />
      ))}
    </div>
  );

  return (
    <div className="pt-print">
      <div className="pt-toolbar">
        <button type="button" className="ptbtn" onClick={() => window.print()}>
          ⬇ Save as PDF
        </button>
        <button type="button" className="back" onClick={onBack}>
          ← Back to the app
        </button>
        <span className="tip">
          In the print dialog choose “Save as PDF” as the destination.
        </span>
      </div>

      <div className="pt-doc">
        <div className="pt-title pt-titlepage">
          <div className="crest">Practice examination · generated {today}</div>
          <h1>{subject}</h1>
          <h2>Practice Test</h2>
          <div className="pt-meta">
            <div>
              <b>Total marks:</b> {total}
            </div>
            <div>
              <b>Questions:</b> {mc.length} multiple choice · {sii.length}{" "}
              extended response
            </div>
            <div>
              <b>Recommended time:</b> {ptTime(total)} (plus 5 minutes reading
              time)
            </div>
          </div>
          <div className="pt-topics">
            <h4 style={{ textAlign: "center" }}>Topics included</h4>
            {topics.map((t) => (
              <div key={t.module}>
                <h4>{t.module}</h4>
                <ul>
                  {t.whole ? (
                    <li>Entire module</li>
                  ) : (
                    t.list.map((x, i) => <li key={i}>{x}</li>)
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {mc.length > 0 && (
          <>
            <div className="pt-sechdr">Section I — Multiple choice</div>
            <p className="pt-secsub">
              {mc.length} marks · Attempt Questions 1–{mc.length} · Allow about{" "}
              {ptTime(mc.length)} for this section
            </p>
            {mc.map((r, i) => question(r, i + 1))}
          </>
        )}

        {sii.length > 0 && (
          <>
            <div className="pt-sechdr">
              Section {mc.length ? "II" : "I"} — Extended response
            </div>
            <p className="pt-secsub">
              {siiMarks} marks · Show all relevant working in questions involving
              calculations
            </p>
            {sii.map((r, i) => question(r, mc.length + i + 1))}
          </>
        )}

        <div className="pt-ans-start" />
        <div className="pt-sechdr">
          Answer sheet — marking guidelines &amp; sample answers
        </div>
        <p className="pt-secsub">
          Official NESA criteria and sample answers for every question in this
          test. Mark yourself honestly!
        </p>
        {ordered.map((r, i) => (
          <div className="ptq" key={`a${r.id}`}>
            <div className="qlbl">Question {i + 1}</div>
            <div className="src">
              {r.year} HSC {r.subject} · Q{r.questionNumber} — official NESA
              marking guidelines
            </div>
            {r.section === "I" ? (
              <div className="pt-mcans">
                Answer: <b>{r.answer || "?"}</b>
              </div>
            ) : (
              r.mgImages.map((p) => <img key={p} src={p} alt="" />)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
