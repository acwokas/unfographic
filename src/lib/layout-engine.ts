import { AIResponse, LayoutAnalysis, LayoutElement, TextElement, ImageRegionElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.20;
const PAD = 0.05;

// Zone grid: maps AI positionHint strings to base (x, y) coordinates
// These are tuned for 16:9 slides (10" x 5.625") to spread content across the slide
// while leaving room for the infographic's decorative elements
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

// Maximum widths per zone to prevent text from overflowing into adjacent zones
const ZONE_MAX_W: Record<string, number> = {
  'top-left': 5.00, 'top-center': 2.80, 'top-right': 1.80,
  'top': 5.00,
  'center-left': 2.50, 'center': 2.80, 'center-right': 2.60,
  'left': 2.50, 'right': 2.00,
  'bottom-left': 3.00, 'bottom-center': 3.00, 'bottom-right': 2.80,
  'bottom': 3.00,
};

export function buildSlideLayout(
  aiResponse: AIResponse,
  originalImage: HTMLImageElement,
): LayoutAnalysis {
  const imgW = aiResponse.imageWidth || originalImage.naturalWidth;
  const imgH = aiResponse.imageHeight || originalImage.naturalHeight;
  const elements: LayoutElement[] = [];
  const zoneOffsets: Record<string, number> = {};

  // Process all text blocks
  for (const t of (aiResponse.textBlocks || [])) {
    const hint = (t.positionHint || 'center').toLowerCase().trim();
    const base = ZONE_GRID[hint] || ZONE_GRID['center'];
    const maxW = ZONE_MAX_W[hint] || 2.80;

    // Type-specific sizing
    let w: number, h: number, fs: number;
    switch (t.type) {
      case 'title':
        w = Math.min(5.00, maxW); h = 0.42; fs = 22; break;
      case 'subtitle':
        w = Math.min(5.00, maxW); h = 0.32; fs = 16; break;
      case 'heading':
        w = Math.min(2.80, maxW); h = 0.50; fs = 13; break;
      case 'subheading':
        w = Math.min(2.60, maxW); h = 0.28; fs = 11; break;
      case 'body':
        w = Math.min(2.60, maxW); h = 0.42; fs = 9; break;
      case 'label':
        w = Math.min(1.40, maxW); h = 0.22; fs = 10; break;
      case 'caption':
        w = Math.min(2.20, maxW); h = 0.20; fs = 8; break;
      default:
        w = Math.min(2.20, maxW); h = 0.28; fs = 10;
    }

    // Stack items within the same zone vertically
    if (!(hint in zoneOffsets)) zoneOffsets[hint] = base.y;
    const y = zoneOffsets[hint];
    zoneOffsets[hint] += h + 0.02;

    elements.push({
      type: 'text', id: t.id, content: t.content,
      x: base.x, y, w, h,
      fontSize: fs, fontFace: 'Arial',
      fontColor: (t.fontColor || '000000').replace('#', ''),
      bold: t.bold || t.type === 'heading' || t.type === 'subheading',
      italic: false,
      align: 'left' as const,
      valign: 'top' as const,
    });
  }

  // Process image regions: proportional positioning
  for (const r of (aiResponse.imageRegions || [])) {
    const cx = (r.cropBox.x + r.cropBox.width / 2) / imgW;
    const cy = (r.cropBox.y + r.cropBox.height / 2) / imgH;
    const x = cx * (SLIDE_W - 1.0) + 0.25;
    const y = cy * (SLIDE_H - 0.8) + 0.4;
    let w = Math.min((r.cropBox.width / imgW) * SLIDE_W * 0.5, 1.0);
    let h = Math.min((r.cropBox.height / imgH) * SLIDE_H * 0.5, 0.8);
    w = Math.max(w, 0.4);
    h = Math.max(h, 0.35);

    let croppedDataUrl: string | undefined;
    try { croppedDataUrl = cropImageRegion(originalImage, r.cropBox); }
    catch (e) { console.warn('crop fail', r.id, e); }

    elements.push({
      type: 'image_region', id: r.id, description: r.description,
      cropBox: r.cropBox, x: x - w / 2, y: y - h / 2, w, h,
      croppedDataUrl,
    });
  }

  resolveCollisions(elements);

  return {
    slide: { width: SLIDE_W, height: SLIDE_H, backgroundColor: 'FFFFFF' },
    elements,
  };
}

// Collision Resolver: sorts elements by visual importance, then iteratively
// pushes lower-priority elements in the minimum-distance direction.
function resolveCollisions(els: LayoutElement[]): void {
  for (const el of els) {
    el.x = Math.max(MARGIN, Math.min(el.x, SLIDE_W - el.w - MARGIN));
    el.y = Math.max(0.08, Math.min(el.y, SLIDE_H - el.h - 0.08));
  }

  function imp(el: LayoutElement): number {
    if (el.type === 'image_region') return 60;
    const t = el as TextElement;
    if (t.fontSize >= 20) return 100;
    if (t.fontSize >= 14) return 85;
    if (t.fontSize >= 11) return 70;
    if (t.fontSize >= 10) return 55;
    return 30;
  }
  els.sort((a, b) => imp(b) - imp(a));

  function overlaps(a: LayoutElement, b: LayoutElement): boolean {
    return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x &&
           a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
  }

  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (!overlaps(els[i], els[j])) continue;
        moved = true;
        const a = els[i], b = els[j];
        const pR = (a.x + a.w + PAD) - b.x;
        const pL = (b.x + b.w + PAD) - a.x;
        const pD = (a.y + a.h + PAD) - b.y;
        const pU = (b.y + b.h + PAD) - a.y;
        const opts: [string, number][] = [];
        if (b.y + pD + b.h <= SLIDE_H - 0.08) opts.push(['d', pD]);
        if (b.x + pR + b.w <= SLIDE_W - MARGIN) opts.push(['r', pR]);
        if (b.y - pU >= 0.08) opts.push(['u', pU]);
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
        b.y = Math.max(0.08, Math.min(b.y, SLIDE_H - b.h - 0.08));
      }
    }
    if (!moved) break;
  }

  for (let pass = 0; pass < 30; pass++) {
    let moved = false;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (!overlaps(els[i], els[j])) continue;
        moved = true;
        const b = els[j];
        b.y = els[i].y + els[i].h + PAD;
        b.x = Math.max(MARGIN, Math.min(b.x, SLIDE_W - b.w - MARGIN));
        b.y = Math.max(0.08, Math.min(b.y, SLIDE_H - b.h - 0.08));
      }
    }
    if (!moved) break;
  }
}
