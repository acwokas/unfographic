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

    // Convert slide inches to pixel coordinates
    const px = Math.round((x / slideW) * img.naturalWidth);
    const py = Math.round((y / slideH) * img.naturalHeight);
    const pw = Math.max(1, Math.round((w / slideW) * img.naturalWidth));
    const ph = Math.max(1, Math.round((h / slideH) * img.naturalHeight));

    // Sample a few pixels around the edges of the region
    const samples: number[][] = [];
    const samplePoints = [
      [px + 2, py + 2],
      [px + pw - 2, py + 2],
      [px + 2, py + ph - 2],
      [px + pw - 2, py + ph - 2],
      [px + Math.floor(pw / 2), py + Math.floor(ph / 2)],
    ];

    for (const [sx, sy] of samplePoints) {
      const cx = Math.max(0, Math.min(sx, img.naturalWidth - 1));
      const cy = Math.max(0, Math.min(sy, img.naturalHeight - 1));
      const pixel = ctx.getImageData(cx, cy, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]]);
    }

    // Average the samples
    const avg = samples.reduce(
      (acc, s) => [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]],
      [0, 0, 0]
    ).map(v => Math.round(v / samples.length));

    return avg.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  } catch {
    return 'FFFFFF';
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

  // Layer 1: Add original infographic as full-slide background image
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

  // Layer 2: Add cover rectangles behind each text element to hide original text
  for (const el of layout.elements) {
    if (el.type === 'text') {
      try {
        // Sample the background color at this position for a matching cover
        const coverColor = sampleRegionColor(
          originalImage, el.x, el.y, el.w, el.h,
          layout.slide.width, layout.slide.height
        );
        slide.addShape('rect' as any, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: coverColor },
          line: { color: coverColor, width: 0 },
        });
      } catch (e) {
        // Fallback: white rectangle
        slide.addShape('rect' as any, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fill: { color: 'FFFFFF' },
          line: { color: 'FFFFFF', width: 0 },
        });
      }
    }
  }

  // Layer 3: Add text elements on top of cover rectangles
  for (const el of layout.elements) {
    if (el.type === 'text') {
      try {
        slide.addText(el.content, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          fontSize: el.fontSize,
          fontFace: el.fontFace || 'Arial',
          color: el.fontColor?.replace('#', ''),
          bold: el.bold,
          italic: el.italic,
          align: el.align,
          valign: el.valign || 'top',
          margin: [0, 2, 0, 2],
          // No fill on text â the cover rectangle behind handles the background
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
