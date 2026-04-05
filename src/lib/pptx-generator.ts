import PptxGenJS from 'pptxgenjs';
import { LayoutAnalysis } from '@/types/layout';
import { cropImageRegion } from './image-utils';

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

  // Layer 1: Full background image from the original
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = originalImage.naturalWidth;
  bgCanvas.height = originalImage.naturalHeight;
  const bgCtx = bgCanvas.getContext('2d')!;
  bgCtx.drawImage(originalImage, 0, 0);
  const bgDataUrl = bgCanvas.toDataURL('image/jpeg', 0.92);

  slide.addImage({
    data: bgDataUrl,
    x: 0,
    y: 0,
    w: layout.slide.width,
    h: layout.slide.height,
  });

  // Layer 2: Text overlays
  for (const el of layout.elements) {
    if (el.type !== 'text') continue;
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
        margin: 0,
      });
    } catch (e) {
      console.warn('Failed to add text element:', el.id, e);
    }
  }

  await pptx.writeFile({ fileName });
}
