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
import {useCallback, useEffect, useMemo, useState} from 'react';
import {timeToSecs} from './utils';

const formatTime = (t) =>
  `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, '0')}`;

export default function VideoPlayer({
  url,
  timecodeList,
  requestedTimecode,
  isLoadingVideo,
  videoError,
  jumpToTimecode,
  onFileSelect,
  fileName = null,
  uploadProgress = 0,
}) {
  const [video, setVideo] = useState(null);
  const [duration, setDuration] = useState(0);
  const [scrubberTime, setScrubberTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [currentCaption, setCurrentCaption] = useState(null);
  const currentSecs = duration * scrubberTime || 0;
  const currentPercent = scrubberTime * 100;
  const timecodeListReversed = useMemo(
    () => (timecodeList ? [...timecodeList].reverse() : []),
    [timecodeList],
  );

  const togglePlay = useCallback(() => {
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  }, [isPlaying, video]);

  const updateDuration = () => {
    if (video) setDuration(video.duration);
  };

  const updateTime = () => {
    if (!video) return;
    if (!isScrubbing) {
      setScrubberTime(video.currentTime / video.duration);
    }

    if (timecodeList && timecodeListReversed) {
      setCurrentCaption(
        timecodeListReversed.find(
          (t) => timeToSecs(t.time) <= video.currentTime,
        )?.text,
      );
    }
  };

  const onPlay = () => setIsPlaying(true);
  const onPause = () => setIsPlaying(false);

  useEffect(() => {
    setScrubberTime(0);
    setIsPlaying(false);
  }, [url]);

  useEffect(() => {
    if (video && requestedTimecode !== null) {
      video.currentTime = requestedTimecode;
    }
  }, [video, requestedTimecode]);

  useEffect(() => {
    const onKeyPress = (e) => {
      if (
        e.target.tagName !== 'INPUT' &&
        e.target.tagName !== 'TEXTAREA' &&
        e.key === ' '
      ) {
        togglePlay();
      }
    };

    addEventListener('keypress', onKeyPress);

    return () => {
      removeEventListener('keypress', onKeyPress);
    };
  }, [togglePlay]);

  return (
    <div className="videoPlayer">
      {url && !isLoadingVideo ? (
        <>
          <div>
            <video
              src={url}
              ref={setVideo}
              onClick={togglePlay}
              preload="auto"
              crossOrigin="anonymous"
              onDurationChange={updateDuration}
              onTimeUpdate={updateTime}
              onPlay={onPlay}
              onPause={onPause}
            />

            {currentCaption && (
              <div className="videoCaption">{currentCaption}</div>
            )}
          </div>

          <div className="videoControls">
            <div className="videoScrubber">
              <input
                style={{'--pct': `${currentPercent}%`}}
                type="range"
                min="0"
                max="1"
                value={scrubberTime || 0}
                step="0.000001"
                onChange={(e) => {
                  setScrubberTime(e.target.valueAsNumber);
                  if (video) {
                    video.currentTime = e.target.valueAsNumber * duration;
                  }
                }}
                onPointerDown={() => setIsScrubbing(true)}
                onPointerUp={() => setIsScrubbing(false)}
              />
            </div>
            <div className="timecodeMarkers">
              {timecodeList?.map(({time, text, value}, i) => {
                const secs = timeToSecs(time);
                const pct = (secs / duration) * 100;

                return (
                  <div
                    className="timecodeMarker"
                    key={i}
                    style={{left: `${pct}%`}}>
                    <div
                      className="timecodeMarkerTick"
                      onClick={() => jumpToTimecode(secs)}>
                      <div />
                    </div>
                    <div
                      className={c('timecodeMarkerLabel', {right: pct > 50})}>
                      <div>{time}</div>
                      <p>{value || text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="videoTime">
              <button>
                <span className="icon" onClick={togglePlay}>
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </button>
              {formatTime(currentSecs)} / {formatTime(duration)}
            </div>
          </div>
        </>
      ) : (
        <div
          className="emptyVideo"
          style={{ cursor: isLoadingVideo ? 'default' : 'pointer', minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => {
            if (!isLoadingVideo && onFileSelect) {
              document.getElementById('video-file-input')?.click();
            }
          }}
        >
          {fileName ? (
            <div style={{ textAlign: "center", padding: "20px 30px" }}>
              <p style={{ color: "#39ff14", fontWeight: "bold", marginBottom: "8px", fontSize: "14px", fontFamily: "Space Mono, monospace" }}>
                ✓ COGNITIVE SESSION RESTORED
              </p>
              <p style={{ color: "#e4e6eb", fontSize: "12px", marginBottom: "12px", fontFamily: "Space Mono, monospace" }}>
                Active File: <code style={{ background: "#282a30", padding: "2px 6px", borderRadius: "3px", color: "#87a9ff" }}>{fileName}</code>
              </p>
              <p style={{ color: "#8a8f9f", fontSize: "11px", maxWidth: "450px", margin: "0 auto", lineHeight: "1.5", fontFamily: "Space Mono, monospace" }}>
                The video is already uploaded and fully processed on the server. You can run diagnostics immediately below! To enable local video playback and interactive timeline scrubbing, drag-and-drop or select your local copy of <code>{fileName}</code>.
              </p>
              <div style={{ marginTop: "15px" }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    document.getElementById('video-file-input')?.click();
                  }}
                  style={{
                    background: "#16171b",
                    border: "1px solid #282a30",
                    color: "#39ff14",
                    fontSize: "11px",
                    padding: "6px 12px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontFamily: "Space Mono, monospace"
                  }}
                >
                  📁 Upload Different Video
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "35px 20px" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>📁</div>
              <p style={{ color: "#ffffff", fontSize: "13px", marginBottom: "15px", fontFamily: "Space Mono, monospace", fontWeight: "bold" }}>
                {isLoadingVideo
                  ? (uploadProgress > 0 && uploadProgress < 100
                      ? `Uploading payload: ${uploadProgress}%`
                      : 'Processing video audio track...')
                  : videoError
                    ? 'Error processing video file.'
                    : 'Drag and drop a video file here, or click to browse.'}
              </p>
              {!isLoadingVideo && (
                <button
                  type="button"
                  style={{
                    background: "#16171b",
                    border: "1px solid #39ff14",
                    color: "#39ff14",
                    fontSize: "11px",
                    padding: "8px 16px",
                    borderRadius: "4px",
                    fontFamily: "Space Mono, monospace",
                    cursor: "pointer"
                  }}
                >
                  SELECT VIDEO FILE
                </button>
              )}
            </div>
          )}
          <input
            id="video-file-input"
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0] && onFileSelect) {
                onFileSelect(e.target.files[0]);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
