import Image from "next/image";
import Link from "next/link";
import { MapTrifold, Scissors, ClipboardText } from "@phosphor-icons/react";

export function Landing() {
  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col items-center justify-end bg-paper pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] sm:items-start sm:justify-center sm:pb-[max(3rem,env(safe-area-inset-bottom))]">
      <Image src="/landing-map.jpg" alt="" fill sizes="100vw" preload className="object-cover" />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-paper via-paper/55 to-paper/15" />

      <div className="glass relative w-full max-w-xl p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wide text-ink-2">FireBlock · San Luis Obispo County</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-5xl">Know which vineyard blocks to clear before fire season.</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2 sm:text-base">
          Satellite data scores every parcel. Your phone camera checks the ground. Mow only what's dry and keep a dated record.
        </p>
        <ul className="mt-6 space-y-4 text-[15px] leading-snug">
          <li className="flex items-start gap-3">
            <MapTrifold size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
            <div><strong className="font-semibold">Find the dry blocks.</strong><p className="text-ink-2">Risk from satellite moisture and NASA fire detections, on real county parcels.</p></div>
          </li>
          <li className="flex items-start gap-3">
            <Scissors size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
            <div><strong className="font-semibold">Mow 2 blocks, not 10.</strong><p className="text-ink-2">Clear only the risky blocks and see what you save.</p></div>
          </li>
          <li className="flex items-start gap-3">
            <ClipboardText size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-2" />
            <div><strong className="font-semibold">Proof on file.</strong><p className="text-ink-2">Dated scans for the county's June 1 deadline or your insurer at renewal.</p></div>
          </li>
        </ul>
        <div className="mt-6 flex flex-col items-start gap-2">
          <Link
            href="/?map=1"
            prefetch={false}
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            Check my vineyard
          </Link>
          <Link
            href="/scan"
            className="inline-flex min-h-11 min-w-11 items-center text-[15px] text-ink-2 underline underline-offset-2"
          >
            or scan a block with your phone
          </Link>
        </div>
      </div>
    </main>
  );
}
