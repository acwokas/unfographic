import { AIResponse, LayoutAnalysis, LayoutElement, TextElement, ImageRegionElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.2;
const PAD = 0.12;

export function buildSlideLayout(
      aiResponse: AIResponse,
      originalImage: HTMLImageElement,
    ): LayoutAnalysis {
      const imgW = aiResponse.imageWidth || originalImage.naturalWidth;
      const imgH = aiResponse.imageHeight || originalImage.naturalHeight;
      const elements: LayoutElement[] = [];

  // 1. Convert image regions
  for (const region of (aiResponse.imageRegions || [])) {
          const cx = (region.cropBox.x + region.cropBox.width / 2) / imgW;
          const cy = (region.cropBox.y + region.cropBox.height / 2) / imgH;
          const rawW = (region.cropBox.width / imgW) * SLIDE_W;
          const rawH = (region.cropBox.height / imgH) * SLIDE_H;
          const w = Math.min(Math.max(rawW, 0.5), 1.8);
          const h = Math.min(Math.max(rawH, 0.5), 1.4);
          const x = cx * SLIDE_W - w / 2;
          const y = cy * SLIDE_H - h / 2;
          let croppedDataUrl: string | undefined;
          try { croppedDataUrl = cropImageRegion(originalImage, region.cropBox); }
          catch (e) { console.warn('crop fail', region.id, e); }
          elements.push({ type: 'image_region', id: region.id, description: region.description, cropBox: region.cropBox, x, y, w, h, croppedDataUrl });
  }

  // 2. Text blocks via positionHint zones
  const zoneMap: Record<string, { x: number; y: number }> = {
          'top-left': { x: 0.3, y: 0.25 }, 'top-center': { x: 3.2, y: 0.25 }, 'top-right': { x: 6.8, y: 0.25 }, 'top': { x: 0.3, y: 0.25 },
          'center-left': { x: 0.3, y: 2.2 }, 'center': { x: 3.2, y: 2.2 }, 'center-right': { x: 6.8, y: 2.2 }, 'left': { x: 0.3, y: 2.2 }, 'right': { x: 6.8, y: 2.2 },
          'bottom-left': { x: 0.3, y: 4.0 }, 'bottom-center': { x: 3.2, y: 4.0 }, 'bottom-right': { x: 6.8, y: 4.0 }, 'bottom': { x: 3.2, y: 4.5 },
  };
      const zoneYOffsets: Record<string, number> = {};

  for (const t of (aiResponse.textBlocks || [])) {
          const sizeMap: Record<string, number> = { large: 22, medium: 13, small: 10, tiny: 8 };
          const fontSize = sizeMap[t.size] || 10;
          const isTitle = t.type === 'title' || t.type === 'subtitle';
          const w = isTitle ? 5.0 : (t.size === 'medium' ? 2.8 : t.size === 'small' ? 2.4 : 2.0);
          const heightMap: Record<string, number> = { title: 0.45, subtitle: 0.35, heading: 0.30, subheading: 0.25, body: 0.35, label: 0.22, caption: 0.20 };
          const h = heightMap[t.type] || 0.25;
          const hint = (t.positionHint || 'center').toLowerCase().trim();
          const basePos = zoneMap[hint] || zoneMap['center'];
          const startX = isTitle ? (SLIDE_W - w) / 2 : basePos.x;
          if (!(hint in zoneYOffsets)) { zoneYOffsets[hint] = basePos.y; }
          const y = zoneYOffsets[hint];
          zoneYOffsets[hint] += h + PAD;
          elements.push({
                    type: 'text', id: t.id, content: t.content,
                    x: startX, y, w, h, fontSize,
                    fontFace: 'Arial',
                    fontColor: (t.fontColor || '000000').replace('#', ''),
                    bold: t.bold || t.type === 'title' || t.type === 'heading',
                    italic: false, align: isTitle ? 'center' : 'left', valign: 'top',
          });
  }

  const resolved = resolveCollisions(elements);
      return { slide: { width: SLIDE_W, height: SLIDE_H, backgroundColor: 'FFFFFF' }, elements: resolved };
}

function resolveCollisions(elements: LayoutElement[]): LayoutElement[] {
      const els = elements.map(el => ({ ...el }));

  for (const el of els) {
          el.x = Math.max(MARGIN, Math.min(el.x, SLIDE_W - el.w - MARGIN));
          el.y = Math.max(MARGIN, Math.min(el.y, SLIDE_H - el.h - MARGIN));
  }

  function importance(el: LayoutElement): number {
          if (el.type === 'image_region') return 70;
          if (el.type !== 'text') return 20;
          const t = el as TextElement;
          if (t.fontSize >= 20) return 100;
          if (t.fontSize >= 12) return 80;
          if (t.bold) return 60;
          return 30;
  }
      els.sort((a, b) => importance(b) - importance(a));

  function overlaps(a: LayoutElement, b: LayoutElement): boolean {
          return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x &&
                         a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
  }

  for (let pass = 0; pass < 50; pass++) {
          let moved = false;
          for (let i = 0; i < els.length; i++) {
                    for (let j = i + 1; j < els.length; j++) {
                                if (!overlaps(els[i], els[j])) continue;
                                moved = true;
                                const a = els[i], b = els[j];
                                const pushR = (a.x + a.w + PAD) - b.x;
                                const pushL = (b.x + b.w + PAD) - a.x;
                                const pushD = (a.y + a.h + PAD) - b.y;
                                const pushU = (b.y + b.h + PAD) - a.y;
                                const opts: { dir: string; cost: number }[] = [];
                                if (b.y + pushD + b.h <= SLIDE_H - MARGIN) opts.push({ dir: 'd', cost: pushD });
                                if (b.x + pushR + b.w <= SLIDE_W - MARGIN) opts.push({ dir: 'r', cost: pushR });
                                if (b.y - pushU >= MARGIN) opts.push({ dir: 'u', cost: pushU });
                                if (b.x - pushL >= MARGIN) opts.push({ dir: 'l', cost: pushL });
                                if (opts.length > 0) {
                                              opts.sort((x, y) => x.cost - y.cost);
                                              const best = opts[0];
                                              if (best.dir === 'd') b.y += best.cost;
                                              else if (best.dir === 'r') b.x += best.cost;
                                              else if (best.dir === 'u') b.y -= best.cost;
                                              else if (best.dir === 'l') b.x -= best.cost;
                                } else {
                                              b.w *= 0.8;
                                              b.h *= 0.8;
                                }
                                b.x = Math.max(MARGIN, Math.min(b.x, SLIDE_W - b.w - MARGIN));
                                b.y = Math.max(MARGIN, Math.min(b.y, SLIDE_H - b.h - MARGIN));
                    }
          }
          if (!moved) break;
  }

  // Final safety pass
  for (let i = 0; i < els.length; i++) {
          for (let j = i + 1; j < els.length; j++) {
                    if (!overlaps(els[i], els[j])) continue;
                    const b = els[j];
                    b.y = els[i].y + els[i].h + PAD;
                    if (b.y + b.h > SLIDE_H - MARGIN) {
                                b.y = SLIDE_H - b.h - MARGIN;
                                b.x = els[i].x + els[i].w + PAD;
                                if (b.x + b.w > SLIDE_W - MARGIN) { b.w *= 0.7; b.x = SLIDE_W - b.w - MARGIN; }
                    }
          }
  }

  els.sort((a, b) => {
          if (a.type === 'image_region' && b.type !== 'image_region') return -1;
          if (a.type !== 'image_region' && b.type === 'image_region') return 1;
          return 0;
  });
      return els;
}
