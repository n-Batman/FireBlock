import { describe, it, expect } from "vitest";
import { formatAsOf } from "./format";

describe("formatAsOf", () => {
  it("formats an ISO timestamp in Pacific time with a plain space before AM", () => {
    expect(formatAsOf("2026-11-13T07:00:00-08:00")).toBe("Nov 13, 7:00 AM PST");
  });
  it("converts other offsets to Pacific time", () => {
    expect(formatAsOf("2026-11-13T15:00:00Z")).toBe("Nov 13, 7:00 AM PST");
  });
});
