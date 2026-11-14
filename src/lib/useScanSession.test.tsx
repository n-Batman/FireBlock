import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScanSession } from "./useScanSession";

const IMAGE = "data:image/jpeg;base64,AAAA";
const ok = (findings: unknown[] = []) => ({ ok: true, status: 200, json: async () => ({ findings }) });
const finding = (n: number) => ({
  label: `Dry ${n}`,
  severity: "risk",
  action: "Mow by June 1",
  bbox: [n * 150, 100, n * 150 + 140, 400],
  confidence: 0.9,
});

let canvasSize: [number, number][];
let jpegQuality: number[];
const fetchMock = vi.fn();

/** A video element that looks like a live 1280x720 camera to the hook. */
function liveVideo() {
  const v = document.createElement("video");
  Object.defineProperties(v, {
    videoWidth: { value: 1280 },
    videoHeight: { value: 720 },
    readyState: { value: 4 },
  });
  v.play = vi.fn(async () => {});
  v.pause = vi.fn();
  v.load = vi.fn();
  return v;
}

async function startSession() {
  const video = liveVideo();
  const ref = { current: video }; // stable, like a real useRef
  const hook = renderHook(() => useScanSession(ref));
  await act(async () => {
    await hook.result.current.start("camera");
  });
  return { video, hook };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  canvasSize = [];
  jpegQuality = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, _t, q) {
    canvasSize.push([this.width, this.height]);
    jpegQuality.push(q as number);
    return IMAGE;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("useScanSession", () => {
  it("sends each frame at up to 1536 px on the long side as JPEG quality 0.85, never upscaled", async () => {
    fetchMock.mockResolvedValue(ok());
    await startSession();
    expect(canvasSize[0]).toEqual([1280, 720]); // a 1280 x 720 camera is not scaled up
    expect(jpegQuality[0]).toBe(0.85);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.image).toBe(IMAGE);
  });

  it("keeps one request in flight, then waits 1.5 s after the response before the next", async () => {
    const replies: ((v: unknown) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    await startSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(10_000); // a slow reply must not queue a second request
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => replies[0](ok()));
    await advance(1400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps going after a failed request, with the same pause", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network")).mockResolvedValue(ok());
    await startSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows at most 5 findings, and none below 0.6 confidence", async () => {
    const shaky = { ...finding(5), confidence: 0.4 };
    fetchMock.mockResolvedValue(ok([finding(0), finding(1), finding(2), finding(3), finding(4), finding(5), shaky]));
    const { hook } = await startSession();
    expect(hook.result.current.tracker.tracks).toHaveLength(5);
    expect(hook.result.current.tracker.tracks.some((t) => t.confidence === 0.4)).toBe(false);
  });

  it("freezes on tap: aborts the request in flight, pauses the video and sends nothing more", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { video, hook } = await startSession();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    act(() => hook.result.current.toggleFreeze());
    expect(hook.result.current.frozen).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(video.pause).toHaveBeenCalled();

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes on a second tap", async () => {
    fetchMock.mockResolvedValue(ok());
    const { video, hook } = await startSession();
    act(() => hook.result.current.toggleFreeze());
    await act(async () => hook.result.current.toggleFreeze());
    expect(hook.result.current.frozen).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(2); // once at start, once on resume
    await advance(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the frozen findings on screen", async () => {
    fetchMock.mockResolvedValue(ok([finding(0)]));
    const { hook } = await startSession();
    const before = hook.result.current.tracker.tracks;
    act(() => hook.result.current.toggleFreeze());
    await advance(10_000);
    expect(hook.result.current.tracker.tracks).toEqual(before);
  });

  it("aborts the request in flight when the user taps Stop", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { hook } = await startSession();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    act(() => hook.result.current.stop());
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.phase).toBe("idle");
    expect(hook.result.current.frozen).toBe(false);
  });

  it("asks the camera for 1920x1080 with continuous focus", async () => {
    fetchMock.mockResolvedValue(ok());
    await startSession();
    const { video } = (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(video).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: "continuous" }] });
  });

  it("scans an uploaded photo once at up to 1536 px, and keeps the grid it gets back", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close: () => {} })));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
    const cells = Array(96).fill("g");
    cells[11] = "d";
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ findings: [], grid: { cells, findings: [] } }) });
    const hook = renderHook(() => useScanSession({ current: liveVideo() }));
    await act(async () => {
      await hook.result.current.startPhoto(new File(["x"], "row.jpg", { type: "image/jpeg" }));
    });
    expect(canvasSize[0]).toEqual([1536, 1152]);
    expect(jpegQuality[0]).toBe(0.85);
    expect(hook.result.current.phase).toBe("running");
    expect(hook.result.current.mode).toBe("photo");
    expect(hook.result.current.videoSize).toEqual({ w: 4000, h: 3000 });
    expect(hook.result.current.grid?.cells[11]).toBe("d");
    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one photo, one request
  });
});
