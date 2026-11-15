import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Landing } from "./Landing";

it("links to the live map and scanner", () => {
  render(<Landing />);

  expect(screen.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/?map=1");
  expect(screen.getByRole("link", { name: "Scan a block" })).toHaveAttribute("href", "/scan");
});
