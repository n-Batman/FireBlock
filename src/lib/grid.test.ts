import { describe, expect, it } from "vitest";
import type { CellCode, GridScan } from "@/data/types";
import { cellIndex, listFindings, parseGrid, regions, verdict, whereOf } from "./grid";

const grid = (rows: string[]) => rows.join("").split("") as CellCode[];
const FLAT = Array(8).fill("gggggggggggg") as string[];
const withRows = (over: Record<number, string>) => FLAT.map((r, i) => over[i] ?? r);
const json = (rows: unknown, findings: unknown[] = []) => JSON.stringify({ rows, findings });

describe("cellIndex", () => {
  it("maps labels to row-major indexes", () => {
    expect([cellIndex("A1"), cellIndex("L1"), cellIndex("C5"), cellIndex("l8")]).toEqual([0, 11, 50, 95]);
    expect([cellIndex("M1"), cellIndex("A9"), cellIndex("x")]).toEqual([null, null, null]);
  });
});

describe("parseGrid", () => {
  it("reads 8 rows of 12 letters and grows each finding from its anchor cell over the touching cells of that class", () => {
    const f = { label: "Dry grass", where: "right edge", reason: "Tan.", action: "Mow.", code: "d", anchor: "L1" };
    const out = parseGrid(json(withRows({ 0: "gggggggggddd", 1: "ggggggggggdd", 2: "dddddddddggg" }), [f]))!;
    expect(out.cells).toHaveLength(96);
    expect(out.findings[0].severity).toBe("risk");
    expect(out.findings[0].cells).toEqual([9, 10, 11, 22, 23]); // the right-edge patch, not the separate row 3 patch
  });

  it("takes severity from the class, and drops a finding whose anchor is not that class or whose class is neutral", () => {
    const rows = withRows({ 0: "dgggggggggww" });
    const f = (code: string, anchor: string) => ({ label: "x", where: "", reason: "r", action: "a", code, anchor });
    const out = parseGrid(json(rows, [f("g", "B1"), f("d", "B1"), f("w", "K1"), f("d", "Z9")]))!;
    expect(out.findings.map((x) => x.severity)).toEqual(["clear"]);
    expect(out.findings[0].action).toBe("");
  });

  it("ignores spaces and case in a row", () => {
    expect(parseGrid(json(withRows({ 0: "G G G G G G D D D D D D" })))!.cells[6]).toBe("d");
  });

  it("rejects a grid with the wrong number of rows, a short row or an unknown letter", () => {
    expect(parseGrid(json(FLAT.slice(1)))).toBeNull();
    expect(parseGrid(json(withRows({ 3: "ggggggg" })))).toBeNull();
    expect(parseGrid(json(withRows({ 3: "ggggggggggqg" })))).toBeNull();
    expect(parseGrid("not json")).toBeNull();
  });

  it("drops malformed findings but keeps the grid", () => {
    const out = parseGrid(json(FLAT, [{ label: "", code: "g", anchor: "A1", reason: "x" }, null, "text"]))!;
    expect(out.findings).toEqual([]);
    expect(out.cells).toHaveLength(96);
  });
});

describe("regions", () => {
  it("merges touching cells of one colour and keeps different colours and separated cells apart", () => {
    const cells = grid(withRows({ 0: "ddggggggggdd", 1: "dgggggggggdd" }));
    const out = regions(cells);
    const risks = out.filter((r) => r.tone === "risk");
    expect(risks.map((r) => r.cells.length).sort()).toEqual([3, 4]); // left L-shape and the right-edge block
  });

  it("treats d, b and l as one risk colour, and g, v and s as one clear colour", () => {
    const out = regions(grid(withRows({ 0: "dbldbldbl" + "ooo", 1: "gvsgvsgvs" + "ooo" })));
    expect(out.map((r) => [r.tone, r.cells.length])).toEqual([["risk", 9], ["clear", 9 + 12 * 6]]);
  });

  it("gives neutral cells no region and outlines only the outside edge", () => {
    const out = regions(grid(withRows({ 0: "wwwwwwwwwwww", 1: "ddoooooooooo" })));
    const risk = out.find((r) => r.tone === "risk")!;
    expect(risk.cells).toEqual([12, 13]);
    expect(risk.edges).toHaveLength(6); // a 2 x 1 block has 6 outer unit edges
    expect(out.some((r) => r.cells.includes(0))).toBe(false);
  });
});

describe("verdict", () => {
  it("is never all clear while any risk cell exists, even one", () => {
    const v = verdict(grid(withRows({ 0: "dggggggggggg" })));
    expect(v.level).toBe("low");
    expect(v.text).toMatch(/risk/i);
    expect(v.text).not.toMatch(/no risk/i);
  });

  it("is clear only with zero risk cells, and the share is risk / (risk + clear)", () => {
    expect(verdict(grid(FLAT)).level).toBe("clear");
    const half = verdict(grid(withRows({ 0: "ddddddgggggg", 1: "oooooooooooo", 2: "oooooooooooo", 3: "oooooooooooo", 4: "oooooooooooo", 5: "oooooooooooo", 6: "oooooooooooo", 7: "oooooooooooo" })));
    expect(half.share).toBe(0.5);
    expect(half.level).toBe("high");
  });

  it("leaves neutral cells out and says so when nothing could be rated", () => {
    const v = verdict(grid(Array(8).fill("oooooooooooo")));
    expect(v.share).toBeNull();
    expect(v.level).toBe("none");
  });

  it("steps from some to moderate to high risk at 15% and 40%", () => {
    const at = (risk: number) => verdict([...Array(risk).fill("d"), ...Array(100 - risk).fill("g")] as CellCode[]).level;
    expect([at(14), at(15), at(39), at(40)]).toEqual(["low", "moderate", "moderate", "high"]);
  });
});

describe("listFindings", () => {
  const scan = (rows: string[], findings: GridScan["findings"] = []): GridScan => ({ cells: grid(rows), findings });

  it("adds a plain finding for every risk region the model did not mention", () => {
    const out = listFindings(scan(withRows({ 0: "dddggggggggb" })));
    expect(out.map((f) => f.label).sort()).toEqual(["Dead brush or wood", "Dry grass"]);
    expect(out.every((f) => f.severity === "risk" && f.action !== "")).toBe(true);
  });

  it("does not repeat a region the model already described, and lists risks first, six at most", () => {
    const rows = withRows({ 0: "dgdgdgdgdgdg", 2: "dgdgdgdgdgdg" }); // 12 separate single-cell risk patches
    const cells = grid(rows);
    const mk = (anchor: number, severity: "risk" | "clear"): GridScan["findings"][number] => ({ label: `F${anchor}`, where: "", severity, reason: "r", action: "a", cells: [anchor] });
    const out = listFindings({ cells, findings: [mk(0, "risk"), mk(1, "clear")] });
    expect(out).toHaveLength(6);
    expect(out.every((f) => f.severity === "risk")).toBe(true); // 11 risk patches outrank the clear one
    expect(out.filter((f) => f.cells.includes(0))).toHaveLength(1); // cell 0 was described, so no duplicate
  });

  it("puts location words on a cell group", () => {
    expect(whereOf([11, 23])).toBe("top right");
    expect(whereOf([84, 85])).toBe("bottom left");
  });
});
