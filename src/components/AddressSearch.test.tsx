import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AddressSearch } from "./AddressSearch";

const TABLAS = { text: "Tablas Creek Vineyard, 9339 Adelaida Rd, Paso Robles, CA, 93446, USA", magicKey: "k1" };
const SPRING = { text: "1000 Spring St, Paso Robles, CA, 93446, USA", magicKey: "k2" };

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

/** Answers suggest with `suggestions` and findAddressCandidates with the place for the chosen key. */
function geocoder(suggestions: { text: string; magicKey: string }[] = [TABLAS, SPRING]) {
  return vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
    void init;
    if (url.includes("/suggest")) return reply({ suggestions });
    const key = new URL(url).searchParams.get("magicKey");
    return reply({ candidates: [{ location: key === "k1" ? { x: -120.8597, y: 35.6363 } : { x: -120.6907, y: 35.6254 } }] });
  });
}

const suggestCalls = (f: ReturnType<typeof geocoder>) => f.mock.calls.filter(([u]) => u.includes("/suggest"));
const textOf = (call: [string, ...unknown[]]) => new URL(call[0]).searchParams.get("text");

const box = () => screen.getByRole("combobox", { name: "Search an address or vineyard" });
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const key = (name: string) => fireEvent.keyDown(box(), { key: name });
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

// Real user-event cannot be used here: Testing Library waits on a setTimeout that fake timers hold back.
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("AddressSearch", () => {
  it("is a labelled search box", () => {
    render(<AddressSearch onSelect={() => {}} fetcher={geocoder()} />);
    expect(box()).toHaveAttribute("placeholder", "Search an address or vineyard");
  });

  it("waits 300 ms after the last keystroke, then asks once", async () => {
    const fetcher = geocoder();
    render(<AddressSearch onSelect={() => {}} fetcher={fetcher} />);
    type("Tablas");
    await wait(299);
    expect(suggestCalls(fetcher)).toHaveLength(0);
    await wait(1);
    expect(suggestCalls(fetcher)).toHaveLength(1);
    expect(textOf(suggestCalls(fetcher)[0])).toBe("Tablas");
  });

  it("restarts the wait when typing continues, and cancels the search that is out of date", async () => {
    const fetcher = geocoder();
    render(<AddressSearch onSelect={() => {}} fetcher={fetcher} />);
    type("Tab");
    await wait(300);
    const firstSignal = suggestCalls(fetcher)[0][1]!.signal!;
    type("Tablas");
    expect(firstSignal.aborted).toBe(true);
    await wait(200);
    type("Tablas C"); // still typing: the 300 ms starts again
    await wait(200);
    expect(suggestCalls(fetcher)).toHaveLength(1);
    await wait(100);
    expect(suggestCalls(fetcher)).toHaveLength(2);
    expect(textOf(suggestCalls(fetcher)[1])).toBe("Tablas C");
  });

  it("lists the suggestions, and selecting one reports the place and closes the list", async () => {
    const onSelect = vi.fn();
    render(<AddressSearch onSelect={onSelect} fetcher={geocoder()} />);
    type("Tablas");
    await wait(300);
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.click(screen.getByRole("option", { name: TABLAS.text }));
    await wait(0);
    expect(onSelect).toHaveBeenCalledWith({ lat: 35.6363, lon: -120.8597, label: TABLAS.text });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveValue(TABLAS.text);
  });

  it("does not start another search when the box is filled with the chosen address", async () => {
    const fetcher = geocoder();
    render(<AddressSearch onSelect={() => {}} fetcher={fetcher} />);
    type("Tablas");
    await wait(300);
    fireEvent.click(screen.getByRole("option", { name: TABLAS.text }));
    await wait(1000);
    expect(suggestCalls(fetcher)).toHaveLength(1);
  });

  it("works from the keyboard: arrow down, enter", async () => {
    const onSelect = vi.fn();
    render(<AddressSearch onSelect={onSelect} fetcher={geocoder()} />);
    type("Spring");
    await wait(300);
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    await wait(0);
    expect(onSelect).toHaveBeenCalledWith({ lat: 35.6254, lon: -120.6907, label: SPRING.text });
  });

  it("closes the list on Escape", async () => {
    render(<AddressSearch onSelect={() => {}} fetcher={geocoder()} />);
    type("Tablas");
    await wait(300);
    key("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says plainly when nothing in SLO County matches", async () => {
    render(<AddressSearch onSelect={() => {}} fetcher={geocoder([])} />);
    type("Nowhere Road");
    await wait(300);
    expect(screen.getByText("No matches in SLO County.")).toBeInTheDocument();
  });

  it("says so when the search service fails, and does not pretend there were no matches", async () => {
    const failing = vi.fn(async () => reply({}, false));
    render(<AddressSearch onSelect={() => {}} fetcher={failing} />);
    type("Tablas");
    await wait(300);
    expect(screen.getByRole("alert")).toHaveTextContent("Search is not available right now. Try again in a moment.");
    expect(screen.queryByText("No matches in SLO County.")).toBeNull();
  });

  it("says so when a chosen place cannot be located", async () => {
    const noPoint = vi.fn(async (url: string) =>
      url.includes("/suggest") ? reply({ suggestions: [TABLAS] }) : reply({ candidates: [] }),
    );
    const onSelect = vi.fn();
    render(<AddressSearch onSelect={onSelect} fetcher={noPoint} />);
    type("Tablas");
    await wait(300);
    fireEvent.click(screen.getByRole("option"));
    await wait(0);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not place that on the map. Try another result.");
  });

  it("does not search for fewer than 3 characters", async () => {
    const fetcher = geocoder();
    render(<AddressSearch onSelect={() => {}} fetcher={fetcher} />);
    type("Ta");
    await wait(500);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
