"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ScanResponse } from "@/data/types";
import { createTracker, updateTracker, type TrackerState } from "./scan";

export type Phase = "idle" | "starting" | "running" | "error";
export type Mode = "camera" | "demo";

const TICK_MS = 1500;
const MAX_SIDE = 768;
const MAX_FAILURES = 3;
export const DEMO_SRC = "/demo/vineyard.mp4";

function explain(error: unknown, mode: Mode): string {
  if (mode === "demo") return "The demo video is not available right now.";
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (message === "insecure") {
    return "The camera needs a secure page (HTTPS or localhost). Try demo mode instead.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow the camera for this site, or try demo mode.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Try demo mode instead.";
  }
  return "The camera could not start. Try again, or use demo mode.";
}

/**
 * Runs a scan: opens the camera (or the demo clip), grabs a frame every 1.5 s, sends it to
 * /api/scan (never queuing a second request while one is in flight) and folds the findings
 * into the tracker. All camera tracks are stopped when the scan stops or the screen closes.
 */
export function useScanSession(videoRef: RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("camera");
  const [error, setError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<TrackerState>(createTracker);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [problem, setProblem] = useState(false);
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

  // The scan loop.
  useEffect(() => {
    if (phase !== "running") return;
    let inFlight = false;
    let cancelled = false;
    let failures = 0;
    const canvas = document.createElement("canvas");
    const controller = new AbortController();

    const tick = async () => {
      const v = videoRef.current;
      if (inFlight || !v || v.readyState < 2 || !v.videoWidth) return;
      inFlight = true;
      try {
        const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.8);
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
        const result = updateTracker(trackerRef.current, data.findings);
        trackerRef.current = result.state;
        setTracker(result.state);
        if (result.newRisks.length > 0 && typeof navigator.vibrate === "function") {
          navigator.vibrate(20);
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_FAILURES) setProblem(true);
      } finally {
        inFlight = false;
      }
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [phase, mode, videoRef]);

  // Leaving the screen always turns the camera off.
  useEffect(() => release, [release]);

  return { phase, mode, error, tracker, videoSize, problem, start, stop };
}
