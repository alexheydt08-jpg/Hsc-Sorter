# HSC Sorter — question bank, practice tests and error book

One app, two halves:

- **Question bank & Practice test** — every Section I and Section II question
  from the NSW HSC Chemistry and Physics papers, 2019–2025 (498 questions),
  each shown as an exact image cut from the official paper, with the official
  NESA marking guidelines and sample answers collapsed until you ask for them.
  Build a practice paper from any mix of modules and inquiry questions and save
  it as a PDF.
- **Error book (Red Pen)** — log the questions you got wrong, tag them against
  the syllabus, and redo them on a spaced-repetition schedule (2 days → 1 week →
  2 weeks → monthly). Entries sync across your devices via a sync code.
  Optional AI marking gives you a second opinion on a redo.

Vite + React 18, deployed as static files to GitHub Pages by GitHub Actions.
No server and no third-party hosting. Error-book entries live in Supabase; the
question bank ships with the app as static data and is never written to.

Live at **https://alexheydt08-jpg.github.io/Hsc-Sorter/**

## Running it locally

```bash
npm install
cp .env.example .env     # then paste in your Supabase URL and anon key
npm run dev
```

Open the address it prints (usually http://localhost:5173). Everything works
locally, AI marking included — there is no serverless function to emulate.

## Deploying

Pushing to `claude/github-files-creation-606838` triggers
`.github/workflows/deploy.yml`, which builds the app and publishes it to GitHub
Pages. Nothing else to run.

One-time setup in the repo's **Settings**:

1. **Pages → Build and deployment → Source: GitHub Actions.**
   (Not "Deploy from a branch" — the app needs a build step.)
2. **Secrets and variables → Actions → Variables**, add two *repository
   variables*:

   | Variable | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | your Supabase anon public key |

   These are variables rather than secrets on purpose: the `VITE_` prefix puts
   them in the browser bundle by design, so marking them secret would imply a
   protection they don't have.

The site is served from `/Hsc-Sorter/`, which `vite.config.js` sets as the base
path. To serve from a domain root instead, build with `BASE_PATH=/`.

## AI marking

Off by default. Each entry chooses its own mode, set when you log the error or
later in the tag editor:

- **Off** — no AI involvement.
- **Against my criteria** — marks strictly against the marking criteria you
  saved on that entry, and won't invent criteria you didn't give it.
- **Fully automatic** — no criteria needed. It works out the correct answer
  itself, marks you against that, and says it did so.

The AI's opinion is advisory. It never sets your tick or cross and never touches
your revision schedule — only your own ✓/✗ does that. Where it suggests a mark,
"Use this mark" fills in the marks box for you, and you still confirm.

### Your API key

Because the app is static files with no server behind it, marking calls
Anthropic straight from your browser using a key **you** paste in under
**⇄ Sync → AI marking key**. That key:

- is stored only in that browser's `localStorage`;
- is never committed, never in the build, and never in the repo;
- has to be added again on each device you use.

Get one at [console.anthropic.com](https://console.anthropic.com) and set a
monthly spend limit while you're there — marking one question costs a fraction
of a cent, on `claude-opus-5`.

**The trade-off.** A key in `localStorage` is readable by anything that can run
script on this origin, and by anyone with access to the unlocked device. That is
the price of having no server; a server-side key would need a host like Vercel,
which this setup deliberately avoids. Mitigate it with a spend limit, and revoke
the key in the Anthropic console if a device is lost. Since every user brings
their own key, nobody else visiting the site can spend your credit.

## Supabase setup

One table, created once in the SQL Editor:

```sql
create table kv_store (
  sync_code text not null,
  key text not null,
  value text,
  updated_at timestamptz default now(),
  primary key (sync_code, key)
);

alter table kv_store enable row level security;

create policy "allow all access"
  on kv_store for all using (true) with check (true);
```

**On privacy:** that policy lets anyone reach the table, and the anon key ships
inside the browser bundle by design. Your sync code is long and random so it
isn't guessable, but treat it like a password and don't post it publicly. There
is no login and no password recovery — if you lose the sync code you lose access
to those entries, so save it somewhere other than the phone it's on.

## Installing it on your phone

Open the Pages URL, tap **⇄ Sync**, paste your existing sync code, then use
**Share → Add to Home Screen** (iPhone) or **Install app** from the browser menu
(Android).

## Project structure

```
.github/workflows/deploy.yml  build + publish to GitHub Pages
src/App.jsx                   error book + the shared nav shell
src/QuestionBank.jsx          browse/filter the 498 questions
src/PracticeTest.jsx          practice paper builder + printable paper
src/AiMarking.jsx             marking mode picker, suggestion card, key panel
src/marking.js                the Anthropic call, prompt and result schema
src/questionData.js           question data, taxonomy and paper-building helpers
src/bankMeta.js               subject mapping (kept data-free so it loads eagerly)
src/syncStore.js              Supabase read/write
src/data/questions.json       the 498 questions
public/img/                   901 question and marking-guideline images
```

Three things are code-split so the error book — the part used daily — opens
fast on a phone: the question data (~1.1MB), the bank views, and the Anthropic
SDK, which is fetched only when you actually ask for a marking.
