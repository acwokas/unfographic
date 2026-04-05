import { AIResponse, LayoutAnalysis, LayoutElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

interface LayoutConfig {
  slideW: number;
  slideH: number;
  margin: number;
  gap: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
  slideW: 10,
  slideH: 5.625,
  margin: 0.4,
  gap: 0.15,
};

export function buildSlideLayout(
  aiResponse: AIResponse,
  originalImage: HTMLImageElement,
  config: LayoutConfig = DEFAULT_CONFIG
): LayoutAnalysis {
  const { slideW, slideH, margin, gap } = config;
  const elements: LayoutElement[] = [];

  // ── 1. Title area (top of slide) ──
  const titles = (aiResponse.textBlocks || []).filter(
    (t) => t.type === 'title' || t.type === 'subtitle'
  );
  let titleY = margin;

  for (const t of titles) {
    const fontSize = t.type === 'title' ? 24 : 16;
    const h = t.type === 'title' ? 0.5 : 0.35;
    elements.push({
      type: 'text',
      id: t.id,
      content: t.content,
      x: margin,
      y: titleY,
      w: slideW - margin * 2,
      h,
      fontSize,
      fontFace: 'Arial',
      fontColor: (t.fontColor || '000000').replace('#', ''),
      bold: t.bold !== false,
      italic: false,
      align: 'left',
      valign: 'top',
    });
    titleY += h + gap * 0.5;
  }

  // ── 2. Content area (below titles) ──
  const contentTop = titleY + gap;
  const contentH = slideH - contentTop - margin;
  const sections = aiResponse.layout?.sections || [];
  const numCols = Math.max(sections.length, 1);
  const colW = (slideW - margin * 2 - gap * (numCols - 1)) / numCols;

  sections.forEach((section, colIdx) => {
    const colX = margin + colIdx * (colW + gap);
    let curY = contentTop;

    // Section heading
    const sectionHeadings = (aiResponse.textBlocks || []).filter(
      (t) => t.section === section.name && t.type === 'heading'
    );
    for (const t of sectionHeadings) {
      elements.push({
        type: 'text',
        id: t.id,
        content: t.content,
        x: colX,
        y: curY,
        w: colW,
        h: 0.35,
        fontSize: 14,
        fontFace: 'Arial',
        fontColor: (t.fontColor || '000000').replace('#', ''),
        bold: true,
        italic: false,
        align: 'left',
        valign: 'top',
      });
      curY += 0.35 + gap * 0.5;
    }

    // Image regions for this section
    const sectionImages = (aiResponse.imageRegions || []).filter(
      (r) => r.section === section.name
    );
    const imgSize = Math.min(colW * 0.4, contentH * 0.25);
    let imgX = colX;

    for (const img of sectionImages) {
      const cropped = cropImageRegion(originalImage, img.cropBox);
      elements.push({
        type: 'image_region',
        id: img.id,
        description: img.description,
        cropBox: img.cropBox,
        x: imgX,
        y: curY,
        w: imgSize,
        h: imgSize,
        croppedDataUrl: cropped,
      });
      imgX += imgSize + gap;
      if (imgX + imgSize > colX + colW) {
        imgX = colX;
        curY += imgSize + gap;
      }
    }
    if (sectionImages.length > 0) {
      curY += imgSize + gap;
    }

    // Labels, subheadings, body text for this section
    const sectionTexts = (aiResponse.textBlocks || []).filter(
      (t) =>
        t.section === section.name &&
        !['title', 'subtitle', 'heading'].includes(t.type)
    );
    for (const t of sectionTexts) {
      const fontSize = t.type === 'subheading' ? 11 : t.type === 'label' ? 10 : 9;
      const h = t.type === 'body' ? 0.4 : 0.22;
      const bold = t.type === 'subheading' || t.type === 'label' || t.bold;
      elements.push({
        type: 'text',
        id: t.id,
        content: t.content,
        x: colX,
        y: curY,
        w: colW,
        h,
        fontSize,
        fontFace: 'Arial',
        fontColor: (t.fontColor || '333333').replace('#', ''),
        bold,
        italic: false,
        align: 'left',
        valign: 'top',
      });
      curY += h + gap * 0.3;
    }
  });

  // ── 3. Global elements not in a section ──
  const globalTexts = (aiResponse.textBlocks || []).filter(
    (t) =>
      (t.section === 'global' || !t.section) &&
      !['title', 'subtitle'].includes(t.type)
  );
  let globalY = slideH - margin - 0.3;
  for (const t of [...globalTexts].reverse()) {
    elements.push({
      type: 'text',
      id: t.id,
      content: t.content,
      x: margin,
      y: globalY,
      w: slideW - margin * 2,
      h: 0.2,
      fontSize: 8,
      fontFace: 'Arial',
      fontColor: (t.fontColor || '999999').replace('#', ''),
      bold: false,
      italic: false,
      align: 'right',
      valign: 'top',
    });
    globalY -= 0.25;
  }

  // ── 4. Unassigned image regions ──
  const assignedImageIds = new Set(
    (aiResponse.imageRegions || [])
      .filter((r) => sections.some((s) => s.name === r.section))
      .map((r) => r.id)
  );
  const unassignedImages = (aiResponse.imageRegions || []).filter(
    (r) => !assignedImageIds.has(r.id)
  );
  if (unassignedImages.length > 0) {
    const imgSize = Math.min(1.2, (slideW - margin * 2) / unassignedImages.length - gap);
    let ux = margin;
    let uy = globalY - imgSize - gap;
    for (const img of unassignedImages) {
      const cropped = cropImageRegion(originalImage, img.cropBox);
      elements.push({
        type: 'image_region',
        id: img.id,
        description: img.description,
        cropBox: img.cropBox,
        x: ux,
        y: uy,
        w: imgSize,
        h: imgSize,
        croppedDataUrl: cropped,
      });
      ux += imgSize + gap;
    }
  }

  return {
    slide: { width: slideW, height: slideH, backgroundColor: 'FFFFFF' },
    elements,
  };
}
