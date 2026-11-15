import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ScanScreen } from "./ScanScreen";

let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query), useRouter: () => ({ push: vi.fn() }) }));
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
  query = "";
});

describe("ScanScreen parcel save label", () => {
  const rated = { ...IDLE, phase: "running", mode: "photo", photo: { src: "blob:x", image: "data:x" }, scanning: false, tracker: { tracks: [], status: "clear" }, fuel: { w: 1, h: 1, labels: new Uint8Array([2]), verdict: { risk: 1, clear: 1, share: 0.5, level: "high", text: "x" }, areas: [], colourOnly: false } };

  it("says Save to parcel for a parcel's first scan and Save rescan when it already has one", () => {
    query = "parcel=014-331-010";
    session = rated;
    const { unmount } = render(<ScanScreen />);
    expect(screen.getByRole("button", { name: "Save to parcel" })).toBeInTheDocument();
    unmount();
    query = "parcel=014-331-010&rescan=1";
    render(<ScanScreen />);
    expect(screen.getByRole("button", { name: "Save rescan" })).toBeInTheDocument();
  });

  it("keeps Save to block for the sample blocks even with rescan in the URL", () => {
    query = "rescan=1";
    session = rated;
    render(<ScanScreen />);
    expect(screen.queryByRole("button", { name: "Save rescan" })).toBeNull();
  });
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
