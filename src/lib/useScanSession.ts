"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AreaNote, ScanResponse } from "@/data/types";
import { DEMO_CLIP_URL } from "./demoClip";
import { encodeFrame, type PhotoQuality } from "./frame";
import { analyse, loadImage, type FuelMap, type Mask } from "./fuelMask";
import { SAMPLES } from "./samples";
import { getCached, hashImage, putCached } from "./scanCache";
import { createTracker, updateTracker, type TrackerState } from "./scan";
import { headlineVerdict, selectFindings, type ScanEstimate } from "./scanView";

export type Phase = "idle" | "starting" | "running" | "error";
export type Mode = "camera" | "demo" | "photo";

/** Wait this long after a response (or a failure) before sending the next frame. */
const PAUSE_MS = 1500;
const MAX_FAILURES = 3;
/** A blurry, dark or foggy frame is skipped, but after this many in a row one is sent anyway (flat scenes score as blurry). */
const MAX_BLUR_SKIPS = 3;
const BLUR_RETRY_MS = 300;
/** The estimate is a bonus: past this the frame is rated by the SAM share alone. */
const ESTIMATE_TIMEOUT_MS = 12000;
/** Past this the masks are given up on and the frame is rated by colour alone. */
const SEGMENT_TIMEOUT_MS = 20000;
/** Past this the map is shown without the model's words. */
const FINDINGS_TIMEOUT_MS = 12000;
export const DEMO_SRC = DEMO_CLIP_URL;

/** Why an uploaded photo was not sent to the scanner, and what to do. */
const RETAKE: Record<Exclude<PhotoQuality, "ok">, string> = {
  blurry: "This photo is too blurry to rate. Hold the phone still and retake.",
  dark: "This photo is too dark to rate. Retake it in more light.",
  foggy: "This photo is too foggy to rate. Wait for a clearer view and retake.",
};

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

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

