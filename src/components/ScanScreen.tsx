"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, UploadSimple } from "@phosphor-icons/react";
import { properties } from "@/data/properties";
import { scanDelta, summarize, withScan } from "@/lib/scan";
import { scoreOf } from "@/lib/score";
import { currentPosition, LocationError } from "@/lib/geolocate";
import { saveParcelScan } from "@/lib/parcelScanStore";
import { saveScan, scanKey } from "@/lib/scanStore";
import { headlineVerdict, shownTracks } from "@/lib/scanView";
import { useScanSession } from "@/lib/useScanSession";
import { useDemoAvailable } from "@/lib/useDemoAvailable";
import { AreaFindingsList, FindingsList } from "./FindingsList";
import { FuelOverlay } from "./FuelOverlay";
import { ScanOverlay } from "./ScanOverlay";
import { StatusChip } from "./StatusChip";

const BTN = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r)] px-4 text-[15px] transition-opacity active:scale-[0.98] disabled:opacity-60";
const PRIMARY = `${BTN} bg-ink font-semibold text-paper hover:opacity-90`;
const SECONDARY = `${BTN} border border-[var(--glass-border)] font-medium hover:bg-white/5`;

function DemoSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-[15px]">
      <span>
        Demo mode
        <span className="block text-xs text-ink-2">Uses a recorded vineyard clip. No camera needed.</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-white/15 transition-colors after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-ink after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-5 peer-checked:after:bg-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink" />
    </label>
  );
}

