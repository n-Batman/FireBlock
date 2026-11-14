import { beforeEach, describe, expect, it } from "vitest";
import type { GridScan } from "@/data/types";
import { clearMemoryCache, getCached, hashImage, putCached } from "./scanCache";

const grid = (n: number): GridScan => ({ cells: Array(96).fill("g"), findings: [{ label: `F${n}`, where: "", severity: "clear", reason: "", action: "", cells: [n] }] });
const store = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

beforeEach(clearMemoryCache);

describe("scanCache", () => {
  it("hashes the same image to the same key and different images apart", () => {
    expect(hashImage("data:image/jpeg;base64,AAAA")).toBe(hashImage("data:image/jpeg;base64,AAAA"));
    expect(hashImage("data:image/jpeg;base64,AAAA")).not.toBe(hashImage("data:image/jpeg;base64,AAAB"));
  });

  it("returns a stored grid from memory, and from localStorage after memory is cleared", () => {
    const s = store();
    putCached("h1", grid(1), s);
    expect(getCached("h1")?.findings[0].label).toBe("F1");
    clearMemoryCache();
    expect(getCached("h1")).toBeNull(); // no storage given, nothing in memory
    expect(getCached("h1", s)?.findings[0].label).toBe("F1"); // a reload finds it in localStorage
  });

  it("keeps only the newest 12 in localStorage", () => {
    const s = store();
    for (let i = 0; i < 15; i++) putCached(`h${i}`, grid(i), s);
    clearMemoryCache();
    expect(getCached("h0", s)).toBeNull();
    expect(getCached("h14", s)).not.toBeNull();
  });

  it("treats broken or blocked storage as a miss and still caches in memory", () => {
    const bad = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(getCached("x", bad)).toBeNull();
    putCached("x", grid(3), bad);
    expect(getCached("x", bad)).not.toBeNull();
  });
});
