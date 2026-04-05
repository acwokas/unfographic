import { AIResponse, LayoutAnalysis, LayoutElement, TextElement, ImageRegionElement } from '@/types/layout';
import { cropImageRegion } from './image-utils';

const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.25;
const COL_GAP = 0.15;
const ROW_GAP = 0.06;

function classifyColumn(hint: string): number {
  const h = (hint || 'center').toLowerCase().trim();
  if (h.includes('left')) return 0;
  if (h.includes('right')) return 2;
  return 1;
}

export function buildSlideLayout(
  aiResponse: AIResponse,
  originalImage: HTMLImageElement,
): LayoutAnalysis {
  const imgW = aiResponse.imageWidth || originalImage.naturalWidth;
  const imgH = aiResponse.imageHeight || originalImage.naturalHeight;
  const contentW = SLIDE_W - 2 * MARGIN;
  const colW = (contentW - 2 * COL_GAP) / 3;
  const colX = [MARGIN, MARGIN + colW + COL_GAP, MARGIN + 2 * (colW + COL_GAP)];

  const elements: LayoutElement[] = [];

  // Title row (full width)
  let titleY = MARGIN;
  for (const t of (aiResponse.textBlocks || [])) {
    if (t.type !== 'title' && t.type !== 'subtitle') continue;
    const fs = t.type === 'title' ? 20 : 16;
    const h = t.type === 'title' ? 0.38 : 0.28;
    elements.push({
      type: 'text', id: t.id, content: t.content,
      x: MARGIN, y: titleY, w: contentW, h,
      fontSize: fs, fontFace: 'Arial',
      fontColor: (t.fontColor || '000000').replace('#', ''),
      bold: true, italic: false, align: 'left', valign: 'top',
    });
    titleY += h + ROW_GAP;
  }
  const contentStartY = titleY + 0.08;
  const maxY = SLIDE_H - MARGIN;

  // Classify items into columns
  type ColItem = { kind: 'text'; data: typeof aiResponse.textBlocks[0] }
    | { kind: 'image'; data: typeof aiResponse.imageRegions[0] };

  const colItems: ColItem[][] = [[], [], []];

  for (const t of (aiResponse.textBlocks || [])) {
    if (t.type === 'title' || t.type === 'subtitle') continue;
    colItems[classifyColumn(t.positionHint || 'center')].push({ kind: 'text', data: t });
  }
  for (const r of (aiResponse.imageRegions || [])) {
    const cxPct = (r.cropBox.x + r.cropBox.width / 2) / imgW;
    const col = cxPct < 0.33 ? 0 : cxPct < 0.66 ? 1 : 2;
    colItems[col].push({ kind: 'image', data: r });
  }

  // Layout each column
  for (let ci = 0; ci < 3; ci++) {
    const items = colItems[ci];

    const heights: number[] = items.map(item => {
      if (item.kind === 'text') {
        const hMap: Record<string, number> = {
          heading: 0.26, body: 0.30, label: 0.18, subheading: 0.22, caption: 0.16,
        };
        return hMap[item.data.type] || 0.22;
      }
      return 0.55;
    });

    const totalH = heights.reduce((sum, h) => sum + h + ROW_GAP, 0);
    const avail = maxY - contentStartY;
    const scale = totalH > avail ? avail / totalH : 1;

    let curY = contentStartY;

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const h = heights[idx] * scale;

      if (item.kind === 'text') {
        const t = item.data;
        const sMap: Record<string, number> = { large: 20, medium: 12, small: 9, tiny: 8 };
        let fs = sMap[t.size] || 9;
        if (scale < 0.85) fs = Math.max(7, Math.round(fs * Math.max(scale, 0.75)));

        elements.push({
          type: 'text', id: t.id, content: t.content,
          x: colX[ci], y: curY, w: colW, h,
          fontSize: fs, fontFace: 'Arial',
          fontColor: (t.fontColor || '000000').replace('#', ''),
          bold: t.bold || t.type === 'heading',
          italic: false, align: 'left', valign: 'top',
        });
      } else {
        const r = item.data;
        const w = Math.min(colW * 0.5, 1.2);
        let croppedDataUrl: string | undefined;
        try { croppedDataUrl = cropImageRegion(originalImage, r.cropBox); }
        catch (e) { console.warn('crop fail', r.id, e); }

        elements.push({
          type: 'image_region', id: r.id, description: r.description,
          cropBox: r.cropBox, x: colX[ci], y: curY, w, h,
          croppedDataUrl,
        });
      }

      curY += h + ROW_GAP * scale;
    }
  }

  return {
    slide: { width: SLIDE_W, height: SLIDE_H, backgroundColor: 'FFFFFF' },
    elements,
  };
}
