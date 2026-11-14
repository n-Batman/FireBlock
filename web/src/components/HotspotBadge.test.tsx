import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HotspotBadge } from "./HotspotBadge";

describe("HotspotBadge", () => {
  it("reads exactly '0 active fires within 25 mi' for zero", () => {
    render(<HotspotBadge count={0} />);
    expect(screen.getByText("0 active fires within 25 mi")).toBeInTheDocument();
  });

  it("uses the singular for one fire", () => {
    render(<HotspotBadge count={1} />);
    expect(screen.getByText("1 active fire within 25 mi")).toBeInTheDocument();
  });
});
