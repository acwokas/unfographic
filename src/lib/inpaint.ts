import { AITextBlock } from '@/types/layout';

/**
 * Create a "clean" version of the infographic by painting over text regions
 * with sampled background colors. This eliminates the need for cover rectangles
 * in the PPTX — the background image itself has no text, so editable text
 * sits cleanly on top.
 */
export function createCleanBackground(
  img: HTMLImageElement,
  textBlocks: AITextBlock[],
): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  for (const tb of textBlocks) {
    if (!tb.boundingBox) continue;
    const { x, y, width, height } = tb.boundingBox;

    // Add generous padding around text region to fully cover original text
    const pad = Math.max(4, Math.round(height * 0.15));
    const rx = Math.max(0, x - pad);
    const ry = Math.max(0, y - pad);
    const rw = Math.min(width + pad * 2, img.naturalWidth - rx);
    const rh = Math.min(height + pad * 2, img.naturalHeight - ry);

    // Sample background color from edges outside the text region
    const color = sampleEdgeColor(ctx, rx, ry, rw, rh, img.naturalWidth, img.naturalHeight);

    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, rw, rh);
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Sample the dominant background color around a region by reading pixels
 * from just outside its edges. Uses median per channel for robustness.
 */
function sampleEdgeColor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  imgW: number, imgH: number,
): string {
  const outset = Math.max(3, Math.round(Math.min(w, h) * 0.08));
  const samplePoints: [number, number][] = [
    // Top edge samples
    [x + Math.floor(w * 0.2), y - outset],
    [x + Math.floor(w * 0.5), y - outset],
    [x + Math.floor(w * 0.8), y - outset],
    // Bottom edge samples
    [x + Math.floor(w * 0.2), y + h + outset],
    [x + Math.floor(w * 0.5), y + h + outset],
    [x + Math.floor(w * 0.8), y + h + outset],
    // Left edge samples
    [x - outset, y + Math.floor(h * 0.3)],
    [x - outset, y + Math.floor(h * 0.7)],
    // Right edge samples
    [x + w + outset, y + Math.floor(h * 0.3)],
    [x + w + outset, y + Math.floor(h * 0.7)],
  ];

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  for (const [sx, sy] of samplePoints) {
    const cx = Math.max(0, Math.min(sx, imgW - 1));
    const cy = Math.max(0, Math.min(sy, imgH - 1));
    const pixel = ctx.getImageData(cx, cy, 1, 1).data;
    rs.push(pixel[0]);
    gs.push(pixel[1]);
    bs.push(pixel[2]);
  }

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  const r = median(rs);
  const g = median(gs);
  const b = median(bs);

  return `rgb(${r},${g},${b})`;
}
