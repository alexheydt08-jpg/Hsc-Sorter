import Anthropic from "@anthropic-ai/sdk";

/* Vercel serverless function.
 *
 * The Anthropic key is read from process.env.ANTHROPIC_API_KEY and never leaves
 * the server. It must NOT be given a VITE_ prefix — that prefix is what publishes
 * a variable into the browser bundle.
 *
 * Two marking modes:
 *   "criteria" — mark strictly against the marking criteria saved on the entry.
 *   "auto"     — no criteria saved; work out the correct answer first, then mark
 *                against that, and say so in the response.
 */

const MODEL = "claude-opus-5";

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      description:
        "A short verdict. When marks are available this summarises the result; when not, exactly 'Looks correct' or 'Not quite there'.",
    },
    marksAwarded: {
      type: ["integer", "null"],
      description:
        "Whole-number mark out of marksAvailable, or null when no marks were supplied.",
    },
    feedback: {
      type: "string",
      description:
        "Two to four sentences of specific feedback naming what the attempt did and did not earn.",
    },
    markedWithoutCriteria: {
      type: "boolean",
      description:
        "True when no official marking criteria were supplied and the answer was worked out independently.",
    },
  },
  required: ["verdict", "marksAwarded", "feedback", "markedWithoutCriteria"],
  additionalProperties: false,
};

const SYSTEM = `You are marking a single NSW HSC question for a student's error book.

Be strict and specific. Never inflate a mark to be encouraging — an inflated mark
teaches the student nothing. Feedback must name what the attempt actually did and
did not earn, in 2-4 sentences, in plain Australian English. Address the student
as "you".

If marksAvailable is given, award a whole-number mark between 0 and marksAvailable
and put it in marksAwarded. If it is not given, set marksAwarded to null and make
verdict exactly "Looks correct" or "Not quite there".

CRITERIA MODE: mark strictly against the marking criteria supplied. Apply only
those criteria. Do not invent criteria that were not given, and do not award marks
for merit the criteria do not recognise. Set markedWithoutCriteria to false.

AUTO MODE: no official criteria were supplied. Work out the correct answer to the
question yourself, then mark the attempt against it. Set markedWithoutCriteria to
true, and open your feedback by noting you marked this without the official NESA
criteria so the student reads the mark with appropriate caution.`;

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "Use POST to mark an attempt.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(
      res,
      503,
      "AI marking isn't configured yet — add ANTHROPIC_API_KEY in your Vercel project settings (no VITE_ prefix) and redeploy."
    );
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return fail(res, 400, "Couldn't read the request — malformed JSON.");
    }
  }
  if (!body || typeof body !== "object") {
    return fail(res, 400, "Couldn't read the request — no body was sent.");
  }

  const {
    subject = "",
    subtopic = "",
    questionText = "",
    criteriaText = "",
    attemptText = "",
    marksAvailable = null,
    mode = "criteria",
  } = body;

  if (!String(attemptText).trim()) {
    return fail(
      res,
      400,
      "There's nothing to mark — write your attempt as text first. The AI can't read photo attempts."
    );
  }
  if (!String(questionText).trim()) {
    return fail(
      res,
      400,
      "This entry has no question text saved, so there's nothing to mark against."
    );
  }
  if (mode !== "criteria" && mode !== "auto") {
    return fail(res, 400, `Unknown marking mode "${mode}".`);
  }
  if (mode === "criteria" && !String(criteriaText).trim()) {
    return fail(
      res,
      400,
      "No marking criteria are saved on this entry. Add criteria, or switch that entry to automatic marking."
    );
  }

  const marks = Number.isFinite(Number(marksAvailable))
    ? Number(marksAvailable)
    : null;

  const prompt = [
    `MODE: ${mode === "criteria" ? "CRITERIA" : "AUTO"}`,
    subject && `Subject: ${subject}`,
    subtopic && `Subtopic: ${subtopic}`,
    marks ? `Marks available: ${marks}` : "Marks available: not specified",
    "",
    "QUESTION:",
    String(questionText).trim(),
    "",
    mode === "criteria"
      ? `OFFICIAL MARKING CRITERIA:\n${String(criteriaText).trim()}`
      : "OFFICIAL MARKING CRITERIA: none supplied — work out the correct answer yourself.",
    "",
    "THE STUDENT'S ATTEMPT:",
    String(attemptText).trim(),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: { type: "json_schema", schema: RESULT_SCHEMA },
      },
    });

    if (response.stop_reason === "refusal") {
      return fail(
        res,
        422,
        "The model declined to mark this one. Mark it yourself this time."
      );
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail(
        res,
        502,
        "The marking came back in a format we couldn't read. Try again."
      );
    }

    /* never report a mark above what the question is worth */
    let awarded = parsed.marksAwarded;
    if (typeof awarded === "number" && marks) {
      awarded = Math.max(0, Math.min(marks, Math.round(awarded)));
    } else if (typeof awarded !== "number") {
      awarded = null;
    }

    return res.status(200).json({
      verdict: String(parsed.verdict || "").trim(),
      marksAwarded: awarded,
      marksAvailable: marks,
      feedback: String(parsed.feedback || "").trim(),
      markedWithoutCriteria: Boolean(parsed.markedWithoutCriteria),
      model: MODEL,
    });
  } catch (err) {
    const status = err?.status;
    if (status === 401 || status === 403) {
      return fail(res, 502, "The Anthropic API rejected the key configured for this app.");
    }
    if (status === 429) {
      return fail(res, 429, "Rate limited by the Anthropic API — wait a moment and try again.");
    }
    if (typeof status === "number" && status >= 500) {
      return fail(res, 502, "The Anthropic API is having trouble. Try again shortly.");
    }
    console.error("mark.js failed:", err);
    return fail(res, 500, "Marking failed. Mark it yourself this time.");
  }
}
