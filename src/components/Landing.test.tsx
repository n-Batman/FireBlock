import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Landing } from "./Landing";

it("links to the live map and scanner", () => {
  render(<Landing />);
  expect(screen.getByRole("heading", { level: 1, name: "Know which parts of your land to clear before fire season." })).toBeInTheDocument();

  expect(screen.getByRole("link", { name: "Check my land" })).toHaveAttribute("href", "/?map=1");
  expect(screen.getByRole("link", { name: "or scan your land with your phone" })).toHaveAttribute("href", "/scan");
});
