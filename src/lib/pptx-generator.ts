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
  slide.background = { color: layout.slide.backgroundColor || 'FFFFFF' };

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
          margin: 0,
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
