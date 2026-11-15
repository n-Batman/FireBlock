import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MapLoading } from "./MapLoading";

it("renders the wordmark and loading status", () => {
  render(<MapLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("FireBlock");
  expect(screen.getByText("Loading the map…")).toBeInTheDocument();
});

it("limits spinning to motion-safe and disables the fade for reduced motion", () => {
  const { container } = render(<MapLoading fading />);
  expect(container.querySelector('[aria-hidden="true"]')).toHaveClass("motion-safe:animate-spin");
  expect(screen.getByRole("status")).toHaveClass("motion-reduce:transition-none");
});
