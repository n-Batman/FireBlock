"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MapTrifold, Printer } from "@phosphor-icons/react";
import { properties } from "@/data/properties";
import { formatAsOf, formatMoney } from "@/lib/format";
import { buildPlan, DEFAULT_RATE, HOURS_PER_ACRE, parseRate } from "@/lib/plan";
import { levelOf, scoreOf } from "@/lib/score";
import { applyScans } from "@/lib/scanStore";
import { useDaysUntilJune1 } from "@/lib/useDeadline";
import { useScans } from "@/lib/useScans";
import { RiskChip } from "./RiskChip";


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="num mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export function PlanScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const scans = useScans();
  const base = properties.find((p) => p.id === params.get("property")) ?? properties[0];
  // Saved scans count here too, so the plan matches the map.
  const property = useMemo(() => applyScans(base, scans), [base, scans]);

  const [rate, setRate] = useState(DEFAULT_RATE);
  const [rateText, setRateText] = useState(String(DEFAULT_RATE));
  const plan = buildPlan(property, rate);
  const days = useDaysUntilJune1();
  const habitat = property.blocks.filter((b) => b.kind === "habitat");

  const daysText = days === null ? "" : days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`;

  return (
    <main className="min-h-[100dvh] bg-paper px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="no-print flex flex-wrap items-center gap-2">
          <Link
            href={`/?property=${property.id}`}
            className="glass inline-flex h-11 items-center gap-2 px-4 text-[15px] font-medium transition-colors hover:bg-white/5"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Map
          </Link>
          <div className="ml-auto">
            <label htmlFor="plan-property" className="sr-only">
              Property
            </label>
            <select
              id="plan-property"
              value={property.id}
              onChange={(e) => router.replace(`/plan?property=${e.target.value}`)}
              className="glass h-11 px-4 text-[15px] font-medium text-ink"
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="glass inline-flex h-11 items-center gap-2 px-4 text-[15px] font-medium transition-colors hover:bg-white/5 active:scale-[0.98]"
          >
            <Printer size={18} aria-hidden="true" />
            Export PDF
          </button>
        </header>

        <section className="glass p-6" aria-labelledby="plan-title">
          <p className="text-[13px] text-ink-2">Fire-prep plan</p>
          <h1 id="plan-title" className="mt-1 text-2xl font-semibold tracking-tight">
            {property.name}
          </h1>

          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <Stat label="Until the June 1 county deadline" value={daysText} />
            <Stat label="Mowing time" value={`${plan.totalHours} hr`} />
            <Stat label="Estimated cost" value={formatMoney(plan.totalCost)} />
          </div>

          <div className="mt-5 border-t border-[var(--glass-border)] pt-4">
            <label htmlFor="rate" className="block text-[13px] text-ink-2">
              Crew rate, dollars per hour
            </label>
            <input
              id="rate"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => {
                setRateText(e.target.value);
                setRate((r) => parseRate(e.target.value, r));
              }}
              onBlur={() => setRateText(String(rate))}
              className="num mt-2 h-11 w-32 rounded-[var(--r)] border border-[var(--glass-border)] bg-surface px-3 text-[15px] text-ink"
            />
            <p className="mt-2 text-[13px] text-ink-2">
              Assumes {HOURS_PER_ACRE} hours of mowing per acre. Change the rate to match your crew.
            </p>
          </div>

          {!plan.urgent && (
            <p className="mt-4 rounded-[var(--r)] bg-low-bg px-3 py-2 text-[15px] text-low-ink">
              Nothing here needs urgent mowing. Check again after the next rain.
            </p>
          )}
        </section>

        <section className="glass" aria-labelledby="blocks-title">
          <h2 id="blocks-title" className="px-6 pt-5 text-lg font-semibold tracking-tight">
            Blocks, highest risk first
          </h2>
          <ol className="mt-3 divide-y divide-[var(--glass-border)] border-t border-[var(--glass-border)]">
            {plan.items.map((item) => {
              const score = scoreOf(item.block);
              return (
                <li key={item.block.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="num text-[13px] text-ink-2">{item.order}</span>
                    <h3 className="text-[17px] font-semibold">{item.block.name}</h3>
                    <RiskChip level={levelOf(score)} score={score} />
                    <span className="num ml-auto flex gap-3 text-[13px] text-ink-2">
                      <span>{item.block.acres} ac</span>
                      <span>{item.hours} hr</span>
                      <span>{formatMoney(item.cost)}</span>
                    </span>
                  </div>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-snug marker:text-ink-2">
                    {item.actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                  <Link
                    href={`/?property=${property.id}&block=${item.block.id}`}
                    className="no-print mt-3 inline-flex h-11 items-center gap-2 rounded-[var(--r)] border border-[var(--glass-border)] px-3 text-[15px] font-medium transition-colors hover:bg-white/5"
                  >
                    <MapTrifold size={18} aria-hidden="true" />
                    Show on map
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        {habitat.length > 0 && (
          <section className="glass p-6" aria-labelledby="nomow-title">
            <h2 id="nomow-title" className="text-lg font-semibold tracking-tight">
              Do not mow
            </h2>
            <ul className="mt-3 space-y-2 text-[15px]">
              {habitat.map((b) => (
                <li key={b.id} className="flex items-center gap-3">
                  <span className="hatch size-4 shrink-0 rounded-sm border border-line" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{b.name}</span>
                    <span className="text-ink-2"> stays wild. Mow up to its edge, not into it.</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-ink-2">
          Sample data cached {formatAsOf(property.cachedAt)}. An estimate of where to work first, not a
          fire prediction.
        </p>
      </div>
    </main>
  );
}
