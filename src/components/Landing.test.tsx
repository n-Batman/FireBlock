import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Landing } from "./Landing";

it("links to the live map and scanner", () => {
  render(<Landing />);
  expect(screen.getByRole("heading", { level: 1, name: "Know which vineyard blocks to clear before fire season." })).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Check my vineyard" })).toHaveAttribute("href", "/?map=1");
  expect(screen.getByRole("link", { name: "or scan a block with your phone" })).toHaveAttribute("href", "/scan");
});
