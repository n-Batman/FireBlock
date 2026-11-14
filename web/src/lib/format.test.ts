import { describe, it, expect } from "vitest";
import { formatAsOf, formatMoney } from "./format";

describe("formatMoney", () => {
  it("writes whole dollars with a thousands separator", () => {
    expect(formatMoney(1728)).toBe("$1,728");
    expect(formatMoney(648)).toBe("$648");
    expect(formatMoney(0)).toBe("$0");
  });
});

describe("formatAsOf", () => {
  it("formats an ISO timestamp in Pacific time with a plain space before AM", () => {
    expect(formatAsOf("2026-11-13T07:00:00-08:00")).toBe("Nov 13, 7:00 AM PST");
  });
  it("converts other offsets to Pacific time", () => {
    expect(formatAsOf("2026-11-13T15:00:00Z")).toBe("Nov 13, 7:00 AM PST");
  });
});
