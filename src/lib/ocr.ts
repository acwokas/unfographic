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
 *   "Data Foundation Activation and § ¢ Gus"
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

  // Filter out low-quality words (lenient to catch small labels like CRM, DSPs)
  const filtered = words
    .filter(w => w.confidence >= 45)
    .filter(w => w.bbox.width >= 6 && w.bbox.height >= 5)
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

    // Join words with spaces. Only omit space when words literally overlap
    // (negative gap means OCR split a single word into fragments).
    let text = cluster[0]?.text || '';
    for (let k = 1; k < cluster.length; k++) {
      const prev = cluster[k - 1];
      const curr = cluster[k];
      const gap = curr.bbox.x - (prev.bbox.x + prev.bbox.width);
      // Only merge without space if words physically overlap (negative gap)
      // meaning OCR broke one word into two fragments
      text += (gap < -1) ? '' : ' ';
      text += curr.text;
    }
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

  // Final line-level filters (lenient to keep short labels)
  return lines
    .filter(l => l.confidence >= 55)
    .filter(l => {
      // Need at least 2 alphanumeric chars (was 3 — lowered to catch "CRM", "DSPs")
      const cleaned = l.text.replace(/[^a-zA-Z0-9]/g, '');
      return cleaned.length >= 2;
    })
    .filter(l => {
      // At least 45% alphanumeric (rejects leftover symbol noise)
      const alphaNum = l.text.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      return alphaNum.length >= l.text.trim().length * 0.45;
    })
    .filter(l => l.bbox.width >= 15 && l.bbox.height >= 6);
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

  // Max allowed gap: ~1.5x char height to prevent merging distant regions
  const avgHeight = (a.bbox.height + b.bbox.height) / 2;
  const maxGap = avgHeight * 1.5;

  return hGap <= maxGap;
}

/**
 * Group nearby OCR lines into logical text blocks (1-2 lines each).
 * Lines are merged when they are vertically close and horizontally overlapping,
 * producing cleaner, more readable text boxes on the slide.
 */
export function groupOCRLines(lines: OCRLine[]): OCRLine[] {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a.bbox.y - b.bbox.y);
  const used = new Set<number>();
  const groups: OCRLine[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    used.add(i);

    let group = { ...sorted[i] };
    const gBottom = () => group.bbox.y + group.bbox.height;
    const gRight = () => group.bbox.x + group.bbox.width;

    // Try to merge the next few lines into this group (max 3 lines per block)
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const currentLineCount = (group.text.match(/\n/g) || []).length + 1;
      if (currentLineCount >= 3) break; // Cap at 3 lines per block
      const candidate = sorted[j];

      // Vertical gap: space between bottom of group and top of candidate
      const vGap = candidate.bbox.y - gBottom();
      const avgH = group.bbox.height / ((group.text.match(/\n/g) || []).length + 1);
      // Allow merging if vertical gap is < 1.8x average line height
      if (vGap > avgH * 1.8 || vGap < 0) continue;

      // Horizontal overlap check: lines must share significant horizontal space
      const overlapLeft = Math.max(group.bbox.x, candidate.bbox.x);
      const overlapRight = Math.min(gRight(), candidate.bbox.x + candidate.bbox.width);
      const hOverlap = overlapRight - overlapLeft;
      const narrowerWidth = Math.min(group.bbox.width, candidate.bbox.width);
      if (hOverlap < narrowerWidth * 0.3) continue;

      // Merge: expand bbox, join text
      const newMinX = Math.min(group.bbox.x, candidate.bbox.x);
      const newMinY = Math.min(group.bbox.y, candidate.bbox.y);
      const newMaxX = Math.max(gRight(), candidate.bbox.x + candidate.bbox.width);
      const newMaxY = Math.max(gBottom(), candidate.bbox.y + candidate.bbox.height);

      group = {
        text: group.text + '\n' + candidate.text,
        bbox: { x: newMinX, y: newMinY, width: newMaxX - newMinX, height: newMaxY - newMinY },
        confidence: (group.confidence + candidate.confidence) / 2,
      };
      used.add(j);
    }

    groups.push(group);
  }

  return groups;
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
  // Group nearby lines into logical blocks (subtitle + body) before creating text blocks
  const grouped = groupOCRLines(ocrLines);

  const textBlocks: AITextBlock[] = grouped.map((line, i) => {
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
