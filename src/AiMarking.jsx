import { useState } from "react";
import { markAttempt, getApiKey, setApiKey, hasApiKey } from "./marking.js";

/* Where you paste your Anthropic key. It stays in this browser's localStorage
   and is never committed or built into the app. */
export function ApiKeyPanel({ C, sans }) {
  const [value, setValue] = useState(getApiKey());
  const [saved, setSaved] = useState(false);
  const stored = hasApiKey();

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.rule}` }}>
      <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>
        AI marking key
      </div>
      <div style={{ fontFamily: sans, fontSize: 12.5, color: C.faint, marginBottom: 10 }}>
        {stored
          ? "A key is saved on this device. AI marking is available."
          : "Paste an Anthropic API key to switch on AI marking. Get one at console.anthropic.com and set a monthly spend limit while you're there."}
        {" "}It's stored only in this browser — add it again on each device you use.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder="sk-ant-..."
          style={{
            flex: 1, minWidth: 200, font: "inherit", fontFamily: sans, fontSize: 13,
            padding: "8px 10px", border: `1px solid ${C.rule}`, borderRadius: 8,
          }}
        />
        <button
          type="button"
          onClick={() => { setApiKey(value); setSaved(true); }}
          style={{
            appearance: "none", font: "inherit", fontFamily: sans, fontSize: 13,
            fontWeight: 600, cursor: "pointer", border: `1px solid ${C.rule}`,
            background: "#fff", borderRadius: 8, padding: "8px 14px",
          }}
        >
          {value ? "Save key" : "Clear key"}
        </button>
      </div>
      {saved && (
        <div style={{ fontFamily: sans, fontSize: 12.5, color: C.green, marginTop: 6 }}>
          {value ? "Saved on this device." : "Key removed from this device."}
        </div>
      )}
    </div>
  );
}

/* Marking modes stored on an entry as `aiMarkingMode`. */
export const AI_MODES = [
  { value: "off", label: "Off", hint: "No AI marking for this entry." },
  {
    value: "criteria",
    label: "Against my criteria",
    hint: "Marks strictly against the marking criteria you saved above.",
  },
  {
    value: "auto",
    label: "Fully automatic",
    hint: "No criteria needed — works out the answer itself, then marks you.",
  },
];

/* Three-way selector used in both the Log-error form and the tag editor. */
export function AiModePicker({ value, onChange, C, sans }) {
  const mode = value || "off";
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {AI_MODES.map((m) => {
          const on = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange(m.value)}
              style={{
                appearance: "none",
                font: "inherit",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: on ? 700 : 500,
                cursor: "pointer",
                borderRadius: 999,
                padding: "5px 13px",
                border: `1px solid ${on ? C.ink : C.rule}`,
                background: on ? C.ink : "#fff",
                color: on ? "#fff" : C.faint,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: sans,
          fontSize: 12.5,
          color: C.faint,
          marginTop: 6,
        }}
      >
        {AI_MODES.find((m) => m.value === mode)?.hint}
      </div>
    </div>
  );
}

/* The suggestion card shown in a redo session once the criteria are revealed.
   It is advisory only: it never sets the tick/cross and never touches the
   spaced-repetition schedule. "Use this mark" only fills in the marks input —
   the student still presses ✓ or ✗ themselves. */
export function AiMarkingCard({
  entry,
  attemptText,
  onResult,
  onUseMark,
  C,
  sans,
  serif,
}) {
  const [state, setState] = useState("idle"); // idle | loading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const mode = entry.aiMarkingMode || "off";
  if (mode === "off") return null;

  const run = async () => {
    setState("loading");
    setError("");
    try {
      const data = await markAttempt({
        subject: entry.subject,
        subtopic: entry.subtopic,
        questionText: entry.questionText,
        criteriaText: entry.criteriaText,
        attemptText,
        marksAvailable: entry.marksAvailable,
        mode,
      });
      setResult(data);
      setState("done");
      onResult?.(data);
    } catch (err) {
      setError(err?.message || "Marking failed. Mark it yourself this time.");
      setState("error");
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${C.amber}`,
        background: C.amberSoft,
        borderRadius: 8,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 700,
          color: C.amber,
          marginBottom: 6,
        }}
      >
        AI suggestion — not the final word
      </div>

      {state === "idle" && (
        <>
          <div style={{ fontFamily: sans, fontSize: 13.5, marginBottom: 10 }}>
            {mode === "criteria"
              ? "Mark this attempt against the criteria you saved."
              : "No criteria saved — the AI will work out the answer itself, then mark you."}
          </div>
          <button
            type="button"
            onClick={run}
            style={{
              appearance: "none",
              font: "inherit",
              fontFamily: sans,
              fontSize: 13.5,
              fontWeight: 700,
              cursor: "pointer",
              border: `1px solid ${C.amber}`,
              background: "#fff",
              color: C.amber,
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            Ask AI to mark this
          </button>
        </>
      )}

      {state === "loading" && (
        <div style={{ fontFamily: sans, fontSize: 13.5, color: C.faint }}>
          Marking your attempt…
        </div>
      )}

      {state === "error" && (
        <>
          <div
            style={{ fontFamily: sans, fontSize: 13.5, marginBottom: 10 }}
            role="alert"
          >
            {error}
          </div>
          <button
            type="button"
            onClick={run}
            style={{
              appearance: "none",
              font: "inherit",
              fontFamily: sans,
              fontSize: 13,
              cursor: "pointer",
              border: `1px solid ${C.rule}`,
              background: "#fff",
              borderRadius: 8,
              padding: "6px 12px",
            }}
          >
            Try again
          </button>
        </>
      )}

      {state === "done" && result && (
        <>
          <div
            style={{
              fontFamily: serif,
              fontSize: 18,
              marginBottom: 4,
            }}
          >
            {result.marksAwarded != null && result.marksAvailable
              ? `${result.marksAwarded} / ${result.marksAvailable}`
              : result.verdict}
          </div>
          {result.marksAwarded != null && result.marksAvailable && (
            <div
              style={{ fontFamily: sans, fontSize: 13, color: C.faint, marginBottom: 6 }}
            >
              {result.verdict}
            </div>
          )}
          <div
            style={{
              fontFamily: sans,
              fontSize: 13.5,
              whiteSpace: "pre-wrap",
              marginBottom: 10,
            }}
          >
            {result.feedback}
          </div>
          <div
            style={{
              fontFamily: sans,
              fontSize: 12.5,
              color: C.faint,
              marginBottom: result.marksAwarded != null ? 10 : 0,
            }}
          >
            Your own ✓ or ✗ below is what counts — this doesn't change your
            revision schedule.
          </div>
          {result.marksAwarded != null && result.marksAvailable ? (
            <button
              type="button"
              onClick={() => onUseMark?.(result.marksAwarded)}
              style={{
                appearance: "none",
                font: "inherit",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${C.rule}`,
                background: "#fff",
                borderRadius: 8,
                padding: "6px 12px",
              }}
            >
              Use this mark
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
