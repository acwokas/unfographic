import PptxGenJS from 'pptxgenjs';
import { LayoutAnalysis, LayoutElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

function mapShapeType(shapeType: string): keyof typeof PptxGenJS.ShapeType | string {
  const map: Record<string, string> = {
    rect: 'rect',
    roundRect: 'roundRect',
    ellipse: 'ellipse',
    line: 'line',
    arrow: 'rightArrow',
  };
  return map[shapeType] || 'rect';
}

export async function generatePptx(
  layout: LayoutAnalysis,
  originalImage: HTMLImageElement,
  fileName = 'deconstructed-slide.pptx'
) {
  const pptx = new PptxGenJS();

  pptx.defineLayout({
    name: 'CUSTOM',
    width: layout.slide.width,
    height: layout.slide.height,
  });
  pptx.layout = 'CUSTOM';

  const slide = pptx.addSlide();

  const bgColor = layout.slide.backgroundColor?.replace('#', '') || 'FFFFFF';
  slide.background = { color: bgColor };

  for (const el of layout.elements) {
    try {
      switch (el.type) {
        case 'text':
          slide.addText(el.content, {
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            fontSize: el.fontSize,
            fontFace: el.fontFace,
            color: el.fontColor?.replace('#', ''),
            bold: el.bold,
            italic: el.italic,
            align: el.align,
            valign: el.valign,
            fill: el.backgroundColor ? { color: el.backgroundColor.replace('#', '') } : undefined,
            margin: 0,
          });
          break;

        case 'image_region': {
          const croppedBase64 = cropImageRegion(originalImage, el.cropBox);
          slide.addImage({
            data: croppedBase64,
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
          });
          break;
        }

        case 'shape': {
          const pptxShape = (PptxGenJS as any).ShapeType?.[mapShapeType(el.shapeType)] || 'rect';
          slide.addShape(pptxShape, {
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            fill: el.fillColor ? { color: el.fillColor.replace('#', '') } : undefined,
            line: el.borderColor
              ? { color: el.borderColor.replace('#', ''), width: el.borderWidth || 1 }
              : undefined,
            rotate: el.rotation || 0,
          });
          break;
        }
      }
    } catch (e) {
      console.warn('Failed to add element:', el.id, e);
    }
  }

  await pptx.writeFile({ fileName });
}
