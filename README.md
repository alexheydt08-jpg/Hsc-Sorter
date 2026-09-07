# HSC Question Sorter — Chemistry & Physics 2019–2025

A self-contained, offline browser app for browsing, filtering, and building
practice tests from NSW HSC Chemistry and Physics exam questions (2019–2025).

## How to use

1. Keep this repo's files together (`index.html`, `data.js`, and the `img/`
   folder must stay in the same folder).
2. Open `index.html` in your browser — no internet connection or build step
   needed.

## What's inside

- Every Section I (multiple-choice) and Section II (extended-response)
  question from the NSW HSC Chemistry and Physics papers, 2019–2025:
  498 questions in total.
- Each question is shown as an exact image cut from the official paper, so
  every diagram, graph, table, and equation is preserved verbatim.
- "Show marking guidelines & sample answer" reveals the official NESA
  criteria table and sample answer for that question (and the answer key
  letter for multiple choice). Collapsed by default so you can self-test.
- Questions are organised by Module (5–8) and syllabus Inquiry Question,
  following each year's official NESA mapping grid. Questions that NESA
  mapped to more than one topic appear under every topic they match.
- Search plus year / section / marks filters all combine with the browse
  tree.
- **Practice tests:** click "Create practice test (PDF)". Tick whole
  modules or individual inquiry questions, set how many marks of
  multiple-choice, short-answer (2–4 mark), and long-response (5+ mark)
  questions you want, and Generate. You get a formatted paper with a title
  page (topics, total marks, recommended time), numbered questions, and an
  answer sheet of the official marking guidelines at the end. Click "Save
  as PDF" and choose "Save as PDF" as the printer destination to download
  it.

## Files

- `index.html` — the app (UI, styling, and logic).
- `data.js` — the question dataset, loaded by `index.html` as `window.QDATA`.
- `data.json` — the same dataset in plain JSON, for reuse outside the app.
- `img/` — question and marking-guideline images cropped from the official
  papers.
