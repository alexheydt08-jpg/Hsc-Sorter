/* AI marking, called straight from the browser.
 *
 * There is no server: the app is static files on GitHub Pages. So the Anthropic
 * key is supplied by you at runtime and kept in this browser's localStorage —
 * it is never committed, never in the build, and never sent anywhere except to
 * api.anthropic.com. Each browser you use needs its own copy of the key.
 *
 * The trade-off vs a server-side key: anyone with access to this device (or
 * anything that can run script on this origin) can read the key out of
 * localStorage. Use a key with a spend limit set in the Anthropic console, and
 * revoke it there if the device is lost.
 */

const MODEL = "claude-opus-5";
const KEY_STORAGE = "redpen_anthropic_key";

export const getApiKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
};
export const setApiKey = (k) => {
  try {
    k ? localStorage.setItem(KEY_STORAGE, k.trim()) : localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
};
export const hasApiKey = () => Boolean(getApiKey());

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

class MarkingError extends Error {}

/* Marks one attempt. Throws MarkingError with a readable message on any failure
   so the caller can show it as-is. */
export async function markAttempt({
  subject = "",
  subtopic = "",
  questionText = "",
  criteriaText = "",
  attemptText = "",
  marksAvailable = null,
  mode = "criteria",
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new MarkingError(
      "No Anthropic API key saved on this device. Add one under ⇄ Sync to switch AI marking on."
    );
  }
  if (!String(attemptText).trim()) {
    throw new MarkingError(
      "There's nothing to mark — write your attempt as text first. The AI can't read photo attempts."
    );
  }
  if (!String(questionText).trim()) {
    throw new MarkingError(
      "This entry has no question text saved, so there's nothing to mark against."
    );
  }
  if (mode !== "criteria" && mode !== "auto") {
    throw new MarkingError(`Unknown marking mode "${mode}".`);
  }
  if (mode === "criteria" && !String(criteriaText).trim()) {
    throw new MarkingError(
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

  /* loaded on demand so the SDK stays out of the initial bundle */
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema: RESULT_SCHEMA } },
    });
  } catch (err) {
    const status = err?.status;
    if (status === 401 || status === 403) {
      throw new MarkingError(
        "Anthropic rejected that API key. Check it under ⇄ Sync, or make a new one at console.anthropic.com."
      );
    }
    if (status === 429) {
      throw new MarkingError("Rate limited by Anthropic — wait a moment and try again.");
    }
    if (status === 400) {
      throw new MarkingError("Anthropic rejected the request. This attempt may be too long to mark.");
    }
    if (typeof status === "number" && status >= 500) {
      throw new MarkingError("Anthropic is having trouble right now. Try again shortly.");
    }
    throw new MarkingError(
      "Couldn't reach Anthropic. Check your connection and that your key still works."
    );
  }

  if (response.stop_reason === "refusal") {
    throw new MarkingError(
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
    throw new MarkingError("The marking came back in a format we couldn't read. Try again.");
  }

  /* never report a mark above what the question is worth */
  let awarded = parsed.marksAwarded;
  if (typeof awarded === "number" && marks) {
    awarded = Math.max(0, Math.min(marks, Math.round(awarded)));
  } else if (typeof awarded !== "number") {
    awarded = null;
  }

  return {
    verdict: String(parsed.verdict || "").trim(),
    marksAwarded: awarded,
    marksAvailable: marks,
    feedback: String(parsed.feedback || "").trim(),
    markedWithoutCriteria: Boolean(parsed.markedWithoutCriteria),
    model: MODEL,
  };
}
