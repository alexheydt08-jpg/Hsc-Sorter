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

Built with Vite + React 18. Error-book entries live in Supabase; the question
bank ships with the app as static data and is never written to.

## Running it locally

```bash
npm install
cp .env.example .env     # then paste in your Supabase URL and anon key
npm run dev
```

Open the address it prints (usually http://localhost:5173).

`npm run dev` runs the React app but **not** `api/mark.js` — Vite's dev server
doesn't serve serverless functions, so "Ask AI to mark this" will fail locally.
To test marking before deploying, run `npx vercel dev` instead, with
`ANTHROPIC_API_KEY` added to your `.env`.

## Deploying

Import the repo at [vercel.com/new](https://vercel.com/new). It detects Vite
automatically; leave **Root Directory** as the repo root so `api/` is picked up.

Environment variables to set in the Vercel dashboard:

| Variable | Where it's used | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | from Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | browser | same place |
| `ANTHROPIC_API_KEY` | server only | from [console.anthropic.com](https://console.anthropic.com) — **no `VITE_` prefix**, that prefix would publish it to the browser |

Environment variables only take effect on a new deployment, so redeploy after
adding them. AI marking stays switched off until `ANTHROPIC_API_KEY` is set —
the app says so rather than breaking.

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

Marking runs server-side in `api/mark.js` on `claude-opus-5`, so the API key
never reaches the browser. Each marked question costs a fraction of a cent; set
a monthly spend limit in the Anthropic console.

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

## Project structure

```
api/mark.js            AI marking endpoint (Vercel serverless, server-side key)
src/App.jsx            error book + the shared nav shell
src/QuestionBank.jsx   browse/filter the 498 questions
src/PracticeTest.jsx   practice paper builder + printable paper
src/AiMarking.jsx      marking mode picker + suggestion card
src/questionData.js    question data, taxonomy and paper-building helpers
src/bankMeta.js        subject mapping (kept data-free so it loads eagerly)
src/syncStore.js       Supabase read/write
src/data/questions.json  the 498 questions
public/img/            901 question and marking-guideline images
```

The question bank is code-split: its ~1.1MB of data loads only when you open
the Question bank or Practice test, so the error book opens fast on a phone.
