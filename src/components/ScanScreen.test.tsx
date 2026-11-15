import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ScanScreen } from "./ScanScreen";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/useDemoAvailable", () => ({ useDemoAvailable: () => false }));
vi.mock("@/lib/samples", () => ({ SAMPLES: [{ id: "row", label: "Straw between the vines", src: "/demo/sample-row.jpg" }] }));

const IDLE = {
  phase: "idle",
  mode: "camera",
  error: null,
  tracker: { tracks: [], status: "scanning" },
  videoSize: null,
  problem: false,
  frozen: false,
  photo: null,
  fuel: null,
  estimate: null,
  notes: null,
  scanning: false,
  start: vi.fn(),
  startPhoto: vi.fn(),
  startSample: vi.fn(),
  retry: vi.fn(),
  stop: vi.fn(),
  toggleFreeze: vi.fn(),
};
let session: Record<string, unknown> = IDLE;
vi.mock("@/lib/useScanSession", () => ({ useScanSession: () => session }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  session = { ...IDLE };
});

describe("ScanScreen", () => {
  it("offers the sample photos and one line of capture guidance on the idle card", () => {
    render(<ScanScreen />);
    expect(screen.getByText(/point down at the ground from a couple of steps back/i)).toBeInTheDocument();
    const samples = screen.getByRole("group", { name: "Try a sample photo" });
    fireEvent.click(within(samples).getByRole("button", { name: "Straw between the vines" }));
    expect(IDLE.startSample).toHaveBeenCalledWith("row");
  });

  it("shows the retry copy, a Retry button and the samples when a photo could not be scanned", () => {
    session = { ...IDLE, phase: "running", mode: "photo", photo: { src: "blob:x", image: "data:x" }, problem: true };
    render(<ScanScreen />);
    expect(screen.getByText("Could not reach the scanner. Try again, or use a sample photo.")).toBeInTheDocument();
    expect(screen.queryByText(/Scanning every part of the photo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(IDLE.retry).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Try a sample photo" })).toBeInTheDocument();
  });

  it("shows the same retry copy for a frozen camera frame, and none while a photo is fine", () => {
    session = { ...IDLE, phase: "running", mode: "camera", frozen: true, problem: true };
    const { unmount } = render(<ScanScreen />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    unmount();
    session = { ...IDLE, phase: "running", mode: "photo", photo: { src: "blob:x", image: "data:x" } };
    render(<ScanScreen />);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
