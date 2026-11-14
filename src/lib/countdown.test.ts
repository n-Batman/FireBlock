import { describe, it, expect } from "vitest";
import { daysUntilJune1 } from "./countdown";

describe("daysUntilJune1", () => {
  it("counts 200 days from Nov 13, 2026", () => {
    expect(daysUntilJune1(new Date(2026, 10, 13))).toBe(200);
  });
  it("is 0 on June 1", () => {
    expect(daysUntilJune1(new Date(2027, 5, 1))).toBe(0);
  });
  it("counts to next year's June 1 once the date has passed (2028 is a leap year)", () => {
    expect(daysUntilJune1(new Date(2027, 5, 2))).toBe(365);
  });
});
