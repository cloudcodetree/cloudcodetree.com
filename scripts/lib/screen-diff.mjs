// Whether a fresh lesson screenshot is a real change from the committed one.
// Antialiasing and font hinting move single pixels by a few levels between runs;
// rewriting a PNG for that churns the repo and the review. A pixel counts as
// changed when any channel moves by more than pixelTolerance, and the image
// differs when more than maxChangedFraction of its pixels changed.
import sharp from 'sharp';

const decode = (png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

export async function screenDiffers(oldPng, newPng, { pixelTolerance = 24, maxChangedFraction = 0.001 } = {}) {
  if (!oldPng) return true;
  const [a, b] = await Promise.all([decode(oldPng), decode(newPng)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return true;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > pixelTolerance
      || Math.abs(a.data[i + 1] - b.data[i + 1]) > pixelTolerance
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > pixelTolerance
      || Math.abs(a.data[i + 3] - b.data[i + 3]) > pixelTolerance) changed++;
  }
  return changed > maxChangedFraction * a.info.width * a.info.height;
}
