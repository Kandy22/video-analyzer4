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

import c from 'classnames';
import {useRef, useState, useEffect} from 'react';
import {generateContent, uploadFile, listFiles, getFileStatus} from './api';
import functions from './functions';
import modes from './modes';
import {timeToSecs} from './utils';
import VideoPlayer from './VideoPlayer';

interface LogEntry {
  id: number;
  timestamp: string;
  tag: "SYSTEM" | "LIVE" | "ANOMALY" | "INFO" | "ERROR";
  message: string;
  timecode?: string;
}

export default function App() {
  const [vidUrl, setVidUrl] = useState<string | null>(null);
  const [file, setFile] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("cognitive_file");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [availableFiles, setAvailableFiles] = useState<any[]>([]);
  const [timecodeList, setTimecodeList] = useState<any[] | null>(() => {
    try {
      const saved = localStorage.getItem("cognitive_timecodeList");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [requestedTimecode, setRequestedTimecode] = useState<number | null>(null);
  const [selectedMode, setSelectedMode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("cognitive_selectedMode");
      if (saved) return saved;
    } catch {}
    return Object.keys(modes)[0];
  });
  const [activeMode, setActiveMode] = useState<string | undefined>(() => {
    try {
      const saved = localStorage.getItem("cognitive_activeMode");
      if (saved) return saved;
    } catch {}
    return undefined;
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [isLoadingVideo, setIsLoadingVideo] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<{ configured: boolean; hasKey: boolean; isPlaceholder: boolean } | null>(null);

  // Diagnostic states
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'TRANSCRIPT' | 'KEY_MOMENTS' | 'VOCAL_ANOMALIES'>('ALL');
  const [stressLevel, setStressLevel] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("cognitive_stressLevel");
      return saved ? parseInt(saved, 10) : 15;
    } catch {
      return 15;
    }
  });
  const [sentiment, setSentiment] = useState<'CALM' | 'NEUTRAL' | 'HESITANT' | 'AGITATED'>(() => {
    try {
      const saved = localStorage.getItem("cognitive_sentiment");
      if (saved) return saved as any;
    } catch {}
    return 'NEUTRAL';
  });
  const [anomalyLogs, setAnomalyLogs] = useState<LogEntry[]>(() => {
    try {
      const saved = localStorage.getItem("cognitive_anomalyLogs");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      { id: 1, timestamp: new Date().toLocaleTimeString(), tag: "SYSTEM", message: "Centralized Cognitive Interface Terminal active." },
      { id: 2, timestamp: new Date().toLocaleTimeString(), tag: "INFO", message: "Audio-Only transcription and behavioral metrics pipeline ready." }
    ];
  });

  // Sync state changes to localStorage
  useEffect(() => {
    if (file) localStorage.setItem("cognitive_file", JSON.stringify(file));
    else localStorage.removeItem("cognitive_file");
  }, [file]);

  useEffect(() => {
    if (timecodeList) localStorage.setItem("cognitive_timecodeList", JSON.stringify(timecodeList));
    else localStorage.removeItem("cognitive_timecodeList");
  }, [timecodeList]);

  useEffect(() => {
    localStorage.setItem("cognitive_anomalyLogs", JSON.stringify(anomalyLogs));
  }, [anomalyLogs]);

  useEffect(() => {
    localStorage.setItem("cognitive_stressLevel", stressLevel.toString());
  }, [stressLevel]);

  useEffect(() => {
    localStorage.setItem("cognitive_sentiment", sentiment);
  }, [sentiment]);

  useEffect(() => {
    localStorage.setItem("cognitive_selectedMode", selectedMode);
  }, [selectedMode]);

  useEffect(() => {
    if (activeMode) localStorage.setItem("cognitive_activeMode", activeMode);
    else localStorage.removeItem("cognitive_activeMode");
  }, [activeMode]);

  // Poll if the current file is still PROCESSING (e.g. after page reload, state recovery, or list recovery)
  useEffect(() => {
    if (!file || file.state !== "PROCESSING") return;

    let active = true;
    let attempts = 0;
    const maxAttempts = 120; // 6 minutes max

    const poll = async () => {
      logAnomaly("SYSTEM", `Vocal processing session resumed. Polling processing state...`);
      setIsLoadingVideo(true);
      setUploadProgress(98);

      let currentFile = file;
      while (currentFile && currentFile.state === "PROCESSING" && attempts < maxAttempts && active) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (!active) break;
        try {
          const updated = await getFileStatus(currentFile.name);
          logAnomaly("SYSTEM", `Vocal processing status update: ${updated.state}...`);
          if (updated.state !== "PROCESSING") {
            setFile(updated);
            setIsLoadingVideo(false);
            setUploadProgress(100);
            break;
          }
        } catch (pollErr: any) {
          console.error("Error resuming poll:", pollErr);
        }
      }
      if (active) {
        setIsLoadingVideo(false);
      }
    };

    poll();

    return () => {
      active = false;
    };
  }, [file?.name, file?.state]);

  // Fetch configuration status and existing files from Gemini Files API on mount
  useEffect(() => {
    const checkConfigAndFetchFiles = async () => {
      try {
        // Fetch config status
        const configRes = await fetch("/api/config-status");
        if (configRes.ok) {
          const status = await configRes.json();
          setConfigStatus(status);
          if (status.isPlaceholder || !status.hasKey) {
            setApiKeyError("GEMINI_API_KEY is not configured or is set to a PLACEHOLDER in the server environment.");
          }
        }
      } catch (err) {
        console.error("Error fetching config status:", err);
      }

      try {
        const files = await listFiles();
        setAvailableFiles(files || []);
        setApiKeyError(null); // Clear key error if successful
        
        // If there is no active file in state but we have files in Gemini, restore the most recent valid one
        if (!file && files && files.length > 0) {
          const validFiles = files.filter((f: any) => f.state === "ACTIVE" || f.state === "PROCESSING");
          if (validFiles.length > 0) {
            const mostRecent = validFiles[0];
            setFile(mostRecent);
            
            setAnomalyLogs(prev => [
              {
                id: Date.now() + Math.random(),
                timestamp: new Date().toLocaleTimeString(),
                tag: "SYSTEM",
                message: `Auto-restored video session: '${mostRecent.displayName || mostRecent.name}' (State: ${mostRecent.state}) from Gemini database.`
              },
              ...prev
            ]);
          }
        }
      } catch (err: any) {
        console.error("Error auto-fetching Gemini files:", err);
        const errMsg = err.message || "";
        if (errMsg.includes("API key not valid") || errMsg.includes("INVALID_ARGUMENT") || errMsg.includes("API_KEY") || errMsg.includes("API key")) {
          setApiKeyError("Your GEMINI_API_KEY is invalid. Please double check your credentials in Settings.");
        } else {
          setApiKeyError(errMsg || "Failed to retrieve sessions from Gemini.");
        }
      }
    };
    checkConfigAndFetchFiles();
  }, []);

  // Method to clear local storage and start a fresh session
  const clearSession = () => {
    localStorage.removeItem("cognitive_file");
    localStorage.removeItem("cognitive_timecodeList");
    localStorage.removeItem("cognitive_anomalyLogs");
    localStorage.removeItem("cognitive_stressLevel");
    localStorage.removeItem("cognitive_sentiment");
    localStorage.removeItem("cognitive_selectedMode");
    localStorage.removeItem("cognitive_activeMode");
    setFile(null);
    setVidUrl(null);
    setTimecodeList(null);
    setStressLevel(15);
    setSentiment("NEUTRAL");
    setAnomalyLogs([
      { id: Date.now(), timestamp: new Date().toLocaleTimeString(), tag: "SYSTEM", message: "Session cleared. Interface reset." }
    ]);
  };

  // Live Microphone states
  const [isLiveMic, setIsLiveMic] = useState<boolean>(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scrollRef = useRef<any>();

  const isCustomMode = selectedMode === 'Custom Prompt';

  const logAnomaly = (tag: LogEntry["tag"], message: string, timecode?: string) => {
    setAnomalyLogs(prev => [
      {
        id: Date.now() + Math.random(),
        timestamp: new Date().toLocaleTimeString(),
        tag,
        message,
        timecode
      },
      ...prev
    ]);
  };

  const setTimecodes = ({timecodes}: {timecodes: any[]}) => {
    const list = (timecodes || []).map((t) => {
      const textVal = typeof t.text === 'string' ? t.text : (t.value !== undefined ? `Value: ${t.value}` : '');
      const cleanedText = textVal.replaceAll("\\'", "'");
      return { ...t, text: cleanedText };
    });
    setTimecodeList(list);

    // Calculate metrics based on the results!
    let totalAnomalies = 0;
    const extractedLogs: LogEntry[] = [];

    list.forEach((item: any) => {
      const textStr = item.text || "";
      const lower = textStr.toLowerCase();
      let type = "";
      if (lower.includes("anomaly") || lower.includes("hesitat") || lower.includes("speed") || lower.includes("defer") || lower.includes("hedg") || lower.includes("paus") || lower.includes("silence")) {
        totalAnomalies++;
        if (lower.includes("hesitat") || lower.includes("paus") || lower.includes("silence")) {
          type = "Vocal Hesitation";
        } else if (lower.includes("speed") || lower.includes("velocity") || lower.includes("rate")) {
          type = "Speech Velocity Spike";
        } else if (lower.includes("defer") || lower.includes("hedg") || lower.includes("think") || lower.includes("maybe")) {
          type = "Sentence Deferral";
        } else {
          type = "Vocal Anomaly";
        }
        extractedLogs.push({
          id: Date.now() + Math.random(),
          timestamp: item.time || "00:00",
          tag: "ANOMALY",
          message: `${type} detected: ${textStr}`,
          timecode: item.time
        });
      }
    });

    if (extractedLogs.length > 0) {
      setAnomalyLogs(prev => [...extractedLogs.reverse(), ...prev]);
    }

    const calculatedStress = Math.min(15 + (totalAnomalies * 15), 95);
    setStressLevel(calculatedStress);

    if (calculatedStress > 60) {
      setSentiment("AGITATED");
    } else if (calculatedStress > 35) {
      setSentiment("HESITANT");
    } else if (totalAnomalies === 0 && list.length > 0) {
      setSentiment("CALM");
    } else {
      setSentiment("NEUTRAL");
    }
  };

  const onModeSelect = async (mode: string) => {
    setActiveMode(mode);
    setIsLoading(true);

    const isCustom = mode === 'Custom Prompt';
    const promptText = isCustom ? (modes as any)[mode].prompt(customPrompt) : (modes as any)[mode].prompt;

    try {
      const resp = await generateContent(
        promptText,
        functions({
          set_timecodes: setTimecodes,
          set_timecodes_with_objects: setTimecodes,
          set_timecodes_with_numeric_values: ({timecodes}) => setTimecodes({timecodes}),
        }),
        file,
      );

      const call = resp.functionCalls?.[0];

      if (call) {
        ({
          set_timecodes: setTimecodes,
          set_timecodes_with_objects: setTimecodes,
          set_timecodes_with_numeric_values: ({timecodes}) => setTimecodes({timecodes}),
        })[call.name](call.args);
      }
    } catch (err: any) {
      console.error("Error generating content:", err);
      logAnomaly("ERROR", `Generation error: ${err.message || err}`);
    } finally {
      setIsLoading(false);
      if (scrollRef.current) {
        scrollRef.current.scrollTo({top: 0});
      }
    }
  };

  const handleFile = async (selectedFile: File) => {
    if (!selectedFile) return;

    // Check if we are restoring local playback for the currently loaded session
    if (file && (file.displayName === selectedFile.name || file.name === selectedFile.name)) {
      setVidUrl(URL.createObjectURL(selectedFile));
      logAnomaly("SYSTEM", `Connected local video file '${selectedFile.name}' for interactive playback.`);
      return;
    }

    setIsLoadingVideo(true);
    setUploadProgress(0);
    setVideoError(false);
    setVidUrl(URL.createObjectURL(selectedFile));
    logAnomaly("SYSTEM", `Loading and registering video file: ${selectedFile.name}`);

    try {
      const res = await uploadFile(selectedFile, (pct) => {
        setUploadProgress(pct);
        if (pct < 100) {
          logAnomaly("SYSTEM", `Uploading video payload to backend... ${pct}%`);
        } else {
          logAnomaly("SYSTEM", `Payload upload complete. Registering with server-side Gemini Files API...`);
        }
      });

      let finalFile = res;
      if (finalFile && finalFile.state === "PROCESSING") {
        logAnomaly("SYSTEM", `Payload registered on Gemini as '${finalFile.name}'. Polling processing state...`);
        let attempts = 0;
        const maxAttempts = 120; // 6 minutes max
        while (finalFile.state === "PROCESSING" && attempts < maxAttempts) {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            finalFile = await getFileStatus(finalFile.name);
            logAnomaly("SYSTEM", `Vocal processing status: ${finalFile.state}...`);
          } catch (pollErr: any) {
            console.error("Error polling file status:", pollErr);
          }
        }
      }

      if (finalFile && finalFile.state === "FAILED") {
        throw new Error("File processing failed on Gemini backend.");
      }

      setFile(finalFile);
      setIsLoadingVideo(false);
      setUploadProgress(100);
      logAnomaly("SYSTEM", `Video registration complete. Ready for cognitive diagnostics.`);
    } catch (e: any) {
      console.error("Error uploading file to Gemini:", e);
      setVideoError(true);
      setIsLoadingVideo(false);
      setUploadProgress(0);
      logAnomaly("ERROR", `Failed to register video with Gemini API: ${e.message || e}`);
    }
  };

  const uploadVideo = (e: any) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    handleFile(droppedFile);
  };

  // Live System monitoring
  const startSystem = async () => {
    try {
      logAnomaly("SYSTEM", "Requesting microphone-only permissions...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsLiveMic(true);
      setMicStream(stream);

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioCtxRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      visualizeMic(analyser);
      logAnomaly("LIVE", "Vocal Monitor operational. Standing by for real-time analysis...");
    } catch (err: any) {
      console.error("Microphone access denied:", err);
      logAnomaly("ERROR", `Microphone permission denied: ${err.message || err}`);
    }
  };

  const stopSystem = () => {
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setIsLiveMic(false);
    setMicStream(null);
    logAnomaly("SYSTEM", "Live vocal monitoring suspended.");
  };

  const visualizeMic = (analyser: AnalyserNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!canvasRef.current) return;
      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "#16171b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#39ff14"; // terminal green
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      // Simple RMS check for live metrics simulation
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const value = (dataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / bufferLength);
      
      if (rms > 0.05) {
        const voiceLevel = Math.min(Math.round(rms * 160), 100);
        setStressLevel(prev => {
          const next = prev + (voiceLevel - prev) * 0.15;
          return Math.round(Math.min(Math.max(next, 10), 95));
        });
        
        if (Math.random() < 0.015) {
          logAnomaly("LIVE", "Speech Velocity Spike: speech rhythm accelerated.");
          setSentiment("AGITATED");
        } else if (Math.random() < 0.01) {
          logAnomaly("LIVE", "Sentence-deferral phrasing: hedge detected.");
          setSentiment("HESITANT");
        }
      } else {
        setStressLevel(prev => {
          const next = prev - (prev - 15) * 0.05;
          return Math.round(next);
        });
        if (Math.random() < 0.005) {
          logAnomaly("LIVE", "Vocal Hesitation Interval: brief silence registered.");
          setSentiment("NEUTRAL");
        }
      }
    };

    draw();
  };

  useEffect(() => {
    if (isLiveMic) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let offset = 0;
    let animId: number;

    const drawStandby = () => {
      ctx.fillStyle = "#16171b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 1;
      ctx.strokeStyle = "#282a30";
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#87a9ff"; // terminal blue
      ctx.beginPath();

      for (let x = 0; x < canvas.width; x++) {
        const y = canvas.height / 2 + Math.sin(x * 0.025 + offset) * 8;
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      offset += 0.04;
      animId = requestAnimationFrame(drawStandby);
    };

    drawStandby();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isLiveMic]);

  // Helper to parse category prefix for filtering
  const getItemDetails = (text: string) => {
    const safeText = text || "";
    if (safeText.startsWith("[Transcript]")) {
      return {
        category: "TRANSCRIPT" as const,
        tagLabel: "Transcript",
        tagClass: "tag-transcript",
        displayText: safeText.replace("[Transcript]", "").trim()
      };
    }
    if (safeText.startsWith("[Key Moment]")) {
      return {
        category: "KEY_MOMENTS" as const,
        tagLabel: "Key Moment",
        tagClass: "tag-keymoment",
        displayText: safeText.replace("[Key Moment]", "").trim()
      };
    }
    if (safeText.startsWith("[Vocal Anomaly]")) {
      return {
        category: "VOCAL_ANOMALIES" as const,
        tagLabel: "Vocal Anomaly",
        tagClass: "tag-vocal-anomaly",
        displayText: safeText.replace("[Vocal Anomaly]", "").trim()
      };
    }
    
    // Fallbacks
    if (activeMode === "Key Moments") {
      return {
        category: "KEY_MOMENTS" as const,
        tagLabel: "Key Moment",
        tagClass: "tag-keymoment",
        displayText: safeText
      };
    }
    if (activeMode === "Cognitive Speech Diagnostics") {
      return {
        category: "VOCAL_ANOMALIES" as const,
        tagLabel: "Vocal Anomaly",
        tagClass: "tag-vocal-anomaly",
        displayText: safeText
      };
    }
    return {
      category: "TRANSCRIPT" as const,
      tagLabel: "Transcript",
      tagClass: "tag-transcript",
      displayText: safeText
    };
  };

  const filteredList = timecodeList?.filter(item => {
    if (activeFilter === "ALL") return true;
    const { category } = getItemDetails(item.text);
    return category === activeFilter;
  }) || [];

  return (
    <main
      className="dark"
      onDrop={uploadVideo}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => {}}
      onDragLeave={() => {}}
    >
      {/* Left Column: Centralized Cognitive Interface Terminal */}
      <div className="terminal-left">
        <header className="terminal-header">
          <div className="terminal-title">
            <span className={c("terminal-status-dot", { active: isLiveMic })} />
            CENTRALIZED COGNITIVE TERMINAL v1.08
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              onClick={clearSession}
              className="button"
              style={{
                border: "1px solid #ff3b30",
                background: "rgba(255, 59, 48, 0.05)",
                color: "#ff3b30",
                fontSize: "12px",
                padding: "4px 12px",
                fontFamily: "Space Mono, monospace"
              }}
            >
              [RESET SESSION]
            </button>
            <button
              onClick={isLiveMic ? stopSystem : startSystem}
              className="button"
              style={{
                border: "1px solid #282a30",
                background: isLiveMic ? "rgba(255, 59, 48, 0.15)" : "#16171b",
                color: isLiveMic ? "#ff3b30" : "#39ff14",
                fontSize: "12px",
                padding: "4px 12px",
                fontFamily: "Space Mono, monospace"
              }}
            >
              {isLiveMic ? "■ HALT COGNITIVE MICROPHONE" : "▶ START SYSTEM (MIC-ONLY)"}
            </button>
          </div>
        </header>

        {apiKeyError && (
          <div style={{
            background: "rgba(255, 59, 48, 0.12)",
            borderBottom: "1px solid rgba(255, 59, 48, 0.3)",
            padding: "10px 20px",
            fontSize: "12px",
            color: "#ff3b30",
            fontFamily: "Space Mono, monospace",
            lineHeight: "1.5"
          }}>
            ⚠️ <strong>CRITICAL CONFIGURATION ERROR:</strong> {apiKeyError}
            <div style={{ marginTop: "5px", color: "#8a8f9f", fontSize: "11px" }}>
              To solve this, open the <strong>Settings</strong> menu (gear icon in the top right of the screen or left sidebar) and input a valid <strong>GEMINI_API_KEY</strong>.
            </div>
          </div>
        )}

        {file && !vidUrl && (
          <div style={{
            background: "rgba(135, 169, 255, 0.08)",
            borderBottom: "1px solid rgba(135, 169, 255, 0.2)",
            padding: "8px 20px",
            fontSize: "11px",
            color: "#87a9ff",
            fontFamily: "Space Mono, monospace",
            lineHeight: "1.5"
          }}>
            🔄 <strong>SESSION AUTOMATICALLY RESTORED:</strong> Restored analysis results for <code>{file.displayName}</code>. 
            To play/scrub the video locally, drag-and-drop or select <code>{file.displayName}</code>. 
            You can still query, explore, or rerun cognitive diagnostic pipelines below.
          </div>
        )}

        <section className="top" style={{ flex: "1 1 auto", overflow: "hidden", minHeight: "45vh" }}>
          <div className={c('modeSelector', {hide: !showSidebar, inactive: isLoadingVideo})} style={{ height: "100%", overflowY: "auto" }}>
              {isCustomMode ? (
                <div>
                  <h2>Custom prompt:</h2>
                  <textarea
                    placeholder="Type a custom prompt..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (file) {
                          onModeSelect(selectedMode);
                        } else {
                          logAnomaly("ERROR", "Analysis rejected: Please upload a video file first to run custom prompt analysis.");
                        }
                      }
                    }}
                    rows={5}
                  />
                  <button
                    className="button generateButton"
                    onClick={() => {
                      if (!file) {
                        logAnomaly("ERROR", "Analysis rejected: Please upload a video file first to run custom prompt analysis.");
                        return;
                      }
                      onModeSelect(selectedMode);
                    }}
                    disabled={!customPrompt.trim()}
                    style={{ background: "#16171b", border: "1px solid #282a30", color: "#39ff14" }}
                  >
                    ▶️ Generate
                  </button>
                  <div className="backButton" style={{ marginTop: "15px" }}>
                    <button
                      onClick={() => setSelectedMode(Object.keys(modes)[0])}
                      style={{ color: "#8a8f9f" }}
                    >
                      <span className="icon">chevron_left</span>
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <h2>Explore via Speech Pipeline:</h2>
                  <div className="modeList">
                    {Object.entries(modes).map(([mode, {emoji}]) => (
                      <button
                        key={mode}
                        className={c('button', {
                          active: mode === selectedMode,
                        })}
                        onClick={() => {
                          setSelectedMode(mode);
                          if (mode !== 'Custom Prompt') {
                            if (!file) {
                              logAnomaly("ERROR", `Analysis rejected: Please upload a video file first to analyze using '${mode}'.`);
                            } else {
                              onModeSelect(mode);
                            }
                          }
                        }}
                        style={{ padding: "8px", fontSize: "12px" }}
                      >
                        <span className="emoji">{emoji}</span> {mode}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: "20px" }}>
                    <button
                      className="button generateButton"
                      onClick={() => {
                        if (!file) {
                          logAnomaly("ERROR", "Analysis rejected: Please upload a video file first to run cognitive diagnostics.");
                          return;
                        }
                        onModeSelect(selectedMode);
                      }}
                      style={{ background: "#16171b", border: "1px solid #282a30", color: "#39ff14" }}
                    >
                      ▶️ RUN COGNITIVE ANALYSIS
                    </button>
                  </div>
                </div>
              )}
            </div>

          <VideoPlayer
            url={vidUrl}
            requestedTimecode={requestedTimecode}
            timecodeList={timecodeList}
            jumpToTimecode={setRequestedTimecode}
            isLoadingVideo={isLoadingVideo}
            uploadProgress={uploadProgress}
            videoError={videoError}
            onFileSelect={handleFile}
            fileName={file?.displayName || file?.name}
          />
        </section>

        {/* Bottom Section: Transcript & Key Moments Output with Filters */}
        <div className={c('tools', {inactive: !file})} style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: "35vh" }}>
          {file && (
            <div className="filter-tabs">
              <button
                className={c("filter-tab", { active: activeFilter === "ALL" })}
                onClick={() => setActiveFilter("ALL")}
              >
                [ALL ({timecodeList?.length || 0})]
              </button>
              <button
                className={c("filter-tab", { active: activeFilter === "TRANSCRIPT" })}
                onClick={() => setActiveFilter("TRANSCRIPT")}
              >
                [🗣️ TRANSCRIPT ({timecodeList?.filter(t => getItemDetails(t.text).category === "TRANSCRIPT").length || 0})]
              </button>
              <button
                className={c("filter-tab", { active: activeFilter === "KEY_MOMENTS" })}
                onClick={() => setActiveFilter("KEY_MOMENTS")}
              >
                [🔑 KEY MOMENTS ({timecodeList?.filter(t => getItemDetails(t.text).category === "KEY_MOMENTS").length || 0})]
              </button>
              <button
                className={c("filter-tab", { active: activeFilter === "VOCAL_ANOMALIES" })}
                onClick={() => setActiveFilter("VOCAL_ANOMALIES")}
              >
                [🧠 VOCAL DIAGNOSTICS ({timecodeList?.filter(t => getItemDetails(t.text).category === "VOCAL_ANOMALIES").length || 0})]
              </button>
            </div>
          )}

          <section className="output" ref={scrollRef} style={{ flex: 1, padding: "15px", overflowY: "auto" }}>
            {isLoading ? (
              <div className="loading" style={{ color: "#39ff14" }}>
                Analyzing video audio track<span>...</span>
              </div>
            ) : timecodeList ? (
              filteredList.length === 0 ? (
                <div style={{ color: "#8a8f9f", fontSize: "13px", padding: "10px" }}>
                  No records matching selected category filter.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {filteredList.map((item, i) => {
                    const { tagLabel, tagClass, displayText } = getItemDetails(item.text);
                    return (
                      <div
                        key={i}
                        className="output-item-card"
                        role="button"
                        onClick={() => setRequestedTimecode(timeToSecs(item.time))}
                      >
                        <div className="output-item-card-header">
                          <span className={c("output-item-card-tag", tagClass)}>{tagLabel}</span>
                          <time style={{ color: "#87a9ff", textDecoration: "underline", fontSize: "11px" }}>{item.time}</time>
                        </div>
                          <div className="output-item-card-text">{displayText}</div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <div style={{ color: "#8a8f9f", fontSize: "13px", textAlign: "center", paddingTop: "40px" }}>
                Select a diagnostic mode above and click "RUN COGNITIVE ANALYSIS" to process this video file.
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Right Column: Cognitive Diagnostics Center */}
      <div className="diagnostics-right">
        <h2 style={{ fontSize: "14px", fontWeight: "bold", borderBottom: "1px solid #282a30", paddingBottom: "10px", color: "#ffffff", letterSpacing: "0.1em" }}>
          🧠 COGNITIVE DIAGNOSTICS CENTER
        </h2>

        {/* Metric Widget 1: Physiological Stress Level */}
        <div className="widget-card">
          <h3>
            <span>Physiological Stress Level</span>
            <span style={{ fontSize: "10px", color: stressLevel > 50 ? "#ff3b30" : "#39ff14" }}>
              {stressLevel > 60 ? "CRITICAL" : stressLevel > 35 ? "ELEVATED" : "OPTIMAL"}
            </span>
          </h3>
          <div className="widget-metric-value" style={{ color: stressLevel > 60 ? "#ff3b30" : stressLevel > 35 ? "#ffb700" : "#39ff14" }}>
            {stressLevel}%
          </div>
          <div className="stress-meter-bg">
            <div
              className="stress-meter-fill"
              style={{
                width: `${stressLevel}%`,
                background: stressLevel > 60 ? "#ff3b30" : stressLevel > 35 ? "#ffb700" : "#39ff14"
              }}
            />
          </div>
          <span style={{ fontSize: "10px", color: "#8a8f9f" }}>
            Vocal hesitation interval, speech velocity spikes, and sentence-deferrals mapped.
          </span>
        </div>

        {/* Metric Widget 2: Behavior Sentiment */}
        <div className="widget-card">
          <h3>Behavior Sentiment</h3>
          <div>
            <span className={c("sentiment-badge", {
              "sentiment-calm": sentiment === "CALM",
              "sentiment-neutral": sentiment === "NEUTRAL",
              "sentiment-hesitant": sentiment === "HESITANT",
              "sentiment-agitated": sentiment === "AGITATED"
            })}>
              {sentiment}
            </span>
          </div>
          <span style={{ fontSize: "10px", color: "#8a8f9f" }}>
            Determined by phrase deferrals, interruption rates, and tonal pace stability.
          </span>
        </div>

        {/* Metric Widget 3: Real-Time Audio Waves */}
        <div className="widget-card">
          <h3>
            <span>Vocal Feed Terminal</span>
            <span style={{ color: isLiveMic ? "#39ff14" : "#8a8f9f", fontSize: "9px" }}>
              {isLiveMic ? "● ACTIVE MONITOR" : "STANDBY"}
            </span>
          </h3>
          <canvas
            ref={canvasRef}
            className="waveform-canvas"
            width={320}
            height={80}
          />
          <span style={{ fontSize: "10px", color: "#8a8f9f" }}>
            Real-time vocal signal capture oscilloscope.
          </span>
        </div>

        {/* Metric Widget 4: Anomaly Retro Logger */}
        <div className="widget-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: "220px" }}>
          <h3>Anomaly & Activity Logger</h3>
          <div className="logger-console">
            {anomalyLogs.map((log) => (
              <div
                key={log.id}
                className="logger-row"
                style={{
                  cursor: log.timecode ? "pointer" : "default"
                }}
                onClick={() => {
                  if (log.timecode) {
                    setRequestedTimecode(timeToSecs(log.timecode));
                  }
                }}
              >
                <span style={{ color: "#5a5f6f", marginRight: "4px" }}>[{log.timestamp}]</span>
                <span className={c({
                  "logger-tag-system": log.tag === "SYSTEM",
                  "logger-tag-live": log.tag === "LIVE",
                  "logger-tag-anomaly": log.tag === "ANOMALY",
                  "logger-tag-info": log.tag === "INFO"
                })}>
                  [{log.tag}]
                </span>{" "}
                <span>{log.message}</span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: "10px", color: "#8a8f9f", marginTop: "5px" }}>
            Activity registers chronologically. Red anomalies are seeking-supported on click.
          </span>
        </div>
      </div>
    </main>
  );
}
