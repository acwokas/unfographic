import PptxGenJS from 'pptxgenjs';
import { LayoutAnalysis } from '@/types/layout';
import { cropImageRegion } from './image-utils';
import { AIResponse } from '@/types/layout';

export async function generateToolkitPptx(
  aiResponse: AIResponse,
  originalImage: HTMLImageElement,
  originalDataUrl: string,
  fileName = 'unfographic-export.pptx'
) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 10, height: 5.625 });
  pptx.layout = 'WIDE';

  const margin = 0.4;
  const slideW = 10;
  const slideH = 5.625;
  const maxY = slideH - margin;

  // ═══════════════════════════════════════════
  // SLIDE 1: Original Reference
  // ═══════════════════════════════════════════
  const slide1 = pptx.addSlide();
  slide1.addImage({
    data: originalDataUrl,
    x: 0, y: 0, w: slideW, h: slideH,
    sizing: { type: 'contain', w: slideW, h: slideH },
  });
  slide1.addText('Original Reference — use as visual guide', {
    x: 0, y: 5.2, w: slideW, h: 0.3,
    fontSize: 8, color: '999999', align: 'center', fontFace: 'Arial',
  });

  // ═══════════════════════════════════════════
  // SLIDE 2+: Editable Text
  // ═══════════════════════════════════════════
  const colW = slideW - margin * 2;

  let textSlide = pptx.addSlide();
  textSlide.addText('Editable Text Components', {
    x: margin, y: margin * 0.5, w: colW, h: 0.4,
    fontSize: 18, bold: true, color: 'FF6B35', fontFace: 'Arial',
  });
  let curY = 1.0;

  const ensureSpace = (needed: number) => {
    if (curY + needed > maxY) {
      textSlide = pptx.addSlide();
      curY = margin;
    }
  };

  // Titles first
  const titles = aiResponse.textBlocks.filter(
    (t) => t.type === 'title' || t.type === 'subtitle'
  );
  for (const t of titles) {
    const fontSize = t.type === 'title' ? 20 : 14;
    const h = t.type === 'title' ? 0.45 : 0.3;
    ensureSpace(h);
    textSlide.addText(t.content, {
      x: margin, y: curY, w: colW, h,
      fontSize, bold: t.bold || t.type === 'title',
      color: t.fontColor || '000000', fontFace: 'Arial',
      align: 'left', valign: 'top', margin: 0,
    });
    curY += h + 0.1;
  }
  curY += 0.15;

  // Section by section
  const sections = aiResponse.layout?.sections || [{ name: 'Content', position: '', description: '' }];
  for (const section of sections) {
    ensureSpace(0.4);
    textSlide.addText(section.name.toUpperCase(), {
      x: margin, y: curY, w: colW, h: 0.3,
      fontSize: 11, bold: true, color: '7C3AED', fontFace: 'Arial',
      align: 'left', margin: 0,
    });
    textSlide.addShape(pptx.ShapeType.line, {
      x: margin, y: curY + 0.3, w: colW, h: 0,
      line: { color: 'E0E0E0', width: 0.5 },
    });
    curY += 0.4;

    const sectionTexts = aiResponse.textBlocks.filter(
      (t) => t.section === section.name && t.type !== 'title' && t.type !== 'subtitle'
    );
    for (const t of sectionTexts) {
      const fontSize = ['heading', 'subheading'].includes(t.type) ? 12 : 10;
      const bold = ['heading', 'subheading', 'label'].includes(t.type) || t.bold;
      const lineChars = 80;
      const lines = Math.ceil(t.content.length / lineChars);
      const h = Math.max(0.22, lines * 0.2);
      ensureSpace(h);
      textSlide.addText(t.content, {
        x: margin + 0.1, y: curY, w: colW - 0.2, h,
        fontSize, bold, color: t.fontColor || '333333',
        fontFace: 'Arial', align: 'left', valign: 'top', margin: 0,
      });
      curY += h + 0.08;
    }
    curY += 0.15;
  }

  // Global texts not in any section
  const globalTexts = aiResponse.textBlocks.filter(
    (t) => (t.section === 'global' || !t.section) && !['title', 'subtitle'].includes(t.type)
  );
  if (globalTexts.length > 0) {
    ensureSpace(0.4);
    textSlide.addText('GLOBAL', {
      x: margin, y: curY, w: colW, h: 0.3,
      fontSize: 11, bold: true, color: '7C3AED', fontFace: 'Arial',
      align: 'left', margin: 0,
    });
    curY += 0.35;
    for (const t of globalTexts) {
      const h = Math.max(0.22, Math.ceil(t.content.length / 80) * 0.2);
      ensureSpace(h);
      textSlide.addText(t.content, {
        x: margin + 0.1, y: curY, w: colW - 0.2, h,
        fontSize: 10, bold: t.bold, color: t.fontColor || '333333',
        fontFace: 'Arial', align: 'left', valign: 'top', margin: 0,
      });
      curY += h + 0.08;
    }
  }

  // ═══════════════════════════════════════════
  // SLIDE 3+: Visual Components
  // ═══════════════════════════════════════════
  if (aiResponse.imageRegions.length > 0) {
    let imgSlide = pptx.addSlide();
    imgSlide.addText('Visual Components — drag these onto your slides', {
      x: margin, y: margin * 0.5, w: colW, h: 0.4,
      fontSize: 18, bold: true, color: 'FF6B35', fontFace: 'Arial',
    });

    const gridCols = 4;
    const cellSize = (slideW - margin * 2 - 0.15 * (gridCols - 1)) / gridCols;
    let gridX = margin;
    let gridY = 1.0;

    for (const region of aiResponse.imageRegions) {
      if (gridY + cellSize + 0.25 > maxY) {
        imgSlide = pptx.addSlide();
        gridX = margin;
        gridY = margin;
      }

      try {
        const cropped = cropImageRegion(originalImage, region.cropBox);
        imgSlide.addImage({
          data: cropped,
          x: gridX, y: gridY, w: cellSize, h: cellSize,
          sizing: { type: 'contain', w: cellSize, h: cellSize },
        });
      } catch (e) {
        console.warn('Failed to crop region:', region.id, e);
      }

      imgSlide.addText(region.description || region.id, {
        x: gridX, y: gridY + cellSize, w: cellSize, h: 0.22,
        fontSize: 7, color: '999999', fontFace: 'Arial',
        align: 'center', valign: 'top', margin: 0,
      });

      gridX += cellSize + 0.15;
      if (gridX + cellSize > slideW - margin) {
        gridX = margin;
        gridY += cellSize + 0.35;
      }
    }
  }

  await pptx.writeFile({ fileName });
}