export function ScanScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const property = properties.find((p) => p.id === params.get("property")) ?? null;
  const block =
    property?.blocks.find((b) => b.id === params.get("block") && b.kind === "vine") ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const session = useScanSession(videoRef);
  const [demo, setDemo] = useState(false);
  // The demo switch only shows when /demo/vineyard.mp4 is really there.
  const demoAvailable = useDemoAvailable() === true;
  // No camera API here (desktop, plain http) or the camera was blocked: uploading becomes the main option.
  const noCameraApi = useSyncExternalStore(
    () => () => {},
    () => !window.isSecureContext || !navigator.mediaDevices?.getUserMedia,
    () => false,
  );
  const noCamera = noCameraApi || (session.mode === "camera" && session.error !== null);
  const photoMode = session.mode === "photo";
  const [saveError, setSaveError] = useState<string | null>(null);
  // Opened from a county parcel: the scan is saved with the device's GPS, and lands in whichever parcel that is inside.
  const parcelId = params.get("parcel");
  const parcelMode = parcelId !== null;
  const [saving, setSaving] = useState(false);

  const { tracks } = session.tracker;
  // The overlay, the card and the score all read the same result: the fuel map (live, photo, frozen) or the tracked boxes (demo clip).
  const fuel = session.fuel;
  const call = headlineVerdict(fuel, session.estimate);
  const shown = shownTracks(tracks);
  // A fuel map is saved as dry and green parts per thousand of the rated vegetation: the score only uses the share.
  const counts =
    call && call.share !== null
      ? { risks: Math.round(call.share * 1000), clears: 1000 - Math.round(call.share * 1000) }
      : call
        ? { risks: 0, clears: 0 }
        : summarize(shown);
  const { risks, clears } = counts;
  const status = call ? (call.level === "none" ? "scanning" : call.level === "clear" ? "clear" : "risks") : session.tracker.status;
  const running = session.phase === "running";
  const decided = status !== "scanning";
  const mapHref = property && block ? `/?property=${property.id}&block=${block.id}` : "/";

  const from = block ? scoreOf(block) : null;
  const to = block ? scoreOf(withScan(block, scanDelta(risks, clears), "")) : null;

  const begin = (useDemo: boolean) => session.start(useDemo && demoAvailable ? "demo" : "camera");

  async function saveToParcel() {
    setSaveError(null);
    setSaving(true);
    try {
      const here = await currentPosition(navigator.geolocation);
      saveParcelScan(window.localStorage, { lat: here.lat, lon: here.lon, risks, clears, at: new Date().toISOString() });
      session.stop();
      router.push(`/?lat=${here.lat}&lon=${here.lon}`);
    } catch (error) {
      // No location means no parcel to put the scan in. It is not saved with a guessed one.
      setSaveError(error instanceof LocationError ? error.message : "The scan could not be saved in this browser.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!property || !block) return;
    try {
      saveScan(window.localStorage, scanKey(property.id, block.id), {
        risks,
        clears,
        at: new Date().toISOString(),
      });
    } catch {
      setSaveError("The scan could not be saved in this browser.");
      return;
    }
    session.stop();
    router.push(mapHref);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-paper text-ink">
      {photoMode && session.photo && (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, nothing for next/image to optimise
        <img src={session.photo.src} alt="The photo being scanned" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover ${photoMode ? "hidden" : ""}`}
        autoPlay
        muted
        playsInline
        aria-label="Camera view"
      />
      {running && (
        <>
          <h1 className="sr-only">Scanning {block ? block.name : parcelMode ? `parcel ${parcelId}` : "the rows"}</h1>
          {/* Tap anywhere on the camera to freeze the frame with its findings, tap again to resume. */}
          {!photoMode && (
            <button
              type="button"
              onClick={session.toggleFreeze}
              aria-pressed={session.frozen}
              aria-label={session.frozen ? "Resume scanning" : "Freeze the frame"}
              className="absolute inset-0 cursor-pointer"
            />
          )}
          {fuel ? (
            <FuelOverlay videoSize={session.videoSize} map={fuel} />
          ) : (
            <ScanOverlay videoSize={session.videoSize} tracks={shown} running frozen={session.frozen} />
          )}
          {((session.scanning && (photoMode || session.frozen || !fuel)) || (photoMode && !call && !session.problem)) && (
            <div role="status" className="pointer-events-none absolute inset-0 z-[5] grid place-items-center">
              <p className="glass px-5 py-3 text-[15px] font-medium">
                <span className="scan-shimmer">Scanning every part of the photo…</span>
              </p>
            </div>
          )}
        </>
      )}

      <Link
        href={mapHref}
        className="glass pointer-events-auto absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 inline-flex h-11 items-center gap-2 px-4 text-[15px] font-medium"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Map
      </Link>
      {running && (
        <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-10 -translate-x-1/2">
          <StatusChip status={status} risks={risks} problem={session.problem} areas={fuel?.areas.length} />
        </div>
      )}

      {!running && (
        <div className="absolute inset-0 grid place-items-center p-4">
          <section className="glass w-full max-w-md p-6" aria-labelledby="scan-title">
            <h1 id="scan-title" className="text-2xl font-semibold tracking-tight">
              Scan the rows
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              Point the camera at the rows, brush lines and buildings. FireBlock flags dry growth
              and brush touching structures, then{" "}
              {parcelMode ? "scores the parcel you are standing in." : "updates the block's score."}
            </p>
            <p className="mt-3 text-[15px]">
              {parcelMode
                ? `Scanning parcel ${parcelId}. Stand inside it: the scan is saved with your location.`
                : property && block
                  ? `Scanning ${block.name} at ${property.name}.`
                  : "Open a block on the map first to save what you find."}
            </p>
            {session.error && (
              <p role="alert" className="mt-4 rounded-[var(--r)] bg-high-bg px-3 py-2 text-[15px] text-high-ink">
                {session.error}
                {demoAvailable && session.mode === "camera" ? " Or try demo mode." : ""}
              </p>
            )}
            {demoAvailable && (
              <div className="mt-4">
                <DemoSwitch checked={demo} onChange={setDemo} />
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-label="Upload a photo to scan"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) session.startPhoto(file);
              }}
            />
            <div className={`mt-4 flex gap-2 ${noCamera ? "flex-col-reverse" : "flex-col"}`}>
              <button
                type="button"
                onClick={() => begin(demo)}
                disabled={session.phase === "starting"}
                className={`${noCamera ? SECONDARY : PRIMARY}`}
              >
                <Camera size={18} aria-hidden="true" />
                {session.phase === "starting" && !photoMode ? "Starting..." : session.error && !photoMode ? "Try again" : "Start scan"}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={session.phase === "starting"}
                className={noCamera ? PRIMARY : SECONDARY}
              >
                <UploadSimple size={18} aria-hidden="true" />
                Upload a photo
              </button>
            </div>
          </section>
        </div>
      )}

      {running && (
        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <section className="glass mx-auto w-full max-w-md space-y-3 p-4" aria-label="Scan result">
            {call && (
              <p aria-live="polite" className="text-[15px] font-semibold">
                {call.text}
              </p>
            )}
            {fuel?.colourOnly && (
              <p className="text-xs text-ink-2">Colour-only estimate: the vegetation outlines did not load, so bare dirt may show as dry.</p>
            )}
            {fuel ? (
              <AreaFindingsList areas={fuel.areas} notes={photoMode || session.frozen ? session.notes : []} />
            ) : (
              <FindingsList tracks={shown} empty="Looking for dry fuel in view..." />
            )}
            {session.frozen && (
              <p className="text-xs font-medium text-ink-2">Frozen. Tap the screen to resume.</p>
            )}
            {parcelMode && (
              <p aria-live="polite" className="text-[15px]">
                {decided
                  ? call
                    ? `This scan rates ${Math.round((call.share ?? 0) * 100)}% of the vegetation as dry.`
                    : `This scan flagged ${risks} of ${risks + clears} areas.`
                  : "Looking for risks..."}
              </p>
            )}
            {block && from !== null && to !== null && (
              <p aria-live="polite" className="text-[15px]">
                {decided ? (
                  <>
                    Scan changed score from <span className="num font-semibold">{from}</span> to{" "}
                    <span className="num font-semibold">{to}</span>.
                  </>
                ) : (
                  "Looking for risks..."
                )}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={parcelMode ? saveToParcel : save}
                disabled={(parcelMode ? saving : !block) || !decided}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              >
                {parcelMode ? (saving ? "Finding your location..." : "Save to parcel") : "Save to block"}
              </button>
              <button
                type="button"
                onClick={session.stop}
                className="inline-flex h-11 items-center justify-center rounded-[var(--r)] border border-[var(--glass-border)] px-4 text-[15px] font-medium transition-colors hover:bg-white/5 active:scale-[0.98]"
              >
                Stop
              </button>
            </div>
            {demoAvailable && !photoMode && (
              <DemoSwitch
                checked={demo}
                onChange={(on) => {
                  setDemo(on);
                  begin(on);
                }}
              />
            )}
            {saveError && (
              <p role="alert" className="text-[15px] text-high-ink">
                {saveError}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
