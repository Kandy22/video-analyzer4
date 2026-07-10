# Video Analyzer — Fixes & Notes

_Last updated: 2026-07-10_

This document records what was broken in the Google AI Studio / Gemini-generated
version, what was changed to make it run reliably, how to run it, and what is
still outstanding.

---

## TL;DR

The app **works**. On a real 28-minute courtroom video it produced a full
396-line transcript and (after a prompt fix) 23 **verbatim** key-moment quotes,
each clickable to its timestamp. It runs locally on **port 5175**.

---

## What was wrong (root causes)

The earlier Gemini "fixes" never addressed the actual problems. The real issues:

1. **WebSocket errors in the preview.** Vite's hot-reload (HMR) socket was never
   disabled for middleware mode, so the browser kept trying to open an HMR
   WebSocket that the server doesn't serve. This threw the repeating
   "can't connect to websocket" errors. (`hmr: false` in `vite.config.ts` was
   ignored because `createViteServer` in `server.ts` overrides the server block.)

2. **Port collision.** Both `server.ts` and `vite.config.ts` hard-coded port
   `3000`, which was already in use by another app.

3. **413 (Payload Too Large).** This only happened inside the AI Studio / Cloud
   Run **preview sandbox**, which caps request bodies around 32 MB. Running
   locally has no such proxy cap. Express body limits were also low.

4. **Key Moments were summaries, not quotes.** The `Key Moments` prompt literally
   asked for "key **summary** moments," so the model paraphrased instead of
   quoting the actual words spoken.

5. **Silent empty runs.** The frontend dispatched the model's function call with
   no guard: `handlers[call.name](call.args)`. Any unexpected function name or
   missing args threw and rendered nothing, with no visible error.

> Note: the `toReversed()` browser-incompat crash that Gemini kept blaming is
> **not present** in this repo version — it was never the problem here.

---

## What was changed

### `server.ts`
- Port now respects an env var: `const PORT = Number(process.env.PORT) || 3000;`
  (we run it on 5175).
- Disabled the failing HMR socket in middleware mode:
  `createViteServer({ server: { middlewareMode: true, hmr: false }, ... })`.
- Raised Express body limits to `500mb` (belt-and-suspenders; local runs don't
  hit the sandbox 32 MB cap).

### `vite.config.ts`
- (HMR already `false` here; the effective fix is in `server.ts` above.)

### `modes.ts`
- **`Key Moments`** now demands exact verbatim quotes:
  _"quote the EXACT verbatim words spoken … Do NOT summarize, paraphrase, or
  describe."_ Output format: `[Key Moment] "<exact quote>"`.
- **`Transcript & Key Moments`** key-moment portion updated the same way for
  consistency.

### `App.tsx`
- Hardened the function-call dispatch so a run is **never silently empty**:
  - Guards `call && call.args`.
  - Falls back to `setTimecodes(call.args)` if the model uses an unexpected
    function name but still returns `timecodes`.
  - Surfaces raw `resp.text` or a clear error otherwise.
  - Logs the raw response to the console for debugging.

### `.gitignore`
- Explicitly ignores `.env.local` / `.env` (the Gemini API key lives in
  `.env.local` and must never be committed; it was already covered by `*.local`).

---

## How to run

```bash
cd video-analyzer4
npm install
# create .env.local with your key:
#   GEMINI_API_KEY=your_key_here
PORT=5175 npm run dev
```

Then open http://localhost:5175 in a normal browser tab (not an AI Studio
iframe — that sandbox is what caused the 413 / WebSocket noise).

In this repo it is also wired into `.claude/launch.json` (parent Kingsfield
project) as the `video-analyzer` config on port 5175, launched via
`.claude/start-video-analyzer.sh`.

### Testing a video
1. Click **Upload Different Video** (or **Reset Session**).
2. Drag/drop or select a video file; wait for upload + processing (watch the
   Activity Logger on the right).
3. Pick a mode:
   - **Key Moments** → exact verbatim quotes.
   - **Transcript Only** → full word-for-word transcript.
   - **Transcript & Key Moments** → both.
   - **Cognitive Speech Diagnostics** → hesitations, speech-rate spikes, hedging.
4. Drag/drop the same local file to enable in-browser playback + click-to-seek
   on each result line.

---

## Known / outstanding (not blocking)

- **Right-panel indicators are placeholders.** The "Physiological Stress Level %",
  "Behavior Sentiment", and the oscilloscope are heuristic/placeholder widgets.
  Planned replacement: the **face-mood emotion gradient color chart** (from the
  FACE-MOOD-TRACKER project's `moodThemes.ts` — 7 emotions mapped to colors).
- **Right panel should collapse** to give the video/output more room. Not done yet.
- **Gemini API quota.** Each analysis run spends quota. Hitting a daily limit is
  an account cap, not a bug.
- **Large-file handling.** A 133 MB file uploaded and processed fine via the
  chunked upload path. Very large / multi-hour files are untested.

---

## Verification record (2026-07-10)

- Uploaded `Judge Threatens Man for Pretending to Be a Lawyer in Court!.mp4`
  (~133 MB, 28:51).
- Transcript: **396** lines.
- Key Moments after the verbatim-prompt fix: **23** exact quotes, e.g.
  `0:17 — "One more word out of you until I offer you the chance to speak,
  you're going to be in contempt."`
- No console errors, no WebSocket error, no 413.
