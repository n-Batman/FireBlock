import { describe, expect, it } from "vitest";
import { MIN_SHARPNESS, photoQuality, sharpness } from "./frame";

const W = 32;
const H = 32;

describe("sharpness", () => {
  it("scores a flat image as blurry and a checkerboard as sharp", () => {
    const flat = new Uint8Array(W * H).fill(120);
    const checker = Uint8Array.from({ length: W * H }, (_, i) => ((i % W) + Math.floor(i / W)) % 2 === 0 ? 0 : 255);
    expect(sharpness(flat, W, H)).toBeLessThan(MIN_SHARPNESS);
    expect(sharpness(checker, W, H)).toBeGreaterThan(MIN_SHARPNESS);
  });

  it("scores a smooth gradient (out of focus) below a hard edge", () => {
    const ramp = Uint8Array.from({ length: W * H }, (_, i) => (i % W) * 8);
    const edge = Uint8Array.from({ length: W * H }, (_, i) => ((i % W) < W / 2 ? 0 : 255));
    expect(sharpness(ramp, W, H)).toBeLessThan(sharpness(edge, W, H));
  });
});

describe("photoQuality", () => {
  const checker = (lo: number, hi: number) => Uint8Array.from({ length: W * H }, (_, i) => (((i % W) + Math.floor(i / W)) % 2 === 0 ? lo : hi));

  it("passes a sharp mid-tone checkerboard", () => {
    expect(photoQuality(checker(64, 192), W, H)).toBe("ok");
  });

  it("calls flat near-black dark and flat near-white foggy", () => {
    expect(photoQuality(new Uint8Array(W * H).fill(12), W, H)).toBe("dark");
    expect(photoQuality(new Uint8Array(W * H).fill(235), W, H)).toBe("foggy");
  });

  it("does not call a sharp mid-gray field with real contrast, or bright textured soil, foggy", () => {
    expect(photoQuality(checker(90, 170), W, H)).toBe("ok");
    expect(photoQuality(checker(160, 215), W, H)).toBe("ok"); // sunlit tan soil: bright, but textured
  });

  it("still calls a smooth out-of-focus frame blurry", () => {
    const ramp = Uint8Array.from({ length: W * H }, (_, i) => (i % W) * 8);
    expect(photoQuality(ramp, W, H)).toBe("blurry");
    expect(photoQuality(new Uint8Array(W * H).fill(120), W, H)).toBe("blurry");
  });
});
