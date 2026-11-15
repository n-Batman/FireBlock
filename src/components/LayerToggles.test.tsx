import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LayerToggles } from "./LayerToggles";

it("renders controlled layer buttons without a Leaflet map", () => {
  const onParcels = vi.fn(), onGrid = vi.fn();
  const view = render(<LayerToggles showParcels showGrid={false} onParcels={onParcels} onGrid={onGrid} />);
  const boundaries = screen.getByRole("button", {name:"Property boundaries"});
  const grid = screen.getByRole("button", {name:"Risk grid"});
  expect(boundaries).toHaveAttribute("aria-pressed","true");
  expect(grid).toHaveAttribute("aria-pressed","false");
  expect(boundaries).toHaveClass("min-h-11");
  expect(grid).toHaveClass("min-h-11");
  fireEvent.click(boundaries);
  fireEvent.click(grid);
  expect(onParcels).toHaveBeenCalledOnce();
  expect(onGrid).toHaveBeenCalledOnce();
  view.rerender(<LayerToggles showParcels={false} showGrid onParcels={onParcels} onGrid={onGrid} />);
  expect(boundaries).toHaveAttribute("aria-pressed","false");
  expect(grid).toHaveAttribute("aria-pressed","true");
});
