import Tesseract from 'tesseract.js';
import { AIResponse, AITextBlock } from '@/types/layout';

export interface OCRLine {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

/**
 * Run Tesseract OCR on an image and return text lines with precise bounding boxes.
 * Each line is kept separate â no grouping â so every element has an accurate
 * bounding box for pixel-precise positioning on the slide.
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

  return lines
    .filter(l => l.confidence >= 65)
    .filter(l => {
      // Need at least 3 alphanumeric chars to be real text
      const cleaned = l.text.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned.length >= 3;
    })
    .filter(l => {
      // At least 50% of characters must be alphanumeric (rejects icon/symbol garbage)
      const alphaNum = l.text.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      return alphaNum.length >= l.text.trim().length * 0.5;
    })
    .filter(l => {
      // Reject tiny bounding boxes â likely noise from icons or decorations
      return l.bbox.width >= 20 && l.bbox.height >= 8;
    });
}

/**
 * Group nearby OCR lines into logical text blocks.
 * DISABLED: We keep each line separate so every element has its own
 * accurate bounding box. Grouping inflated font sizes and caused overflow.
 */
export function groupOCRLines(lines: OCRLine[]): OCRLine[] {
  // Just sort by vertical position â no merging
  return [...lines].sort((a, b) => a.bbox.y - b.bbox.y);
}

/**
 * Convert OCR results into the AIResponse format that buildSlideLayout expects.
 * Each OCR line becomes its own text block with precise bounding box.
 */
export function ocrToAIResponse(
  ocrLines: OCRLine[],
  imgW: number,
  imgH: number,
  aiImageRegions?: AIResponse['imageRegions'],
): AIResponse {
  const sorted = [...ocrLines].sort((a, b) => a.bbox.y - b.bbox.y);

  const textBlocks: AITextBlock[] = sorted.map((line, i) => {
    // Classify text type from line height relative to image
    const relH = line.bbox.height / imgH;
    let type: AITextBlock['type'] = 'body';
    if (relH > 0.035) type = 'title';
    else if (relH > 0.022) type = 'heading';
    else if (relH > 0.015) type = 'subheading';
    else if (relH > 0.01) type = 'body';
    else type = 'label';

    return {
      id: `ocr-${i}`,
      content: line.text,
      type,
      positionHint: 'center',
      section: 'main',
      fontColor: '000000',
      bold: type === 'title' || type === 'heading',
      size: relH > 0.025 ? 'large' : relH > 0.015 ? 'medium' : 'small' as any,
      boundingBox: line.bbox,
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
