/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
// Copyright 2024 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

export default {
  'Transcript & Key Moments': {
    emoji: '🎙️',
    prompt: `Analyze the video to generate both a complete literal word-for-word transcript AND identify key moments.
    First, produce the word-for-word speech transcription grouped by continuous segments with precise timestamp markers.
    Second, identify key summary moments (e.g. key topics discussed, changes in tone or content, behavior observations).
    To deliver these structured results, call 'set_timecodes' with a flat, chronologically ordered list of objects.
    Each object must have a 'time' (formatted as MM:SS) and a 'text'.
    For transcript segments, prefix the text with '[Transcript] Speaker: "..."'.
    For key moments, quote the EXACT verbatim words spoken (word-for-word, no paraphrasing) and prefix with '[Key Moment] "<exact quote>"'.
    For vocal behavioral anomalies (like hesitations, speech velocity spikes, sentence-deferral hedging patterns, or interruptions), prefix the text with '[Vocal Anomaly] ...' (e.g. '[Vocal Anomaly] Vocal Hesitation interval: 1.8s silence', '[Vocal Anomaly] Speech Rate Spike: 190 WPM', '[Vocal Anomaly] Sentence-deferral phrasing detected: "maybe we could..."').
    This combined analysis allows matching up transcript lines directly with key moments and deeper emotional face/vocal review.`,
    isList: true,
  },

  'Transcript Only': {
    emoji: '🗣️',
    prompt: `Provide a highly detailed word-for-word literal transcript of all spoken audio in this video. 
    Call set_timecodes with the start timecode of each sentence or dialogue segment, and prefix each text segment with '[Transcript] "..."'.`,
    isList: true,
  },

  'Key Moments': {
    emoji: '🔑',
    prompt: `Identify the key moments in this video (pivotal statements, rulings, turning points, notable exchanges).
    For EACH key moment, quote the EXACT verbatim words spoken at that point — a direct, word-for-word transcription of the audio. Do NOT summarize, paraphrase, or describe what happened.
    Call set_timecodes with the timecode of each key moment, and format each text segment as: '[Key Moment] "<exact verbatim quote>"'.`,
    isList: true,
  },

  'Cognitive Speech Diagnostics': {
    emoji: '🧠',
    prompt: `Analyze the audio of the video for speech-only metrics. Identify key vocal behaviors, specifically:
    - Vocal hesitations (pauses, 'um', 'uh', silence gaps > 1.0s)
    - Speech velocity spikes (talking unusually fast, e.g. WPM > 170)
    - Sentence-deferral phrasing (hedging like 'I think', 'maybe', 'perhaps', 'probably')
    - Interruption timestamps or sudden phrasing shifts.
    For each occurrence, call set_timecodes with the timecode and a text describing the behavioral metric, prefixed with '[Vocal Anomaly] ...' (e.g., "[Vocal Anomaly] Vocal Hesitation: 1.5s pause with 'uh'", "[Vocal Anomaly] Speech Velocity Spike: 185 WPM detected", "[Vocal Anomaly] Sentence-deferral: hedging phrasing 'maybe we can'").`,
    isList: true,
  },

  'Custom Prompt': {
    emoji: '🔧',
    prompt: (input) =>
      `Call set_timecodes once using the following instructions: ${input}. If appropriate, prefix entries with [Transcript], [Key Moment], or [Vocal Anomaly].`,
    isList: true,
  },
};
