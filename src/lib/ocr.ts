import Tesseract from 'tesseract.js';
import { AIResponse, AITextBlock } from '@/types/layout';

export interface OCRLine {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

interface OCRWord {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
}

/**
 * Run Tesseract OCR on an image and return text lines with precise bounding boxes.
 *
 * KEY FIX: We extract WORD-level bounding boxes and cluster them ourselves
 * instead of relying on Tesseract's line detection. Tesseract often merges
 * text from completely different horizontal regions of an infographic into
 * a single "line", producing garbage like:
 *   "Data Foundation Activation and Gus"
 * By clustering words based on spatial proximity, we keep text blocks
 * that are far apart horizontally as separate lines.
 */
export async function runOCR(imageDataUrl: string): Promise<OCRLine[]> {
  const { data } = await Tesseract.recognize(imageDataUrl, 'eng');
  const words: OCRWord[] = [];

  // Extract individual words with their bounding boxes
  for (const block of data.blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text) continue;
          words.push({
            text,
            bbox: {
              x: word.bbox.x0,
              y: word.bbox.y0,
              width: word.bbox.x1 - word.bbox.x0,
              height: word.bbox.y1 - word.bbox.y0,
            },
            confidence: word.confidence,
          });
        }
      }
    }
  }

  // Filter out low-quality words
  const filtered = words
    .filter(w => w.confidence >= 60)
    .filter(w => w.bbox.width >= 8 && w.bbox.height >= 6)
    .filter(w => {
      // Word must have at least 1 alphanumeric character
      const cleaned = w.text.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned.length >= 1;
    })
    .filter(w => {
      // Reject pure symbol words (must be >40% alphanumeric)
      const alphaNum = w.text.replace(/[^a-zA-Z0-9]/g, '');
      return alphaNum.length >= w.text.length * 0.4;
    });

  // Cluster words into spatial groups (our own "lines")
  const clusters = clusterWords(filtered);

  // Convert clusters to OCRLines
  const lines: OCRLine[] = clusters.map(cluster => {
    // Sort words left-to-right within cluster
    cluster.sort((a, b) => a.bbox.x - b.bbox.x);

    const text = cluster.map(w => w.text).join(' ');
    const minX = Math.min(...cluster.map(w => w.bbox.x));
    const minY = Math.min(...cluster.map(w => w.bbox.y));
    const maxX = Math.max(...cluster.map(w => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...cluster.map(w => w.bbox.y + w.bbox.height));
    const avgConf = cluster.reduce((s, w) => s + w.confidence, 0) / cluster.length;

    return {
      text,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
      confidence: avgConf,
    };
  });

  // Final line-level filters
  return lines
    .filter(l => l.confidence >= 65)
    .filter(l => {
      // Need at least 3 alphanumeric chars
      const cleaned = l.text.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned.length >= 3;
    })
    .filter(l => {
      // At least 50% alphanumeric (rejects leftover symbol noise)
      const alphaNum = l.text.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      return alphaNum.length >= l.text.trim().length * 0.5;
    })
    .filter(l => l.bbox.width >= 20 && l.bbox.height >= 8);
}

/**
 * Cluster words into spatial groups based on horizontal proximity.
 * Two words belong together if:
 *   1. They vertically overlap (same text line)
 *   2. The horizontal gap between them is small (< maxGap)
 *
 * This prevents merging text from different regions of the infographic
 * that Tesseract's built-in line detection incorrectly groups together.
 */
function clusterWords(words: OCRWord[]): OCRWord[][] {
  if (words.length === 0) return [];

  // Sort by Y first, then X
  const sorted = [...words].sort((a, b) => {
    const yCmp = a.bbox.y - b.bbox.y;
    if (Math.abs(yCmp) > 5) return yCmp;
    return a.bbox.x - b.bbox.x;
  });

  const assigned = new Set<number>();
  const clusters: OCRWord[][] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: OCRWord[] = [sorted[i]];
    assigned.add(i);

    // Find all words that belong to this cluster via transitive proximity
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < sorted.length; j++) {
        if (assigned.has(j)) continue;

        // Check if word j is close to any word already in the cluster
        for (const cw of cluster) {
          if (areWordsNearby(cw, sorted[j])) {
            cluster.push(sorted[j]);
            assigned.add(j);
            changed = true;
            break;
          }
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Check if two words are close enough to be on the same text line.
 * They must vertically overlap AND the horizontal gap must be small.
 */
function areWordsNearby(a: OCRWord, b: OCRWord): boolean {
  const aTop = a.bbox.y;
  const aBot = a.bbox.y + a.bbox.height;
  const bTop = b.bbox.y;
  const bBot = b.bbox.y + b.bbox.height;

  // Check vertical overlap: the two words must share vertical space
  const vOverlap = Math.min(aBot, bBot) - Math.max(aTop, bTop);
  const minHeight = Math.min(a.bbox.height, b.bbox.height);
  if (vOverlap < minHeight * 0.3) return false; // Less than 30% vertical overlap

  // Check horizontal gap
  const aRight = a.bbox.x + a.bbox.width;
  const bRight = b.bbox.x + b.bbox.width;
  const hGap = Math.max(0, Math.max(a.bbox.x, b.bbox.x) - Math.min(aRight, bRight));

  // Max allowed gap scales with character height (roughly 2x char height)
  // This allows normal word spacing but prevents merging distant regions
  const avgHeight = (a.bbox.height + b.bbox.height) / 2;
  const maxGap = avgHeight * 2.5;

  return hGap <= maxGap;
}

/**
 * Group nearby OCR lines into logical text blocks.
 * DISABLED: We keep each line separate so every element has its own
 * accurate bounding box. Grouping inflated font sizes and caused overflow.
 */
export function groupOCRLines(lines: OCRLine[]): OCRLine[] {
  // Just sort by vertical position - no merging
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
      size: relH > 0.025 ? 'large' : relH > 0.015 ? 'medium' : 'small',
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
