"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ScanResponse } from "@/data/types";
import { DEMO_CLIP_URL } from "./demoClip";
import { createTracker, updateTracker, type TrackerState } from "./scan";
import { selectFindings } from "./scanView";

export type Phase = "idle" | "starting" | "running" | "error";
export type Mode = "camera" | "demo";

/** Wait this long after a response (or a failure) before sending the next frame. */
const PAUSE_MS = 1500;
const MAX_SIDE = 640;
const JPEG_QUALITY = 0.7;
const MAX_FAILURES = 3;
export const DEMO_SRC = DEMO_CLIP_URL;

// The screen adds "Or try demo mode." itself, and only when the demo clip exists.
function explain(error: unknown, mode: Mode): string {
  if (mode === "demo") return "The demo video is not available right now.";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "insecure") return "The camera needs a secure page (HTTPS or localhost).";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device.";
  }
  return "The camera could not start. Try again.";
}

/**
 * Runs a scan: opens the camera (or the demo clip), sends a 640 px frame to /api/scan, folds
 * the findings into the tracker, then waits 1.5 s before the next frame, so only one request is
 * ever in flight. Stopping or freezing aborts the request in flight. Freezing also pauses the
 * video and keeps the findings on screen. All camera tracks are stopped when the scan stops or
 * the screen closes.
 */
export function useScanSession(videoRef: RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("camera");
  const [error, setError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<TrackerState>(createTracker);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [problem, setProblem] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<TrackerState>(tracker);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    }
  }, [videoRef]);

  const stop = useCallback(() => {
    release();
    setFrozen(false);
    setPhase("idle");
    setVideoSize(null);
  }, [release]);

  const start = useCallback(
    async (next: Mode) => {
      release();
      const fresh = createTracker();
      trackerRef.current = fresh;
      setTracker(fresh);
      setMode(next);
      setError(null);
      setProblem(false);
      setFrozen(false);
      setPhase("starting");
      const v = videoRef.current;
      if (!v) return;
      try {
        if (next === "camera") {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            throw new Error("insecure");
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          streamRef.current = stream;
          v.srcObject = stream;
        } else {
          v.src = DEMO_SRC;
          v.loop = true;
        }
        v.muted = true;
        v.playsInline = true;
        await v.play();
        setVideoSize({ w: v.videoWidth, h: v.videoHeight });
        setPhase("running");
      } catch (e) {
        release();
        setPhase("error");
        setError(explain(e, next));
      }
    },
    [release, videoRef],
  );

  /** Tap to freeze the frame and its findings, tap again to carry on. */
  const toggleFreeze = useCallback(() => {
    if (phase !== "running") return;
    const v = videoRef.current;
    if (frozen) {
      v?.play()?.catch(() => {});
    } else {
      v?.pause();
    }
    setFrozen(!frozen);
  }, [phase, frozen, videoRef]);

  // The scan loop. Leaving "running" or freezing runs the cleanup, which aborts any request.
  useEffect(() => {
    if (phase !== "running" || frozen) return;
    let cancelled = false;
    let failures = 0;
    let timer: number | undefined;
    const canvas = document.createElement("canvas");
    const controller = new AbortController();

    const run = async () => {
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
          const image = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ image, demoTime: mode === "demo" ? v.currentTime : undefined }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as ScanResponse;
          if (cancelled) return;
          failures = 0;
          setProblem(false);
          const result = updateTracker(trackerRef.current, selectFindings(data.findings));
          trackerRef.current = result.state;
          setTracker(result.state);
          if (result.newRisks.length > 0 && typeof navigator.vibrate === "function") {
            navigator.vibrate(20);
          }
        } catch {
          if (cancelled) return;
          failures += 1;
          if (failures >= MAX_FAILURES) setProblem(true);
        }
      }
      if (!cancelled) timer = window.setTimeout(run, PAUSE_MS);
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [phase, mode, frozen, videoRef]);

  // Leaving the screen always turns the camera off.
  useEffect(() => release, [release]);

  return { phase, mode, error, tracker, videoSize, problem, frozen, start, stop, toggleFreeze };
}