/** Runs `request` with a signal that aborts when `signal` does or after `ms`, whichever is first. */
async function timed<T>(signal: AbortSignal, ms: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  const timer = window.setTimeout(onAbort, ms);
  try {
    return await request(controller.signal);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** The demo clip's canned boxes from /api/scan. */
const demoScan = (image: string, demoTime: number, signal: AbortSignal) =>
  postJson<ScanResponse>("/api/scan", { image, demoTime }, signal);

/**
 * Grouped masks for a frame from /api/segment (Roboflow SAM3), cached by image hash. Null when
 * segmentation fails or takes over 20 s: the caller then rates by colour alone. An abort still throws.
 */
async function segment(image: string, hash: string, signal: AbortSignal): Promise<Mask[] | null> {
  const hit = getCached<Mask[]>(`seg:v2:${hash}`, storage());
  if (hit) return hit;
  try {
    const { masks } = await timed(signal, SEGMENT_TIMEOUT_MS, (s) => postJson<{ masks: Mask[] }>("/api/segment", { image }, s));
    putCached(`seg:v2:${hash}`, masks, storage());
    return masks;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/**
 * The model's words for the measured risk areas, given the headline dry `share`. Cached by image
 * hash, share (to the percent) and area boxes, so a different headline or different areas ask again. Throws after 12 s.
 */
async function fetchNotes(image: string, hash: string, map: FuelMap, share: number | null, signal: AbortSignal): Promise<AreaNote[]> {
  if (map.areas.length === 0 || share === null) return [];
  const boxes = map.areas.map((a) => a.box.map((v) => v.toFixed(3)).join(",")).join(";");
  const key = `notes:v2:${map.colourOnly ? "c" : "s"}:${Math.round(share * 100)}:${boxes}:${hash}`;
  const hit = getCached<AreaNote[]>(key, storage());
  if (hit) return hit;
  const { notes } = await timed(signal, FINDINGS_TIMEOUT_MS, (s) => postJson<{ notes: AreaNote[] }>("/api/findings", { image, areas: map.areas, share }, s));
  putCached(key, notes, storage());
  return notes;
}

/**
 * The model's rating of the dry share of the ground vegetation from /api/estimate, cached by image
 * hash. Null when it fails or takes over 12 s: the caller then uses the SAM share. Aborts when `signal` does.
 */
async function estimate(image: string, hash: string, signal: AbortSignal): Promise<ScanEstimate | null> {
  const hit = getCached<ScanEstimate>(`est:v1:${hash}`, storage());
  if (hit) return hit;
  try {
    const result = await timed(signal, ESTIMATE_TIMEOUT_MS, (s) => postJson<ScanEstimate>("/api/estimate", { image }, s));
    putCached(`est:v1:${hash}`, result, storage());
    return result;
  } catch {
    return null;
  }
}

/**
 * Masks (or colour only), then the per-pixel fuel map, all for one encoded frame. `est` is the estimate when it has
 * already come back: the map is then reconciled to its grid, dry_pct and veg_frac. Null if it cannot be drawn.
 */
async function mapFrame(image: string, hash: string, signal: AbortSignal, est: () => ScanEstimate | null | undefined) {
  try {
    const masks = await segment(image, hash, signal);
    const img = await loadImage(image);
    const used = est();
    const map = analyse(img, img.naturalWidth, img.naturalHeight, masks, used?.grid, used?.dry_pct, used?.veg_frac);
    const redo = () => {
      const e = est();
      return analyse(img, img.naturalWidth, img.naturalHeight, masks, e?.grid, e?.dry_pct, e?.veg_frac);
    };
    return { map, redo, used };
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/**
 * The fuel map and the estimate for one frame, requested in parallel. Either can be null. The map is built with the
 * estimate's grid, dry_pct and veg_frac if that is back first; if the estimate lands later the map is rebuilt once with it (no extra requests).
 */
async function rateFrame(image: string, hash: string, signal: AbortSignal) {
  let landed = null as ScanEstimate | null;
  const mapP = mapFrame(image, hash, signal, () => landed); // started first: /api/segment goes out before /api/estimate
  const estP = estimate(image, hash, signal).then((e) => {
    landed = e;
    return e;
  });
  const [built, est] = await Promise.all([mapP, estP]);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const map = built ? (built.map && landed?.grid && !built.used ? built.redo() : built.map) : null;
  return { map, est };
}

/**
 * Runs a scan: opens the camera (or the demo clip), sends a sharp frame (about 1024 px, JPEG 0.85,
 * blurry ones skipped) for vegetation masks, colours them pixel by pixel into a fuel map, and only then
 * waits 1.5 s and takes the next frame, so only one request is ever in flight. The demo clip still
 * folds canned boxes into the tracker. Stopping or freezing aborts the request in flight. Freezing also pauses the
 * video and keeps the findings on screen. All camera tracks are stopped when the scan stops or
 * the screen closes. A photo or a frozen frame is mapped once and then gets the model's words
 * (`notes`), which arrive after the overlay.
 */
export function useScanSession(videoRef: RefObject<HTMLVideoElement | null>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("camera");
  const [error, setError] = useState<string | null>(null);
  const [tracker, setTracker] = useState<TrackerState>(createTracker);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [problem, setProblem] = useState(false);
  const [frozen, setFrozen] = useState(false);
  /** A request is in flight: drives the "Scanning every part of the photo..." shimmer. */
  const [scanning, setScanning] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<TrackerState>(tracker);
  /** The still on screen. `notes` is set for a sample photo: its saved words, so nothing is asked for. */
  const [photo, setPhoto] = useState<{ src: string; image: string; notes?: AreaNote[] } | null>(null);
  /** Bumped by Retry: the photo or frozen frame is mapped again. */
  const [attempt, setAttempt] = useState(0);
  /** The latest fuel map from a live frame, a photo or a frozen frame. Null for the demo clip, which uses `tracker`. */
  const [fuel, setFuel] = useState<FuelMap | null>(null);
  /** The model's words for `fuel`'s risk areas. Null while they are on their way (or not asked for). */
  const [notes, setNotes] = useState<AreaNote[] | null>(null);
  /** The model's dry rating for the same frame as `fuel`. Null when it failed, timed out or is not in yet. */
  const [est, setEst] = useState<ScanEstimate | null>(null);
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
      setFuel(null);
      setEst(null);
      setNotes(null);
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

  /** Scans one uploaded photo: same downscale, same tracker, same overlay as a camera frame. A blurry, dark or foggy photo is not sent: it asks for a retake. */
  const startPhoto = useCallback(
    async (file: File) => {
      release();
      const fresh = createTracker();
      trackerRef.current = fresh;
      setTracker(fresh);
      setFuel(null);
      setEst(null);
      setNotes(null);
      setMode("photo");
      setError(null);
      setProblem(false);
      setFrozen(false);
      setPhase("starting");
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const { image, quality } = encodeFrame(bitmap, bitmap.width, bitmap.height);
        if (quality && quality !== "ok") {
          bitmap.close();
          release();
          setPhase("error");
          setError(RETAKE[quality]);
          return;
        }
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

  /**
   * Scans a sample still from public/demo with its saved masks, estimate and words: they go into the in-memory cache under
   * the still's hash, so the same path as an uploaded photo runs and makes no requests.
   */
  const startSample = useCallback(
    async (id: string) => {
      const sample = SAMPLES.find((s) => s.id === id);
      if (!sample) return;
      release();
      const fresh = createTracker();
      trackerRef.current = fresh;
      setTracker(fresh);
      setFuel(null);
      setEst(null);
      setNotes(null);
      setMode("photo");
      setError(null);
      setProblem(false);
      setFrozen(false);
      setPhase("starting");
      const hash = hashImage(sample.src);
      putCached(`seg:v2:${hash}`, sample.masks);
      putCached(`est:v1:${hash}`, sample.estimate);
      try {
        const img = await loadImage(sample.src);
        setPhoto({ src: sample.src, image: sample.src, notes: sample.notes ?? [] });
        setVideoSize({ w: img.naturalWidth, h: img.naturalHeight });
        setPhase("running");
      } catch (e) {
        release();
        setPhase("error");
        setError(explain(e, "photo"));
      }
    },
    [release],
  );

  /** Maps the same photo or frozen frame again after a failure. */
  const retry = useCallback(() => {
    setProblem(false);
    setAttempt((n) => n + 1);
  }, []);

  /** A frame rated while the shimmer counter is up. */
  const tracked = useCallback(async (image: string, hash: string, signal: AbortSignal) => {
    setScanning((n) => n + 1);
    try {
      return await rateFrame(image, hash, signal);
    } finally {
      setScanning((n) => Math.max(0, n - 1));
    }
  }, []);

  /** Photo and freeze: map the frame once, show it, then ask for the words (or use `saved` ones, for a sample). */
  const mapOnce = useCallback(
    (image: string, signal: AbortSignal, saved?: AreaNote[]) => {
      const hash = hashImage(image);
      tracked(image, hash, signal)
        .then(async ({ map, est }) => {
          if (signal.aborted) return;
          setFuel(map);
          setEst(est);
          if (!map) {
            if (!est) setProblem(true);
            return;
          }
          if (saved) return setNotes(saved);
          setNotes(null);
          // The estimate has already come back (or failed) by now: rateFrame waits for both.
          setNotes(await fetchNotes(image, hash, map, est ? (headlineVerdict(map, est)?.share ?? null) : map.verdict.share, signal));
        })
        .catch(() => {
          if (!signal.aborted) setNotes((n) => n ?? []);
        });
    },
    [tracked],
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
          const { image, quality } = encodeFrame(v, v.videoWidth, v.videoHeight, canvas);
          if (mode === "camera" && quality && quality !== "ok" && blurSkips < MAX_BLUR_SKIPS) {
            blurSkips += 1;
            delay = BLUR_RETRY_MS;
          } else {
            blurSkips = 0;
            if (mode === "camera") {
              const { map, est } = await tracked(image, hashImage(image), controller.signal);
              if (cancelled) return;
              if (!map && !est) throw new Error("no canvas");
              failures = 0;
              setProblem(false);
              setFuel(map);
              setEst(est);
              if (map && map.verdict.level !== "clear" && map.verdict.level !== "none" && typeof navigator.vibrate === "function") {
                navigator.vibrate(20);
              }
            } else {
              const data = await demoScan(image, v.currentTime, controller.signal);
              if (cancelled) return;
              failures = 0;
              setProblem(false);
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
  }, [phase, mode, frozen, videoRef, tracked]);

  // Freezing maps the frozen frame once and asks for its words (the live loop was stopped). The demo clip keeps its canned boxes.
  useEffect(() => {
    const v = videoRef.current;
    if (phase !== "running" || !frozen || mode !== "camera" || !v?.videoWidth) return;
    const controller = new AbortController();
    mapOnce(encodeFrame(v, v.videoWidth, v.videoHeight).image, controller.signal);
    return () => controller.abort();
  }, [phase, mode, frozen, videoRef, mapOnce, attempt]);

  // An uploaded photo (or a sample) is mapped once, and again on Retry.
  useEffect(() => {
    if (phase !== "running" || mode !== "photo" || !photo) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the shimmer counter goes up as the request starts and down in `finally`
    mapOnce(photo.image, controller.signal, photo.notes);
    return () => controller.abort();
  }, [phase, mode, photo, mapOnce, attempt]);

  // Rotating the phone changes the stream's shape ("resize" on the video): keep the overlay lined up with it.
  useEffect(() => {
    const v = videoRef.current;
    if (phase !== "running" || mode === "photo" || !v) return;
    const onResize = () => setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    v.addEventListener("resize", onResize);
    return () => v.removeEventListener("resize", onResize);
  }, [phase, mode, videoRef]);

  // Leaving the screen always turns the camera off.
  useEffect(() => release, [release]);

  return { phase, mode, error, tracker, videoSize, problem, frozen, photo, fuel, estimate: est, notes, scanning: scanning > 0, start, startPhoto, startSample, retry, stop, toggleFreeze };
}
