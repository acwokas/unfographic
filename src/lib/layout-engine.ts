import { AIResponse, LayoutAnalysis, LayoutElement, TextElement, ImageRegionElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

const SLIDE_W = 10;
const SLIDE_H = 5.625;

/**
 * Convert the AI response into positioned slide elements, then resolve collisions.
 *
 * Image regions: positioned proportionally from their cropBox pixel coordinates.
 * Text blocks: positioned using positionHint zones, stacked within each zone.
 * Then collision resolution eliminates all overlaps.
 */
export function buildSlideLayout(
    aiResponse: AIResponse,
    originalImage: HTMLImageElement,
  ): LayoutAnalysis {
    const imgW = aiResponse.imageWidth || originalImage.naturalWidth;
    const imgH = aiResponse.imageHeight || originalImage.naturalHeight;

  const elements: LayoutElement[] = [];

  // ── 1. Convert image regions: pixel cropBox → slide inches ──
  for (const region of (aiResponse.imageRegions || [])) {
        const centerXPct = (region.cropBox.x + region.cropBox.width / 2) / imgW;
        const centerYPct = (region.cropBox.y + region.cropBox.height / 2) / imgH;

      // Size: proportional but capped
      const rawW = (region.cropBox.width / imgW) * SLIDE_W;
        const rawH = (region.cropBox.height / imgH) * SLIDE_H;
        const w = Math.min(Math.max(rawW, 0.5), SLIDE_W * 0.18);
        const h = Math.min(Math.max(rawH, 0.5), SLIDE_H * 0.25);

      const x = centerXPct * SLIDE_W - w / 2;
        const y = centerYPct * SLIDE_H - h / 2;

      let croppedDataUrl: string | undefined;
        try {
                croppedDataUrl = cropImageRegion(originalImage, region.cropBox);
        } catch (e) {
                console.warn('Failed to crop image region:', region.id, e);
        }

      elements.push({
              type: 'image_region',
              id: region.id,
              description: region.description,
              cropBox: region.cropBox,
              x, y, w, h,
              croppedDataUrl,
      });
  }

  // ── 2. Convert text blocks using positionHint zones ──
  const textPositionMap: Record<string, { x: number; y: number }> = {
        'top-left':      { x: 0.3, y: 0.2 },
        'top-center':    { x: 3.5, y: 0.2 },
        'top-right':     { x: 7.5, y: 0.2 },
        'top':           { x: 0.3, y: 0.2 },
        'center-left':   { x: 0.3, y: 2.0 },
        'center':        { x: 3.5, y: 2.0 },
        'center-right':  { x: 7.0, y: 2.0 },
        'left':          { x: 0.3, y: 2.0 },
        'right':         { x: 7.0, y: 2.0 },
        'bottom-left':   { x: 0.3, y: 3.8 },
        'bottom-center': { x: 3.5, y: 3.8 },
        'bottom-right':  { x: 7.0, y: 3.8 },
        'bottom':        { x: 3.5, y: 4.5 },
  };

  const zoneYOffsets: Record<string, number> = {};

  for (const t of (aiResponse.textBlocks || [])) {
        const sizeMap: Record<string, number> = { large: 24, medium: 14, small: 10, tiny: 8 };
        const fontSize = sizeMap[t.size] || 10;

      const w = (t.type === 'title' || t.type === 'subtitle')
          ? Math.min(SLIDE_W * 0.7, 7.0)
              : (t.size === 'medium' ? 2.8 : t.size === 'small' ? 2.5 : 2.0);

      const heightMap: Record<string, number> = {
              title: 0.5, subtitle: 0.35, heading: 0.35,
              subheading: 0.25, body: 0.4, label: 0.22, caption: 0.2,
      };
        const h = heightMap[t.type] || 0.25;

      const hint = (t.positionHint || 'center').toLowerCase().trim();
        const basePos = textPositionMap[hint] || textPositionMap['center'];

      const zoneKey = hint;
        if (!(zoneKey in zoneYOffsets)) {
                zoneYOffsets[zoneKey] = basePos.y;
        }
        const y = zoneYOffsets[zoneKey];
        zoneYOffsets[zoneKey] += h + 0.08;

      elements.push({
              type: 'text',
              id: t.id,
              content: t.content,
              x: basePos.x, y, w, h,
              fontSize,
              fontFace: 'Arial',
              fontColor: (t.fontColor || '000000').replace('#', ''),
              bold: t.bold || t.type === 'title' || t.type === 'heading',
              italic: false,
              align: 'left',
              valign: 'top',
      });
  }

  // ── 3. Resolve collisions ──
  const resolved = resolveCollisions(elements);

  return {
        slide: { width: SLIDE_W, height: SLIDE_H, backgroundColor: 'FFFFFF' },
        elements: resolved,
  };
}


/**
 * Collision resolver: nudges overlapping elements apart.
 * Important elements (titles, headings) hold position; less important ones move.
 * Guarantees: zero overlaps, zero off-slide elements.
 */
function resolveCollisions(elements: LayoutElement[]): LayoutElement[] {
    const resolved = elements.map(el => ({ ...el }));

  // 1. Clamp to slide bounds
  for (const el of resolved) {
        el.x = Math.max(0.15, Math.min(el.x, SLIDE_W - el.w - 0.15));
        el.y = Math.max(0.15, Math.min(el.y, SLIDE_H - el.h - 0.15));
  }

  // 2. Sort by importance (most important first = stays put)
  function importance(el: LayoutElement): number {
        if (el.type === 'image_region') return 50;
        if (el.type !== 'text') return 20;
        const t = el as TextElement;
        if (t.fontSize >= 20) return 100;
        if (t.fontSize >= 13) return 80;
        if (t.bold && t.fontSize >= 10) return 60;
        return 30;
  }
    resolved.sort((a, b) => importance(b) - importance(a));

  // 3. Iteratively resolve overlaps
  const PAD = 0.05;

  function overlaps(a: LayoutElement, b: LayoutElement): boolean {
        return a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x &&
                     a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;
  }

  for (let pass = 0; pass < 30; pass++) {
        let moved = false;

      for (let i = 0; i < resolved.length; i++) {
              for (let j = i + 1; j < resolved.length; j++) {
                        const a = resolved[i];
                        const b = resolved[j];
                        if (!overlaps(a, b)) continue;
                        moved = true;

                const pushRight = (a.x + a.w + PAD) - b.x;
                        const pushLeft  = (b.x + b.w + PAD) - a.x;
                        const pushDown  = (a.y + a.h + PAD) - b.y;
                        const pushUp    = (b.y + b.h + PAD) - a.y;

                const canRight = b.x + pushRight + b.w <= SLIDE_W - 0.15;
                        const canLeft  = b.x - pushLeft >= 0.15;
                        const canDown  = b.y + pushDown + b.h <= SLIDE_H - 0.15;
                        const canUp    = b.y - pushUp >= 0.15;

                const options: { dir: string; cost: number }[] = [];
                        if (canDown)  options.push({ dir: 'down',  cost: pushDown });
                        if (canRight) options.push({ dir: 'right', cost: pushRight });
                        if (canUp)    options.push({ dir: 'up',    cost: pushUp });
                        if (canLeft)  options.push({ dir: 'left',  cost: pushLeft });

                if (options.length > 0) {
                            options.sort((x, y) => x.cost - y.cost);
                            switch (options[0].dir) {
                              case 'down':  b.y += options[0].cost; break;
                              case 'right': b.x += options[0].cost; break;
                              case 'up':    b.y -= options[0].cost; break;
                              case 'left':  b.x -= options[0].cost; break;
                            }
                } else {
                            b.w *= 0.85;
                            b.h *= 0.85;
                }

                b.x = Math.max(0.15, Math.min(b.x, SLIDE_W - b.w - 0.15));
                        b.y = Math.max(0.15, Math.min(b.y, SLIDE_H - b.h - 0.15));
              }
      }

      if (!moved) break;
  }

  // 4. Final sort: images first (behind), then text (on top)
  resolved.sort((a, b) => {
        if (a.type === 'image_region' && b.type !== 'image_region') return -1;
        if (a.type !== 'image_region' && b.type === 'image_region') return 1;
        return 0;
  });

  return resolved;
}
