import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clearMemoryCache } from "./scanCache";
import { headlineVerdict } from "./scanView";
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
/** A fixture still with its cached masks and estimate, like public/demo/samples.json. */
const SAMPLE_MASKS = vi.hoisted(() => [{ group: "dry", polys: [[[0, 0], [20, 0], [20, 20]]] }]);
vi.mock("./samples", () => ({
  SAMPLES: [{ id: "fixture", label: "Fixture row", src: "/demo/fixture.jpg", masks: SAMPLE_MASKS, estimate: { dry_pct: 70, veg_frac: 0.4, grid: [["dry"]] } }],
}));
/** Answers like the real routes: masks from /api/segment, words from /api/findings. */
const routes = (url: string) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () =>
      url === "/api/segment"
        ? { masks: [{ group: "dry", polys: [[[0, 0], [10, 0], [10, 10]]] }] }
        : url === "/api/estimate"
          ? EST
          : { notes: [NOTE] },
  });
const EST = { dry_pct: 60, veg_frac: 0.5, grid: [["dry"]] };
const failing = { ok: false, status: 502, json: async () => ({}) };

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
    expect(fetchMock).toHaveBeenCalledTimes(2); // masks and estimate, in parallel

    await advance(10_000); // a slow reply must not queue a second frame
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => replies.forEach((r) => r(ok())));
    await advance(1400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(200);
    expect(fetchMock).toHaveBeenCalledTimes(3); // the next frame (the test sends the same image, so its estimate is cached)
  });

  it("keeps going after a failed request, with the same pause", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network")).mockResolvedValue(ok());
    await startSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1600);
    expect(fetchMock).toHaveBeenCalledTimes(3); // same image: the estimate is cached
  });

  it("freezes on tap: aborts the live request, pauses the video, scans the frozen frame once and then sends nothing", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { video, hook } = await startSession();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;

    act(() => hook.result.current.toggleFreeze());
    expect(hook.result.current.frozen).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(video.pause).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4); // the frozen frame: masks and estimate

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    expect(analyse.mock.calls.at(-1)?.[3]).toEqual([{ group: "dry", polys: [[[0, 0], [10, 0], [10, 10]]] }]); // the masks went in
    expect(hook.result.current.notes).toEqual([NOTE]);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/segment", "/api/estimate", "/api/findings"]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).areas).toEqual(MAP.areas); // the words are about the measured areas only
  });

  describe("photo quality gate", () => {
    /** A 2D context whose pixels are `luma(x, y)` grey, so the quality check reads them. */
    const pixels = (luma: (x: number, y: number) => number) =>
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < w * h; i++) data.fill(luma(i % w, Math.floor(i / w)), i * 4, i * 4 + 3), (data[i * 4 + 3] = 255);
          return { data };
        },
      } as never);
    const upload = async () => {
      vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close: () => {} })));
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
      const ref = { current: liveVideo() };
      const hook = renderHook(() => useScanSession(ref));
      await act(async () => {
        await hook.result.current.startPhoto(new File(["x"], "row.jpg", { type: "image/jpeg" }));
      });
      await advance(1);
      return hook;
    };

    it("rejects a foggy upload with a retake message and no requests", async () => {
      pixels(() => 235);
      fetchMock.mockImplementation(routes);
      const hook = await upload();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(hook.result.current.phase).toBe("error");
      expect(hook.result.current.error).toBe("This photo is too foggy to rate. Wait for a clearer view and retake.");
      expect(hook.result.current.photo).toBeNull();
    });

    it("maps a sharp, well-lit upload as before", async () => {
      pixels((x, y) => ((x + y) % 2 ? 70 : 190));
      fetchMock.mockImplementation(routes);
      const hook = await upload();
      expect(hook.result.current.error).toBeNull();
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/segment", "/api/estimate", "/api/findings"]);
      expect(hook.result.current.fuel?.verdict.share).toBe(0.25);
    });

    it("skips dark camera frames (even sharp ones), then sends one anyway after three", async () => {
      pixels((x, y) => ((x + y) % 2 ? 5 : 45));
      fetchMock.mockResolvedValue(ok());
      await startSession();
      expect(fetchMock).not.toHaveBeenCalled();
      await advance(300 * 3);
      expect(fetchMock).toHaveBeenCalledTimes(2); // masks and estimate for the escape frame
    });
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
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      hook.result.current.stop();
      await hook.result.current.startPhoto(file);
    });
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3); // masks, estimate and words all came from the cache
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

  it("(a) startSample paints the cached still's fuel map and estimate with no requests", async () => {
    const ref = { current: liveVideo() };
    const hook = renderHook(() => useScanSession(ref));
    analyse.mockClear();
    await act(async () => hook.result.current.startSample("fixture"));
    await advance(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.result.current.mode).toBe("photo");
    expect(hook.result.current.photo?.src).toBe("/demo/fixture.jpg");
    expect(analyse.mock.calls.at(-1)?.slice(3)).toEqual([SAMPLE_MASKS, [["dry"]], 70]); // cached masks, grid and dry_pct
    expect(hook.result.current.fuel?.verdict.share).toBe(0.25);
    expect(hook.result.current.estimate).toEqual({ dry_pct: 70, veg_frac: 0.4, grid: [["dry"]] });
    expect(hook.result.current.notes).toEqual([]);
    expect(hook.result.current.scanning).toBe(false);
  });

  describe("estimate", () => {
    const photo = async () => {
      vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: () => {} })));
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
      const ref = { current: liveVideo() };
      const hook = renderHook(() => useScanSession(ref));
      await act(async () => {
        await hook.result.current.startPhoto(new File(["x"], "row.jpg", { type: "image/jpeg" }));
      });
      return hook;
    };
    const headline = (h: Awaited<ReturnType<typeof photo>>) => headlineVerdict(h.result.current.fuel, h.result.current.estimate);

    it("(a) calls /api/estimate in parallel with /api/segment and headlines dry_pct", async () => {
      fetchMock.mockImplementation(() => new Promise(() => {})); // nothing answers: both must already be out
      const pending = await photo();
      expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(["/api/estimate", "/api/segment"]);
      pending.unmount();

      fetchMock.mockReset();
      fetchMock.mockImplementation(routes);
      const hook = await photo();
      await advance(1);
      expect(hook.result.current.estimate).toEqual(EST);
      expect(headline(hook)).toMatchObject({ share: 0.6, level: "high", text: "High risk: 60% of the vegetation looks dry." });
      expect(hook.result.current.fuel?.verdict.share).toBe(0.25); // the SAM overlay is untouched
    });

    it("(b) falls back to the SAM share, with no error, when the estimate fails or times out", async () => {
      fetchMock.mockImplementation((url: string) => (url === "/api/estimate" ? Promise.resolve(failing) : routes(url)));
      const hook = await photo();
      await advance(1);
      expect(hook.result.current.estimate).toBeNull();
      expect(headline(hook)).toMatchObject({ share: 0.25, level: "moderate" });
      expect(hook.result.current.problem).toBe(false);

      hook.unmount();
      clearMemoryCache();
      let abortedAt12s = false;
      fetchMock.mockImplementation((url: string, init: RequestInit) =>
        url === "/api/estimate"
          ? new Promise((_, reject) => init.signal?.addEventListener("abort", () => ((abortedAt12s = true), reject(new Error("aborted")))))
          : routes(url),
      );
      const slow = await photo();
      await advance(11_900);
      expect(abortedAt12s).toBe(false);
      await advance(200);
      expect(abortedAt12s).toBe(true);
      expect(slow.result.current.estimate).toBeNull();
      expect(headline(slow)?.share).toBe(0.25);
      expect(slow.result.current.problem).toBe(false);
    });

    it("(c) still shows a number when segmentation fails and nothing can be drawn", async () => {
      analyse.mockReturnValueOnce(null as never);
      fetchMock.mockImplementation((url: string) => (url === "/api/segment" ? Promise.resolve(failing) : routes(url)));
      const hook = await photo();
      await advance(1);
      expect(hook.result.current.fuel).toBeNull();
      expect(hook.result.current.problem).toBe(false);
      expect(headline(hook)?.text).toBe("High risk: 60% of the vegetation looks dry.");
    });

    const findingsBodies = () =>
      fetchMock.mock.calls.filter((c) => c[0] === "/api/findings").map((c) => JSON.parse(c[1].body));

    it("builds the map with the estimate's grid when it is back first (one build)", async () => {
      fetchMock.mockImplementation(routes);
      analyse.mockClear();
      await photo();
      await advance(1);
      expect(analyse.mock.calls.map((c) => c[4])).toEqual([EST.grid]);
    });

    it("rebuilds the map once with the grid when the estimate arrives after the map was built", async () => {
      let answer: (r: unknown) => void = () => {};
      fetchMock.mockImplementation((url: string) => (url === "/api/estimate" ? new Promise((r) => (answer = r)) : routes(url)));
      analyse.mockClear();
      const hook = await photo();
      await advance(1);
      expect(analyse.mock.calls.map((c) => c[4])).toEqual([undefined]); // map built, estimate still out
      await act(async () => answer(await routes("/api/estimate")));
      await advance(1);
      expect(analyse.mock.calls.map((c) => c[4])).toEqual([undefined, EST.grid]); // exactly one rebuild
      expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/segment")).toHaveLength(1); // no extra requests
      expect(hook.result.current.estimate).toEqual(EST);
    });

    it("sends the headline share (the estimate's dry_pct) to /api/findings, not the SAM share", async () => {
      fetchMock.mockImplementation(routes);
      const hook = await photo();
      await advance(1);
      expect(findingsBodies()).toHaveLength(1);
      expect(findingsBodies()[0].share).toBe(0.6);
      expect(hook.result.current.notes).toEqual([NOTE]);
    });

    it("asks for the words again when the same frame gets a different headline share", async () => {
      fetchMock.mockImplementation((url: string) => (url === "/api/estimate" ? Promise.resolve(failing) : routes(url)));
      const first = await photo();
      await advance(1);
      expect(findingsBodies().map((b) => b.share)).toEqual([0.25]);
      first.unmount();

      fetchMock.mockImplementation(routes); // same image, now the estimate answers 60%
      const second = await photo();
      await advance(1);
      expect(findingsBodies().map((b) => b.share)).toEqual([0.25, 0.6]); // a cache miss, not the 25% words
      expect(second.result.current.notes).toEqual([NOTE]);
    });

    it("(b) a photo whose masks hang past 20 s and whose estimate fails sets problem and stops scanning", async () => {
      analyse.mockReturnValueOnce(null as never);
      fetchMock.mockImplementation((url: string, init: RequestInit) =>
        url === "/api/segment"
          ? new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
          : Promise.resolve(failing),
      );
      const hook = await photo();
      await advance(19_900);
      expect(hook.result.current.scanning).toBe(true);
      await advance(200);
      expect(hook.result.current.scanning).toBe(false);
      expect(hook.result.current.problem).toBe(true);
    });

    it("(c) Retry sends the same photo to /api/segment and /api/estimate again", async () => {
      analyse.mockReturnValueOnce(null as never);
      fetchMock.mockImplementation((url: string) => (url === "/api/findings" ? routes(url) : Promise.resolve(failing)));
      const hook = await photo();
      await advance(1);
      expect(hook.result.current.problem).toBe(true);
      fetchMock.mockClear();
      fetchMock.mockImplementation(routes);
      await act(async () => hook.result.current.retry());
      await advance(1);
      expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/segment", "/api/estimate", "/api/findings"]);
      expect(hook.result.current.problem).toBe(false);
      expect(hook.result.current.fuel?.verdict.share).toBe(0.25);
    });

    it("times out the words after 12 s and shows the map without them", async () => {
      let aborted = false;
      fetchMock.mockImplementation((url: string, init: RequestInit) =>
        url === "/api/findings"
          ? new Promise((_, reject) => init.signal?.addEventListener("abort", () => ((aborted = true), reject(new Error("aborted")))))
          : routes(url),
      );
      const hook = await photo();
      await advance(11_900);
      expect(aborted).toBe(false);
      await advance(200);
      expect(aborted).toBe(true);
      expect(hook.result.current.notes).toEqual([]);
    });

    it("aborts the estimate when a new scan starts", async () => {
      fetchMock.mockImplementation(() => new Promise(() => {}));
      const hook = await photo();
      const signal = fetchMock.mock.calls.find((c) => c[0] === "/api/estimate")![1].signal as AbortSignal;
      await act(async () => {
        await hook.result.current.startPhoto(new File(["z"], "b.jpg", { type: "image/jpeg" }));
      });
      expect(signal.aborted).toBe(true);
    });
  });
});
