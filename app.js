/* ==========================================================================
   Shared shell: the subject, the current view, and the small helpers both
   halves of the app use. Loaded before sorter.js and marker.js.
   ========================================================================== */
"use strict";

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

/* Subject is global — the browser, the practice-test maker and the marker all
   follow the same one, so switching it up top switches the whole app. */
const APP = {
  subject: "Chemistry",
  view: "browse",
  onSubject: [],   // listeners, registered by each half
  onView: [],
};

function setSubject(s){
  if (!s || s === APP.subject) return;
  APP.subject = s;
  document.body.classList.toggle("phys", s === "Physics");
  drawSubjects();
  APP.onSubject.forEach(fn => fn(s));
}

function setView(v){
  APP.view = v;
  $$("#views button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  $$(".view").forEach(el => el.classList.toggle("hidden", el.id !== "view-" + v));
  APP.onView.forEach(fn => fn(v));
  window.scrollTo({ top: 0 });
}

function drawSubjects(){
  const host = $("#subjects");
  host.textContent = "";
  for (const s of ["Chemistry", "Physics"]){
    const n = (window.QDATA || []).filter(r => r.subject === s).length
            + (window.TDATA || []).filter(r => r.subject === s).length;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(s === APP.subject));
    b.innerHTML = `${esc(s)}<span class="n">${n}</span>`;
    b.addEventListener("click", () => setSubject(s));
    host.appendChild(b);
  }
}

$$("#views button").forEach(b =>
  b.addEventListener("click", () => setView(b.dataset.view)));

drawSubjects();
document.body.classList.toggle("phys", APP.subject === "Physics");
