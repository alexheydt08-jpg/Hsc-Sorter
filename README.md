# HSC Sorter — questions, practice papers and AI marking

One app for NSW HSC Chemistry and Physics, 2019–2025. Plain HTML, CSS and
JavaScript — no build step, no framework, no server. Live at
**https://alexheydt08-jpg.github.io/Hsc-Sorter/**

Four sections, all sharing the subject you pick in the header:

**Browse questions** — 2863 questions in all: the 498 from the NESA HSC papers
plus 2365 cut from 75 school trial papers. Each is an exact image taken from the
paper, so diagrams, graphs and equations are preserved verbatim. Organised by
Module (5–8) and syllabus Inquiry Question, with search and paper / school /
year / section / marks filters that all combine. "Show marking guidelines &
sample answer" reveals the criteria, collapsed by default so you can self-test
first — the official NESA guidelines for HSC questions, the school's own
solutions for trial questions.

|            | HSC  | Trials | Total |
| ---------- | ---: | -----: | ----: |
| Chemistry  |  255 |   1246 |  1501 |
| Physics    |  243 |   1119 |  1362 |

## The trial papers

75 papers, 2019–2025, from Ascham, Baulkham Hills, Girraween, James Ruse,
Normanhurst Boys, North Sydney Boys, North Sydney Girls, Sydney Boys, Sydney
Girls and Sydney Grammar — 40 Chemistry and 35 Physics.

Unlike the NESA questions, these carry no official syllabus mapping, so each is
tagged automatically. Three views of a question are scored across all sixteen
topics of its subject and combined: its nearest neighbours among the
NESA-tagged questions (TF-IDF), how much of its vocabulary matches the
**syllabus text** for each topic (weighted by inverse document frequency, so
"commutator" and "titre" count for more than "velocity"), and a set of keyword
rules. The syllabus is also seeded into the neighbour index, so a topic can be
recognised from the syllabus itself rather than only from past questions that
happen to resemble it.

Measured leave-one-out against the NESA set, using question text alone because
that is all a trial question offers:

|           | placed | topic | module |
| --------- | -----: | ----: | -----: |
| Chemistry |    91% |   74% |    91% |
| Physics   |    95% |   84% |    95% |

Where the three views agree the tag is taken as-is; where they only partly
agree the card is badged **auto-tagged** so you know to check it. Below a
confidence floor nothing is applied at all, and the question is collected under
**Unsorted — needs a topic**, where it stays searchable and filterable by
school and year rather than being filed under a topic it may not belong to. 139
questions sit there. They are not offered in the practice-test builder, which
selects by topic.

Segmentation is automatic too, and a few papers resist it. Sydney Grammar 2019
(Physics) yields only 4 questions — its multiple-choice numbering is not in the
text layer and does not survive OCR. A handful of others are missing part of a
section, and some papers were published without solutions, in which case the
card says so instead of offering a reveal button.

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

**Bank** — a spaced-repetition flashcard system, in the style of Anki. Three
tabs:

- **Study** — a dashboard of what is due, new cards left today, reviews done and
  your streak, then the reviewer itself: the question, *Show answer* (or the
  space bar), and *Again / Hard / Good / Easy* rating each card, with keys 1–4.
  While a card is up everything else on the page is hidden. Custom study can
  run through starred cards, cards you keep forgetting, or the whole collection
  shuffled.
- **Cards** — the browser: search across questions, answers, notes and tags,
  filter by subject, module or starred, sort by newest or by due date, then
  edit or delete. Editing a card keeps its review history.
- **Add card** — type or paste a question and an answer, attach or drop images
  into either side, pick a module and tick any inquiry questions that apply.
  Saving leaves the form open so the next card can go straight in.
- **Stats** — reviewed today, time studied, streak, due tomorrow, retention,
  cards learned and forgotten, average answer time, and a 26-week activity
  heatmap. Retention counts only reviews of cards that had already left the
  learning steps: meeting a new card and getting it wrong is not forgetting.

