// Whether a fresh lesson screenshot is a real change from the committed one.
// Antialiasing and font hinting move single pixels between runs; rewriting a PNG for
// that churns the repo and the review. A pixel counts as changed when any channel
// moves by more than pixelTolerance. The image is cut into tile × tile squares, and it
// differs when any square holds more than maxTilePixels changed pixels: one changed
// digit is about 100 pixels in one or two squares, while noise is isolated pixels.
// (A whole-image fraction missed a changed price: 0.1% of 1280×860 is 1,100 pixels.)
import sharp from 'sharp';

const decode = (png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

export async function screenDiffers(oldPng, newPng, { pixelTolerance = 24, tile = 16, maxTilePixels = 8 } = {}) {
  if (!oldPng) return true;
  const [a, b] = await Promise.all([decode(oldPng), decode(newPng)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return true;
  const { width, height } = a.info;
  const cols = Math.ceil(width / tile);
  const counts = new Uint16Array(cols * Math.ceil(height / tile));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > pixelTolerance
        || Math.abs(a.data[i + 1] - b.data[i + 1]) > pixelTolerance
        || Math.abs(a.data[i + 2] - b.data[i + 2]) > pixelTolerance
        || Math.abs(a.data[i + 3] - b.data[i + 3]) > pixelTolerance) {
        if (++counts[Math.floor(y / tile) * cols + Math.floor(x / tile)] > maxTilePixels) return true;
      }
    }
  }
  return false;
}
