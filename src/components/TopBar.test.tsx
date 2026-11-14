import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";
import { properties } from "@/data/properties";

const renderBar = (scanHref = "/scan?property=adelaida-hills", onOpenLimits = () => {}) =>
  render(
    <TopBar
      properties={properties}
      activeId="adelaida-hills"
      onChange={() => {}}
      cachedAt="2026-11-13T07:00:00-08:00"
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

  it("labels the sample properties as Demo", () => {
    renderBar();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(properties.map((p) => `Demo: ${p.name}`));
  });

  it("offers the parcels near the search as the first option, once there is a search", async () => {
    const onChange = vi.fn();
    render(
      <TopBar
        properties={properties}
        activeId="__parcels"
        parcelsAvailable
        onChange={onChange}
        cachedAt="2026-11-13T07:00:00-08:00"
        onOpenLimits={() => {}}
        scanHref="/scan"
      />,
    );
    const select = screen.getByRole("combobox", { name: "Property" });
    expect(select).toHaveValue("__parcels");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Parcels near your search");
    await userEvent.selectOptions(select, "edna-valley");
    expect(onChange).toHaveBeenCalledWith("edna-valley");
    await userEvent.selectOptions(select, "__parcels");
    expect(onChange).toHaveBeenCalledWith("__parcels");
  });

  it("has no parcels option before any search", () => {
    renderBar();
    expect(screen.queryByRole("option", { name: "Parcels near your search" })).toBeNull();
  });

  it("still opens Data & limits", async () => {
    const onOpenLimits = vi.fn();
    renderBar(undefined, onOpenLimits);
    await userEvent.click(screen.getByRole("button", { name: "Data & limits" }));
    expect(onOpenLimits).toHaveBeenCalledTimes(1);
  });
});
