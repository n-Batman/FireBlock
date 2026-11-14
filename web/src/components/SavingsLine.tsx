import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import type { Property } from "@/data/types";
import { formatMoney } from "@/lib/format";
import { DEFAULT_RATE, savingsFor } from "@/lib/plan";

/** One line under the countdown: how much mowing only the High blocks saves. Links to /plan. */
export function SavingsLine({ property }: { property: Property }) {
  const { all, high, saved } = savingsFor(property, DEFAULT_RATE);
  const blocks = (n: number) => `${n} ${n === 1 ? "block" : "blocks"}`;

  let text: React.ReactNode;
  if (high.blocks === 0) text = "No High-risk blocks. No urgent mowing.";
  else
    text = (
      <>
        Mow <span className="num">{blocks(high.blocks)}</span>, not <span className="num">{all.blocks}</span>.
        Save <span className="num font-semibold">{formatMoney(saved.cost)}</span>.
      </>
    );

  return (
    <Link
      href={`/plan?property=${property.id}`}
      className="group flex min-h-11 items-center justify-between gap-3 border-b border-line px-6 py-2.5 text-[15px] text-ink transition-colors hover:bg-white/5"
    >
      <span>{text}</span>
      <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-ink-2 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
