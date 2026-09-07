# HSC Sorter — questions, practice papers and AI marking

One app for NSW HSC Chemistry and Physics, 2019–2025. Plain HTML, CSS and
JavaScript — no build step, no framework, no server. Live at
**https://alexheydt08-jpg.github.io/Hsc-Sorter/**

Four sections, all sharing the subject you pick in the header:

**Browse questions** — every Section I and Section II question from the 2019–2025
papers, 498 in total, each shown as an exact image cut from the official paper so
diagrams, graphs and equations are preserved verbatim. Organised by Module (5–8)
and syllabus Inquiry Question following each year's official NESA mapping grid,
with search and year / section / marks filters that all combine. "Show marking
guidelines & sample answer" reveals the official NESA criteria, collapsed by
default so you can self-test first.

**Practice test** — tick whole modules or individual inquiry questions, set how
many marks of multiple choice, short answer (2–4) and long response (5+) you
want, and generate a formatted paper: title page with topics and recommended
time, numbered questions, and an answer sheet of the official marking guidelines
at the end. Print it or save it as a PDF.

**Mark my answer** — hand in a question and your attempt and get it marked
strictly against NESA conventions: a mark out of the total, a mark-by-mark
breakdown of what each criterion did or didn't earn, a marker's comment, and what
would have picked up the rest. Work can be typed, photographed, attached as a PDF,
given as one file containing both question and answer, or pulled out of a whole
exam paper by question number. Supplying the real marking guidelines makes the
marks match NESA exactly; leave them out and it builds an HSC-style breakdown
itself and says so.

**Bank** — every marked response you save, filtered by subject and module, with
your answer, the comment and the fixes. Export and import it as JSON.

## What ties the two halves together

Every question in Browse has a **✎ Mark my answer** button. It sends that
question to the marker with the exact question image *and* the official NESA
marking guidelines already attached — so the marker grades against the real
criteria rather than inferring its own. Type your attempt and mark it. Anything
you bank from there keeps a link back, so "Try it again" reopens the same
question later.

## Your API key

Marking calls the Anthropic API straight from your browser using a key you paste
in under **Mark my answer**. That key is:

- stored only in that browser's `localStorage`;
- never committed, never in the published page, never sent anywhere but
  `api.anthropic.com`;
- needed again on each device you use.

Get one at [console.anthropic.com](https://console.anthropic.com) — it is
pay-as-you-go and separate from any Claude subscription. **Set a monthly spend
limit while you're there.** Marking one question costs a fraction of a cent.
Pick the model at the top of the marker: Opus 5 marks most carefully, Sonnet 5 is
cheaper, Haiku 4.5 cheaper still.

Because everyone brings their own key, nobody visiting the site can spend yours.
The trade-off of having no server is that a key in `localStorage` is readable by
anything that can run script on this origin, so use a spend limit and revoke the
key if a device is lost. **Never paste a key into the source and commit it** —
this repository is public, and a key in a deployed page is readable by every
visitor.

## Running it locally

No build step. Serve the folder over HTTP so `fetch` can read the question
images:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight off disk mostly
works, but the browser blocks the image attaching that "Mark my answer" uses.)

## Deploying

Pushing to `claude/github-files-creation-606838` triggers
`.github/workflows/deploy.yml`, which publishes the folder as-is to GitHub Pages
— there is nothing to build. The repo's Pages source is set to **GitHub Actions**;
switching it to "Deploy from a branch" would serve these files directly and make
the workflow unnecessary.

## Files

```
index.html   the shell and the markup for all four sections
app.css      the whole design system
app.js       shared shell: the subject, the section tabs
sorter.js    browse, filters, the tree, the practice-test maker
marker.js    the marker, the Anthropic call, the bank
data.js      the 498 questions (window.QDATA)
data.json    the same data as plain JSON, for reuse
img/         901 question and marking-guideline images
```

Question and marking-guideline content © NSW Education Standards Authority
(NESA), reproduced from the published HSC examination papers and marking
guidelines for personal study. AI marking is a study aid, not an official mark.
