import { describe, it, expect } from "vitest";
import { timeAgo } from "./relativeTime";

const now = new Date("2026-11-13T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe("timeAgo", () => {
  it("says 'just now' under a minute and for future timestamps", () => {
    expect(timeAgo(ago(30), now)).toBe("just now");
    expect(timeAgo(ago(-120), now)).toBe("just now");
  });

  it("counts minutes from 1 to 59", () => {
    expect(timeAgo(ago(60), now)).toBe("1 min ago");
    expect(timeAgo(ago(14 * 60 + 20), now)).toBe("14 min ago");
    expect(timeAgo(ago(59 * 60 + 59), now)).toBe("59 min ago");
  });

  it("counts hours from 1 to 23", () => {
    expect(timeAgo(ago(60 * 60), now)).toBe("1 hr ago");
    expect(timeAgo(ago(5 * 3600 + 600), now)).toBe("5 hr ago");
    expect(timeAgo(ago(23 * 3600 + 3000), now)).toBe("23 hr ago");
  });

  it("counts days from 1", () => {
    expect(timeAgo(ago(24 * 3600), now)).toBe("1 day ago");
    expect(timeAgo(ago(3 * 24 * 3600), now)).toBe("3 days ago");
  });
});
