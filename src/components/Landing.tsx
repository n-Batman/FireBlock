import Image from "next/image";
import Link from "next/link";

export function Landing() {
  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col items-center justify-end bg-paper pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] sm:pb-[max(3rem,env(safe-area-inset-bottom))]">
      <Image src="/landing-map.jpg" alt="" fill sizes="100vw" preload className="object-cover" />
      <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-paper via-paper/55 to-paper/15" />

      <div className="glass relative w-full max-w-3xl p-6 sm:p-8">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-6xl">FireBlock</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2 sm:text-base">
          Block-by-block fire prep for vineyards, from satellite and your phone camera.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/?map=1"
            prefetch={false}
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            Open the map
          </Link>
          <Link
            href="/scan"
            className="inline-flex h-11 min-w-11 items-center justify-center rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-white/5 active:scale-[0.98]"
          >
            Scan a block
          </Link>
        </div>
      </div>
    </main>
  );
}
