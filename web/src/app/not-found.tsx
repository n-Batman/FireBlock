import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center p-4">
      <section className="glass w-full max-w-md p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          That page does not exist yet. The map has everything that is ready.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-[var(--r)] bg-ink px-4 text-[15px] font-semibold text-paper transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Back to the map
        </Link>
      </section>
    </main>
  );
}
