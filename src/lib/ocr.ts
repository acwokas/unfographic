import Tesseract from 'tesseract.js';
import { AIResponse, AITextBlock } from '@/types/layout';

export interface OCRLine {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

/**
 * Run Tesseract OCR on an image and return text lines with precise bounding boxes.
 * Coordinates are in the pixel space of the provided image.
 */
export async function runOCR(imageDataUrl: string): Promise<OCRLine[]> {
  const { data } = await Tesseract.recognize(imageDataUrl, 'eng');
  const lines: OCRLine[] = [];

  for (const block of data.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim();
        if (!text || text.length < 2) continue;
        lines.push({
          text,
          bbox: {
            x: line.bbox.x0,
            y: line.bbox.y0,
            width: line.bbox.x1 - line.bbox.x0,
            height: line.bbox.y1 - line.bbox.y0,
          },
          confidence: line.confidence,
        });
      }
    }
  }

  // Higher confidence threshold â 60% removes most garbage from icons/decorative elements
  return lines
    .filter(l => l.confidence > 60)
    .filter(l => {
      // Remove very short fragments that are likely OCR noise
      const cleaned = l.text.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned.length >= 2;
    })
    .filter(l => {
      // Remove lines that are mostly symbols/punctuation (icon labels, decorative chars)
      const alphaNum = l.text.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      return alphaNum.length >= l.text.trim().length * 0.4;
    });
}

/**
 * Group nearby OCR lines into logical text blocks.
 * Lines within verticalGap pixels of each other and horizontally overlapping are merged.
 */
export function groupOCRLines(lines: OCRLine[], verticalGap = 12): OCRLine[] {
  if (lines.length === 0) return [];

  // Sort by Y position
  const sorted = [...lines].sort((a, b) => a.bbox.y - b.bbox.y);
  const groups: OCRLine[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const line = sorted[i];
    const lastGroup = groups[groups.length - 1];
    const lastLine = lastGroup[lastGroup.length - 1];

    // Check if this line is close vertically to the last line in the current group
    const vDist = line.bbox.y - (lastLine.bbox.y + lastLine.bbox.height);
    const hOverlap =
      line.bbox.x < lastLine.bbox.x + lastLine.bbox.width + 50 &&
      line.bbox.x + line.bbox.width > lastLine.bbox.x - 50;

    if (vDist < verticalGap && hOverlap) {
      lastGroup.push(line);
    } else {
      groups.push([line]);
    }
  }

  // Merge each group into a single block, but split groups that are too tall
  const merged: OCRLine[] = [];
  for (const group of groups) {
    const x = Math.min(...group.map(l => l.bbox.x));
    const y = Math.min(...group.map(l => l.bbox.y));
    const x2 = Math.max(...group.map(l => l.bbox.x + l.bbox.width));
    const y2 = Math.max(...group.map(l => l.bbox.y + l.bbox.height));
    const height = y2 - y;

    // If the merged block is very tall compared to individual lines, keep lines separate
    const avgLineHeight = group.reduce((s, l) => s + l.bbox.height, 0) / group.length;
    if (group.length > 3 && height > avgLineHeight * 5) {
      // Too many lines merged â keep each line separate for better positioning
      for (const line of group) {
        merged.push(line);
      }
    } else {
      merged.push({
        text: group.map(l => l.text).join(' '),
        bbox: { x, y, width: x2 - x, height: y2 - y },
        confidence: group.reduce((s, l) => s + l.confidence, 0) / group.length,
      });
    }
  }

  return merged;
}

/**
 * Convert OCR results into the AIResponse format that buildSlideLayout expects.
 * This lets us swap in OCR for text while keeping the existing layout engine.
 */
export function ocrToAIResponse(
  ocrLines: OCRLine[],
  imgW: number,
  imgH: number,
  aiImageRegions?: AIResponse['imageRegions'],
): AIResponse {
  const grouped = groupOCRLines(ocrLines);

  const textBlocks: AITextBlock[] = grouped.map((block, i) => {
    // Estimate text type from size relative to image
    const relH = block.bbox.height / imgH;
    let type: AITextBlock['type'] = 'body';
    if (relH > 0.04) type = 'title';
    else if (relH > 0.025) type = 'heading';
    else if (relH > 0.018) type = 'subheading';
    else if (relH > 0.012) type = 'body';
    else type = 'label';

    return {
      id: `ocr-${i}`,
      content: block.text,
      type,
      positionHint: 'center',
      section: 'main',
      fontColor: '000000',
      bold: type === 'title' || type === 'heading',
      size: relH > 0.03 ? 'large' : relH > 0.018 ? 'medium' : 'small' as any,
      boundingBox: block.bbox,
    };
  });

  return {
    imageWidth: imgW,
    imageHeight: imgH,
    layout: { columns: 1, flow: 'free', sections: [] },
    imageRegions: aiImageRegions || [],
    textBlocks,
  };
}
