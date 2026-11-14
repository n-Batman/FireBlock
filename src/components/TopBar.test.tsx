import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";

const renderBar = (scanHref = "/scan?property=adelaida-hills", onOpenLimits = () => {}) =>
  render(
    <TopBar
      placeLabel="Downtown SLO"
      onOpenLimits={onOpenLimits}
      scanHref={scanHref}
    />,
  );

describe("TopBar", () => {
  it("has a Scan link that opens the scanner for the property", () => {
    renderBar();
    expect(screen.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "/scan?property=adelaida-hills");
  });

  it("passes the selected block through to the scanner", () => {
    renderBar("/scan?property=adelaida-hills&block=adelaida-3");
    expect(screen.getByRole("link", { name: "Scan" })).toHaveAttribute(
      "href",
      "/scan?property=adelaida-hills&block=adelaida-3",
    );
  });

  it("keeps the Scan link a 44px tap target, like Data & limits", () => {
    renderBar();
    const scan = screen.getByRole("link", { name: "Scan" });
    const limits = screen.getByRole("button", { name: "Data & limits" });
    for (const el of [scan, limits]) {
      expect(el.className).toMatch(/\bh-11\b/);
      expect(el.className).toMatch(/\bmin-w-11\b/);
    }
  });

  it("shows the current place without offering demo properties", () => {
    renderBar();
    expect(screen.getByText("Downtown SLO")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Demo:/)).toBeNull();
  });

  it("still opens Data & limits", async () => {
    const onOpenLimits = vi.fn();
    renderBar(undefined, onOpenLimits);
    await userEvent.click(screen.getByRole("button", { name: "Data & limits" }));
    expect(onOpenLimits).toHaveBeenCalledTimes(1);
  });
});
