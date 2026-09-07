import { useState, useEffect, useMemo, useCallback } from "react";
import {
  DATA,
  TAX,
  baseFilter,
  modulesFor,
  yearsFor,
  imgSrc,
} from "./questionData.js";

const PAGE = 25;

/* one question card — marking guidelines collapsed until asked for */
function QCard({ r, onPickTag }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`qcard${open ? " open" : ""}`}>
      <div className="qhead">
        <span className="qtitle">
          {r.year} · Q{r.questionNumber}
        </span>
        <span className="marksq">
          {r.marks} mark{r.marks === 1 ? "" : "s"}
        </span>
        <span className="badge">
          Section {r.section} —{" "}
          {r.section === "I" ? "multiple choice" : "extended response"}
        </span>
        <span className="badge">{r.subject}</span>
      </div>

      <div className="tagline">
        {r.tags.map((t, i) => (
          <button
            key={i}
            type="button"
            className="tag"
            title={t.iq}
            onClick={() => onPickTag(t.module, t.iq)}
          >
            {t.module.replace("Module", "Mod").split(":")[0]} · {t.topic}
          </button>
        ))}
      </div>

      <div className="qimgs">
        {r.questionImages.map((p) => (
          <img
            key={p}
            loading="lazy"
            src={imgSrc(p)}
            alt={`Question ${r.questionNumber}, ${r.year} HSC ${r.subject}`}
          />
        ))}
      </div>

      <div className="reveal">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"} marking guidelines &amp; sample answer
        </button>
        {open && (
          <div className="mg">
            <div className="mghdr">Official NESA marking guidelines</div>
            {r.section === "I" && (
              <div className="mcans">
                Correct answer: <b>{r.answer || "?"}</b>
              </div>
            )}
            {r.mgImages.map((p) => (
              <img
                key={p}
                loading="lazy"
                src={imgSrc(p)}
                alt={`Marking guidelines for question ${r.questionNumber}`}
              />
            ))}
            {r.parts.length > 1 && (
              <div className="parts">
                Parts:{" "}
                {r.parts
                  .map((p) => `${p.part ? `(${p.part})` : ""} ${p.marks} mk`)
                  .join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function QuestionBank({ bankSubject, filters, setFilters }) {
  const [shown, setShown] = useState(PAGE);
  const [navOpen, setNavOpen] = useState(false);

  const f = { ...filters, subject: bankSubject };

  const matched = useMemo(
    () =>
      DATA.filter((r) => baseFilter(r, f)).sort(
        (a, b) => b.year - a.year || a.questionNumber - b.questionNumber
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bankSubject, filters.years, filters.section, filters.marks, filters.q, filters.module, filters.iq]
  );

  /* counts for the tree ignore the tree's own narrowing, as in the original */
  const treeMatched = useMemo(
    () => DATA.filter((r) => baseFilter(r, f, true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bankSubject, filters.years, filters.section, filters.marks, filters.q]
  );

  useEffect(() => setShown(PAGE), [matched]);

  /* infinite scroll, 25 at a time */
  useEffect(() => {
    const onScroll = () => {
      if (
        shown < matched.length &&
        window.innerHeight + window.scrollY > document.body.offsetHeight - 900
      ) {
        setShown((s) => s + PAGE);
      }
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [shown, matched.length]);

  const set = useCallback(
    (patch) => setFilters((prev) => ({ ...prev, ...patch })),
    [setFilters]
  );

  const pickTag = (module, iq) => {
    set({ module, iq, openMods: new Set([...filters.openMods, module]) });
    window.scrollTo({ top: 0 });
  };

  const mods = modulesFor(bankSubject);
  const years = yearsFor(bankSubject);
  const tax = TAX[bankSubject] || {};

  const toggleYear = (y) => {
    const next = new Set(filters.years);
    next.has(y) ? next.delete(y) : next.add(y);
    set({ years: next });
  };

  const clearAll = () =>
    set({
      q: "",
      years: new Set(),
      section: "",
      marks: "",
      module: null,
      iq: null,
    });

  const crumbTopic =
    filters.iq && filters.module ? (tax[filters.module] || {})[filters.iq] : "";

  return (
    <div className="wrap">
      <nav className={`tree${navOpen ? " open" : ""}`}>
        <button
          type="button"
          className="navtoggle"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
        >
          Browse by module &amp; inquiry question <span>▾</span>
        </button>
        <div className="treebox">
          <h2>Modules 5–8 · Year 12</h2>
          <div>
            <button
              type="button"
              className={`allbtn${!filters.module && !filters.iq ? " on" : ""}`}
              onClick={() => set({ module: null, iq: null })}
            >
              All questions
              <span className="cnt">{treeMatched.length}</span>
            </button>

            {mods.map((m) => {
              const iqs = tax[m];
              const open = filters.openMods.has(m) || filters.module === m;
              const mN = treeMatched.filter((r) =>
                r.tags.some((t) => t.module === m)
              ).length;
              return (
                <div key={m} className={`mod${open ? " open" : ""}`}>
                  <button
                    type="button"
                    className={
                      filters.module === m && !filters.iq ? "on" : undefined
                    }
                    onClick={() => {
                      const nextOpen = new Set(filters.openMods);
                      if (filters.module === m && !filters.iq) {
                        nextOpen.delete(m);
                        set({ module: null, iq: null, openMods: nextOpen });
                      } else {
                        nextOpen.add(m);
                        set({ module: m, iq: null, openMods: nextOpen });
                      }
                    }}
                  >
                    <span className="name">{m}</span>
                    <span className="cnt">{mN}</span>
                  </button>
                  <div className="iqs">
                    {Object.keys(iqs).map((iq) => {
                      const n = treeMatched.filter((r) =>
                        r.tags.some((t) => t.iq === iq)
                      ).length;
                      return (
                        <button
                          type="button"
                          key={iq}
                          className={`iq${filters.iq === iq ? " on" : ""}`}
                          onClick={() => {
                            const nextOpen = new Set(filters.openMods);
                            nextOpen.add(m);
                            set({
                              module: m,
                              iq: filters.iq === iq ? null : iq,
                              openMods: nextOpen,
                            });
                            if (window.innerWidth <= 900) {
                              setNavOpen(false);
                              window.scrollTo({ top: 0 });
                            }
                          }}
                        >
                          <span className="t">
                            <b>{iqs[iq]}</b>
                            <i>{iq}</i>
                          </span>
                          <span className="cnt">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </nav>

      <main>
        <div className="controls">
          <div className="search">
            <input
              value={filters.q}
              onChange={(e) => set({ q: e.target.value.trim() })}
              placeholder="Search question text, module, topic…"
              aria-label="Search questions"
            />
          </div>
          <div className="filters">
            <div className="fgroup">
              <span className="lbl">Year</span>
              {years.map((y) => (
                <button
                  type="button"
                  key={y}
                  className={`chip${filters.years.has(y) ? " on" : ""}`}
                  onClick={() => toggleYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="fgroup">
              <span className="lbl">Section</span>
              <select
                value={filters.section}
                onChange={(e) => set({ section: e.target.value })}
                aria-label="Section"
              >
                <option value="">Any</option>
                <option value="I">I — multiple choice</option>
                <option value="II">II — extended response</option>
              </select>
            </div>
            <div className="fgroup">
              <span className="lbl">Marks</span>
              <select
                value={filters.marks}
                onChange={(e) => set({ marks: e.target.value })}
                aria-label="Marks"
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
                <option value="8+">8+</option>
              </select>
            </div>
            <button type="button" className="clearf" onClick={clearAll}>
              Clear filters
            </button>
          </div>
        </div>

        <div className="crumb">
          <b>{bankSubject}</b>
          {filters.module && (
            <>
              {" → "}
              <b>{filters.module}</b>
            </>
          )}
          {filters.iq && (
            <>
              {" → "}
              <b>{crumbTopic}</b> — <i>“{filters.iq}”</i>
            </>
          )}
          <span className="count">
            · {matched.length} question{matched.length === 1 ? "" : "s"}
          </span>
        </div>

        {matched.length === 0 ? (
          <div className="empty">
            No questions match. Try clearing a filter or broadening the search.
          </div>
        ) : (
          matched
            .slice(0, shown)
            .map((r) => <QCard key={r.id} r={r} onPickTag={pickTag} />)
        )}
      </main>
    </div>
  );
}
