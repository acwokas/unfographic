import { AIResponse, LayoutAnalysis, LayoutElement, TextElement, ImageRegionElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.15;
const PAD = 0.04;

// Fallback zone grid (used only when boundingBox is missing from AI response)
const ZONE_GRID: Record<string, { x: number; y: number }> = {
  'top-left':     { x: 0.25, y: 0.12 },
  'top-center':   { x: 3.00, y: 0.80 },
  'top-right':    { x: 8.00, y: 0.25 },
  'top':          { x: 0.25, y: 0.12 },
  'center-left':  { x: 0.25, y: 2.00 },
  'center':       { x: 3.00, y: 1.70 },
  'center-right': { x: 6.00, y: 1.50 },
  'left':         { x: 0.25, y: 2.00 },
  'right':        { x: 7.80, y: 2.30 },
  'bottom-left':  { x: 0.25, y: 3.70 },
  'bottom-center':{ x: 4.00, y: 4.00 },
  'bottom-right': { x: 7.00, y: 4.00 },
  'bottom':       { x: 3.50, y: 4.00 },
};

const ZONE_MAX_W: Record<string, number> = {
  'top-left':     5.00,
  'top-center':   2.80,
  'top-right':    1.80,
  'top':          5.00,
  'center-left':  2.50,
  'center':       2.80,
  'center-right': 2.60,
  'left':         2.50,
  'right':        2.00,
  'bottom-left':  3.00,
  'bottom-center': 3.00,
  'bottom-right': 2.80,
  'bottom':       3.00,
};

export function buildSlideLayout(
  aiResponse: AIResponse,
  originalImage: HTMLImageElement,
): LayoutAnalysis {
  const imgW = aiResponse.imageWidth || originalImage.naturalWidth;
  const imgH = aiResponse.imageHeight || originalImage.naturalHeight;
  const scaleX = SLIDE_W / imgW;
  const scaleY = SLIDE_H / imgH;

  const elements: LayoutElement[] = [];
  const zoneOffsets: Record<string, number> = {};

  // Font sizes by text type (used as fallback when no boundingBox)
  const typeFontSize: Record<string, number> = {
    title: 22, subtitle: 16, heading: 13, subheading: 11,
    body: 9, label: 8, caption: 7,
  };

  // Process text blocks
  for (const t of (aiResponse.textBlocks || [])) {
    let fs = typeFontSize[t.type] || 10;
    let x: number, y: number, w: number, h: number;
    let anchored = false;

    if (t.boundingBox) {
      // Pixel-precise positioning: convert bounding box from pixels to inches
      x = t.boundingBox.x * scaleX;
      y = t.boundingBox.y * scaleY;
      w = t.boundingBox.width * scaleX;
      h = t.boundingBox.height * scaleY;

      // Enforce reasonable minimums
      w = Math.max(w, 0.4);
      h = Math.max(h, 0.15);

      // Derive font size from bounding box height (inches -> points)
      // Use 0.75 factor since text doesn't fill 100% of its bounding box
      fs = Math.round(h * 72 * 0.75);
      // Tighter clamp: cap at 36pt to prevent absurdly large text
      fs = Math.max(6, Math.min(fs, 36));

      // Small padding to cover original text
      const padX = 0.04;
      const padY = 0.02;
      x = Math.max(MARGIN, x - padX);
      y = Math.max(0.05, y - padY);
      w = w + padX * 2;
      h = h + padY * 2;

      // ANCHORED: boundingBox elements stay exactly where the OCR placed them
      anchored = true;
    } else {
      // Fallback: zone-based positioning
      const hint = (t.positionHint || 'center').toLowerCase().trim();
      const base = ZONE_GRID[hint] || ZONE_GRID['center'];
      const maxW = ZONE_MAX_W[hint] || 2.80;
      const typeSizes: Record<string, [number, number]> = {
        title: [5.00, 0.42], subtitle: [5.00, 0.32],
        heading: [2.80, 0.50], subheading: [2.60, 0.28],
        body: [2.60, 0.42], label: [1.40, 0.22], caption: [2.20, 0.20],
      };
      const [tw, th] = typeSizes[t.type] || [2.20, 0.28];
      w = Math.min(tw, maxW);
      h = th;
      if (!(hint in zoneOffsets)) zoneOffsets[hint] = base.y;
      x = base.x;
      y = zoneOffsets[hint];
      zoneOffsets[hint] += h + 0.02;
    }

    // Clamp to slide
    x = Math.max(MARGIN, Math.min(x, SLIDE_W - w - MARGIN));
    y = Math.max(0.05, Math.min(y, SLIDE_H - h - 0.05));

    elements.push({
      type: 'text',
      id: t.id,
      content: t.content,
      x, y, w, h,
      fontSize: fs,
      fontFace: 'Arial',
      fontColor: (t.fontColor || '000000').replace('#', ''),
      bold: t.bold || t.type === 'heading' || t.type === 'subheading',
      italic: false,
      align: 'left' as const,
      valign: 'top' as const,
      anchored,
    });
  }

  // Process image regions: pixel-precise positioning using cropBox
  for (const r of (aiResponse.imageRegions || [])) {
    // Convert cropBox pixels to slide inches â same approach as text boundingBox
    let x = r.cropBox.x * scaleX;
    let y = r.cropBox.y * scaleY;
    let w = r.cropBox.width * scaleX;
    let h = r.cropBox.height * scaleY;

    // Reasonable min/max
    w = Math.max(w, 0.4);
    h = Math.max(h, 0.35);
    w = Math.min(w, SLIDE_W - MARGIN * 2);
    h = Math.min(h, SLIDE_H - 0.1);

    // Clamp to slide
    x = Math.max(MARGIN, Math.min(x, SLIDE_W - w - MARGIN));
    y = Math.max(0.05, Math.min(y, SLIDE_H - h - 0.05));

    // Scale cropBox from AI coordinate space (resized image) to original image space
    const origScaleX = originalImage.naturalWidth / imgW;
    const origScaleY = originalImage.naturalHeight / imgH;
    const scaledCropBox = {
      x: r.cropBox.x * origScaleX,
      y: r.cropBox.y * origScaleY,
      width: r.cropBox.width * origScaleX,
      height: r.cropBox.height * origScaleY,
    };

    let croppedDataUrl: string | undefined;
    try {
      croppedDataUrl = cropImageRegion(originalImage, scaledCropBox);
    } catch (e) {
      console.warn('crop fail', r.id, e);
    }

    elements.push({
      type: 'image_region',
      id: r.id,
      description: r.description,
      cropBox: r.cropBox,
      x, y, w, h,
      croppedDataUrl,
      anchored: true,
    });
  }

  // Resolve collisions â now handles anchored-vs-anchored overlaps too
  resolveCollisions(elements);

  return {
    slide: { width: SLIDE_W, height: SLIDE_H, backgroundColor: 'FFFFFF' },
    elements,
  };
}

// Collision resolver: handles both anchored and non-anchored elements
function resolveCollisions(els: LayoutElement[]): void {
  function isAnchored(el: LayoutElement): boolean {
    return !!(el as any).anchored;
  }

  function imp(el: LayoutElement): number {
    if (el.type === 'image_region') return 150;
    const t = el as TextElement;
    // Larger text is more important
    if (t.fontSize >= 20) return 100;
    if (t.fontSize >= 14) return 85;
    if (t.fontSize >= 11) return 70;
    if (t.fontSize >= 10) return 55;
    return 30;
  }

  els.sort((a, b) => imp(b) - imp(a));

  function overlaps(a: LayoutElement, b: LayoutElement): boolean {
    return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x
        && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
  }

  function overlapArea(a: LayoutElement, b: LayoutElement): number {
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ox * oy;
  }

  // Phase 1: Handle anchored-vs-anchored overlaps by shrinking the smaller one
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      if (!overlaps(els[i], els[j])) continue;
      if (!isAnchored(els[i]) || !isAnchored(els[j])) continue;

      // Both anchored and overlapping â shrink the less important one
      const aArea = els[i].w * els[i].h;
      const bArea = els[j].w * els[j].h;
      const smaller = aArea < bArea ? els[i] : els[j];
      const larger = aArea >= bArea ? els[i] : els[j];

      // Calculate overlap percentage relative to the smaller element
      const oArea = overlapArea(smaller, larger);
      const pct = oArea / (smaller.w * smaller.h);

      if (pct > 0.5) {
        // More than 50% overlap â remove the smaller element entirely
        els.splice(els.indexOf(smaller), 1);
        if (j > i) j--; // adjust index
        continue;
      }

      // Trim the smaller element to avoid the overlap
      const trimRight = (smaller.x + smaller.w) - larger.x;
      const trimLeft = (larger.x + larger.w) - smaller.x;
      const trimDown = (smaller.y + smaller.h) - larger.y;
      const trimUp = (larger.y + larger.h) - smaller.y;

      const trims: [string, number][] = [];
      if (trimRight > 0 && trimRight < smaller.w * 0.5) trims.push(['r', trimRight]);
      if (trimLeft > 0 && trimLeft < smaller.w * 0.5) trims.push(['l', trimLeft]);
      if (trimDown > 0 && trimDown < smaller.h * 0.5) trims.push(['d', trimDown]);
      if (trimUp > 0 && trimUp < smaller.h * 0.5) trims.push(['u', trimUp]);

      if (trims.length > 0) {
        trims.sort((a, b) => a[1] - b[1]);
        const [dir, amount] = trims[0];
        if (dir === 'r') smaller.w -= amount + PAD;
        else if (dir === 'l') { smaller.x += amount + PAD; smaller.w -= amount + PAD; }
        else if (dir === 'd') smaller.h -= amount + PAD;
        else if (dir === 'u') { smaller.y += amount + PAD; smaller.h -= amount + PAD; }
      }
    }
  }

  // Phase 2: Standard collision resolution for non-anchored elements
  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (!overlaps(els[i], els[j])) continue;

        // Skip if both anchored (handled in phase 1)
        if (isAnchored(els[i]) && isAnchored(els[j])) continue;

        // Determine which element to move
        let fixed: LayoutElement, movable: LayoutElement;
        if (isAnchored(els[i])) {
          fixed = els[i]; movable = els[j];
        } else if (isAnchored(els[j])) {
          fixed = els[j]; movable = els[i];
        } else {
          fixed = els[i]; movable = els[j];
        }

        moved = true;
        const a = fixed, b = movable;
        const pR = (a.x + a.w + PAD) - b.x;
        const pL = (b.x + b.w + PAD) - a.x;
        const pD = (a.y + a.h + PAD) - b.y;
        const pU = (b.y + b.h + PAD) - a.y;

        const opts: [string, number][] = [];
        if (b.y + pD + b.h <= SLIDE_H - 0.05) opts.push(['d', pD]);
        if (b.x + pR + b.w <= SLIDE_W - MARGIN) opts.push(['r', pR]);
        if (b.y - pU >= 0.05) opts.push(['u', pU]);
        if (b.x - pL >= MARGIN) opts.push(['l', pL]);

        if (opts.length > 0) {
          opts.sort((x, y) => x[1] - y[1]);
          const [d, c] = opts[0];
          if (d === 'd') b.y += c;
          else if (d === 'r') b.x += c;
          else if (d === 'u') b.y -= c;
          else if (d === 'l') b.x -= c;
        } else {
          b.w *= 0.85;
          b.h *= 0.85;
        }

        b.x = Math.max(MARGIN, Math.min(b.x, SLIDE_W - b.w - MARGIN));
        b.y = Math.max(0.05, Math.min(b.y, SLIDE_H - b.h - 0.05));
      }
    }
    if (!moved) break;
  }

  // Phase 3: Safety pass â push remaining non-anchored overlaps downward
  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (!overlaps(els[i], els[j])) continue;
        if (isAnchored(els[j])) continue;

        moved = true;
        const b = els[j];
        b.y = els[i].y + els[i].h + PAD;
        b.x = Math.max(MARGIN, Math.min(b.x, SLIDE_W - b.w - MARGIN));
        b.y = Math.max(0.05, Math.min(b.y, SLIDE_H - b.h - 0.05));
      }
    }
    if (!moved) break;
  }
}
