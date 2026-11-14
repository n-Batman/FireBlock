import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearMemoryCache } from "./scanCache";
import { useScanSession } from "./useScanSession";

// jsdom cannot decode or draw images: the pixel analysis is tested in fuelMask.test.ts, here it is a fixed map.
const MAP = {
  w: 4,
  h: 3,
  labels: new Uint8Array(12),
  verdict: { risk: 3, clear: 9, share: 0.25, level: "moderate", text: "Moderate risk: 25% of the vegetation looks dry." },
  areas: [{ id: 1, box: [0.5, 0.6, 1, 1], pctOfRisk: 100, pctOfFrame: 25, where: "bottom right" }],
  colourOnly: false,
};
const analyse = vi.fn((..._args: unknown[]) => MAP);
vi.mock("./fuelMask", () => ({
  analyse: (...args: unknown[]) => analyse(...args),
  loadImage: async () => ({ naturalWidth: 1024, naturalHeight: 768 }),
}));
const NOTE = { area: 1, label: "Cured grass", reason: "Tan and standing.", action: "Mow it." };
/** Answers like the real routes: masks from /api/segment, words from /api/findings. */
const routes = (url: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => (url === "/api/segment" ? { polygons: [[[0, 0], [10, 0], [10, 10]]] } : { notes: [NOTE] }),
  });

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
  clearMemoryCache();
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
  });
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
  it("sends each frame at up to 1024 px on the long side as JPEG quality 0.85", async () => {
    fetchMock.mockResolvedValue(ok());
    await startSession();
    expect(canvasSize[0]).toEqual([1024, 576]);
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

  it("freezes on tap: aborts the live request, pauses the video, scans the frozen frame once and then sends nothing", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { video, hook } = await startSession();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    act(() => hook.result.current.toggleFreeze());
    expect(hook.result.current.frozen).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(video.pause).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // the frozen frame

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("maps an uploaded photo at 1024 px with the SAM3 masks, shows it, then fetches the words", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close: () => {} })));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
    fetchMock.mockImplementation(routes);
    const ref = { current: liveVideo() }; // stable, like a real useRef
    const hook = renderHook(() => useScanSession(ref));
    await act(async () => {
      await hook.result.current.startPhoto(new File(["x"], "row.jpg", { type: "image/jpeg" }));
    });
    await advance(1);
    expect(canvasSize[0]).toEqual([1024, 768]);
    expect(jpegQuality[0]).toBe(0.85);
    expect(hook.result.current.mode).toBe("photo");
    expect(hook.result.current.fuel?.verdict.share).toBe(0.25);
    expect(analyse.mock.calls.at(-1)?.[3]).toEqual([[[0, 0], [10, 0], [10, 10]]]); // the masks went in
    expect(hook.result.current.notes).toEqual([NOTE]);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/segment", "/api/findings"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).areas).toEqual(MAP.areas); // the words are about the measured areas only
  });

  it("falls back to colour only when segmentation fails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: () => {} })));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
    fetchMock.mockImplementation((url: string) =>
      url === "/api/segment" ? Promise.resolve({ ok: false, status: 502, json: async () => ({}) }) : routes(url),
    );
    const ref = { current: liveVideo() }; // stable, like a real useRef
    const hook = renderHook(() => useScanSession(ref));
    await act(async () => {
      await hook.result.current.startPhoto(new File(["y"], "row.jpg", { type: "image/jpeg" }));
    });
    await advance(1);
    expect(analyse.mock.calls.at(-1)?.[3]).toBeNull();
    expect(hook.result.current.fuel).not.toBeNull();
  });

  it("maps the same photo again from the cache, with no requests, and flags the shimmer while one is in flight", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: () => {} })));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
    let release!: () => void;
    fetchMock.mockImplementation((url: string) =>
      url === "/api/segment" ? new Promise((r) => (release = () => r(routes(url)))) : routes(url),
    );
    const ref = { current: liveVideo() }; // stable, like a real useRef
    const hook = renderHook(() => useScanSession(ref));
    const file = new File(["x"], "row.jpg", { type: "image/jpeg" });
    await act(async () => {
      await hook.result.current.startPhoto(file);
    });
    expect(hook.result.current.scanning).toBe(true);
    await act(async () => release());
    await advance(1);
    expect(hook.result.current.scanning).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      hook.result.current.stop();
      await hook.result.current.startPhoto(file);
    });
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // masks and words both came from the cache
    expect(hook.result.current.notes).toEqual([NOTE]);
  });

  it("maps the frozen frame once and asks for its words; nothing more while frozen", async () => {
    fetchMock.mockImplementation(routes);
    const { hook } = await startSession();
    await act(async () => hook.result.current.toggleFreeze());
    await advance(1);
    expect(hook.result.current.fuel?.areas).toHaveLength(1);
    expect(hook.result.current.notes).toEqual([NOTE]);
    const frozenCalls = fetchMock.mock.calls.length;
    await advance(10_000);
    expect(fetchMock.mock.calls.length).toBe(frozenCalls);
  });
});
