import { describe, expect, it } from "vitest";
import { MIN_SHARPNESS, sharpness } from "./frame";

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
