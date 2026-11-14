"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera } from "@phosphor-icons/react";
import { properties } from "@/data/properties";
import { scanDelta, summarize, withScan } from "@/lib/scan";
import { scoreOf } from "@/lib/score";
import { saveScan, scanKey } from "@/lib/scanStore";
import { useScanSession } from "@/lib/useScanSession";
import { ScanOverlay } from "./ScanOverlay";
import { StatusChip } from "./StatusChip";

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
  const session = useScanSession(videoRef);
  const [demo, setDemo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { tracks, status } = session.tracker;
  const { risks, clears } = summarize(tracks);
  const running = session.phase === "running";
  const decided = status !== "scanning";
  const mapHref = property && block ? `/?property=${property.id}&block=${block.id}` : "/";

  const from = block ? scoreOf(block) : null;
  const to = block ? scoreOf(withScan(block, scanDelta(risks, clears), "")) : null;

  const begin = (useDemo: boolean) => session.start(useDemo ? "demo" : "camera");

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
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        aria-label="Camera view"
      />
      {running && (
        <>
          <h1 className="sr-only">Scanning {block ? block.name : "the rows"}</h1>
          <ScanOverlay videoSize={session.videoSize} tracks={tracks} running />
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
          <StatusChip status={status} risks={risks} problem={session.problem} />
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
              and brush touching structures, then updates the block&apos;s score.
            </p>
            <p className="mt-3 text-[15px]">
              {property && block
                ? `Scanning ${block.name} at ${property.name}.`
                : "Open a block on the map first to save what you find."}
            </p>
            {session.error && (
              <p role="alert" className="mt-4 rounded-[var(--r)] bg-high-bg px-3 py-2 text-[15px] text-high-ink">
                {session.error}
              </p>
            )}
            <div className="mt-4">
              <DemoSwitch checked={demo} onChange={setDemo} />
            </div>
            <button
              type="button"
              onClick={() => begin(demo)}
              disabled={session.phase === "starting"}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
            >
              <Camera size={18} aria-hidden="true" />
              {session.phase === "starting" ? "Starting..." : session.error ? "Try again" : "Start scan"}
            </button>
          </section>
        </div>
      )}

      {running && (
        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <section className="glass mx-auto w-full max-w-md space-y-3 p-4" aria-label="Scan result">
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
                onClick={save}
                disabled={!block || !decided}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              >
                Save to block
              </button>
              <button
                type="button"
                onClick={session.stop}
                className="inline-flex h-11 items-center justify-center rounded-[var(--r)] border border-[var(--glass-border)] px-4 text-[15px] font-medium transition-colors hover:bg-white/5 active:scale-[0.98]"
              >
                Stop
              </button>
            </div>
            <DemoSwitch
              checked={demo}
              onChange={(on) => {
                setDemo(on);
                begin(on);
              }}
            />
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
