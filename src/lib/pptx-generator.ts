import PptxGenJS from 'pptxgenjs';
import { LayoutAnalysis, TextElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

function imageToDataUrl(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Sample the dominant color from a region of the image to use as cover rectangle color.
 */
function sampleRegionColor(img: HTMLImageElement, x: number, y: number, w: number, h: number, slideW: number, slideH: number): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const px = Math.round((x / slideW) * img.naturalWidth);
    const py = Math.round((y / slideH) * img.naturalHeight);
    const pw = Math.max(1, Math.round((w / slideW) * img.naturalWidth));
    const ph = Math.max(1, Math.round((h / slideH) * img.naturalHeight));

    // Sample OUTSIDE the text area (offset outward) to avoid picking up text pixels.
    const outset = Math.max(4, Math.round(ph * 0.15));
    const samples: number[][] = [];
    const samplePoints = [
      [px + Math.floor(pw / 4), py - outset],
      [px + Math.floor(pw / 2), py - outset],
      [px + Math.floor(3 * pw / 4), py - outset],
      [px + Math.floor(pw / 4), py + ph + outset],
      [px + Math.floor(pw / 2), py + ph + outset],
      [px + Math.floor(3 * pw / 4), py + ph + outset],
      [px - outset, py + Math.floor(ph / 2)],
      [px + pw + outset, py + Math.floor(ph / 2)],
      [px - outset, py - outset],
      [px + pw + outset, py + ph + outset],
    ];

    for (const [sx, sy] of samplePoints) {
      const cx = Math.max(0, Math.min(sx, img.naturalWidth - 1));
      const cy = Math.max(0, Math.min(sy, img.naturalHeight - 1));
      const pixel = ctx.getImageData(cx, cy, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]]);
    }

    // Use median per channel (robust against outliers like text pixels)
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    };
    const r = median(samples.map(s => s[0]));
    const g = median(samples.map(s => s[1]));
    const b = median(samples.map(s => s[2]));

    return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch {
    return 'FFFFFF';
  }
}

/**
 * Choose text color (black or white) based on background luminance.
 * Ensures text is always readable against its cover rectangle.
 */
function contrastTextColor(bgHex: string): string {
  try {
    const r = parseInt(bgHex.slice(0, 2), 16);
    const g = parseInt(bgHex.slice(2, 4), 16);
    const b = parseInt(bgHex.slice(4, 6), 16);
    // Standard luminance formula
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum < 140 ? 'FFFFFF' : '000000';
  } catch {
    return '000000';
  }
}

export async function generatePptx(
  layout: LayoutAnalysis,
  originalImage: HTMLImageElement,
  fileName = 'unfographic-export.pptx'
) {
  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: 'CUSTOM',
    width: layout.slide.width,
    height: layout.slide.height,
  });
  pptx.layout = 'CUSTOM';

  const slide = pptx.addSlide();
  slide.background = { color: layout.slide.backgroundColor || 'FFFFFF' };

  // Layer 1: Original infographic as full-slide background
  try {
    const bgDataUrl = imageToDataUrl(originalImage);
    slide.addImage({
      data: bgDataUrl,
      x: 0,
      y: 0,
      w: layout.slide.width,
      h: layout.slide.height,
    });
  } catch (e) {
    console.warn('Failed to add background image:', e);
  }

  // Layer 2: Cover rectangles to hide original text behind editable text.
  // Generously expanded to ensure full coverage of original text.
  const coverColors: Record<string, string> = {};
  for (const el of layout.elements) {
    if (el.type === 'text') {
      try {
        const expand = 0.04; // moderate padding to hide original text
        const cx = Math.max(0, el.x - expand);
        const cy = Math.max(0, el.y - expand);
        const cw = Math.min(el.w + expand * 2, layout.slide.width - cx);
        const ch = Math.min(el.h + expand * 2, layout.slide.height - cy);
        const coverColor = sampleRegionColor(
          originalImage, cx, cy, cw, ch,
          layout.slide.width, layout.slide.height
        );
        coverColors[el.id] = coverColor;
        slide.addShape('rect' as any, {
          x: cx,
          y: cy,
          w: cw,
          h: ch,
          fill: { color: coverColor },
          line: { color: coverColor, width: 0 },
        });
      } catch (e) {
        slide.addShape('rect' as any, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: 'FFFFFF' },
          line: { color: 'FFFFFF', width: 0 },
        });
        coverColors[el.id] = 'FFFFFF';
      }
    }
  }

  // Layer 3: Editable text on top of cover rectangles
  for (const el of layout.elements) {
    if (el.type === 'text') {
      try {
        // Pick text color that contrasts with the cover rectangle
        const bgColor = coverColors[el.id] || 'FFFFFF';
        const textColor = contrastTextColor(bgColor);

        slide.addText(el.content, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fontSize: Math.max(5, Math.min(el.fontSize, 24)),
          fontFace: el.fontFace || 'Arial',
          color: textColor,
          bold: el.bold,
          italic: el.italic,
          align: el.align,
          valign: el.valign || 'top',
          margin: [0, 2, 0, 2],
          autoFit: true,
          shrinkText: true,
        });
      } catch (e) {
        console.warn('Failed to add text element:', el.id, e);
      }
    } else if (el.type === 'image_region') {
      try {
        const dataUrl = el.croppedDataUrl || cropImageRegion(originalImage, el.cropBox);
        slide.addImage({
          data: dataUrl,
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          sizing: { type: 'contain', w: el.w, h: el.h },
        });
      } catch (e) {
        console.warn('Failed to add image region:', el.id, e);
      }
    }
  }

  await pptx.writeFile({ fileName });
}
