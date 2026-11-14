import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  it("says Scanning until the status is decided", () => {
    render(<StatusChip status="scanning" risks={0} problem={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Scanning$/);
  });

  it("counts the risks found, in the singular and the plural", () => {
    const { rerender } = render(<StatusChip status="risks" risks={2} problem={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 risks found");
    rerender(<StatusChip status="risks" risks={1} problem={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 risk found");
  });

  it("says All clear when nothing is wrong", () => {
    render(<StatusChip status="clear" risks={0} problem={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^All clear$/);
  });

  it("shows a connection problem over everything else", () => {
    render(<StatusChip status="risks" risks={2} problem />);
    expect(screen.getByRole("status")).toHaveTextContent("Connection problem");
  });
});
