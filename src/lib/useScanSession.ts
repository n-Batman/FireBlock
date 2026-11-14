"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GridScan, ScanResponse } from "@/data/types";
import { DEMO_CLIP_URL } from "./demoClip";
import { encodeFrame, MIN_SHARPNESS } from "./frame";
import { createTracker, updateTracker, type TrackerState } from "./scan";
import { selectFindings } from "./scanView";

export type Phase = "idle" | "starting" | "running" | "error";
export type Mode = "camera" | "demo" | "photo";

/** Wait this long after a response (or a failure) before sending the next frame. */
const PAUSE_MS = 1500;
const MAX_FAILURES = 3;
/** A blurry frame is skipped, but after this many in a row one is sent anyway (flat scenes score as blurry). */
const MAX_BLUR_SKIPS = 3;
const BLUR_RETRY_MS = 300;
export const DEMO_SRC = DEMO_CLIP_URL;

// The screen adds "Or try demo mode." itself, and only when the demo clip exists.
function explain(error: unknown, mode: Mode): string {
  if (mode === "demo") return "The demo video is not available right now.";
  if (mode === "photo") return "That file could not be read as a photo. Try a JPEG or PNG.";
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

async function scanImage(image: string, demoTime: number | undefined, signal: AbortSignal): Promise<ScanResponse> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, demoTime }),
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as ScanResponse;
}

/**
 * Runs a scan: opens the camera (or the demo clip), sends a sharp frame (at most 1280 px, JPEG 0.85,
 * blurry ones skipped) to /api/scan, folds
 * the findings into the tracker, then waits 1.5 s before the next frame, so only one request is
 * ever in flight. Stopping or freezing aborts the request in flight. Freezing also pauses the
 * video and keeps the findings on screen. All camera tracks are stopped when the scan stops or
 * the screen closes. startPhoto scans one uploaded photo the same way, once.
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
  const [photo, setPhoto] = useState<{ src: string; image: string } | null>(null);
  /** The latest grid from a live scan or a photo. Null for the demo clip, which uses `tracker`. */
  const [grid, setGrid] = useState<GridScan | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setPhoto(null);
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
      setGrid(null);
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
          // The sharpest stream the device allows; unsupported hints (focus mode) are ignored.
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
            },
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

  /** Scans one uploaded photo: same downscale, same tracker, same overlay as a camera frame. */
  const startPhoto = useCallback(
    async (file: File) => {
      release();
      const fresh = createTracker();
      trackerRef.current = fresh;
      setTracker(fresh);
      setGrid(null);
      setMode("photo");
      setError(null);
      setProblem(false);
      setFrozen(false);
      setPhase("starting");
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const { image } = encodeFrame(bitmap, bitmap.width, bitmap.height, undefined, true);
        const src = URL.createObjectURL(file);
        photoUrlRef.current = src;
        setPhoto({ src, image });
        setVideoSize({ w: bitmap.width, h: bitmap.height });
        bitmap.close();
        setPhase("running");
      } catch (e) {
        release();
        setPhase("error");
        setError(explain(e, "photo"));
      }
    },
    [release],
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
    if (phase !== "running" || frozen || mode === "photo") return;
    let cancelled = false;
    let failures = 0;
    let blurSkips = 0;
    let timer: number | undefined;
    const canvas = document.createElement("canvas");
    const controller = new AbortController();

    const run = async () => {
      const v = videoRef.current;
      let delay = PAUSE_MS;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          const { image, sharp } = encodeFrame(v, v.videoWidth, v.videoHeight, canvas, mode !== "demo");
          if (mode === "camera" && sharp !== null && sharp < MIN_SHARPNESS && blurSkips < MAX_BLUR_SKIPS) {
            blurSkips += 1;
            delay = BLUR_RETRY_MS;
          } else {
            blurSkips = 0;
            const data = await scanImage(image, mode === "demo" ? v.currentTime : undefined, controller.signal);
            if (cancelled) return;
            failures = 0;
            setProblem(false);
            if (data.grid) {
              setGrid(data.grid);
              if (data.grid.cells.some((c) => c === "d" || c === "b" || c === "l") && typeof navigator.vibrate === "function") {
                navigator.vibrate(20);
              }
            } else {
              const result = updateTracker(trackerRef.current, selectFindings(data.findings));
              trackerRef.current = result.state;
              setTracker(result.state);
              if (result.newRisks.length > 0 && typeof navigator.vibrate === "function") {
                navigator.vibrate(20);
              }
            }
          }
        } catch {
          if (cancelled) return;
          failures += 1;
          if (failures >= MAX_FAILURES) setProblem(true);
        }
      }
      if (!cancelled) timer = window.setTimeout(run, delay);
    };

    run();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [phase, mode, frozen, videoRef]);

  // An uploaded photo is scanned once.
  useEffect(() => {
    if (phase !== "running" || mode !== "photo" || !photo) return;
    const controller = new AbortController();
    scanImage(photo.image, undefined, controller.signal)
      .then((data) => setGrid(data.grid ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setProblem(true);
      });
    return () => controller.abort();
  }, [phase, mode, photo]);

  // Leaving the screen always turns the camera off.
  useEffect(() => release, [release]);

  return { phase, mode, error, tracker, videoSize, problem, frozen, photo, grid, start, startPhoto, stop, toggleFreeze };
}