Scheduling is SM-2, the algorithm Anki derives from: each card carries an ease
factor that falls when you get it wrong and rises when it is easy, and the next
gap is the last one multiplied by that ease. A forgotten card drops back to a
one-minute step and returns in the same session; a card you know goes 1 day, 6
days, then further out each time.

Marking an answer offers to save it as a card. The question and its image go on
the front, and **the correct answer goes on the back** — the marking guidelines
where they exist, the official option for multiple choice, otherwise the
marker's account of what the marks needed, which the card says plainly so you
can correct it. The module and inquiry questions arrive already selected when
the question came from Browse.

## Sync across devices

Optional, set up under **Bank → Sync across devices**. Every device keeps the
same collection through **a private GitHub repository you own** — no server, the
browser talks to `api.github.com` directly.

Two steps, once: create an empty private repository, then a **fine-grained
personal access token** with *Contents: read and write* **on that repository
only**. Each device gets its own token and points at the same repository. The
token lives in that browser's `localStorage`, exactly like the Anthropic key,
and is never written into the repository.

The repo holds `cards.json` — every card, its scheduling and its review history
— plus one file per uploaded picture under `images/`, written once and never
rewritten. Syncing runs when the Bank is opened, a few seconds after an edit,
and on demand from **Sync now**.

A note on why a repository and not a gist: a "secret" gist is only *unlisted*,
so anyone holding the URL can read it, and the Gists API still requires a
classic token whose scope covers **every** gist on the account. A private repo
is genuinely private and the token can be scoped to it alone.

Deleting a card leaves a tombstone rather than removing the row, because a
deletion has to be able to travel — otherwise the other device cannot tell
"deleted here" from "not created here yet" and sends the card straight back.
Tombstones are purged after 60 days.

Where two devices edit the same card before either syncs, the later edit wins
for that card as a whole. Sync is not instant and is not a live connection.

Uploaded photos are downscaled to 1600px on the long edge and re-encoded as
WebP when they are added — a phone photo of a question becomes a couple of
hundred kilobytes with no loss of legibility, which keeps the local store small
and every image inside the size GitHub returns inline.

Cards live in this browser's IndexedDB, which is what makes photo cards
possible — `localStorage` holds about 5 MB of text and a single phone photo
would fill it. Images already in this repository are stored as paths rather
than copies, so a card made from a past question costs nothing. **Export**
writes the whole collection, review history and images included, to one file;
**Import** merges it back and keeps whichever side has the later review, so
carrying a laptop collection to a phone never wipes the phone's progress.
Nothing syncs on its own — there is no server — so the Bank asks you to export
now and again.

## What ties the two halves together

Every question in Browse has a **✎ Mark my answer** button. It sends that
question to the marker with the exact question image *and* its marking
guidelines already attached — NESA's for an HSC question, the school's own
solutions for a trial one — so the marker grades against the real criteria
rather than inferring its own. Type your attempt and mark it. Anything
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
syllabus.js  NESA module and inquiry-question order, used to sort the tree
app.css      the whole design system
app.js       shared shell: the subject, the section tabs
sorter.js    browse, filters, the tree, the practice-test maker
marker.js    the marker and the Anthropic call
cards.js     flashcards: IndexedDB store, SM-2 scheduling, the Bank views
sync.js      optional sync of the collection through a private GitHub repo
data.js      the 498 NESA HSC questions (window.QDATA)
data.json    the same data as plain JSON, for reuse
trials.js    the 2365 trial-paper questions (window.TDATA)
img/         901 NESA question and marking-guideline images
img/trials/  5566 trial-paper question and solution images
```

Question and marking-guideline content © NSW Education Standards Authority
(NESA), reproduced from the published HSC examination papers and marking
guidelines for personal study. Trial paper content remains the property of the
schools that set the papers, reproduced here for personal study. AI marking is a
study aid, not an official mark.
