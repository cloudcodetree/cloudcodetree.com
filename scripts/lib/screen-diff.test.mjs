import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { screenDiffers } from './screen-diff.mjs';

// The lab's real viewport, so a threshold is tested at the size it runs at.
const W = 1280;
const H = 860;

// A deterministic pseudo-random sequence, so the noise test cannot flake.
function lcg(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

async function raw(png) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

const encode = (data, w = W, h = H) => sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

async function noisy(png, amount) {
  const { data } = await raw(png);
  const rand = lcg(7);
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i++) {
    if (i % 4 === 3) continue;
    out[i] = Math.max(0, Math.min(255, out[i] + Math.round((rand() * 2 - 1) * amount)));
  }
  return encode(out);
}

async function withRect(png, w, h, left = 10, top = 10) {
  const rect = await sharp({ create: { width: w, height: h, channels: 4, background: '#f59f00' } }).png().toBuffer();
  return sharp(png).composite([{ input: rect, left, top }]).png().toBuffer();
}

// Single pixels pushed far past the tolerance, spread over the whole image.
async function speckled(png, count) {
  const { data } = await raw(png);
  const rand = lcg(11);
  const out = Buffer.from(data);
  for (let n = 0; n < count; n++) {
    const i = Math.floor(rand() * W * H) * 4;
    out[i] = 255 - out[i];
  }
  return encode(out);
}

const resized = (png) => sharp(png).resize(W + 1, H, { fit: 'fill' }).png().toBuffer();

let a;
beforeAll(async () => {
  // A horizontal gradient, so the image is not one flat colour.
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([x % 256, 128, 255 - (x % 256), 255], (y * W + x) * 4);
  a = await encode(data);
});

describe('screenDiffers', () => {
  it('identical images do not differ', async () => { expect(await screenDiffers(a, a)).toBe(false); });
  it('ignores per-pixel noise under the tolerance', async () => { expect(await screenDiffers(a, await noisy(a, 10))).toBe(false); });
  it('detects a changed region over 0.1% of pixels', async () => { expect(await screenDiffers(a, await withRect(a, 40, 40))).toBe(true); });
  it('detects one changed digit, a 33x33 block, anywhere', async () => {
    expect(await screenDiffers(a, await withRect(a, 33, 33, 700, 420))).toBe(true);
    expect(await screenDiffers(a, await withRect(a, 8, 12, 1003, 601))).toBe(true);
  });
  it('ignores isolated pixels spread over the image', async () => { expect(await screenDiffers(a, await speckled(a, 400))).toBe(false); });
  it('a size change always differs', async () => { expect(await screenDiffers(a, await resized(a))).toBe(true); });
  it('a missing old image always differs', async () => { expect(await screenDiffers(null, a)).toBe(true); });
});
