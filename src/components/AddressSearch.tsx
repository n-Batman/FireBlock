"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { locate, suggest, type Fetcher, type Place, type Suggestion } from "@/lib/geocode";

const DEBOUNCE_MS = 300;

type Result = { for: string; items: Suggestion[] } | { for: string; failed: true };

interface AddressSearchProps {
  onSelect: (place: Place) => void;
  apiKey?: string;
  fetcher?: Fetcher;
}

/** "Search an address or vineyard": ArcGIS autocomplete inside SLO County, debounced at 300 ms. */
export function AddressSearch({ onSelect, apiKey = process.env.NEXT_PUBLIC_ARCGIS_KEY, fetcher }: AddressSearchProps) {
  const listId = useId();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [missing, setMissing] = useState(false);
  // Only typing starts a search. Filling the box with the chosen address must not.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || text.trim().length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const items = await suggest(text, { key: apiKey, fetcher, signal: controller.signal });
        if (!controller.signal.aborted) setResult({ for: text, items });
      } catch {
        if (!controller.signal.aborted) setResult({ for: text, failed: true });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, apiKey, fetcher]);

  const current = result?.for === text ? result : null;
  const items = current && "items" in current ? current.items : [];
  const showList = open && items.length > 0;

  async function choose(suggestion: Suggestion) {
    typed.current = false;
    setText(suggestion.text);
    setOpen(false);
    setMissing(false);
    try {
      const place = await locate(suggestion, { key: apiKey, fetcher });
      if (place) onSelect(place);
      else setMissing(true);
    } catch {
      setResult({ for: suggestion.text, failed: true });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(items.length - 1, Math.max(0, i + step)));
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      void choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const note =
    current && "failed" in current
      ? { alert: true, text: "Search is not available right now. Try again in a moment." }
      : missing
        ? { alert: true, text: "Could not place that on the map. Try another result." }
        : open && current && items.length === 0
          ? { alert: false, text: "No matches in SLO County." }
          : null;

  return (
    <div className="relative w-full">
      {/* The focus ring sits on the rounded box, not as a hard rectangle around the input. */}
      <div className="glass flex h-11 items-center gap-2 px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
        <MagnifyingGlass size={18} aria-hidden="true" className="shrink-0 text-ink-2" />
        <input
          type="text"
          inputMode="search"
          style={{ outline: "none" }}
          role="combobox"
          aria-label="Search an address or vineyard"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder="Search an address or vineyard"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            setMissing(false);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-2"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matches in SLO County"
          className="glass pointer-events-auto absolute inset-x-0 top-full z-20 mt-1 max-h-[40dvh] overflow-y-auto py-1"
        >
          {items.map((s, i) => (
            <li
              key={s.magicKey}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the box so picking an option is not a blur first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void choose(s)}
              className={`flex min-h-11 cursor-pointer items-center px-3 text-[15px] leading-snug ${
                i === active ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              {s.text}
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p
          role={note.alert ? "alert" : undefined}
          className="glass pointer-events-auto absolute inset-x-0 top-full z-20 mt-1 px-3 py-2 text-[15px] text-ink-2"
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
